// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const geminiState = {
  apiKeySet: true,
  embedThrow: false,
  embedEmpty: false,
};

vi.mock('@/lib/gemini', () => ({
  getGenerativeClient: () => {
    if (!geminiState.apiKeySet) return null;
    return {};
  },
  getEmbeddingModel: () => ({
    embedContent: async () => {
      if (geminiState.embedThrow) {
        throw new Error('Gemini embedding API error');
      }
      const values = geminiState.embedEmpty ? [] : new Array(768).fill(0.1);
      return { embedding: { values } };
    },
  }),
  getChatModel: () => ({}),
  buildRagContext: () => '',
  SYSTEM_PROMPT_RAG: '',
}));

import type { NextRequest } from 'next/server';

const buildRequest = (): NextRequest => {
  const req = new Request('http://localhost/api/admin/faq/embed', {
    method: 'POST',
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/admin/faq/embed',
  );
  return req as unknown as NextRequest;
};

interface MockServerOpts {
  user: { id: string } | null;
  role: string | null;
}

const mockServerClient = async ({ user, role }: MockServerOpts) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<
    typeof vi.fn
  >;
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
  pendingFaqs?: Array<{ id: string; pertanyaan: string; jawaban: string }>;
  fetchError?: { message: string } | null;
  updateError?: { message: string } | null;
  remainingCount?: number;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<
    typeof vi.fn
  >;

  const pendingFaqs = opts.pendingFaqs ?? [];
  const updateChain = {
    eq: vi.fn().mockResolvedValue({
      error: opts.updateError ?? null,
    }),
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'faq_knowledge_base') {
        return {
          // select pending FAQs (is embedding null, limit 50) OR
          // count remaining (select('*', { count:'exact', head:true }).is(...))
          select: vi.fn((cols?: unknown, opts2?: { count?: string; head?: boolean }) => {
            if (opts2 && opts2.head === true) {
              // count query — returns { count, error } via thenable
              return {
                is: vi.fn(() => ({
                  then: (
                    resolve: (v: unknown) => unknown,
                    reject?: (e: unknown) => unknown,
                  ) =>
                    Promise.resolve({
                      count: opts.remainingCount ?? 0,
                      error: null,
                    }).then(resolve, reject),
                })),
              };
            }
            // pending fetch — is(...).limit(...).then(...)
            return {
              is: vi.fn(() => ({
                limit: vi.fn(() => ({
                  then: (
                    resolve: (v: unknown) => unknown,
                    reject?: (e: unknown) => unknown,
                  ) =>
                    Promise.resolve({
                      data: pendingFaqs,
                      error: opts.fetchError ?? null,
                    }).then(resolve, reject),
                })),
              })),
            };
          }),
          // update embedding
          update: vi.fn(() => updateChain),
        };
      }
      // Fallback for any other table
      return {
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            then: (
              resolve: (v: unknown) => unknown,
              reject?: (e: unknown) => unknown,
            ) =>
              Promise.resolve({
                count: opts.remainingCount ?? 0,
                error: null,
              }).then(resolve, reject),
          })),
        })),
      };
    }),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const resetGeminiState = () => {
  geminiState.apiKeySet = true;
  geminiState.embedThrow = false;
  geminiState.embedEmpty = false;
};

describe('POST /api/admin/faq/embed — auth', () => {
  beforeEach(() => {
    vi.resetModules();
    resetGeminiState();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('returns 401 when unauthenticated', async () => {
    await mockServerClient({ user: null, role: null });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is petugas (not admin)', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'petugas' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(403);
  });

  it('returns 403 when user has no petugas row', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: null });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/faq/embed — backfill', () => {
  beforeEach(() => {
    vi.resetModules();
    resetGeminiState();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('returns count 0 when no FAQs need embedding', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({ pendingFaqs: [], remainingCount: 0 });
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.embedded).toBe(0);
    expect(json.remaining).toBe(0);
  });

  it('embeds and UPDATEs rows on happy path', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const serviceMock = await mockServiceClient({
      pendingFaqs: [
        { id: 'f-1', pertanyaan: 'Q1', jawaban: 'A1' },
        { id: 'f-2', pertanyaan: 'Q2', jawaban: 'A2' },
      ],
      remainingCount: 0,
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.embedded).toBe(2);
    expect(json.failed).toBe(0);
    expect(json.remaining).toBe(0);
    // update should have been called for each FAQ
    expect(serviceMock.from).toHaveBeenCalledWith('faq_knowledge_base');
  });

  it('returns 500 when GEMINI_API_KEY is unset', async () => {
    geminiState.apiKeySet = false;
    delete process.env.GEMINI_API_KEY;
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toMatch(/GEMINI_API_KEY/i);
  });

  it('returns 500 when SUPABASE_SERVICE_ROLE_KEY is unset', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
  });

  it('counts a row as failed when Gemini embedding throws', async () => {
    geminiState.embedThrow = true;
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({
      pendingFaqs: [{ id: 'f-1', pertanyaan: 'Q1', jawaban: 'A1' }],
      remainingCount: 1,
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.embedded).toBe(0);
    expect(json.failed).toBe(1);
    expect(json.remaining).toBe(1);
  });

  it('returns 500 when fetching pending FAQs errors', async () => {
    await mockServerClient({ user: { id: 'u-1' }, role: 'admin' });
    await mockServiceClient({ fetchError: { message: 'connection refused' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(500);
  });
});
