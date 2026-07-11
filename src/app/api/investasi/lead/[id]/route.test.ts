// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (
  id: string,
  body: unknown,
  method: 'PATCH' = 'PATCH',
): NextRequest => {
  const url = `http://localhost/api/investasi/lead/${id}`;
  const req = new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
};

const buildContext = (id: string) => ({
  params: Promise.resolve({ id }),
});

const VALID_ID = '550e8400-e29b-41d4-a716-446655440000';

interface MockServerOpts {
  user?: { id: string } | null;
  role?: string | null;
  lead?: { id: string } | null;
  updateError?: { message: string; code?: string } | null;
  updateData?: { id: string; status: string } | null;
}

const mockServerClient = async (opts: MockServerOpts = {}) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const userData = opts.user === undefined ? null : opts.user;
  const roleData = opts.role === undefined ? null : opts.role;
  const leadData = opts.lead === undefined ? null : opts.lead;
  const updateErr = opts.updateError ?? null;
  const updateData = opts.updateData ?? { id: 'lead-1', status: 'dihubungi' };

  const leadChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: leadData, error: null }),
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: updateData, error: updateErr }),
        }),
      }),
    }),
  };

  const petugasChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: roleData ? { role: roleData } : null,
        error: null,
      }),
    }),
  };

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userData }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === 'petugas') return petugasChain;
      if (table === 'investasi_lead') return leadChain;
      return {};
    }),
    _leadChain: leadChain,
    _petugasChain: petugasChain,
  };

  createClient.mockResolvedValue(mock);
  return mock;
};

describe('PATCH /api/investasi/lead/[id] — auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when unauthenticated', async () => {
    await mockServerClient({ user: null, role: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'dihubungi' }), buildContext(VALID_ID));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is petugas (not admin)', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'petugas' });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'dihubungi' }), buildContext(VALID_ID));
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no petugas row', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'dihubungi' }), buildContext(VALID_ID));
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/investasi/lead/[id] — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 400 when status is missing', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, {}), buildContext(VALID_ID));
    expect(res.status).toBe(400);
  });

  it('returns 400 when status is invalid', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'invalid' }), buildContext(VALID_ID));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, '{not json'), buildContext(VALID_ID));
    expect(res.status).toBe(400);
  });

  it('accepts all valid status values', async () => {
    await mockServerClient({
      user: { id: 'u-1' },
      role: 'admin',
      lead: { id: VALID_ID },
    });
    const { PATCH } = await import('./route');
    for (const status of ['baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai']) {
      const res = await PATCH(buildRequest(VALID_ID, { status }), buildContext(VALID_ID));
      expect(res.status).toBe(200);
    }
  });
});

describe('PATCH /api/investasi/lead/[id] — lead existence & update', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 404 when lead not found', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin', lead: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'dihubungi' }), buildContext(VALID_ID));
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful update', async () => {
    await mockServerClient({
      user: { id: 'u-1' },
      role: 'admin',
      lead: { id: VALID_ID },
      updateData: { id: VALID_ID, status: 'dihubungi' },
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'dihubungi' }), buildContext(VALID_ID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(VALID_ID);
    expect(json.status).toBe('dihubungi');
  });

  it('returns 500 when update fails', async () => {
    await mockServerClient({
      user: { id: 'u-1' },
      role: 'admin',
      lead: { id: VALID_ID },
      updateError: { message: 'rls denied' },
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest(VALID_ID, { status: 'dihubungi' }), buildContext(VALID_ID));
    expect(res.status).toBe(500);
  });
});
