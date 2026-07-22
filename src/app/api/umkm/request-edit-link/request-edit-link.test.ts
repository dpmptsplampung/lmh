// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('resend', () => ({
  Resend: vi.fn(),
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

const mockResend = async (opts: { error?: { message: string } | null } = {}) => {
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_FROM = 'Test <noreply@test.example>';
  process.env.NEXT_PUBLIC_PUBLIC_URL = 'https://layanan.example.test';
  const resendMod = await import('resend');
  const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
  const sendMock = vi.fn().mockResolvedValue({
    data: opts.error ? null : { id: 'email-1' },
    error: opts.error ?? null,
  });
  function ResendCtor(this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock };
  }
  Resend.mockImplementation(ResendCtor as unknown as () => unknown);
  return { sendMock };
};

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.APP_ENV = 'test';
  delete process.env.LMH_DEV_RETURN_LINK;
  process.env.RESEND_API_KEY = 're_test';
  process.env.RESEND_FROM = 'Test <noreply@test.example>';
  process.env.NEXT_PUBLIC_PUBLIC_URL = 'https://layanan.example.test';

  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  // Rate-limit select chain: .from('anon_rate_limit').select('*',{count:'exact',head:true}).eq(...).gte(...).is(...)
  const rateSelectChain = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({
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
  const logInsertMock = vi.fn().mockReturnValue({ error: opts.logError ?? null });

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
        // Second call to anon_rate_limit is the insert (after rate-limit
        // check passes, before owner lookup — counts every throttled request)
        if (callCount === 2) {
          return { insert: logInsertMock };
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
    __logInsert: logInsertMock,
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
    // Rate-limit insert MUST be called (request passed throttle, counted
    // even though email is not a registered owner — blocks repeat probes)
    expect(serviceMock.__logInsert).toHaveBeenCalledTimes(1);
    expect(serviceMock.__logInsert).toHaveBeenCalledWith({
      user_id: null,
      action: expect.stringMatching(/^umkm_request_link:[0-9a-f]{16}$/),
    });
  });

  it('returns 200 { sent: true } when owner query errors (no leak)', async () => {
    const serviceMock = await mockServiceClient({ ownerError: { message: 'db down' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(serviceMock.auth.admin.generateLink).not.toHaveBeenCalled();
    // Rate-limit insert is called before owner lookup, so still counted
    expect(serviceMock.__logInsert).toHaveBeenCalledTimes(1);
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
    const { sendMock } = await mockResend();
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
    expect(String(linkCall.options.redirectTo)).toContain(
      `/auth/callback?next=/umkm/edit/${VALID_LISTING_ID}`,
    );
    // Rate-limit insert is called (now before owner lookup, still once)
    expect(serviceMock.__logInsert).toHaveBeenCalledTimes(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const emailArg = sendMock.mock.calls[0][0] as { to: string; html: string };
    expect(emailArg.to).toBe('owner@umkm.id');
    expect(emailArg.html).toMatch(/magiclink|token|klik|edit/i);
  });

  it('creates the auth user first if not present, then retries generateLink', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: null,
      generateLinkError: { message: 'User not found' },
      createUserData: { user: { id: 'new-umkm-user' } },
    });
    await mockResend();
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

  it('returns 200 { sent: true } with dev_link only when APP_ENV=development AND LMH_DEV_RETURN_LINK=set', async () => {
    await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
    });
    await mockResend();
    process.env.APP_ENV = 'development';
    process.env.LMH_DEV_RETURN_LINK = 'set';
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(true);
    expect(json.dev_link).toMatch(/magiclink/);
  });

  it('never returns action link when APP_ENV is production even if LMH_DEV_RETURN_LINK=set', async () => {
    await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
    });
    await mockResend();
    process.env.APP_ENV = 'production';
    process.env.LMH_DEV_RETURN_LINK = 'set';
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.dev_link).toBeUndefined();
  });

  it('returns 503 when Resend/config missing (no fake success)', async () => {
    await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
    });
    delete process.env.RESEND_API_KEY;
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.sent).not.toBe(true);
  });
});

describe('POST /api/umkm/request-edit-link — service key missing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 503 when SUPABASE_SERVICE_ROLE_KEY missing (cannot send email)', async () => {
    await mockNoServiceKey();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(503);
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
    // Rate-limit insert must NOT be called (check rejected before logging)
    expect(serviceMock.__logInsert).not.toHaveBeenCalled();
  });

  it('allows request when rate limit count is below max (count=2)', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      existingUser: { id: 'auth-user-1' },
      rateCount: 2,
    });
    await mockResend();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(200);
    expect(serviceMock.auth.admin.generateLink).toHaveBeenCalledTimes(1);
  });

  it('returns 429 when rate-limit query errors (fail-closed)', async () => {
    const serviceMock = await mockServiceClient({
      ownerRows: [{ id: 'owner-row-1' }],
      rateError: { message: 'connection refused' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ listing_id: VALID_LISTING_ID, email: 'owner@umkm.id' }));
    expect(res.status).toBe(429);
    // Check failed → no insert logged
    expect(serviceMock.__logInsert).not.toHaveBeenCalled();
  });
});
