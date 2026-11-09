// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PanelUmkmSaya from './PanelUmkmSaya';

const profilId = '10000000-0000-4000-8000-000000000001';
const perusahaan = { id: 'p1', nama: 'PT Maju', jabatan: 'Pembeli', diperiksa: true };
const permintaan = (status: string, ekstra = {}) => ({
  id: 'r1', kebutuhan_id: 'k1', profil_id: profilId, kode: 'UM-3F9A1C2B7D4E', status, versi: 2,
  dibuat_pada: '2026-11-05T03:00:00Z', alasan_tolak: null, profil_nama: 'Kopi Lampung',
  petugas_nama: 'Sari', petugas_hp_akhir: '4821', tahan_darurat: false, ...ekstra,
});
const kebutuhan = { id: 'k1', teks: 'Kopi 50 kg', kategori: 'Minuman', kabupaten_kota: null,
  status: 'aktif', dibuat_pada: '2026-11-01T03:00:00Z' };
const NOMOR_RAHASIA = '081234567890';
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));
const galat = (code: string, status: number) => Promise.resolve(
  new Response(JSON.stringify({ error: { code } }), { status }));
let daftarPermintaan: unknown[];
let rute: (url: string, metode: string, body: unknown) => Promise<Response> | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
const panggilan = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url}`);

beforeEach(() => {
  daftarPermintaan = [];
  rute = () => undefined;
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const metode = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const khusus = rute(url, metode, body);
    if (khusus) return khusus;
    if (url.endsWith('/perusahaan')) return ok({ masuk: true, perusahaan });
    if (url.endsWith('/kebutuhan')) return ok({ items: [kebutuhan], next_cursor: null });
    if (url.endsWith('/permintaan')) return ok({ items: daftarPermintaan, next_cursor: null });
    return galat('GAGAL_INTERNAL', 500);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); });

describe('halaman UMKM saya', () => {
  it('fitur belum dibuka (503) dan belum masuk memberi keadaan yang jelas', async () => {
    rute = (url) => url.endsWith('/perusahaan') ? galat('MODUL_BELUM_TERSEDIA', 503) : undefined;
    render(<PanelUmkmSaya />);
    expect(await screen.findByText(/belum dibuka/)).toBeTruthy();
    cleanup();
    rute = (url) => url.endsWith('/perusahaan') ? ok({ masuk: false, perusahaan: null }) : undefined;
    render(<PanelUmkmSaya />);
    const masuk = await screen.findByRole('link', { name: 'Masuk' });
    expect(masuk.getAttribute('href')).toBe('/login?next=%2Fme%2Fumkm');
  });

  it('menampilkan status, tanggal, kode, nama petugas dan empat angka terakhir, tanpa mengambil nomor', async () => {
    daftarPermintaan = [permintaan('nomor_dibuka'), permintaan('ditolak', { id: 'r2', alasan_tolak: 'Data kurang' }),
      permintaan('menunggu_izin', { id: 'r3' })];
    render(<PanelUmkmSaya />);
    await screen.findByText('Nomor dibuka');
    expect(screen.getAllByText(/Kode UM-3F9A1C2B7D4E/).length).toBe(3);
    expect(screen.getAllByText(/5 November 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Petugas: Sari, HP berakhiran 4821/).length).toBe(3);
    expect(screen.getByText(/Alasan: Data kurang/)).toBeTruthy();
    expect(screen.getByText('Menunggu konfirmasi UMKM')).toBeTruthy();
    expect(panggilan().some((p) => p.includes('/nomor'))).toBe(false);
    expect(document.body.textContent).not.toContain(NOMOR_RAHASIA);
  });

  it('nomor diambil hanya saat Tampilkan nomor ditekan, dengan peringatan, dan tidak disimpan', async () => {
    daftarPermintaan = [permintaan('nomor_dibuka')];
    rute = (url) => url.endsWith('/r1/nomor') ? ok({ nomor: NOMOR_RAHASIA, petugas_nama: 'Sari',
      dibuka_pada: '2026-11-06T03:00:00Z', kode: 'UM-3F9A1C2B7D4E' }) : undefined;
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const konsol = vi.spyOn(console, 'log').mockImplementation(() => {});
    render(<PanelUmkmSaya />);
    await screen.findByRole('button', { name: 'Tampilkan nomor' });
    expect(panggilan().filter((p) => p.endsWith('/nomor'))).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Tampilkan nomor' }));
    expect(await screen.findByText(NOMOR_RAHASIA)).toBeTruthy();
    expect(panggilan().filter((p) => p.endsWith('/nomor'))).toEqual(['GET /api/umkm-katalog/permintaan/r1/nomor']);
    expect(fetchMock.mock.calls.find(([u]) => u.endsWith('/nomor'))?.[1]?.cache).toBe('no-store');
    expect(screen.getByText(/DPMPTSP tidak menjamin transaksi; jangan mengirim uang/)).toBeTruthy();
    expect(screen.getByText(/Sebutkan kode UM-3F9A1C2B7D4E/)).toBeTruthy();
    expect(setItem).not.toHaveBeenCalled();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
    expect(konsol).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain(NOMOR_RAHASIA);
    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan nomor' }));
    expect(screen.queryByText(NOMOR_RAHASIA)).toBeNull();
    setItem.mockRestore(); konsol.mockRestore();
  });

  it('nomor ditolak server: teks tidak lagi ditampilkan dengan tautan ke formulir', async () => {
    daftarPermintaan = [permintaan('nomor_dibuka')];
    rute = (url) => url.endsWith('/r1/nomor') ? galat('NOMOR_TIDAK_TERSEDIA', 409) : undefined;
    render(<PanelUmkmSaya />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tampilkan nomor' }));
    expect(await screen.findByText(/Nomor Kopi Lampung tidak lagi ditampilkan/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'formulir Hubungi lewat petugas' }).getAttribute('href'))
      .toBe(`/umkm/katalog/${profilId}`);
    expect(screen.queryByRole('button', { name: 'Tampilkan nomor' })).toBeNull();
  });

  it('membatalkan permintaan sebelum nomor dibuka; tombol batal tidak ada sesudahnya', async () => {
    daftarPermintaan = [permintaan('diajukan'), permintaan('nomor_dibuka', { id: 'r9' })];
    rute = (url, metode) => metode === 'POST' && url.endsWith('/r1/batal')
      ? ok({ id: 'r1', status: 'dibatalkan' }) : undefined;
    render(<PanelUmkmSaya />);
    const tombol = await screen.findAllByRole('button', { name: 'Batalkan permintaan' });
    expect(tombol).toHaveLength(1);
    fireEvent.click(tombol[0]);
    await screen.findByText('Dibatalkan');
    expect(panggilan()).toContain('POST /api/umkm-katalog/permintaan/r1/batal');
    expect(screen.queryByRole('button', { name: 'Batalkan permintaan' })).toBeNull();
  });

  it('Kebutuhan: rekomendasi, tambah satu klik, dan tutup', async () => {
    rute = (url, metode, body) => {
      if (url.endsWith('/k1/rekomendasi')) return ok({ items: [{ id: profilId, nama: 'Kopi Lampung',
        kategori: 'Minuman', kabupaten_kota: 'Lampung Barat' }] });
      if (metode === 'POST' && url.endsWith('/permintaan')) {
        expect(body).toMatchObject({ kebutuhan_id: 'k1', profil_ids: [profilId] });
        return ok({ items: [{ id: 'r1', profil_id: profilId, kode: 'X', status: 'diajukan', versi: 1 }] });
      }
      if (metode === 'POST' && url.endsWith('/k1/tutup')) return ok({ id: 'k1', status: 'ditutup' });
      return undefined;
    };
    render(<PanelUmkmSaya />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lihat rekomendasi UMKM' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Hubungi Kopi Lampung' }));
    expect(await screen.findByText('Ditambahkan ke permintaan Anda.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tutup Kebutuhan' }));
    await waitFor(() => expect(screen.getByText(/Ditutup/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Tutup Kebutuhan' })).toBeNull();
  });

  it('kode tautan: pesan sukses dan gagal tenang tanpa sebab rinci', async () => {
    rute = (url, metode, body) => {
      if (metode === 'POST' && url.endsWith('/tautkan')) {
        return (body as { kode: string }).kode === 'AAAA-BBBB-CCCC'
          ? ok({ id: 'r1', kebutuhan_id: 'k1', status: 'diajukan' }) : galat('KODE_TIDAK_VALID', 409);
      }
      return undefined;
    };
    render(<PanelUmkmSaya />);
    const isian = await screen.findByLabelText(/Kode dari petugas/);
    fireEvent.change(isian, { target: { value: 'SALAH' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pakai kode' }));
    const gagal = await screen.findByRole('alert');
    expect(gagal.textContent).toMatch(/Kode belum dapat dipakai/);
    expect(gagal.textContent).not.toMatch(/kedaluwarsa|sudah dipakai|hash/i);
    fireEvent.change(isian, { target: { value: 'AAAA-BBBB-CCCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pakai kode' }));
    expect((await screen.findByText(/Kode diterima/)).textContent).toMatch(/daftar Anda/);
    expect(within(document.body).getByText('Punya kode dari petugas?')).toBeTruthy();
  });

  it('sesudah kode tertaut, daftar Kebutuhan dan Permintaan sama-sama dimuat ulang (K04)', async () => {
    let tertaut = false;
    rute = (url, metode) => {
      if (metode === 'POST' && url.endsWith('/tautkan')) { tertaut = true; return ok({ id: 'r1' }); }
      if (metode === 'GET' && url.endsWith('/kebutuhan')) {
        return ok({ items: tertaut ? [kebutuhan] : [], next_cursor: null });
      }
      if (metode === 'GET' && url.endsWith('/permintaan')) {
        return ok({ items: tertaut ? [permintaan('diajukan')] : [], next_cursor: null });
      }
      return undefined;
    };
    render(<PanelUmkmSaya />);
    await screen.findByText(/Belum ada Kebutuhan/);
    fireEvent.change(await screen.findByLabelText(/Kode dari petugas/), { target: { value: 'AAAA-BBBB-CCCC' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pakai kode' }));
    expect(await screen.findByRole('heading', { name: 'Kopi 50 kg' })).toBeTruthy();
    expect(await screen.findByText(/Kode UM-3F9A1C2B7D4E/)).toBeTruthy();
    expect(screen.queryByText(/Belum ada Kebutuhan/)).toBeNull();
  });

  it('Kebutuhan ditutup: panel rekomendasi dan tombol tambah ikut hilang (K06)', async () => {
    rute = (url, metode) => {
      if (url.endsWith('/k1/rekomendasi')) return ok({ items: [{ id: profilId, nama: 'Kopi Lampung',
        kategori: 'Minuman', kabupaten_kota: null }] });
      if (metode === 'POST' && url.endsWith('/k1/tutup')) return ok({ id: 'k1', status: 'ditutup' });
      return undefined;
    };
    render(<PanelUmkmSaya />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lihat rekomendasi UMKM' }));
    await screen.findByRole('button', { name: 'Hubungi Kopi Lampung' });
    fireEvent.click(screen.getByRole('button', { name: 'Tutup Kebutuhan' }));
    await waitFor(() => expect(screen.getByText(/Ditutup/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Hubungi Kopi Lampung' })).toBeNull();
    expect(screen.queryByLabelText('Rekomendasi untuk Kopi 50 kg')).toBeNull();
  });
});
