// Pustaka murni tampilan pengaduan (admin/FO): label status, penjelasan satu kalimat, filter ringkasan, dan teks batas SLA.
// Hitungan hari kerja dilakukan di server (view v_pengaduan_kerja, migrasi 0013 (DB)); di sini hanya memformat hasilnya.
import { formatTanggal } from '@/lib/utils';

export type SlaStatus = 'aman' | 'mendekati' | 'terlambat';

export interface PengaduanKerja {
  id: string;
  nomor_tiket: string;
  jalur: 'layanan' | 'integritas';
  layanan_id: string | null;
  layanan_nama?: string | null;
  status: string;
  anonim: boolean;
  created_at: string;
  isi: string;
  pelapor_nama?: string | null;
  bisa_dihubungi?: boolean | null;
  batas_verifikasi?: string | null;
  batas_penanganan?: string | null;
  /** Batas yang sedang berlaku; null bila pengaduan sudah ditutup. */
  batas_aktif?: string | null;
  sisa_hari_kerja?: number | null;
  sla_status?: SlaStatus | null;
  terbuka?: boolean | null;
  penangan_id?: string | null;
  penangan_nama?: string | null;
  penangan_sejak?: string | null;
  /** Pelapor melampirkan bukti. Hanya penanda; jalur objeknya tidak pernah dikirim ke klien (dibuka lewat endpoint berotorisasi). */
  ada_bukti?: boolean | null;
}

export interface RingkasanPengaduan {
  baru: number;
  diproses: number;
  mendekati: number;
  terlambat: number;
  selesai: number;
  ditolak: number;
}

export type FilterPengaduan = 'aktif' | 'baru' | 'diproses' | 'mendekati' | 'terlambat' | 'selesai' | 'arsip' | 'semua';

export const FILTER_VALID: readonly FilterPengaduan[] = ['aktif', 'baru', 'diproses', 'mendekati', 'terlambat', 'selesai', 'arsip', 'semua'];

export function filterValid(nilai: string | null | undefined): FilterPengaduan {
  return FILTER_VALID.includes(nilai as FilterPengaduan) ? (nilai as FilterPengaduan) : 'aktif';
}

export const STATUS_LABEL: Record<string, string> = {
  baru: 'Baru',
  diverifikasi: 'Diverifikasi',
  diproses: 'Diproses',
  eskalasi: 'Eskalasi',
  selesai: 'Selesai',
  ditolak: 'Ditolak',
};

export const STATUS_PENJELASAN: Record<string, string> = {
  baru: 'Laporan baru masuk dan belum ada yang menangani.',
  diverifikasi: 'Laporan sudah diperiksa dan menunggu ditindaklanjuti.',
  diproses: 'Laporan sedang ditangani oleh penangan.',
  eskalasi: 'Laporan diteruskan ke pihak yang berwenang.',
  selesai: 'Laporan sudah ditindaklanjuti dan ditutup.',
  ditolak: 'Laporan tidak dapat ditindaklanjuti dan alasan penolakannya dikirim ke pelapor.',
};

/** Pilihan di formulir tanggapan. `tetap` = status tidak berubah. */
export type PilihanStatus = 'tetap' | 'diverifikasi' | 'diproses' | 'selesai' | 'ditolak';

export const PILIHAN_STATUS: ReadonlyArray<{ nilai: PilihanStatus; label: string; bantuan: string }> = [
  { nilai: 'tetap', label: 'Tetap', bantuan: 'Status tidak berubah. Tanggapan wajib diisi.' },
  { nilai: 'diverifikasi', label: 'Verifikasi', bantuan: 'Laporan sudah diperiksa dan menunggu ditindaklanjuti.' },
  { nilai: 'diproses', label: 'Diproses', bantuan: 'Laporan sedang ditangani.' },
  { nilai: 'selesai', label: 'Selesai', bantuan: 'Laporan ditutup sebagai sudah ditindaklanjuti.' },
  { nilai: 'ditolak', label: 'Tolak', bantuan: 'Laporan tidak dapat ditindaklanjuti. Alasan wajib diisi dan dikirim ke pelapor.' },
];

export function statusTertutup(status: string): boolean {
  return status === 'selesai' || status === 'ditolak';
}

/** Isi yang diringkas untuk sel tabel: spasi dan baris baru dipadatkan. */
export function ringkasIsi(isi: string, maks = 160): string {
  const padat = isi.replace(/\s+/g, ' ').trim();
  return padat.length > maks ? `${padat.slice(0, maks - 1).trimEnd()}…` : padat;
}

export function namaPelapor(r: Pick<PengaduanKerja, 'anonim' | 'pelapor_nama'>): string {
  if (r.anonim) return 'Anonim';
  return r.pelapor_nama?.trim() || 'Tanpa nama';
}

/** Teks sisa waktu dalam hari kerja. Null bila pengaduan sudah ditutup atau data server belum tersedia. */
export function teksSisaHariKerja(sisa: number | null | undefined, slaStatus: SlaStatus | null | undefined): string | null {
  if (slaStatus == null || sisa == null) return null;
  if (sisa < 0) return `Terlambat ${-sisa} hari kerja`;
  if (sisa === 0) return 'Batas hari ini';
  return `${sisa} hari kerja lagi`;
}

/** Tanggal batas untuk kolom Batas (pengaduan terbuka saja). */
export function teksBatas(r: Pick<PengaduanKerja, 'batas_aktif' | 'status'>): string {
  if (statusTertutup(r.status) || !r.batas_aktif) return '-';
  return formatTanggal(r.batas_aktif);
}

export const KOLOM_LEGACY = 'id, nomor_tiket, jalur, layanan_id, status, batas_verifikasi, batas_penanganan, anonim, created_at, isi';
export const KOLOM_KERJA = `${KOLOM_LEGACY}, layanan_nama, pelapor_nama, bisa_dihubungi, batas_aktif, sisa_hari_kerja, sla_status, terbuka, penangan_id, penangan_nama, penangan_sejak`;
export const KOLOM_PETUGAS_BARU = `${KOLOM_LEGACY}, batas_aktif, sisa_hari_kerja, sla_status`;

// Entri linimasa dari RPC linimasa_pengaduan (urut waktu naik).
export interface LinimasaStatus { jenis: 'status'; waktu: string; oleh_nama?: string | null; status_lama?: string | null; status_baru?: string | null; catatan?: string | null }
export interface LinimasaTanggapan {
  jenis: 'tanggapan';
  waktu: string;
  oleh_nama?: string | null;
  isi: string;
  status_baru?: string | null;
  /** `id` dipakai untuk membuka berkas lewat endpoint berotorisasi; tanpa id, hanya nama yang tampil. */
  lampiran?: Array<{ id?: string; nama: string; mime?: string; ukuran?: number }> | null;
}
export interface LinimasaPenangan {
  jenis: 'penangan';
  waktu: string;
  oleh_nama?: string | null;
  aksi?: 'tangani' | 'ambil_alih' | 'otomatis' | string | null;
  dari_nama?: string | null;
  ke_nama?: string | null;
  alasan?: string | null;
}
export type EntriLinimasa = LinimasaStatus | LinimasaTanggapan | LinimasaPenangan;
