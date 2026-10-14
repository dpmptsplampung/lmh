// Ekspor Excel rekap penanganan (Tahap D): lembar "Rekap FO"/"Rekap Petugas Layanan" + lembar "Ringkasan".
// Nama penangan (FO/petugas) selalu ada di kolom pertama setelah tanggal.
import ExcelJS from 'exceljs';
import { formatTanggalId, formatWaktuId, labelHasilTahap, labelSaluran, labelStatusTiket } from './format';
import type { PeranTahap, RekapPenangananRow, RingkasanPenanganan } from './penanganan';

type CellValue = string | number | null;
type Kolom = { header: string; key: string };

const KOLOM_FO: Kolom[] = [
  { header: 'Tanggal', key: 'tanggal' },
  { header: 'Nama FO', key: 'penangan' },
  { header: 'Jam Mulai', key: 'mulai' },
  { header: 'Jam Selesai', key: 'selesai' },
  { header: 'Durasi (mnt)', key: 'durasi' },
  { header: 'Nama Pengunjung', key: 'pengunjung' },
  { header: 'Asal/Instansi', key: 'instansi' },
  { header: 'Saluran', key: 'saluran' },
  { header: 'Topik', key: 'topik' },
  { header: 'Hasil', key: 'hasil' },
  { header: 'Catatan', key: 'catatan' },
];

const KOLOM_LAYANAN: Kolom[] = [
  { header: 'Tanggal', key: 'tanggal' },
  { header: 'Petugas', key: 'penangan' },
  { header: 'Front Office', key: 'fo' },
  { header: 'Layanan', key: 'layanan' },
  { header: 'No Antrian', key: 'nomor' },
  { header: 'Jam Mulai', key: 'mulai' },
  { header: 'Jam Selesai', key: 'selesai' },
  { header: 'Durasi (mnt)', key: 'durasi' },
  { header: 'Nama Pengunjung', key: 'pengunjung' },
  { header: 'Saluran', key: 'saluran' },
  { header: 'Topik', key: 'topik' },
  { header: 'Hasil', key: 'hasil' },
  { header: 'Status Tiket', key: 'status_tiket' },
  { header: 'Catatan', key: 'catatan' },
  { header: 'Jenis Pendataan', key: 'form_type' },
  { header: '[OSS] Nama Pemohon', key: 'oss_nama_pemohon' },
  { header: '[OSS] Nama Usaha', key: 'oss_nama_usaha' },
  { header: '[OSS] Lokasi', key: 'oss_lokasi' },
  { header: '[OSS] KBLI', key: 'oss_kbli' },
  { header: '[OSS] Tindak Lanjut', key: 'oss_tindak' },
  { header: '[OSS] Uraian Solusi', key: 'oss_uraian' },
  { header: '[Perizinan] Nama Pemohon', key: 'per_nama_pemohon' },
  { header: '[Perizinan] Nama Perusahaan', key: 'per_nama_perusahaan' },
  { header: '[Perizinan] OPD Teknis', key: 'per_opd' },
  { header: '[Perizinan] Uraian', key: 'per_uraian' },
  { header: '[Perizinan] Tindak Lanjut', key: 'per_tindak' },
  { header: '[Perizinan] Catatan', key: 'per_catatan' },
];

/** Teks bebas pengguna (catatan, nama) diawali karakter rumus dinetralkan agar tidak dieksekusi Excel (CSV/formula injection). */
export function amanSel(v: string | null | undefined): string {
  const s = v ?? '';
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

function barisSel(peran: PeranTahap, r: RekapPenangananRow): Record<string, CellValue> {
  const dasar: Record<string, CellValue> = {
    tanggal: r.tanggal ? formatTanggalId(r.tanggal) : '',
    penangan: amanSel(r.penangan_nama),
    mulai: formatWaktuId(r.mulai_at),
    selesai: formatWaktuId(r.selesai_at),
    durasi: r.durasi_menit == null ? '' : Math.round(r.durasi_menit),
    pengunjung: amanSel(r.pengunjung_nama),
    saluran: labelSaluran(r.saluran),
    topik: amanSel(r.topik),
    hasil: labelHasilTahap(r),
    catatan: amanSel(r.catatan),
  };
  if (peran === 'fo') return { ...dasar, instansi: amanSel(r.pengunjung_instansi) };
  const o = r.tiket?.pelayanan_oss ?? null;
  const p = r.tiket?.pelayanan_perizinan ?? null;
  return {
    ...dasar,
    fo: amanSel(r.fo_nama),
    layanan: amanSel(r.layanan_nama),
    nomor: r.tiket?.nomor_display ?? '',
    status_tiket: r.tiket ? labelStatusTiket(r.tiket.status) : '',
    form_type: r.tiket?.form_type ?? '',
    oss_nama_pemohon: amanSel(o?.nama_pemohon), oss_nama_usaha: amanSel(o?.nama_usaha),
    oss_lokasi: amanSel(o?.lokasi_usaha), oss_kbli: o?.sektor_usaha_kbli ?? '',
    oss_tindak: amanSel(o?.tindak_lanjut), oss_uraian: amanSel(o?.uraian_solusi),
    per_nama_pemohon: amanSel(p?.nama_pemohon), per_nama_perusahaan: amanSel(p?.nama_perusahaan),
    per_opd: amanSel(p?.opd_teknis), per_uraian: amanSel(p?.uraian_permohonan),
    per_tindak: amanSel(p?.tindak_lanjut), per_catatan: amanSel(p?.catatan_petugas),
  };
}

function gayaHeader(ws: ExcelJS.Worksheet, kolom: Kolom[]) {
  ws.columns = kolom.map((k) => ({ ...k, width: 14 }));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
  header.alignment = { vertical: 'middle' };
  header.height = 22;
}

function lebarOtomatis(ws: ExcelJS.Worksheet, kolom: Kolom[]) {
  kolom.forEach(({ header }, i) => {
    let max = header.length;
    ws.getColumn(i + 1).eachCell({ includeEmpty: true }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length);
    });
    ws.getColumn(i + 1).width = Math.min(50, Math.max(8, max + 2));
  });
}

export async function buildRekapPenangananWorkbook(
  peran: PeranTahap,
  rows: RekapPenangananRow[],
  ringkasan: RingkasanPenanganan,
): Promise<ExcelJS.Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DPMPTSP Lampung';
  wb.created = new Date();

  const kolom = peran === 'fo' ? KOLOM_FO : KOLOM_LAYANAN;
  const ws = wb.addWorksheet(peran === 'fo' ? 'Rekap FO' : 'Rekap Petugas Layanan');
  gayaHeader(ws, kolom);
  for (const r of rows) ws.addRow(barisSel(peran, r));
  lebarOtomatis(ws, kolom);

  // Lembar ringkasan: per penangan per hari, lalu jumlah per hasil dan per topik.
  const rk = wb.addWorksheet('Ringkasan');
  const kolomRk: Kolom[] = [
    { header: 'Tanggal', key: 'tanggal' },
    { header: peran === 'fo' ? 'Nama FO' : 'Petugas', key: 'nama' },
    { header: 'Total', key: 'total' },
    { header: 'Selesai', key: 'selesai' },
    { header: 'Dieskalasi', key: 'dieskalasi' },
    { header: 'Dikembalikan', key: 'dikembalikan' },
    { header: 'Belum Ditutup', key: 'belum_ditutup' },
    { header: 'Dibatalkan', key: 'batal' },
    { header: 'Rata Durasi (mnt)', key: 'rata' },
  ];
  gayaHeader(rk, kolomRk);
  for (const g of ringkasan.per_penangan_hari) {
    rk.addRow({
      tanggal: g.tanggal ? formatTanggalId(g.tanggal) : '',
      nama: amanSel(g.nama),
      total: g.total, selesai: g.selesai, dieskalasi: g.dieskalasi, dikembalikan: g.dikembalikan,
      belum_ditutup: g.belum_ditutup, batal: g.batal,
      rata: g.rata_durasi_menit == null ? '' : Math.round(g.rata_durasi_menit * 10) / 10,
    });
  }
  rk.addRow({});
  const judulHasil = rk.addRow({ tanggal: 'Jumlah per hasil' });
  judulHasil.font = { bold: true };
  for (const h of ringkasan.per_hasil) rk.addRow({ tanggal: h.label, nama: h.jumlah });
  rk.addRow({});
  const judulTopik = rk.addRow({ tanggal: 'Jumlah per topik (tahap selesai)' });
  judulTopik.font = { bold: true };
  for (const t of ringkasan.per_topik) rk.addRow({ tanggal: amanSel(t.topik), nama: t.jumlah });
  lebarOtomatis(rk, kolomRk);

  return wb.xlsx.writeBuffer();
}
