// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const serverState = {
  callerId: 'auth-officer-1' as string | null,
  // RPC lingkup chat (boleh_chat_sesi, Fase 5) klien berJWT pengguna; undefined = migrasi belum diterapkan (aturan lama).
  rpc: undefined as undefined | ((nama: string, args: unknown) => Promise<unknown>),
};

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: serverState.callerId ? { id: serverState.callerId } : null },
        error: null,
      })),
    },
    rpc: serverState.rpc,
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

const mockServiceClient = async (
  opts: {
    isPetugas?: boolean;
    hasSesi?: boolean;
    role?: 'petugas' | 'admin';
    petugasLayananId?: string | null;
    sesiLayananId?: string;
    aktif?: boolean;
  } = {},
) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GEMINI_API_KEY = 'test-key';
  serverState.callerId = 'auth-officer-1';

  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const isPetugas = opts.isPetugas ?? true;
  const hasSesi = opts.hasSesi ?? true;
  const role = opts.role ?? 'petugas';
  const aktif = opts.aktif ?? true;
  const petugasLayananId = opts.petugasLayananId === undefined ? 'layanan-1' : opts.petugasLayananId;
  const sesiLayananId = opts.sesiLayananId ?? 'layanan-1';

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
            data: isPetugas
              ? { id: 'petugas-1', role, layanan_id: petugasLayananId, aktif }
              : null,
            error: null,
          }),
        };
      }
      if (table === 'chat_sesi') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: hasSesi ? { id: SESI_ID, layanan_id: sesiLayananId } : null,
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
    serverState.rpc = undefined;
  });

  it('lingkup DB (Fase 5): petugas Layanan sama tetap DITOLAK bila boleh_chat_sesi false (chat tertutup milik rekan)', async () => {
    await mockServiceClient({ isPetugas: true });
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    serverState.rpc = rpc;
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ sesi_id: SESI_ID }));
    expect(res.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith('boleh_chat_sesi', { p_sesi: SESI_ID });
  });

  it('lingkup DB (Fase 5): boleh_chat_sesi true -> 200; galat RPC selain "belum ada" -> 403', async () => {
    await mockServiceClient({ isPetugas: true });
    serverState.rpc = vi.fn(async () => ({ data: true, error: null }));
    let { POST } = await import('./route');
    expect((await POST(buildRequest({ sesi_id: SESI_ID }))).status).toBe(200);

    vi.resetModules();
    await mockServiceClient({ isPetugas: true });
    serverState.rpc = vi.fn(async () => ({ data: null, error: { code: '57014', message: 'timeout' } }));
    ({ POST } = await import('./route'));
    expect((await POST(buildRequest({ sesi_id: SESI_ID }))).status).toBe(403);
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

  it('returns 403 when petugas is NONAKTIF (query service-role melewati RLS)', async () => {
    await mockServiceClient({ isPetugas: true, aktif: false });
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

  it('returns 403 when petugas layanan does not match session', async () => {
    await mockServiceClient({
      isPetugas: true,
      petugasLayananId: 'layanan-other',
      sesiLayananId: 'layanan-1',
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ sesi_id: SESI_ID }));
    expect(res.status).toBe(403);
  });

  it('allows admin to draft for any layanan session', async () => {
    await mockServiceClient({
      isPetugas: true,
      role: 'admin',
      petugasLayananId: null,
      sesiLayananId: 'layanan-1',
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest({ sesi_id: SESI_ID }));
    expect(res.status).toBe(200);
  });
});
