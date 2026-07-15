// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("resend", () => ({
  Resend: vi.fn(),
}));

const wpMocks = vi.hoisted(() => ({
  sendNotification: vi.fn(),
  setVapidDetails: vi.fn(),
}));

vi.mock("web-push", () => {
  const api = {
    setVapidDetails: wpMocks.setVapidDetails,
    sendNotification: wpMocks.sendNotification,
    setGCMAPIKey: vi.fn(),
    generateVAPIDKeys: vi.fn(),
  };
  return { default: api, ...api };
});

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from "next/server";

const buildRequest = (authHeader?: string): NextRequest => {
  const req = new Request("http://localhost/api/notif/send", {
    method: "POST",
  });
  if (authHeader !== undefined) {
    req.headers.set("Authorization", authHeader);
  }
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    "http://localhost/api/notif/send",
  );
  return req as unknown as NextRequest;
};

interface ClaimedRow {
  id: string;
  claim_token: string;
  kanal: "email" | "web_push";
  tujuan_email: string | null;
  tujuan_user_id: string | null;
  subjek: string | null;
  body: string;
  payload: Record<string, unknown> | null;
}

interface ServiceClientOpts {
  claimed?: ClaimedRow[];
  claimError?: { message: string } | null;
  subscriptions?: { endpoint: string; keys: { p256dh: string; auth: string } }[];
}

const mockServiceClient = async (opts: ServiceClientOpts = {}) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  process.env.CRON_SECRET = "cron-secret";
  process.env.RESEND_API_KEY = "re_test";
  process.env.VAPID_PUBLIC_KEY = "BPubxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  process.env.VAPID_PRIVATE_KEY = "privxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
  process.env.RESEND_FROM = "Test <noreply@test.example>";

  const supabaseMod = await import("@supabase/supabase-js");
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const claimedRows = opts.claimed ?? [];
  const claimErr = opts.claimError ?? null;
  const subsRows = opts.subscriptions ?? [];

  const completeCalls: unknown[] = [];

  const pushSubChain = {
    eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    data: subsRows,
    error: null,
  };

  const mock = {
    from: vi.fn((table: string) => {
      if (table === "push_subscriptions") {
        return pushSubChain;
      }
      return {};
    }),
    rpc: vi.fn(async (fn: string, args?: Record<string, unknown>) => {
      if (fn === "claim_notifikasi") {
        return { data: claimedRows, error: claimErr };
      }
      if (fn === "complete_notifikasi") {
        completeCalls.push(args);
        return { data: true, error: null };
      }
      return { data: null, error: { message: `unknown rpc ${fn}` } };
    }),
    _completeCalls: completeCalls,
    _pushSubChain: pushSubChain,
  };

  createClient.mockReturnValue(mock);
  return mock;
};

const mockResendSuccess = async () => {
  const resendMod = await import("resend");
  const Resend = resendMod.Resend as unknown as ReturnType<typeof vi.fn>;
  const sendMock = vi.fn().mockResolvedValue({ data: { id: "re-msg-1" }, error: null });
  function ResendCtor(this: { emails: { send: typeof sendMock } }) {
    this.emails = { send: sendMock };
  }
  Resend.mockImplementation(ResendCtor as unknown as () => unknown);
  return { emails: { send: sendMock } };
};

const mockResendFailure = async (errMsg: string) => {
  const resendMod = await import("resend");
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

const sampleEmailRow: ClaimedRow = {
  id: "n1",
  claim_token: "tok-1",
  kanal: "email",
  tujuan_email: "pengunjung@example.com",
  tujuan_user_id: null,
  subjek: "Survei Kepuasan Masyarakat — DPMPTSP Lampung",
  body: "Layanan Anda telah selesai. Mohon isi survei: https://lmh.lampungprov.go.id/skm?token=abc",
  payload: { visit_id: "v1", type: "skm_survey" },
};

const samplePushRow: ClaimedRow = {
  id: "n2",
  claim_token: "tok-2",
  kanal: "web_push",
  tujuan_email: null,
  tujuan_user_id: "user-uuid-2",
  subjek: "Listing UMKM Anda Disetujui",
  body: "Listing Anda telah disetujui.",
  payload: { listing_id: "l1", type: "umkm_approved" },
};

describe("POST /api/notif/send — CRON_SECRET auth", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 when Authorization header missing", async () => {
    await mockServiceClient();
    await mockResendSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest());
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header does not match CRON_SECRET", async () => {
    await mockServiceClient();
    await mockResendSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
  });

  it("returns 500 when CRON_SECRET env var is not configured", async () => {
    await mockServiceClient();
    await mockResendSuccess();
    delete process.env.CRON_SECRET;
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(500);
  });
});

describe("GET /api/notif/send — Vercel Cron", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 without Authorization", async () => {
    await mockServiceClient();
    await mockResendSuccess();
    const { GET } = await import("./route");
    const res = await GET(buildRequest());
    expect(res.status).toBe(401);
  });

  it("with valid CRON_SECRET works same as POST (claims and returns counts)", async () => {
    const sc = await mockServiceClient({ claimed: [sampleEmailRow] });
    await mockResendSuccess();
    const { GET } = await import("./route");
    const res = await GET(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(sc.rpc).toHaveBeenCalledWith(
      "claim_notifikasi",
      expect.objectContaining({ p_limit: expect.any(Number) }),
    );
  });
});

describe("POST /api/notif/send — claim-before-send", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("claims via claim_notifikasi RPC before sending", async () => {
    const sc = await mockServiceClient({ claimed: [sampleEmailRow] });
    await mockResendSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    expect(sc.rpc).toHaveBeenCalledWith(
      "claim_notifikasi",
      expect.objectContaining({ p_limit: expect.any(Number) }),
    );
    // Must not select pending rows directly without claim
    expect(sc.from).not.toHaveBeenCalledWith("notifikasi");
  });

  it("completes via complete_notifikasi with claim_token after send", async () => {
    const sc = await mockServiceClient({ claimed: [sampleEmailRow] });
    const resendInstance = await mockResendSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(resendInstance.emails.send).toHaveBeenCalledTimes(1);
    expect(sc.rpc).toHaveBeenCalledWith(
      "complete_notifikasi",
      expect.objectContaining({
        p_id: "n1",
        p_claim_token: "tok-1",
        p_status: "sent",
      }),
    );
  });

  it("marks failed via complete_notifikasi when Resend errors", async () => {
    const sc = await mockServiceClient({ claimed: [sampleEmailRow] });
    await mockResendFailure("rate limited");
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.failed).toBe(1);
    expect(sc.rpc).toHaveBeenCalledWith(
      "complete_notifikasi",
      expect.objectContaining({
        p_id: "n1",
        p_claim_token: "tok-1",
        p_status: "failed",
      }),
    );
  });

  it("skips email rows where tujuan_email is null", async () => {
    const sc = await mockServiceClient({
      claimed: [{ ...sampleEmailRow, tujuan_email: null }],
    });
    const resendInstance = await mockResendSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(resendInstance.emails.send).not.toHaveBeenCalled();
    expect(sc.rpc).toHaveBeenCalledWith(
      "complete_notifikasi",
      expect.objectContaining({ p_status: "skipped" }),
    );
  });

  it("sends push and completes with claim_token", async () => {
    const sc = await mockServiceClient({
      claimed: [samplePushRow],
      subscriptions: [
        { endpoint: "https://fcm.googleapis.com/e1", keys: { p256dh: "p1", auth: "a1" } },
      ],
    });
    await mockWebPushSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(1);
    expect(wpMocks.sendNotification).toHaveBeenCalledTimes(1);
    expect(sc.rpc).toHaveBeenCalledWith(
      "complete_notifikasi",
      expect.objectContaining({ p_id: "n2", p_claim_token: "tok-2", p_status: "sent" }),
    );
  });

  it("marks failed when sendNotification rejects", async () => {
    const sc = await mockServiceClient({
      claimed: [samplePushRow],
      subscriptions: [
        { endpoint: "https://fcm.googleapis.com/e1", keys: { p256dh: "p1", auth: "a1" } },
      ],
    });
    await mockWebPushFailure("push failed");
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.failed).toBe(1);
    expect(sc.rpc).toHaveBeenCalledWith(
      "complete_notifikasi",
      expect.objectContaining({ p_status: "failed" }),
    );
  });

  it("skips when user has no subscriptions", async () => {
    const sc = await mockServiceClient({
      claimed: [samplePushRow],
      subscriptions: [],
    });
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(1);
    expect(sc.rpc).toHaveBeenCalledWith(
      "complete_notifikasi",
      expect.objectContaining({ p_status: "skipped" }),
    );
  });

  it("handles mixed batch and returns aggregate counts", async () => {
    const sc = await mockServiceClient({
      claimed: [sampleEmailRow, samplePushRow],
      subscriptions: [
        { endpoint: "https://fcm.googleapis.com/e2", keys: { p256dh: "p2", auth: "a2" } },
      ],
    });
    await mockResendSuccess();
    await mockWebPushSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(2);
    expect(json.failed).toBe(0);
    expect(sc.rpc).toHaveBeenCalledWith("claim_notifikasi", expect.any(Object));
  });

  it("returns 200 with zero counts when claim returns empty", async () => {
    await mockServiceClient({ claimed: [] });
    await mockResendSuccess();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("Bearer cron-secret"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sent).toBe(0);
    expect(json.failed).toBe(0);
  });

  it("route source uses claim_notifikasi not select-pending-then-update", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/notif/send/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/claim_notifikasi/);
    expect(src).toMatch(/complete_notifikasi/);
    expect(src).not.toMatch(/\.eq\(\s*['"]status['"]\s*,\s*['"]pending['"]\s*\)/);
  });
});
