import type ExcelJS from 'exceljs';
import { toCsv } from '@/lib/csv';
import { redactPii } from '@/lib/pii';
import { selAman } from '@/lib/rekap/excelTerpadu';
import { petaTamu, type BarisTamu } from './server';

const kolom = [
  { key: 'masuk', label: 'Waktu masuk (WIB)' }, { key: 'keluar', label: 'Waktu keluar (WIB)' },
  { key: 'nama', label: 'Nama' }, { key: 'asal', label: 'Asal' }, { key: 'hp', label: 'HP' },
  { key: 'keperluan', label: 'Keperluan' }, { key: 'menemui', label: 'Menemui siapa' }, { key: 'pencatat', label: 'Dicatat oleh' },
];
const waktu = (v: string | null) => v ? new Date(v).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', hour12: false }) : '';
export async function berkasTamu(rows: BarisTamu[], format: 'xlsx' | 'csv', role: string, truncated: boolean) {
  const data = rows.map(r => {
    const t = petaTamu(r);
    const baris = { masuk: waktu(t.waktu_masuk), keluar: waktu(t.waktu_keluar), nama: t.nama, asal: t.instansi,
      hp: t.no_hp, keperluan: t.tujuan, menemui: t.bertemu, pencatat: t.dicatat_nama };
    return Object.fromEntries(Object.entries(baris).map(([k, v]) => [k,
      role !== 'admin' && role !== 'front_office' && typeof v === 'string' ? redactPii(v) : v]));
  });
  if (format === 'csv') return '\uFEFF' + toCsv(kolom, data);
  const { default: Excel } = await import('exceljs');
  const wb = new Excel.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  const ws = wb.addWorksheet('Buku Tamu');
  ws.columns = kolom.map(k => ({ header: k.label, key: k.key, width: 24 }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  ws.getRow(1).font = { bold: true };
  ws.getColumn('hp').numFmt = '@';
  for (const r of data) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, selAman(v as string | null)])));
  if (truncated) wb.addWorksheet('Keterangan').addRow(['Data terpotong pada 50.000 baris. Persempit rentang tanggal.']);
  return new Uint8Array(await wb.xlsx.writeBuffer() as ExcelJS.Buffer);
}
