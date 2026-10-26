// src/lib/types/pelayanan.ts
// Definisi tipe data, opsi dropdown, dan skema validasi Zod untuk Fitur Pendataan Pelayanan.

import { z } from 'zod';

// ============================================================
// 1. OPSI & ENUM STANDAR (PRAKTIS & FLEKSIBEL)
// ============================================================

// Pendataan (keputusan CEO G.5, migrasi 202610140011): SEMUA field wajib saat menyelesaikan layanan. Pemohon yang
// belum/tidak punya usaha memilih opsi eksplisit "Tidak berlaku" (bukan mengosongkan field).
export const SKALA_USAHA_OPTIONS = [
  'Mikro',
  'Kecil',
  'Menengah',
  'Besar',
  'Tidak berlaku',
] as const;
export type SkalaUsaha = (typeof SKALA_USAHA_OPTIONS)[number];

export const TIPE_PELAKU_USAHA_OPTIONS = [
  'perseorangan',
  'non_perseorangan',
  'tidak_berlaku',
] as const;
export type TipePelakuUsaha = (typeof TIPE_PELAKU_USAHA_OPTIONS)[number];

export const TIPE_PELAKU_USAHA_LABELS: Record<TipePelakuUsaha, string> = {
  perseorangan: 'Orang Perseorangan',
  non_perseorangan: 'Badan Usaha (Non-Perseorangan)',
  tidak_berlaku: 'Tidak berlaku',
};

export const STATUS_PENANAMAN_MODAL_OPTIONS = [
  'PMDN',
  'PMA',
  'tidak_ada',
] as const;
export type StatusPenanamanModal = (typeof STATUS_PENANAMAN_MODAL_OPTIONS)[number];

export const STATUS_PENANAMAN_MODAL_LABELS: Record<StatusPenanamanModal, string> = {
  PMDN: 'PMDN (Penanaman Modal Dalam Negeri)',
  PMA: 'PMA (Penanaman Modal Asing)',
  tidak_ada: 'Bukan PMA/PMDN (Tidak Ada)',
};

export const TINDAK_LANJUT_OSS_OPTIONS = [
  'Selesai di Loket (Tuntas)',
  'Dipandu Mandiri',
  'Eskalasi ke Lembaga OSS / BKPM',
  'Dikoordinasikan ke OPD Teknis',
  'Konsultasi Lanjutan',
] as const;
export type TindakLanjutOss = (typeof TINDAK_LANJUT_OSS_OPTIONS)[number];

export const OPD_TEKNIS_OPTIONS = [
  'Dinas Energi dan Sumber Daya Mineral (ESDM)',
  'Dinas Lingkungan Hidup (DLH)',
  'Dinas Kehutanan',
  'Dinas Kelautan dan Perikanan',
  'Dinas Perhubungan',
  'Dinas Ketahanan Pangan, Tanaman Pangan dan Hortikultura',
  'Dinas Perkebunan',
  'Dinas Peternakan dan Kesehatan Hewan',
  'Dinas Kesehatan',
  'Dinas Pendidikan dan Kebudayaan',
  'Dinas Perindustrian dan Perdagangan',
  'Dinas Bina Marga dan Bina Konstruksi',
  'Dinas Perumahan, Kawasan Permukiman dan Cipta Karya',
  'Dinas Koperasi, Usaha Kecil dan Menengah',
  'Dinas Pariwisata dan Ekonomi Kreatif',
  'Lainnya',
] as const;
export type OpdTeknis = (typeof OPD_TEKNIS_OPTIONS)[number];

export const TINDAK_LANJUT_PERIZINAN_OPTIONS = [
  'Konsultasi Selesai di Loket',
  'Berkas Diterima untuk Diproses',
  'Berkas Dikembalikan untuk Dilengkapi',
  'Dikoordinasikan dengan OPD Teknis',
  'Izin / Rekomendasi Diserahkan',
] as const;
export type TindakLanjutPerizinan = (typeof TINDAK_LANJUT_PERIZINAN_OPTIONS)[number];

// ============================================================
// 1b. NILAI ISIAN EKSPLISIT (field wajib yang memang tidak ada)
// ============================================================
export const NILAI_BELUM_ADA = 'Belum ada';
export const NILAI_TIDAK_BERLAKU = 'Tidak berlaku';
/** Isian untuk kolom catatan yang tidak ada catatannya. */
export const NILAI_CATATAN_KOSONG = '-';

// ============================================================
// 2. SKEMA VALIDASI ZOD (DRAFT & FINAL)
// ============================================================

// --- HELPDESK OSS ---
export const ossPelayananDraftSchema = z.object({
  nama_pemohon: z.string().trim().min(1, 'Nama pemohon wajib ada'),
  alamat_pemohon: z.string().trim().optional().nullable(),
  no_hp: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  keperluan_awal: z.string().trim().optional().nullable(),
  nama_usaha: z.string().trim().optional().nullable(),
  tipe_pelaku_usaha: z.string().trim().optional().nullable(),
  status_penanaman_modal: z.string().trim().optional().nullable(),
  lokasi_usaha: z.string().trim().optional().nullable(),
  skala_usaha: z.string().trim().optional().nullable(),
  sektor_usaha_kbli: z.string().trim().optional().nullable(),
  tindak_lanjut: z.string().trim().optional().nullable(),
  uraian_solusi: z.string().trim().optional().nullable(),
  catatan_internal: z.string().trim().optional().nullable(),
});

// Skema FINAL (menyelesaikan layanan): SEMUA field wajib non-kosong (keputusan CEO G.5). Draf (autosave) tetap
// longgar. Cermin validasi server: migrasi 202610140011 (layanan_selesai -> INVALID_PAYLOAD).
const wajibTeks = (pesan: string) => z.string({ error: pesan }).trim().min(1, pesan);
const wajibPilihan = <T extends readonly [string, ...string[]]>(opsi: T, pesan: string) =>
  z.enum(opsi, { error: pesan });

export const ossPelayananFinalSchema = z.object({
  nama_pemohon: wajibTeks('Nama pemohon wajib diisi'),
  alamat_pemohon: wajibTeks('Asal instansi / alamat domisili wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  no_hp: wajibTeks('Nomor HP / WhatsApp wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  email: wajibTeks('Alamat email wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  keperluan_awal: wajibTeks('Keperluan awal wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  nama_usaha: wajibTeks('Nama usaha wajib diisi (isi "Belum ada" atau "Tidak berlaku" bila tidak ada)'),
  tipe_pelaku_usaha: wajibPilihan(TIPE_PELAKU_USAHA_OPTIONS, 'Tipe pelaku usaha wajib dipilih'),
  status_penanaman_modal: wajibPilihan(STATUS_PENANAMAN_MODAL_OPTIONS, 'Status penanaman modal wajib dipilih'),
  lokasi_usaha: wajibTeks('Lokasi usaha wajib diisi (isi "Belum ada" atau "Tidak berlaku" bila tidak ada)'),
  skala_usaha: wajibPilihan(SKALA_USAHA_OPTIONS, 'Skala usaha wajib dipilih'),
  sektor_usaha_kbli: wajibTeks('KBLI / sektor usaha wajib diisi (isi "Belum ada" atau "Tidak berlaku" bila tidak ada)'),
  tindak_lanjut: wajibTeks('Tindak lanjut / tindakan wajib diisi'),
  uraian_solusi: wajibTeks('Uraian solusi / konsultasi wajib diisi'),
  catatan_internal: wajibTeks('Catatan internal wajib diisi (isi "-" bila tidak ada catatan)'),
});

// --- PERIZINAN DPMPTSP ---
export const perizinanPelayananDraftSchema = z.object({
  nama_pemohon: z.string().trim().min(1, 'Nama pemohon wajib ada'),
  alamat_pemohon: z.string().trim().optional().nullable(),
  no_hp: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  keperluan_awal: z.string().trim().optional().nullable(),
  nama_perusahaan: z.string().trim().optional().nullable(),
  lokasi_usaha: z.string().trim().optional().nullable(),
  opd_teknis: z.string().trim().optional().nullable(),
  uraian_permohonan: z.string().trim().optional().nullable(),
  tindak_lanjut: z.string().trim().optional().nullable(),
  catatan_petugas: z.string().trim().optional().nullable(),
});

export const perizinanPelayananFinalSchema = z.object({
  nama_pemohon: wajibTeks('Nama pemohon wajib diisi'),
  alamat_pemohon: wajibTeks('Asal instansi / alamat domisili wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  no_hp: wajibTeks('Nomor HP / WhatsApp wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  email: wajibTeks('Alamat email wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  keperluan_awal: wajibTeks('Keperluan awal wajib diisi (isi "Tidak berlaku" bila tidak ada)'),
  nama_perusahaan: wajibTeks('Nama perusahaan / pemohon wajib diisi (isi "Belum ada" atau "Tidak berlaku" bila tidak ada)'),
  lokasi_usaha: wajibTeks('Lokasi usaha wajib diisi (isi "Belum ada" atau "Tidak berlaku" bila tidak ada)'),
  opd_teknis: wajibTeks('OPD teknis wajib dipilih / diisi (isi "Tidak berlaku" bila tidak ada)'),
  uraian_permohonan: wajibTeks('Uraian permohonan wajib diisi'),
  tindak_lanjut: wajibTeks('Tindak lanjut wajib dipilih / diisi'),
  catatan_petugas: wajibTeks('Catatan petugas wajib diisi (isi "-" bila tidak ada catatan)'),
});

// ============================================================
// 3. TYPESCRIPT TYPES & DATA WRAPPERS
// ============================================================

export type OssPelayananDraft = z.infer<typeof ossPelayananDraftSchema>;
export type OssPelayananFinal = z.infer<typeof ossPelayananFinalSchema>;

export type PerizinanPelayananDraft = z.infer<typeof perizinanPelayananDraftSchema>;
export type PerizinanPelayananFinal = z.infer<typeof perizinanPelayananFinalSchema>;

export type FormPelayananType = 'oss' | 'perizinan';

export interface PelayananInitialData {
  tiket_id: string;
  legacy_visit_id: string | null;
  nomor_display: string;
  layanan_id: string;
  layanan_nama: string;
  form_type: FormPelayananType;
  // Prapopulasi Registrasi
  nama_pemohon: string;
  alamat_pemohon: string | null;
  no_hp: string | null;
  email: string | null;
  keperluan_awal: string | null;
  // Status Pelayanan
  status_tiket: string;
  /** petugas.id yang memulai layanan (pemilik tiket); null bila belum dimulai / tidak tercatat. */
  dilayani_oleh: string | null;
  /** Nama pemilik bila terbaca oleh pemanggil (RLS petugas: petugas hanya membaca barisnya sendiri). */
  dilayani_oleh_nama: string | null;
  /**
   * true hanya bila pemanggil = pemilik tiket berstatus 'dilayani' dan data belum terkunci:
   * hanya saat itu draf boleh disimpan dan layanan boleh diselesaikan. Selain itu wizard baca-saja.
   */
  boleh_ubah: boolean;
  /** Fase 3: boleh menyelesaikan (pemilik tiket). Tidak ada = sama dengan boleh_ubah (respons lama). */
  boleh_selesaikan?: boolean;
  /** true bila tiket hasil eskalasi Front Office (penanganan_asal_id terisi). Informasi saja sejak 202610140015. */
  dari_eskalasi?: boolean;
  is_locked: boolean;
  status_draft: 'draft' | 'selesai' | 'belum_diisi';
  // Data Form Eksisting (bila sudah ada draft / final)
  data_oss?: Partial<OssPelayananDraft> | null;
  data_perizinan?: Partial<PerizinanPelayananDraft> | null;
}
