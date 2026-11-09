// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PengawasanUmkm from './PengawasanUmkm';
import type { DaftarJejakPengawasan } from '@/lib/umkm-katalog/types';

const id = '10000000-0000-4000-8000-000000000001';
const summary = {
  profil: { diajukan: 2, terbit: 3, disembunyikan: 1, ditolak: 0 }, tugas_terbuka: 5, mendesak: 1,
  pesan: { baru: 2, ditangani: 4 }, laporan_terbuka: 1,
  rata_pemeriksaan_detik: null, rata_balasan_pertama_detik: 120,
};
const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify({ data })));
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return ok({ id, versi: 2, status: 'disembunyikan', mendesak: true });
    if (url.includes('/cari?')) return ok({ items: [{ id, nama: 'Kopi Lampung', status: 'terbit', versi: 1 }],
      next_cursor: null });
    if (url.includes('/jejak')) return ok({ items: [], next_cursor: null });
    return ok(summary);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('pengawasan UMKM', () => {
  it('memberi label setiap kode jejak RPC beserta aktor dan perubahan status', async () => {
    const actions = [
      ['simpan', 'Data profil disimpan'], ['ambil', 'Tugas diambil'], ['putusan', 'Keputusan profil'],
      ['visibilitas', 'Visibilitas diperbarui'], ['izin', 'Izin diperbarui'],
      ['akses_kontak', 'Kontak dibaca petugas'], ['atur_pemeriksa', 'Pemeriksa diperbarui'],
      ['selesai', 'Tugas selesai'], ['darurat_sembunyikan', 'Profil disembunyikan'],
      ['darurat_catat_pencabutan', 'Pencabutan izin dicatat'],
      ['selesai_mendesak', 'Pemeriksaan mendesak selesai'],
    ];
    const jejak: DaftarJejakPengawasan = {
      items: actions.map(([aksi], index) => ({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        profil_id: id, profil_nama: 'Kopi Lampung', aksi, aktor_nama: 'Sari', peran: 'front_office',
        status_lama: 'terbit', status_baru: 'disembunyikan', alasan: 'Informasi kontak tampil',
        dibuat_pada: '2026-11-09T02:00:00Z',
      })), next_cursor: null,
    };
    fetchMock.mockImplementation((url: string) => url.includes('/jejak') ? ok(jejak) : ok(summary));
    render(<PengawasanUmkm />);
    for (const [, label] of actions) expect(await screen.findByText(label, { selector: 'strong' })).toBeTruthy();
    expect(screen.queryByText('Tindakan tercatat')).toBeNull();
    expect(screen.getAllByText(/Sari.*Front Office/)).toHaveLength(actions.length);
    expect(screen.getAllByText('Status: terbit → disembunyikan')).toHaveLength(actions.length);
    expect(screen.getAllByText('Alasan: Informasi kontak tampil')).toHaveLength(actions.length);
  });

  it('menampilkan ringkasan, waktu, jejak kosong dan pencarian berlabel tanpa tombol tahan', async () => {
    render(<PengawasanUmkm />);
    expect(screen.getByText('Memuat ringkasan...')).toBeTruthy();
    expect(await screen.findByText('Tugas terbuka')).toBeTruthy();
    expect(screen.getByText('Belum ada keputusan selesai')).toBeTruthy();
    expect(await screen.findByText('Belum ada jejak kerja')).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Cari profil untuk tindakan darurat' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /tahan/i })).toBeNull();
  });

  it.each([[503, 'MODUL_BELUM_TERSEDIA'], [429, 'TERLALU_BANYAK'], [403, 'DILARANG']])(
    'keadaan %s tidak menampilkan galat internal', async (status, code) => {
      fetchMock.mockImplementation(() => Promise.resolve(new Response(
        JSON.stringify({ error: { code, message: 'internal 10/600' } }), { status: Number(status) })));
      render(<PengawasanUmkm />);
      await screen.findAllByText(/belum tersedia|sedang padat|hanya untuk Front Office/i);
      expect(document.body.textContent).not.toContain('10/600');
    },
  );

  it('sembunyikan memakai profil terpilih, versi dan alasan; tidak meminta nomor', async () => {
    render(<PengawasanUmkm />);
    await screen.findByText('Tugas terbuka');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Kopi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cari profil' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sembunyikan Kopi Lampung' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Alasan singkat' }), { target: { value: 'Nomor tampil' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sembunyikan profil' }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, options]) => options?.method === 'POST')!;
    expect(url).toBe(`/api/admin/umkm-pengawasan/${id}/darurat`);
    expect(JSON.parse(init.body)).toMatchObject({ aksi: 'sembunyikan', alasan: 'Nomor tampil', expected_version: 1 });
    expect(JSON.parse(init.body).operasi_id).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: /nomor/i })).toBeNull();
    expect(await screen.findByText('Tindakan tersimpan dan masuk ke tugas pemeriksa.')).toBeTruthy();
  });

  it('pencarian kosong menampilkan petunjuk dan profil yang disembunyikan tidak punya aksi sembunyikan', async () => {
    let empty = true;
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/cari?')) return ok({ items: empty ? []
        : [{ id, nama: 'Kopi Lampung', status: 'disembunyikan', versi: 2 }], next_cursor: null });
      if (url.includes('/jejak')) return ok({ items: [], next_cursor: null });
      return ok(summary);
    });
    render(<PengawasanUmkm />);
    await screen.findByText('Tugas terbuka');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Kopi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cari profil' }));
    expect(await screen.findByText('Profil tidak ditemukan. Coba nama usaha lain.')).toBeTruthy();
    empty = false;
    fireEvent.click(screen.getByRole('button', { name: 'Cari profil' }));
    await screen.findByRole('button', { name: 'Catat pencabutan izin Kopi Lampung' });
    expect(screen.queryByRole('button', { name: 'Sembunyikan Kopi Lampung' })).toBeNull();
  });

  it.each([
    ['Sembunyikan Kopi Lampung', 'Sembunyikan profil'],
    ['Catat pencabutan izin Kopi Lampung', 'Catat pencabutan'],
  ])('%s mengumumkan profil berhenti tampil dengan pembersihan tertunda', async (pemicu, kirim) => {
    const original = fetchMock.getMockImplementation() as (url: string, init?: RequestInit) => Promise<Response>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return ok({ id, versi: 2, status: 'disembunyikan', mendesak: true,
        foto_publikasi: { status: 'tertunda', tertunda: 0, hapus_tertunda: 1 } });
      return original(url, init);
    });
    render(<PengawasanUmkm />);
    await screen.findByText('Tugas terbuka');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Kopi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cari profil' }));
    fireEvent.click(await screen.findByRole('button', { name: pemicu }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Alasan singkat' }), { target: { value: 'Nomor tampil' } });
    fireEvent.click(screen.getByRole('button', { name: kirim }));
    const notice = await screen.findByText(
      'Profil sudah berhenti tampil. Salinan foto akan dibersihkan petugas.',
    );
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sembunyikan Kopi Lampung' })).toBeNull();
  });
});
