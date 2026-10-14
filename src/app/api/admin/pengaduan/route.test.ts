// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/admin/pengaduan', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }) as unknown as NextRequest;

const petugasQ = (role: string) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'p1', role, layanan_id: 'l1', aktif: true } }),
});

async function pasang(from: ReturnType<typeof vi.fn>) {
  const { createClient } = await import('@/lib/supabase/server');
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } } }) },
    from,
  });
  return import('./route');
}

describe('/api/admin/pengaduan', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('PATCH oleh petugas = 403 (bukan sukses palsu)', async () => {
    const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ('petugas') : {}));
    const { PATCH } = await pasang(from);
    const res = await PATCH(req('PATCH', { id: 'x', status: 'selesai' }));
    expect(res.status).toBe(403);
    expect(from).not.toHaveBeenCalledWith('pengaduan');
  });

  it('PATCH FO: UPDATE yang menyentuh 0 baris (ditolak RLS) = 403, bukan ok', async () => {
    const upd = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const sel = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'x', jalur: 'layanan', layanan_id: 'l1', status: 'baru' } }),
    };
    let n = 0;
    const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ('front_office') : n++ === 0 ? sel : upd));
    const { PATCH } = await pasang(from);
    expect((await PATCH(req('PATCH', { id: 'x', status: 'selesai' }))).status).toBe(403);
  });

  // Audit T2d (No 65-66): UPDATE status wajib baris; riwayat (INSERT) yang gagal tidak boleh hilang tanpa jejak.
  describe('PATCH FO: hasil mutasi dicek', () => {
    type Hasil = { data?: unknown; error?: { code?: string; message: string } | null };
    const pasangTabel = async (o: { upd?: Hasil; riwayat?: Hasil }) => {
      const sel = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'x', jalur: 'layanan', layanan_id: 'l1', status: 'baru' } }),
      };
      const upd = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [{ id: 'x' }], error: null, ...o.upd }),
      };
      const insert = vi.fn().mockResolvedValue({ data: null, error: null, ...o.riwayat });
      let n = 0;
      const from = vi.fn((t: string) => {
        if (t === 'petugas') return petugasQ('front_office');
        if (t === 'pengaduan_riwayat') return { insert };
        return n++ === 0 ? sel : upd;
      });
      const mod = await pasang(from);
      const logger = await import('@/lib/observability/logger');
      vi.mocked(logger.logServerEvent).mockClear();
      return { PATCH: mod.PATCH, insert, log: vi.mocked(logger.logServerEvent) };
    };

    it('sukses: status berubah dan riwayat dicatat -> { ok: true } tanpa peringatan', async () => {
      const s = await pasangTabel({});
      const res = await s.PATCH(req('PATCH', { id: 'x', status: 'selesai', catatan: 'beres' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({
        pengaduan_id: 'x', status_lama: 'baru', status_baru: 'selesai', catatan: 'beres', diubah_oleh: 'p1',
      }));
    });

    it('error UPDATE = 500 (kontrak lama); riwayat tidak ditulis', async () => {
      const s = await pasangTabel({ upd: { data: null, error: { code: '57014', message: 'timeout' } } });
      const res = await s.PATCH(req('PATCH', { id: 'x', status: 'selesai' }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Gagal memperbarui status');
      expect(s.insert).not.toHaveBeenCalled();
      expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.pengaduan.ubah_status', asalCode: '57014' }));
    });

    it('riwayat gagal ditulis: status sudah berubah -> tetap ok TAPI ada peringatan dan tercatat', async () => {
      const s = await pasangTabel({ riwayat: { error: { code: '42501', message: 'row-level security' } } });
      const res = await s.PATCH(req('PATCH', { id: 'x', status: 'selesai' }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.peringatan).toMatch(/riwayat/i);
      expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.pengaduan.riwayat', asalCode: '42501' }));
    });
  });

  it('GET: petugas membaca view v_pengaduan_petugas, Admin membaca tabel', async () => {
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq']) chain[m] = vi.fn().mockReturnValue(chain);
    chain.range = vi.fn().mockResolvedValue({ data: [], error: null, count: 0 });
    for (const [role, tabel] of [['petugas', 'v_pengaduan_petugas'], ['admin', 'pengaduan']]) {
      vi.resetModules();
      const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ(role) : chain));
      const { GET } = await pasang(from);
      const r = req('GET') as unknown as { nextUrl: URL };
      r.nextUrl = new URL('http://localhost/api/admin/pengaduan');
      const res = await GET(r as unknown as NextRequest);
      expect(res.status).toBe(200);
      expect(from).toHaveBeenCalledWith(tabel);
    }
  });
});
