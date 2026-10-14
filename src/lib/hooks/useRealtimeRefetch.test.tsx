// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const channels: Array<{ topic: string; tabel: string[] }> = [];
const removeChannel = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (name: string) => {
      const ch = { topic: name, tabel: [] as string[] };
      channels.push(ch);
      const rantai: { on: (...a: unknown[]) => typeof rantai; subscribe: () => string } = {
        on: (...a: unknown[]) => {
          const filter = a[1] as { table?: string } | undefined;
          if (filter?.table) ch.tabel.push(filter.table);
          return rantai;
        },
        subscribe: () => 'SUBSCRIBED',
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
});
