// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({ createClient: vi.fn() }));

import { createClient } from '@/lib/supabase/client';
import { useAntreanFeed } from './useAntreanFeed';

let picuSiaran: (() => void) | null = null;
let statusChannel: ((s: string) => void) | null = null;

function pasang() {
  const api = {
    on: vi.fn((_t: string, _f: unknown, cb: () => void) => { picuSiaran = cb; return api; }),
    subscribe: vi.fn((cb?: (s: string) => void) => { statusChannel = cb ?? null; return api; }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    channel: vi.fn(() => api),
    removeChannel: vi.fn().mockResolvedValue('ok'),
  });
}

const maju = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

describe('useAntreanFeed jeda polling per status channel', () => {
  let ambil: ReturnType<typeof vi.fn<() => Promise<{ data: Array<{ id: number }>; error: null }>>>;
  beforeEach(() => {
    vi.useFakeTimers();
    picuSiaran = null; statusChannel = null;
    pasang();
    ambil = vi.fn<() => Promise<{ data: Array<{ id: number }>; error: null }>>(async () => ({ data: [{ id: 1 }], error: null }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('belum tersambung: polling tiap 15 dtk', async () => {
    renderHook(() => useAntreanFeed({ aktif: true, ambil }));
    await maju(0);
    expect(ambil).toHaveBeenCalledTimes(1);
    await maju(14_999);
    expect(ambil).toHaveBeenCalledTimes(1);
    await maju(1);
    expect(ambil).toHaveBeenCalledTimes(2);
  });

  it('tersambung: polling tiap 30 dtk', async () => {
    renderHook(() => useAntreanFeed({ aktif: true, ambil }));
    await maju(0);
    act(() => statusChannel?.('SUBSCRIBED'));
    await maju(29_999);
    expect(ambil).toHaveBeenCalledTimes(1);
    await maju(1);
    expect(ambil).toHaveBeenCalledTimes(2);
  });

  it('siaran realtime tetap memicu muat seketika (debounce) saat tersambung', async () => {
    renderHook(() => useAntreanFeed({ aktif: true, ambil }));
    await maju(0);
    act(() => statusChannel?.('SUBSCRIBED'));
    act(() => picuSiaran?.());
    await maju(300);
    expect(ambil).toHaveBeenCalledTimes(2);
  });

  it('putus lagi: kembali ke 15 dtk', async () => {
    renderHook(() => useAntreanFeed({ aktif: true, ambil }));
    await maju(0);
    act(() => statusChannel?.('SUBSCRIBED'));
    act(() => statusChannel?.('CLOSED'));
    await maju(15_000);
    expect(ambil).toHaveBeenCalledTimes(2);
  });

  it('unmount: tidak ada timer tersisa, status terlambat diabaikan', async () => {
    const { unmount } = renderHook(() => useAntreanFeed({ aktif: true, ambil }));
    await maju(0);
    unmount();
    act(() => statusChannel?.('SUBSCRIBED'));
    expect(vi.getTimerCount()).toBe(0);
  });
});
