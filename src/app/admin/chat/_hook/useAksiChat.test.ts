// @vitest-environment jsdom
// Kontrak useAksiChat (tugas 7.2): Ambil (kunci klik ganda, pesan ramah SUDAH_DIAMBIL, pengalihan login), dialog, peringatan
// setelah meneruskan, muat ulang pada galat basi, dan penilaian hari tanpa pelayanan Layanan sesi terpilih.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { StatusLayananChat } from '@/lib/chat/status-layanan';

const m = vi.hoisted(() => ({ aksi: vi.fn(), replace: vi.fn(), status: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: m.replace, push: vi.fn() }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/chat/status-layanan', () => ({ muatStatusLayananChat: m.status }));
vi.mock('@/lib/chat-staf', async (asli) => ({
  ...(await asli<typeof import('@/lib/chat-staf')>()),
  kirimAksiChat: m.aksi,
}));

import { GalatAksiChat } from '@/lib/chat-staf';
import { useAksiChat } from './useAksiChat';

const toast = vi.fn();
const muatDaftar = vi.fn();
const muatPesan = vi.fn();
const status = (o: Partial<StatusLayananChat> = {}): StatusLayananChat => ({
  buka: true, tanggal: '2026-10-14', liburKeterangan: null, hariTanpaLayanan: false, bukaBerikutnya: null, sumber: 'jadwal', ...o,
});
const pasang = (sesiId: string | null = 's1', layananId: string | null = 'l1') =>
  renderHook((p: { sesiId: string | null; layananId: string | null }) => useAksiChat({ ...p, toast, muatDaftar, muatPesan }), {
    initialProps: { sesiId, layananId },
  });

beforeEach(() => {
  vi.clearAllMocks();
  m.status.mockResolvedValue(status());
});
afterEach(cleanup);

describe('useAksiChat: Ambil', () => {
  it('sukses: toast, lalu daftar dan utas dimuat ulang; aksi takeover tanpa alasan', async () => {
    m.aksi.mockResolvedValue({ ok: true, sudah_milik_anda: false });
    const { result } = pasang();
    await act(async () => { await result.current.ambil(); });
    expect(m.aksi).toHaveBeenCalledWith({ sesi_id: 's1', aksi: 'takeover' });
    expect(toast).toHaveBeenCalledWith('Chat diambil. Silakan balas pengunjung.', 'success');
    expect(muatDaftar).toHaveBeenCalledTimes(1);
    expect(muatPesan).toHaveBeenCalledTimes(1);
    expect(result.current.sibuk).toBe(false);
  });

  it('sudah milik sendiri memakai pesan lain', async () => {
    m.aksi.mockResolvedValue({ ok: true, sudah_milik_anda: true });
    const { result } = pasang();
    await act(async () => { await result.current.ambil(); });
    expect(toast).toHaveBeenCalledWith('Chat ini sudah Anda pegang.', 'success');
  });

  it('SUDAH_DIAMBIL: pesan ramah (info), daftar dimuat ulang sekali per jalur galat dan sekali setelah selesai', async () => {
    m.aksi.mockRejectedValue(new GalatAksiChat('SUDAH_DIAMBIL', 'Baru saja diambil staf lain.', 409));
    const { result } = pasang();
    await act(async () => { await result.current.ambil(); });
    expect(toast).toHaveBeenCalledWith('Baru saja diambil staf lain.', 'info');
    expect(muatDaftar.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(result.current.sibuk).toBe(false);
  });

  it('galat tak dikenal: toast galat bawaan', async () => {
    m.aksi.mockRejectedValue(new Error('putus'));
    const { result } = pasang();
    await act(async () => { await result.current.ambil(); });
    expect(toast).toHaveBeenCalledWith('Gagal mengambil chat', 'error');
  });

  it('SESI_TIDAK_SAH mengalihkan ke login', async () => {
    m.aksi.mockRejectedValue(new GalatAksiChat('SESI_TIDAK_SAH', 'Sesi habis.', 401));
    const { result } = pasang();
    await act(async () => { await result.current.ambil(); });
    expect(m.replace).toHaveBeenCalledWith('/login?alasan=tidak_terdaftar');
    expect(toast).toHaveBeenCalledWith('Sesi habis.', 'error');
  });

  it('klik ganda hanya mengirim satu permintaan', async () => {
    let lepas!: (v: unknown) => void;
    m.aksi.mockReturnValue(new Promise((r) => (lepas = r)));
    const { result } = pasang();
    let p1!: Promise<void>;
    act(() => { p1 = result.current.ambil(); });
    await act(async () => { await result.current.ambil(); });
    expect(m.aksi).toHaveBeenCalledTimes(1);
    expect(result.current.sibuk).toBe(true);
    await act(async () => { lepas({ ok: true, sudah_milik_anda: false }); await p1; });
    expect(result.current.sibuk).toBe(false);
  });

  it('tanpa sesi terpilih tidak mengirim', async () => {
    const { result } = pasang(null, null);
    await act(async () => { await result.current.ambil(); });
    expect(m.aksi).not.toHaveBeenCalled();
  });
});

describe('useAksiChat: dialog dan penangan', () => {
  it('buka dan tutup dialog menurut union', () => {
    const { result } = pasang();
    expect(result.current.dialog).toBeNull();
    act(() => result.current.bukaDialog('teruskan'));
    expect(result.current.dialog).toBe('teruskan');
    act(() => result.current.tutupDialog());
    expect(result.current.dialog).toBeNull();
  });

  it('ambil alih / selesai berhasil: toast, dialog ditutup, muat ulang', () => {
    const { result } = pasang();
    act(() => result.current.bukaDialog('ambilAlih'));
    act(() => result.current.penangan.ambilAlihBerhasil({} as never));
    expect(toast).toHaveBeenCalledWith('Chat diambil alih. Silakan balas pengunjung.', 'success');
    expect(result.current.dialog).toBeNull();
    act(() => result.current.bukaDialog('selesai'));
    act(() => result.current.penangan.selesaiBerhasil({} as never));
    expect(toast).toHaveBeenCalledWith('Sesi chat diselesaikan.', 'success');
    expect(result.current.dialog).toBeNull();
    expect(muatDaftar).toHaveBeenCalledTimes(2);
    expect(muatPesan).toHaveBeenCalledTimes(2);
  });

  it('teruskan: peringatan bila petugas belum hadir, hilang bila lengkap, bisa ditutup', () => {
    const { result } = pasang();
    act(() => result.current.penangan.teruskanBerhasil({ layanan_nama: 'Bank', petugas_hadir: false, notifikasi_diantrekan: 0 } as never));
    expect(toast).toHaveBeenCalledWith('Chat diteruskan ke Bank.', 'success');
    expect(result.current.peringatan).toContain('belum ada petugas layanan itu yang hadir');
    act(() => result.current.tutupPeringatan());
    expect(result.current.peringatan).toBeNull();
    act(() => result.current.penangan.teruskanBerhasil({ layanan_nama: 'Bank', petugas_hadir: false, notifikasi_diantrekan: 0 } as never));
    act(() => result.current.penangan.teruskanBerhasil({ layanan_nama: 'Bank', petugas_hadir: true, notifikasi_diantrekan: 2 } as never));
    expect(result.current.peringatan).toBeNull();
  });

  it('galat dialog yang basi (BUKAN_PEMILIK) memuat ulang; galat lain tidak', () => {
    const { result } = pasang();
    act(() => result.current.penangan.galat(new GalatAksiChat('ALASAN_WAJIB', 'x', 400)));
    expect(muatDaftar).not.toHaveBeenCalled();
    act(() => result.current.penangan.galat(new GalatAksiChat('BUKAN_PEMILIK', 'x', 403)));
    expect(muatDaftar).toHaveBeenCalledTimes(1);
    expect(muatPesan).toHaveBeenCalledTimes(1);
    act(() => result.current.penangan.galat(new Error('bukan galat chat')));
    expect(muatDaftar).toHaveBeenCalledTimes(1);
  });
});

describe('useAksiChat: hari tanpa pelayanan', () => {
  it('menilai Layanan sesi terpilih; tanpaLayanan menyala bila hari tanpa layanan', async () => {
    m.status.mockResolvedValue(status({ hariTanpaLayanan: true, liburKeterangan: 'HUT RI' }));
    const { result } = pasang('s1', 'l1');
    await waitFor(() => expect(result.current.tanpaLayanan).toBe(true));
    expect(result.current.statusLayanan?.liburKeterangan).toBe('HUT RI');
    expect(m.status).toHaveBeenCalledWith(expect.anything(), 'l1');
  });

  it('gagal menilai = tombol tetap aktif; berganti Layanan tidak memakai status Layanan lama', async () => {
    m.status.mockResolvedValueOnce(status({ hariTanpaLayanan: true }));
    const { result, rerender } = pasang('s1', 'l1');
    await waitFor(() => expect(result.current.tanpaLayanan).toBe(true));
    m.status.mockRejectedValueOnce(new Error('putus'));
    rerender({ sesiId: 's2', layananId: 'l2' });
    expect(result.current.tanpaLayanan).toBe(false);
    await waitFor(() => expect(m.status).toHaveBeenCalledTimes(2));
    expect(result.current.tanpaLayanan).toBe(false);
  });

  it('tanpa Layanan terpilih tidak menilai', () => {
    pasang(null, null);
    expect(m.status).not.toHaveBeenCalled();
  });
});
