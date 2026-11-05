// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  hasil: { data: null as unknown, error: null as unknown },
  lempar: false,
  ops: [] as [string, unknown[]][],
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: (tabel: string) => {
      mocks.ops.push(['from', [tabel]]);
      const b: Record<string, unknown> = {};
      b.select = (...a: unknown[]) => (mocks.ops.push(['select', a]), b);
      b.eq = (...a: unknown[]) => (mocks.ops.push(['eq', a]), b);
      b.maybeSingle = () => (mocks.lempar ? Promise.reject(new Error('putus')) : Promise.resolve(mocks.hasil));
      return b;
    },
  }),
}));
vi.mock('@/lib/time', () => ({ todayWIB: () => '2026-11-04' }));

import { formatDurasiRingkas, jamWIB, ringkasSesi, useSesiKerja } from './useSesiKerja';

describe('formatDurasiRingkas', () => {
  it('menit, jam, dan jam+menit seragam', () => {
    expect(formatDurasiRingkas(0)).toBe('0 m');
    expect(formatDurasiRingkas(12)).toBe('12 m');
    expect(formatDurasiRingkas(60)).toBe('1 j');
    expect(formatDurasiRingkas(65)).toBe('1 j 5 m');
    expect(formatDurasiRingkas(192)).toBe('3 j 12 m');
  });
  it('negatif atau NaN dianggap 0', () => {
    expect(formatDurasiRingkas(-5)).toBe('0 m');
    expect(formatDurasiRingkas(Number.NaN)).toBe('0 m');
  });
});

describe('jamWIB', () => {
  it('menampilkan jam WIB berformat titik', () => {
    expect(jamWIB('2026-11-03T23:58:00.000Z')).toBe('06.58'); // UTC 23:58 = WIB 06:58
    expect(jamWIB('2026-11-04T00:58:00.000Z')).toBe('07.58');
  });
  it('tak valid atau kosong = null', () => {
    expect(jamWIB(null)).toBeNull();
    expect(jamWIB('bukan tanggal')).toBeNull();
  });
});

describe('ringkasSesi (murni)', () => {
  const sekarang = new Date('2026-11-04T04:10:00.000Z'); // WIB 11.10
  it('tanpa baris atau tanpa jam_masuk = belum', () => {
    expect(ringkasSesi(null, sekarang).status).toBe('belum');
    expect(ringkasSesi({ jam_masuk: null, jam_pulang: null }, sekarang).status).toBe('belum');
  });
  it('pending: menunggu persetujuan tanpa jam hadir atau durasi', () => {
    expect(ringkasSesi({ jam_masuk: '2026-11-04T00:58:00.000Z', jam_pulang: null, status: 'pending' }, sekarang))
      .toEqual({ status: 'menunggu', jamMasuk: null, jamPulang: null, durasi: null });
  });
  it('hadir: jam masuk WIB dan durasi sejak masuk', () => {
    const r = ringkasSesi({ jam_masuk: '2026-11-03T23:58:00.000Z', jam_pulang: null, status: 'approved' }, sekarang);
    expect(r).toEqual({ status: 'hadir', jamMasuk: '06.58', jamPulang: null, durasi: '4 j 12 m' });
  });
  it('sudah pulang: tanpa durasi berjalan', () => {
    const r = ringkasSesi({ jam_masuk: '2026-11-04T00:58:00.000Z', jam_pulang: '2026-11-04T03:00:00.000Z' }, sekarang);
    expect(r.status).toBe('pulang');
    expect(r.jamPulang).toBe('10.00');
    expect(r.durasi).toBeNull();
  });
  it('ditolak ditandai sendiri', () => {
    expect(ringkasSesi({ jam_masuk: '2026-11-04T00:58:00.000Z', jam_pulang: null, status: 'ditolak' }, sekarang).status).toBe('ditolak');
  });
  it('jam masuk di masa depan tidak menghasilkan durasi negatif', () => {
    const r = ringkasSesi({ jam_masuk: '2026-11-04T05:00:00.000Z', jam_pulang: null }, sekarang);
    expect(r.durasi).toBe('0 m');
  });
});

describe('useSesiKerja', () => {
  beforeEach(() => {
    mocks.hasil = { data: null, error: null };
    mocks.lempar = false;
    mocks.ops = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('tidak aktif: tanpa kueri', () => {
    const { result } = renderHook(() => useSesiKerja('p1', false));
    expect(result.current.status).toBe('memuat');
    expect(mocks.ops).toEqual([]);
  });

  it('kueri absensi milik sendiri untuk tanggal WIB hari ini', async () => {
    renderHook(() => useSesiKerja('p1', true));
    await waitFor(() => expect(mocks.ops.some(([m]) => m === 'maybeSingle' || m === 'eq')).toBe(true));
    expect(mocks.ops).toContainEqual(['from', ['absensi_petugas']]);
    expect(mocks.ops).toContainEqual(['eq', ['petugas_id', 'p1']]);
    expect(mocks.ops).toContainEqual(['eq', ['tanggal', '2026-11-04']]);
  });

  it('belum absen = status belum', async () => {
    const { result } = renderHook(() => useSesiKerja('p1', true));
    await waitFor(() => expect(result.current.status).toBe('belum'));
  });

  it('galat kueri atau kolom tiada = tidakTersedia, tanpa melempar', async () => {
    mocks.hasil = { data: null, error: { message: 'column does not exist' } };
    const a = renderHook(() => useSesiKerja('p1', true));
    await waitFor(() => expect(a.result.current.status).toBe('tidakTersedia'));
    mocks.hasil = { data: null, error: null };
    mocks.lempar = true;
    const b = renderHook(() => useSesiKerja('p1', true));
    await waitFor(() => expect(b.result.current.status).toBe('tidakTersedia'));
  });

  it('tanpa petugasId = tidakTersedia', () => {
    const { result } = renderHook(() => useSesiKerja(null, true));
    expect(result.current.status).toBe('tidakTersedia');
  });

  it('pending: tanpa durasi atau timer sesi selama menunggu persetujuan', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-04T01:10:00.000Z'));
    mocks.hasil = { data: { jam_masuk: '2026-11-04T00:58:00.000Z', jam_pulang: null, status: 'pending' }, error: null };
    const { result } = renderHook(() => useSesiKerja('p1', true));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(result.current).toEqual({ status: 'menunggu', jamMasuk: null, jamPulang: null, durasi: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('hadir: durasi bertambah tiap menit tanpa kueri baru', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-11-04T01:10:00.000Z')); // 08.10 WIB
    mocks.hasil = { data: { jam_masuk: '2026-11-04T00:58:00.000Z', jam_pulang: null, status: 'approved' }, error: null };
    const { result } = renderHook(() => useSesiKerja('p1', true));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('hadir');
    expect(result.current.durasi).toBe('12 m');
    const kueri = mocks.ops.filter(([m]) => m === 'from').length;
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.durasi).toBe('13 m');
    expect(mocks.ops.filter(([m]) => m === 'from').length).toBe(kueri);
  });
});
