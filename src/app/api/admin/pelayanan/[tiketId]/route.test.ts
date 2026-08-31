// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

const buildRequest = (method: string, body?: unknown): NextRequest => {
  const req = new Request('http://localhost/api/admin/pelayanan/t1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return req as unknown as NextRequest;
};

const mockPetugas = (overrides: Record<string, unknown> = {}) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({
    data: { id: 'p1', role: 'petugas', layanan_id: 'l1', aktif: true, ...overrides },
  }),
});

const mockTiket = (overrides: Record<string, unknown> = {}) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({
    data: {
      id: 't1',
      legacy_visit_id: 'v1',
      kunjungan_id: 'k1',
      layanan_id: 'l1',
      layanan: { nama: 'Helpdesk OSS' },
      ...overrides,
    },
  }),
});

describe('API Route /api/admin/pelayanan/[tiketId]', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests on GET with 401', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    });

    const { GET } = await import('./route');
    const res = await GET(buildRequest('GET'), { params: Promise.resolve({ tiketId: 't1' }) });
    expect(res.status).toBe(401);
  });

  it('returns 403 when petugas accesses a ticket outside their layanan (GET)', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'petugas') return mockPetugas({ layanan_id: 'l1' });
        if (table === 'tiket_antrean') return mockTiket({ layanan_id: 'l2' }); // layanan lain
        return {};
      }),
    });

    const { GET } = await import('./route');
    const res = await GET(buildRequest('GET'), { params: Promise.resolve({ tiketId: 't1' }) });
    expect(res.status).toBe(403);
  });

  it('finalizes OSS via atomic RPC and allows saving optional fields (tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha)', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const rpcFinalize = vi.fn().mockResolvedValue({
      data: { ok: true, is_locked: true, waktu_selesai: '2026-08-31T03:00:00Z' },
      error: null,
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'petugas') return mockPetugas();
        if (table === 'tiket_antrean') return mockTiket();
        return {};
      }),
      rpc: rpcFinalize,
    });

    const { POST } = await import('./route');
    const payload = {
      nama_pemohon: 'Budi Santoso',
      nama_usaha: 'Toko Berkah Jaya',
      tipe_pelaku_usaha: 'perseorangan',
      status_penanaman_modal: 'PMDN',
      lokasi_usaha: 'Kota Bandar Lampung',
      skala_usaha: 'Mikro',
      sektor_usaha_kbli: '47111',
      tindak_lanjut: 'Selesai di Loket (Tuntas)',
      uraian_solusi: 'Bimbingan pembuatan akun OSS dan NIB tuntas di loket.',
    };

    const res = await POST(buildRequest('POST', payload), {
      params: Promise.resolve({ tiketId: 't1' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.is_locked).toBe(true);
    expect(rpcFinalize).toHaveBeenCalledTimes(1);
    expect(rpcFinalize).toHaveBeenCalledWith(
      'finalize_pelayanan',
      expect.objectContaining({
        p_tiket_id: 't1',
        p_form_type: 'oss',
        p_payload: expect.objectContaining({
          tipe_pelaku_usaha: 'perseorangan',
          status_penanaman_modal: 'PMDN',
          lokasi_usaha: 'Kota Bandar Lampung',
        }),
      })
    );
  });

  it('maps RPC INVALID_STATUS (ticket not being served) to 409 on POST finalize', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const rpcFinalize = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'INVALID_STATUS: tiket belum dalam status dilayani (status=menunggu)' },
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'petugas') return mockPetugas();
        if (table === 'tiket_antrean') return mockTiket();
        return {};
      }),
      rpc: rpcFinalize,
    });

    const { POST } = await import('./route');
    const payload = {
      nama_pemohon: 'Budi Santoso',
      nama_usaha: 'Toko Berkah Jaya',
      tindak_lanjut: 'Selesai di Loket (Tuntas)',
      uraian_solusi: 'Konsultasi tuntas.',
    };

    const res = await POST(buildRequest('POST', payload), {
      params: Promise.resolve({ tiketId: 't1' }),
    });

    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).not.toContain('INVALID_STATUS'); // tidak bocorkan detail DB
  });

  it('PATCH draft on existing row uses update without changing petugas_id', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const updateOss = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const insertOss = vi.fn().mockResolvedValue({ error: null });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-admin' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'petugas') return mockPetugas({ role: 'admin', layanan_id: null });
        if (table === 'tiket_antrean') return mockTiket();
        if (table === 'pelayanan_oss') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { tiket_id: 't1', is_locked: false }, // draft eksisting milik petugas lain
                }),
              }),
            }),
            update: updateOss,
            insert: insertOss,
          };
        }
        return {};
      }),
    });

    const { PATCH } = await import('./route');
    const res = await PATCH(
      buildRequest('PATCH', {
        nama_pemohon: 'Budi Santoso',
        nama_usaha: 'Toko Berkah Jaya',
      }),
      { params: Promise.resolve({ tiketId: 't1' }) }
    );

    expect(res.status).toBe(200);
    // Baris eksisting → update (petugas_id asli tidak disentuh), bukan insert
    expect(updateOss).toHaveBeenCalledTimes(1);
    expect(updateOss).toHaveBeenCalledWith(
      expect.not.objectContaining({ petugas_id: expect.anything() })
    );
    expect(insertOss).not.toHaveBeenCalled();
  });
});
