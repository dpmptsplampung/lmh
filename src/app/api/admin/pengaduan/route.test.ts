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
    const res = await PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'selesai' }));
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
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: '11111111-1111-4111-8111-111111111111', jalur: 'layanan', layanan_id: 'l1', status: 'baru' } }),
    };
    let n = 0;
    const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ('front_office') : n++ === 0 ? sel : upd));
    const { PATCH } = await pasang(from);
    expect((await PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'selesai' }))).status).toBe(403);
  });

  // Audit T2d (No 65-66): UPDATE status wajib baris; riwayat (INSERT) yang gagal tidak boleh hilang tanpa jejak.
  describe('PATCH FO: hasil mutasi dicek', () => {
    type Hasil = { data?: unknown; error?: { code?: string; message: string } | null };
    const pasangTabel = async (o: { upd?: Hasil; riwayat?: Hasil }) => {
      const sel = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: { id: '11111111-1111-4111-8111-111111111111', jalur: 'layanan', layanan_id: 'l1', status: 'baru' } }),
      };
      const upd = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        select: vi.fn().mockResolvedValue({ data: [{ id: '11111111-1111-4111-8111-111111111111' }], error: null, ...o.upd }),
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
      return { PATCH: mod.PATCH, insert, update: upd.update, log: vi.mocked(logger.logServerEvent) };
    };

    it('sukses: status berubah dan riwayat dicatat -> { ok: true } tanpa peringatan', async () => {
      const s = await pasangTabel({});
      const res = await s.PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'selesai', catatan: 'beres' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({
        pengaduan_id: '11111111-1111-4111-8111-111111111111', status_lama: 'baru', status_baru: 'selesai', catatan: 'beres', diubah_oleh: 'p1',
      }));
    });

    it.each([undefined, '', '   ', 123, null])('menolak status ditolak dengan catatan tidak valid %s sebelum mutasi', async (catatan) => {
      const s = await pasangTabel({});
      const res = await s.PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'ditolak', catatan }));
      expect(res.status).toBe(400);
      expect(s.insert).not.toHaveBeenCalled();
      expect(s.update).not.toHaveBeenCalled();
    });

    it.each([
      null, [], { id: 'salah', status: 'selesai' },
      { id: '11111111-1111-4111-8111-111111111111', status: 'baru' },
      { id: '11111111-1111-4111-8111-111111111111', status: 'selesai', tambahan: true },
      { id: '11111111-1111-4111-8111-111111111111', status: 'selesai', catatan: 'a'.repeat(2001) },
    ])('skema ketat menolak body %j tanpa mutasi', async (body) => {
      const s = await pasangTabel({});
      expect((await s.PATCH(req('PATCH', body))).status).toBe(400);
      expect(s.update).not.toHaveBeenCalled();
      expect(s.insert).not.toHaveBeenCalled();
    });

    it('penolakan beralasan menyimpan catatan yang sudah dirapikan', async () => {
      const s = await pasangTabel({});
      expect((await s.PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'ditolak', catatan: '  Di luar kewenangan  ' }))).status).toBe(200);
      expect(s.insert).toHaveBeenCalledWith(expect.objectContaining({ status_baru: 'ditolak', catatan: 'Di luar kewenangan' }));
    });

    it('error UPDATE = 500 (kontrak lama); riwayat tidak ditulis', async () => {
      const s = await pasangTabel({ upd: { data: null, error: { code: '57014', message: 'timeout' } } });
      const res = await s.PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'selesai' }));
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Gagal memperbarui status');
      expect(s.insert).not.toHaveBeenCalled();
      expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.pengaduan.ubah_status', asalCode: '57014' }));
    });

    it('riwayat gagal ditulis: status sudah berubah -> tetap ok TAPI ada peringatan dan tercatat', async () => {
      const s = await pasangTabel({ riwayat: { error: { code: '42501', message: 'row-level security' } } });
      const res = await s.PATCH(req('PATCH', { id: '11111111-1111-4111-8111-111111111111', status: 'selesai' }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.ok).toBe(true);
      expect(json.peringatan).toMatch(/riwayat/i);
      expect(s.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.pengaduan.riwayat', asalCode: '42501' }));
    });
  });

  describe('GET', () => {
    const rantai = (hasil: { data?: unknown[]; error?: { code: string } | null; count?: number }) => {
      const chain: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const m of ['select', 'order', 'eq', 'in']) chain[m] = vi.fn().mockReturnValue(chain);
      chain.range = vi.fn().mockResolvedValue({ data: [], error: null, count: 0, ...hasil });
      return chain;
    };
    const panggil = async (role: string, tabel: Record<string, unknown>, query = '', rpc = vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST202' } })) => {
      const { createClient } = await import('@/lib/supabase/server');
      const from = vi.fn((t: string) => (t === 'petugas' ? petugasQ(role) : tabel[t] ?? rantai({})));
      (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } } }) },
        from,
        rpc,
      });
      const { GET } = await import('./route');
      const r = req('GET') as unknown as { nextUrl: URL };
      r.nextUrl = new URL(`http://localhost/api/admin/pengaduan${query}`);
      return { res: await GET(r as unknown as NextRequest), from, rpc };
    };

    it('petugas membaca view v_pengaduan_petugas (urut terbaru, layanannya saja); Admin membaca v_pengaduan_kerja', async () => {
      const p = rantai({});
      const petugas = await panggil('petugas', { v_pengaduan_petugas: p });
      expect(petugas.res.status).toBe(200);
      expect(petugas.from).toHaveBeenCalledWith('v_pengaduan_petugas');
      expect(p.eq).toHaveBeenCalledWith('layanan_id', 'l1');
      expect((await petugas.res.json()).fitur.kerja).toBe(false);
      vi.resetModules();
      const admin = await panggil('admin', { v_pengaduan_kerja: rantai({}) });
      expect(admin.res.status).toBe(200);
      expect(admin.from).toHaveBeenCalledWith('v_pengaduan_kerja');
    });

    it('filter bawaan = butuh tindakan (terbuka = true), urut urutan_kerja; ringkasan dari RPC', async () => {
      const k = rantai({ data: [{ id: 'a' }], count: 1 });
      const rpc = vi.fn().mockResolvedValue({ data: { baru: 2, diproses: 3, mendekati: 1, terlambat: 4, selesai: 5, ditolak: 6 }, error: null });
      const { res } = await panggil('front_office', { v_pengaduan_kerja: k }, '', rpc);
      const json = await res.json();
      expect(k.eq).toHaveBeenCalledWith('terbuka', true);
      expect(k.eq).toHaveBeenCalledWith('jalur', 'layanan');
      expect(k.order).toHaveBeenCalledWith('urutan_kerja', { ascending: true });
      expect(k.order).toHaveBeenCalledWith('batas_aktif', { ascending: true, nullsFirst: false });
      expect(rpc).toHaveBeenCalledWith('ringkasan_pengaduan_kerja', { p_jalur: 'layanan' });
      expect(json.ringkasan).toEqual({ baru: 2, diproses: 3, mendekati: 1, terlambat: 4, selesai: 5, ditolak: 6 });
      expect(json.fitur.kerja).toBe(true);
    });

    it.each([
      ['mendekati', 'sla_status', 'mendekati'],
      ['terlambat', 'sla_status', 'terlambat'],
      ['selesai', 'status', 'selesai'],
      ['arsip', 'terbuka', false],
      ['baru', 'status', 'baru'],
    ])('filter %s -> eq(%s, %s)', async (filter, kolom, nilai) => {
      const k = rantai({});
      await panggil('admin', { v_pengaduan_kerja: k }, `?filter=${filter}`);
      expect(k.eq).toHaveBeenCalledWith(kolom, nilai);
    });

    it('filter semua / tidak dikenal: tidak ada pembatas status', async () => {
      const k = rantai({});
      await panggil('admin', { v_pengaduan_kerja: k }, '?filter=semua');
      expect(k.in).not.toHaveBeenCalled();
      expect(k.eq).not.toHaveBeenCalledWith('terbuka', expect.anything());
    });

    it('FO meminta jalur integritas = 403 dan tidak membaca tabel', async () => {
      const { res, from } = await panggil('front_office', {}, '?jalur=integritas');
      expect(res.status).toBe(403);
      expect(from).not.toHaveBeenCalledWith('v_pengaduan_kerja');
    });

    it('migrasi belum diterapkan: jatuh ke tabel lama tanpa SLA/penangan, ringkasan null, filter by status', async () => {
      const lama = rantai({ data: [{ id: 'a' }], count: 1 });
      const { res } = await panggil('admin', {
        v_pengaduan_kerja: rantai({ data: undefined, error: { code: '42P01' } }),
        pengaduan: lama,
      });
      const json = await res.json();
      expect(res.status).toBe(200);
      expect(json.fitur.kerja).toBe(false);
      expect(json.ringkasan).toBeNull();
      expect(json.rows).toHaveLength(1);
      expect(lama.in).toHaveBeenCalledWith('status', ['baru', 'diverifikasi', 'diproses', 'eskalasi']);
    });

    it('galat lain dari view = 500 dengan pesan umum', async () => {
      const { res } = await panggil('admin', { v_pengaduan_kerja: rantai({ error: { code: '57014' } }) });
      expect(res.status).toBe(500);
      expect((await res.json()).error).toBe('Gagal memuat pengaduan');
    });
  });
});
