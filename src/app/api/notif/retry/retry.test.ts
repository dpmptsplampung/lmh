// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('resend', () => ({
  Resend: vi.fn(),
}));

const wpMocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock('web-push', () => {
  const api = {
    setVapidDetails: wpMocks.setVapidDetails,
    sendNotification: wpMocks.sendNotification,
    setGCMAPIKey: vi.fn(),
    generateVAPIDKeys: vi.fn(),
  };
  return { default: api, ...api };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (authHeader?: string): NextRequest => {
  const req = new Request('http://localhost/api/notif/retry', {
    method: 'POST',
  });
  if (authHeader !== undefined) {
    req.headers.set('Authorization', authHeader);
  }
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/notif/retry',
  );
  return req as unknown as NextRequest;
};

interface ClaimedRow {
  id: string;
  claim_token: string;
  kanal: 'email' | 'web_push';
  tujuan_email: string | null;
  tujuan_user_id: string | null;
  subjek: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  retry_count: number;
}

const mockServiceClient = async (opts: {
  claimed?: ClaimedRow[];
  subscriptions?: { endpoint: string; keys: { p256dh: string; auth: string } }[];
} = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.RESEND_API_KEY = 're_test';
  process.env.VAPID_PUBLIC_KEY = 'BPubxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.VAPID_PRIVATE_KEY = 'privxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.RESEND_FROM = 'Test <noreply@test.example>';

  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const claimedRows = opts.claimed ?? [];
  const subsRows = opts.subscriptions ?? [];

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'push_subscriptions') {
        return {
          eq: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          data: subsRows,
          error: null,
        };
      }
      return {};
    }),
    rpc: vi.fn(async (fn: string, _args?: Record<string, unknown>) => {
      void _args;
      if (fn === 'claim_notifikasi') {
        return { data: claimedRows, error: null };
      }
      if (fn === 'complete_notifikasi') {
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown ${fn}` } };
    }),
  };

  createClient.mockReturnValue(mock);
  return mock;
};

const sampleFailedEmail: ClaimedRow = {
  id: 'f1',
  claim_token: 'rtok-1',
  kanal: 'email',
  tujuan_email: 'a@b.com',
  tujuan_user_id: null,
  subjek: 'Retry',
  body: 'body',
  payload: null,
  retry_count: 1,
};

describe('POST /api/notif/retry — claim-before-send', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 without cron secret', async () => {
    await mockServiceClient();
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
  });

  it('claims failed notifications via claim_notifikasi with failed mode', async () => {
    const sc = await mockServiceClient({ claimed: [sampleFailedEmail] });
    const resendMod = await import('resend');
    const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
    const sendMock = vi.fn().mockResolvedValue({ data: { id: 'm' }, error: null });
    function ResendCtor(this: { emails: { send: typeof sendMock } }) {
      this.emails = { send: sendMock };
    }
    Resend.mockImplementation(ResendCtor as unknown as () => unknown);

    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    expect(sc.rpc).toHaveBeenCalledWith(
      'claim_notifikasi',
      expect.objectContaining({ p_status: 'failed' }),
    );
    expect(sc.from).not.toHaveBeenCalledWith('notifikasi');
    expect(sc.rpc).toHaveBeenCalledWith(
      'complete_notifikasi',
      expect.objectContaining({ p_id: 'f1', p_claim_token: 'rtok-1' }),
    );
  });

  it('route source uses claim_notifikasi not select-failed-then-update', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/notif/retry/route.ts'),
      'utf8',
    );
    expect(src).toMatch(/claim_notifikasi/);
    expect(src).toMatch(/complete_notifikasi/);
    expect(src).not.toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]failed['"]\s*\)/);
  });
});

describe('GET /api/notif/retry — Vercel Cron', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 without cron secret', async () => {
    await mockServiceClient();
    const { GET } = await import('./route');
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it('with valid CRON_SECRET works same as POST', async () => {
    const sc = await mockServiceClient({ claimed: [sampleFailedEmail] });
    const resendMod = await import('resend');
    const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
    const sendMock = vi.fn().mockResolvedValue({ data: { id: 'm' }, error: null });
    function ResendCtor(this: { emails: { send: typeof sendMock } }) {
      this.emails = { send: sendMock };
    }
    Resend.mockImplementation(ResendCtor as unknown as () => unknown);

    const { GET } = await import('./route');
    const res = await GET(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    expect(sc.rpc).toHaveBeenCalledWith(
      'claim_notifikasi',
      expect.objectContaining({ p_status: 'failed' }),
    );
  });
});
