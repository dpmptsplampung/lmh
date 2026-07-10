// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (query: Record<string, string>): NextRequest => {
  const url = new URL('http://localhost/api/investment-docs/page-image');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new Request(url.toString(), { method: 'GET' });
  (req as unknown as { nextUrl: URL }).nextUrl = url;
  return req as unknown as NextRequest;
};

const mockSupabase = async (
  docRow: { halaman_gambar: string[] | null; jumlah_halaman: number; status: string } | null,
) => {
  const serverMod = await import('@/lib/supabase/server');
  const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const mock = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: docRow, error: null }),
        }),
      }),
    }),
  };
  createClient.mockResolvedValue(mock);
  return mock;
};

const mockServiceClient = async (
  opts: { downloadError?: unknown; downloadData?: Blob | null } = {},
) => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  const supabaseMod = await import('@supabase/supabase-js');
  const createClient = supabaseMod.createClient as unknown as ReturnType<typeof vi.fn>;
  const mock = {
    storage: {
      from: vi.fn().mockReturnValue({
        download: vi.fn().mockResolvedValue(
          opts.downloadError
            ? { data: null, error: opts.downloadError }
            : {
                data:
                  opts.downloadData ??
                  new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
                error: null,
              },
        ),
      }),
    },
  };
  createClient.mockReturnValue(mock);
  return mock;
};

const mockSharp = async (outputPng: Buffer) => {
  const sharpMod = await import('sharp');
  const sharp = sharpMod.default as unknown as ReturnType<typeof vi.fn>;
  const chain = {
    composite: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    metadata: vi.fn().mockResolvedValue({ width: 800, height: 1100 }),
    toBuffer: vi.fn().mockResolvedValue(outputPng),
  };
  sharp.mockReturnValue(chain);
  return chain;
};

describe('GET /api/investment-docs/page-image — input validation', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 400 when doc_id missing', async () => {
    await mockSupabase(null);
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ page: '1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when page missing', async () => {
    await mockSupabase(null);
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when doc_id is not a UUID', async () => {
    await mockSupabase(null);
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: 'not-a-uuid', page: '1' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when page is not a positive int', async () => {
    await mockSupabase(null);
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '0' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/investment-docs/page-image — document lookup', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns 404 when document not found', async () => {
    await mockSupabase(null);
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '1' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 when status is not aktif', async () => {
    await mockSupabase({ halaman_gambar: ['pages/x/page-1.png'], jumlah_halaman: 1, status: 'nonaktif' });
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '1' }));
    expect(res.status).toBe(404);
  });

  it('returns 404 with "not yet processed" when halaman_gambar empty', async () => {
    await mockSupabase({ halaman_gambar: null, jumlah_halaman: 0, status: 'aktif' });
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '1' }));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toMatch(/not yet processed|belum/i);
  });

  it('returns 400 when page exceeds jumlah_halaman', async () => {
    await mockSupabase({ halaman_gambar: ['pages/x/page-1.png'], jumlah_halaman: 1, status: 'aktif' });
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '5' }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/investment-docs/page-image — watermark + stream', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  });

  it('returns watermarked PNG with correct headers', async () => {
    await mockSupabase({
      halaman_gambar: ['pages/x/page-1.png'],
      jumlah_halaman: 1,
      status: 'aktif',
    });
    await mockServiceClient();
    const fakePng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    await mockSharp(fakePng);
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '1' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.equals(fakePng)).toBe(true);
  });

  it('returns 500 when service role key missing (misconfigured)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await mockSupabase({
      halaman_gambar: ['pages/x/page-1.png'],
      jumlah_halaman: 1,
      status: 'aktif',
    });
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id: '550e8400-e29b-41d4-a716-446655440000', page: '1' }));
    expect(res.status).toBe(500);
  });
});
