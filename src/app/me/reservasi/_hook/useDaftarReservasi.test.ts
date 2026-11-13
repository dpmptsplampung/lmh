// @vitest-environment jsdom
// Kontrak useDaftarReservasi (tugas 9.2): muat daftar, konfirmasi batal dua langkah, pembatalan lalu segarkan selalu.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn(() => ({ klien: true })) }));
vi.mock('@/lib/data/reservasi', () => ({ muatReservasiSaya: vi.fn(), batalkanReservasi: vi.fn() }));

import { batalkanReservasi, muatReservasiSaya } from '@/lib/data/reservasi';
import type { ReservasiKunjungan } from '@/lib/reservasi';
import { useDaftarReservasi } from './useDaftarReservasi';

const baris = (o: Partial<ReservasiKunjungan> = {}): ReservasiKunjungan => ({
  id: 'k-1', tanggal: '2099-03-02', status: 'terjadwal', qr_token: 'q', tujuan: 'loket', layanan_saran_id: null,
  jam_rencana: null, nama_yang_ditemui: null, ...o,
});
const ok = <T,>(data: T) => ({ data, error: null }) as const;
const galat = (pesan = '') => ({ data: null, error: { pesan, kode: null, asli: new Error('x') } }) as const;

let spyError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(muatReservasiSaya).mockReset().mockResolvedValue(ok([baris()]));
  vi.mocked(batalkanReservasi).mockReset().mockResolvedValue(ok(true));
  spyError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => spyError.mockRestore());

describe('muatDaftar', () => {
  it('sukses mengisi daftar; galat menandai gagal tanpa menghapus daftar; sukses berikutnya memulihkan', async () => {
    const { result } = renderHook(() => useDaftarReservasi('p-1'));
    await act(() => result.current.muatDaftar('p-1'));
    expect(result.current.daftar).toHaveLength(1);
    expect(vi.mocked(muatReservasiSaya).mock.calls[0][1]).toBe('p-1');

    vi.mocked(muatReservasiSaya).mockResolvedValueOnce(galat());
    await act(() => result.current.muatDaftar('p-1'));
    expect(result.current.daftarGagal).toBe(true);
    expect(result.current.daftar).toHaveLength(1);

    await act(() => result.current.muatDaftar('p-1'));
    expect(result.current.daftarGagal).toBe(false);
  });

  it('muatUlang memakai pengunjungId hook; tanpa pengunjungId tidak memanggil data', async () => {
    const { result, rerender } = renderHook(({ id }) => useDaftarReservasi(id), { initialProps: { id: null as string | null } });
    act(() => result.current.muatUlang());
    expect(muatReservasiSaya).not.toHaveBeenCalled();
    rerender({ id: 'p-2' });
    await act(async () => result.current.muatUlang());
    expect(vi.mocked(muatReservasiSaya).mock.calls[0][1]).toBe('p-2');
  });
});

describe('konfirmasi dan pembatalan', () => {
  it('mintaBatal membuka konfirmasi dan mengosongkan pesan lama; tutupKonfirmasi menutup', () => {
    const { result } = renderHook(() => useDaftarReservasi('p-1'));
    act(() => result.current.mintaBatal('k-1'));
    expect(result.current.konfirmasiBatal).toBe('k-1');
    act(() => result.current.tutupKonfirmasi());
    expect(result.current.konfirmasiBatal).toBeNull();
  });

  it('batalkan sukses: info, konfirmasi tertutup, daftar disegarkan', async () => {
    const { result } = renderHook(() => useDaftarReservasi('p-1'));
    act(() => result.current.mintaBatal('k-1'));
    await act(() => result.current.batalkan('k-1'));
    expect(vi.mocked(batalkanReservasi).mock.calls[0][1]).toBe('k-1');
    expect(result.current.infoBatal).toBe('Reservasi dibatalkan.');
    expect(result.current.galatBatal).toBe('');
    expect(result.current.konfirmasiBatal).toBeNull();
    expect(result.current.membatalkan).toBeNull();
    expect(muatReservasiSaya).toHaveBeenCalledTimes(1);
  });

  it('batalkan gagal: pesan galat, konfirmasi tetap terbuka, daftar tetap disegarkan', async () => {
    vi.mocked(batalkanReservasi).mockResolvedValue(galat('Reservasi ini sudah tidak dapat dibatalkan.'));
    const { result } = renderHook(() => useDaftarReservasi('p-1'));
    act(() => result.current.mintaBatal('k-1'));
    await act(() => result.current.batalkan('k-1'));
    expect(result.current.galatBatal).toBe('Reservasi ini sudah tidak dapat dibatalkan.');
    expect(result.current.infoBatal).toBe('');
    expect(result.current.konfirmasiBatal).toBe('k-1');
    expect(muatReservasiSaya).toHaveBeenCalledTimes(1);
  });

  it('selagi satu pembatalan berjalan, panggilan kedua diabaikan', async () => {
    let selesai: (v: ReturnType<typeof ok>) => void = () => undefined;
    vi.mocked(batalkanReservasi).mockImplementationOnce(() => new Promise((res) => { selesai = res as typeof selesai; }));
    const { result } = renderHook(() => useDaftarReservasi('p-1'));
    let pertama: Promise<void> = Promise.resolve();
    act(() => { pertama = result.current.batalkan('k-1'); });
    expect(result.current.membatalkan).toBe('k-1');
    await act(() => result.current.batalkan('k-2'));
    expect(batalkanReservasi).toHaveBeenCalledTimes(1);
    await act(async () => { selesai(ok(true)); await pertama; });
    expect(result.current.membatalkan).toBeNull();
  });
});
