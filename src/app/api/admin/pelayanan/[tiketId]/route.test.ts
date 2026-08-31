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

  it('validates mandatory fields on POST finalize OSS and allows saving optional fields (tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha)', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;

    const upsertOss = vi.fn().mockResolvedValue({ error: null });
    const updateVisit = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        if (table === 'petugas') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'p1', role: 'petugas', layanan_id: 'l1', aktif: true },
                }),
              }),
            }),
          };
        }
        if (table === 'tiket_antrean') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 't1',
                    legacy_visit_id: 'v1',
                    kunjungan_id: 'k1',
                    layanan: { nama: 'Helpdesk OSS' },
                  },
                }),
              }),
            }),
          };
        }
        if (table === 'pelayanan_oss') {
          return {
            upsert: upsertOss,
          };
        }
        if (table === 'visit') {
          return {
            update: updateVisit,
          };
        }
        return {};
      }),
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
    expect(upsertOss).toHaveBeenCalledWith(
      expect.objectContaining({
        tipe_pelaku_usaha: 'perseorangan',
        status_penanaman_modal: 'PMDN',
        lokasi_usaha: 'Kota Bandar Lampung',
        is_locked: true,
        status_draft: 'selesai',
      }),
      { onConflict: 'tiket_id' }
    );
  });
});
