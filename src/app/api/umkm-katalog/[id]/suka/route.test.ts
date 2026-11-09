// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
const { rpc, getUser } = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser }, rpc }) }));
import { GET, POST } from './route';
const id = '660e8400-e29b-41d4-a716-446655440001';
const ctx = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id } }, error: null });
  rpc.mockResolvedValue({ data: { suka_saya: true, suka: 1, profil_id: id }, error: null });
});
it('desired state dan status privat memakai JWT, sesi kosong ditolak', async () => {
  const r = await POST(new Request('https://lmh.example', {
    method: 'POST', body: JSON.stringify({ aktif: true }),
  }), ctx);
  expect(r.status).toBe(200);
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(rpc).toHaveBeenLastCalledWith('umkm_suka', { p_profil_id: id, p_aktif: true });
  expect((await GET(new Request('https://lmh.example'), ctx)).status).toBe(200);
  expect(rpc).toHaveBeenLastCalledWith('umkm_status_suka', { p_profil_id: id });
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect((await GET(new Request('https://lmh.example'), ctx)).status).toBe(401);
});
