// @vitest-environment node
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({
  unstable_cache: (muat: (path: string) => Promise<string>) => {
    const memo = new Map<string, string>();
    return async (path: string) => {
      if (!memo.has(path)) memo.set(path, await muat(path));
      return memo.get(path);
    };
  },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/storage/r2', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const { r2DariTiruanSupabase } = await import('@/lib/storage/r2-test-adapter');
  return r2DariTiruanSupabase(createClient as never);
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}));

vi.mock('sharp', () => ({
  default: vi.fn(),
}));

import type { NextRequest } from 'next/server';

const buildRequest = (query: Record<string, string>, headers?: HeadersInit): NextRequest => {
  const url = new URL('http://localhost/api/investment-docs/page-image');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const req = new Request(url.toString(), { method: 'GET', headers });
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
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
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

describe('pembatas laju gambar dokumen', () => {
  const doc = { doc_id: '11111111-1111-4111-8111-111111111111', page: '1' };
  const permintaan = (ip: string, varian?: 'sampul') => buildRequest(
    { ...doc, ...(varian ? { varian } : {}) }, { 'x-forwarded-for': ip },
  );
  const ipUji = (i: number) => `198.18.${Math.floor(i / 256)}.${i % 256}`;

  beforeEach(async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    await mockSupabase(null);
  });

  afterEach(() => vi.useRealTimers());

  it('menerima IP baru saat peta penuh dan hanya membuang ember terlama', async () => {
    const { GET } = await import('./route');
    const terlama = '192.0.2.1';
    const kedua = '192.0.2.2';
    for (let i = 0; i < 30; i++) await GET(permintaan(terlama));
    for (let i = 0; i < 30; i++) await GET(permintaan(kedua));
    expect((await GET(permintaan(terlama))).status).toBe(429);
    for (let i = 0; i < 4094; i++) await GET(permintaan(ipUji(i)));

    expect((await GET(permintaan('192.0.2.3'))).status).toBe(404);
    expect((await GET(permintaan(kedua))).status).toBe(429);
    expect((await GET(permintaan(terlama))).status).toBe(404);
  });

  it('tetap menerima pengunjung setelah lebih dari 4096 IP berbeda dalam satu jendela', async () => {
    const { GET } = await import('./route');
    const status = new Set<number>();
    for (let i = 0; i < 4100; i++) status.add((await GET(permintaan(ipUji(i)))).status);

    expect(status).toEqual(new Set([404]));
    expect((await GET(permintaan('192.0.2.10'))).status).toBe(404);
  });

  it('menggabungkan IPv6 terkompresi dan lengkap dari satu /64', async () => {
    const { GET } = await import('./route');
    for (let i = 0; i < 30; i++) {
      expect((await GET(permintaan('2001:db8::abcd:0:0:1'))).status).toBe(404);
    }
    expect((await GET(permintaan('2001:0DB8:0000:0000:ABCD:0000:0000:0002'))).status).toBe(429);
    expect((await GET(permintaan('2001:db8:0:1::3'))).status).toBe(404);
  });

  it('mengisolasi kuota dan kapasitas peta sampul dari penampil halaman', async () => {
    const { GET } = await import('./route');
    const ip = '192.0.2.20';
    for (let i = 0; i < 29; i++) expect((await GET(permintaan(ip))).status).toBe(404);
    for (let i = 0; i < 120; i++) expect((await GET(permintaan(ip, 'sampul'))).status).toBe(404);
    expect((await GET(permintaan(ip, 'sampul'))).status).toBe(429);
    for (let i = 0; i < 4100; i++) await GET(permintaan(ipUji(i), 'sampul'));

    expect((await GET(permintaan(ip))).status).toBe(404);
    expect((await GET(permintaan(ip))).status).toBe(429);
    expect((await GET(permintaan('192.0.2.21'))).status).toBe(404);
    expect((await GET(permintaan(ip, 'sampul'))).status).toBe(404);
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

  it.each([
    ['1', 'sampul', 200],
    ['164', '', 200],
    ['165', '', 400],
    ['2', 'sampul', 400],
  ])('melayani dokumen 164 halaman sesuai batas (halaman %s, varian %s)', async (page, varian, status) => {
    const doc_id = '550e8400-e29b-41d4-a716-446655440000';
    await mockSupabase({
      jumlah_halaman: 164,
      halaman_gambar: Array.from({ length: 164 }, (_, i) => `pages/${doc_id}/offline/page-${i + 1}.png`),
      status: 'aktif',
    });
    const r2 = await mockServiceClient();
    await mockSharp(Buffer.from('gambar ber-watermark'));
    const { GET } = await import('./route');
    const res = await GET(buildRequest({ doc_id, page, ...(varian ? { varian } : {}) }));
    expect(res.status).toBe(status);
    if (status === 200) {
      expect(r2.storage.from.mock.results[0]?.value.download).toHaveBeenCalledWith(
        `pages/${doc_id}/offline/page-${page}.png`,
      );
    }
  });

  it('menolak halaman 201 walau baris lama memiliki 201 gambar', async () => {
    const doc_id = '550e8400-e29b-41d4-a716-446655440000';
    const db = await mockSupabase({
      jumlah_halaman: 201,
      halaman_gambar: Array.from({ length: 201 }, (_, i) => `pages/${doc_id}/page-${i + 1}.png`),
      status: 'aktif',
    });
    const { GET } = await import('./route');
    expect((await GET(buildRequest({ doc_id, page: '201' }))).status).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
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

  it('returns 500 when page object missing in storage', async () => {
    await mockServiceClient({ downloadError: { message: 'not found' } });
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

describe('cache harus tunduk pada status terbaru', () => {
  beforeEach(() => { vi.resetModules(); });
  it.each(['nonaktif', 'dihapus'])('menolak dokumen %s walau PNG masih ada dalam cache', async status => {
    const doc = { halaman_gambar: ['pages/cache/page-1.png'], jumlah_halaman: 1, status: 'aktif' };
    await mockSupabase(doc); await mockServiceClient();
    const sharp = await mockSharp(Buffer.from('cached PNG'));
    const { GET } = await import('./route');
    const req = () => buildRequest({ doc_id: '11111111-1111-4111-8111-111111111111', page: '1' });
    expect((await GET(req())).status).toBe(200);
    await mockSupabase(status === 'dihapus' ? null : { ...doc, status });
    expect((await GET(req())).status).toBe(404);
    expect(sharp.toBuffer).toHaveBeenCalledTimes(1);
  });
});


describe('sampul halaman pertama', () => {
  beforeEach(() => vi.resetModules());

  it('menggunakan dasar kecil yang sama, membakar watermark tiap peminta, dan memeriksa status terbaru', async () => {
    const doc = { halaman_gambar: ['pages/sampul/page-1.png'], jumlah_halaman: 1, status: 'aktif' };
    await mockSupabase(doc);
    const storage = await mockServiceClient();
    const sharp = await mockSharp(Buffer.from('gambar'));
    const { GET } = await import('./route');
    const req = (cookie: string, page = '1') => buildRequest({
      doc_id: '11111111-1111-4111-8111-111111111111', page, varian: 'sampul',
    }, { cookie });

    const a = await GET(req('sesi=A'));
    expect(a.status).toBe(200);
    expect(a.headers.get('Content-Type')).toBe('image/webp');
    expect(a.headers.get('Cache-Control')).toBe('no-store');
    expect((await GET(req('sesi=B'))).status).toBe(200);
    expect(storage.storage.from).toHaveBeenCalledTimes(1);
    expect(sharp.resize).toHaveBeenCalledTimes(1);
    expect(sharp.resize).toHaveBeenCalledWith(expect.objectContaining({ width: 480, height: 480 }));
    expect(sharp.composite).toHaveBeenCalledTimes(2);
    const [wmA, wmB] = sharp.composite.mock.calls.map(([input]) => input[0].input.toString());
    expect(wmA).toContain('SES-');
    expect(wmB).not.toBe(wmA);
    expect((await GET(req('sesi=A', '2'))).status).toBe(400);
    await mockSupabase({ ...doc, status: 'nonaktif' });
    expect((await GET(req('sesi=C'))).status).toBe(404);
    expect(sharp.composite).toHaveBeenCalledTimes(2);
  });

  it('kuota penampil dan sampul tidak saling memakai jatah', async () => {
    await mockSupabase(null);
    const { GET } = await import('./route');
    const doc = { doc_id: '11111111-1111-4111-8111-111111111111', page: '1' };
    for (let i = 0; i < 30; i++) expect((await GET(buildRequest(doc))).status).toBe(404);
    expect((await GET(buildRequest(doc))).status).toBe(429);
    expect((await GET(buildRequest({ ...doc, varian: 'sampul' }))).status).toBe(404);
  });
});
