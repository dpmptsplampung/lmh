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
}

const buildRequest = (url: string): NextRequest => {
  const req = new Request(url, { method: 'GET' });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(url);
  return req as unknown as NextRequest;
};

const mockCreateServerClient = async ({ user, petugasRow }: ClientOpts) => {
  const ssrMod = await import('@supabase/ssr');
  const createServerClient = ssrMod.createServerClient as unknown as Mock;

  const fromChain = {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({
          data: petugasRow ?? null,
          error: null,
        }),
      }),
    }),
  };

  const mockClient = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
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
    expect(mockClient.from).not.toHaveBeenCalled();
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
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('passes when app_metadata.role = petugas (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'petugas' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.status).toBe(200);
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  it('redirects to /me when app_metadata.role = pengunjung (no DB query)', async () => {
    const { mockClient } = await mockCreateServerClient({
      user: { id: 'u-1', app_metadata: { role: 'pengunjung' } },
    });
    const { proxy } = await import('./proxy');
    const res = await proxy(buildRequest('http://localhost/admin'));
    expect(res.headers.get('location')).toMatch(/\/me/);
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
    expect(mockClient.from).not.toHaveBeenCalled();
  });
});
