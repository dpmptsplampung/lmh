import ExcelJS from 'exceljs';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from './format';

export type RekapExportTab = 'umum' | 'oss' | 'perizinan' | 'layanan';

type CellValue = string | number | null;
type Column = { header: string; key: string };

export interface RekapPelayananOss {
  id: string;
  nama_pemohon: string;
  nama_usaha: string;
  tipe_pelaku_usaha: string | null;
  status_penanaman_modal: string | null;
  lokasi_usaha: string | null;
  skala_usaha: string | null;
  sektor_usaha_kbli: string | null;
  tindak_lanjut: string;
  uraian_solusi: string;
  catatan_internal: string | null;
}

export interface RekapPelayananPerizin {
  id: string;
  nama_pemohon: string;
  nama_perusahaan: string;
  lokasi_usaha: string | null;
  opd_teknis: string;
  uraian_permohonan: string;
  tindak_lanjut: string;
  catatan_petugas: string | null;
}

export interface RekapTicketRow {
  id: string;
  nomor_display: string;
  tanggal: string;
  waktu_terbit: string;
  waktu_mulai_layan: string | null;
  waktu_selesai: string | null;
  status: string;
  kunjungan: { nama: string; asal: string; qr_token: string | null } | null;
  petugas: { nama: string } | null;
  form_type: 'oss' | 'perizinan' | null;
  pelayanan_oss: RekapPelayananOss | null;
  pelayanan_perizinan: RekapPelayananPerizin | null;
}

export interface RekapUmumRow {
  tanggal: string;
  layanan_id: string;
  layanan?: { nama: string } | { nama: string }[] | null;
  total_hadir: number;
  total_selesai: number;
  total_tidak_terlayani: number;
  total_batal: number;
  rata_durasi_menit: number | null;
}

export interface RekapOssRow {
  tanggal: string;
  nomor_display: string;
  nama_pemohon: string;
  no_hp: string | null;
  nama_usaha: string;
  tipe_pelaku_usaha: string | null;
  status_penanaman_modal: string | null;
  lokasi_usaha: string | null;
  skala_usaha: string | null;
  sektor_usaha_kbli: string | null;
  tindak_lanjut: string;
  uraian_solusi: string;
  nama_petugas: string;
  status_draft: string;
}

export interface RekapPerizinanRow {
  tanggal: string;
  nomor_display: string;
  nama_pemohon: string;
  no_hp: string | null;
  nama_perusahaan: string;
  email: string | null;
  lokasi_usaha: string | null;
  opd_teknis: string;
  uraian_permohonan: string;
  tindak_lanjut: string;
  catatan_petugas: string | null;
  nama_petugas: string;
  status_draft: string;
}

export type RekapExportRows = RekapTicketRow[] | RekapUmumRow[] | RekapOssRow[] | RekapPerizinanRow[];

const LAYANAN_COLUMNS: Column[] = [
  { header: 'Tanggal', key: 'tanggal' },
  { header: 'No Antrian', key: 'nomor_display' },
  { header: 'Nama Pengunjung', key: 'kunjungan_nama' },
  { header: 'Asal', key: 'asal' },
  { header: 'Petugas', key: 'petugas_nama' },
  { header: 'Waktu Mulai', key: 'mulai' },
  { header: 'Waktu Selesai', key: 'selesai' },
  { header: 'Durasi (mnt)', key: 'durasi' },
  { header: 'Jenis Pendataan', key: 'form_type' },
  { header: '[OSS] Nama Pemohon', key: 'oss_nama_pemohon' },
  { header: '[OSS] Nama Usaha', key: 'oss_nama_usaha' },
  { header: '[OSS] Tipe Pelaku', key: 'oss_tipe' },
  { header: '[OSS] Status PM', key: 'oss_status_pm' },
  { header: '[OSS] Lokasi', key: 'oss_lokasi' },
  { header: '[OSS] Skala', key: 'oss_skala' },
  { header: '[OSS] KBLI', key: 'oss_kbli' },
  { header: '[OSS] Tindak Lanjut', key: 'oss_tindak' },
  { header: '[OSS] Uraian Solusi', key: 'oss_uraian' },
  { header: '[OSS] Catatan', key: 'oss_catatan' },
  { header: '[Perizinan] Nama Pemohon', key: 'per_nama_pemohon' },
  { header: '[Perizinan] Nama Perusahaan', key: 'per_nama_perusahaan' },
  { header: '[Perizinan] Lokasi Usaha', key: 'per_lokasi_usaha' },
  { header: '[Perizinan] OPD Teknis', key: 'per_opd' },
  { header: '[Perizinan] Uraian', key: 'per_uraian' },
  { header: '[Perizinan] Tindak Lanjut', key: 'per_tindak' },
  { header: '[Perizinan] Catatan', key: 'per_catatan' },
];

const UMUM_COLUMNS: Column[] = [
  { header: 'Tanggal', key: 'tanggal' },
  { header: 'Layanan', key: 'layanan' },
  { header: 'Hadir', key: 'hadir' },
  { header: 'Selesai', key: 'selesai' },
  { header: 'Tidak Terlayani', key: 'tidak_terlayani' },
  { header: 'Batal', key: 'batal' },
  { header: 'Rata Durasi (mnt)', key: 'rata_durasi' },
];

const OSS_COLUMNS: Column[] = [
  { header: 'Tanggal', key: 'tanggal' },
  { header: 'Nomor Tiket', key: 'nomor_display' },
  { header: 'Nama Pemohon', key: 'nama_pemohon' },
  { header: 'No HP', key: 'no_hp' },
  { header: 'Nama Usaha', key: 'nama_usaha' },
  { header: 'Tipe Pelaku Usaha', key: 'tipe_pelaku_usaha' },
  { header: 'Status Penanaman Modal', key: 'status_penanaman_modal' },
  { header: 'Lokasi Usaha', key: 'lokasi_usaha' },
  { header: 'Skala Usaha', key: 'skala_usaha' },
  { header: 'KBLI', key: 'sektor_usaha_kbli' },
  { header: 'Tindakan', key: 'tindak_lanjut' },
  { header: 'Uraian Solusi', key: 'uraian_solusi' },
  { header: 'Petugas', key: 'nama_petugas' },
  { header: 'Status', key: 'status_draft' },
];

const PERIZINAN_COLUMNS: Column[] = [
  { header: 'Tanggal', key: 'tanggal' },
  { header: 'Nomor Tiket', key: 'nomor_display' },
  { header: 'Nama Pemohon', key: 'nama_pemohon' },
  { header: 'No HP', key: 'no_hp' },
  { header: 'Nama Perusahaan', key: 'nama_perusahaan' },
  { header: 'Email', key: 'email' },
  { header: 'Lokasi Usaha', key: 'lokasi_usaha' },
  { header: 'OPD Teknis', key: 'opd_teknis' },
  { header: 'Uraian Permohonan', key: 'uraian_permohonan' },
  { header: 'Tindak Lanjut', key: 'tindak_lanjut' },
  { header: 'Catatan Petugas', key: 'catatan_petugas' },
  { header: 'Petugas', key: 'nama_petugas' },
  { header: 'Status', key: 'status_draft' },
];

const SHEET_NAMES: Record<RekapExportTab, string> = {
  umum: 'Rekap Umum',
  oss: 'Helpdesk OSS',
  perizinan: 'Non OSS',
  layanan: 'Rekap Layanan',
};

function rowToLayananCells(r: RekapTicketRow): Record<string, CellValue> {
  const o = asSingle(r.pelayanan_oss);
  const p = asSingle(r.pelayanan_perizinan);
  const durasi = hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai);
  return {
    tanggal: formatTanggalId(r.tanggal), nomor_display: r.nomor_display,
    kunjungan_nama: r.kunjungan?.nama ?? '', asal: r.kunjungan?.asal ?? '',
    petugas_nama: r.petugas?.nama ?? '', mulai: formatWaktuId(r.waktu_mulai_layan),
    selesai: formatWaktuId(r.waktu_selesai), durasi: durasi ?? '', form_type: r.form_type ?? '',
    oss_nama_pemohon: o?.nama_pemohon ?? '', oss_nama_usaha: o?.nama_usaha ?? '',
    oss_tipe: o?.tipe_pelaku_usaha ?? '', oss_status_pm: o?.status_penanaman_modal ?? '',
    oss_lokasi: o?.lokasi_usaha ?? '', oss_skala: o?.skala_usaha ?? '',
    oss_kbli: o?.sektor_usaha_kbli ?? '', oss_tindak: o?.tindak_lanjut ?? '',
    oss_uraian: o?.uraian_solusi ?? '', oss_catatan: o?.catatan_internal ?? '',
    per_nama_pemohon: p?.nama_pemohon ?? '', per_nama_perusahaan: p?.nama_perusahaan ?? '',
    per_lokasi_usaha: p?.lokasi_usaha ?? '', per_opd: p?.opd_teknis ?? '',
    per_uraian: p?.uraian_permohonan ?? '', per_tindak: p?.tindak_lanjut ?? '',
    per_catatan: p?.catatan_petugas ?? '',
  };
}

function rowToUmumCells(r: RekapUmumRow): Record<string, CellValue> {
  const layanan = asSingle(r.layanan)?.nama ?? r.layanan_id;
  return {
    tanggal: r.tanggal, layanan, hadir: r.total_hadir, selesai: r.total_selesai,
    tidak_terlayani: r.total_tidak_terlayani, batal: r.total_batal,
    rata_durasi: r.rata_durasi_menit == null ? '' : Math.round(r.rata_durasi_menit),
  };
}

function cellsFromRow(row: Record<string, unknown>, columns: Column[]): Record<string, CellValue> {
  return Object.fromEntries(columns.map(({ key }) => {
    const value = row[key];
    return [key, typeof value === 'number' || typeof value === 'string' ? value : ''];
  }));
}

export function asSingle<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return (v as T | null | undefined) ?? null;
}

function applyAutoFit(ws: ExcelJS.Worksheet, columns: Column[]) {
  columns.forEach(({ header }, index) => {
    let max = header.length;
    ws.getColumn(index + 1).eachCell({ includeEmpty: true }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length);
    });
    ws.getColumn(index + 1).width = Math.min(50, Math.max(8, max + 2));
  });
}

export async function buildRekapWorkbook(
  tab: RekapExportTab,
  rows: RekapExportRows,
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  wb.created = new Date();

  const columns = tab === 'layanan' ? LAYANAN_COLUMNS : tab === 'umum' ? UMUM_COLUMNS : tab === 'oss' ? OSS_COLUMNS : PERIZINAN_COLUMNS;
  const ws = wb.addWorksheet(SHEET_NAMES[tab]);
  ws.columns = columns.map((column) => ({ ...column, width: 8 }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;

  if (tab === 'layanan') {
    (rows as RekapTicketRow[]).forEach((row) => ws.addRow(rowToLayananCells(row)));
  } else if (tab === 'umum') {
    (rows as RekapUmumRow[]).forEach((row) => ws.addRow(rowToUmumCells(row)));
  } else {
    (rows as unknown as Record<string, unknown>[]).forEach((row) => ws.addRow(cellsFromRow(row, columns)));
  }

  const phoneColumnIndex = columns.findIndex((column) => column.key === 'no_hp') + 1;
  if (phoneColumnIndex) {
    ws.getColumn(phoneColumnIndex).eachCell({ includeEmpty: false }, (cell, rowNumber) => {
      if (rowNumber > 1) cell.numFmt = '@';
    });
  }
  applyAutoFit(ws, columns);
  return wb.xlsx.writeBuffer();
}
