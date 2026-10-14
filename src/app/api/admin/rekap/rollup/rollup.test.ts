// @vitest-environment node
// Audit T2d (inventaris No 79-80): rollup_rekap_harian per tanggal (kegagalan dikumpulkan) + audit_log yang tidak boleh
// hilang diam-diam. Semua klien dimock.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/rekap/rollup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

type Galat = { code?: string; message: string } | null;

async function setup(o: {
  user?: { id: string } | null;
  me?: { id: string; role: string; aktif: boolean } | null;
  rpcError?: (tgl: string) => Galat;
  auditError?: Galat;
} = {}) {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
  const user = o.user === undefined ? { id: 'auth-1' } : o.user;
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: o.me === undefined ? { id: 'p-1', role: 'admin', aktif: true } : o.me }) }) }),
    }),
  });
  const rpc = vi.fn(async (_n: string, a: { p_tanggal: string }) => ({ data: null, error: o.rpcError?.(a.p_tanggal) ?? null }));
  const insert = vi.fn(async () => ({ error: o.auditError ?? null }));
  const sbMod = await import('@supabase/supabase-js');
  (sbMod.createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ rpc, from: () => ({ insert }) });
  const logger = await import('@/lib/observability/logger');
  const log = vi.mocked(logger.logServerEvent);
  log.mockClear();
  return { rpc, insert, log };
}

describe('POST /api/admin/rekap/rollup', () => {
  beforeEach(() => vi.resetModules());

  it('akses: 401 tanpa login / nonaktif, 403 untuk petugas', async () => {
    await setup({ user: null });
    expect((await (await import('./route')).POST(req({ dari: '2026-10-01', sampai: '2026-10-01' }))).status).toBe(401);
    vi.resetModules();
    await setup({ me: { id: 'p', role: 'admin', aktif: false } });
    expect((await (await import('./route')).POST(req({ dari: '2026-10-01', sampai: '2026-10-01' }))).status).toBe(401);
    vi.resetModules();
    const s = await setup({ me: { id: 'p', role: 'petugas', aktif: true } });
    expect((await (await import('./route')).POST(req({ dari: '2026-10-01', sampai: '2026-10-01' }))).status).toBe(403);
    expect(s.rpc).not.toHaveBeenCalled();
  });

  it('validasi: format tanggal 422, sampai < dari 422, rentang > 92 hari 422', async () => {
    await setup();
    const { POST } = await import('./route');
    expect((await POST(req({ dari: '1/10/2026', sampai: '2026-10-02' }))).status).toBe(422);
    expect((await POST(req({ dari: '2026-10-05', sampai: '2026-10-01' }))).status).toBe(422);
    expect((await POST(req({ dari: '2026-01-01', sampai: '2026-06-01' }))).status).toBe(422);
  });

  it('sukses: RPC per tanggal, audit dicatat, respons ok', async () => {
    const s = await setup();
    const res = await (await import('./route')).POST(req({ dari: '2026-10-01', sampai: '2026-10-03' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tanggal_count: 3 });
    expect(s.rpc.mock.calls.map((c) => c[1])).toEqual([
      { p_tanggal: '2026-10-01' }, { p_tanggal: '2026-10-02' }, { p_tanggal: '2026-10-03' },
    ]);
    expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({ aksi: 'rollup_rekap', actor_role: 'admin' }));
  });

  it('sebagian tanggal gagal: 500 dengan daftar gagal, audit tetap mencatat tanggal yang gagal', async () => {
    const s = await setup({ rpcError: (t) => (t === '2026-10-02' ? { code: '57014', message: 'boom secret-xyz' } : null) });
    const res = await (await import('./route')).POST(req({ dari: '2026-10-01', sampai: '2026-10-03' }));
    expect(res.status).toBe(500);
    const body = await res.json();
    // Hanya tanggal yang dikirim ke klien; pesan DB mentah tidak bocor (detail masuk log).
    expect(body.gagal).toEqual(['2026-10-02']);
    expect(JSON.stringify(body)).not.toContain('secret-xyz');
    expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ gagal: ['2026-10-02'] }) }));
    expect(JSON.stringify(s.insert.mock.calls)).not.toContain('secret-xyz');
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.rekap.rollup.tanggal', tanggal: '2026-10-02', asalCode: '57014' }));
    expect(JSON.stringify(s.log.mock.calls)).not.toContain('secret-xyz');
  });

  it('audit_log gagal ditulis: respons tidak berubah (best-effort) TAPI kegagalan tercatat', async () => {
    const s = await setup({ auditError: { code: '42501', message: 'row-level security' } });
    const res = await (await import('./route')).POST(req({ dari: '2026-10-01', sampai: '2026-10-01' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, tanggal_count: 1 });
    expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.rekap.rollup.audit', asalCode: '42501' }));
  });
});
