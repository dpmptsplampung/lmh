// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(),
}));

import type { NextRequest } from "next/server";

const buildRequest = (body: unknown): NextRequest => {
  const req = new Request("http://localhost/api/investasi/lead", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    "http://localhost/api/investasi/lead",
  );
  return req as unknown as NextRequest;
};

interface MockServerOpts {
  user?: { id: string } | null;
  doc?: { id: string; status: string } | null;
  docError?: { message: string } | null;
  insertError?: { message: string; code?: string } | null;
  insertThrows?: { code?: string; message?: string };
  insertData?: { id: string } | null;
}

const mockServerClient = async (opts: MockServerOpts = {}) => {
  const serverMod = await import("@/lib/supabase/server");
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const user = opts.user === undefined ? { id: "user-1" } : opts.user;
  const docData = opts.doc === undefined ? null : opts.doc;
  const docErr = opts.docError ?? null;
  const insertErr = opts.insertError ?? null;
  const insertData = opts.insertData ?? { id: "new-lead-id" };

  const leadChain = {
    insert: vi.fn().mockImplementation(() => {
      if (opts.insertThrows) throw opts.insertThrows;
      return {
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: insertData, error: insertErr }),
        }),
      };
    }),
  };

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === "investment_documents") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: docData,
                error: docErr,
              }),
            }),
          }),
        };
      }
      if (table === "investasi_lead") {
        return leadChain;
      }
      return {};
    }),
    _leadChain: leadChain,
  };

  createClient.mockResolvedValue(mock);
  return mock;
};

const mockServiceClient = async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const supabaseMod = await import("@supabase/supabase-js");
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const mock = {
    from: vi.fn(() => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "svc-id" }, error: null }),
        }),
      }),
    })),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const validBody = {
  doc_id: "550e8400-e29b-41d4-a716-446655440000",
  nama: "Budi Investor",
  email: "budi@example.com",
  instansi: "PT Maju",
  minat: "Investasi perkebunan",
  catatan: "Mohon kontak minggu depan",
};

describe("POST /api/investasi/lead — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 400 when doc_id is not a UUID", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, doc_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when nama is missing", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, nama: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when email is invalid", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("{not json"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when doc_id is missing", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const { doc_id: _omit, ...bodyNoDoc } = validBody;
    void _omit;
    const res = await POST(buildRequest(bodyNoDoc));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/investasi/lead — auth gate", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 401 AUTH_REQUIRED when session is missing", async () => {
    await mockServerClient({ user: null, doc: { id: validBody.doc_id, status: "aktif" } });
    await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toMatch(/AUTH_REQUIRED|UNAUTHENTICATED/i);
  });
});

describe("POST /api/investasi/lead — doc existence checks", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 404 when doc_id not found", async () => {
    await mockServerClient({ doc: null });
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/tidak ditemukan|not found/i);
  });

  it("returns 404 when doc status is not aktif", async () => {
    await mockServerClient({ doc: { id: validBody.doc_id, status: "nonaktif" } });
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(404);
  });

  it("returns 500 when doc fetch errors", async () => {
    await mockServerClient({ docError: { message: "connection refused" } });
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/investasi/lead — happy path + no service-role bypass", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 201 when authenticated client inserts successfully", async () => {
    const serverMock = await mockServerClient({
      doc: { id: validBody.doc_id, status: "aktif" },
      insertError: null,
      insertData: { id: "new-lead-id" },
    });
    const serviceMock = await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("new-lead-id");
    expect(json.message).toMatch(/tercatat/i);

    const insertSpy = serverMock._leadChain.insert;
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.doc_id).toBe(validBody.doc_id);
    expect(payload.nama).toBe("Budi Investor");
    expect(payload.email).toBe("budi@example.com");
    expect(serviceMock.from).not.toHaveBeenCalled();
  });

  it("accepts minimal body (only required fields) and nulls optionals", async () => {
    const serverMock = await mockServerClient({
      doc: { id: validBody.doc_id, status: "aktif" },
      insertError: null,
      insertData: { id: "new-lead-id" },
    });
    await mockServiceClient();
    const { POST } = await import("./route");
    const minimal = { doc_id: validBody.doc_id, nama: "Sari", email: "sari@example.com" };
    const res = await POST(buildRequest(minimal));
    expect(res.status).toBe(201);
    const insertSpy = serverMock._leadChain.insert;
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.instansi).toBeNull();
    expect(payload.minat).toBeNull();
    expect(payload.catatan).toBeNull();
  });

  it("returns 429 and never service-role inserts when RLS/rate-limit rejects", async () => {
    await mockServerClient({
      doc: { id: validBody.doc_id, status: "aktif" },
      insertError: {
        message: "new row violates row-level security policy",
        code: "42501",
      },
    });
    const serviceMock = await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.code).toMatch(/RATE_LIMIT|RLS/i);
    expect(serviceMock.from).not.toHaveBeenCalled();
  });

  it("returns 409 on unique violation without service-role bypass", async () => {
    await mockServerClient({
      doc: { id: validBody.doc_id, status: "aktif" },
      insertError: { message: "duplicate key", code: "23505" },
    });
    const serviceMock = await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(409);
    expect(serviceMock.from).not.toHaveBeenCalled();
  });

  it("returns 500 on other insert errors without service-role bypass", async () => {
    await mockServerClient({
      doc: { id: validBody.doc_id, status: "aktif" },
      insertError: { message: "fk violation", code: "23503" },
    });
    const serviceMock = await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
    expect(serviceMock.from).not.toHaveBeenCalled();
  });

  it("route source has no service-role createClient / SUPABASE_SERVICE_ROLE_KEY", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/investasi/lead/route.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/createClient\s+as\s+createServiceClient/);
    expect(src).not.toMatch(/getServiceClient/);
  });
});
