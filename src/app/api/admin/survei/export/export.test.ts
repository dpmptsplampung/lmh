// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { GET } from './route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/akun/server', () => ({ getServiceClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';

type Baris = Record<string, unknown>;

interface Opsi {
  user?: { id: string } | null;
  role?: string;
  aktif?: boolean;
  skm?: Baris[];
  spak?: Baris[];
  rpcGalat?: string;
  tabelGalat?: string;
}

const RPC_DATA: Record<string, Baris[]> = {
  ringkasan_ikm: [{ layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', ikm: 80, responden: 2 }],
  ringkasan_spak: [{ layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', responden: 2, p1: 5, p2: 5, p3: 5, p4: 5, p5: 5 }],
  ringkasan_response_rate: [{ layanan_id: 'l-1', unit: 'layanan', nama: 'Helpdesk OSS', diundang: 4, mengisi: 2 }],
};

function buatKlien(o: Opsi = {}) {
  // Argumen kedua dicatat vi.fn untuk diperiksa test (tipe parameter perlu dideklarasikan agar mock.calls[n][1] valid).
  const rpc = vi.fn((fn: string, args?: Record<string, unknown>) => {
    void args;
    return Promise.resolve(
      o.rpcGalat === fn ? { data: null, error: { message: 'rpc gagal' } } : { data: RPC_DATA[fn] ?? [], error: null },
    );
  });
  const log: { tabel: string; gte: unknown[][]; lt: unknown[][]; range: number[][] }[] = [];
  const from = vi.fn((tabel: string) => {
    if (tabel === 'petugas') {
      const b = {
        select: () => b,
        eq: () => b,
        maybeSingle: () =>
          Promise.resolve({
            data: { id: 'p-1', role: o.role ?? 'admin', layanan_id: null, aktif: o.aktif ?? true },
            error: null,
          }),
      };
      return b;
    }
    const data = tabel === 'skm_respons' ? o.skm ?? [] : o.spak ?? [];
    const entri = { tabel, gte: [] as unknown[][], lt: [] as unknown[][], range: [] as number[][] };
    log.push(entri);
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.gte = (...a: unknown[]) => { entri.gte.push(a); return b; };
    b.lt = (...a: unknown[]) => { entri.lt.push(a); return b; };
    b.order = () => b;
    b.range = (dari: number, sampai: number) => {
      entri.range.push([dari, sampai]);
      if (o.tabelGalat === tabel) return Promise.resolve({ data: null, error: { message: 'db gagal' } });
      const potong = Math.min(sampai - dari + 1, 1000); // batas baris server PostgREST
      return Promise.resolve({ data: data.slice(dari, dari + potong), error: null });
    };
    return b;
  });
  const klien = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: o.user === undefined ? { id: 'u-1' } : o.user }, error: null }) },
    from,
    rpc,
  };
  return { klien, rpc, log };
}

const auditInsert = vi.fn();
const rpcServis = vi.fn();

function pasang(o: Opsi = {}) {
  const k = buatKlien(o);
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(k.klien);
  return k;
}

const get = (qs = 'dari=2026-10-12&sampai=2026-10-14') =>
  GET(new NextRequest(`http://localhost/api/admin/survei/export${qs ? `?${qs}` : ''}`));

async function muat(res: Response) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  return wb;
}

function skmRow(i: number): Baris {
  return {
    id: `k-${i}`, kunjungan_id: null, layanan_id: 'l-1', unit: 'layanan', created_at: '2026-10-12T03:00:00Z',
    u1_persyaratan: 4, u2_prosedur: 4, u3_waktu: 4, u4_biaya: 4, u5_produk: 4, u6_kompetensi: 4, u7_perilaku: 4,
    u8_sarana: 4, u9_pengaduan: 4, u10_transparansi: null, u11_integritas: null,
    kunjungan: null, layanan: { nama: 'Helpdesk OSS' },
  };
}

describe('GET /api/admin/survei/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    // Klien layanan HANYA untuk audit_log; RPC ringkasan kosong di bawah service_role (dijaga peran_saya()).
    (getServiceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: (t: string) => (t === 'audit_log' ? { insert: auditInsert } : undefined),
      rpc: rpcServis,
    });
  });

  it('401 bila belum masuk, dan 401 bila akun nonaktif; tanpa audit', async () => {
    pasang({ user: null });
    expect((await get()).status).toBe(401);
    pasang({ role: 'admin', aktif: false });
    expect((await get()).status).toBe(401);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('403 untuk petugas layanan; tidak ada data dibaca dan tidak ada audit', async () => {
    const k = pasang({ role: 'petugas' });
    const res = await get();
    expect(res.status).toBe(403);
    expect(k.rpc).not.toHaveBeenCalled();
    expect(k.log).toHaveLength(0);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it.each([
    ['dari lebih besar dari sampai', 'dari=2026-10-14&sampai=2026-10-12'],
    ['format tanggal salah', 'dari=12-10-2026&sampai=2026-10-14'],
    ['bukan tanggal kalender', 'dari=2026-02-31&sampai=2026-03-05'],
    ['dari tidak ada', 'sampai=2026-10-14'],
    ['sampai tidak ada', 'dari=2026-10-12'],
    ['tanpa parameter', ''],
  ])('400 untuk parameter tidak valid: %s', async (_nama, qs) => {
    const k = pasang({ role: 'admin' });
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(k.rpc).not.toHaveBeenCalled();
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it.each(['admin', 'front_office'])('200 untuk %s: berkas xlsx, header unduhan, empat sheet', async (role) => {
    pasang({ role, skm: [skmRow(1)], spak: [] });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('Content-Disposition')).toContain('survei-2026-10-12-sd-2026-10-14.xlsx');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const wb = await muat(res);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['SPAK', 'SKM', 'Ringkasan', 'Legenda']);
    expect(wb.getWorksheet('SKM')!.rowCount).toBe(2);
  });

  it('ringkasan dibaca lewat klien SESI pengguna (bukan service role) dengan p_start/p_end', async () => {
    const k = pasang({ role: 'front_office' });
    await get();
    expect(k.rpc.mock.calls.map((c) => c[0]).sort()).toEqual(['ringkasan_response_rate']); // IKM/SPAK global dihitung dari jawaban, bukan RPC per unit
    for (const [, args] of k.rpc.mock.calls) {
      expect(args).toEqual({ p_start: '2026-10-12', p_end: '2026-10-14' });
    }
    expect(rpcServis).not.toHaveBeenCalled();
  });

  it('filter tanggal jawaban memakai batas hari WIB', async () => {
    const k = pasang({ role: 'admin' });
    await get('dari=2026-10-12&sampai=2026-10-12');
    expect(k.log.length).toBeGreaterThanOrEqual(2);
    for (const l of k.log) {
      expect(l.gte).toEqual([['created_at', '2026-10-11T17:00:00.000Z']]);
      expect(l.lt).toEqual([['created_at', '2026-10-12T17:00:00.000Z']]);
    }
  });

  it('2.500 baris SKM tertulis lengkap (paginasi melewati batas 1.000 baris server)', async () => {
    pasang({ role: 'admin', skm: Array.from({ length: 2500 }, (_, i) => skmRow(i)) });
    const res = await get();
    expect(res.status).toBe(200);
    const wb = await muat(res);
    expect(wb.getWorksheet('SKM')!.rowCount).toBe(2501); // header + 2.500
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ jumlah_skm: 2500, terpotong: false }),
    }));
  });

  it('audit_log ditulis lewat service role: aksi export_xlsx, entitas survei, tanpa identitas responden', async () => {
    pasang({ role: 'front_office', skm: [skmRow(1)] });
    await get();
    expect(auditInsert).toHaveBeenCalledTimes(1);
    expect(auditInsert).toHaveBeenCalledWith({
      actor_id: 'u-1',
      actor_role: 'front_office',
      aksi: 'export_xlsx',
      entitas: 'survei',
      detail: { dari: '2026-10-12', sampai: '2026-10-14', jumlah_spak: 0, jumlah_skm: 1, terpotong: false },
    });
  });

  it('berkas tetap dikirim bila audit_log gagal ditulis', async () => {
    const galat = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auditInsert.mockResolvedValue({ error: { message: 'ditolak' } });
    pasang({ role: 'admin' });
    expect((await get()).status).toBe(200);
    expect(galat).toHaveBeenCalled();
    galat.mockRestore();
  });

  it('500 (tanpa membocorkan detail dan tanpa audit) bila RPC ringkasan atau kueri jawaban gagal', async () => {
    const galat = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pasang({ role: 'admin', rpcGalat: 'ringkasan_response_rate' });
    const res1 = await get();
    expect(res1.status).toBe(500);
    expect(JSON.stringify(await res1.json())).not.toContain('rpc gagal');
    pasang({ role: 'admin', tabelGalat: 'skm_respons' });
    expect((await get()).status).toBe(500);
    expect(auditInsert).not.toHaveBeenCalled();
    galat.mockRestore();
  });
});
