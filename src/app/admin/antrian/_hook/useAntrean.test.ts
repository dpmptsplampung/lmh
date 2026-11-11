// @vitest-environment jsdom
// Kontrak useAntrean (tugas 5.3): profil sekali, muat lewat lib/data/antrean, Realtime lewat useRealtimeRefetch, penjaga
// permintaan basi, skeleton hanya untuk muat awal/ganti parameter, dan galat per jenis.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({ klien: true })) }));
const realtime = vi.hoisted(() => ({ fn: null as null | (() => Promise<void>), opsi: null as unknown, panggilan: 0 }));
vi.mock('@/lib/hooks/useRealtimeRefetch', () => ({
  useRealtimeRefetch: (fn: () => Promise<void>, opsi: unknown) => {
    realtime.fn = fn;
    realtime.opsi = opsi;
    realtime.panggilan++;
  },
}));
vi.mock('@/lib/data/antrean', async (asli) => ({
  ...(await asli<typeof import('@/lib/data/antrean')>()),
  muatProfilAntrean: vi.fn(),
  muatAntrean: vi.fn(),
  muatCatatanEskalasi: vi.fn(),
}));
vi.mock('@/lib/survei/staf', () => ({ ambilStatusSurvei: vi.fn() }));

import {
  muatAntrean, muatCatatanEskalasi, muatProfilAntrean, PESAN_BATAS_TIKET,
  type DataAntrean, type HasilAntrean, type ParamMuatAntrean, type TiketBaris,
} from '@/lib/data/antrean';
import { ambilStatusSurvei } from '@/lib/survei/staf';
import { todayWIB } from '@/lib/time';
import { UKURAN_HALAMAN_ANTREAN, useAntrean } from './useAntrean';
import type { FilterStatus } from '../antrianUrl';

const hariIni = todayWIB();

const tiket = (over: Partial<TiketBaris> = {}): TiketBaris => ({
  id: 't-1', kunjungan_id: 'k-1', legacy_visit_id: 'v-1', layanan_id: 'l-1', dilayani_oleh: null, penanganan_asal_id: null,
  pelayan: null, nomor: 1, nomor_display: 'A-001', status: 'menunggu', waktu_terbit: null, waktu_mulai_layan: null,
  waktu_selesai: null, layanan: { nama: 'Helpdesk OSS', form_pendataan: 'oss' }, kunjungan: null, ...over,
});

const data = (over: Partial<DataAntrean> = {}): DataAntrean => ({
  baris: [tiket()], barisPanel: [tiket()], totalTabel: 1, totalHarian: 3,
  statistik: { totalSelesai: 2, rataWaktuMenit: 7 }, aksesFo: false, ...over,
});
const ok = <T,>(d: T): HasilAntrean<T> => ({ data: d, error: null });
const galat = (jenis: 'umum' | 'batas_tiket' | 'tanggal_diluar_batas' | 'basi', pesan = 'x') =>
  ({ data: null, error: { jenis, pesan, asli: new Error(pesan) } }) as const;

const profil = (role = 'admin', layanan_id: string | null = null, koordinator = false) =>
  ok({ id: 'p-1', role, layanan_id: layanan_id as string, layanan: { nama: 'Helpdesk OSS' }, koordinator });

type Param = { tanggal: string; filterStatus: FilterStatus; halaman: number };
const pasang = (p: Partial<Param> = {}) =>
  renderHook((q: Param) => useAntrean(q), {
    initialProps: { tanggal: hariIni, filterStatus: 'aktif', halaman: 0, ...p } as Param,
  });

let spyError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(muatProfilAntrean).mockReset().mockResolvedValue(profil());
  vi.mocked(muatAntrean).mockReset().mockResolvedValue(ok(data()));
  vi.mocked(muatCatatanEskalasi).mockReset().mockResolvedValue(ok({}));
  vi.mocked(ambilStatusSurvei).mockReset().mockResolvedValue(new Map());
  realtime.fn = null;
  realtime.panggilan = 0;
  spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => spyError.mockRestore());

const paramMuat = (n = 0) => vi.mocked(muatAntrean).mock.calls[n][1] as ParamMuatAntrean;

describe('useAntrean: muat', () => {
  it('muat awal: skeleton, lalu data dari muatAntrean dengan parameter halaman ini', async () => {
    const { result } = pasang({ filterStatus: 'aktif', halaman: 2 });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(paramMuat()).toMatchObject({
      tanggal: hariIni, status: ['menunggu', 'dilayani'], halaman: 2, ukuranHalaman: UKURAN_HALAMAN_ANTREAN,
      peran: 'admin', layananId: null, denganPanel: true,
    });
    expect(UKURAN_HALAMAN_ANTREAN).toBe(25);
    expect(result.current.antrian).toEqual([tiket()]);
    expect(result.current.antrianPanel).toEqual([tiket()]);
    expect(result.current.totalCount).toBe(1);
    expect(result.current.totalHarian).toBe(3);
    expect(result.current.serverStats).toEqual({ totalSelesai: 2, rataWaktuMenit: 7 });
    expect(result.current.currentUser?.role).toBe('admin');
    expect(result.current.terakhir).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.current.galatMuat).toBeNull();
  });

  it('profil dibaca SEKALI per sesi halaman; muat berikutnya memakai peran/Layanan yang tersimpan', async () => {
    vi.mocked(muatProfilAntrean).mockResolvedValue(profil('petugas', 'l-9'));
    const { result, rerender } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await realtime.fn!(); });
    rerender({ tanggal: '2026-11-04', filterStatus: 'semua', halaman: 0 });
    await waitFor(() => expect(muatAntrean).toHaveBeenCalledTimes(3));
    expect(muatProfilAntrean).toHaveBeenCalledTimes(1);
    expect(paramMuat(2)).toMatchObject({ tanggal: '2026-11-04', status: null, peran: 'petugas', layananId: 'l-9', denganPanel: false });
  });

  it('tanpa profil (null): diperlakukan Admin dan profil dicoba lagi di muat berikutnya', async () => {
    vi.mocked(muatProfilAntrean).mockResolvedValue(ok(null));
    const { result } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(paramMuat()).toMatchObject({ peran: 'admin', layananId: null });
    await act(async () => { await realtime.fn!(); });
    expect(muatProfilAntrean).toHaveBeenCalledTimes(2);
  });

  it('Petugas tanpa Layanan: "belum ditugaskan", tanpa membaca tiket', async () => {
    vi.mocked(muatProfilAntrean).mockResolvedValue(profil('petugas', null));
    const { result } = pasang();
    await waitFor(() => expect(result.current.unassigned).toBe(true));
    expect(result.current.loading).toBe(false);
    expect(muatAntrean).not.toHaveBeenCalled();
    expect(result.current.antrian).toEqual([]);
  });

  it('ganti parameter = muat dengan skeleton; muat ulang Realtime = senyap (tabel tetap, menyegarkan selama berjalan)', async () => {
    const { result, rerender } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    let lepas!: (v: HasilAntrean<DataAntrean>) => void;
    vi.mocked(muatAntrean).mockImplementationOnce(() => new Promise((r) => { lepas = r; }));
    let p!: Promise<void>;
    act(() => { p = realtime.fn!(); });
    expect(result.current.menyegarkan).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.antrian).toHaveLength(1);
    await act(async () => { lepas(ok(data({ baris: [] }))); await p; });
    expect(result.current.menyegarkan).toBe(false);
    expect(result.current.antrian).toEqual([]);

    rerender({ tanggal: hariIni, filterStatus: 'aktif', halaman: 1 });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
  });

  it('Realtime: tabel tiket_antrean + polling 30 dtk; fungsi muat ulang stabil selama parameter sama', async () => {
    const { result, rerender } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(realtime.opsi).toEqual({ table: 'tiket_antrean', pollMs: 30_000 });
    const fn = realtime.fn;
    rerender({ tanggal: hariIni, filterStatus: 'aktif', halaman: 0 });
    expect(realtime.fn).toBe(fn);
    expect(result.current.muatSenyap).toBe(fn);
  });
});

describe('useAntrean: penjaga permintaan basi', () => {
  it('respons lama yang datang belakangan tidak menimpa respons yang lebih baru; masihBerlaku memberi tahu lapisan data', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    const lepas: Array<(v: HasilAntrean<DataAntrean>) => void> = [];
    vi.mocked(muatAntrean).mockImplementation(() => new Promise((r) => { lepas.push(r); }));
    let a!: Promise<void>;
    let b!: Promise<void>;
    act(() => { a = realtime.fn!(); });
    await waitFor(() => expect(lepas).toHaveLength(1));
    act(() => { b = realtime.fn!(); });
    await waitFor(() => expect(lepas).toHaveLength(2));
    expect(paramMuat(1).masihBerlaku!()).toBe(false);
    expect(paramMuat(2).masihBerlaku!()).toBe(true);
    await act(async () => { lepas[1](ok(data({ baris: [tiket({ id: 'baru' })] }))); await b; });
    await act(async () => { lepas[0](ok(data({ baris: [tiket({ id: 'lama' })] }))); await a; });
    expect(result.current.antrian.map((t) => t.id)).toEqual(['baru']);
    expect(result.current.menyegarkan).toBe(false);
  });

  it('galat dari permintaan basi diabaikan (tanpa log, tanpa pesan)', async () => {
    vi.mocked(muatAntrean).mockResolvedValue(galat('basi'));
    const { result } = pasang();
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(muatAntrean).toHaveBeenCalled());
    expect(result.current.galatMuat).toBeNull();
    expect(spyError).not.toHaveBeenCalled();
  });
});

describe('useAntrean: galat', () => {
  it('muat awal gagal: pesan umum; "Coba lagi" (muat) memuat ulang dengan skeleton', async () => {
    vi.mocked(muatAntrean).mockResolvedValueOnce(galat('umum'));
    const { result } = pasang();
    await waitFor(() => expect(result.current.galatMuat).toBe('Antrean tidak dapat dimuat. Periksa koneksi Anda lalu coba lagi.'));
    expect(spyError).toHaveBeenCalled();
    let p!: Promise<void>;
    act(() => { p = result.current.muat(); });
    expect(result.current.loading).toBe(true);
    expect(result.current.galatMuat).toBeNull();
    await act(async () => { await p; });
    expect(result.current.antrian).toHaveLength(1);
  });

  it('muat ulang senyap gagal setelah ada data: data lama tetap, catatan galatSegar; sukses berikutnya menghapusnya', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    vi.mocked(muatAntrean).mockResolvedValueOnce(galat('umum'));
    await act(async () => { await realtime.fn!(); });
    expect(result.current.galatSegar).toBe(true);
    expect(result.current.galatMuat).toBeNull();
    expect(result.current.antrian).toHaveLength(1);
    await act(async () => { await realtime.fn!(); });
    expect(result.current.galatSegar).toBe(false);
  });

  it('tanggal di luar jendela FO: pesan jendela; batas tiket: pesannya sendiri (bukan "periksa koneksi")', async () => {
    vi.mocked(muatProfilAntrean).mockResolvedValue(profil('front_office'));
    vi.mocked(muatAntrean).mockResolvedValueOnce(galat('tanggal_diluar_batas'));
    const { result } = pasang();
    await waitFor(() => expect(result.current.galatMuat).toMatch(/^Front Office hanya dapat membuka tanggal \d/));

    vi.mocked(muatAntrean).mockResolvedValueOnce(galat('batas_tiket', PESAN_BATAS_TIKET));
    await act(async () => { await realtime.fn!(); });
    expect(result.current.galatMuat).toBe(PESAN_BATAS_TIKET);
  });

  it('galat profil menggagalkan muat (pesan umum) tanpa membaca tiket', async () => {
    vi.mocked(muatProfilAntrean).mockResolvedValue(galat('umum'));
    const { result } = pasang();
    await waitFor(() => expect(result.current.galatMuat).toMatch(/Periksa koneksi/));
    expect(muatAntrean).not.toHaveBeenCalled();
  });

  it('pelengkap: catatan eskalasi per id tahap asal dan status survei per kunjungan selesai; galatnya diam-diam kosong', async () => {
    const baris = [
      tiket({ id: 't-1', penanganan_asal_id: 'pn-1' }),
      tiket({ id: 't-2', status: 'selesai', kunjungan_id: 'k-2' }),
    ];
    vi.mocked(muatAntrean).mockResolvedValue(ok(data({ baris })));
    vi.mocked(muatCatatanEskalasi).mockResolvedValueOnce(ok({ 'pn-1': { topik: 'NIB', catatan: null, foNama: 'Rina' } }));
    vi.mocked(ambilStatusSurvei).mockResolvedValueOnce(new Map([['k-2', 'belum_diisi']]));
    const { result } = pasang();
    await waitFor(() => expect(result.current.catatanEskalasi['pn-1']?.topik).toBe('NIB'));
    expect(vi.mocked(muatCatatanEskalasi).mock.calls[0][1]).toEqual(['pn-1']);
    expect(vi.mocked(ambilStatusSurvei).mock.calls[0][1]).toEqual(['k-2']);
    expect(result.current.statusSurvei.get('k-2')).toBe('belum_diisi');
    // loading baru selesai SETELAH pelengkap dimuat (perilaku lama: satu putaran muat)
    expect(result.current.loading).toBe(false);

    vi.mocked(muatCatatanEskalasi).mockResolvedValueOnce(galat('umum'));
    vi.mocked(ambilStatusSurvei).mockRejectedValueOnce(new Error('boom'));
    await act(async () => { await realtime.fn!(); });
    expect(result.current.catatanEskalasi).toEqual({});
    expect(result.current.statusSurvei.size).toBe(0);
    expect(result.current.galatMuat).toBeNull();
    expect(result.current.galatSegar).toBe(false);
  });

  it('tanpa tiket selesai: status survei tidak dibaca', async () => {
    const { result } = pasang();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(ambilStatusSurvei).not.toHaveBeenCalled();
  });
});

describe('useAntrean: siklus hidup', () => {
  it('respons yang datang setelah unmount tidak memicu pembaruan state (tanpa galat React) dan Realtime didaftarkan lewat satu hook', async () => {
    let lepas!: (v: HasilAntrean<DataAntrean>) => void;
    vi.mocked(muatAntrean).mockImplementationOnce(() => new Promise((r) => { lepas = r; }));
    const { unmount } = pasang();
    await waitFor(() => expect(muatAntrean).toHaveBeenCalled());
    const panggilanSebelum = realtime.panggilan;
    unmount();
    await act(async () => { lepas(ok(data())); await Promise.resolve(); });
    expect(realtime.panggilan).toBe(panggilanSebelum);
    expect(spyError).not.toHaveBeenCalled();
  });
});
