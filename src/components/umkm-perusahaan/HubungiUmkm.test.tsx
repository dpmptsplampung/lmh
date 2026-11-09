// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProfilKatalog from '@/components/umkm-katalog/ProfilKatalog';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const id = '10000000-0000-4000-8000-000000000001';
const profil = {
  id, nama: 'Kopi Lampung', deskripsi: 'Kopi hasil kebun', jenis: 'Produk', kategori: 'Minuman', spesifik: null,
  kabupaten_kota: 'Lampung Barat', instagram: null, tiktok: null, foto: [], suka: 1, dilihat: null, baru: false,
  telemetri_opsional_aktif: false, statistik_mulai_pada: null,
};
const perusahaan = { id: 'p1', nama: 'PT Maju', jabatan: 'Pembeli', diperiksa: false };
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code } }), { status }));
type Rute = (url: string, init?: RequestInit) => Promise<Response> | undefined;
let rute: Rute;
let fetchMock: ReturnType<typeof vi.fn>;
const panggilan = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);

beforeEach(() => {
  rute = () => undefined;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const khusus = rute(url, init);
    if (khusus) return khusus;
    if (url.endsWith(`/${id}`)) return ok(profil);
    return galat('MODUL_BELUM_TERSEDIA', 503);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('profil katalog dengan tahap B', () => {
  it('tahap B belum aktif: halaman sama dengan tahap A, tanpa tombol Hubungi UMKM', async () => {
    render(<ProfilKatalog id={id} />);
    await screen.findByRole('heading', { name: 'Kopi Lampung' });
    await waitFor(() => expect(panggilan()).toContain('GET /api/umkm-katalog/perusahaan'));
    expect(screen.queryByText('Hubungi UMKM')).toBeNull();
    expect(screen.getByText(/Tekan Hubungi lewat petugas untuk mengisi formulir singkat/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hubungi lewat petugas' })).toBeTruthy();
  });

  it('tahap B aktif, belum masuk: teks tahap B dan tautan ke login dengan kembali ke profil', async () => {
    rute = (url) => url.endsWith('/perusahaan') ? ok({ masuk: false, perusahaan: null }) : undefined;
    render(<ProfilKatalog id={id} />);
    const tautan = await screen.findByRole('link', { name: 'Hubungi UMKM' });
    expect(tautan.getAttribute('href')).toBe(`/login?next=${encodeURIComponent(`/umkm/katalog/${id}`)}`);
    expect(screen.getByText(/Bila disetujui petugas, nomor tampil di akun Anda/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hubungi lewat petugas' })).toBeTruthy();
  });

  it('masuk tanpa data perusahaan: mengisi data sekali, memilih Kebutuhan baru, lalu mengirim', async () => {
    let tersimpan = false;
    rute = (url, init) => {
      const metode = init?.method ?? 'GET';
      if (url.endsWith('/perusahaan') && metode === 'GET') {
        return ok({ masuk: true, perusahaan: tersimpan ? perusahaan : null });
      }
      if (url.endsWith('/perusahaan')) { tersimpan = true; return ok(perusahaan); }
      if (url.endsWith('/kebutuhan') && metode === 'GET') return ok({ items: [], next_cursor: null });
      if (url.endsWith('/filter')) {
        return ok({ jenis: [], kategori: ['Minuman'], kabupaten_kota: ['Lampung Barat'], terpotong: false });
      }
      if (url.endsWith('/kebutuhan')) return ok({ id: 'k1', teks: 'Kopi 50 kg', kategori: 'Minuman' });
      if (url.endsWith('/permintaan')) {
        return ok({ items: [{ id: 'r1', profil_id: id, kode: 'ABC', status: 'diajukan', versi: 1 }] });
      }
      return undefined;
    };
    render(<ProfilKatalog id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hubungi UMKM' }));
    fireEvent.change(await screen.findByLabelText(/Nama perusahaan/), { target: { value: 'PT Maju' } });
    fireEvent.change(screen.getByLabelText(/Jabatan Anda/), { target: { value: 'Pembeli' } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Simpan data perusahaan' }));
    fireEvent.change(await screen.findByLabelText(/^Kebutuhan/), { target: { value: 'Kopi 50 kg' } });
    fireEvent.change(screen.getByLabelText(/^Kategori/), { target: { value: 'Minuman' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kirim permintaan' }));
    expect(await screen.findByText(/Permintaan diterima pada/)).toBeTruthy();
    const kirimPermintaan = fetchMock.mock.calls.find(([url, init]) =>
      url.endsWith('/permintaan') && init?.method === 'POST');
    const body = JSON.parse(kirimPermintaan?.[1]?.body as string);
    expect(body).toMatchObject({ kebutuhan_id: 'k1', profil_ids: [id] });
    expect(body.operasi_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByRole('link', { name: 'Lihat permintaan saya' }).getAttribute('href')).toBe('/me/umkm');
  });

  it('memakai Kebutuhan yang sudah ada tanpa membuat Kebutuhan baru', async () => {
    rute = (url, init) => {
      const metode = init?.method ?? 'GET';
      if (url.endsWith('/perusahaan')) return ok({ masuk: true, perusahaan });
      if (url.endsWith('/kebutuhan') && metode === 'GET') {
        return ok({ items: [{ id: 'k9', teks: 'Gula aren', kategori: 'Makanan', kabupaten_kota: null,
          status: 'aktif', dibuat_pada: '2026-11-01T00:00:00Z' }], next_cursor: null });
      }
      if (url.endsWith('/filter')) return ok({ jenis: [], kategori: [], kabupaten_kota: [], terpotong: false });
      if (url.endsWith('/permintaan')) return ok({ items: [] });
      return undefined;
    };
    render(<ProfilKatalog id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hubungi UMKM' }));
    await screen.findByText(/Gula aren/);
    fireEvent.click(screen.getByRole('button', { name: 'Kirim permintaan' }));
    await screen.findByText(/Permintaan diterima pada/);
    expect(panggilan()).not.toContain('POST /api/umkm-katalog/kebutuhan');
  });
  it('Kebutuhan aktif di halaman berikutnya bisa dipilih lewat Muat lebih banyak (K02)', async () => {
    const tutup = { id: 'k0', teks: 'Lama', kategori: 'Makanan', kabupaten_kota: null, status: 'ditutup',
      dibuat_pada: '2026-11-08T00:00:00Z' };
    rute = (url, init) => {
      const metode = init?.method ?? 'GET';
      if (url.endsWith('/perusahaan')) return ok({ masuk: true, perusahaan });
      if (url.includes('/kebutuhan?cursor=c2') && metode === 'GET') {
        return ok({ items: [{ ...tutup, id: 'k7', teks: 'Gula aren', status: 'aktif' }], next_cursor: null });
      }
      if (url.endsWith('/kebutuhan') && metode === 'GET') return ok({ items: [tutup], next_cursor: 'c2' });
      if (url.endsWith('/filter')) return ok({ jenis: [], kategori: [], kabupaten_kota: [], terpotong: false });
      if (url.endsWith('/permintaan')) return ok({ items: [] });
      return undefined;
    };
    render(<ProfilKatalog id={id} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hubungi UMKM' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Muat lebih banyak' }));
    await screen.findByText(/Gula aren/);
    expect(screen.queryByRole('button', { name: 'Muat lebih banyak' })).toBeNull();
    expect(panggilan()).toContain('GET /api/umkm-katalog/kebutuhan?cursor=c2');
  });
});
