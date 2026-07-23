import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

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
  return new NextRequest(new URL(url, 'http://localhost'), reqOpts as any);
}

describe('/api/chat/messages API Route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('GET returns 400 when sesi_id is missing or invalid', async () => {
    const { GET } = await import('./route');
    const res = await GET(buildRequest('http://localhost/api/chat/messages'));
    expect(res.status).toBe(400);
  });

  it('GET returns messages when valid sesi_id is provided', async () => {
    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'chat_pesan') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [{ id: 'm1', pengirim: 'pengunjung', isi: 'Halo', created_at: '2026-07-23T10:00:00Z' }],
              error: null,
            }),
          };
        }
        if (table === 'chat_sesi') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: { status: 'bot' }, error: null }),
          };
        }
        return {};
      }),
    };

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { GET } = await import('./route');
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const res = await GET(buildRequest(`http://localhost/api/chat/messages?sesi_id=${validUuid}`));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toHaveLength(1);
    expect(json.messages[0].isi).toBe('Halo');
    expect(json.status).toBe('bot');
  });

  it('POST inserts message successfully', async () => {
    const validUuid = '123e4567-e89b-12d3-a456-426614174000';
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'm2', pengirim: 'petugas', isi: 'Ada yang bisa dibantu?', created_at: '2026-07-23T10:01:00Z' },
          error: null,
        }),
      }),
      channel: vi.fn().mockReturnValue({
        send: vi.fn().mockResolvedValue({}),
      }),
    };

    (createClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockSupabase);

    const { POST } = await import('./route');
    const res = await POST(
      buildRequest('http://localhost/api/chat/messages', {
        method: 'POST',
        body: { sesi_id: validUuid, pengirim: 'petugas', isi: 'Ada yang bisa dibantu?' },
      }),
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.message.isi).toBe('Ada yang bisa dibantu?');
  });
});
