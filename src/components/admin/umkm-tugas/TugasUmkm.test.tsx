// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Detail } from '@/lib/umkm-katalog/types';
import TugasUmkm from './TugasUmkm';
import { renderToString } from 'react-dom/server';

const id = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const initial: Detail = {
  id, jenis: 'profil', nama: 'Keripik Pisang Sari', status: 'diajukan', versi: 1, mendesak: false,
  dibuat_pada: '2026-11-09T02:00:00Z', petugas_id: 'staf', petugas_nama: 'Sari', tanpa_nomor: false,
  peringatan_kontak: [], dipegang_saya: true, sumber: 'satudata', sumber_ref: null,
  revisi: { id: 'revisi', profil_id: id, versi: 1, nama: 'Keripik Pisang Sari', deskripsi: 'Keripik pisang renyah', alamat: null,
    jenis: 'Produk', kategori: 'Makanan Olahan', spesifik: null, kabupaten_kota: 'Kota Bandar Lampung', memiliki_nib: null,
    instagram: null, tiktok: null, kecamatan: null, nama_pemilik: null, bentuk_usaha: null, tahun_mulai: null, omzet_rentang: null, tenaga_kerja_rentang: null,
    dibuat_oleh: 'staf', dibuat_pada: '2026-11-09T02:00:00Z', keputusan: null },
  foto: [], produk: [], izin_status: null,
};
const ok = (data: unknown) => Promise.resolve({ ok: true, json: async () => ({ data: structuredClone(data), meta: { request_id: 'uji' } }) });
let fetchMock: ReturnType<typeof vi.fn>;
let current: Detail;
beforeEach(() => {
  current = structuredClone(initial);
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.endsWith('/kontak')) return ok({ nomor: '081299998888' });
    if (init?.method === 'POST') {
      const payload = JSON.parse(String(init.body));
      if (url.endsWith('/putusan')) {
        current.status = payload.keputusan;
        current.revisi.keputusan = payload.keputusan;
      }
      if (url.endsWith('/visibilitas')) {
        if (payload.foto_id) current.foto = current.foto.map((photo) => photo.id === payload.foto_id ? { ...photo, tersembunyi: payload.aksi === 'sembunyikan', perlu_review: true } : photo);
        else current.status = payload.aksi === 'sembunyikan' ? 'disembunyikan' : 'diajukan';
      }
      current = { ...current, versi: current.versi + 1, dipegang_saya: true };
      return ok({ id, versi: current.versi, status: current.status });
    }
    if (url === `/api/admin/umkm-tugas/${id}`) return ok(current);
    if (url === `/api/admin/umkm-tugas/${other}`) return ok({ ...initial, id: other, nama: 'Kopi Lampung', revisi: { ...initial.revisi, nama: 'Kopi Lampung' } });
    return ok({ items: [current, { ...initial, id: other, nama: 'Kopi Lampung' }]
      .filter((task) => task.revisi.keputusan === null || task.mendesak), next_cursor: null });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const open = async () => { fireEvent.click(await screen.findByRole('button', { name: `Periksa ${initial.nama}` })); await screen.findByRole('heading', { name: initial.nama }); };

describe('layar tugas UMKM', () => {
  it('menampilkan memuat kemudian daftar urut dari server tanpa prefetch nomor', async () => {
    render(<TugasUmkm />);
    expect(screen.getByText('Memuat tugas UMKM...')).toBeTruthy();
    await screen.findByRole('button', { name: `Periksa ${initial.nama}` });
    expect(screen.getAllByRole('listitem')[0].textContent).toContain(initial.nama);
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/umkm-tugas', expect.objectContaining({ cache: 'no-store' }));
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/kontak'))).toBe(false);
  });
  it('daftar kosong tetap menyediakan tambah profil', async () => {
    fetchMock.mockImplementation(() => ok({ items: [], next_cursor: null }));
    render(<TugasUmkm />);
    await screen.findByText('Belum ada tugas UMKM');
    expect(screen.getByRole('button', { name: 'Tambah profil' })).toBeTruthy();
  });
  it.each([[503, 'MODUL_BELUM_TERSEDIA', 'Tugas UMKM belum tersedia'], [403, 'DILARANG', 'Belum memiliki izin pemeriksa'], [401, 'LOGIN_DIPERLUKAN', 'Belum memiliki izin pemeriksa']] as const)('state %s bermakna', async (status, code, text) => {
    fetchMock.mockResolvedValue({ ok: false, status, json: async () => ({ error: { code, message: 'detail internal tidak ditampilkan' } }) });
    render(<TugasUmkm />);
    await screen.findByText(text, { exact: status === 503 });
    expect(screen.queryByText('detail internal tidak ditampilkan')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tambah profil' })).toBeNull();
  });
  it('galat jaringan punya coba lagi dan offline diumumkan', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    render(<TugasUmkm />);
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /Coba lagi/i })).toBeTruthy();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    fireEvent(window, new Event('offline'));
    expect(screen.getByText('Sedang offline')).toBeTruthy();
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });
  it('peringatan DB di dekat data menghalangi terbit, tanpa WhatsApp dan NIB tidak menghalangi', async () => {
    current = { ...current, tanpa_nomor: true, peringatan_kontak: ['nama', 'foto'] };
    render(<TugasUmkm />); await open();
    expect(screen.getByRole('button', { name: 'Terbitkan' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText('Informasi kontak ditemukan. Bersihkan bagian ini sebelum menerbitkan.')).toHaveLength(2);
    expect(screen.getByText('Belum ada nomor WhatsApp. Profil tetap dapat diterbitkan.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar' }));
    current = { ...current, peringatan_kontak: [] };
    await open();
    expect(screen.getByRole('button', { name: 'Terbitkan' })).toHaveProperty('disabled', false);
  });
  it.each(['terbit', 'ditolak'] as const)('keputusan %s mengeluarkan profil dari antrean', async (decision) => {
    render(<TugasUmkm />); await open();
    if (decision === 'ditolak') {
      fireEvent.click(screen.getByRole('button', { name: 'Tolak' }));
      const reason = screen.getByRole('textbox', { name: /Alasan tolak/ });
      expect(document.activeElement).toBe(reason);
      expect(screen.getAllByRole('textbox')).toHaveLength(1);
      fireEvent.change(reason, { target: { value: 'Foto perlu diganti' } });
      fireEvent.click(screen.getByRole('button', { name: 'Kirim penolakan' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'Terbitkan' }));
    await screen.findByRole('button', { name: 'Periksa Kopi Lampung' });
    expect(screen.queryByRole('button', { name: `Periksa ${initial.nama}` })).toBeNull();
    const decisions = fetchMock.mock.calls.filter(([url]) => url.endsWith('/putusan'));
    expect(decisions).toHaveLength(1);
    expect(JSON.parse(decisions[0][1].body).keputusan).toBe(decision);
  });
  it('tugas rekan diambil alih satu klik lalu izin dicatat satu klik', async () => {
    current = { ...current, dipegang_saya: false, petugas_nama: 'Budi' };
    render(<TugasUmkm />); await open();
    expect(screen.getByText('sedang dipegang Budi')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Lihat nomor' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ambil alih' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Izin diberikan' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => url.endsWith('/izin') && JSON.parse(init.body).status === 'diberikan')).toBe(true));
  });
  it('nomor hilang saat kembali dan tidak ikut ke tugas berikutnya', async () => {
    render(<TugasUmkm />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Lihat nomor' }));
    const node = await screen.findByText('081299998888');
    fireEvent.click(screen.getByRole('button', { name: 'Kembali ke daftar' }));
    expect(node.textContent).toBe('');
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    await screen.findByRole('heading', { name: 'Kopi Lampung' });
    expect(screen.queryByText('081299998888')).toBeNull();
  });
  it('konflik versi meminta muat ulang tanpa mengulangi keputusan', async () => {
    render(<TugasUmkm />); await open();
    const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation((url, init) => url.endsWith('/putusan') ? Promise.resolve({ ok: false, status: 409, json: async () => ({ error: { code: 'KONFLIK_VERSI' } }) }) : original(url, init));
    fireEvent.click(screen.getByRole('button', { name: 'Terbitkan' }));
    await screen.findByText(/Tugas berubah atau telah diambil/);
    fireEvent.click(screen.getByRole('button', { name: 'Muat ulang tugas' }));
    await screen.findByRole('heading', { name: initial.nama });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/putusan'))).toHaveLength(1);
  });
  it('pratinjau foto privat dan sembunyikan/pulihkan memakai versi terbaru', async () => {
    current.foto = [{ id: 'foto1', revisi_id: 'revisi', asal: 'unggahan', url: null, r2_key: 'umkm-draf/foto.jpg', tersembunyi: false, perlu_review: true, utama: false, produk_urutan: null, diperiksa_oleh: null, diperiksa_pada: null }];
    render(<TugasUmkm />); await open();
    expect(screen.getByRole('img', { name: /Foto 1/ }).getAttribute('src')).toBe(`/api/admin/umkm-tugas/${id}/foto/foto1`);
    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan foto 1' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Pulihkan foto 1' }));
    await screen.findByRole('button', { name: 'Sembunyikan foto 1' });
    const payloads = fetchMock.mock.calls.filter(([url]) => url.endsWith('/visibilitas')).map(([, init]) => JSON.parse(init.body));
    expect(payloads.map((x) => [x.aksi, x.foto_id, x.expected_version])).toEqual([['sembunyikan', 'foto1', 1], ['pulihkan', 'foto1', 2]]);
  });
  it('profil dipulihkan ke pemeriksaan sebelum bisa terbit', async () => {
    render(<TugasUmkm />); await open();
    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan profil' }));
    const restore = await screen.findByRole('button', { name: 'Pulihkan profil' });
    expect(screen.getByRole('button', { name: 'Terbitkan' })).toHaveProperty('disabled', true);
    fireEvent.click(restore);
    await screen.findByRole('button', { name: 'Sembunyikan profil' });
    expect(screen.getByRole('button', { name: 'Terbitkan' })).toHaveProperty('disabled', false);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/putusan'))).toHaveLength(0);
  });
  it('halaman berikut meminta cursor dari server tanpa mengumpulkan semua data', async () => {
    const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<unknown>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => url === '/api/admin/umkm-tugas'
      ? ok({ items: [current], next_cursor: id }) : original(url, init));
    render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Halaman berikutnya' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/admin/umkm-tugas?cursor=${id}`, expect.objectContaining({ cache: 'no-store' })));
  });

  it('snapshot server konsisten saat browser offline sehingga hidrasi tidak berbeda', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const html = renderToString(<TugasUmkm />);
    expect(html).toContain('Memuat tugas UMKM');
    expect(html).not.toContain('Sedang offline');
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  });

});
