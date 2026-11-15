// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const channels: Array<{ topic: string; tabel: string[] }> = [];
const removeChannel = vi.fn();
const callbacks: Array<(s: string) => void> = [];
// Pemicu postgres_changes per channel (untuk mensimulasikan perubahan tabel).
const pemicu = new Map<{ topic: string; tabel: string[] }, () => void>();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (name: string) => {
      const ch = { topic: name, tabel: [] as string[] };
      channels.push(ch);
      const rantai: { on: (...a: unknown[]) => typeof rantai; subscribe: (cb?: (s: string) => void) => string } = {
        on: (...a: unknown[]) => {
          const filter = a[1] as { table?: string } | undefined;
          if (filter?.table) ch.tabel.push(filter.table);
          if (typeof a[2] === 'function') pemicu.set(ch, a[2] as () => void);
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
import { setelUlangPusatRealtime } from '@/lib/realtime/pusat';

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

  // G4.6: kunci langganan = tabel (pusat realtime). Dulu satu channel gabungan per hook; kini satu channel per tabel
  // agar tab staf punya paling banyak satu channel per tabel dan sidebar + halaman berbagi.
  it('beberapa tabel: satu channel per tabel lewat pusat (tanpa duplikat), polling tetap jalan', () => {
    vi.useFakeTimers();
    channels.length = 0;
    const refetch = vi.fn(async () => {});
    const { unmount, rerender } = renderHook(() =>
      useRealtimeRefetch(refetch, { tables: ['tiket_antrean', 'penanganan'], table: 'penanganan', pollMs: 1000 }),
    );
    expect(channels).toHaveLength(2);
    expect(channels.map((c) => c.topic).sort()).toEqual(['staf-tabel-penanganan', 'staf-tabel-tiket_antrean']);
    expect(channels.flatMap((c) => c.tabel).sort()).toEqual(['penanganan', 'tiket_antrean']);
    // array baru tiap render tidak memicu langganan ulang
    rerender();
    expect(channels).toHaveLength(2);
    vi.advanceTimersByTime(2500);
    expect(refetch.mock.calls.length).toBeGreaterThanOrEqual(2);
    unmount();
    vi.useRealTimers();
  });

  describe('pusat realtime (G4.6): channel tabel dipakai bersama', () => {
    beforeEach(() => setelUlangPusatRealtime());
    it('sidebar (3 tabel) + admin/antrian (tiket_antrean) terbuka bersamaan = satu channel tiket_antrean', () => {
      vi.useFakeTimers();
      channels.length = 0;
      removeChannel.mockClear();
      const sidebar = renderHook(() =>
        useRealtimeRefetch(vi.fn(async () => {}), { tables: ['penanganan', 'chat_sesi', 'tiket_antrean'], pollMs: 30_000 }),
      );
      const antrian = renderHook(() =>
        useRealtimeRefetch(vi.fn(async () => {}), { table: 'tiket_antrean', pollMs: 30_000 }),
      );
      expect(channels.filter((c) => c.tabel.includes('tiket_antrean'))).toHaveLength(1);
      expect(channels).toHaveLength(3);
      antrian.unmount();
      expect(removeChannel).not.toHaveBeenCalled();
      sidebar.unmount();
      expect(removeChannel).toHaveBeenCalledTimes(3);
      vi.useRealTimers();
    });

    it('perubahan tabel memicu refetch (debounce 500 ms) di semua pemakai', () => {
      vi.useFakeTimers();
      channels.length = 0;
      const a = vi.fn(async () => {});
      const b = vi.fn(async () => {});
      const ra = renderHook(() => useRealtimeRefetch(a, { table: 'penanganan', pollMs: 30_000 }));
      const rb = renderHook(() => useRealtimeRefetch(b, { table: 'penanganan', pollMs: 30_000 }));
      expect(channels).toHaveLength(1);
      act(() => { pemicu.get(channels[0])?.(); });
      vi.advanceTimersByTime(500);
      expect(a).toHaveBeenCalledTimes(1);
      expect(b).toHaveBeenCalledTimes(1);
      ra.unmount();
      rb.unmount();
      vi.useRealTimers();
    });

    it('bergabung ke channel yang sudah tersambung: langsung memakai jeda 120 dtk', () => {
      vi.useFakeTimers();
      channels.length = 0;
      callbacks.length = 0;
      const r1 = renderHook(() => useRealtimeRefetch(vi.fn(async () => {}), { table: 'penanganan' }));
      act(() => callbacks.forEach((cb) => cb('SUBSCRIBED')));
      const refetch = vi.fn(async () => {});
      const r2 = renderHook(() => useRealtimeRefetch(refetch, { table: 'penanganan' }));
      vi.advanceTimersByTime(119_000);
      expect(refetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1_000);
      expect(refetch).toHaveBeenCalledTimes(1);
      // Channel bersama putus: kedua pemakai kembali ke 30 dtk.
      act(() => callbacks.forEach((cb) => cb('CHANNEL_ERROR')));
      vi.advanceTimersByTime(30_000);
      expect(refetch).toHaveBeenCalledTimes(2);
      r1.unmount();
      r2.unmount();
      vi.useRealTimers();
    });
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

    it('peristiwa Realtime saat tersembunyi: nol refetch; kembali terlihat: tepat satu', () => {
      vi.useFakeTimers();
      setelUlangPusatRealtime();
      channels.length = 0;
      const refetch = vi.fn(async () => {});
      const { unmount } = renderHook(() => useRealtimeRefetch(refetch, { table: 'penanganan', pollMs: 30_000 }));
      const ubah = pemicu.get(channels[0])!;
      setHidden(true);
      act(() => { ubah(); ubah(); ubah(); });
      vi.advanceTimersByTime(300_000);
      expect(refetch).not.toHaveBeenCalled();
      setHidden(false);
      expect(refetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000); // tidak ada debounce tertunda yang menjadi request kedua
      expect(refetch).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('peristiwa lalu tab disembunyikan selama debounce: nol refetch; kembali terlihat: tepat satu', () => {
      const { refetch, unmount } = mulai();
      const kanalTopik = channels.filter((c) => c.topic === 'realtime-refetch-t').at(-1)!;
      act(() => { pemicu.get(kanalTopik)?.(); });
      setHidden(true);
      vi.advanceTimersByTime(10_000);
      expect(refetch).not.toHaveBeenCalled();
      setHidden(false);
      expect(refetch).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1_000);
      expect(refetch).toHaveBeenCalledTimes(1);
      unmount();
    });

    it('peristiwa saat terlihat tetap memicu satu refetch setelah debounce 500 ms', () => {
      const { refetch, unmount } = mulai();
      const kanalTopik = channels.filter((c) => c.topic === 'realtime-refetch-t').at(-1)!;
      act(() => { pemicu.get(kanalTopik)?.(); pemicu.get(kanalTopik)?.(); });
      vi.advanceTimersByTime(499);
      expect(refetch).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(refetch).toHaveBeenCalledTimes(1);
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
