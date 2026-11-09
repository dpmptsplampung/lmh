// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, cache } = vi.hoisted(() => ({ rpc: vi.fn(), cache: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: (...args: unknown[]) => unknown) => {
  return (...args: unknown[]) => { cache(...args); return fn(...args); };
} }));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks(); rpc.mockResolvedValue({ data: { items: [], next_cursor: null }, error: null });
});
describe('katalog publik melalui RPC anon', () => {
  it('kartu awal tanpa filter memakai cache', async () => {
    const r = await GET(new Request('https://lmh.example/api/umkm-katalog'));
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(cache).toHaveBeenCalledTimes(1);
  });
  it.each(['q=keripik', 'jenis=Produk', 'kategori=Pangan', 'spesifik=Kopi', 'kabupaten_kota=Lampung',
    `cursor=${btoa('{}')}.${'a'.repeat(64)}`])('parameter %s membaca DB tanpa cache', async query => {
    const r = await GET(new Request(`https://lmh.example/api/umkm-katalog?${query}`));
    expect(r.status).toBe(200);
    expect(cache).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('parameter asing/duplikat dan query panjang ditolak', async () => {
    for (const query of ['nomor=123', 'jenis=a&jenis=b', `q=${'a'.repeat(101)}`]) {
      expect((await GET(new Request(`https://lmh.example/api/umkm-katalog?${query}`))).status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it('migrasi belum ada 503 dan cursor rusak 400, tanpa rincian DB', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'private input' } });
    const r = await GET(new Request('https://lmh.example/api/umkm-katalog?q=a'));
    expect(r.status).toBe(503);
    expect(JSON.stringify(await r.json())).not.toContain('private input');
    rpc.mockResolvedValueOnce({ data: null, error: { code: '22023', message: 'INPUT_TIDAK_VALID' } });
    expect((await GET(new Request('https://lmh.example/api/umkm-katalog?cursor=rusak'))).status).toBe(400);
  });
});
