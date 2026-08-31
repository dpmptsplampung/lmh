// src/lib/types/pelayanan.ts
// Definisi tipe data, opsi dropdown, dan skema validasi Zod untuk Fitur Pendataan Pelayanan.

import { z } from 'zod';

// ============================================================
// 1. OPSI & ENUM STANDAR (PRAKTIS & FLEKSIBEL)
// ============================================================

export const SKALA_USAHA_OPTIONS = [
  'Mikro',
  'Kecil',
  'Menengah',
  'Besar',
] as const;
export type SkalaUsaha = (typeof SKALA_USAHA_OPTIONS)[number];

export const TIPE_PELAKU_USAHA_OPTIONS = [
  'perseorangan',
  'non_perseorangan',
] as const;
export type TipePelakuUsaha = (typeof TIPE_PELAKU_USAHA_OPTIONS)[number];

export const TIPE_PELAKU_USAHA_LABELS: Record<TipePelakuUsaha, string> = {
  perseorangan: 'Orang Perseorangan',
  non_perseorangan: 'Badan Usaha (Non-Perseorangan)',
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

export const ossPelayananFinalSchema = ossPelayananDraftSchema.extend({
  nama_usaha: z.string().trim().min(1, 'Nama usaha / badan usaha wajib diisi'),
  tindak_lanjut: z.string().trim().min(1, 'Tindak lanjut / tindakan wajib diisi'),
  uraian_solusi: z.string().trim().min(1, 'Uraian solusi / konsultasi wajib diisi'),
  // tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha, skala_usaha, sektor_usaha_kbli tetap OPSIONAL
});

// --- PERIZINAN DPMPTSP ---
export const perizinanPelayananDraftSchema = z.object({
  nama_pemohon: z.string().trim().min(1, 'Nama pemohon wajib ada'),
  alamat_pemohon: z.string().trim().optional().nullable(),
  no_hp: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  keperluan_awal: z.string().trim().optional().nullable(),
  nama_perusahaan: z.string().trim().optional().nullable(),
  opd_teknis: z.string().trim().optional().nullable(),
  uraian_permohonan: z.string().trim().optional().nullable(),
  tindak_lanjut: z.string().trim().optional().nullable(),
  catatan_petugas: z.string().trim().optional().nullable(),
});

export const perizinanPelayananFinalSchema = perizinanPelayananDraftSchema.extend({
  nama_perusahaan: z.string().trim().min(1, 'Nama perusahaan / pemohon wajib diisi'),
  opd_teknis: z.string().trim().min(1, 'OPD Teknis wajib dipilih / diisi'),
  uraian_permohonan: z.string().trim().min(1, 'Uraian permohonan wajib diisi'),
  tindak_lanjut: z.string().trim().min(1, 'Tindak lanjut wajib dipilih / diisi'),
  // catatan_petugas tetap opsional
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
  legacy_visit_id: string;
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
  is_locked: boolean;
  status_draft: 'draft' | 'selesai' | 'belum_diisi';
  // Data Form Eksisting (bila sudah ada draft / final)
  data_oss?: Partial<OssPelayananDraft> | null;
  data_perizinan?: Partial<PerizinanPelayananDraft> | null;
}
