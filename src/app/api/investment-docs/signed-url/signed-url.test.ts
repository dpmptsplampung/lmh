// @vitest-environment node
// GET /api/investment-docs/signed-url: tautan unduh PDF mentah (admin) + jejak audit A6.
// A6 (compliance): audit akses PDF mentah FAIL-CLOSED. Audit ditulis DULU; bila gagal (insert error/klien service
// tidak tersedia) -> 503 pesan baku dan signed URL TIDAK dibuat. Detail DB hanya masuk log (kode, bukan pesan).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/storage/r2', async () => {
  const { createClient } = await import('@/lib/supabase/server');
  const { r2DariTiruanSupabase } = await import('@/lib/storage/r2-test-adapter');
  return r2DariTiruanSupabase(createClient as never);
});
vi.mock('@/lib/akun/server', () => ({ getServiceClient: vi.fn() }));

import type { NextRequest } from 'next/server';

const FILE = '_raw/11111111-1111-1111-1111-111111111111.pdf';

const buildRequest = (filePath: string | null = FILE): NextRequest => {
  const url = new URL('http://localhost/api/investment-docs/signed-url');
  if (filePath !== null) url.searchParams.set('file_path', filePath);
  const req = new Request(url);
  (req as unknown as { nextUrl: URL }).nextUrl = url;
  return req as unknown as NextRequest;
};

interface Opts {
  user?: { id: string } | null;
  role?: string | null;
  signedError?: { message: string } | null;
  // Klien service untuk audit: 'ada' | 'null' (env tidak disetel) | hasil insert
  service?: 'null' | { error: { message: string; code?: string } | null } | 'throws';
}

async function setup(o: Opts = {}) {
  const user = o.user === undefined ? { id: 'u-1' } : o.user;
  const role = o.role === undefined ? 'admin' : o.role;

  const urutan: string[] = [];
  const createSignedUrl = vi.fn(async () => {
    urutan.push('signed');
    return o.signedError ? { data: null, error: o.signedError } : { data: { signedUrl: 'https://signed.example/x' }, error: null };
  });
  const serverMod = await import('@/lib/supabase/server');
  (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: user && role ? { role } : null, error: null }) }) }),
    }),
    storage: {
      from: () => ({
        createSignedUrl,
      }),
    },
  });

  const insert = vi.fn(async (v: unknown) => {
    void v;
    urutan.push('audit');
    if (o.service === 'throws') throw new Error('jaringan putus');
    return o.service && o.service !== 'null' ? o.service : { error: null };
  });
  const akunMod = await import('@/lib/akun/server');
  (akunMod.getServiceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
    o.service === 'null' ? null : { from: () => ({ insert }) },
  );
  return { insert, createSignedUrl, urutan };
}

describe('GET /api/investment-docs/signed-url', () => {
  let errSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')));
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    errSpy.mockRestore();
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  const log = (op: string) =>
    [...errSpy.mock.calls, ...warnSpy.mock.calls]
      .map((c) => { try { return JSON.parse(String(c[0])) as Record<string, unknown>; } catch { return null; } })
      .find((e) => e?.operation === op);

  it('401 tanpa login, 403 bukan admin, 400 path tidak valid', async () => {
    await setup({ user: null });
    expect((await (await import('./route')).GET(buildRequest())).status).toBe(401);
    vi.resetModules();
    await setup({ role: 'petugas' });
    expect((await (await import('./route')).GET(buildRequest())).status).toBe(403);
    vi.resetModules();
    await setup();
    expect((await (await import('./route')).GET(buildRequest('../rahasia.pdf'))).status).toBe(400);
  });

  it('admin: 200 dengan signedUrl dan audit akses PDF mentah ditulis', async () => {
    const { insert } = await setup();
    const res = await (await import('./route')).GET(buildRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ signedUrl: 'https://signed.example/x' });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ actor_id: 'u-1', actor_role: 'admin', aksi: 'download_raw_pdf', entitas_id: FILE }),
    );
    expect(errSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: insert audit gagal -> 503 pesan baku, signed URL TIDAK dibuat, kegagalan dicatat dengan kode', async () => {
    const s = await setup({ service: { error: { message: 'row-level security secret-xyz', code: '42501' } } });
    const res = await (await import('./route')).GET(buildRequest());

    expect(res.status).toBe(503);
    const teks = JSON.stringify(await res.json());
    expect(teks).not.toContain('secret-xyz');
    expect(teks).not.toContain('signed.example');
    expect(s.createSignedUrl).not.toHaveBeenCalled();
    const l = log('investment_docs.signed_url.audit');
    expect(l).toMatchObject({ level: 'error', kode: 'ditolak', asalCode: '42501' });
    expect(JSON.stringify(l)).not.toContain('secret-xyz');
  });

  it('FAIL-CLOSED: insert audit melempar -> 503 dan signed URL tidak dibuat', async () => {
    const s = await setup({ service: 'throws' });
    const res = await (await import('./route')).GET(buildRequest());

    expect(res.status).toBe(503);
    expect(s.createSignedUrl).not.toHaveBeenCalled();
    expect(log('investment_docs.signed_url.audit')).toMatchObject({ kode: 'jaringan' });
  });

  it('FAIL-CLOSED: klien service tidak tersedia -> 503, signed URL tidak dibuat, dicatat sebagai error', async () => {
    const s = await setup({ service: 'null' });
    const res = await (await import('./route')).GET(buildRequest());

    expect(res.status).toBe(503);
    expect(s.createSignedUrl).not.toHaveBeenCalled();
    expect(log('investment_docs.signed_url.audit_unavailable')).toMatchObject({ level: 'error' });
  });

  it('audit ditulis SEBELUM signed URL dibuat (urutan)', async () => {
    const s = await setup();
    await (await import('./route')).GET(buildRequest());
    expect(s.urutan).toEqual(['audit', 'signed']);
  });

  it('gagal membuat signed URL: 500 pesan baku (audit percobaan sudah tercatat lebih dulu)', async () => {
    const s = await setup({ signedError: { message: 'storage down secret-abc' } });
    const res = await (await import('./route')).GET(buildRequest());

    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain('secret-abc');
    expect(s.insert).toHaveBeenCalledTimes(1);
  });
});
