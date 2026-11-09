// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
const { rpc, cache } = vi.hoisted(() => ({ rpc: vi.fn(), cache: new Map<string, Promise<unknown>>() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => {
  return (...args: unknown[]) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key);
  };
} }));
import { GET } from '@/app/api/umkm-katalog/route';
afterEach(() => { vi.useRealTimers(); rpc.mockReset(); cache.clear(); });
describe('batas umur kartu dalam cache bersama', () => {
  it('cache yang tetap menyajikan entri lama tidak memperpanjang umur di atas 60 detik', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T00:00:00Z'));
    rpc.mockResolvedValueOnce({ data: { items: [{ id: 'profil-lama' }], next_cursor: null }, error: null })
      .mockResolvedValueOnce({ data: { items: [], next_cursor: null }, error: null });
    const req = () => new Request('https://lmh.example/api/umkm-katalog');
    expect((await (await GET(req())).json()).data.items).toHaveLength(1);
    expect((await (await GET(req())).json()).data.items).toHaveLength(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60001);
    expect((await (await GET(req())).json()).data.items).toEqual([]);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
