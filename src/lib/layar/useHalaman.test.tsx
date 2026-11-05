// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHalaman } from './useHalaman';

const daftar = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe('useHalaman: halaman berganti tiap 8 detik secara berputar', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('<= 8 item: satu halaman, tidak pernah berganti', async () => {
    const { result } = renderHook(() => useHalaman(daftar(8)));
    expect(result.current.total).toBe(1);
    expect(result.current.item).toHaveLength(8);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(result.current.indeks).toBe(0);
  });

  it('19 item: 3 halaman (8, 8, 3), berganti tepat 8 detik, lalu kembali ke awal', async () => {
    const data = daftar(19);
    const { result } = renderHook(() => useHalaman(data));
    expect(result.current.total).toBe(3);
    expect(result.current.item.map(x => x)).toEqual(daftar(8));
    await act(async () => { await vi.advanceTimersByTimeAsync(7_999); });
    expect(result.current.indeks).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.indeks).toBe(1);
    expect(result.current.item).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(result.current.item).toEqual([17, 18, 19]);
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(result.current.indeks).toBe(0);
  });

  it('larik baru dengan isi setara (muat ulang data) tidak mengulang hitung mundur halaman', async () => {
    const { result, rerender } = renderHook(({ d }) => useHalaman(d), { initialProps: { d: daftar(19) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    rerender({ d: daftar(19) });
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(result.current.indeks).toBe(1);
  });

  it('jumlah halaman menyusut: indeks tidak melewati halaman terakhir', async () => {
    const { result, rerender } = renderHook(({ d }) => useHalaman(d), { initialProps: { d: daftar(19) } });
    await act(async () => { await vi.advanceTimersByTimeAsync(16_000); });
    expect(result.current.indeks).toBe(2);
    rerender({ d: daftar(9) });
    expect(result.current.indeks).toBeLessThan(result.current.total);
    expect(result.current.item.length).toBeGreaterThan(0);
  });

  it('kosong: tanpa halaman', () => {
    const { result } = renderHook(() => useHalaman<number>([]));
    expect(result.current.total).toBe(0);
    expect(result.current.item).toEqual([]);
  });
});
