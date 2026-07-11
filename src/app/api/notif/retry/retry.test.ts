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

interface FailedRow {
  id: string;
  kanal: 'email' | 'web_push';
  tujuan_email: string | null;
  tujuan_user_id: string | null;
  subjek: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  retry_count: number;
}

interface ServiceClientOpts {
  failed?: FailedRow[];
  subscriptions?: { endpoint: string; keys: { p256dh: string; auth: string } }[];
}

const mockServiceClient = async (opts: ServiceClientOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.CRON_SECRET = 'cron-secret';
  process.env.RESEND_API_KEY = 're_test';
  process.env.VAPID_PUBLIC_KEY = 'BPubxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.VAPID_PRIVATE_KEY = 'privxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
  process.env.RESEND_FROM = 'Test <noreply@test.example>';

  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const failedRows = opts.failed ?? [];
  const subsRows = opts.subscriptions ?? [];

  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockReturnThis(),
    data: null,
    error: null,
  };

  const pushSubChain = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    data: subsRows,
    error: null,
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === 'notifikasi') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              lt: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue({ data: failedRows, error: null }),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue(updateChain),
        };
      }
      if (table === 'push_subscriptions') {
        return pushSubChain;
      }
      return {};
    }),
    _updateChain: updateChain,
    _pushSubChain: pushSubChain,
  };

  createClient.mockReturnValue(mock);
  return mock;
};

const mockResendSuccess = async () => {
  const resendMod = await import('resend');
  const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
  const sendMock = vi.fn().mockResolvedValue({ data: { id: 're-msg-1' }, error: null });
  function ResendCtor(this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock };
  }
  Resend.mockImplementation(ResendCtor as unknown as () => unknown);
  return { emails: { send: sendMock } };
};

const mockResendFailure = async (errMsg: string) => {
  const resendMod = await import('resend');
  const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
  const sendMock = vi.fn().mockResolvedValue({ data: null, error: { message: errMsg } });
  function ResendCtor(this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock };
  }
  Resend.mockImplementation(ResendCtor as unknown as () => unknown);
  return { emails: { send: sendMock } };
};

const mockWebPushSuccess = async () => {
  wpMocks.sendNotification.mockResolvedValue({});
};

const mockWebPushFailure = async (errMsg: string) => {
  wpMocks.sendNotification.mockRejectedValue(new Error(errMsg));
};

const sampleFailedEmail: FailedRow = {
  id: 'f1',
  kanal: 'email',
  tujuan_email: 'retry@example.com',
  tujuan_user_id: null,
  subjek: 'Retry subject',
  body: 'Retry body',
  payload: null,
  retry_count: 1,
};

const sampleFailedPush: FailedRow = {
  id: 'f2',
  kanal: 'web_push',
  tujuan_email: null,
  tujuan_user_id: 'user-uuid-9',
  subjek: 'Retry push',
  body: 'Retry push body',
  payload: null,
  retry_count: 2,
};

describe('POST /api/notif/retry — CRON_SECRET auth', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when Authorization header missing', async () => {
    await mockServiceClient();
    await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when Authorization header does not match CRON_SECRET', async () => {
    await mockServiceClient();
    await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer wrong'));
    expect(res.status).toBe(401);
  });

  it('returns 500 when CRON_SECRET not configured', async () => {
    await mockServiceClient();
    await mockResendSuccess();
    delete process.env.CRON_SECRET;
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/notif/retry — re-attempt failed notifications', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('retries a failed email successfully and marks sent', async () => {
    const sc = await mockServiceClient({ failed: [sampleFailedEmail] });
    await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'f1');
  });

  it('marks failed again when retry still fails (retry_count incremented)', async () => {
    const sc = await mockServiceClient({ failed: [sampleFailedEmail] });
    await mockResendFailure('still rate limited');
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(1);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'f1');
  });

  it('retries a failed push successfully', async () => {
    const sc = await mockServiceClient({
      failed: [sampleFailedPush],
      subscriptions: [
        { endpoint: 'https://fcm.googleapis.com/r1', keys: { p256dh: 'p', auth: 'a' } },
      ],
    });
    await mockWebPushSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'f2');
  });

  it('marks failed when push retry rejects', async () => {
    const sc = await mockServiceClient({
      failed: [sampleFailedPush],
      subscriptions: [
        { endpoint: 'https://fcm.googleapis.com/r1', keys: { p256dh: 'p', auth: 'a' } },
      ],
    });
    await mockWebPushFailure('push still failing');
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(1);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'f2');
  });

  it('returns 200 with zero counts when no failed notifications eligible', async () => {
    await mockServiceClient({ failed: [] });
    await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(0);
  });
});

describe('POST /api/notif/retry — updateStatus await regression', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('awaits the supabase update() Promise (mock returns a real Promise)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.RESEND_API_KEY = 're_test';
    process.env.VAPID_PUBLIC_KEY = 'BPubxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env.VAPID_PRIVATE_KEY = 'privxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env.RESEND_FROM = 'Test <noreply@test.example>';

    const supabaseMod = await import('@supabase/supabase-js');
    const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const failedRows: FailedRow[] = [sampleFailedEmail];

    // The update Promise resolves on a macrotask (setTimeout). If
    // updateStatus does NOT await it, POST returns before the timer
    // fires, so updateResolved is still false synchronously after
    // POST resolves. If updateStatus DOES await it, POST cannot return
    // until the timer fires, so updateResolved is true by then.
    let updateResolved = false;
    const updateEqSpy = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            updateResolved = true;
            resolve({ data: null, error: null });
          }, 10);
        }),
    );
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqSpy });

    const mock = {
      from: vi.fn((table: string) => {
        if (table === 'notifikasi') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: failedRows, error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        if (table === 'push_subscriptions') {
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            data: [],
            error: null,
          };
        }
        return {};
      }),
    };

    createClient.mockReturnValue(mock);

    const resendMod = await import('resend');
    const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
    const sendMock = vi.fn().mockResolvedValue({ data: { id: 're-msg-1' }, error: null });
    function ResendCtor(this: { emails: { send: typeof sendMock } }) {
      this.emails = { send: sendMock };
    }
    Resend.mockImplementation(ResendCtor as unknown as () => unknown);

    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    // Check synchronously BEFORE any further await: if updateStatus
    // awaited the macrotask Promise, POST could only have returned
    // after the timer fired (updateResolved === true). If it didn't
    // await, POST returned immediately and the 10ms timer has not
    // fired yet (updateResolved === false).
    expect(updateResolved).toBe(true);

    const json = await res.json();
    expect(json.sent).toBe(1);

    expect(updateMock).toHaveBeenCalled();
    expect(updateEqSpy).toHaveBeenCalledWith('id', 'f1');
  });

  it('does not increment retry_count when status is sent (only on failed)', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
    process.env.CRON_SECRET = 'cron-secret';
    process.env.RESEND_API_KEY = 're_test';
    process.env.VAPID_PUBLIC_KEY = 'BPubxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env.VAPID_PRIVATE_KEY = 'privxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    process.env.RESEND_FROM = 'Test <noreply@test.example>';

    const supabaseMod = await import('@supabase/supabase-js');
    const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const failedRows: FailedRow[] = [sampleFailedEmail];

    // Capture the patch passed to update() so we can assert retry_count
    // is NOT set when status === 'sent'.
    const updateEqSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqSpy });

    const mock = {
      from: vi.fn((table: string) => {
        if (table === 'notifikasi') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                lt: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: failedRows, error: null }),
                }),
              }),
            }),
            update: updateMock,
          };
        }
        if (table === 'push_subscriptions') {
          return {
            eq: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            data: [],
            error: null,
          };
        }
        return {};
      }),
    };

    createClient.mockReturnValue(mock);

    const resendMod = await import('resend');
    const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
    const sendMock = vi.fn().mockResolvedValue({ data: { id: 're-msg-1' }, error: null });
    function ResendCtor(this: { emails: { send: typeof sendMock } }) {
      this.emails = { send: sendMock };
    }
    Resend.mockImplementation(ResendCtor as unknown as () => unknown);

    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);

    // On successful retry (status 'sent'), retry_count must NOT be in the patch.
    expect(updateMock).toHaveBeenCalled();
    const patchArg = updateMock.mock.calls[0][0] as Record<string, unknown>;
    expect(patchArg.status).toBe('sent');
    expect(patchArg).not.toHaveProperty('retry_count');
    expect(patchArg).toHaveProperty('sent_at');
  });
});
