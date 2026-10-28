// @vitest-environment node
// Fase 4: kolom Pendataan Khusus di Rekap Data Pelayanan (halaman + Excel). Jawaban dibaca lewat klien pengguna (RLS =
// lingkup ketat Fase 3), hanya untuk pelayanan yang sudah lolos rekap_data_pelayanan, dan hanya bila satu Layanan dipilih.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import ExcelJS from 'exceljs';
import { GET } from './route';
import { GET as GET_EXPORT } from './export/route';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/akun/server', () => ({ getServiceClient: vi.fn(() => null) }));
import { createClient } from '@/lib/supabase/server';

const LID = '660e8400-e29b-41d4-a716-446655440001';
const FID = '770e8400-e29b-41d4-a716-446655440002';
const FID_H = '770e8400-e29b-41d4-a716-446655440003';
const LINGKUP = { petugas_id: 'p1', role: 'petugas', koordinator: true, layanan_id: LID, layanan_nama: 'BPJS' };
type Hasil = { data: unknown; error: unknown };

const baris = (id: string, sumber = 'penanganan') => ({
  pelayanan_id: id, sumber, tanggal: '2026-10-20', unit: 'layanan', layanan_id: LID, layanan_nama: 'BPJS', kanal: 'live_chat',
  penangan_id: 'p1', penangan_nama: 'Sari', pengunjung_nama: 'Andi', pengunjung_hp: '0812',
});
const FIELDS = [
  { id: FID, layanan_id: LID, label: 'Jenis kartu', jenis: 'pilihan_tunggal', wajib: true, opsi: ['A', 'B'], urut: 0, tersembunyi: false, pernah_diisi: true },
  { id: FID_H, layanan_id: LID, label: 'Lama', jenis: 'teks_singkat', wajib: false, opsi: [], urut: 1, tersembunyi: true, pernah_diisi: true },
  { id: 'x', layanan_id: LID, label: 'Hidden kosong', jenis: 'angka', wajib: false, opsi: [], urut: 2, tersembunyi: true, pernah_diisi: false },
];

function pasang(o: { fields?: Hasil; peta?: Hasil; baris?: unknown[] } = {}) {
  const tabelDipanggil: string[] = [];
  const rpc = vi.fn((nama: string, _arg?: unknown) => {
    const r: Hasil =
      nama === 'lingkup_data_saya' ? { data: LINGKUP, error: null }
      : nama === 'rekap_data_pelayanan' ? { data: { total: (o.baris ?? []).length, rows: o.baris ?? [], berikut: null }, error: null }
      : nama === 'pendataan_khusus_peta' ? (o.peta ?? { data: {}, error: null })
      : { data: null, error: null };
    return Object.assign(Promise.resolve(r), {});
  });
  const klien = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    rpc,
    from: vi.fn((tabel: string) => {
      tabelDipanggil.push(tabel);
      const hasil: Hasil =
        tabel === 'pendataan_khusus_field' ? (o.fields ?? { data: FIELDS, error: null })
        : { data: { form_pendataan: null }, error: null };
      const b: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'order', 'range']) b[m] = () => b;
      b.maybeSingle = () => Promise.resolve(hasil);
      b.then = (res: (v: Hasil) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(hasil).then(res, rej);
      return b;
    }),
  };
  (createClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(klien);
  return { tabelDipanggil, rpc };
}

const get = (qs: string) => GET(new NextRequest(`http://localhost/api/admin/rekap/terpadu?${qs}`));
const getExport = (qs: string) => GET_EXPORT(new NextRequest(`http://localhost/api/admin/rekap/terpadu/export?${qs}`));

describe('rekap terpadu: Pendataan Khusus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('tanpa layanan_id: tanpa kolom Khusus dan tanpa kueri definisi/jawaban', async () => {
    const { tabelDipanggil, rpc } = pasang({ baris: [baris('p1')] });
    const body = await (await get('bagian=data')).json();
    expect(body.kolom_khusus).toEqual([]);
    expect(tabelDipanggil).not.toContain('pendataan_khusus_field');
    expect(rpc).not.toHaveBeenCalledWith('pendataan_khusus_peta', expect.anything());
  });

  it('dengan layanan_id: kolom_khusus (tersembunyi hanya bila pernah diisi) dan jawaban ditempel hanya ke pelayanan penanganan', async () => {
    const { rpc } = pasang({
      baris: [baris('p1'), baris('t1', 'tiket_lama')],
      peta: { data: { p1: { [FID]: 'B' } }, error: null },
    });
    const body = await (await get(`bagian=data&layanan_id=${LID}`)).json();
    expect(body.kolom_khusus.map((f: { id: string }) => f.id)).toEqual([FID, FID_H]);
    expect(body.rows[0].khusus).toEqual({ [FID]: 'B' });
    expect(body.rows[1].khusus).toBeUndefined();
    // Jawaban hanya diminta untuk id pelayanan sumber 'penanganan' yang sudah lolos rekap (lingkup ketat), lewat RPC
    // SECURITY INVOKER (RLS tetap berlaku) dengan klien pengguna.
    expect(rpc.mock.calls.filter((c) => c[0] === 'pendataan_khusus_peta')).toEqual([['pendataan_khusus_peta', { p_penanganan: ['p1'] }]]);
  });

  it('tabel belum ada (migrasi belum diterapkan): rekap tetap 200 tanpa kolom Khusus', async () => {
    pasang({ baris: [baris('p1')], fields: { data: null, error: { code: 'PGRST205', message: 'x' } } });
    const res = await get(`bagian=data&layanan_id=${LID}`);
    expect(res.status).toBe(200);
    expect((await res.json()).kolom_khusus).toEqual([]);
  });

  it('galat membaca jawaban (bukan "belum ada") -> 500, bukan data tanpa kolom diam-diam', async () => {
    pasang({ baris: [baris('p1')], peta: { data: null, error: { code: '57014', message: 'timeout' } } });
    const res = await get(`bagian=data&layanan_id=${LID}`);
    expect(res.status).toBe(500);
  });

  it('galat membaca definisi isian (bukan "belum ada") -> 500, kolom Khusus tidak hilang diam-diam; juga untuk Excel', async () => {
    pasang({ baris: [baris('p1')], fields: { data: null, error: { code: '57014', message: 'timeout' } } });
    expect((await get(`bagian=data&layanan_id=${LID}`)).status).toBe(500);
    expect((await getExport(`layanan_id=${LID}`)).status).toBe(500);
  });

  it('Excel: kolom Khusus ditempel di akhir dengan nilai terformat', async () => {
    pasang({
      baris: [baris('p1')],
      peta: { data: { p1: { [FID]: 'B', [FID_H]: 'catatan lama' } }, error: null },
    });
    const res = await getExport(`layanan_id=${LID}`);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Data Pelayanan')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header.slice(-2)).toEqual(['[Khusus] Jenis kartu', '[Khusus] Lama']);
    const isi = (ws.getRow(2).values as unknown[]).slice(1);
    expect(isi.slice(-2)).toEqual(['B', 'catatan lama']);
  });
});
