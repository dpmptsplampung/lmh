// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/server';

function makeMock(opts: {
  role: string;
  layananId: string | null;
  layananList: { id: string; nama: string; tipe: string }[];
}) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: { id: 'p-1', role: opts.role, layanan_id: opts.layananId, aktif: true },
    error: null,
  });
  const eq = vi.fn().mockReturnValue({ maybeSingle });
  const petugasSelect = vi.fn().mockReturnValue({ eq });

  const order = vi.fn().mockResolvedValue({ data: opts.layananList, error: null });
  const layananSelect = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order }) });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-1' } }, error: null }),
    },
    from: vi.fn((t: string) =>
      t === 'petugas' ? { select: petugasSelect } : { select: layananSelect },
    ),
  };
}

describe('GET /api/admin/rekap/layanan-options', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns single option for petugas scoped to their layanan', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMock({
        role: 'petugas',
        layananId: 'svc-oss',
        layananList: [],
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_petugas).toBe(true);
    expect(body.default_layanan_id).toBe('svc-oss');
    expect(body.options).toEqual([]);
  });

  it('returns all layanan for admin', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeMock({
        role: 'admin',
        layananId: null,
        layananList: [
          { id: 'svc-oss', nama: 'Helpdesk OSS', tipe: 'konsultatif' },
          { id: 'svc-p4', nama: 'BPJS', tipe: 'mitra' },
        ],
      }),
    );
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.is_petugas).toBe(false);
    expect(body.default_layanan_id).toBeNull();
    expect(body.options).toHaveLength(2);
    expect(body.options[0]).toEqual({
      id: 'svc-oss',
      nama: 'Helpdesk OSS',
      tipe: 'konsultatif',
      jenis_pendataan: 'oss',
    });
  });

  it('returns 401 when not authenticated', async () => {
    (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
      from: vi.fn(),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
