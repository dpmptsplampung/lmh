// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

function buildMock(opts: {
  role: string;
  layananId: string | null;
  rows?: { id: string; nomor_display: string }[];
}) {
  const total = opts.rows?.length ?? 0;
  // A single thenable query builder shared across the entire chain.
  // Each chained method returns the same builder, so any order of .eq/.gte/.lte/.order/.range/.or works.
  // The builder is awaitable and resolves to the canned rows/count.
  const builder: Record<string, unknown> = {};
  const response = { data: opts.rows ?? [], count: total, error: null };
  const noopChain = vi.fn(() => builder);
  builder.eq = noopChain;
  builder.gte = noopChain;
  builder.lte = noopChain;
  builder.order = noopChain;
  builder.range = noopChain;
  builder.or = noopChain;
  // Make the builder awaitable
  (builder as unknown as { then: unknown }).then = (
    resolve: (v: unknown) => void,
  ) => resolve(response);
  const select = vi.fn(() => builder);

  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'p-1', role: opts.role, layanan_id: opts.layananId, aktif: true },
    error: null,
  });
  const eqP = vi.fn().mockReturnValue({ maybeSingle });
  const selectP = vi.fn().mockReturnValue({ eq: eqP });

  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }) },
    from: vi.fn((t: string) =>
      t === 'petugas' ? { select: selectP } : { select },
    ),
  };
}

describe('GET /api/admin/rekap/tickets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await GET(new NextRequest('http://localhost/api/admin/rekap/tickets'));
    expect(res.status).toBe(401);
  });

  it('returns rows for admin without layanan_id filter', async () => {
    const mock = buildMock({
      role: 'admin',
      layananId: null,
      rows: [{ id: 't-1', nomor_display: 'A-001' }],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const res = await GET(new NextRequest('http://localhost/api/admin/rekap/tickets'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.rows).toHaveLength(1);
  });

  it('forces layanan_id for petugas matching own', async () => {
    const mock = buildMock({
      role: 'petugas',
      layananId: '550e8400-e29b-41d4-a716-446655440000',
      rows: [],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const url = 'http://localhost/api/admin/rekap/tickets?layanan_id=550e8400-e29b-41d4-a716-446655440000';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(200);
  });

  it('returns 403 when petugas passes layanan_id different from own', async () => {
    const mock = buildMock({
      role: 'petugas',
      layananId: '550e8400-e29b-41d4-a716-446655440000',
      rows: [],
    });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const url = 'http://localhost/api/admin/rekap/tickets?layanan_id=660e8400-e29b-41d4-a716-446655440000';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(403);
  });

  it('returns 422 on invalid q (too long)', async () => {
    const mock = buildMock({ role: 'admin', layananId: null, rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mock);
    const longQ = 'a'.repeat(101);
    const url = `http://localhost/api/admin/rekap/tickets?q=${longQ}`;
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(422);
  });
});
