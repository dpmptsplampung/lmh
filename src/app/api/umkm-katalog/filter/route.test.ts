// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
import { GET } from './route';
beforeEach(() => { rpc.mockReset(); });
describe('opsi filter approved dari DB', () => {
  it('mengembalikan opsi terbatas dan tidak membaca sesi pengguna', async () => {
    rpc.mockResolvedValue({ data: { jenis: ['Produk'], kategori: [], kabupaten_kota: [], terpotong: false } });
    const r = await GET(new Request('https://lmh.example/api/umkm-katalog/filter'));
    expect(r.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('umkm_filter_katalog', {});
    expect(await r.json()).toMatchObject({ data: { jenis: ['Produk'], terpotong: false } });
  });
  it('parameter asing 400 dan modul belum ada 503 dengan no-store', async () => {
    expect((await GET(new Request('https://lmh.example/filter?q=teks'))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    const r = await GET(new Request('https://lmh.example/filter'));
    expect(r.status).toBe(503);
    expect(r.headers.get('Cache-Control')).toContain('no-store');
  });
});
