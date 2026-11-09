// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UsahaSaya from './UsahaSaya';

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data, meta: { request_id: 'req-1' } }), { status: 200 }));
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code, message: 'x' }, request_id: 'req-1' }), { status }));
const usaha = (ekstra = {}) => ({
  id: '10000000-0000-4000-8000-000000000001', profil_nama: 'Kopi Lampung', status: 'terbit', versi: 3,
  pemilik_id: 'pm1', pemilik_status: 'disetujui', dibuat_pada: '2026-11-05T03:00:00Z',
  alasan_tolak: null, catatan_petugas: null, memiliki_nib: true, perubahan: null, ...ekstra,
});
let fetchMock: ReturnType<typeof vi.fn>;
let daftar: unknown[];
let respons: (() => Promise<Response>) | null;
beforeEach(() => {
  daftar = []; respons = null;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return ok({ id: 'baru', versi: 1, status: 'diajukan', revisi_id: 'r1', pemilik_id: 'p', pemilik_status: 'diajukan' });
    return respons ? respons() : ok({ items: daftar, next_cursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

describe('daftar Usaha saya', () => {
  it('belum masuk mengarahkan ke login dan 503 memberi keadaan tenang', async () => {
    respons = () => galat('LOGIN_DIPERLUKAN', 401);
    render(<UsahaSaya />);
    const masuk = await screen.findByRole('link', { name: 'Masuk' });
    expect(masuk.getAttribute('href')).toBe('/login?next=%2Fme%2Fusaha');
    cleanup();
    respons = () => galat('MODUL_BELUM_TERSEDIA', 503);
    render(<UsahaSaya />);
    expect(await screen.findByText(/belum dibuka/)).toBeTruthy();
  });

  it('menampilkan status ajuan dengan tanggal, catatan petugas, dan tautan ke detail', async () => {
    daftar = [
      usaha({ pemilik_id: 'a', pemilik_status: 'diajukan', profil_nama: 'Usaha Baru' }),
      usaha({ pemilik_id: 'b', pemilik_status: 'ditolak', profil_nama: 'Usaha Ditolak', catatan_petugas: null, alasan_tolak: 'Bukti kurang' }),
      usaha({ pemilik_id: 'c', status: 'diajukan', profil_nama: 'Usaha Diubah' }),
    ];
    render(<UsahaSaya />);
    expect(await screen.findByText(/Menunggu pemeriksaan, diajukan 2026-11-05/)).toBeTruthy();
    expect(screen.getByText(/Catatan petugas: Bukti kurang/)).toBeTruthy();
    expect(screen.getByText(/Versi lama tetap tampil sampai diperiksa/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Buka Usaha Baru' }).getAttribute('href'))
      .toBe('/me/usaha/10000000-0000-4000-8000-000000000001');
  });

  it('klaim ditolak memakai alasan_tolak bila catatan kosong dan menawarkan Ajukan klaim lagi', async () => {
    daftar = [usaha({ pemilik_status: 'ditolak', profil_nama: 'Usaha Ditolak', alasan_tolak: 'Bukti kurang' }),
      usaha({ pemilik_id: 'd', profil_nama: 'Usaha Sehat' })];
    render(<UsahaSaya />);
    expect(await screen.findByText(/Catatan petugas: Bukti kurang/)).toBeTruthy();
    const tautan = screen.getAllByRole('link', { name: 'Ajukan klaim lagi' });
    expect(tautan).toHaveLength(1);
    expect(tautan[0].getAttribute('href')).toBe('/umkm/katalog/10000000-0000-4000-8000-000000000001');
  });

  it('perubahan menunggu dan ditolak tampil di daftar', async () => {
    daftar = [usaha({ pemilik_id: 'e', perubahan: 'menunggu', profil_nama: 'Usaha E' }),
      usaha({ pemilik_id: 'f', perubahan: 'ditolak', profil_nama: 'Usaha F', catatan_petugas: 'Deskripsi kurang' })];
    render(<UsahaSaya />);
    expect(await screen.findByText('Perubahan menunggu pemeriksaan. Versi lama tetap tampil sampai diperiksa.')).toBeTruthy();
    expect(screen.getByText(/Perubahan belum disetujui\./)).toBeTruthy();
    expect(screen.getByText(/Catatan petugas: Deskripsi kurang/)).toBeTruthy();
  });

  it('keadaan kosong menawarkan daftar usaha dan klaim dari katalog', async () => {
    render(<UsahaSaya />);
    expect(await screen.findByText(/Belum ada usaha/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Daftarkan usaha' })).toBeTruthy();
  });

  it('mendaftarkan usaha tanpa sumber data dan tidak menyimpan nomor di penyimpanan peramban', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const konsol = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<UsahaSaya />);
    fireEvent.click(await screen.findByRole('button', { name: 'Daftarkan usaha' }));
    const isi = (nama: string, nilai: string) => fireEvent.change(screen.getByLabelText(nama), { target: { value: nilai } });
    isi('Nama usaha', 'Kopi Sejahtera'); isi('Jenis', 'Produk'); isi('Kategori', 'Minuman');
    isi('Kabupaten/kota', 'Lampung Barat'); isi('Deskripsi', 'Kopi hasil kebun');
    isi('Nomor WhatsApp (opsional)', '081234567890');
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan usaha' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(url).toBe('/api/umkm-pemilik');
    expect(init.cache).toBe('no-store');
    const body = JSON.parse(init.body);
    expect(body.data.nama).toBe('Kopi Sejahtera');
    expect(body.data).not.toHaveProperty('sumber');
    expect(body.data.nomor).toBe('081234567890');
    expect(setItem).not.toHaveBeenCalled();
    expect(konsol).not.toHaveBeenCalled();
    setItem.mockRestore(); konsol.mockRestore();
  });

  it('data tidak lengkap ditolak di klien tanpa memanggil server', async () => {
    render(<UsahaSaya />);
    fireEvent.click(await screen.findByRole('button', { name: 'Daftarkan usaha' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajukan usaha' }));
    expect(await screen.findByText(/Data belum lengkap/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, i]) => i?.method === 'POST')).toBe(false);
  });
});
