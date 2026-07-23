// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const serverState = {
  callerId: 'auth-officer-1' as string | null,
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: serverState.callerId ? { id: serverState.callerId } : null },
        error: null,
      })),
    },
  })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

const geminiState = {
  generateText: 'Yth. Pengunjung, syarat pembuatan NIB dapat diakses melalui portal OSS.',
};

vi.mock('@/lib/gemini', () => ({
  getGenerativeClient: () => ({
    getGenerativeModel: () => ({
      generateContent: async () => ({
        response: { text: () => geminiState.generateText },
      }),
    }),
  }),
  getChatModel: () => ({
    generateContent: async () => ({
      response: { text: () => geminiState.generateText },
    }),
  }),
  buildRagContext: (matches: unknown[]) =>
    `Context:\n${matches.map((m, i) => `[${i + 1}] Q: ${(m as { pertanyaan: string }).pertanyaan}`).join('\n')}`,
}));

import type { NextRequest } from 'next/server';

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request('http://localhost/api/chat/ai/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL('http://localhost/api/chat/ai/draft');
  return req as unknown as NextRequest;
};

const SESI_ID = '660e8400-e29b-41d4-a716-446655440001';

const mockServiceClient = async (opts: { isPetugas?: boolean; hasSesi?: boolean } = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GEMINI_API_KEY = 'test-key';
  serverState.callerId = 'auth-officer-1';

  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const isPetugas = opts.isPetugas ?? true;
  const hasSesi = opts.hasSesi ?? true;

  const mock = {
    rpc: vi.fn(async () => ({
      data: [{ id: 'f1', pertanyaan: 'Syarat NIB', jawaban: 'KTP OSS', similarity: 0.9 }],
      error: null,
    })),
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'petugas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: isPetugas ? { id: 'petugas-1', role: 'petugas' } : null,
            error: null,
          }),
        };
      }
      if (table === 'chat_sesi') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: hasSesi ? { id: SESI_ID, layanan_id: 'layanan-1' } : null,
            error: null,
          }),
        };
      }
      if (table === 'chat_pesan') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{ pengirim: 'pengunjung', isi: 'Apa syarat NIB?' }],
            error: null,
          }),
        };
      }
      if (table === 'layanan') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { nama: 'Bank Lampung' }, error: null }),
        };
      }
      return {};
    }),
  };

  createClient.mockReturnValue(mock);
  return mock;
};

describe('POST /api/chat/ai/draft', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when caller is unauthenticated', async () => {
    serverState.callerId = null;
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ sesi_id: SESI_ID }));
    expect(res.status).toBe(401);
  });

  it('returns 403 when caller is not a petugas', async () => {
    await mockServiceClient({ isPetugas: false });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ sesi_id: SESI_ID }));
    expect(res.status).toBe(403);
  });

  it('returns 200 with generated draft response when caller is a petugas', async () => {
    await mockServiceClient({ isPetugas: true });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ sesi_id: SESI_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.draft).toContain('NIB');
  });
});
