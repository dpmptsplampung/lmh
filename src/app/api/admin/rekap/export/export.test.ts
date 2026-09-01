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
  rows?: unknown[];
}) {
  const total = opts.rows?.length ?? 0;
  // Single shared thenable builder — tolerates arbitrary chained order and awaits
  // with the canned response. Mirrors Task 8's permissive pattern.
  const builder: Record<string, unknown> = {};
  const response = { data: opts.rows ?? [], count: total, error: null };
  const noopChain = vi.fn(() => builder);
  builder.eq = noopChain;
  builder.gte = noopChain;
  builder.lte = noopChain;
  builder.order = noopChain;
  builder.range = noopChain;
  builder.or = noopChain;
  builder.limit = noopChain;
  builder.ilike = noopChain;
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

  const insert = vi.fn().mockResolvedValue({ error: null });
  const auditFrom = { insert };

  // Layanan lookup mock — returns null by default; tests can override via second arg
  const layananMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const layananEq = vi.fn().mockReturnValue({ maybeSingle: layananMaybeSingle });
  const layananSelect = vi.fn().mockReturnValue({ eq: layananEq });
  const layananFrom = { select: layananSelect };

  return {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
    },
    from: vi.fn((t: string) => {
      if (t === 'petugas') return { select: selectP };
      if (t === 'audit_log') return auditFrom;
      if (t === 'layanan') return layananFrom;
      return { select };
    }),
  };
}

describe('GET /api/admin/rekap/export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: null }, error: null }),
      },
      from: vi.fn(),
    });
    const res = await GET(
      new NextRequest('http://localhost/api/admin/rekap/export'),
    );
    expect(res.status).toBe(401);
  });

  it('returns xlsx for admin with empty rows', async () => {
    const mock = buildMock({ role: 'admin', layananId: null, rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mock,
    );
    const res = await GET(
      new NextRequest('http://localhost/api/admin/rekap/export'),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('returns 403 for petugas accessing other layanan', async () => {
    const mock = buildMock({ role: 'petugas', layananId: 'svc-oss', rows: [] });
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      mock,
    );
    const url =
      'http://localhost/api/admin/rekap/export?layanan_id=550e8400-e29b-41d4-a716-446655440000';
    const res = await GET(new NextRequest(url));
    expect(res.status).toBe(403);
  });
});
