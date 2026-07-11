// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

// Shared mutable state so each test can configure the Gemini mock behaviour
// before importing the route. The factory runs once at hoist time; tests set
// `geminiState` fields to drive the mocked methods.
const geminiState = {
  apiKeySet: true,
  embeddingThrow: false,
  embeddingEmpty: false,
  generateThrow: false,
  generateEmpty: false,
  generateText: 'Jawaban dari AI [1]',
};

vi.mock('@/lib/gemini', () => ({
  getGenerativeClient: () => {
    if (!geminiState.apiKeySet) return null;
    return {
      getGenerativeModel: () => ({
        embedContent: async () => {
          if (geminiState.embeddingThrow) {
            throw new Error('Gemini embedding API error');
          }
          const values = geminiState.embeddingEmpty
            ? []
            : new Array(768).fill(0.1);
          return { embedding: { values } };
        },
        generateContent: async () => {
          if (geminiState.generateThrow) {
            throw new Error('Gemini generateContent API error');
          }
          const text = geminiState.generateEmpty
            ? ''
            : geminiState.generateText;
          return { response: { text: () => text } };
        },
      }),
    };
  },
  getChatModel: () => ({
    generateContent: async () => {
      if (geminiState.generateThrow) {
        throw new Error('Gemini generateContent API error');
      }
      const text = geminiState.generateEmpty ? '' : geminiState.generateText;
      return { response: { text: () => text } };
    },
  }),
  getEmbeddingModel: () => ({
    embedContent: async () => {
      if (geminiState.embeddingThrow) {
        throw new Error('Gemini embedding API error');
      }
      const values = geminiState.embeddingEmpty
        ? []
        : new Array(768).fill(0.1);
      return { embedding: { values } };
    },
  }),
  buildRagContext: (matches: unknown[]) =>
    `Context:\n${matches
      .map((m, i) => `[${i + 1}] Q: ${(m as { pertanyaan: string }).pertanyaan}`)
      .join('\n')}`,
  SYSTEM_PROMPT_RAG: 'system-prompt',
}));

import type { NextRequest } from 'next/server';

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/chat/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/chat/ai',
  );
  return req as unknown as NextRequest;
};

interface MockServiceOpts {
  rpcData?: unknown[] | null;
  rpcError?: { message: string } | null;
  insertError?: unknown | null;
}

const mockServiceClient = async (opts: MockServiceOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<
    typeof vi.fn
  >;
  const insertChain = { error: opts.insertError ?? null };
  const mock = {
    rpc: vi.fn(async () => ({
      data: opts.rpcData ?? [],
      error: opts.rpcError ?? null,
    })),
    from: vi.fn().mockReturnValue({
      insert: vi.fn().mockReturnValue(insertChain),
    }),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const validBody = {
  pertanyaan: 'Apa syarat membuat NIB?',
  layanan_id: '550e8400-e29b-41d4-a716-446655440000',
  sesi_id: '660e8400-e29b-41d4-a716-446655440001',
};

const resetGeminiState = () => {
  geminiState.apiKeySet = true;
  geminiState.embeddingThrow = false;
  geminiState.embeddingEmpty = false;
  geminiState.generateThrow = false;
  geminiState.generateEmpty = false;
  geminiState.generateText = 'Jawaban dari AI [1]';
};

describe('POST /api/chat/ai — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
    resetGeminiState();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('returns 400 when pertanyaan is shorter than 3 chars', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ ...validBody, pertanyaan: 'ab' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when layanan_id is not a UUID', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(
      buildRequest({ ...validBody, layanan_id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when sesi_id is missing', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const { sesi_id: _omit, ...bodyWithoutSesi } = validBody;
    void _omit;
    const res = await POST(buildRequest(bodyWithoutSesi));
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('{not json'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/chat/ai — RAG flow', () => {
  beforeEach(() => {
    vi.resetModules();
    resetGeminiState();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  it('escalates (reason no_match) when no FAQ matches returned', async () => {
    await mockServiceClient({ rpcData: [] });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('no_match');
    expect(json.jawaban).toBeNull();
  });

  it('escalates (reason no_match) when top similarity < 0.7', async () => {
    await mockServiceClient({
      rpcData: [
        {
          id: 'f-1',
          layanan_id: validBody.layanan_id,
          pertanyaan: 'Q1',
          jawaban: 'A1',
          similarity: 0.55,
        },
      ],
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('no_match');
  });

  it('returns jawaban + sumber when top similarity >= 0.7', async () => {
    await mockServiceClient({
      rpcData: [
        {
          id: 'f-1',
          layanan_id: validBody.layanan_id,
          pertanyaan: 'Syarat NIB',
          jawaban: 'KTP + NPWP',
          similarity: 0.92,
        },
        {
          id: 'f-2',
          layanan_id: validBody.layanan_id,
          pertanyaan: 'Biaya NIB',
          jawaban: 'Gratis',
          similarity: 0.81,
        },
      ],
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(false);
    expect(json.jawaban).toBe('Jawaban dari AI [1]');
    expect(json.sumber).toHaveLength(2);
    expect(json.sumber[0]).toEqual({ id: 'f-1', pertanyaan: 'Syarat NIB' });
  });

  it('escalates (reason ai_error) when Gemini generateContent throws', async () => {
    geminiState.generateThrow = true;
    await mockServiceClient({
      rpcData: [
        {
          id: 'f-1',
          layanan_id: validBody.layanan_id,
          pertanyaan: 'Q1',
          jawaban: 'A1',
          similarity: 0.9,
        },
      ],
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('ai_error');
    expect(json.jawaban).toBeNull();
  });

  it('escalates (reason ai_error) when Gemini embedding throws', async () => {
    geminiState.embeddingThrow = true;
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('ai_error');
  });

  it('escalates (reason ai_error) when match_faq RPC errors', async () => {
    await mockServiceClient({ rpcError: { message: 'pgvector not enabled' } });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('ai_error');
  });

  it('escalates (reason ai_error) when GEMINI_API_KEY is unset', async () => {
    geminiState.apiKeySet = false;
    delete process.env.GEMINI_API_KEY;
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('ai_error');
  });

  it('escalates (reason ai_error) when service-role client unavailable', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('ai_error');
  });

  it('escalates (reason ai_error) when Gemini returns empty generateContent text', async () => {
    geminiState.generateEmpty = true;
    await mockServiceClient({
      rpcData: [
        {
          id: 'f-1',
          layanan_id: validBody.layanan_id,
          pertanyaan: 'Q1',
          jawaban: 'A1',
          similarity: 0.9,
        },
      ],
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.eskalasi).toBe(true);
    expect(json.reason).toBe('ai_error');
  });
});
