// @vitest-environment node
// RBAC Tahap 0 (S1/S11): nonaktifkan = Admin SAJA (FO ditolak), aktifkan kembali memakai RPC
// lewat service-role, admin NONAKTIF tidak dianggap aktor.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

import type { NextRequest } from 'next/server';

const req = (body: unknown): NextRequest =>
  new Request('http://localhost/api/admin/petugas/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const TARGET = '660e8400-e29b-41d4-a716-446655440001';

async function setup(opts: {
  user?: { id: string } | null;
  actor?: { id: string; role: string; aktif: boolean } | null;
  rpcError?: { message: string; code?: string } | null;
}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const user = opts.user === undefined ? { id: 'auth-1' } : opts.user;
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: opts.actor ?? null }),
        }),
      }),
    }),
  });
  const rpc = vi.fn().mockResolvedValue({ error: opts.rpcError ?? null });
  const insert = vi.fn().mockResolvedValue({ error: null });
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    rpc,
    from: vi.fn().mockReturnValue({ insert }),
  });
  return { rpc, insert };
}

describe('POST /api/admin/petugas/status', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('401 tanpa login', async () => {
    const { rpc } = await setup({ user: null });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('401 untuk admin NONAKTIF', async () => {
    const { rpc } = await setup({ actor: { id: 'p-1', role: 'admin', aktif: false } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('FO TIDAK boleh menonaktifkan (403, RPC tidak dipanggil)', async () => {
    const { rpc } = await setup({ actor: { id: 'p-fo', role: 'front_office', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('petugas biasa ditolak (403)', async () => {
    const { rpc } = await setup({ actor: { id: 'p-1', role: 'petugas', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'x' }));
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('alasan wajib (400)', async () => {
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: '  ' }));
    expect(res.status).toBe(400);
  });

  it('admin aktif menonaktifkan: RPC dipanggil dengan p_actor = id admin, notifikasi dicatat', async () => {
    const { rpc, insert } = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    const { POST } = await import('./route');
    const res = await POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: ' cuti ' }));
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('petugas_set_nonaktif', {
      p_petugas_id: TARGET,
      p_alasan: 'cuti',
      p_actor: 'p-admin',
    });
    expect(insert).toHaveBeenCalled();
  });

  it('galat DB 42501 dipetakan ke 403, galat lain 400', async () => {
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError: { message: 'x', code: '42501' } });
    let mod = await import('./route');
    expect((await mod.POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'a' }))).status).toBe(403);
    vi.resetModules();
    await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true }, rpcError: { message: 'tidak boleh menonaktifkan akun sendiri' } });
    mod = await import('./route');
    expect((await mod.POST(req({ aksi: 'nonaktifkan', petugas_id: TARGET, alasan: 'a' }))).status).toBe(400);
  });

  it('aktifkan kembali: hanya admin; RPC petugas_set_aktif lewat service-role', async () => {
    const fo = await setup({ actor: { id: 'p-fo', role: 'front_office', aktif: true } });
    let mod = await import('./route');
    expect((await mod.POST(req({ aksi: 'aktifkan', petugas_id: TARGET }))).status).toBe(403);
    expect(fo.rpc).not.toHaveBeenCalled();

    vi.resetModules();
    const adm = await setup({ actor: { id: 'p-admin', role: 'admin', aktif: true } });
    mod = await import('./route');
    const res = await mod.POST(req({ aksi: 'aktifkan', petugas_id: TARGET }));
    expect(res.status).toBe(200);
    expect(adm.rpc).toHaveBeenCalledWith('petugas_set_aktif', { p_petugas_id: TARGET });
  });
});
