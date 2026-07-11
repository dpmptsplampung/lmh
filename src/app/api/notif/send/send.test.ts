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
  const req = new Request('http://localhost/api/notif/send', {
    method: 'POST',
  });
  if (authHeader !== undefined) {
    req.headers.set('Authorization', authHeader);
  }
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    'http://localhost/api/notif/send',
  );
  return req as unknown as NextRequest;
};

interface PendingRow {
  id: string;
  kanal: 'email' | 'web_push';
  tujuan_email: string | null;
  tujuan_user_id: string | null;
  subjek: string | null;
  body: string;
  payload: Record<string, unknown> | null;
}

interface ServiceClientOpts {
  pending?: PendingRow[];
  subscriptions?: { endpoint: string; keys: { p256dh: string; auth: string } }[];
  updateError?: { message: string } | null;
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

  const pendingRows = opts.pending ?? [];
  const subsRows = opts.subscriptions ?? [];
  const updateErr = opts.updateError ?? null;

  const updateChain = {
    eq: vi.fn().mockReturnThis(),
    data: null,
    error: updateErr,
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
              limit: vi.fn().mockResolvedValue({ data: pendingRows, error: null }),
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

const sampleEmailRow: PendingRow = {
  id: 'n1',
  kanal: 'email',
  tujuan_email: 'pengunjung@example.com',
  tujuan_user_id: null,
  subjek: 'Survei Kepuasan Masyarakat — DPMPTSP Lampung',
  body: 'Layanan Anda telah selesai. Mohon isi survei: https://lmh.lampungprov.go.id/skm?token=abc',
  payload: { visit_id: 'v1', type: 'skm_survey' },
};

const samplePushRow: PendingRow = {
  id: 'n2',
  kanal: 'web_push',
  tujuan_email: null,
  tujuan_user_id: 'user-uuid-2',
  subjek: 'Listing UMKM Anda Disetujui',
  body: 'Listing Anda telah disetujui.',
  payload: { listing_id: 'l1', type: 'umkm_approved' },
};

describe('POST /api/notif/send — CRON_SECRET auth', () => {
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
    const res = await POST(buildRequest('Bearer wrong-secret'));
    expect(res.status).toBe(401);
  });

  it('returns 500 when CRON_SECRET env var is not configured', async () => {
    await mockServiceClient();
    await mockResendSuccess();
    delete process.env.CRON_SECRET;
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(500);
  });
});

describe('POST /api/notif/send — email via Resend', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sends email via Resend and marks notifikasi sent', async () => {
    const sc = await mockServiceClient({ pending: [sampleEmailRow] });
    const resendInstance = await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);

    expect(resendInstance.emails.send).toHaveBeenCalledTimes(1);
    const call = resendInstance.emails.send.mock.calls[0][0];
    expect(call.to).toBe('pengunjung@example.com');
    expect(call.subject).toContain('Survei Kepuasan');
    expect(call.html).toContain('/skm?token=abc');

    // status updated to 'sent'
    expect(sc.from).toHaveBeenCalledWith('notifikasi');
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n1');
  });

  it('marks notifikasi failed when Resend returns an error', async () => {
    const sc = await mockServiceClient({ pending: [sampleEmailRow] });
    await mockResendFailure('rate limited');
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(1);

    // status updated to 'failed'
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n1');
  });

  it('skips email rows where tujuan_email is null', async () => {
    const sc = await mockServiceClient({
      pending: [{ ...sampleEmailRow, tujuan_email: null }],
    });
    const resendInstance = await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.skipped).toBe(1);
    expect(resendInstance.emails.send).not.toHaveBeenCalled();
    // status updated to 'skipped'
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n1');
  });
});

describe('POST /api/notif/send — web_push via web-push', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('sends push to all subscriptions for the user and marks sent', async () => {
    const sc = await mockServiceClient({
      pending: [samplePushRow],
      subscriptions: [
        { endpoint: 'https://fcm.googleapis.com/e1', keys: { p256dh: 'p1', auth: 'a1' } },
      ],
    });
    await mockWebPushSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(json.failed).toBe(0);

    expect(wpMocks.sendNotification).toHaveBeenCalledTimes(1);
    const subArg = wpMocks.sendNotification.mock.calls[0][0];
    expect(subArg.endpoint).toBe('https://fcm.googleapis.com/e1');
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n2');
  });

  it('marks failed when sendNotification rejects', async () => {
    const sc = await mockServiceClient({
      pending: [samplePushRow],
      subscriptions: [
        { endpoint: 'https://fcm.googleapis.com/e1', keys: { p256dh: 'p1', auth: 'a1' } },
      ],
    });
    await mockWebPushFailure('push failed');
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(1);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n2');
  });

  it('skips when user has no subscriptions', async () => {
    const sc = await mockServiceClient({
      pending: [samplePushRow],
      subscriptions: [],
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.skipped).toBe(1);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n2');
  });
});

describe('POST /api/notif/send — mixed batch', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('handles a batch with mixed kanal and returns aggregate counts', async () => {
    const sc = await mockServiceClient({
      pending: [sampleEmailRow, samplePushRow],
      subscriptions: [
        { endpoint: 'https://fcm.googleapis.com/e2', keys: { p256dh: 'p2', auth: 'a2' } },
      ],
    });
    await mockResendSuccess();
    await mockWebPushSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(2);
    expect(json.failed).toBe(0);
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n1');
    expect(sc._updateChain.eq).toHaveBeenCalledWith('id', 'n2');
  });

  it('returns 200 with zero counts when no pending notifications', async () => {
    await mockServiceClient({ pending: [] });
    await mockResendSuccess();
    const { POST } = await import('./route');
    const res = await POST(buildRequest('Bearer cron-secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(0);
  });
});

describe('POST /api/notif/send — updateStatus await regression', () => {
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

    const pendingRows: PendingRow[] = [sampleEmailRow];

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
                limit: vi.fn().mockResolvedValue({ data: pendingRows, error: null }),
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
    expect(updateEqSpy).toHaveBeenCalledWith('id', 'n1');
  });
});
