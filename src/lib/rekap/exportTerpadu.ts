import type ExcelJS from 'exceljs';
import { redactPii } from '@/lib/pii';
import { formatNilaiKhusus } from '@/lib/pendataan-khusus/jawaban';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { selAman, DEFINISI_DILAYANI, type MetaEkspor } from './excelTerpadu';
import { kolomDataPelayanan, type BarisPelayanan, type FormPendataan, type KolomData } from './terpadu';

export interface LayananEkspor {
  id: string;
  nama: string;
  form_pendataan: FormPendataan | null;
  fields: FieldKhusus[];
}

/** Definisi terkini, aktif dahulu; nonaktif berjawaban tetap berada di ujung. */
export function kolomEksporKhusus(fields: FieldKhusus[]): KolomData[] {
  return fields.filter(f => !f.tersembunyi || f.pernah_diisi).slice()
    .sort((a, b) => Number(a.tersembunyi) - Number(b.tersembunyi) || a.urut - b.urut)
    .map(f => ({
      kunci: `khusus_${f.id}`,
      judul: `[Khusus] ${f.label}${f.tersembunyi ? ' (nonaktif)' : ''}`,
      ambil: r => formatNilaiKhusus(f, r.khusus?.[f.id]),
    }));
}

/** Pemilik mengizinkan PII utuh bagi admin/FO; peran lain memakai redaksi PII bersama. */
export function kolomEksporAman(kolom: KolomData[], role: string): KolomData[] {
  if (role === 'admin' || role === 'front_office') return kolom;
  return kolom.map(k => ({ ...k, ambil: r => {
    const nilai = k.ambil(r);
    return typeof nilai === 'string' ? redactPii(nilai) : nilai;
  } }));
}

function namaSheet(nama: string, terpakai: Set<string>): string {
  const dasar = nama.replace(/[\\/*?:[\]\x00-\x1f]/g, ' ').replace(/^'+|'+$/g, '').trim() || 'Layanan';
  let hasil = dasar.slice(0, 31);
  let n = 2;
  while (terpakai.has(hasil.toLowerCase())) {
    const akhir = ` (${n++})`;
    hasil = dasar.slice(0, 31 - akhir.length) + akhir;
  }
  terpakai.add(hasil.toLowerCase());
  return hasil;
}

export async function buatWorkbookTerpadu(
  rows: BarisPelayanan[], layanan: LayananEkspor[], meta: MetaEkspor, role: string,
): Promise<ExcelJS.Buffer> {
  const { default: Excel } = await import('exceljs');
  const wb = new Excel.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  const terpakai = new Set(['semua', 'keterangan', 'history']);
  const tambah = (nama: string, data: BarisPelayanan[], kolom: KolomData[]) => {
    const ws = wb.addWorksheet(nama);
    const aman = kolomEksporAman(kolom, role);
    ws.columns = aman.map(k => ({ header: selAman(k.judul) as string, key: k.kunci, width: Math.min(50, Math.max(12, k.judul.length + 2)) }));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.getRow(1).font = { bold: true };
    for (const r of data) ws.addRow(Object.fromEntries(aman.map(k => [k.kunci, selAman(k.ambil(r))])));
    const hp = aman.findIndex(k => k.kunci === 'hp') + 1;
    if (hp) ws.getColumn(hp).numFmt = '@';
  };
  tambah('Semua', rows, kolomDataPelayanan(null));
  const perLayanan = new Map<string, BarisPelayanan[]>();
  for (const r of rows) {
    if (!r.layanan_id) continue;
    const kelompok = perLayanan.get(r.layanan_id) ?? [];
    kelompok.push(r);
    perLayanan.set(r.layanan_id, kelompok);
  }
  for (const l of layanan) tambah(namaSheet(l.nama, terpakai), perLayanan.get(l.id) ?? [], kolomDataPelayanan(l.form_pendataan, kolomEksporKhusus(l.fields)));
  const info = wb.addWorksheet('Keterangan');
  info.columns = [{ header: 'Keterangan', key: 'k', width: 24 }, { header: 'Nilai', key: 'v', width: 90 }];
  info.addRows([
    { k: 'Rentang', v: `${meta.dari} s.d. ${meta.sampai}` }, { k: 'Lingkup data', v: meta.lingkup },
    { k: 'Filter', v: selAman(meta.filter) }, { k: 'Jumlah baris', v: rows.length },
    { k: 'Definisi', v: DEFINISI_DILAYANI },
    ...(meta.truncated ? [{ k: 'Peringatan', v: 'Data terpotong pada batas baris. Persempit rentang tanggal.' }] : []),
  ]);
  return wb.xlsx.writeBuffer();
}
