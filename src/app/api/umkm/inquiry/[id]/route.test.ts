// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (body: unknown, inquiryId: string): NextRequest => {
  const url = `http://localhost/api/umkm/inquiry/${inquiryId}`;
  const req = new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
};

const INQUIRY_ID = '660e8400-e29b-41d4-a716-446655440000';

interface MockServerOpts {
  user?: { id: string; email: string } | null;
  userError?: { message: string } | null;
  inquiry?: {
    id: string;
    listing_id: string;
    status: string;
  } | null;
  inquiryError?: { message: string } | null;
  updateError?: { message: string } | null;
  updated?: Record<string, unknown> | null;
  updateThrows?: { message?: string };
}

const mockServerClient = async (opts: MockServerOpts = {}) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const userData = opts.user === undefined ? { id: 'u1', email: 'owner@umkm.id' } : opts.user;
  const userErr = opts.userError ?? null;
  const inquiryData = opts.inquiry === undefined ? null : opts.inquiry;
  const inquiryErr = opts.inquiryError ?? null;
  const updateErr = opts.updateError ?? null;
  const updatedData = opts.updated ?? null;

  const updateTerminal = vi.fn().mockImplementation(() => {
    if (opts.updateThrows) throw opts.updateThrows;
    return Promise.resolve({ data: updatedData, error: updateErr });
  });
  const updateSelectSpy = vi.fn().mockReturnValue({ maybeSingle: updateTerminal });
  const updateEqSpy = vi.fn().mockReturnValue({ select: updateSelectSpy });
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy });

  const inquirySelectMaybeSingle = vi.fn().mockResolvedValue({ data: inquiryData, error: inquiryErr });
  const inquirySelectEq = vi.fn().mockReturnValue({ maybeSingle: inquirySelectMaybeSingle });
  const inquirySelectSpy = vi.fn().mockReturnValue({ eq: inquirySelectEq });

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userData },
        error: userErr,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === 'umkm_inquiry') {
        return {
          select: inquirySelectSpy,
          update: updateSpy,
        };
      }
      return {};
    }),
    _updateSpy: updateSpy,
    _updateEqSpy: updateEqSpy,
    _updateTerminal: updateTerminal,
    _inquirySelectMaybeSingle: inquirySelectMaybeSingle,
  };

  createClient.mockResolvedValue(mock);
  return mock;
};

interface MockServiceOpts {
  existsRow?: { id: string } | null;
  updated?: Record<string, unknown> | null;
  updateError?: { message: string } | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const existsData = opts.existsRow ?? null;
  const updatedData = opts.updated ?? null;
  const updateErr = opts.updateError ?? null;

  const updateTerminal = vi.fn().mockResolvedValue({ data: updatedData, error: updateErr });
  const updateSelectSpy = vi.fn().mockReturnValue({ maybeSingle: updateTerminal });
  const updateEqSpy = vi.fn().mockReturnValue({ select: updateSelectSpy });
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy });

  const existsTerminal = vi.fn().mockResolvedValue({ data: existsData, error: null });
  const existsEqSpy = vi.fn().mockReturnValue({ maybeSingle: existsTerminal });
  const existsSelectSpy = vi.fn().mockReturnValue({ eq: existsEqSpy });

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'umkm_inquiry') {
        return {
          select: existsSelectSpy,
          update: updateSpy,
        };
      }
      return {};
    }),
    _updateSpy: updateSpy,
    _updateTerminal: updateTerminal,
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const validParams = { params: Promise.resolve({ id: INQUIRY_ID }) };

describe('PATCH /api/umkm/inquiry/[id] — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 400 when status is not approved/rejected', async () => {
    await mockServerClient();
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'pending' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(400);
  });

  it('returns 400 when status missing', async () => {
    await mockServerClient();
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({}, INQUIRY_ID), validParams);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServerClient();
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest('{not json', INQUIRY_ID), validParams);
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/umkm/inquiry/[id] — auth', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 401 when user is not logged in', async () => {
    await mockServerClient({ user: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(401);
  });

  it('returns 401 when user has no email', async () => {
    await mockServerClient({ user: { id: 'u1', email: '' } });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/umkm/inquiry/[id] — ownership / not found', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 403 when inquiry not visible to caller and does not exist via service role', async () => {
    await mockServerClient({ inquiry: null });
    await mockServiceClient({ existsRow: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(404);
  });

  it('returns 403 when inquiry exists but caller is not owner', async () => {
    await mockServerClient({ inquiry: null });
    await mockServiceClient({ existsRow: { id: INQUIRY_ID } });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(403);
  });

  it('returns 403 when no service key and inquiry not visible (cannot prove existence)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockServerClient({ inquiry: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(403);
  });

  it('returns 500 when inquiry lookup errors', async () => {
    await mockServerClient({ inquiryError: { message: 'db down' } });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(500);
  });
});

describe('PATCH /api/umkm/inquiry/[id] — happy path (owner)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 200 with updated inquiry when owner approves', async () => {
    const serverMock = await mockServerClient({
      inquiry: { id: INQUIRY_ID, listing_id: 'listing-1', status: 'pending' },
      updated: {
        id: INQUIRY_ID,
        listing_id: 'listing-1',
        from_email: 'guest@x.com',
        from_nama: 'Guest',
        pesan: 'halo',
        status: 'approved',
        updated_at: '2026-07-11T00:00:00Z',
      },
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inquiry.status).toBe('approved');

    const updateSpy = serverMock._updateSpy;
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const payload = updateSpy.mock.calls[0][0];
    expect(payload.status).toBe('approved');
    expect(payload.updated_at).toBeTruthy();
  });

  it('returns 200 with rejected status when owner rejects', async () => {
    await mockServerClient({
      inquiry: { id: INQUIRY_ID, listing_id: 'listing-1', status: 'pending' },
      updated: {
        id: INQUIRY_ID,
        listing_id: 'listing-1',
        from_email: 'guest@x.com',
        from_nama: 'Guest',
        pesan: 'halo',
        status: 'rejected',
        updated_at: '2026-07-11T00:00:00Z',
      },
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'rejected' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.inquiry.status).toBe('rejected');
  });
});

describe('PATCH /api/umkm/inquiry/[id] — DB error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 200 via service-role fallback when RLS UPDATE fails', async () => {
    await mockServerClient({
      inquiry: { id: INQUIRY_ID, listing_id: 'listing-1', status: 'pending' },
      updateError: { message: 'rls denied' },
      updated: null,
    });
    const serviceMock = await mockServiceClient({
      updated: {
        id: INQUIRY_ID,
        listing_id: 'listing-1',
        from_email: 'guest@x.com',
        from_nama: 'Guest',
        pesan: 'halo',
        status: 'approved',
        updated_at: '2026-07-11T00:00:00Z',
      },
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(200);
    expect(serviceMock._updateSpy).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when service-role fallback also fails', async () => {
    await mockServerClient({
      inquiry: { id: INQUIRY_ID, listing_id: 'listing-1', status: 'pending' },
      updateError: { message: 'rls denied' },
      updated: null,
    });
    await mockServiceClient({ updateError: { message: 'fk violation' }, updated: null });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(500);
  });

  it('returns 500 when no service key and RLS UPDATE fails', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockServerClient({
      inquiry: { id: INQUIRY_ID, listing_id: 'listing-1', status: 'pending' },
      updateError: { message: 'rls denied' },
      updated: null,
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest({ status: 'approved' }, INQUIRY_ID), validParams);
    expect(res.status).toBe(500);
  });
});
