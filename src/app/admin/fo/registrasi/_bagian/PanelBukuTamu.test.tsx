// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { buangCacheReferensi } from '@/lib/data/klien/useReferensi';

const m = vi.hoisted(() => ({ toast: vi.fn(), petugas: [] as unknown[], petugasGalat: false }));
vi.mock('@/components/Toast', () => ({ useToast: () => ({ toast: m.toast }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/data/referensi', async (impor) => ({
  ...(await impor<typeof import('@/lib/data/referensi')>()),
  muatPetugasRingkas: () =>
    Promise.resolve(m.petugasGalat ? { data: null, error: 'Gagal memuat petugas' } : { data: m.petugas, error: null }),
}));

import PanelBukuTamu from './PanelBukuTamu';

type Tamu = Record<string, unknown>;
const tamu = (o: Tamu = {}): Tamu => ({
  id: 't1', nama: 'Budi Santoso', instansi: 'Dinas X', no_hp: '+6281234567890', bertemu: 'Kepala Bidang', tujuan: 'Koordinasi',
  waktu_masuk: '2026-10-08T02:30:00Z', waktu_keluar: null, menemui_petugas_id: null, dicatat_oleh: 'p1', dicatat_nama: 'FO Satu', ...o,
});
const PETUGAS = [
  { id: 'pa', nama: 'Rina Kepala Bidang', role: 'petugas', layanan_id: null, aktif: true },
  { id: 'pb', nama: 'Agus Nonaktif', role: 'petugas', layanan_id: null, aktif: false },
  { id: 'pc', nama: 'Dewi Admin', role: 'admin', layanan_id: null, aktif: true },
];

let fetchMock: ReturnType<typeof vi.fn>;
let daftar: Tamu[];
let gagalMuat: boolean;
let responKeluar: { ok: boolean; status?: number; body: unknown };
let responEkspor: { ok: boolean; status: number; terpotong?: boolean; body?: unknown };
const metode = (c: unknown[]) => (c[1] as RequestInit | undefined)?.method;
const urlGet = () => fetchMock.mock.calls.filter((c) => !metode(c) && !String(c[0]).includes('/export')).map((c) => String(c[0]));
const urlTerakhir = () => new URL(urlGet().at(-1)!, 'http://x');
const panggilan = (mtd: string) => fetchMock.mock.calls.filter((c) => metode(c) === mtd);

beforeEach(() => {
  daftar = [tamu()];
  gagalMuat = false;
  m.toast.mockReset();
  m.petugas = PETUGAS;
  m.petugasGalat = false;
  buangCacheReferensi();
  responKeluar = { ok: true, body: { tamu: { id: 't1', waktu_keluar: '2026-10-08T05:15:00Z' } } };
  responEkspor = { ok: true, status: 200 };
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Promise.resolve({ ok: true, json: () => Promise.resolve({ tamu: { id: 't2' } }) });
    if (init?.method === 'PATCH') {
      return Promise.resolve({ ok: responKeluar.ok, status: responKeluar.status ?? 200, json: () => Promise.resolve(responKeluar.body) });
    }
    if (String(url).includes('/export')) {
      return Promise.resolve({
        ok: responEkspor.ok,
        status: responEkspor.status,
        json: () => Promise.resolve(responEkspor.body ?? {}),
        blob: () => Promise.resolve(new Blob(['x'])),
        headers: new Headers({
          'Content-Disposition': 'attachment; filename="buku-tamu-a-sd-b.xlsx"',
          'X-Rekap-Truncated': String(!!responEkspor.terpotong),
        }),
      });
    }
    if (gagalMuat) return Promise.resolve({ ok: false, json: () => Promise.resolve({ error: 'Gagal memuat buku tamu' }) });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ items: daftar, total: daftar.length, page: 1, limit: 50 }) });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(cleanup);

function pilihTujuhHari() {
  fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal buku tamu:/ }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Rentang tanggal buku tamu' })).getByRole('button', { name: '7 hari terakhir' }));
}

describe('PanelBukuTamu', () => {
  it('menampilkan keterangan peran dan tamu hari ini', async () => {
    render(<PanelBukuTamu />);
    expect(await screen.findByText('Budi Santoso')).toBeTruthy();
    expect(screen.getByRole('note').textContent).toMatch(/Front Office/);
  });

  it('kolom lengkap: tanggal, jam WIB, nama, instansi, nomor HP rapi, ditemui, tujuan, pencatat', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    const kepala = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(kepala).toEqual(['Masuk', 'Keluar', 'Nama', 'Asal', 'Keperluan', 'Menemui', 'Dicatat oleh']);
    const baris = screen.getAllByRole('row')[1];
    expect(baris.textContent).toMatch(/8 Okt 2026/);
    expect(baris.textContent).toMatch(/09[.:]30/); // 02:30 UTC = 09:30 WIB
    expect(baris.textContent).toContain('0812-3456-7890');
    expect(baris.textContent).toContain('Dinas X');
    expect(baris.textContent).toContain('FO Satu');
  });

  it('nomor HP kosong tampil sebagai tanda strip, bukan teks "null"', async () => {
    daftar = [tamu({ no_hp: null, instansi: null })];
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    expect(screen.getAllByRole('row')[1].textContent).not.toMatch(/null/);
  });

  it('memuat hari ini (WIB) secara bawaan dan menyebut jumlah tamu', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    const u = urlTerakhir();
    expect(u.searchParams.get('dari')).toBe(todayWIB());
    expect(u.searchParams.get('sampai')).toBe(todayWIB());
    expect(screen.getByRole('status').textContent).toMatch(/1 tamu/);
  });

  it('mengubah tanggal memuat ulang dengan rentang itu', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    pilihTujuhHari();
    await waitFor(() => expect(urlTerakhir().searchParams.get('dari')).toBe(addDaysWIB(-6)));
    expect(urlTerakhir().searchParams.get('sampai')).toBe(todayWIB());
    expect(urlTerakhir().searchParams.get('page')).toBe('1');
  });

  it('rentang terbalik dinormalkan dan daftar baru dimuat setelah Terapkan', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    const sebelum = urlGet().length;
    fireEvent.click(screen.getByRole('button', { name: /^Rentang tanggal buku tamu:/ }));
    const dialog = screen.getByRole('dialog', { name: 'Rentang tanggal buku tamu' });
    const klik = (iso: string) => fireEvent.click(dialog.querySelector<HTMLButtonElement>(`button[data-tanggal="${iso}"]`)!);
    klik(todayWIB());
    if (todayWIB().slice(5, 7) !== addDaysWIB(-1).slice(5, 7)) fireEvent.click(within(dialog).getByRole('button', { name: 'Bulan sebelumnya' }));
    klik(addDaysWIB(-1));
    expect(urlGet().length).toBe(sebelum);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Terapkan' }));
    await waitFor(() => expect(urlTerakhir().searchParams.get('dari')).toBe(addDaysWIB(-1)));
    expect(urlTerakhir().searchParams.get('sampai')).toBe(todayWIB());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pencarian dikirim sebagai q; tombol Hari ini mengembalikan rentang dan mengosongkan pencarian', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    pilihTujuhHari();
    fireEvent.change(screen.getByLabelText('Cari tamu'), { target: { value: 'Dinas' } });
    await waitFor(() => expect(urlTerakhir().searchParams.get('q')).toBe('Dinas'));
    fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));
    await waitFor(() => expect(urlTerakhir().searchParams.get('dari')).toBe(todayWIB()));
    expect(urlTerakhir().searchParams.get('q')).toBeNull();
    expect((screen.getByLabelText('Cari tamu') as HTMLInputElement).value).toBe('');
  });

  it('menandai siapa yang mencatat tiap tamu (daftar tidak dibatasi)', async () => {
    daftar = [
      tamu({ id: 't1', dicatat_nama: 'FO Satu' }),
      tamu({ id: 't2', nama: 'Siti', dicatat_oleh: 'p2', dicatat_nama: 'FO Dua' }),
      tamu({ id: 't3', nama: 'Andi', dicatat_oleh: null, dicatat_nama: null }),
    ];
    render(<PanelBukuTamu />);
    expect(await screen.findByRole('columnheader', { name: 'Dicatat oleh' })).toBeTruthy();
    expect(screen.getByText('FO Satu')).toBeTruthy();
    expect(screen.getByText('FO Dua')).toBeTruthy();
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('keadaan kosong hari ini', async () => {
    daftar = [];
    render(<PanelBukuTamu />);
    expect(await screen.findByText(/Belum ada tamu tercatat hari ini/)).toBeTruthy();
  });

  it('keadaan kosong saat difilter berbeda dari hari ini', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    daftar = [];
    fireEvent.change(screen.getByLabelText('Cari tamu'), { target: { value: 'zzz' } });
    expect(await screen.findByText(/Tidak ada tamu yang cocok/)).toBeTruthy();
  });

  it('galat memuat: pesan dan tombol Coba lagi yang memuat ulang', async () => {
    gagalMuat = true;
    render(<PanelBukuTamu />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Gagal memuat buku tamu/);
    gagalMuat = false;
    fireEvent.click(screen.getByRole('button', { name: 'Coba lagi' }));
    expect(await screen.findByText('Budi Santoso')).toBeTruthy();
  });

  const isiDasar = () => {
    fireEvent.change(screen.getByLabelText(/^Nama tamu/), { target: { value: 'Siti Aminah' } });
    fireEvent.change(screen.getByLabelText(/Instansi/), { target: { value: 'PT Maju' } });
    fireEvent.change(screen.getByLabelText(/Nomor HP/), { target: { value: '0852-1111-2222' } });
  };
  const kirimTamu = () => fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));
  const bodyPost = () => JSON.parse((panggilan('POST')[0][1] as RequestInit).body as string);

  it('mencatat tamu dengan petugas terpilih: id petugas dan namanya terkirim, daftar dimuat ulang', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    const pilih = await screen.findByRole('combobox', { name: /Bertemu siapa/ });
    // petugas nonaktif tidak ditawarkan; urut nama
    expect(within(pilih).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Pilih petugas yang ditemui', 'Dewi Admin', 'Rina Kepala Bidang', 'Lainnya (tulis sendiri)',
    ]);
    isiDasar();
    fireEvent.change(pilih, { target: { value: 'pa' } });
    const sebelum = urlGet().length;
    kirimTamu();
    await waitFor(() => expect(panggilan('POST')).toHaveLength(1));
    expect(panggilan('POST')[0][0]).toBe('/api/admin/buku-tamu');
    expect(bodyPost()).toEqual({
      nama: 'Siti Aminah', instansi: 'PT Maju', no_hp: '085211112222', bertemu: 'Rina Kepala Bidang', menemui_petugas_id: 'pa',
    });
    await waitFor(() => expect(urlGet().length).toBeGreaterThan(sebelum));
  });

  it('pilihan "Lainnya" membuka isian teks bebas; id petugas tidak dikirim', async () => {
    render(<PanelBukuTamu />);
    fireEvent.change(await screen.findByRole('combobox', { name: /Bertemu siapa/ }), { target: { value: 'lain' } });
    isiDasar();
    fireEvent.change(screen.getByLabelText(/Nama yang ditemui/), { target: { value: 'Sekretaris' } });
    kirimTamu();
    await waitFor(() => expect(panggilan('POST')).toHaveLength(1));
    expect(bodyPost()).toEqual({ nama: 'Siti Aminah', instansi: 'PT Maju', no_hp: '085211112222', bertemu: 'Sekretaris' });
  });

  it('petugas belum dipilih: galat jelas dan tidak memanggil server', async () => {
    render(<PanelBukuTamu />);
    await screen.findByRole('combobox', { name: /Bertemu siapa/ });
    isiDasar();
    kirimTamu();
    expect(await screen.findByText(/Pilih petugas yang ditemui, atau pilih "Lainnya"/)).toBeTruthy();
    expect(panggilan('POST')).toHaveLength(0);
  });

  it('daftar petugas gagal dimuat: isian teks biasa sebagai cadangan, tamu tetap bisa dicatat', async () => {
    m.petugasGalat = true;
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    isiDasar();
    fireEvent.change(screen.getByLabelText(/Bertemu siapa/), { target: { value: 'Sekretaris' } });
    kirimTamu();
    await waitFor(() => expect(panggilan('POST')).toHaveLength(1));
    expect(bodyPost()).toEqual({ nama: 'Siti Aminah', instansi: 'PT Maju', no_hp: '085211112222', bertemu: 'Sekretaris' });
  });

  it('menolak input kurang tanpa memanggil server', async () => {
    render(<PanelBukuTamu />);
    await screen.findByText('Budi Santoso');
    fireEvent.click(screen.getByRole('button', { name: /Catat tamu/ }));
    expect(await screen.findByText('Nomor HP wajib diisi.')).toBeTruthy();
    expect(panggilan('POST').length > 0).toBe(false);
  });

  describe('catat keluar', () => {
    it('tamu yang belum keluar punya tombol; sesudah dicatat jam keluar tampil dan tombol hilang', async () => {
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fireEvent.click(screen.getByRole('button', { name: 'Catat keluar Budi Santoso' }));
      await waitFor(() => expect(panggilan('PATCH')).toHaveLength(1));
      expect(JSON.parse((panggilan('PATCH')[0][1] as RequestInit).body as string)).toEqual({ id: 't1' });
      expect(await screen.findByText(/12[.:]15 WIB/)).toBeTruthy(); // 05:15 UTC = 12:15 WIB
      expect(screen.queryByRole('button', { name: /Catat keluar/ })).toBeNull();
      expect(m.toast).toHaveBeenCalledWith('Waktu keluar dicatat.', 'success');
    });

    it('tamu yang sudah keluar menampilkan jam keluar tanpa tombol', async () => {
      daftar = [tamu({ waktu_keluar: '2026-10-08T05:15:00Z' })];
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      expect(screen.getByText(/12[.:]15 WIB/)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Catat keluar/ })).toBeNull();
    });

    it('galat server: pesan ditampilkan (toast galat) dan tombol tetap ada', async () => {
      responKeluar = { ok: false, status: 404, body: { error: 'Tamu tidak ditemukan' } };
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fireEvent.click(screen.getByRole('button', { name: 'Catat keluar Budi Santoso' }));
      await waitFor(() => expect(m.toast).toHaveBeenCalledWith('Tamu tidak ditemukan', 'error'));
      expect(screen.getByRole('button', { name: 'Catat keluar Budi Santoso' })).toBeTruthy();
    });
  });

  describe('unduh', () => {
    let klik: ReturnType<typeof vi.fn<() => void>>;
    beforeEach(() => {
      klik = vi.fn<() => void>();
      vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:x'), revokeObjectURL: vi.fn() }));
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(klik);
    });
    afterEach(() => vi.restoreAllMocks());
    const urlEkspor = () => new URL(String(fetchMock.mock.calls.filter((c) => String(c[0]).includes('/export')).at(-1)![0]), 'http://x');

    it('XLSX memakai filter yang tampil (tanggal + pencarian) dan format xlsx', async () => {
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fireEvent.change(screen.getByLabelText('Cari tamu'), { target: { value: 'Dinas' } });
      await waitFor(() => expect(urlTerakhir().searchParams.get('q')).toBe('Dinas'));
      fireEvent.click(screen.getByRole('button', { name: /Unduh XLSX/ }));
      await waitFor(() => expect(klik).toHaveBeenCalled());
      const u = urlEkspor();
      expect(u.pathname).toBe('/api/admin/buku-tamu/export');
      expect(u.searchParams.get('format')).toBe('xlsx');
      expect(u.searchParams.get('dari')).toBe(todayWIB());
      expect(u.searchParams.get('sampai')).toBe(todayWIB());
      expect(u.searchParams.get('q')).toBe('Dinas');
      expect(u.searchParams.has('page')).toBe(false);
      expect(m.toast).toHaveBeenCalledWith('Berkas Excel berhasil diunduh', 'success');
    });

    it('CSV meminta format csv', async () => {
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fireEvent.click(screen.getByRole('button', { name: /Unduh CSV/ }));
      await waitFor(() => expect(klik).toHaveBeenCalled());
      expect(urlEkspor().searchParams.get('format')).toBe('csv');
    });

    it('X-Rekap-Truncated: peringatan data terpotong tampil di halaman', async () => {
      responEkspor = { ok: true, status: 200, terpotong: true };
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fireEvent.click(screen.getByRole('button', { name: /Unduh XLSX/ }));
      expect(await screen.findByText(/Data terpotong ke 50\.000 baris/)).toBeTruthy();
      expect(klik).toHaveBeenCalled();
      expect(m.toast).toHaveBeenCalledWith(expect.stringMatching(/terpotong/), 'warning');
    });

    it('ekspor gagal (500): galat jelas tampil di halaman dan tidak ada berkas', async () => {
      responEkspor = { ok: false, status: 500, body: {} };
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fireEvent.click(screen.getByRole('button', { name: /Unduh XLSX/ }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Unduhan dibatalkan karena berkas atau pencatatan audit ekspor gagal/);
      expect(klik).not.toHaveBeenCalled();
    });

    it('galat jaringan ekspor: pesan koneksi, tombol aktif lagi', async () => {
      render(<PanelBukuTamu />);
      await screen.findByText('Budi Santoso');
      fetchMock.mockImplementationOnce(() => Promise.reject(new TypeError('gagal')));
      fireEvent.click(screen.getByRole('button', { name: /Unduh CSV/ }));
      expect((await screen.findByRole('alert')).textContent).toMatch(/Tidak dapat menghubungi server/);
      expect((screen.getByRole('button', { name: /Unduh CSV/ }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
