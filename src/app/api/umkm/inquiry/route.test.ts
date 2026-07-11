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
  const req = new Request('http://localhost/api/umkm/inquiry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/umkm/inquiry',
  );
  return req as unknown as NextRequest;
};

const VALID_LISTING_ID = '550e8400-e29b-41d4-a716-446655440000';

const validBody = {
  listing_id: VALID_LISTING_ID,
  from_email: 'pengunjung@example.com',
  from_nama: 'Budi',
  pesan: 'Saya tertarik, mohon info lebih lanjut.',
};

interface MockServerOpts {
  listing?: { id: string; status: string } | null;
  listingError?: { message: string } | null;
  insertError?: { message: string; code?: string } | null;
  insertThrows?: { code?: string; message?: string };
  insertedId?: string | null;
}

const mockServerClient = async (opts: MockServerOpts = {}) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const listingData = opts.listing === undefined ? null : opts.listing;
  const listingErr = opts.listingError ?? null;
  const insertErr = opts.insertError ?? null;
  const insertedId = opts.insertedId ?? null;

  const inquiryInsertChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      if (opts.insertThrows) throw opts.insertThrows;
      if (insertErr) return { data: null, error: insertErr };
      return { data: { id: insertedId ?? 'new-inquiry-id' }, error: null };
    }),
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'listing_umkm') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: listingData,
                error: listingErr,
              }),
            }),
          }),
        };
      }
      if (table === 'umkm_inquiry') {
        return inquiryInsertChain;
      }
      return {};
    }),
    _inquiryInsertChain: inquiryInsertChain,
  };

  createClient.mockResolvedValue(mock);
  return mock;
};

interface MockServiceOpts {
  insertError?: { message: string; code?: string } | null;
  insertThrows?: { code?: string; message?: string };
  insertedId?: string | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const insertErr = opts.insertError ?? null;
  const insertedId = opts.insertedId ?? null;

  const inquiryInsertChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      if (opts.insertThrows) throw opts.insertThrows;
      if (insertErr) return { data: null, error: insertErr };
      return { data: { id: insertedId ?? 'new-inquiry-id' }, error: null };
    }),
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'umkm_inquiry') return inquiryInsertChain;
      return {};
    }),
    _inquiryInsertChain: inquiryInsertChain,
  };
  createClient.mockReturnValue(mock);
  return mock;
};

describe('POST /api/umkm/inquiry — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 400 when listing_id is not a UUID', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, listing_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when from_email missing', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      listing_id: VALID_LISTING_ID,
      pesan: 'halo',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when from_email is invalid format', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, from_email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when pesan missing', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      listing_id: VALID_LISTING_ID,
      from_email: 'a@b.com',
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when pesan is empty string', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, pesan: '' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when pesan exceeds 2000 chars', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, pesan: 'x'.repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when from_nama exceeds 200 chars', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, from_nama: 'x'.repeat(201) }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('{not json'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/umkm/inquiry — listing state checks', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 404 when listing not found', async () => {
    await mockServerClient({ listing: null });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/tidak ditemukan|tidak tayang/i);
  });

  it('returns 404 when listing status is not published', async () => {
    await mockServerClient({ listing: { id: VALID_LISTING_ID, status: 'draft' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(404);
  });

  it('returns 500 when listing lookup errors', async () => {
    await mockServerClient({ listingError: { message: 'db down' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/umkm/inquiry — happy path', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 201 when authenticated client inserts successfully', async () => {
    const serverMock = await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
      insertedId: 'inq-123',
    });
    await mockServiceClient({ insertedId: 'inq-123' });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe('inq-123');
    expect(json.message).toMatch(/terkirim|disetujui/i);

    const insertSpy = serverMock._inquiryInsertChain.insert;
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.listing_id).toBe(VALID_LISTING_ID);
    expect(payload.from_email).toBe('pengunjung@example.com');
    expect(payload.from_nama).toBe('Budi');
    expect(payload.pesan).toBe(validBody.pesan);
  });

  it('falls back to service-role client when RLS rejects the INSERT', async () => {
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
      insertError: { message: 'new row violates row-level security policy', code: '42501' },
    });
    const serviceMock = await mockServiceClient({ insertedId: 'inq-456' });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe('inq-456');
    expect(serviceMock.from).toHaveBeenCalledWith('umkm_inquiry');
  });

  it('accepts optional from_nama field and stores it as null when absent', async () => {
    const serverMock = await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
    });
    await mockServiceClient();
    const { POST } = await import('./route');
    const { from_nama: _omit, ...bodyNoNama } = validBody;
    void _omit;
    const res = await POST(buildRequest(bodyNoNama));
    expect(res.status).toBe(201);
    const insertSpy = serverMock._inquiryInsertChain.insert;
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.from_nama).toBeNull();
  });
});

describe('POST /api/umkm/inquiry — DB error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 500 when service-role fallback also fails', async () => {
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
      insertError: { message: 'rls denied' },
    });
    await mockServiceClient({ insertError: { message: 'fk violation' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });

  it('returns 500 when RLS rejects and no service key configured', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
      insertError: { message: 'rls denied' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });

  it('returns 500 when authenticated INSERT throws (non-RLS)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
      insertThrows: { message: 'connection refused' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/umkm/inquiry — security (no contact leak)', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('response body never contains kontak_email or kontak_hp', async () => {
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: 'published' },
    });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    const text = await res.text();
    expect(text).not.toMatch(/kontak_email/i);
    expect(text).not.toMatch(/kontak_hp/i);
  });

  it('error responses never leak contact fields', async () => {
    await mockServerClient({ listing: null });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    const text = await res.text();
    expect(text).not.toMatch(/kontak_email/i);
    expect(text).not.toMatch(/kontak_hp/i);
  });
});
