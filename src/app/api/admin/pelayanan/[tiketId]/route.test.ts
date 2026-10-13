// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));
vi.mock('@/lib/observability/logger', () => ({ logServerEvent: vi.fn() }));

// UPDATE draf kini berakhir .select('tiket_id') agar baris terdampak terlihat (mutasiWajibBaris);
// helper ini membuat rantai `.update().eq().select()` dengan hasil yang bisa diatur.
const updateChain = (hasil: { data?: unknown; error?: { code?: string; message: string } | null } = {}) =>
  vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: [{ tiket_id: 't1' }], error: null, ...hasil }),
    }),
  });

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
      // Pemilik = mockPetugas() (id 'p1') yang sedang melayani (migrasi 202610140002).
      status: 'dilayani',
      dilayani_oleh: 'p1',
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

  it('finalizes OSS via atomic RPC layanan_selesai and allows saving optional fields (tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha)', async () => {
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
      'layanan_selesai',
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

    const updateOss = updateChain();
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
                  data: { tiket_id: 't1', is_locked: false }, // draft eksisting milik petugas lain (admin = pemilik tiket)
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

  it('forwards lokasi_usaha when finalizing Non OSS so the replacement RPC can persist it', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
    const rpcFinalize = vi.fn().mockResolvedValue({
      data: { ok: true, is_locked: true, waktu_selesai: '2026-10-01T03:00:00Z' },
      error: null,
    });
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }) },
      from: vi.fn((table: string) => {
        if (table === 'petugas') return mockPetugas();
        if (table === 'tiket_antrean') return mockTiket({ layanan: { nama: 'Non OSS (SiCantik Lampung)' } });
        if (table === 'pelayanan_perizinan') return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }) }) };
        return {};
      }),
      rpc: rpcFinalize,
    });
    const { POST } = await import('./route');
    const res = await POST(buildRequest('POST', {
      nama_pemohon: 'Siti', nama_perusahaan: 'PT Maju', lokasi_usaha: 'Lampung Selatan',
      opd_teknis: 'DPMPTSP', uraian_permohonan: 'Izin usaha', tindak_lanjut: 'Diproses',
    }), { params: Promise.resolve({ tiketId: 't1' }) });
    expect(res.status).toBe(200);
    expect(rpcFinalize).toHaveBeenCalledWith('layanan_selesai', expect.objectContaining({
      p_form_type: 'perizinan',
      p_payload: expect.objectContaining({ lokasi_usaha: 'Lampung Selatan' }),
    }));
  });

  it('persists lokasi_usaha in a perizinan draft PATCH payload', async () => {
    const serverMod = await import('@/lib/supabase/server');
    const createClient = serverMod.createClient as unknown as ReturnType<typeof vi.fn>;
    const updatePerizinan = updateChain();
    createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }) },
      from: vi.fn((table: string) => {
        if (table === 'petugas') return mockPetugas();
        if (table === 'tiket_antrean') return mockTiket({ layanan: { nama: 'Non OSS (SiCantik Lampung)' } });
        if (table === 'pelayanan_perizinan') return {
          select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: { tiket_id: 't1', is_locked: false } }) }) }),
          update: updatePerizinan,
        };
        return {};
      }),
    });
    const { PATCH } = await import('./route');
    const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'Siti', lokasi_usaha: 'Lampung Selatan' }), { params: Promise.resolve({ tiketId: 't1' }) });
    expect(res.status).toBe(200);
    expect(updatePerizinan).toHaveBeenCalledWith(expect.objectContaining({ lokasi_usaha: 'Lampung Selatan' }));
  });

  // Audit T2d (No 59-62): draf yang tidak benar-benar tersimpan tidak boleh dilaporkan "tersimpan".
  describe('PATCH draf: hasil mutasi dicek', () => {
    const ctx = { params: Promise.resolve({ tiketId: 't1' }) };
    const pasang = async (opts: {
      tiketNama?: string;
      tabel: 'pelayanan_oss' | 'pelayanan_perizinan';
      existing: { tiket_id: string; is_locked: boolean } | null;
      update?: ReturnType<typeof vi.fn>;
      insert?: ReturnType<typeof vi.fn>;
    }) => {
      const serverMod = await import('@/lib/supabase/server');
      (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }) },
        from: vi.fn((table: string) => {
          if (table === 'petugas') return mockPetugas();
          if (table === 'tiket_antrean') return mockTiket(opts.tiketNama ? { layanan: { nama: opts.tiketNama } } : {});
          if (table === opts.tabel) {
            return {
              select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: opts.existing }) }) }),
              update: opts.update ?? updateChain(),
              insert: opts.insert ?? vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {};
        }),
      });
      const logger = await import('@/lib/observability/logger');
      vi.mocked(logger.logServerEvent).mockClear();
      return { PATCH: (await import('./route')).PATCH, log: vi.mocked(logger.logServerEvent) };
    };
    const body = { nama_pemohon: 'Budi', nama_usaha: 'Toko' };

    it('OSS: UPDATE 0 baris (terkunci/ditolak RLS) = 409, bukan "Draft OSS tersimpan"', async () => {
      const { PATCH, log } = await pasang({ tabel: 'pelayanan_oss', existing: { tiket_id: 't1', is_locked: false }, update: updateChain({ data: [] }) });
      const res = await PATCH(buildRequest('PATCH', body), ctx);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.ok).toBeUndefined();
      expect(json.error).toMatch(/draf/i);
      expect(log).toHaveBeenCalledWith('warn', expect.objectContaining({ operation: 'admin.pelayanan.draf_oss', kode: 'tidak_ada_baris' }));
    });

    it('Perizinan: UPDATE 0 baris = 409', async () => {
      const { PATCH } = await pasang({
        tabel: 'pelayanan_perizinan', tiketNama: 'Non OSS (SiCantik Lampung)',
        existing: { tiket_id: 't1', is_locked: false }, update: updateChain({ data: [] }),
      });
      const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'Siti' }), ctx);
      expect(res.status).toBe(409);
      expect((await res.json()).ok).toBeUndefined();
    });

    it('OSS: error UPDATE = 400 "Gagal menyimpan draft OSS" (kontrak lama), ditolak DB = 403, tanpa bocor pesan DB', async () => {
      let p = await pasang({ tabel: 'pelayanan_oss', existing: { tiket_id: 't1', is_locked: false }, update: updateChain({ data: null, error: { code: '23514', message: 'check constraint rahasia' } }) });
      let res = await p.PATCH(buildRequest('PATCH', body), ctx);
      expect(res.status).toBe(400);
      let json = await res.json();
      expect(json.error).toBe('Gagal menyimpan draft OSS');

      vi.resetModules();
      p = await pasang({ tabel: 'pelayanan_oss', existing: { tiket_id: 't1', is_locked: false }, update: updateChain({ data: null, error: { code: '42501', message: 'LOCKED: terkunci rahasia' } }) });
      res = await p.PATCH(buildRequest('PATCH', body), ctx);
      expect(res.status).toBe(403);
      json = await res.json();
      expect(JSON.stringify(json)).not.toContain('rahasia');
    });

    it('baris baru: INSERT dengan petugas_id penyimpan pertama; error INSERT = 400 (kontrak lama)', async () => {
      const insert = vi.fn().mockResolvedValue({ data: null, error: null });
      let p = await pasang({ tabel: 'pelayanan_oss', existing: null, insert });
      let res = await p.PATCH(buildRequest('PATCH', body), ctx);
      expect(res.status).toBe(200);
      expect(insert).toHaveBeenCalledWith(expect.objectContaining({ tiket_id: 't1', kunjungan_id: 'k1', petugas_id: 'p1' }));

      vi.resetModules();
      p = await pasang({ tabel: 'pelayanan_oss', existing: null, insert: vi.fn().mockResolvedValue({ data: null, error: { code: '23503', message: 'fk' } }) });
      res = await p.PATCH(buildRequest('PATCH', body), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('Gagal menyimpan draft OSS');
      expect(p.log).toHaveBeenCalledWith('error', expect.objectContaining({ operation: 'admin.pelayanan.draf_oss', asalCode: '23503' }));
    });
  });

  // Migrasi 202610140002: hanya pemilik tiket (dilayani_oleh) yang boleh menyelesaikan / menyimpan draf.
  describe('Kepemilikan tiket (A3)', () => {
    const ctx = { params: Promise.resolve({ tiketId: 't1' }) };
    const bodyFinal = {
      nama_pemohon: 'Budi Santoso',
      nama_usaha: 'Toko Berkah Jaya',
      tindak_lanjut: 'Selesai di Loket (Tuntas)',
      uraian_solusi: 'Konsultasi tuntas.',
    };
    const chain = (data: unknown) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data }),
    });

    const pasangPost = async (pesanDb: string) => {
      const serverMod = await import('@/lib/supabase/server');
      const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: pesanDb, code: '42501' } });
      (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u-petugas' } }, error: null }) },
        from: vi.fn((table: string) => {
          if (table === 'petugas') return mockPetugas();
          if (table === 'tiket_antrean') return mockTiket();
          return {};
        }),
        rpc,
      });
      return { POST: (await import('./route')).POST, rpc };
    };

    it.each([
      ['BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain', 403, 'BUKAN_PEMILIK'],
      ['SUDAH_DIAMBIL: tiket sudah ditangani petugas lain', 409, 'SUDAH_DIAMBIL'],
      ['INVALID_STATUS: tiket tidak dalam status dilayani (status=selesai)', 409, 'INVALID_STATUS'],
      ['SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali', 401, 'SESI_TIDAK_SAH'],
      ['FORBIDDEN: Front Office tidak menyelesaikan tiket layanan', 403, 'FORBIDDEN'],
      ['NOT_FOUND: tiket tidak ditemukan', 404, 'NOT_FOUND'],
      ['DIVERGENSI: visit x tidak berstatus dilayani; tidak ada perubahan disimpan', 409, 'DIVERGENSI'],
      ['LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah', 403, 'LOCKED'],
    ])('POST: galat RPC "%s" -> %i (kode %s), pesan DB tidak bocor', async (pesanDb, status, kode) => {
      const { POST, rpc } = await pasangPost(pesanDb);
      const res = await POST(buildRequest('POST', bodyFinal), ctx);
      expect(res.status).toBe(status);
      const json = await res.json();
      expect(json.kode).toBe(kode);
      expect(json.error).not.toContain(`${kode}:`);
      expect(json.error).not.toContain(pesanDb);
      expect(rpc).toHaveBeenCalledWith('layanan_selesai', expect.objectContaining({ p_tiket_id: 't1', p_form_type: 'oss' }));
    });

    const pasangPatch = async (tiket: Record<string, unknown>, petugas: Record<string, unknown> = {}) => {
      const serverMod = await import('@/lib/supabase/server');
      const update = updateChain();
      const insert = vi.fn().mockResolvedValue({ data: null, error: null });
      (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } }, error: null }) },
        from: vi.fn((table: string) => {
          if (table === 'petugas') return mockPetugas(petugas);
          if (table === 'tiket_antrean') return mockTiket(tiket);
          if (table === 'pelayanan_oss') {
            return { ...chain({ tiket_id: 't1', is_locked: false }), update, insert };
          }
          return {};
        }),
      });
      return { PATCH: (await import('./route')).PATCH, update, insert };
    };

    it('PATCH draf oleh BUKAN pemilik (tiket dilayani petugas lain) -> 403 BUKAN_PEMILIK, tanpa tulis', async () => {
      const { PATCH, update, insert } = await pasangPatch({ dilayani_oleh: 'p-lain' });
      const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'X' }), ctx);
      expect(res.status).toBe(403);
      expect((await res.json()).kode).toBe('BUKAN_PEMILIK');
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('PATCH draf oleh Admin yang bukan pemilik juga ditolak (harus ambil alih dulu)', async () => {
      const { PATCH, update } = await pasangPatch({ dilayani_oleh: 'p-lain' }, { role: 'admin', layanan_id: null });
      const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'X' }), ctx);
      expect(res.status).toBe(403);
      expect(update).not.toHaveBeenCalled();
    });

    it('PATCH draf oleh Front Office ditolak (FO tidak melayani tiket layanan)', async () => {
      const { PATCH, update } = await pasangPatch({ dilayani_oleh: 'p1' }, { role: 'front_office', layanan_id: null });
      const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'X' }), ctx);
      expect(res.status).toBe(403);
      expect(update).not.toHaveBeenCalled();
    });

    it("PATCH draf saat tiket masih 'menunggu' (sebelum Mulai Layanan) -> 409, tanpa tulis", async () => {
      const { PATCH, update, insert } = await pasangPatch({ status: 'menunggu', dilayani_oleh: null });
      const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'X' }), ctx);
      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.kode).toBe('INVALID_STATUS');
      expect(json.error).toMatch(/Mulai layanan/i);
      expect(update).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('PATCH draf oleh pemilik tetap tersimpan (200)', async () => {
      const { PATCH, update } = await pasangPatch({});
      const res = await PATCH(buildRequest('PATCH', { nama_pemohon: 'X' }), ctx);
      expect(res.status).toBe(200);
      expect(update).toHaveBeenCalledTimes(1);
    });

    const pasangGet = async (tiket: Record<string, unknown>, oss: unknown = null) => {
      const serverMod = await import('@/lib/supabase/server');
      (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } }, error: null }) },
        from: vi.fn((table: string) => {
          if (table === 'petugas') return mockPetugas();
          if (table === 'tiket_antrean') {
            return mockTiket({ nomor_display: 'A-001', kunjungan: { id: 'k1', nama: 'Budi', kontak_hp: null, pengunjung_id: null }, ...tiket });
          }
          if (table === 'visit') return chain({ asal_instansi: null, keperluan: null });
          if (table === 'pelayanan_oss') return chain(oss);
          return {};
        }),
      });
      return (await import('./route')).GET;
    };

    it('GET: pemilik -> boleh_ubah true; memuat dilayani_oleh dan nama pemilik', async () => {
      const GET = await pasangGet({ pelayan: { nama: 'Petugas Satu' } });
      const res = await GET(buildRequest('GET'), ctx);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toMatchObject({ boleh_ubah: true, dilayani_oleh: 'p1', dilayani_oleh_nama: 'Petugas Satu', status_tiket: 'dilayani' });
    });

    it('GET: bukan pemilik / tiket menunggu / data terkunci -> boleh_ubah false (wizard baca-saja)', async () => {
      let GET = await pasangGet({ dilayani_oleh: 'p-lain', pelayan: null });
      expect((await (await GET(buildRequest('GET'), ctx)).json()).boleh_ubah).toBe(false);
      vi.resetModules();
      GET = await pasangGet({ status: 'menunggu', dilayani_oleh: null });
      expect((await (await GET(buildRequest('GET'), ctx)).json()).boleh_ubah).toBe(false);
      vi.resetModules();
      GET = await pasangGet({}, { tiket_id: 't1', is_locked: true, status_draft: 'selesai' });
      expect((await (await GET(buildRequest('GET'), ctx)).json()).boleh_ubah).toBe(false);
    });
  });

  describe('PUT koreksi data terkunci', () => {
    const setup = async (
      role: string,
      rpc = vi.fn().mockResolvedValue({ data: { ok: true, perubahan: { a: 1 } }, error: null }),
    ) => {
      const serverMod = await import('@/lib/supabase/server');
      (serverMod.createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u' } }, error: null }) },
        from: vi.fn((t: string) => (t === 'petugas' ? mockPetugas({ role }) : mockTiket())),
        rpc,
      });
      const { PUT } = await import('./route');
      return { PUT, rpc };
    };
    const ctx = { params: Promise.resolve({ tiketId: 't1' }) };

    it('petugas ditolak 403 tanpa memanggil RPC', async () => {
      const { PUT, rpc } = await setup('petugas');
      const res = await PUT(buildRequest('PUT', { perubahan: { nama_usaha: 'X' }, alasan: 'salah ketik' }), ctx);
      expect(res.status).toBe(403);
      expect(rpc).not.toHaveBeenCalled();
    });

    it('FO memanggil koreksi_pelayanan dengan alasan', async () => {
      const { PUT, rpc } = await setup('front_office');
      const res = await PUT(buildRequest('PUT', { perubahan: { nama_usaha: 'X' }, alasan: 'salah ketik' }), ctx);
      expect(res.status).toBe(200);
      expect(rpc).toHaveBeenCalledWith('koreksi_pelayanan', {
        p_tiket_id: 't1', p_form_type: 'oss', p_perubahan: { nama_usaha: 'X' }, p_alasan: 'salah ketik',
      });
    });

    it('alasan hilang -> 422; ALASAN_WAJIB dari DB -> 422', async () => {
      const { PUT } = await setup('admin', vi.fn().mockResolvedValue({ data: null, error: { message: 'ALASAN_WAJIB: alasan koreksi wajib diisi' } }));
      expect((await PUT(buildRequest('PUT', { perubahan: { a: 'b' } }), ctx)).status).toBe(422);
      expect((await PUT(buildRequest('PUT', { perubahan: { a: 'b' }, alasan: 'x' }), ctx)).status).toBe(422);
    });
  });
});
