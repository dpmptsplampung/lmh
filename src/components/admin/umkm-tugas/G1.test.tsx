// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Detail, Foto } from '@/lib/umkm-katalog/types';
import ProfilForm from './ProfilForm';
import DetailTugas from './DetailTugas';
import TugasUmkm from './TugasUmkm';

const id = '10000000-0000-4000-8000-000000000001';
const initial: Detail = {
  id, jenis: 'profil', nama: 'Kopi Lampung', status: 'diajukan', versi: 1, mendesak: false,
  dibuat_pada: '2026-11-09T02:00:00Z', petugas_id: 'staf', petugas_nama: 'Sari', tanpa_nomor: false,
  peringatan_kontak: [], dipegang_saya: true, sumber: 'kurasi', sumber_ref: null,
  revisi: {
    id: 'revisi', profil_id: id, versi: 1, nama: 'Kopi Lampung', deskripsi: 'Kopi bubuk', alamat: null,
    jenis: 'Minuman', kategori: 'Kopi', spesifik: null, kabupaten_kota: 'Lampung Barat', memiliki_nib: null,
    instagram: null, tiktok: null, dibuat_oleh: 'staf', dibuat_pada: '2026-11-09T02:00:00Z', keputusan: null,
  },
  foto: [], izin_status: null,
};
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data: structuredClone(data) }) });
const photo = (index: number): Foto => ({
  id: `foto${index}`, revisi_id: 'revisi', asal: 'eksternal',
  url: `https://foto.example/${index ? `bersih${index}` : '081299998888'}.jpg`, r2_key: null,
  tersembunyi: false, perlu_review: true, diperiksa_oleh: null, diperiksa_pada: null,
});
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ok({ id, versi: 2, status: 'diajukan' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([1, 10])('mengeluarkan foto bermasalah dari %s foto dan mengirim daftar revisi lengkap', async (count) => {
  const detail = { ...initial, foto: Array.from({ length: count }, (_, i) => photo(i)),
    peringatan_kontak: ['foto'] };
  const saved = vi.fn();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const warnings = body.data.foto.some((f: { url?: string }) => f.url?.includes('081299998888'))
      ? ['foto'] : [];
    return ok({ id, versi: 2, status: 'diajukan', peringatan_kontak: warnings });
  });
  render(<ProfilForm detail={detail} onSaved={saved} onCancel={vi.fn()} />);
  expect(screen.getAllByRole('button', { name: /Keluarkan foto/ })).toHaveLength(count);
  fireEvent.click(screen.getByRole('button', { name: 'Keluarkan foto 1' }));
  fireEvent.change(screen.getByLabelText('Tambah tautan foto HTTPS'), {
    target: { value: 'https://foto.example/pengganti.jpg' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ peringatan_kontak: [] })));
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.data.foto).toHaveLength(count);
  expect(body.data.foto.map((f: { url: string }) => f.url)).not.toContain(detail.foto[0].url);
  expect(body.data.foto.slice(0, -1)).toEqual(detail.foto.slice(1).map(({ asal, url, r2_key }) =>
    ({ asal, url, r2_key })));
  expect(detail.foto).toHaveLength(count);
});

it('mengirim foto kosong bila seluruh foto dikeluarkan', async () => {
  const saved = vi.fn();
  render(<ProfilForm detail={{ ...initial, foto: [photo(0)] }} onSaved={saved} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Keluarkan foto 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).data.foto).toEqual([]);
});

it('menjaga fokus keyboard saat foto tengah, terakhir, dan seluruh foto dikeluarkan', () => {
  render(<ProfilForm detail={{ ...initial, foto: [photo(1), photo(2), photo(3)] }}
    onSaved={vi.fn()} onCancel={vi.fn()} />);
  const remove = (index: number) => {
    const button = screen.getByRole('button', { name: `Keluarkan foto ${index}` });
    button.focus();
    fireEvent.click(button);
  };
  remove(2);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keluarkan foto 2' }));
  remove(2);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keluarkan foto 1' }));
  remove(1);
  expect(document.activeElement).toBe(screen.getByLabelText('Tambah tautan foto HTTPS'));
});

it.each(['terbit', 'ditolak'] as const)('revisi %s menyediakan koreksi, visibilitas dan izin tanpa keputusan ulang',
  (status) => {
    render(<DetailTugas detail={{ ...initial, status, revisi: { ...initial.revisi, keputusan: status } }}
      onChanged={vi.fn()} onEdit={vi.fn()} onBack={vi.fn()} onRefresh={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Terbitkan' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Tolak' })).toBeNull();
    for (const name of ['Perbaiki data', 'Sembunyikan profil', 'Izin diberikan', 'Izin dicabut']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

it('form mengulang kunci sesudah commit tanpa respons lalu menggantinya saat isian berubah', async () => {
  const committed = new Map<string, unknown>();
  const saved = vi.fn();
  let loseResponse = true;
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    committed.set(body.operasi_id, body.data);
    if (loseResponse) { loseResponse = false; throw new TypeError('respons putus'); }
    return ok({ id, versi: 1, status: 'diajukan' });
  });
  render(<ProfilForm detail={initial} onSaved={saved} onCancel={vi.fn()} />);
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  submit();
  await screen.findByText(/Koneksi terputus/);
  submit();
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(committed.size).toBe(1);
  const keys = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).operasi_id);
  expect(keys()[1]).toBe(keys()[0]);
  submit();
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(keys()[2]).not.toBe(keys()[1]);
  loseResponse = true;
  fireEvent.change(screen.getByLabelText('Nama usaha'), { target: { value: 'Kopi baru' } });
  submit();
  await screen.findByText(/Koneksi terputus/);
  fireEvent.change(screen.getByLabelText('Nama usaha'), { target: { value: 'Kopi koreksi' } });
  submit();
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(3));
  expect(keys()[4]).not.toBe(keys()[3]);
});

it('aksi detail mengulang kunci sesudah commit tanpa respons dan mengganti saat maksud berubah', async () => {
  const committed = new Set<string>();
  const changed = vi.fn();
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (!committed.has(body.operasi_id)) {
      committed.add(body.operasi_id);
      throw new TypeError('respons putus sesudah commit');
    }
    return ok({ id, versi: 2, status: 'diajukan' });
  });
  render(<DetailTugas detail={initial} onChanged={changed} onEdit={vi.fn()}
    onBack={vi.fn()} onRefresh={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Izin dicabut' }));
  await screen.findByText(/Koneksi terputus/);
  fireEvent.click(screen.getByRole('button', { name: 'Izin dicabut' }));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  expect(committed.size).toBe(1);
  const keys = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).operasi_id);
  expect(keys()[1]).toBe(keys()[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Izin dicabut' }));
  await screen.findByText(/Koneksi terputus/);
  expect(keys()[2]).not.toBe(keys()[1]);
  fireEvent.click(screen.getByRole('button', { name: 'Izin diberikan' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
  expect(keys()[3]).not.toBe(keys()[2]);
});

it.each(['terbit', 'ditolak'] as const)('profil %s hilang dari antrean dan ditemukan kembali untuk koreksi',
  async (decision) => {
    let current = structuredClone(initial);
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/putusan')) {
        current = { ...current, versi: 2, status: decision, revisi: { ...current.revisi, keputusan: decision } };
        return ok({ id, versi: 2, status: decision });
      }
      if (url.includes('/cari?')) return ok({ items: [current], next_cursor: null });
      if (url === `/api/admin/umkm-tugas/${id}`) return ok(current);
      if (init?.method === 'POST') return ok({ id, versi: 3, status: 'diajukan' });
      return ok({ items: current.revisi.keputusan === null ? [current] : [], next_cursor: null });
    });
    const view = render(<TugasUmkm />);
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    fireEvent.click(await screen.findByRole('button', { name: decision === 'terbit' ? 'Terbitkan' : 'Tolak' }));
    if (decision === 'ditolak') {
      fireEvent.change(screen.getByRole('textbox', { name: /Alasan tolak/ }), {
        target: { value: 'Periksa foto' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Kirim penolakan' }));
    }
    await screen.findByText('Belum ada tugas UMKM');
    view.unmount();
    render(<TugasUmkm />);
    await screen.findByText('Belum ada tugas UMKM');
    fireEvent.change(screen.getByLabelText('Cari nama usaha'), { target: { value: 'Kopi' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Periksa Kopi Lampung' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Perbaiki data' }));
    expect((screen.getByLabelText('Nama usaha') as HTMLInputElement).value).toBe('Kopi Lampung');
  });

it('pencarian debounce membatalkan dan membuang respons basi termasuk saat kueri dibersihkan', async () => {
  const pending = new Map<string, (response: ReturnType<typeof ok>) => void>();
  fetchMock.mockImplementation((url: string) => url.includes('/cari?')
    ? new Promise((resolve) => pending.set(url, resolve)) : Promise.resolve(ok({ items: [], next_cursor: null })));
  render(<TugasUmkm />);
  await screen.findByText('Belum ada tugas UMKM');
  const input = screen.getByLabelText('Cari nama usaha');
  vi.useFakeTimers();
  fireEvent.change(input, { target: { value: 'Ko' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });
  expect(pending.size).toBe(0);
  fireEvent.change(input, { target: { value: 'Kopi' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  expect(pending.size).toBe(1);
  fireEvent.change(input, { target: { value: 'Teh' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  await act(async () => { pending.get('/api/admin/umkm-tugas/cari?q=Teh')!(ok({
    items: [{ ...initial, nama: 'Teh Lampung', status: 'terbit' }], next_cursor: null,
  })); });
  expect(screen.getByRole('button', { name: 'Periksa Teh Lampung' })).toBeTruthy();
  expect(screen.getByText(/terbit/)).toBeTruthy();
  await act(async () => { pending.get('/api/admin/umkm-tugas/cari?q=Kopi')!(ok({
    items: [initial], next_cursor: null,
  })); });
  expect(screen.queryByRole('button', { name: 'Periksa Kopi Lampung' })).toBeNull();
  fireEvent.change(input, { target: { value: 'Te' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(300); });
  fireEvent.change(input, { target: { value: '' } });
  await act(async () => { pending.get('/api/admin/umkm-tugas/cari?q=Te')!(ok({
    items: [initial], next_cursor: null,
  })); });
  expect(screen.queryByRole('button', { name: 'Periksa Kopi Lampung' })).toBeNull();
});

it('pencarian menampilkan batas minimum, kosong, galat dan retry dengan cursor serta kueri yang sama', async () => {
  let fail = false;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('/cari?')) {
      if (fail) throw new TypeError('jaringan');
      if (url.includes('cursor=')) return ok({ items: [], next_cursor: null });
      return ok({ items: [initial], next_cursor: id });
    }
    return ok({ items: [], next_cursor: null });
  });
  render(<TugasUmkm />);
  await screen.findByText('Belum ada tugas UMKM');
  const input = screen.getByLabelText('Cari nama usaha');
  expect(input.getAttribute('maxlength')).toBe('200');
  fireEvent.change(input, { target: { value: 'K' } });
  expect(screen.getByText('Ketik minimal 2 karakter untuk mencari.')).toBeTruthy();
  expect(fetchMock.mock.calls.some(([url]) => url.includes('/cari?'))).toBe(false);
  fireEvent.change(input, { target: { value: '  Kopi Lampung  ' } });
  expect(screen.getByText('Mencari profil UMKM...')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Halaman berikutnya' }));
  await screen.findByText('Profil tidak ditemukan');
  expect(fetchMock).toHaveBeenCalledWith(`/api/admin/umkm-tugas/cari?q=Kopi%20Lampung&cursor=${id}`,
    expect.objectContaining({ cache: 'no-store' }));
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Muat ulang' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Periksa Kopi Lampung' })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: /Coba lagi/i }));
  await screen.findByRole('button', { name: 'Periksa Kopi Lampung' });
  expect(document.activeElement?.tagName).not.toBe('BODY');
  fireEvent.change(input, { target: { value: '' } });
  await screen.findByText('Belum ada tugas UMKM');
});

it('form memakai kunci baru setelah galat pasti dan setelah foto dikeluarkan', async () => {
  const saved = vi.fn();
  let uncertain = false;
  fetchMock.mockImplementation(async () => {
    if (uncertain) throw new TypeError('respons putus');
    return { ok: false, status: 400, json: async () => ({ error: { code: 'INPUT_TIDAK_VALID' } }) };
  });
  render(<ProfilForm detail={{ ...initial, foto: [photo(1)] }} onSaved={saved} onCancel={vi.fn()} />);
  const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Simpan untuk diperiksa' }));
  submit();
  await screen.findByText(/Periksa kembali isian/);
  uncertain = true;
  submit();
  await screen.findByText(/Koneksi terputus/);
  const keys = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).operasi_id);
  expect(keys()[1]).not.toBe(keys()[0]);
  fireEvent.click(screen.getByRole('button', { name: 'Keluarkan foto 1' }));
  submit();
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(keys()[2]).not.toBe(keys()[1]);
});
