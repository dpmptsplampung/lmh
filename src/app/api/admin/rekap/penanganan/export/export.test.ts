// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { GET } from './route';
import { buatHRekap, buatKlienRekap, type Baris, type HRekap } from '@/test/rekap-supabase-mock';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/akun/server', () => ({ getServiceClient: vi.fn() }));
import { createClient } from '@/lib/supabase/server';
import { getServiceClient } from '@/lib/akun/server';

const auditInsert = vi.fn();

function pasang(h: HRekap) {
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(buatKlienRekap(h));
}

function tahap(id: string, s: Baris = {}): Baris {
  return {
    id, kunjungan_id: `k-${id}`, tahap_ke: 1, peran_tahap: 'fo', layanan_id: null, saluran: 'walk_in',
    penangan_id: 'p-saya', status: 'selesai', hasil: 'selesai', topik: 'Informasi umum', catatan: 'ok',
    batal_karena: null, mulai_at: '2026-10-12T02:00:00Z', selesai_at: '2026-10-12T02:10:00Z',
    created_at: '2026-10-12T02:00:00Z',
    kunjungan: { nama: 'Budi', asal_instansi: 'CV' }, petugas: { nama: 'Sari Wulandari' }, layanan: null,
    ...s,
  };
}

const get = (qs = '') =>
  GET(new NextRequest(`http://localhost/api/admin/rekap/penanganan/export?dari=2026-10-12&sampai=2026-10-12${qs}`));

async function bacaSheet(res: Response, nama: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
  return wb.getWorksheet(nama)!;
}

describe('GET /api/admin/rekap/penanganan/export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditInsert.mockResolvedValue({ error: null });
    (getServiceClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      from: (t: string) => (t === 'audit_log' ? { insert: auditInsert } : undefined),
    });
  });

  it('401 bila belum masuk', async () => {
    pasang(buatHRekap({ user: null }));
    expect((await get()).status).toBe(401);
  });

  it('ekspor FO untuk Front Office memuat SEMUA FO dengan nama FO tiap baris (keterbukaan antar FO)', async () => {
    pasang(buatHRekap({
      role: 'front_office',
      penanganan: [tahap('a'), tahap('b', { penangan_id: 'p-lain', petugas: { nama: 'Orang Lain' } })],
    }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('spreadsheetml.sheet');
    expect(res.headers.get('X-Rekap-Truncated')).toBe('false');
    expect(res.headers.get('Content-Disposition')).toContain('rekap-front-office-2026-10-12-sd-2026-10-12.xlsx');
    const ws = await bacaSheet(res, 'Rekap FO');
    expect(ws.rowCount).toBe(3); // header + 2 baris (milik sendiri dan FO lain)
    expect(ws.getRow(2).getCell(2).value).toBe('Sari Wulandari');
    expect(ws.getRow(3).getCell(2).value).toBe('Orang Lain');
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      actor_role: 'front_office', entitas: 'rekap_penanganan_fo',
      detail: expect.objectContaining({ petugas_id: null, total_rows: 2 }),
    }));
  });

  it('ekspor tidak terpotong oleh batas baris server: 2.500 baris dengan cap 1.000', async () => {
    const banyak = Array.from({ length: 2500 }, (_, i) =>
      tahap(`r${String(i).padStart(4, '0')}`, { mulai_at: `2026-10-12T03:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z` }));
    const h = buatHRekap({ role: 'admin', penanganan: banyak, serverCap: 1000 });
    pasang(h);
    const res = await get();
    expect(res.headers.get('X-Rekap-Truncated')).toBe('false');
    const ws = await bacaSheet(res, 'Rekap FO');
    expect(ws.rowCount).toBe(2501);
    expect(h.log.length).toBeGreaterThanOrEqual(3);
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      aksi: 'export_xlsx', entitas: 'rekap_penanganan_fo',
      detail: expect.objectContaining({ total_rows: 2500, truncated: false }),
    }));
  });

  it('FO memfilter FO lain -> 200 (audit mencatat filter); Petugas peran fo -> 403 tanpa audit', async () => {
    pasang(buatHRekap({ role: 'front_office' }));
    expect((await get('&petugas_id=550e8400-e29b-41d4-a716-446655440001')).status).toBe(200);
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ petugas_id: '550e8400-e29b-41d4-a716-446655440001' }),
    }));
    auditInsert.mockClear();
    pasang(buatHRekap({ role: 'petugas', layananId: 'l1' }));
    expect((await get()).status).toBe(403);
    expect(auditInsert).not.toHaveBeenCalled();
  });

  it('Petugas: ekspor rekap layanan hanya layanannya, dengan lembar Rekap Petugas Layanan', async () => {
    pasang(buatHRekap({
      role: 'petugas', layananId: 'lyn-oss',
      penanganan: [
        tahap('x', { peran_tahap: 'layanan', layanan_id: 'lyn-oss', layanan: { nama: 'Helpdesk OSS' }, tiket: { nomor_display: 'OS-001', tanggal: '2026-10-12', status: 'selesai', pelayanan_oss: null, pelayanan_perizinan: null } }),
        tahap('y', { peran_tahap: 'layanan', layanan_id: 'lyn-lain' }),
      ],
    }));
    const res = await get('&peran=layanan');
    expect(res.status).toBe(200);
    const ws = await bacaSheet(res, 'Rekap Petugas Layanan');
    expect(ws.rowCount).toBe(2);
  });

  it('Front Office: ekspor rekap layanan SEMUA eskalasi dengan kolom Front Office; audit tercatat', async () => {
    const lyn = (id: string, foPenangan: string, foNama: string): Baris =>
      tahap(id, {
        peran_tahap: 'layanan', tahap_ke: 2, layanan_id: 'lyn-oss', penangan_id: 'ptg-1', layanan: { nama: 'Helpdesk OSS' },
        petugas: { nama: 'Rina' }, tiket: null,
        kunjungan: { nama: 'Budi', asal_instansi: 'CV', tahap_fo: [{ tahap_ke: 1, penangan_id: foPenangan, peran_tahap: 'fo', petugas: { nama: foNama } }] },
      });
    const h = buatHRekap({ role: 'front_office', meId: 'p-saya', penanganan: [lyn('a', 'p-saya', 'Sari'), lyn('b', 'p-lain', 'Bayu')] });
    pasang(h);
    const res = await get('&peran=layanan');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('rekap-petugas-layanan-2026-10-12-sd-2026-10-12.xlsx');
    const ws = await bacaSheet(res, 'Rekap Petugas Layanan');
    expect(ws.rowCount).toBe(3); // header + 2 baris (eskalasi FO lain ikut)
    const header = (ws.getRow(1).values as unknown[]).slice(1) as string[];
    const kolomFo = header.indexOf('Front Office') + 1;
    expect([ws.getRow(2).getCell(kolomFo).value, ws.getRow(3).getCell(kolomFo).value]).toEqual(['Sari', 'Bayu']);
    expect(h.log[0].ops.some(([, a]) => String(a[0]).startsWith('kunjungan.'))).toBe(false);
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      actor_role: 'front_office', entitas: 'rekap_penanganan_layanan',
      detail: expect.objectContaining({ total_rows: 2 }),
    }));
    expect(auditInsert.mock.calls[0][0].detail).not.toHaveProperty('eskalasi_fo_id');
  });

  it('fo_id: ekspor rekap layanan hanya baris FO yang dipilih (semua role); audit mencatat fo_id; 422 bila bukan UUID', async () => {
    const FO_A = '550e8400-e29b-41d4-a716-446655440010';
    const lyn = (id: string, foId: string, foNama: string): Baris =>
      tahap(id, {
        peran_tahap: 'layanan', tahap_ke: 2, layanan_id: 'lyn-oss', penangan_id: 'ptg-1', layanan: { nama: 'Helpdesk OSS' },
        petugas: { nama: 'Rina' }, tiket: null,
        kunjungan: { nama: 'Budi', asal_instansi: 'CV', tahap_fo: [{ tahap_ke: 1, penangan_id: foId, peran_tahap: 'fo', petugas: { nama: foNama } }] },
      });
    const data = [lyn('a', FO_A, 'Ani'), lyn('b', 'fo-lain', 'Bayu'), lyn('c', FO_A, 'Ani')];
    pasang(buatHRekap({ role: 'front_office', penanganan: data }));
    const res = await get(`&peran=layanan&fo_id=${FO_A}`);
    expect(res.status).toBe(200);
    const ws = await bacaSheet(res, 'Rekap Petugas Layanan');
    expect(ws.rowCount).toBe(3); // header + 2 baris milik FO Ani
    expect(auditInsert).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({ fo_id: FO_A, total_rows: 2 }),
    }));
    pasang(buatHRekap({ role: 'petugas', layananId: 'lyn-oss', penanganan: data }));
    const ptg = await get(`&peran=layanan&fo_id=${FO_A}`);
    expect((await bacaSheet(ptg, 'Rekap Petugas Layanan')).rowCount).toBe(3);
    expect((await get('&peran=layanan&fo_id=bukan-uuid')).status).toBe(422);
  });

  it('galat DB -> 500 tanpa berkas', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pasang(buatHRekap({ galatPenanganan: true }));
    expect((await get()).status).toBe(500);
    spy.mockRestore();
  });

  it('berkas tetap dikirim bila audit_log gagal (dicatat di log)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    auditInsert.mockResolvedValue({ error: { message: 'RLS' } });
    pasang(buatHRekap({ penanganan: [tahap('a')] }));
    expect((await get()).status).toBe(200);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('422 untuk key query asing (skema ekspor ketat)', async () => {
    pasang(buatHRekap());
    expect((await get('&q=abc')).status).toBe(422);
  });
});
