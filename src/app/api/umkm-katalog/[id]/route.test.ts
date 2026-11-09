// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, cache } = vi.hoisted(() => ({ rpc: vi.fn(), cache: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...args: unknown[]) => unknown) => {
  return (...args: unknown[]) => { cache(); return fn(...args); };
} }));
import { GET } from './route';
const id = '660e8400-e29b-41d4-a716-446655440001';
const ctx = { params: Promise.resolve({ id }) };
beforeEach(() => { vi.clearAllMocks(); });
describe('detail publik selalu hidup', () => {
  it('tidak masuk cache dan hidden/absent selalu 404', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'TIDAK_DITEMUKAN' } });
    for (let i=0;i<2;i++) {
      const r = await GET(new Request(`https://lmh.example/profil/${id}`), ctx);
      expect(r.status).toBe(404);
      expect(r.headers.get('Cache-Control')).toContain('no-store');
    }
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(cache).not.toHaveBeenCalled();
  });
  it('UUID salah 400 dan migrasi belum diterapkan 503', async () => {
    expect((await GET(new Request('https://lmh.example/profil/x'),
      { params: Promise.resolve({ id: 'x' }) })).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: '42883' } });
    expect((await GET(new Request('https://lmh.example/profil'), ctx)).status).toBe(503);
  });
});
