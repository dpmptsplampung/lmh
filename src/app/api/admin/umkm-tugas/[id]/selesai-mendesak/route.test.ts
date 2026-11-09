// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/umkm-katalog/foto-server', () => ({
  setelahVisibilitas: vi.fn(async (data: object) => ({ ...data, foto_publikasi: {
    status: 'tertunda', tertunda: 0, hapus_tertunda: 1,
  } })),
}));
import { createClient } from '@/lib/supabase/server';
import { POST } from './route';
import { setelahVisibilitas } from '@/lib/umkm-katalog/foto-server';
const id = '660e8400-e29b-41d4-a716-446655440001';
const body = {
  "expected_version": 2,
  "operasi_id": "660e8400-e29b-41d4-a716-446655440002"
};
let rpc: ReturnType<typeof vi.fn>;
let masuk = true;
const req = () => new Request('https://lmh.example/api/test', { method: 'POST', body: JSON.stringify(body) });
const jalankan = (request = req()) => POST(request, { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.clearAllMocks(); masuk = true;
  rpc = vi.fn().mockResolvedValue({ data: { id }, error: null });
  vi.mocked(createClient).mockResolvedValue({ rpc, auth: {
    getUser: async () => ({ data: { user: masuk ? { id } : null }, error: null }),
  } } as unknown as Awaited<ReturnType<typeof createClient>>);
});
describe('umkm_selesaikan_mendesak: batas route melalui JWT', () => {
  it('mengembalikan envelope dan no-store dari RPC yang ditetapkan', async () => {
    const r = await jalankan();
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('umkm_selesaikan_mendesak', expect.any(Object));
    expect(await r.json()).toMatchObject({ data: { id }, meta: { request_id: expect.any(String) } });
  });
  it('mutasi sukses memicu pembersihan dan menyampaikan jumlah hapus tertunda', async () => {
    const r = await jalankan();
    expect(r.status).toBe(200);
    expect(setelahVisibilitas).toHaveBeenCalledTimes(1);
    expect(await r.json()).toMatchObject({ data: { id,
      foto_publikasi: { status: 'tertunda', tertunda: 0, hapus_tertunda: 1 } } });
  });
  it('field asing ditolak sebelum RPC', async () => {
    expect((await jalankan(new Request('https://lmh.example/api/test', { method: 'POST',
      body: JSON.stringify({ ...body, aktor_id: id }) }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('tanpa sesi ditolak sebelum RPC', async () => {
    masuk = false;
    expect((await jalankan()).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each([
    ['42501', 'DILARANG', 403], ['PGRST202', 'MODUL_BELUM_TERSEDIA', 503],
    ['P0001', 'TERLALU_BANYAK', 429], ['40001', 'KONFLIK_VERSI', 409],
  ])('galat %s tetap aman dan no-store', async (code, message, status) => {
    rpc.mockResolvedValue({ data: null, error: { code, message, details: 'isi privat' } });
    const r = await jalankan();
    expect(r.status).toBe(status);
    expect(setelahVisibilitas).not.toHaveBeenCalled();
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    if (status===429) expect(r.headers.get('Retry-After')).toBe('60');
    expect(JSON.stringify(await r.json())).not.toContain('isi privat');
  });
});
