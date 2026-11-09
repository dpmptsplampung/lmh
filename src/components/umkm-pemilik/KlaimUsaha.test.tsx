// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilKatalog from '@/components/umkm-katalog/ProfilKatalog';
import KlaimUsaha from './KlaimUsaha';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const id = '10000000-0000-4000-8000-000000000001';
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data, meta: { request_id: 'req-1' } }), { status: 200 }));
let fetchMock: ReturnType<typeof vi.fn>;
let balasanKlaim: () => Promise<Response>;
let tahap: () => Promise<Response>;
const kirimanKlaim = () => fetchMock.mock.calls.filter(([u]) => u === '/api/umkm-pemilik/klaim');
const tombol = () => screen.findByRole('button', { name: 'Ini usaha saya' });
beforeEach(() => {
  balasanKlaim = () => ok({ id: 'k1', jenis: 'klaim', profil_id: id, status: 'diajukan', versi: 1 });
  tahap = () => ok({ aktif: true });
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === '/api/umkm-pemilik/tahap') return tahap();
    if (url === '/api/umkm-pemilik/klaim') return balasanKlaim();
    if (url.endsWith(`/${id}`)) return ok({ id, nama: 'Kopi Lampung', jenis: 'Produk', kategori: 'Minuman', spesifik: null,
      kabupaten_kota: 'Lampung Barat', deskripsi: 'Kopi kebun', foto: [], suka: 1, dilihat: null, baru: false,
      instagram: null, tiktok: null, telemetri_opsional_aktif: false, statistik_mulai_pada: null });
    void init;
    return Promise.resolve(new Response(JSON.stringify({ error: { code: 'MODUL_BELUM_TERSEDIA', message: 'x' }, request_id: 'req-1' }), { status: 503 }));
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('klaim usaha', () => {
  it('profil katalog menampilkan tombol kecil Ini usaha saya', async () => {
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { name: 'Kopi Lampung' });
    expect(await tombol()).toBeTruthy();
  });

  it('tombol tersembunyi bila tahap C belum aktif (503)', async () => {
    tahap = () => Promise.resolve(new Response(JSON.stringify({
      error: { code: 'MODUL_BELUM_TERSEDIA', message: 'x' }, request_id: 'req-1' }), { status: 503 }));
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { name: 'Kopi Lampung' });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u === '/api/umkm-pemilik/tahap')).toBe(true));
    expect(screen.queryByRole('button', { name: 'Ini usaha saya' })).toBeNull();
  });

  it('klaim yang langsung disetujui menampilkan profil sudah terhubung', async () => {
    balasanKlaim = () => ok({ id: 'k1', jenis: 'klaim', profil_id: id, status: 'disetujui', versi: 1 });
    render(<KlaimUsaha profilId={id} profilNama="Kopi Lampung" />);
    fireEvent.click(await tombol());
    fireEvent.change(await screen.findByLabelText('Alasan singkat'), { target: { value: 'Saya pemilik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim klaim' }));
    expect(await screen.findByText('Profil ini sudah terhubung ke akun Anda')).toBeTruthy();
  });

  it('alasan wajib; klaim terkirim dengan alasan dan kunci operasi, lalu mengarahkan ke Usaha saya', async () => {
    render(<KlaimUsaha profilId={id} profilNama="Kopi Lampung" />);
    fireEvent.click(await tombol());
    fireEvent.click(await screen.findByRole('button', { name: 'Kirim klaim' }));
    expect(await screen.findByText('Alasan wajib diisi.')).toBeTruthy();
    expect(kirimanKlaim()).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Alasan singkat'), { target: { value: 'Saya pemilik kebun' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim klaim' }));
    await waitFor(() => expect(kirimanKlaim()).toHaveLength(1));
    const body = JSON.parse(kirimanKlaim()[0][1].body);
    expect(body).toMatchObject({ profil_id: id, alasan: 'Saya pemilik kebun' });
    expect(body.operasi_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('link', { name: 'Lihat Usaha saya' })).toHaveAttribute('href', '/me/usaha');
  });

  it('belum login (401) menawarkan Masuk', async () => {
    balasanKlaim = () => Promise.resolve(new Response(JSON.stringify({ error: { code: 'LOGIN_DIPERLUKAN', message: 'x' }, request_id: 'req-1' }), { status: 401 }));
    render(<KlaimUsaha profilId={id} profilNama="Kopi Lampung" />);
    fireEvent.click(await tombol());
    fireEvent.change(await screen.findByLabelText('Alasan singkat'), { target: { value: 'Pemilik' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim klaim' }));
    const masuk = await screen.findByRole('link', { name: 'Masuk' });
    expect(masuk.getAttribute('href')).toBe(`/login?next=${encodeURIComponent(`/umkm/katalog/${id}`)}`);
  });

  it('alasan memuat kontak (400) menampilkan pesan khusus klaim', async () => {
    balasanKlaim = () => Promise.resolve(new Response(JSON.stringify({
      error: { code: 'INPUT_TIDAK_VALID', message: 'x' }, request_id: 'req-1' }), { status: 400 }));
    render(<KlaimUsaha profilId={id} profilNama="Kopi Lampung" />);
    fireEvent.click(await tombol());
    fireEvent.change(await screen.findByLabelText('Alasan singkat'), { target: { value: 'Hubungi saya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim klaim' }));
    expect(await screen.findByText(/tidak boleh memuat nomor telepon atau email/)).toBeTruthy();
  });
});
