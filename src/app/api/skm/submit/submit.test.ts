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
  const req = new Request('http://localhost/api/skm/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/skm/submit',
  );
  return req as unknown as NextRequest;
};

interface MockServerOpts {
  visit?: { id: string; layanan_id: string | null; status: string } | null;
  visitError?: { message: string } | null;
  existingSkm?: { id: string } | null;
  insertError?: { message: string; code?: string } | null;
}

const mockServerClient = async (opts: MockServerOpts = {}) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const visitData = opts.visit === undefined ? null : opts.visit;
  const visitErr = opts.visitError ?? null;
  const existingData = opts.existingSkm === undefined ? null : opts.existingSkm;
  const insertErr = opts.insertError ?? null;

  // Persistent skm_respons chain — the route calls from('skm_respons') twice:
  //   1) select('id').eq('visit_id', v).maybeSingle()  → existing-check
  //   2) insert(payload)                                → write
  // Sharing one chain object means both the route and the test assertions
  // reference the same `insert` spy.
  const skmChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: existingData, error: null }),
    insert: vi.fn().mockReturnValue({ error: insertErr }),
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'visit') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: visitData,
                error: visitErr,
              }),
            }),
          }),
        };
      }
      if (table === 'skm_respons') {
        return skmChain;
      }
      return {};
    }),
    _skmChain: skmChain,
  };

  createClient.mockResolvedValue(mock);
  return mock;
};

interface MockServiceOpts {
  insertError?: { message: string } | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const mock = {
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue({ error: opts.insertError ?? null }),
    }),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const validBody = {
  visit_id: '550e8400-e29b-41d4-a716-446655440000',
  layanan_id: '660e8400-e29b-41d4-a716-446655440000',
  u1: 4, u2: 3, u3: 4, u4: 4, u5: 3, u6: 4, u7: 4, u8: 3, u9: 4,
  saran: 'Pelayanan baik',
};

describe('POST /api/skm/submit — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 400 when visit_id is not a UUID', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, visit_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('{not json'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when a u1-u9 value is out of range (0)', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, u1: 0 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when a u1-u9 value is out of range (5)', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, u5: 5 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when a u1-u9 value is non-integer', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, u9: 3.5 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when u1-u9 missing entirely', async () => {
    await mockServerClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({
      visit_id: validBody.visit_id,
      layanan_id: validBody.layanan_id,
    }));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/skm/submit — visit state checks', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 404 when visit not found', async () => {
    await mockServerClient({ visit: null });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not found/i);
  });

  it('returns 400 when visit status is not selesai', async () => {
    await mockServerClient({
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'menunggu' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/selesai/i);
  });

  it('returns 409 when SKM already submitted for this visit', async () => {
    await mockServerClient({
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'selesai' },
      existingSkm: { id: 'existing-skm-id' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toMatch(/sudah mengisi/i);
  });
});

describe('POST /api/skm/submit — happy path', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 201 when authenticated client inserts successfully', async () => {
    const serverMock = await mockServerClient({
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'selesai' },
      existingSkm: null,
      insertError: null,
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message).toMatch(/terima kasih/i);

    // Verify the server client insert was called with the right payload
    const insertSpy = serverMock._skmChain.insert;
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.visit_id).toBe(validBody.visit_id);
    expect(payload.u1_persyaratan).toBe(4);
    expect(payload.u9_pengaduan).toBe(4);
  });

  it('falls back to service-role client when RLS rejects the INSERT', async () => {
    await mockServerClient({
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'selesai' },
      existingSkm: null,
      insertError: { message: 'new row violates row-level security policy', code: '42501' },
    });
    const serviceMock = await mockServiceClient({ insertError: null });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    expect(serviceMock.from).toHaveBeenCalledWith('skm_respons');
  });

  it('returns 500 when service-role fallback also fails', async () => {
    await mockServerClient({
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'selesai' },
      existingSkm: null,
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
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'selesai' },
      existingSkm: null,
      insertError: { message: 'rls denied' },
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });

  it('accepts optional saran field and stores it as null when absent', async () => {
    const serverMock = await mockServerClient({
      visit: { id: validBody.visit_id, layanan_id: validBody.layanan_id, status: 'selesai' },
      existingSkm: null,
      insertError: null,
    });
    const { POST } = await import('./route');
    const { saran: _omit, ...bodyNoSaran } = validBody;
    void _omit;
    const res = await POST(buildRequest(bodyNoSaran));
    expect(res.status).toBe(201);
    const insertSpy = serverMock._skmChain.insert;
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.saran).toBeNull();
  });
});
