import ExcelJS from 'exceljs';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit } from './format';

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
  form_type: 'oss' | 'perizinAN' | null;
  pelayanan_oss: RekapPelayananOss | null;
  pelayanan_perizinAN: RekapPelayananPerizin | null;
}

const COLUMNS: Array<{ header: string; key: keyof RekapTicketRow | string; width: number }> = [
  { header: 'Tanggal', key: 'tanggal', width: 12 },
  { header: 'No Antrian', key: 'nomor_display', width: 12 },
  { header: 'Nama Pengunjung', key: 'kunjungan_nama', width: 24 },
  { header: 'Asal', key: 'asal', width: 12 },
  { header: 'Petugas', key: 'petugas_nama', width: 20 },
  { header: 'Waktu Mulai', key: 'mulai', width: 12 },
  { header: 'Waktu Selesai', key: 'selesai', width: 12 },
  { header: 'Durasi (mnt)', key: 'durasi', width: 12 },
  { header: 'Jenis Pendataan', key: 'form_type', width: 16 },
  { header: '[OSS] Nama Pemohon', key: 'oss_nama_pemohon', width: 24 },
  { header: '[OSS] Nama Usaha', key: 'oss_nama_usaha', width: 24 },
  { header: '[OSS] Tipe Pelaku', key: 'oss_tipe', width: 16 },
  { header: '[OSS] Status PM', key: 'oss_status_pm', width: 14 },
  { header: '[OSS] Lokasi', key: 'oss_lokasi', width: 24 },
  { header: '[OSS] Skala', key: 'oss_skala', width: 12 },
  { header: '[OSS] KBLI', key: 'oss_kbli', width: 12 },
  { header: '[OSS] Tindak Lanjut', key: 'oss_tindak', width: 18 },
  { header: '[OSS] Uraian Solusi', key: 'oss_uraian', width: 36 },
  { header: '[OSS] Catatan', key: 'oss_catatan', width: 24 },
  { header: '[Perizinan] Nama Pemohon', key: 'per_nama_pemohon', width: 24 },
  { header: '[Perizinan] Nama Perusahaan', key: 'per_nama_perusahaan', width: 24 },
  { header: '[Perizinan] OPD Teknis', key: 'per_opd', width: 20 },
  { header: '[Perizinan] Uraian', key: 'per_uraian', width: 36 },
  { header: '[Perizinan] Tindak Lanjut', key: 'per_tindak', width: 18 },
  { header: '[Perizinan] Catatan', key: 'per_catatan', width: 24 },
];

function rowToCells(r: RekapTicketRow): Record<string, string | number | null> {
  const o = r.pelayanan_oss;
  const p = r.pelayanan_perizinAN;
  const durasi = hitungDurasiMenit(r.waktu_mulai_layan, r.waktu_selesai);
  return {
    tanggal: formatTanggalId(r.tanggal),
    nomor_display: r.nomor_display,
    kunjungan_nama: r.kunjungan?.nama ?? '',
    asal: r.kunjungan?.asal ?? '',
    petugas_nama: r.petugas?.nama ?? '',
    mulai: formatWaktuId(r.waktu_mulai_layan),
    selesai: formatWaktuId(r.waktu_selesai),
    durasi: durasi ?? '',
    form_type: r.form_type ?? '',
    oss_nama_pemohon: o?.nama_pemohon ?? '',
    oss_nama_usaha: o?.nama_usaha ?? '',
    oss_tipe: o?.tipe_pelaku_usaha ?? '',
    oss_status_pm: o?.status_penanaman_modal ?? '',
    oss_lokasi: o?.lokasi_usaha ?? '',
    oss_skala: o?.skala_usaha ?? '',
    oss_kbli: o?.sektor_usaha_kbli ?? '',
    oss_tindak: o?.tindak_lanjut ?? '',
    oss_uraian: o?.uraian_solusi ?? '',
    oss_catatan: o?.catatan_internal ?? '',
    per_nama_pemohon: p?.nama_pemohon ?? '',
    per_nama_perusahaan: p?.nama_perusahaan ?? '',
    per_opd: p?.opd_teknis ?? '',
    per_uraian: p?.uraian_permohonan ?? '',
    per_tindak: p?.tindak_lanjut ?? '',
    per_catatan: p?.catatan_petugas ?? '',
  };
}

export async function buildRekapWorkbook(rows: RekapTicketRow[]): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  wb.created = new Date();

  const ws = wb.addWorksheet('Rekap Layanan');
  ws.columns = COLUMNS;
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // Header row styling
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1E40AF' },
  };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 22;

  for (const r of rows) {
    ws.addRow(rowToCells(r));
  }

  return wb.xlsx.writeBuffer();
}
