// @vitest-environment node
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buatWorkbookTerpadu, kolomEksporKhusus } from './exportTerpadu';
import { petaBarisPelayanan } from './terpadu';
import { petaFieldKhusus } from '@/lib/pendataan-khusus/jenis';

const field = (id: string, label: string, urut: number, tersembunyi = false, pernah_diisi = false) =>
  petaFieldKhusus({ id, layanan_id: 'a', label, urut, tersembunyi, pernah_diisi });
const rows = [
  petaBarisPelayanan({ pelayanan_id: 'p1', layanan_id: 'a', unit: 'layanan', layanan_nama: 'OSS',
    pengunjung_nama: '=CMD()', pengunjung_hp: '+6281234567890', pengunjung_email: 'uji@example.invalid',
    pendataan: { nama_usaha: 'Usaha OSS' } }),
  petaBarisPelayanan({ pelayanan_id: 'p2', layanan_id: 'b', unit: 'layanan', layanan_nama: 'Non OSS',
    pendataan: { nama_perusahaan: 'Usaha Non OSS' } }),
  petaBarisPelayanan({ pelayanan_id: 'fo', unit: 'fo', pengunjung_nama: 'Tamu FO' }),
];
const fields = [field('lama', 'Label terbaru', -10, true, true), field('aktif', 'Aktif kosong', 10), field('sembunyi', 'Tanpa jawaban', 0, true)];
const layanan = [
  { id: 'a', nama: 'Nama:/panjang*yang?sama[dan]lebih_dari_31_karakter', form_pendataan: 'oss' as const, fields },
  { id: 'b', nama: 'Nama:/panjang*yang?sama[dan]lebih_dari_31_karakter', form_pendataan: 'perizinan' as const, fields: [] },
  { id: 'c', nama: 'Semua', form_pendataan: null, fields: [] },
];
const meta = { dari: '2026-11-01', sampai: '2026-11-16', lingkup: 'Semua layanan', filter: 'Semua', truncated: true };
async function baca(role = 'front_office') {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await buatWorkbookTerpadu(rows, layanan, meta, role));
  return wb;
}

describe('ekspor semua layanan', () => {
  it('memuat Semua umum + satu sheet tiap layanan termasuk yang kosong; nama sheet aman/unik', async () => {
    const wb = await baca();
    expect(wb.worksheets).toHaveLength(5);
    expect(wb.worksheets[0].name).toBe('Semua');
    expect(wb.worksheets[0].rowCount).toBe(4);
    expect(wb.worksheets[0].getRow(1).values).not.toContain('[OSS] Nama Usaha');
    expect(wb.worksheets[1].getRow(1).values).toContain('[OSS] Nama Usaha');
    expect(wb.worksheets[2].getRow(1).values).toContain('[Non OSS] Nama Perusahaan');
    expect(wb.worksheets[3].rowCount).toBe(1);
    expect(new Set(wb.worksheets.map(s => s.name.toLowerCase())).size).toBe(5);
    expect(wb.worksheets.every(s => s.name.length <= 31 && !/[\\/*?:[\]]/.test(s.name))).toBe(true);
    expect(wb.getWorksheet('Keterangan')?.getSheetValues().flat().join(' ')).toMatch(/terpotong/);
  });
  it('memakai label terbaru, mempertahankan aktif kosong, menaruh nonaktif berjawaban di ujung', () => {
    const kolom = kolomEksporKhusus(fields);
    expect(kolom.map(k => k.judul)).toEqual(['[Khusus] Aktif kosong', '[Khusus] Label terbaru (nonaktif)']);
    expect(kolom[1].ambil({ ...rows[0], khusus: { lama: 'Jawaban lama' } })).toBe('Jawaban lama');
  });
  it('formula dinetralkan; HP/email FO utuh, petugas disamarkan dengan helper PII', async () => {
    const fo = (await baca()).worksheets[0].getRow(2).values;
    expect(fo).toContain("'=CMD()");
    expect(fo).toContain("'+6281234567890");
    expect(fo).toContain('uji@example.invalid');
    const petugas = (await baca('petugas')).worksheets[0].getRow(2).values;
    expect(petugas).toContain('[telepon]');
    expect(petugas).toContain('[email]');
  });
});
