import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildRekapWorkbook } from './excel';
import type { RekapTicketRow } from './excel';

const baseRow: RekapTicketRow = {
  id: 't-1',
  nomor_display: 'A-001',
  tanggal: '2026-08-31',
  waktu_terbit: '2026-08-31T01:00:00Z',
  waktu_mulai_layan: '2026-08-31T01:05:00Z',
  waktu_selesai: '2026-08-31T01:20:00Z',
  status: 'selesai',
  kunjungan: { nama: 'Budi', asal: 'walk_in', qr_token: null },
  petugas: { nama: 'Andi' },
  form_type: 'oss',
  pelayanan_oss: {
    id: 'p-1',
    nama_pemohon: 'Budi',
    nama_usaha: 'Usaha A',
    tipe_pelaku_usaha: 'perseorangan',
    status_penanaman_modal: 'PMDN',
    lokasi_usaha: 'Bandar Lampung',
    skala_usaha: 'Mikro',
    sektor_usaha_kbli: '47111',
    tindak_lanjut: 'disposisi',
    uraian_solusi: 'Solusi X',
    catatan_internal: null,
  } as RekapTicketRow['pelayanan_oss'],
  pelayanan_perizinAN: null,
};

describe('buildRekapWorkbook', () => {
  it('returns a valid xlsx buffer', async () => {
    const buf = (await buildRekapWorkbook([baseRow])) as unknown as Buffer;
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
    // First 4 bytes of xlsx: PK\x03\x04 (zip magic)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('contains headers including OSS and Perizinan columns', async () => {
    const buf = (await buildRekapWorkbook([baseRow])) as unknown as Buffer;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Rekap Layanan') ?? wb.worksheets[0];
    expect(ws).toBeDefined();
    const headerRow = ws!.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toContain('No Antrian');
    expect(headers).toContain('Nama Pengunjung');
    expect(headers).toContain('[OSS] Nama Usaha');
    expect(headers).toContain('[Perizinan] Nama Perusahaan');
  });

  it('produces empty workbook for empty rows', async () => {
    const buf = (await buildRekapWorkbook([])) as unknown as Buffer;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Rekap Layanan') ?? wb.worksheets[0];
    expect(ws!.rowCount).toBe(1); // only header
  });
});
