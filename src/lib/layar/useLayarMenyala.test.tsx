// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayarMenyala } from './useLayarMenyala';

const maju = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useLayarMenyala', () => {
  it('tetap berjalan tanpa Wake Lock dan menyembunyikan kursor setelah 5 detik, lalu muncul saat gerak', async () => {
    const { result } = renderHook(() => useLayarMenyala());
    expect(result.current.kursorTersembunyi).toBe(false);
    await maju(4999);
    expect(result.current.kursorTersembunyi).toBe(false);
    await maju(1);
    expect(result.current.kursorTersembunyi).toBe(true);
    act(() => { window.dispatchEvent(new MouseEvent('mousemove')); });
    expect(result.current.kursorTersembunyi).toBe(false);
    await maju(5000);
    expect(result.current.kursorTersembunyi).toBe(true);
  });
  it('meminta screen, memasang ulang setelah terlihat dan melepas saat unmount', async () => {
    let visible: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ released: false, release });
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const { unmount } = renderHook(() => useLayarMenyala());
    await maju(0);
    expect(request).toHaveBeenCalledWith('screen');
    visible = 'hidden';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await maju(0);
    expect(request).toHaveBeenCalledTimes(1);
    visible = 'visible';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await maju(0);
    expect(request).toHaveBeenCalledTimes(2);
    unmount();
    expect(release).toHaveBeenCalledTimes(2);
    Reflect.deleteProperty(navigator, 'wakeLock');
  });
  it('melepas permintaan yang selesai sesudah unmount dan menahan penolakan API', async () => {
    let selesai!: (lock: { released: boolean; release: () => Promise<void> }) => void;
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockImplementationOnce(() => new Promise(resolve => { selesai = resolve; }))
      .mockRejectedValue(new Error('ditolak'));
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
    const { unmount } = renderHook(() => useLayarMenyala());
    unmount();
    await act(async () => { selesai({ released: false, release }); });
    expect(release).toHaveBeenCalledOnce();
    renderHook(() => useLayarMenyala());
    await maju(0);
    Reflect.deleteProperty(navigator, 'wakeLock');
  });
});
