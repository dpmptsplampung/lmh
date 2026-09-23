// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

const channels: Array<{ topic: string; listeners: number }> = [];
const removeChannel = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    channel: (name: string) => {
      channels.push({ topic: name, listeners: 0 });
      return {
        on: () => ({ subscribe: () => 'SUBSCRIBED' }),
      };
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
});
