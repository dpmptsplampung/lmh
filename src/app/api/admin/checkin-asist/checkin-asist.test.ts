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
  const req = new Request('http://localhost/api/admin/checkin-asist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/admin/checkin-asist',
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
  insertError?: unknown | null;
  insertData?: { id: string } | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const insertChain = {
    select: vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({
        data: opts.insertData ?? { id: 'visit-1' },
        error: opts.insertError ?? null,
      }),
    }),
  };
  const mock = {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain),
    }),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

describe('I9.5 /api/admin/checkin-asist route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it('rejects unauthenticated requests with 401', async () => {
    await mockServerClient({ user: null, role: null });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ nama: 'Budi', layanan_id: '550e8400-e29b-41d4-a716-446655440000' }));
    expect(res.status).toBe(401);
  });

  it('rejects non-petugas/admin users with 403', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: null });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ nama: 'Budi', layanan_id: '550e8400-e29b-41d4-a716-446655440000' }));
    expect(res.status).toBe(403);
  });

  it('rejects invalid body with 400', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'petugas' });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ nama: '', layanan_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('inserts via service-role and returns 201 for petugas', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'petugas' });
    await mockServiceClient({ insertData: { id: 'visit-abc' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      nama: 'Budi',
      layanan_id: '550e8400-e29b-41d4-a716-446655440000',
      keperluan: 'Konsultasi',
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe('visit-abc');
  });

  it('returns 500 when service-role key is missing', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    // No env vars set → service client unavailable
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      nama: 'Budi',
      layanan_id: '550e8400-e29b-41d4-a716-446655440000',
    }));
    expect(res.status).toBe(500);
  });

  it('returns 500 on insert error', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({ insertError: { message: 'DB down' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      nama: 'Budi',
      layanan_id: '550e8400-e29b-41d4-a716-446655440000',
    }));
    expect(res.status).toBe(500);
  });

  it('accepts admin role', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({ insertData: { id: 'visit-xyz' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      nama: 'Siti',
      layanan_id: '550e8400-e29b-41d4-a716-446655440000',
      asal_instansi: 'Dinas Pertanian',
    }));
    expect(res.status).toBe(201);
  });
});
