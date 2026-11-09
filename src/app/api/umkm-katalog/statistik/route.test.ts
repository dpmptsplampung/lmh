// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser } }) }));
import { POST } from './route';
const id = '660e8400-e29b-41d4-a716-446655440001';
const req = (body: object = { jenis: 'dilihat', profil_id: id }, headers: Record<string, string> = {}) =>
  new Request('https://lmh.example/api/umkm-katalog/statistik', {
    method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'Mozilla/5.0', ...headers },
  });
beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://db.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'kunci-uji';
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  rpc.mockResolvedValue({ data: { dicatat: true }, error: null });
});
it('cookie hanya dibuat bila RPC mencatat, tidak ada panggilan status tambahan', async () => {
  rpc.mockResolvedValueOnce({ data: { dicatat: false }, error: null });
  const off = await POST(req());
  expect(off.headers.get('set-cookie')).toBeNull();
  const on = await POST(req());
  expect(on.headers.get('set-cookie')).toMatch(/umkm_statistik=.*HttpOnly.*SameSite=lax/i);
  expect(on.headers.get('set-cookie')).toContain('Max-Age=86400');
  expect(rpc).toHaveBeenCalledTimes(2);
  expect(rpc).toHaveBeenLastCalledWith('umkm_catat_statistik', expect.objectContaining({
    p_jenis: 'dilihat', p_profil_id: id, p_aktor_uid: null, p_identitas: expect.any(String),
  }));
});
it('UID berasal sesi nonanon, sesi formulir anonim memakai cookie dan bot/prefetch dilewati', async () => {
  getUser.mockResolvedValueOnce({ data: { user: { id, is_anonymous: false } }, error: null });
  expect((await POST(req())).headers.get('set-cookie')).toBeNull();
  expect(rpc).toHaveBeenLastCalledWith('umkm_catat_statistik', expect.objectContaining({ p_aktor_uid: id }));
  getUser.mockResolvedValueOnce({ data: { user: { id, is_anonymous: true } }, error: null });
  const cookie = '660e8400-e29b-41d4-a716-446655440099';
  await POST(req(undefined, { cookie: `umkm_statistik=${cookie}` }));
  expect(rpc).toHaveBeenLastCalledWith('umkm_catat_statistik', expect.objectContaining({
    p_aktor_uid: null, p_identitas: cookie,
  }));
  rpc.mockClear();
  const excluded: Record<string, string>[] = [{ 'user-agent': 'crawler bot' }, { purpose: 'prefetch' }];
  for (const headers of excluded) {
    const r = await POST(req(undefined, headers));
    expect((await r.json()).data).toEqual({ dicatat: false });
  }
  expect(rpc).not.toHaveBeenCalled();
});
it('beacon hanya jenis dan profil, field identitas palsu ditolak tanpa echo', async () => {
  const r = await POST(req({ jenis: 'dilihat', profil_id: id, uid: 'private' }));
  expect(r.status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
  expect(JSON.stringify(await r.json())).not.toContain('private');
});
