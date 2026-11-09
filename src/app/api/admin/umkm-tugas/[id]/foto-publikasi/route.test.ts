// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/umkm-katalog/foto-server', () => ({ publikasiFoto: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { publikasiFoto } from '@/lib/umkm-katalog/foto-server';
import { POST } from './route';
const id = '660e8400-e29b-41d4-a716-446655440001';
const ctx = { params: Promise.resolve({ id }) };
let rpc: ReturnType<typeof vi.fn>;
const req = (body: unknown = {}) => new Request('https://lmh.example/retry',
  { method: 'POST', body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks(); rpc = vi.fn().mockResolvedValue({ data: { dipegang_saya: true }, error: null });
  const mockClient = { rpc, auth: { getUser: async () => ({ data: { user: { id } } }) } };
  vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>);
  vi.mocked(publikasiFoto).mockResolvedValue({ status: 'tertunda', tertunda: 1, hapus_tertunda: 2 });
});
describe('retry foto publik privat', () => {
  it('tidak mengulang keputusan dan memberi status tertunda', async () => {
    const r = await POST(req(), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toContain('no-store');
    expect(await r.json()).toMatchObject({ data: { id, foto_publikasi: { status: 'tertunda', tertunda: 1, hapus_tertunda: 2 } } });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('non-pemegang dan body dengan key R2 ditolak sebelum salin', async () => {
    rpc.mockResolvedValue({ data: { dipegang_saya: false } });
    expect((await POST(req(), ctx)).status).toBe(403);
    expect((await POST(req({ r2_key: 'asing' }), ctx)).status).toBe(400);
    expect(publikasiFoto).not.toHaveBeenCalled();
  });
  it('modul belum dimigrasi menjadi 503', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } });
    expect((await POST(req(), ctx)).status).toBe(503);
    expect(publikasiFoto).not.toHaveBeenCalled();
  });
});
