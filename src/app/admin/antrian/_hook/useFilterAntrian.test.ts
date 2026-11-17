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
    act(() => result.current.ubahTanggal('2026-11-04'));
    expect(result.current.tanggal).toBe('2026-11-04');
    expect(result.current.halaman).toBe(0);
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?tanggal=2026-11-04&status=semua', { scroll: false });
    nav.replace.mockClear();
    act(() => result.current.ubahTanggal(''));
    expect(result.current.tanggal).toBe('2026-11-04');
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it.each([-60, 60])('ubahTanggal menerima tanggal %i hari dari hari ini dan menulis URL', (hari) => {
    const { result } = renderHook(() => useFilterAntrian());
    act(() => result.current.ubahTanggal(geser(hari)));
    expect(result.current.tanggal).toBe(geser(hari));
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?tanggal=' + geser(hari), { scroll: false });
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

  it('layanan: dibaca dari URL, null bila tak ada; gantiLayanan menulis URL, halaman kembali 0; pilihan sama tidak berbuat apa-apa', () => {
    const UUID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
    const { result } = renderHook(() => useFilterAntrian());
    expect(result.current.layanan).toBeNull();
    act(() => result.current.gantiLayanan(null));
    expect(nav.replace).not.toHaveBeenCalled();
    act(() => result.current.gantiHalaman(2));
    nav.replace.mockClear();
    act(() => result.current.gantiLayanan(UUID));
    expect(result.current.layanan).toBe(UUID);
    expect(result.current.halaman).toBe(0);
    expect(nav.replace).toHaveBeenLastCalledWith(`/admin/antrian?layanan=${UUID}`, { scroll: false });
    act(() => result.current.gantiStatus('semua'));
    expect(nav.replace).toHaveBeenLastCalledWith(`/admin/antrian?status=semua&layanan=${UUID}`, { scroll: false });
    act(() => result.current.gantiLayanan(null));
    expect(nav.replace).toHaveBeenLastCalledWith('/admin/antrian?status=semua', { scroll: false });
  });

  it('layanan dari URL dibaca saat awal; nilai bukan UUID diabaikan', () => {
    const UUID = '3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b';
    nav.query = `layanan=${UUID}`;
    expect(renderHook(() => useFilterAntrian()).result.current.layanan).toBe(UUID);
    nav.query = 'layanan=bukan-uuid';
    expect(renderHook(() => useFilterAntrian()).result.current.layanan).toBeNull();
  });
});
