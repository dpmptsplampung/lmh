// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Katalog from './Katalog';
import ProfilKatalog from './ProfilKatalog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const id = '10000000-0000-4000-8000-000000000001';
const card = {
  id, nama: 'Kopi Lampung', jenis: 'Produk', kategori: 'Minuman', spesifik: 'Kopi',
  kabupaten_kota: 'Lampung Barat', kecamatan: 'Sukau', deskripsi: 'Kopi hasil kebun setempat', foto: null,
  suka: 1299, dilihat: 1000, baru: true,
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
    expect(screen.getByText('1.299 Suka', { selector: '.sr-only' }).parentElement).toHaveTextContent('1,2 rb Suka');
    expect(screen.getByText('1.000 Dilihat', { selector: '.sr-only' }).parentElement).toHaveTextContent('1 rb Dilihat');
    expect(screen.getByText('Baru')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url.includes('sort=terbaru'))).toBe(false);
  });

  it('kartu menampilkan kecamatan', async () => {
    render(<main><Katalog /></main>);
    expect(await screen.findByText('Sukau, Lampung Barat')).toBeTruthy();
  });

  it('mengulang pencarian dari awal ketika snapshot berubah dengan filter tetap', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/filter')) return ok({ jenis: [], kategori: [], kabupaten_kota: [], terpotong: false });
      if (url.includes('cursor=')) return Promise.resolve(new Response(
        JSON.stringify({ error: { code: 'SNAPSHOT_BERUBAH' } }), { status: 409 }));
      return ok({ items: [card], next_cursor: 'lama' });
    });
    render(<Katalog />);
    await screen.findByRole('link', { name: card.nama });
    fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'kopi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cari UMKM' }));
    await screen.findByRole('button', { name: 'Halaman berikutnya' });
    fireEvent.click(screen.getByRole('button', { name: 'Halaman berikutnya' }));
    expect(await screen.findByText(/Urutan katalog diperbarui/)).toBeTruthy();
    await screen.findByRole('link', { name: card.nama });
    const last = fetchMock.mock.calls.at(-1)?.[0];
    expect(last).toContain('q=kopi');
    expect(last).not.toContain('cursor=');
  });

  it('chip kategori menerapkan filter kategori dan bisa dihapus dari daftar filter aktif', async () => {
    render(<Katalog />);
    fireEvent.click(await screen.findByRole('button', { name: 'Minuman', pressed: false }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).toMatch(/kategori=Minuman/));
    expect(screen.getByRole('button', { name: 'Minuman', pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hapus filter Kategori Minuman' }));
    await waitFor(() => expect(fetchMock.mock.calls.at(-1)?.[0]).not.toMatch(/kategori=/));
  });

  it('hasil kosong mempunyai jalan keluar dengan kata kunci terlampir', async () => {
    fetchMock.mockImplementation((url: string) => url.endsWith('/filter')
      ? ok({ jenis: [], kategori: [], kabupaten_kota: [], terpotong: false })
      : ok({ items: [], next_cursor: null }));
    render(<Katalog />);
    // Katalog yang belum punya profil sama sekali punya keadaan sendiri: jalan ke petugas dan ajakan mendaftar.
    await screen.findByText('Profil UMKM sedang disiapkan');
    expect(screen.getByRole('link', { name: 'Daftarkan usaha' })).toHaveAttribute('href', '/me/usaha');
    expect(screen.queryByLabelText('Jenis usaha')).toBeNull();
    fireEvent.change(screen.getByLabelText('Kata kunci'), { target: { value: 'pisang' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cari UMKM' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.includes('q=pisang'))).toBe(true));
    expect(await screen.findByText('Belum ada profil yang cocok')).toBeTruthy();
    expect(screen.getByText(/Tidak ada profil untuk/)).toHaveTextContent('pisang');
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
    fetchMock.mockImplementation((url: string) => url.endsWith('/serupa') ? ok({ items: [] })
      : url.endsWith('/suka') ? ok({ suka_saya: false })
        : ok({ ...card, foto: [], instagram: 'https://instagram.com/kopi', tiktok: null,
          telemetri_opsional_aktif: false, statistik_mulai_pada: null,
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
