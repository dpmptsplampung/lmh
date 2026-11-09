// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Katalog from './Katalog';
import ProfilKatalog from './ProfilKatalog';

const id = '10000000-0000-4000-8000-000000000001';
const card = {
  id, nama: 'Kopi Lampung', jenis: 'Produk', kategori: 'Minuman', spesifik: 'Kopi',
  kabupaten_kota: 'Lampung Barat', deskripsi: 'Kopi hasil kebun setempat', foto: null,
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string) => url.endsWith('/filter')
    ? ok({ jenis: ['Produk'], kategori: ['Minuman'], kabupaten_kota: ['Lampung Barat'], terpotong: false })
    : ok({ items: [card], next_cursor: null }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('katalog publik', () => {
  it('memuat, menampilkan kartu dan tautan profil tanpa laporan umum', async () => {
    render(<main><Katalog /></main>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('status').textContent).toMatch(/Memuat/);
    expect(await screen.findByRole('link', { name: card.nama })).toHaveAttribute('href', `/umkm/katalog/${id}`);
    expect(screen.queryByRole('button', { name: /^Laporkan$/ })).toBeNull();
    expect(screen.getByLabelText('Kata kunci')).toBeTruthy();
    expect(screen.getByLabelText('Jenis usaha')).toBeTruthy();
  });

  it('hasil kosong mempunyai jalan keluar dengan kata kunci terlampir', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/filter')
      ? ok({ jenis: [], kategori: [], kabupaten_kota: [], terpotong: false })
      : ok({ items: [], next_cursor: null }));
    render(<Katalog />);
    await screen.findByText('Belum ada profil yang cocok');
    fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'pisang' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cari UMKM' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('q=pisang'))).toBe(true));
    fireEvent.click(screen.getAllByRole('button', { name: 'Hubungi lewat petugas' })[0]);
    expect(await screen.findByRole('dialog')).toHaveTextContent('pisang');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('link', { name: 'Kebijakan Privasi' })).toHaveAttribute('href', '/kebijakan-privasi');
  });

  it.each([
    [503, 'MODUL_BELUM_TERSEDIA', 'Katalog belum tersedia'],
    [429, 'TERLALU_BANYAK', 'Permintaan sedang padat'],
    [500, 'GAGAL_INTERNAL', 'Katalog belum berhasil dimuat'],
  ])('galat %s tetap tenang dan tidak menampilkan rincian internal', async (status, code, message) => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ error: { code, message: 'rahasia internal 12345' } }), { status: Number(status) }))); 
    render(<Katalog />);
    expect(await screen.findByText(new RegExp(String(message)))).toBeTruthy();
    expect(document.body.textContent).not.toContain('12345');
    expect(screen.getAllByRole('button', { name: 'Coba lagi' }).length).toBeGreaterThan(0);
  });

  it('cursor diteruskan dan dibuang setelah filter berubah', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/filter')
      ? ok({ jenis: ['Produk'], kategori: [], kabupaten_kota: [], terpotong: false })
      : ok({ items: [card], next_cursor: url.includes('cursor=') ? null : 'opaque-page' }));
    render(<Katalog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Halaman berikutnya' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('cursor=opaque-page'))).toBe(true));
    fireEvent.change(screen.getByLabelText('Jenis usaha'), { target: { value: 'Produk' } });
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(/jenis=Produk/));
    expect(fetchMock.mock.calls.at(-1)?.[0]).not.toContain('cursor=');
  });
});

describe('detail profil publik', () => {
  it('hanya menampilkan proyeksi publik dan tautan sosial berlabel', async () => {
    fetchMock.mockResolvedValue(await ok({ ...card, foto: [], instagram: 'https://instagram.com/kopi', tiktok: null,
      nomor: '081234567890', email: 'privat@example.test', alamat: 'Alamat rinci privat', pemilik: 'Pemilik Privat' }));
    render(<ProfilKatalog id={id} />);
    expect(await screen.findByRole('heading', { level: 1, name: card.nama })).toBeTruthy();
    const social = screen.getByRole('link', { name: /Instagram/ });
    expect(social).toHaveAttribute('target', '_blank');
    expect(social).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByRole('link', { name: /TikTok/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/081234567890|privat@example|Alamat rinci privat|Pemilik Privat/);
    fireEvent.click(screen.getByRole('button', { name: 'Laporkan' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Alasan laporan' })).toBeTruthy();
  });

  it('profil disembunyikan atau hilang memberikan jalan kembali', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'TIDAK_DITEMUKAN' } }), { status: 404 }));
    render(<ProfilKatalog id={id} />);
    expect(await screen.findByText('Profil belum dapat ditampilkan')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Kembali ke katalog' })).toHaveAttribute('href', '/umkm/katalog');
  });
});
