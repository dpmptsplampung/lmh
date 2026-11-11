// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const channels: Array<{ topic: string; tabel: string[] }> = [];
const removeChannel = vi.fn();
const callbacks: Array<(s: string) => void> = [];

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (name: string) => {
      const ch = { topic: name, tabel: [] as string[] };
      channels.push(ch);
      const rantai: { on: (...a: unknown[]) => typeof rantai; subscribe: (cb?: (s: string) => void) => string } = {
        on: (...a: unknown[]) => {
          const filter = a[1] as { table?: string } | undefined;
          if (filter?.table) ch.tabel.push(filter.table);
          return rantai;
        },
        subscribe: (cb?: (s: string) => void) => {
          if (cb) callbacks.push(cb);
          return 'SUBSCRIBED';
        },
      };
      return rantai;
    },
    removeChannel,
  }),
}));

import { useRealtimeRefetch } from './useRealtimeRefetch';

describe('useRealtimeRefetch', () => {
  it('berlangganan topik broadcast + polling cadangan, bersih saat unmount', () => {
    vi.useFakeTimers();
    const refetch = vi.fn(async () => {});
    const { unmount } = renderHook(() =>
      useRealtimeRefetch(refetch, { topic: 'antrean:publik', pollMs: 1000 }),
    );
    vi.advanceTimersByTime(3500);
    expect(refetch.mock.calls.length).toBeGreaterThanOrEqual(3); // polling
    unmount();
    expect(removeChannel).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('beberapa tabel: satu channel, satu listener postgres_changes per tabel (tanpa duplikat), polling tetap jalan', () => {
    vi.useFakeTimers();
    channels.length = 0;
    const refetch = vi.fn(async () => {});
    const { unmount, rerender } = renderHook(() =>
      useRealtimeRefetch(refetch, { tables: ['tiket_antrean', 'penanganan'], table: 'penanganan', pollMs: 1000 }),
    );
    expect(channels).toHaveLength(1);
    expect(channels[0].topic).toBe('realtime-refetch-table-penanganan+tiket_antrean');
    expect(channels[0].tabel.sort()).toEqual(['penanganan', 'tiket_antrean']);
    // array baru tiap render tidak memicu langganan ulang
    rerender();
    expect(channels).toHaveLength(1);
    vi.advanceTimersByTime(2500);
    expect(refetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    unmount();
    vi.useRealTimers();
  });

  describe('polling adaptif', () => {
    const setHidden = (h: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    const mulai = () => {
      vi.useFakeTimers();
      callbacks.length = 0;
      const refetch = vi.fn(async () => {});
      const r = renderHook(() =>
        useRealtimeRefetch(refetch, { topic: 't', pollMs: 30_000, pollSaatTersambungMs: 120_000 }),
      );
      return { refetch, ...r };
    };
    afterEach(() => {
      setHidden(false);
      vi.useRealTimers();
    });

    it('(a) belum tersambung: refetch tiap 30 dtk', () => {
      const { refetch, unmount } = mulai();
      vi.advanceTimersByTime(30_000);
      expect(refetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(30_000);
      expect(refetch).toHaveBeenCalledTimes(2);
      unmount();
    });

    it('(b) tersambung: tidak ada refetch sampai 120 dtk', () => {
      const { refetch, unmount } = mulai();
      act(() => callbacks.forEach((cb) => cb('SUBSCRIBED')));
      vi.advanceTimersByTime(119_000);
      expect(refetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(refetch).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('putus lagi: kembali ke jeda 30 dtk', () => {
      const { refetch, unmount } = mulai();
      act(() => callbacks.forEach((cb) => cb('SUBSCRIBED')));
      act(() => callbacks.forEach((cb) => cb('CHANNEL_ERROR')));
      vi.advanceTimersByTime(30_000);
      expect(refetch).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('(c) tersembunyi: nol refetch; (d) kembali terlihat: tepat satu', () => {
      const { refetch, unmount } = mulai();
      setHidden(true);
      vi.advanceTimersByTime(300_000);
      expect(refetch).not.toHaveBeenCalled();
      setHidden(false);
      expect(refetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(30_000);
      expect(refetch).toHaveBeenCalledTimes(2); // dijadwalkan lagi
      unmount();
    });

    it('(e) unmount: tidak ada timer tersisa dan status terlambat diabaikan', () => {
      const { refetch, unmount } = mulai();
      unmount();
      act(() => callbacks.forEach((cb) => cb('SUBSCRIBED')));
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(300_000);
      expect(refetch).not.toHaveBeenCalled();
      setHidden(false);
      expect(refetch).not.toHaveBeenCalled();
    });
  });
});
