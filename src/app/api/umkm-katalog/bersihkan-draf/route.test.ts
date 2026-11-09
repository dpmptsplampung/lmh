// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const { listObjects, deleteObjects, rpc, randomUUID, nowServer } = vi.hoisted(() => ({
  listObjects: vi.fn(), deleteObjects: vi.fn(), rpc: vi.fn(), randomUUID: vi.fn(), nowServer: vi.fn(),
}));
vi.mock('node:crypto', async importOriginal => ({
  ...await importOriginal<typeof import('node:crypto')>(), randomUUID,
}));
vi.mock('@/lib/time', () => ({ nowServer }));
vi.mock('@/lib/storage/r2', () => ({ listObjects, deleteObjects,
  r2Tersedia: () => true, bucketTerpisah: () => true }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
import { POST } from './route';
const req = (auth = 'Bearer rahasia-uji') => new Request('https://lmh.example/api/umkm-katalog/bersihkan-draf', {
  method: 'POST', headers: { authorization: auth },
});
beforeEach(() => {
  vi.resetAllMocks();
  randomUUID.mockReturnValue('m');
  nowServer.mockImplementation(() => new Date('2026-11-09T00:00:00Z'));
  process.env.CRON_SECRET = 'rahasia-uji';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'kunci-uji';
  deleteObjects.mockResolvedValue(undefined);
});
it('menelusuri halaman, melewati yang muda/dilindungi dan menghapus yatim tua', async () => {
  const tua = new Date(Date.now() - 100 * 86400000), muda = new Date();
  listObjects.mockResolvedValueOnce({ items: [{ key: 'umkm-draf/terbit.jpg', lastModified: tua },
    { key: 'umkm-draf/z-muda.jpg', lastModified: muda }], nextCursor: 'lanjut' })
    .mockResolvedValueOnce({ items: [{ key: 'umkm-draf/yatim.jpg', lastModified: tua }], nextCursor: null })
    .mockResolvedValueOnce({ items: [], nextCursor: null });
  rpc.mockResolvedValueOnce({ data: { dilindungi: ['umkm-draf/terbit.jpg'] }, error: null })
    .mockResolvedValueOnce({ data: { dilindungi: [] }, error: null });
  const r = await POST(req());
  expect(r.status).toBe(200);
  expect((await r.json()).data).toEqual({ dihapus: 1, selesai: true });
  expect(listObjects).toHaveBeenNthCalledWith(2, 'private', 'umkm-draf/', 'lanjut', undefined);
  expect(deleteObjects).toHaveBeenCalledExactlyOnceWith('private', ['umkm-draf/yatim.jpg']);
});
it('cron salah ditolak, galat RPC/R2 tidak menghapus foto terlindungi', async () => {
  expect((await POST(req('Bearer salah'))).status).toBe(401);
  expect(listObjects).not.toHaveBeenCalled();
  listObjects.mockResolvedValue({ items: [{ key: 'umkm-draf/a.jpg', lastModified: new Date(0) }],
    nextCursor: null });
  rpc.mockResolvedValue({ data: null, error: { code: '500', message: 'private' } });
  const r = await POST(req());
  expect(r.status).toBe(500);
  expect(deleteObjects).not.toHaveBeenCalled();
  expect(JSON.stringify(await r.json())).not.toContain('private');
});

it('tenggat pada prefix terlindungi tidak menghalangi yatim pada panggilan dengan titik mulai lain', async () => {
  randomUUID.mockReturnValueOnce('a').mockReturnValueOnce('x');
  listObjects.mockImplementation(async (_bucket, _prefix, _cursor, options) => {
    if (options?.startAfter === 'umkm-draf/a') {
      nowServer.mockReturnValue(new Date('2026-11-09T00:00:46Z'));
      return { items: [{ key: 'umkm-draf/b', lastModified: new Date(0) }], nextCursor: 'lanjut' };
    }
    return options?.startAfter
      ? { items: [{ key: 'umkm-draf/yatim', lastModified: new Date(0) }], nextCursor: null }
      : { items: [{ key: 'umkm-draf/b', lastModified: new Date(0) },
        { key: 'umkm-draf/yatim', lastModified: new Date(0) }], nextCursor: null };
  });
  rpc.mockResolvedValue({ data: { dilindungi: ['umkm-draf/b'] }, error: null });
  expect((await (await POST(req())).json()).data).toEqual({ dihapus: 0, selesai: false });
  nowServer.mockReturnValue(new Date('2026-11-09T00:01:00Z'));
  expect((await (await POST(req())).json()).data).toEqual({ dihapus: 1, selesai: true });
  expect(deleteObjects).toHaveBeenCalledExactlyOnceWith('private', ['umkm-draf/yatim']);
});
it('dua fase memeriksa setiap objek tepat sekali termasuk key yang sama dengan titik mulai', async () => {
  const item = (key: string) => ({ key: `umkm-draf/${key}`, lastModified: new Date(0) });
  listObjects.mockResolvedValueOnce({ items: [item('n'), item('z')], nextCursor: null })
    .mockResolvedValueOnce({ items: [item('a')], nextCursor: 'kedua' })
    .mockResolvedValueOnce({ items: [item('b'), item('m'), item('n')], nextCursor: 'tidak-dibaca' });
  rpc.mockImplementation(async (_fn, args) => ({ data: { dilindungi: args.p_keys }, error: null }));
  expect((await (await POST(req())).json()).data).toEqual({ dihapus: 0, selesai: true });
  expect(rpc.mock.calls.flatMap(([, args]) => args.p_keys).sort()).toEqual([
    'umkm-draf/a', 'umkm-draf/b', 'umkm-draf/m', 'umkm-draf/n', 'umkm-draf/z',
  ]);
  expect(listObjects).toHaveBeenCalledTimes(3);
});
