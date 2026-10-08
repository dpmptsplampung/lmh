// @vitest-environment node
// RBAC Tahap 0 (S5): route ini memakai service-role setelah cek admin -> admin NONAKTIF ditolak.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/env/server', () => ({ parseServerEnv: vi.fn(() => ({})) }));

import type { NextRequest } from 'next/server';

const req = () =>
  new Request('http://localhost/api/admin/dokumen/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dokumen_id: '660e8400-e29b-41d4-a716-446655440001' }),
  }) as unknown as NextRequest;

async function setup(row: { role: string; aktif: boolean } | null) {
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: row }) }),
      }),
    }),
  });
  const svcMod = await import('@/lib/supabase/service');
  const svc = svcMod.createServiceRoleClient as unknown as ReturnType<typeof vi.fn>;
  svc.mockClear();
  return svc;
}

describe('POST /api/admin/dokumen/embed — akses', () => {
  beforeEach(() => vi.resetModules());

  it('admin NONAKTIF ditolak 403 dan service-role tidak dibuat', async () => {
    const svc = await setup({ role: 'admin', aktif: false });
    const { POST } = await import('./route');
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(svc).not.toHaveBeenCalled();
  });

  it('petugas ditolak 403', async () => {
    const svc = await setup({ role: 'petugas', aktif: true });
    const { POST } = await import('./route');
    expect((await POST(req())).status).toBe(403);
    expect(svc).not.toHaveBeenCalled();
  });

  it('admin aktif lolos cek akses (dilanjutkan ke pembuatan service-role)', async () => {
    const svc = await setup({ role: 'admin', aktif: true });
    svc.mockImplementation(() => { throw new Error('lanjut'); });
    const { POST } = await import('./route');
    await expect(POST(req())).rejects.toThrow('lanjut');
    expect(svc).toHaveBeenCalled();
  });
});
