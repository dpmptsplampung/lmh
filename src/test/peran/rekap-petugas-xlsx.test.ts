// @vitest-environment node
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { petaFieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { buildDataPelayananWorkbook } from '@/lib/rekap/excelTerpadu';
import { kolomEksporAman, kolomEksporKhusus } from '@/lib/rekap/exportTerpadu';
import { kolomDataPelayanan, petaBarisPelayanan } from '@/lib/rekap/terpadu';

describe('XLSX rekap petugas satu layanan', () => {
  it('menyertakan definisi terbaru walau kosong dan jawaban nonaktif pada kolom terakhir', async () => {
    const fields = [
      petaFieldKhusus({ id: 'lama', layanan_id: 'a', label: 'Nama terbaru', urut: 0, tersembunyi: true, pernah_diisi: true }),
      petaFieldKhusus({ id: 'kosong', layanan_id: 'a', label: 'Isian baru', urut: 1 }),
      petaFieldKhusus({ id: 'dihapus', layanan_id: 'a', label: 'Tidak pernah dijawab', urut: 2, tersembunyi: true }),
    ];
    const row = petaBarisPelayanan({ pelayanan_id: 'p1', layanan_id: 'a', unit: 'layanan' });
    row.khusus = { lama: 'Jawaban lama' };
    const kolom = kolomEksporAman(kolomDataPelayanan(null, kolomEksporKhusus(fields)), 'petugas');
    const buffer = await buildDataPelayananWorkbook([row], kolom, {
      dari: '2026-11-01', sampai: '2026-11-16', lingkup: 'Layanan saya', filter: 'Layanan A', truncated: false,
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Data Pelayanan')!;
    const headers = sheet.getRow(1).values as unknown[];
    const aktif = headers.indexOf('[Khusus] Isian baru');
    const nonaktif = headers.indexOf('[Khusus] Nama terbaru (nonaktif)');
    expect(aktif).toBeGreaterThan(0);
    expect(nonaktif).toBe(aktif + 1);
    expect(nonaktif).toBe(headers.length - 1);
    expect(headers).not.toContain('[Khusus] Tidak pernah dijawab (nonaktif)');
    expect(sheet.getRow(2).getCell(aktif).value ?? '').toBe('');
    expect(sheet.getRow(2).getCell(nonaktif).value).toBe('Jawaban lama');
  });
});
