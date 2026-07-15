// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({
  getDocument: vi.fn(),
}));

vi.mock("canvas", () => ({
  createCanvas: vi.fn(),
}));

vi.mock("sharp", () => ({
  default: vi.fn(),
}));

import type { NextRequest } from "next/server";

const buildRequest = (body: FormData): NextRequest => {
  const req = new Request("http://localhost/api/investment-docs/upload", {
    method: "POST",
    body,
  });
  (req as unknown as { nextUrl: URL }).nextUrl = new URL(
    "http://localhost/api/investment-docs/upload",
  );
  return req as unknown as NextRequest;
};

const PDF_MAGIC = new TextEncoder().encode("%PDF-1.4\n%fake");

const mockSupabase = async (
  auth: { user: { id: string } | null; role: string | null },
  opts: {
    storageUploadError?: unknown | ((path: string) => unknown);
    insertError?: unknown;
    removeSpy?: ReturnType<typeof vi.fn>;
  } = {},
) => {
  const serverMod = await import("@/lib/supabase/server");
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const remove = opts.removeSpy ?? vi.fn().mockResolvedValue({ data: null, error: null });
  const upload = vi.fn().mockImplementation(async (path: string) => {
    if (typeof opts.storageUploadError === "function") {
      const err = opts.storageUploadError(path);
      return { error: err ?? null };
    }
    return { error: opts.storageUploadError ?? null };
  });
  const mock = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: auth.user }, error: null }),
    },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: auth.user ? { role: auth.role } : null,
            error: null,
          }),
        }),
      }),
      insert: vi.fn().mockReturnValue({ error: opts.insertError ?? null }),
    }),
    storage: {
      from: vi.fn().mockReturnValue({
        upload,
        remove,
      }),
    },
    _upload: upload,
    _remove: remove,
  };
  createClient.mockResolvedValue(mock);
  return mock;
};

const mockPdfConvert = async (pageCount = 1) => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const canvas = await import("canvas");
  const pages = Array.from({ length: pageCount }, () => ({
    getViewport: () => ({ width: 100, height: 100 }),
    render: () => ({ promise: Promise.resolve() }),
    cleanup: vi.fn(),
  }));
  (pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    promise: Promise.resolve({
      numPages: pageCount,
      getPage: vi.fn(async (n: number) => pages[n - 1]),
      cleanup: vi.fn(),
    }),
  });
  (canvas.createCanvas as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    getContext: () => ({}),
    toBuffer: () => Buffer.from("png"),
  });
};

describe("POST /api/investment-docs/upload — auth", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 when unauthenticated", async () => {
    await mockSupabase({ user: null, role: null });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("judul", "Test Doc");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is petugas (not admin)", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: "petugas" });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("judul", "Test Doc");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(403);
  });

  it("returns 403 when user has no petugas row", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: null });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("judul", "Test Doc");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/investment-docs/upload — input validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 400 when pdf field missing (admin authed)", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: "admin" });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("judul", "Test Doc");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/pdf/i);
  });

  it("returns 400 when judul missing", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: "admin" });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append(
      "pdf",
      new File([PDF_MAGIC], "x.pdf", { type: "application/pdf" }),
    );
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
  });

  it("returns 413 when pdf exceeds 50 MB", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: "admin" });
    const { POST } = await import("./route");
    const big = new Uint8Array(50 * 1024 * 1024 + 1);
    big.set(PDF_MAGIC.subarray(0, 5), 0);
    const form = new FormData();
    form.append("pdf", new File([big], "big.pdf", { type: "application/pdf" }));
    form.append("judul", "Big Doc");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(413);
  });

  it("returns 400 when pdf is not a pdf content-type", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: "admin" });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("pdf", new File([new Uint8Array([1, 2])], "x.txt", { type: "text/plain" }));
    form.append("judul", "X");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
  });

  it("returns 400 when magic bytes are not %PDF", async () => {
    await mockSupabase({ user: { id: "u-1" }, role: "admin" });
    const { POST } = await import("./route");
    const form = new FormData();
    form.append(
      "pdf",
      new File([new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04])], "fake.pdf", {
        type: "application/pdf",
      }),
    );
    form.append("judul", "Fake");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/pdf|magic|invalid/i);
  });
});

describe("POST /api/investment-docs/upload — cleanup on failure", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("deletes raw and page objects when DB insert fails", async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    await mockSupabase(
      { user: { id: "u-1" }, role: "admin" },
      { insertError: { message: "db fail" }, removeSpy: remove },
    );
    await mockPdfConvert(2);
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("pdf", new File([PDF_MAGIC], "ok.pdf", { type: "application/pdf" }));
    form.append("judul", "Cleanup Doc");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(500);
    expect(remove).toHaveBeenCalled();
    const removed = remove.mock.calls.flatMap((c) => c[0] as string[]);
    expect(removed.some((p) => p.includes("_raw/"))).toBe(true);
    expect(removed.some((p) => p.includes("pages/"))).toBe(true);
  });

  it("deletes raw when conversion fails", async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    await mockSupabase({ user: { id: "u-1" }, role: "admin" }, { removeSpy: remove });
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    (pdfjs.getDocument as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      promise: Promise.resolve().then(() => {
        throw new Error("bad pdf");
      }),
    }));
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("pdf", new File([PDF_MAGIC], "ok.pdf", { type: "application/pdf" }));
    form.append("judul", "Bad Convert");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(500);
    expect(remove).toHaveBeenCalled();
    const removed = remove.mock.calls.flatMap((c) => c[0] as string[]);
    expect(removed.some((p) => p.includes("_raw/"))).toBe(true);
  });

  it("rejects when page count exceeds cap", async () => {
    const remove = vi.fn().mockResolvedValue({ data: null, error: null });
    await mockSupabase({ user: { id: "u-1" }, role: "admin" }, { removeSpy: remove });
    await mockPdfConvert(51);
    const { POST } = await import("./route");
    const form = new FormData();
    form.append("pdf", new File([PDF_MAGIC], "many.pdf", { type: "application/pdf" }));
    form.append("judul", "Too Many Pages");
    const res = await POST(buildRequest(form));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/halaman|page|50/i);
    expect(remove).toHaveBeenCalled();
  });
});
