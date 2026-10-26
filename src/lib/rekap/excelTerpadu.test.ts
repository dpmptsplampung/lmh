import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildDataPelayananWorkbook, DEFINISI_DILAYANI, selAman } from './excelTerpadu';
import { kolomDataPelayanan, petaBarisPelayanan } from './terpadu';

const baris = petaBarisPelayanan({
  pelayanan_id: 'p1', sumber: 'penanganan', tanggal: '2026-10-20', unit: 'layanan', layanan_nama: 'Helpdesk OSS',
  kanal: 'live_chat', penangan_nama: 'Budi', pengunjung_nama: '=HYPERLINK("x")', pengunjung_hp: '081234',
  form_type: 'oss', pendataan: { nama_usaha: 'Toko A' }, hasil: 'selesai',
});

async function baca(buf: ExcelJS.Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as ArrayBuffer);
  return wb;
}

describe('selAman', () => {
  it('menetralkan awalan rumus; angka dan kosong apa adanya', () => {
    expect(selAman('=1+1')).toBe("'=1+1");
    expect(selAman('-5')).toBe("'-5");
    expect(selAman('Andi')).toBe('Andi');
    expect(selAman(7)).toBe(7);
    expect(selAman(null)).toBe('');
  });
});

describe('buildDataPelayananWorkbook', () => {
  it('header = judul kolom; satu baris per pelayanan; HP teks; lembar Keterangan memuat definisi dan lingkup', async () => {
    const kolom = kolomDataPelayanan('oss');
    const wb = await baca(await buildDataPelayananWorkbook([baris], kolom, {
      dari: '2026-10-01', sampai: '2026-10-31', lingkup: 'Hanya data yang Anda tangani sendiri.', filter: 'Helpdesk OSS', truncated: true,
    }));
    const ws = wb.getWorksheet('Data Pelayanan')!;
    expect((ws.getRow(1).values as unknown[]).slice(1)).toEqual(kolom.map((k) => k.judul));
    expect(ws.rowCount).toBe(2);
    const sel = (judul: string) => ws.getRow(2).getCell(kolom.findIndex((k) => k.judul === judul) + 1);
    expect(sel('Nama Pengunjung').value).toBe('\'=HYPERLINK("x")');
    expect(sel('No HP').value).toBe('081234');
    expect(sel('No HP').numFmt).toBe('@');
    expect(sel('Kanal').value).toBe('Live Chat');
    expect(sel('[OSS] Nama Usaha').value).toBe('Toko A');
    const info = wb.getWorksheet('Keterangan')!;
    const isi = info.getSheetValues().flat().map(String).join('|');
    expect(isi).toContain(DEFINISI_DILAYANI);
    expect(isi).toContain('Hanya data yang Anda tangani sendiri.');
    expect(isi).toContain('Data terpotong');
  });
});
