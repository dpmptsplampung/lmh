import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildRekapWorkbook, type RekapTicketRow } from './excel';

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
  },
  pelayanan_perizinan: null,
};

async function loadWorkbook(buf: ExcelJS.Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

describe('buildRekapWorkbook', () => {
  it('returns a valid xlsx buffer for the legacy layanan tab', async () => {
    const buf = await buildRekapWorkbook('layanan', [baseRow]);
    expect(buf).toBeInstanceOf(Buffer);
    expect(Array.from(buf as unknown as Uint8Array).slice(0, 4)).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const wb = await loadWorkbook(buf);
    expect(wb.getWorksheet('Rekap Layanan')).toBeDefined();
  });

  it('writes OSS phone numbers as text and sizes columns from header or content', async () => {
    const buf = await buildRekapWorkbook('oss', [
      {
        tanggal: '2026-08-31',
        nomor_display: 'OSS-001',
        nama_pemohon: 'Budi',
        no_hp: '081234567890',
        nama_usaha: 'Usaha Dengan Nama Yang Cukup Panjang',
        tipe_pelaku_usaha: null,
        status_penanaman_modal: null,
        lokasi_usaha: null,
        skala_usaha: null,
        sektor_usaha_kbli: null,
        tindak_lanjut: 'Selesai',
        uraian_solusi: 'Solusi',
        nama_petugas: 'Andi',
        status_draft: 'selesai',
      },
    ]);
    const ws = (await loadWorkbook(buf)).getWorksheet('Helpdesk OSS')!;
    expect(ws.getCell('D2').value).toBe('081234567890');
    expect(ws.getCell('D2').numFmt).toBe('@');
    expect(ws.getColumn(5).width).toBeGreaterThan('Nama Usaha'.length + 2);
    expect(ws.getColumn(5).width).toBeLessThanOrEqual(50);
  });

  it('uses the required perizinan sheet name and exact column order', async () => {
    const buf = await buildRekapWorkbook('perizinan', [
      {
        tanggal: '2026-10-01',
        nomor_display: 'NON-001',
        nama_pemohon: 'Siti',
        no_hp: '081300000001',
        nama_perusahaan: 'PT Maju',
        email: 'siti@example.test',
        lokasi_usaha: 'Lampung Selatan',
        opd_teknis: 'DPMPTSP',
        uraian_permohonan: 'Izin usaha',
        tindak_lanjut: 'Diproses',
        catatan_petugas: 'Lengkap',
        nama_petugas: 'Andi',
        status_draft: 'selesai',
      },
    ]);
    const ws = (await loadWorkbook(buf)).getWorksheet('Non OSS')!;
    const headers: string[] = [];
    ws.getRow(1).eachCell((cell) => headers.push(String(cell.value)));
    expect(headers).toEqual([
      'Tanggal', 'Nomor Tiket', 'Nama Pemohon', 'No HP', 'Nama Perusahaan', 'Email',
      'Lokasi Usaha', 'OPD Teknis', 'Uraian Permohonan', 'Tindak Lanjut',
      'Catatan Petugas', 'Petugas', 'Status',
    ]);
    expect(ws.getCell('D2').value).toBe('081300000001');
    expect(ws.getCell('D2').numFmt).toBe('@');
  });

  it('creates an empty sheet with its header only', async () => {
    const ws = (await loadWorkbook(await buildRekapWorkbook('umum', []))).getWorksheet('Rekap Umum')!;
    expect(ws.rowCount).toBe(1);
  });
});
