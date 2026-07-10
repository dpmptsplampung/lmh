// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/admin/petugas/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/admin/petugas/invite',
  );
  return req as unknown as NextRequest;
};

interface MockServerOpts {
  user: { id: string } | null;
  role: string | null;
}

const mockServerClient = async ({ user, role }: MockServerOpts) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: user ? { role } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
  createClient.mockResolvedValue(mock);
  return mock;
};

interface MockServiceOpts {
  createUserError?: { message: string } | null;
  createUserData?: { user?: { id: string } | null } | null;
  generateLinkError?: { message: string } | null;
  generateLinkData?: { properties?: { action_link?: string } } | null;
  insertError?: unknown | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const insertChain = {
    error: opts.insertError ?? null,
  };
  const mock = {
    auth: {
      admin: {
        createUser: vi.fn().mockResolvedValue({
          data: opts.createUserData ?? { user: { id: 'new-user-id' } },
          error: opts.createUserError ?? null,
        }),
        generateLink: vi.fn().mockResolvedValue({
          data: opts.generateLinkData ?? {
            properties: { action_link: 'http://supabase.local/recovery?token=abc' },
          },
          error: opts.generateLinkError ?? null,
        }),
      },
    },
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain),
    }),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const validBody = {
  email: 'newpetugas@lmh.go.id',
  nama: 'Petugas Baru',
  layanan_id: '550e8400-e29b-41d4-a716-446655440000',
  role: 'petugas',
};

describe('POST /api/admin/petugas/invite — auth', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 401 when unauthenticated', async () => {
    await mockServerClient({ user: null, role: null });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is petugas (not admin)', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'petugas' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no petugas row', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: null });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/petugas/invite — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 400 when email missing', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({ ...validBody, email: undefined }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when email format invalid', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when nama missing', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, nama: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when nama shorter than 2 chars', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, nama: 'A' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when layanan_id missing', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, layanan_id: undefined }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when role is invalid', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, role: 'superadmin' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('{not json'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/petugas/invite — server config & conflicts', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  });

  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY missing (misconfigured)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/misconfigured|server/i);
  });

  it('returns 409 when createUser reports email already exists', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({
      createUserError: { message: 'User already registered' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/already|exists|registered/i);
  });
});

describe('POST /api/admin/petugas/invite — happy path', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 201 with user_id and recovery_url, inserts petugas row', async () => {
    const serverMock = await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const serviceMock = await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.user_id).toBe('new-user-id');
    expect(json.recovery_url).toMatch(/recovery/);

    expect(serviceMock.auth.admin.createUser).toHaveBeenCalledTimes(1);
    const createCall = serviceMock.auth.admin.createUser.mock.calls[0][0];
    expect(createCall.email).toBe('newpetugas@lmh.go.id');
    expect(createCall.email_confirm).toBe(true);

    expect(serviceMock.auth.admin.generateLink).toHaveBeenCalledTimes(1);
    const linkCall = serviceMock.auth.admin.generateLink.mock.calls[0][0];
    expect(linkCall.email).toBe('newpetugas@lmh.go.id');
    expect(linkCall.type).toBe('recovery');

    expect(serviceMock.from).toHaveBeenCalledWith('petugas');
    expect(serverMock.from).toHaveBeenCalledTimes(1);
    expect(serviceMock.from).toHaveBeenCalledTimes(1);
  });

  it('defaults role to petugas when not specified', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const serviceMock = await mockServiceClient();
    const { POST } = await import('./route');
    const { role: _omit, ...bodyWithoutRole } = validBody;
    void _omit;
    const res = await POST(buildRequest(bodyWithoutRole));
    expect(res.status).toBe(201);
    const insertFn = serviceMock.from('petugas').insert;
    const insertArg = (insertFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(insertArg.role).toBe('petugas');
  });

  it('returns 500 when generateLink fails after createUser succeeds', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({
      generateLinkError: { message: 'rate limited' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });

  it('returns 500 when petugas insert fails', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({ insertError: { message: 'fk violation' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });
});
