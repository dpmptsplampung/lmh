// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { rpc, cache, tersimpan, revalidateTag } = vi.hoisted(() => ({
  rpc: vi.fn(), cache: vi.fn(), tersimpan: new Map<string, unknown>(), revalidateTag: vi.fn(),
}));
vi.mock('@/lib/umkm-katalog/statistik-server', () => ({ catatTanpaHasil: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>) => async (...args: unknown[]) => {
    cache(...args);
    const key = JSON.stringify(args);
    if (!tersimpan.has(key)) tersimpan.set(key, await fn(...args));
    return tersimpan.get(key);
  },
  revalidateTag,
}));
import { GET } from './route';
import { catatTanpaHasil } from '@/lib/umkm-katalog/statistik-server';
beforeEach(() => {
  vi.clearAllMocks(); tersimpan.clear();
  revalidateTag.mockImplementation(() => tersimpan.clear());
  rpc.mockResolvedValue({ data: { items: [], next_cursor: null }, error: null });
});
describe('katalog publik melalui RPC anon', () => {
  it('urutan tunggal baru dan tanpa hasil hanya halaman pertama', async () => {
    const first = new Request('https://lmh.example/api/umkm-katalog?kategori=Pangan');
    expect((await GET(first)).status).toBe(200);
    expect(rpc).toHaveBeenLastCalledWith('umkm_cari_katalog', expect.objectContaining({ p_sort: 'paling_sesuai' }));
    expect(catatTanpaHasil).toHaveBeenCalledWith(first, 'Pangan', null);
    vi.mocked(catatTanpaHasil).mockClear();
    await GET(new Request(`https://lmh.example/api/umkm-katalog?cursor=${btoa('{}')}.${'a'.repeat(64)}`));
    expect(catatTanpaHasil).not.toHaveBeenCalled();
    expect((await GET(new Request('https://lmh.example/api/umkm-katalog?sort=terbaru'))).status).toBe(400);
  });
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
  it('409 menghapus cache snapshot lama sehingga mulai ulang mendapat cursor baru', async () => {
    const first = () => GET(new Request('https://lmh.example/api/umkm-katalog'));
    const lama = { items: [{ id: 'lama' }], next_cursor: 'cursor-lama' };
    const baru = { items: [{ id: 'baru' }], next_cursor: 'cursor-baru' };
    rpc.mockResolvedValueOnce({ data: lama, error: null });
    expect((await (await first()).json()).data).toEqual(lama);
    expect((await (await first()).json()).data).toEqual(lama);
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'P0001', message: 'SNAPSHOT_BERUBAH' } });
    const lanjut = await GET(new Request(
      `https://lmh.example/api/umkm-katalog?cursor=${btoa('{}')}.${'a'.repeat(64)}`));
    expect(lanjut.status).toBe(409);
    expect(revalidateTag).toHaveBeenCalledWith('umkm-katalog', { expire: 0 });
    rpc.mockResolvedValueOnce({ data: baru, error: null });
    expect((await (await first()).json()).data).toEqual(baru);
    expect(rpc).toHaveBeenCalledTimes(3);
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
