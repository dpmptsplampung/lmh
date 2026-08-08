import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { broadcastNewMessage } from './route';

const serverState = {
  callerId: 'auth-user-1' as string | null,
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

import { createClient } from '@supabase/supabase-js';

function buildRequest(url: string, opts: { method?: string; body?: unknown } = {}) {
  const reqOpts: RequestInit = { method: opts.method || 'GET' };
  if (opts.body) {
    reqOpts.body = JSON.stringify(opts.body);
    reqOpts.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(new URL(url, 'http://localhost'), reqOpts as ConstructorParameters<typeof NextRequest>[1]);
}

const SESI = '123e4567-e89b-12d3-a456-426614174000';
const LAYANAN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PENGUNJUNG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

type ActorConfig =
  | { kind: 'staff'; role: 'admin' | 'petugas'; layanan_id: string | null }
  | { kind: 'pengunjung'; id: string }
  | { kind: 'none' };

function mockAdmin(opts: {
  actor: ActorConfig;
  sesi?: {
    id: string;
    status: string;
    pengunjung_id: string | null;
    layanan_id: string | null;
  } | null;
  messages?: Array<{ id: string; pengirim: string; isi: string; created_at: string }>;
  insertResult?: { data: unknown; error: unknown };
}) {
  const sesi = opts.sesi === undefined
    ? {
        id: SESI,
        status: 'bot',
        pengunjung_id: PENGUNJUNG,
        layanan_id: LAYANAN,
      }
    : opts.sesi;

  const mockSupabase = {
    from: vi.fn((table: string) => {
      if (table === 'petugas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data:
              opts.actor.kind === 'staff'
                ? { role: opts.actor.role, layanan_id: opts.actor.layanan_id }
                : null,
            error: null,
          }),
        };
      }
      if (table === 'pengunjung') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: opts.actor.kind === 'pengunjung' ? { id: opts.actor.id } : null,
            error: null,
          }),
        };
      }
      if (table === 'chat_sesi') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: sesi, error: null }),
        };
      }
      if (table === 'chat_pesan') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: opts.messages ?? [],
            error: null,
          }),
          insert: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(
            opts.insertResult ?? {
              data: {
                id: 'm2',
                pengirim: 'pengunjung',
                isi: 'Halo',
                created_at: '2026-07-23T10:01:00Z',
              },
              error: null,
            },
          ),
        };
      }
      return {};
    }),
    channel: vi.fn().mockReturnValue({
      send: vi.fn().mockResolvedValue({}),
    }),
  };

  (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);
  return mockSupabase;
}

describe('/api/chat/messages API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    serverState.callerId = 'auth-user-1';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('GET returns 400 when sesi_id is missing or invalid', async () => {
    const { GET } = await import('./route');
    const res = await GET(buildRequest('http://localhost/api/chat/messages'));
    expect(res.status).toBe(400);
  });

  it('GET returns 401 when not authenticated', async () => {
    serverState.callerId = null;
    const { GET } = await import('./route');
    const res = await GET(
      buildRequest(`http://localhost/api/chat/messages?sesi_id=${SESI}`),
    );
    expect(res.status).toBe(401);
  });

  it('GET returns 403 when caller does not own the session', async () => {
    mockAdmin({
      actor: { kind: 'pengunjung', id: 'other-pengunjung' },
    });
    const { GET } = await import('./route');
    const res = await GET(
      buildRequest(`http://localhost/api/chat/messages?sesi_id=${SESI}`),
    );
    expect(res.status).toBe(403);
  });

  it('GET returns messages for session owner', async () => {
    mockAdmin({
      actor: { kind: 'pengunjung', id: PENGUNJUNG },
      messages: [
        {
          id: 'm1',
          pengirim: 'pengunjung',
          isi: 'Halo',
          created_at: '2026-07-23T10:00:00Z',
        },
      ],
    });

    const { GET } = await import('./route');
    const res = await GET(
      buildRequest(`http://localhost/api/chat/messages?sesi_id=${SESI}`),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].isi).toBe('Halo');
    expect(json.status).toBe('bot');
  });

  it('GET returns messages for petugas of the same layanan', async () => {
    mockAdmin({
      actor: { kind: 'staff', role: 'petugas', layanan_id: LAYANAN },
      messages: [],
    });
    const { GET } = await import('./route');
    const res = await GET(
      buildRequest(`http://localhost/api/chat/messages?sesi_id=${SESI}`),
    );
    expect(res.status).toBe(200);
  });

  it('GET returns 403 for petugas of a different layanan', async () => {
    mockAdmin({
      actor: {
        kind: 'staff',
        role: 'petugas',
        layanan_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    });
    const { GET } = await import('./route');
    const res = await GET(
      buildRequest(`http://localhost/api/chat/messages?sesi_id=${SESI}`),
    );
    expect(res.status).toBe(403);
  });

  it('POST returns 401 when not authenticated', async () => {
    serverState.callerId = null;
    const { POST } = await import('./route');
    const res = await POST(
      buildRequest('http://localhost/api/chat/messages', {
        method: 'POST',
        body: { sesi_id: SESI, isi: 'Halo' },
      }),
    );
    expect(res.status).toBe(401);
  });

  it('POST forces pengirim=pengunjung for citizen and ignores client spoof', async () => {
    const mock = mockAdmin({
      actor: { kind: 'pengunjung', id: PENGUNJUNG },
      insertResult: {
        data: {
          id: 'm2',
          pengirim: 'pengunjung',
          isi: 'Halo warga',
          created_at: '2026-07-23T10:01:00Z',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest('http://localhost/api/chat/messages', {
        method: 'POST',
        body: {
          sesi_id: SESI,
          // Client tries to impersonate petugas — must be ignored.
          pengirim: 'petugas',
          isi: 'Halo warga',
        },
      }),
    );

    expect(res.status).toBe(201);
    const insertChain = mock.from.mock.results.find(
      // chat_pesan is the last table touched for insert
      () => true,
    );
    // Inspect the insert payload via the chat_pesan from() call.
    const chatPesanCalls = mock.from.mock.calls.filter(([t]) => t === 'chat_pesan');
    expect(chatPesanCalls.length).toBeGreaterThan(0);
    const chatPesanBuilder = mock.from.mock.results[
      mock.from.mock.calls.findIndex(([t]) => t === 'chat_pesan')
    ]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(chatPesanBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ pengirim: 'pengunjung', isi: 'Halo warga' }),
    );
    void insertChain;
  });

  it('POST forces pengirim=petugas for staff', async () => {
    const mock = mockAdmin({
      actor: { kind: 'staff', role: 'petugas', layanan_id: LAYANAN },
      insertResult: {
        data: {
          id: 'm3',
          pengirim: 'petugas',
          isi: 'Ada yang bisa dibantu?',
          created_at: '2026-07-23T10:01:00Z',
        },
        error: null,
      },
    });

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest('http://localhost/api/chat/messages', {
        method: 'POST',
        body: {
          sesi_id: SESI,
          pengirim: 'pengunjung',
          isi: 'Ada yang bisa dibantu?',
        },
      }),
    );

    expect(res.status).toBe(201);
    const chatPesanBuilder = mock.from.mock.results[
      mock.from.mock.calls.findIndex(([t]) => t === 'chat_pesan')
    ]?.value as { insert: ReturnType<typeof vi.fn> };
    expect(chatPesanBuilder.insert).toHaveBeenCalledWith(
      expect.objectContaining({ pengirim: 'petugas' }),
    );
  });

  it('POST returns 403 when citizen does not own session', async () => {
    mockAdmin({
      actor: { kind: 'pengunjung', id: 'other-id' },
    });
    const { POST } = await import('./route');
    const res = await POST(
      buildRequest('http://localhost/api/chat/messages', {
        method: 'POST',
        body: { sesi_id: SESI, isi: 'Halo' },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('broadcasts new_message after subscribing to the session channel', async () => {
    const order: string[] = [];
    const fakeChannel = {
      subscribe: (cb?: (s: string) => void) => { order.push('subscribe'); cb?.('SUBSCRIBED'); return Promise.resolve('SUBSCRIBED'); },
      send: async () => { order.push('send'); return 'ok'; },
      unsubscribe: async () => { order.push('unsubscribe'); return 'ok'; },
    };
    const adminClient: any = { channel: () => fakeChannel };
    await broadcastNewMessage(adminClient, 'sesi-1', { id: 'm1' } as any);
    expect(order).toEqual(['subscribe', 'send', 'unsubscribe']);
  });
});
