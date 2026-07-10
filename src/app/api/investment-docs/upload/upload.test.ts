// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({
  getDocument: vi.fn(),
}));

vi.mock('canvas', () => ({
  createCanvas: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (body: FormData): NextRequest => {
  const req = new Request('http://localhost/api/investment-docs/upload', {
    method: 'POST',
    body,
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL('http://localhost/api/investment-docs/upload');
  return req as unknown as NextRequest;
};

const mockSupabase = async (
  auth: { user: { id: string } | null; role: string | null },
  opts: { storageUploadError?: unknown; insertError?: unknown } = {},
) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: auth.user }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: auth.user ? { role: auth.role } : null,
            error: null,
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ error: opts.insertError ?? null }),
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload: vi.fn().mockResolvedValue({ error: opts.storageUploadError ?? null }),
      }),
    },
  };
  createClient.mockResolvedValue(mock);
  return mock;
};

describe('POST /api/investment-docs/upload — auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    await mockSupabase({ user: null, role: null });
    const { POST } = await import('./route');
    const form = new FormData();
    form.append('judul', 'Test Doc');
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is petugas (not admin)', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'petugas' });
    const { POST } = await import('./route');
    const form = new FormData();
    form.append('judul', 'Test Doc');
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no petugas row', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: null });
    const { POST } = await import('./route');
    const form = new FormData();
    form.append('judul', 'Test Doc');
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/investment-docs/upload — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 400 when pdf field missing (admin authed)', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' });
    const { POST } = await import('./route');
    const form = new FormData();
    form.append('judul', 'Test Doc');
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/pdf/i);
  });

  it('returns 400 when judul missing', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' });
    const { POST } = await import('./route');
    const form = new FormData();
    form.append('pdf', new File([new Uint8Array([1, 2, 3])], 'x.pdf', { type: 'application/pdf' }));
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
  });

  it('returns 413 when pdf exceeds 50 MB', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' });
    const { POST } = await import('./route');
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    const form = new FormData();
    form.append('pdf', new File([big], 'big.pdf', { type: 'application/pdf' }));
    form.append('judul', 'Big Doc');
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(413);
  });

  it('returns 400 when pdf is not a pdf content-type', async () => {
    await mockSupabase({ user: { id: 'u-1' }, role: 'admin' });
    const { POST } = await import('./route');
    const form = new FormData();
    form.append('pdf', new File([new Uint8Array([1, 2])], 'x.txt', { type: 'text/plain' }));
    form.append('judul', 'X');
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
  });
});
