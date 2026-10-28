// Excel Data Pelayanan (rekap terpadu, Fase 3). Kolom = kolomDataPelayanan() sehingga tabel dan berkas selalu sama.
// Sel teks dinetralkan dari formula injection; kolom No HP berformat teks agar nol di depan tidak hilang.
import ExcelJS from 'exceljs';
import type { BarisPelayanan, KolomData, NilaiSel } from './terpadu';

export interface MetaEkspor {
  dari: string;
  sampai: string;
  lingkup: string;
  filter: string;
  truncated: boolean;
}

export const DEFINISI_DILAYANI =
  'Dilayani = tahap pelayanan berstatus selesai (tahap Layanan yang dikembalikan ke Front Office tidak dihitung); tanggal = tanggal kunjungan (WIB); pelayanan batal atau draf tidak dihitung.';

/** Teks yang diawali = + - @ tab/CR diberi apostrof agar tidak dieksekusi sebagai rumus. */
export function selAman(v: NilaiSel): string | number {
  if (v == null) return '';
  if (typeof v === 'number') return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

export async function buildDataPelayananWorkbook(
  rows: BarisPelayanan[],
  kolom: KolomData[],
  meta: MetaEkspor,
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  wb.created = new Date();

  const ws = wb.addWorksheet('Data Pelayanan');
  ws.columns = kolom.map((k) => ({ header: k.judul, key: k.kunci, width: Math.min(50, Math.max(10, k.judul.length + 2)) }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  header.height = 22;
  for (const r of rows) {
    ws.addRow(Object.fromEntries(kolom.map((k) => [k.kunci, selAman(k.ambil(r))])));
  }
  const iHp = kolom.findIndex((k) => k.kunci === 'hp') + 1;
  if (iHp) {
    ws.getColumn(iHp).eachCell({ includeEmpty: false }, (cell, n) => {
      if (n > 1) cell.numFmt = '@';
    });
  }

  const info = wb.addWorksheet('Keterangan');
  info.columns = [{ header: 'Keterangan', key: 'k', width: 24 }, { header: 'Nilai', key: 'v', width: 90 }];
  info.addRows([
    { k: 'Rentang', v: `${meta.dari} s.d. ${meta.sampai}` },
    { k: 'Lingkup data', v: meta.lingkup },
    { k: 'Filter', v: meta.filter },
    { k: 'Jumlah baris', v: rows.length },
    { k: 'Definisi', v: DEFINISI_DILAYANI },
    ...(meta.truncated ? [{ k: 'Peringatan', v: 'Data terpotong pada batas baris. Persempit rentang tanggal.' }] : []),
  ]);
  info.getRow(1).font = { bold: true };

  return wb.xlsx.writeBuffer();
}
