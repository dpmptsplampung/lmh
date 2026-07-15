// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import type { Mock } from 'vitest';

interface PetugasRow {
  role: string | null;
}

interface MockUser {
  id: string;
  app_metadata?: { role?: string } | null;
}

interface ClientOpts {
  user: MockUser | null;
  petugasRow?: PetugasRow | null;
  authFailure?: Error;
  roleFailure?: Error;
}

const buildRequest = (url: string, headers?: HeadersInit): NextRequest => {
  const req = new Request(url, { method: 'GET', headers });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
};

const expectRequestId = (response: Response) => {
  expect(response.headers.get('x-request-id')).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
};

describe('proxy — request ID propagation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setEnv();
  });

  it('preserves a valid incoming ID in forwarded and response headers', async () => {
    await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/', { 'x-request-id': 'upstream_123-abc' }));
    expect(res.headers.get('x-request-id')).toBe('upstream_123-abc');
    expect(res.headers.get('x-middleware-request-x-request-id')).toBe('upstream_123-abc');
  });

  it.each(['contains spaces', 'a'.repeat(129), 'bad/header'])('replaces invalid incoming ID %s', async (incoming) => {
    await mockCreateServerClient({ user: null });
    const randomUUID = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/', { 'x-request-id': incoming }));
    expect(res.headers.get('x-request-id')).toBe('00000000-0000-4000-8000-000000000000');
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it('adds the request ID to auth redirects without changing redirect behavior', async () => {
    await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin', { 'x-request-id': 'req.admin:1' }));
    expect(res.headers.get('location')).toMatch(/\/login/);
    expect(res.headers.get('x-request-id')).toBe('req.admin:1');
  });
});

const mockCreateServerClient = async ({ user, petugasRow, authFailure, roleFailure }: ClientOpts) => {
  const ssrMod = await import('@supabase/ssr');
  const createServerClient = ssrMod.createServerClient as unknown as Mock;

  const fromChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockImplementation(() => roleFailure
          ? Promise.reject(roleFailure)
          : Promise.resolve({ data: petugasRow ?? null, error: null })),
      }),
    }),
  };

  const mockClient = {
    auth: {
      getUser: vi.fn().mockImplementation(() => authFailure
        ? Promise.reject(authFailure)
        : Promise.resolve({ data: { user }, error: null })),
    },
    from: vi.fn().mockReturnValue(fromChain),
  };

  createServerClient.mockReturnValue(mockClient);
  return { mockClient, fromChain };
};

const setEnv = () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key';
};

describe('proxy — non-protected routes', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes through non-protected route (e.g. /) without auth check', async () => {
    const { mockClient } = await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.auth.getUser).not.toHaveBeenCalled();
  });
});

describe('proxy — unauthenticated access to protected routes', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('redirects to /login?redirect=... when no user accesses /admin', async () => {
    const { mockClient } = await mockCreateServerClient({ user: null });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('location')).toMatch(/\/login/);
    expect(res.headers.get('location')).toMatch(/redirect=/);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

describe('proxy — bounded failures', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    setEnv();
  });

  it('contains rejected auth calls with structured logging and request ID', async () => {
    await mockCreateServerClient({ user: null, authFailure: new Error('token=auth-secret') });
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/admin', { 'x-request-id': 'req-auth' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req-auth');
    expect(await response.text()).toBe('{"error":"Internal server error"}');
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({ operation: 'proxy.failure', requestId: 'req-auth' });
    expect(String(write.mock.calls[0][0])).not.toContain('auth-secret');
  });

  it('contains rejected role queries with a bounded JSON response', async () => {
    await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: null }, roleFailure: new Error('postgres private detail'),
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/admin', { 'x-request-id': 'req-role' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req-role');
    expect(await response.text()).toBe('{"error":"Internal server error"}');
  });

  it('uses structured logging for missing proxy configuration', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const write = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/me', { 'x-request-id': 'req-config' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-request-id')).toBe('req-config');
    expect(JSON.parse(String(write.mock.calls[0][0]))).toMatchObject({
      operation: 'proxy.failure',
      error: { type: 'ConfigurationError' },
    });
  });

  it('contains Supabase client construction exceptions', async () => {
    const ssrMod = await import('@supabase/ssr');
    (ssrMod.createServerClient as unknown as Mock).mockImplementationOnce(() => {
      throw new Error('client secret detail');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { proxy } = await import('./proxy');
    const response = await proxy(buildRequest('http://localhost/me', { 'x-request-id': 'req-client' }));
    expect(response.status).toBe(500);
    expect(response.headers.get('x-request-id')).toBe('req-client');
    expect(await response.text()).toBe('{"error":"Internal server error"}');
  });
});

describe('proxy — /admin with JWT app_metadata.role (no DB query)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes when app_metadata.role = admin (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'admin' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('passes when app_metadata.role = petugas (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'petugas' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('redirects to /me when app_metadata.role = pengunjung (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'pengunjung' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.headers.get('location')).toMatch(/\/me/);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});

describe('proxy — /admin without app_metadata.role (fallback to DB query)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes when DB returns role=admin (fallback engaged)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: null },
      petugasRow: { role: 'admin' },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).toHaveBeenCalledWith('petugas');
  });

  it('redirects to /me when DB returns null (fallback engaged)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: null },
      petugasRow: null,
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.headers.get('location')).toMatch(/\/me/);
    expectRequestId(res);
    expect(mockClient.from).toHaveBeenCalledWith('petugas');
  });
});

describe('proxy — /me route (no role check)', () => {
  beforeEach(() => {
    vi.resetModules();
    setEnv();
  });

  it('passes for any logged-in user without role check', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'pengunjung' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/me'));
    expect(res.status).toBe(200);
    expectRequestId(res);
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});
