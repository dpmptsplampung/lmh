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
  const req = new Request("http://localhost/api/umkm/inquiry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    "http://localhost/api/umkm/inquiry",
  );
  return req as unknown as NextRequest;
};

const VALID_LISTING_ID = "550e8400-e29b-41d4-a716-446655440000";

const validBody = {
  listing_id: VALID_LISTING_ID,
  from_email: "pengunjung@example.com",
  from_nama: "Budi",
  pesan: "Saya tertarik, mohon info lebih lanjut.",
};

interface MockServerOpts {
  user?: { id: string } | null;
  listing?: { id: string; status?: string } | null;
  listingError?: { message: string } | null;
  insertError?: { message: string; code?: string } | null;
  insertThrows?: { code?: string; message?: string };
  insertedId?: string | null;
}

const mockServerClient = async (opts: MockServerOpts = {}) => {
  const serverMod = await import("@/lib/supabase/server");
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

  const user = opts.user === undefined ? { id: "user-1" } : opts.user;
  const listingData = opts.listing === undefined ? null : opts.listing;
  const listingErr = opts.listingError ?? null;
  const insertErr = opts.insertError ?? null;
  const insertedId = opts.insertedId ?? null;

  const inquiryInsertChain = {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockImplementation(() => {
      if (opts.insertThrows) throw opts.insertThrows;
      if (insertErr) return { data: null, error: insertErr };
      return { data: { id: insertedId ?? "new-inquiry-id" }, error: null };
    }),
  };

  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn((table: string) => {
      if (table === "listing_umkm" || table === "v_umkm_public") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: listingData,
                error: listingErr,
              }),
            }),
          }),
        };
      }
      if (table === "umkm_inquiry") {
        return inquiryInsertChain;
      }
      return {};
    }),
    _inquiryInsertChain: inquiryInsertChain,
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
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: "svc-id" }, error: null }),
    })),
  };
  createClient.mockReturnValue(mock);
  return mock;
};

describe("POST /api/umkm/inquiry — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 400 when listing_id is not a UUID", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, listing_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when from_email missing", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({
      listing_id: VALID_LISTING_ID,
      pesan: "halo",
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when from_email is invalid format", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, from_email: "not-an-email" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when pesan missing", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({
      listing_id: VALID_LISTING_ID,
      from_email: "a@b.com",
    }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when pesan is empty string", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, pesan: "" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when pesan exceeds 2000 chars", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, pesan: "x".repeat(2001) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when from_nama exceeds 200 chars", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest({ ...validBody, from_nama: "x".repeat(201) }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when body is not valid JSON", async () => {
    await mockServerClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest("{not json"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/umkm/inquiry — auth gate", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 401 AUTH_REQUIRED when session is missing", async () => {
    await mockServerClient({ user: null, listing: { id: VALID_LISTING_ID, status: "published" } });
    await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.code).toMatch(/AUTH_REQUIRED|UNAUTHENTICATED/i);
  });
});

describe("POST /api/umkm/inquiry — listing state checks", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 404 when listing not found", async () => {
    await mockServerClient({ listing: null });
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/tidak ditemukan|tidak tayang/i);
  });

  it("returns 500 when listing lookup errors", async () => {
    await mockServerClient({ listingError: { message: "db down" } });
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/umkm/inquiry — happy path + no service-role bypass", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("returns 201 when authenticated client inserts successfully", async () => {
    const serverMock = await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: "published" },
      insertedId: "inq-123",
    });
    const serviceMock = await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("inq-123");
    expect(json.message).toMatch(/terkirim|disetujui/i);

    const insertSpy = serverMock._inquiryInsertChain.insert;
    expect(insertSpy).toHaveBeenCalledTimes(1);
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.listing_id).toBe(VALID_LISTING_ID);
    expect(payload.from_email).toBe("pengunjung@example.com");
    expect(payload.from_nama).toBe("Budi");
    expect(payload.pesan).toBe(validBody.pesan);
    expect(serviceMock.from).not.toHaveBeenCalled();
  });

  it("returns 429 and never service-role inserts when RLS/rate-limit rejects", async () => {
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: "published" },
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

  it("accepts optional from_nama field and stores it as null when absent", async () => {
    const serverMock = await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: "published" },
    });
    await mockServiceClient();
    const { POST } = await import("./route");
    const { from_nama: _omit, ...bodyNoNama } = validBody;
    void _omit;
    const res = await POST(buildRequest(bodyNoNama));
    expect(res.status).toBe(201);
    const insertSpy = serverMock._inquiryInsertChain.insert;
    const payload = insertSpy.mock.calls[0][0];
    expect(payload.from_nama).toBeNull();
  });

  it("returns 500 on other insert errors without service-role bypass", async () => {
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: "published" },
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
      path.join(process.cwd(), "src/app/api/umkm/inquiry/route.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).not.toMatch(/createClient\s+as\s+createServiceClient/);
    expect(src).not.toMatch(/getServiceClient/);
  });
});

describe("POST /api/umkm/inquiry — security (no contact leak)", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.local";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  });

  it("response body never contains kontak_email or kontak_hp", async () => {
    await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: "published" },
    });
    await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    const text = await res.text();
    expect(text).not.toMatch(/kontak_email/i);
    expect(text).not.toMatch(/kontak_hp/i);
  });

  it("verifies published listings through the safe projection with only id selected", async () => {
    const serverMock = await mockServerClient({
      listing: { id: VALID_LISTING_ID, status: "published" },
    });
    await mockServiceClient();
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));

    expect(res.status).toBe(201);
    expect(serverMock.from).toHaveBeenCalledWith("v_umkm_public");
    expect(serverMock.from).not.toHaveBeenCalledWith("listing_umkm");
    const lookup = serverMock.from.mock.results.find(
      (result) => result.type === "return" && "select" in result.value,
    )?.value;
    expect(lookup.select).toHaveBeenCalledWith("id");
  });

  it("error responses never leak contact fields", async () => {
    await mockServerClient({ listing: null });
    const { POST } = await import("./route");
    const res = await POST(buildRequest(validBody));
    const text = await res.text();
    expect(text).not.toMatch(/kontak_email/i);
    expect(text).not.toMatch(/kontak_hp/i);
  });
});
