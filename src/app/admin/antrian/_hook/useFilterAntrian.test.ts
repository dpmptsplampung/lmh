// @vitest-environment jsdom
// Kontrak useFilterAntrian (tugas 5.3): tanggal, saringan status, dan halaman antrean hidup di URL (A13).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';

const nav = vi.hoisted(() => ({ query: '', replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => '/admin/antrian',
  useSearchParams: () => new URLSearchParams(nav.query),
}));

import { addDaysWIB, todayWIB } from '@/lib/time';
import { useFilterAntrian } from './useFilterAntrian';

const hariIni = todayWIB();
const geser = (hari: number) => addDaysWIB(hari);

beforeEach(() => {
  nav.query = '';
  nav.replace.mockClear();
});

describe('useFilterAntrian', () => {
  it('nilai awal dari URL; tanpa parameter = hari ini, tab Aktif, halaman 0', () => {
    const { result } = renderHook(() => useFilterAntrian());
    expect(result.current.tanggal).toBe(hariIni);
    expect(result.current.filterStatus).toBe('aktif');
    expect(result.current.halaman).toBe(0);

    nav.query = 'tanggal=2026-11-04&status=semua&halaman=3';
    const { result: r2 } = renderHook(() => useFilterAntrian());
    expect([r2.current.tanggal, r2.current.filterStatus, r2.current.halaman]).toEqual(['2026-11-04', 'semua', 2]);
  });

  it('URL berubah dari luar (tombol kembali): state mengikuti', () => {
    const { result, rerender } = renderHook(() => useFilterAntrian());
    nav.query = 'tanggal=2026-11-04&status=selesai';
    rerender();
    expect([result.current.tanggal, result.current.filterStatus, result.current.halaman]).toEqual(['2026-11-04', 'selesai', 0]);
  });

  it('ubahTanggal: tulis URL tanpa riwayat, halaman kembali 0; kosong diabaikan', () => {
    nav.query = 'status=semua&halaman=2';
    const { result } = renderHook(() => useFilterAntrian());
    act(() => result.current.ubahTanggal('2026-11-04', null));
    expect(result.current.tanggal).toBe('2026-11-04');
    expect(result.current.halaman).toBe(0);
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?tanggal=2026-11-04&status=semua', { scroll: false });
    nav.replace.mockClear();
    act(() => result.current.ubahTanggal('', null));
    expect(result.current.tanggal).toBe('2026-11-04');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('ubahTanggal di luar jendela FO: pesan batas, tanggal dan URL tetap; tanggal sah menghapus pesan', () => {
    const { result } = renderHook(() => useFilterAntrian());
    const jendela = { min: geser(-7), max: geser(1) };
    act(() => result.current.ubahTanggal(geser(-30), jendela));
    expect(result.current.tanggal).toBe(hariIni);
    expect(result.current.pesanTanggal).toMatch(/\S/);
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => result.current.ubahTanggal(geser(-1), jendela));
    expect(result.current.pesanTanggal).toBeNull();
    expect(result.current.tanggal).toBe(geser(-1));
  });

  it('gantiStatus: halaman 0 dan URL; status yang sama tidak berbuat apa-apa', () => {
    nav.query = 'halaman=2';
    const { result } = renderHook(() => useFilterAntrian());
    act(() => result.current.gantiStatus('aktif'));
    expect(nav.replace).not.toHaveBeenCalled();
    expect(result.current.halaman).toBe(1);
    act(() => result.current.gantiStatus('selesai'));
    expect(result.current.filterStatus).toBe('selesai');
    expect(result.current.halaman).toBe(0);
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?status=selesai', { scroll: false });
  });

  it('gantiHalaman menulis halaman ke URL (nilai bawaan tidak ditulis)', () => {
    const { result } = renderHook(() => useFilterAntrian());
    act(() => result.current.gantiHalaman(2));
    expect(result.current.halaman).toBe(2);
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?halaman=3', { scroll: false });
    act(() => result.current.gantiHalaman(0));
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian', { scroll: false });
  });
});
