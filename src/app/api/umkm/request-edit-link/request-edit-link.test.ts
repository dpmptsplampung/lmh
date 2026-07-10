// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/umkm/request-edit-link', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/umkm/request-edit-link',
  );
  return req as unknown as NextRequest;
};

const VALID_LISTING_ID = '550e8400-e29b-41d4-a716-446655440000';

interface MockServiceOpts {
  ownerRows?: unknown[] | null;
  ownerError?: { message: string } | null;
  rateCount?: number | null;
  rateError?: { message: string } | null;
  existingUser?: { id: string } | null;
  lookupError?: { message: string } | null;
  generateLinkError?: { message: string } | null;
  generateLinkData?: { properties?: { action_link?: string } } | null;
  createUserData?: { user?: { id: string } | null } | null;
  createUserError?: { message: string } | null;
  logError?: unknown | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  delete process.env.LMH_DEV_RETURN_LINK;

  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  // Rate-limit select chain: .from('anon_rate_limit').select('*',{count:'exact',head:true}).eq(...).gte(...).is(...).or(...)
  const rateSelectChain = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    or: vi.fn().mockResolvedValue({
      count: opts.rateCount ?? 0,
      error: opts.rateError ?? null,
    }),
  };

  // owner select chain: .from('umkm_listing_owner').select('id').eq(...).eq(...).limit(1)
  const ownerSelectChain = {
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({
      data: opts.ownerRows ?? null,
      error: opts.ownerError ?? null,
    }),
  };

  // auth.users lookup: .from('auth.users').select('id').eq(...).maybeSingle()
  const userLookupChain = {
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: opts.existingUser ?? null,
      error: opts.lookupError ?? null,
    }),
  };

  // rate-limit insert chain
  const logInsertChain = {
    error: opts.logError ?? null,
  };

  const mock = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: opts.createUserData ?? { user: { id: 'new-umkm-user' } },
          error: opts.createUserError ?? null,
        }),
        generateLink: vi
          .fn()
          .mockResolvedValueOnce({
            data: opts.generateLinkData ?? {
              properties: { action_link: 'http://supabase.local/magiclink?token=abc' },
            },
            error: opts.generateLinkError ?? null,
          })
          // retry after createUser returns success
          .mockResolvedValueOnce({
            data: {
              properties: { action_link: 'http://supabase.local/magiclink?token=abc' },
            },
            error: null,
          }),
      },
    },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'anon_rate_limit') {
        const callCount = mock.from.mock.calls.filter((c: unknown[]) => c[0] === 'anon_rate_limit').length;
        // Second call to anon_rate_limit is the insert (after owner match)
        if (callCount === 2) {
          return { insert: vi.fn().mockReturnValue(logInsertChain) };
        }
        return { select: vi.fn().mockReturnValue(rateSelectChain) };
      }
      if (table === 'umkm_listing_owner') {
        return { select: vi.fn().mockReturnValue(ownerSelectChain) };
      }
      if (table === 'auth.users') {
        return { select: vi.fn().mockReturnValue(userLookupChain) };
      }
      return { select: vi.fn().mockReturnValue({}) };
    }),
  };

  createClient.mockReturnValue(mock);
  return mock;
};

const mockNoServiceKey = async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.LMH_DEV_RETURN_LINK;
};

describe('POST /api/umkm/request-edit-link — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 400 when listing_id missing', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ email: 'owner@umkm.id' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when listing_id is not a valid UUID', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: 'not-a-uuid', email: 'owner@umkm.id' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email missing', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when email format invalid', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('{not json'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/umkm/request-edit-link — owner check (no leak)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 200 { sent: true } when email NOT registered as owner (no leak, no email sent)', async () => {
    const serviceMock = await mockServiceClient({ ownerRows: [] });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'stranger@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    // generateLink must NOT be called (no owner match)
    expect(serviceMock.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it('returns 200 { sent: true } when owner query errors (no leak)', async () => {
    const serviceMock = await mockServiceClient({ ownerError: { message: 'db down' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(serviceMock.auth.admin.generateLink).not.toHaveBeenCalled();
  });
});

describe('POST /api/umkm/request-edit-link — happy path (owner match)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 200 { sent: true } and calls generateLink with correct args when email IS owner', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(json.dev_link).toBeUndefined();

    expect(serviceMock.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    const linkCall = serviceMock.auth.admin.generateLink.mock.calls[0][0];
    expect(linkCall.email).toBe('owner@umkm.id');
    expect(linkCall.type).toBe('magiclink');
    expect(linkCall.options.redirectTo).toBe(`/umkm/edit/${VALID_LISTING_ID}`);
  });

  it('creates the auth user first if not present, then retries generateLink', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: null,
      generateLinkError: { message: 'User not found' },
      createUserData: { user: { id: 'new-umkm-user' } },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);

    expect(serviceMock.auth.admin.createUser).toHaveBeenCalledTimes(1);
    const createCall = serviceMock.auth.admin.createUser.mock.calls[0][0];
    expect(createCall.email).toBe('owner@umkm.id');
    expect(createCall.email_confirm).toBe(true);

    // generateLink called twice (first fails, retry succeeds)
    expect(serviceMock.auth.admin.generateLink).toHaveBeenCalledTimes(2);
  });

  it('returns 200 { sent: true } with dev_link when LMH_DEV_RETURN_LINK=set', async () => {
    await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
    });
    process.env.LMH_DEV_RETURN_LINK = 'set';
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(json.dev_link).toMatch(/magiclink/);
  });
});

describe('POST /api/umkm/request-edit-link — service key missing (dev fallback)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 200 with dev_note when SUPABASE_SERVICE_ROLE_KEY missing (no-op)', async () => {
    await mockNoServiceKey();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(json.dev_note).toMatch(/service role/i);
  });
});

describe('POST /api/umkm/request-edit-link — rate limiting', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 429 when rate limit exceeded (count >= 3)', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      rateCount: 3,
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.error).toMatch(/terlalu banyak|coba lagi/i);
    // generateLink must NOT be called (rate-limited before owner check)
    expect(serviceMock.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it('allows request when rate limit count is below max (count=2)', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
      rateCount: 2,
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    expect(serviceMock.auth.admin.generateLink).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when rate-limit query errors (fail-closed)', async () => {
    await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      rateError: { message: 'connection refused' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(429);
  });
});
