// Rekap terpadu (Fase 3, spec §6.3): tipe baris RPC 202610290002, validasi query, dan definisi kolom Data Pelayanan.
// Modul murni (tanpa React/ExcelJS). Lingkup data ditegakkan DI DATABASE (RPC SECURITY DEFINER); modul ini hanya membentuk.
import { z } from 'zod';
import { addDaysWIB, todayWIB } from '@/lib/time';
import { formatTanggalId, formatWaktuId, hitungDurasiMenit, LABEL_HASIL_PENANGANAN, type HasilPenanganan } from './format';
import { jumlahHariRentang, MAKS_RENTANG_HARI } from './schemas';
import type { NilaiKhusus } from '@/lib/pendataan-khusus/jenis';

export type UnitRekap = 'fo' | 'layanan';
export type KanalRekap = 'tatap_muka' | 'live_chat';
export type FormPendataan = 'oss' | 'perizinan';

export const LABEL_KANAL: Record<KanalRekap, string> = { tatap_muka: 'Tatap muka', live_chat: 'Live Chat' };
export const NAMA_UNIT_FO = 'Front Office';

/** Satu baris rekap_data_pelayanan: satu pelayanan dilayani. */
export interface BarisPelayanan {
  pelayanan_id: string;
  sumber: 'penanganan' | 'tiket_lama';
  tanggal: string;
  kunjungan_id: string | null;
  tiket_id: string | null;
  nomor_tiket: string | null;
  unit: UnitRekap;
  layanan_id: string | null;
  layanan_nama: string | null;
  kanal: KanalRekap;
  penangan_id: string | null;
  penangan_nama: string | null;
  fo_nama: string | null;
  hasil: string | null;
  topik: string | null;
  catatan: string | null;
  mulai_at: string | null;
  selesai_at: string | null;
  pengunjung_nama: string | null;
  pengunjung_hp: string | null;
  pengunjung_email: string | null;
  pengunjung_instansi: string | null;
  pengunjung_kategori: string | null;
  keperluan: string | null;
  form_type: FormPendataan | null;
  pendataan: Record<string, unknown> | null;
  /** Jawaban Pendataan Khusus Fase 4 { id isian: nilai }; diisi route hanya bila satu Layanan dipilih. */
  khusus?: Record<string, NilaiKhusus>;
}

/** Satu baris rekap_harian_terpadu. */
export interface BarisHarian {
  tanggal: string;
  unit: UnitRekap;
  layanan_id: string | null;
  layanan_nama: string | null;
  tatap_muka: number;
  live_chat: number;
  jumlah: number;
}

/** Satu baris rekap_kinerja_petugas. */
export interface BarisKinerja {
  penangan_id: string;
  penangan_nama: string | null;
  unit: UnitRekap;
  layanan_id: string | null;
  layanan_nama: string | null;
  jumlah: number;
  live_chat: number;
  rata_durasi_menit: number | null;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const tanggalSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format tanggal harus YYYY-MM-DD');
const PESAN_RENTANG = `Rentang tanggal tidak valid (sampai >= dari, maksimal ${MAKS_RENTANG_HARI} hari)`;
const rentangValid = (v: { dari: string; sampai: string }) =>
  v.sampai >= v.dari && jumlahHariRentang(v.dari, v.sampai) <= MAKS_RENTANG_HARI;

const dasarQuery = {
  dari: tanggalSchema.default(() => addDaysWIB(-6)),
  sampai: tanggalSchema.default(() => todayWIB()),
  unit: z.enum(['fo', 'layanan']).optional(),
  layanan_id: z.uuid().optional(),
  // '1' = tab Data Pelayanan "Layanan lain": kecualikan Layanan berformulir (Helpdesk OSS / Non OSS; tab sendiri). Migrasi 202611010005.
  tanpa_form: z.literal('1').optional(),
};

export const rekapTerpaduQuerySchema = z
  .object({
    bagian: z.enum(['lingkup', 'harian', 'data', 'kinerja']),
    ...dasarQuery,
    // Batas atas agar page * page_size (p_lewati, integer di DB) tidak meluap: 10.000 x 200 = 2 juta baris.
    page: z.coerce.number().int().min(0).max(10_000).default(0),
    page_size: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .refine(rentangValid, { message: PESAN_RENTANG, path: ['sampai'] });

export const rekapTerpaduExportSchema = z
  .object(dasarQuery)
  .strict()
  .refine(rentangValid, { message: PESAN_RENTANG, path: ['sampai'] });

export type RekapTerpaduQuery = z.infer<typeof rekapTerpaduQuerySchema>;
export type RekapTerpaduExport = z.infer<typeof rekapTerpaduExportSchema>;

// ---------------------------------------------------------------------------
// Normalisasi baris RPC (bigint/numeric bisa datang sebagai string)
// ---------------------------------------------------------------------------

const teks = (v: unknown): string | null => (typeof v === 'string' ? v : v == null ? null : String(v));
const angka = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};
const angkaAtauNull = (v: unknown): number | null => (v == null || v === '' ? null : angka(v));

export function petaBarisPelayanan(r: Record<string, unknown>): BarisPelayanan {
  const pendataan = r.pendataan && typeof r.pendataan === 'object' ? (r.pendataan as Record<string, unknown>) : null;
  const ft = r.form_type === 'oss' || r.form_type === 'perizinan' ? r.form_type : null;
  return {
    pelayanan_id: String(r.pelayanan_id ?? ''),
    sumber: r.sumber === 'tiket_lama' ? 'tiket_lama' : 'penanganan',
    tanggal: String(r.tanggal ?? ''),
    kunjungan_id: teks(r.kunjungan_id),
    tiket_id: teks(r.tiket_id),
    nomor_tiket: teks(r.nomor_tiket),
    unit: r.unit === 'fo' ? 'fo' : 'layanan',
    layanan_id: teks(r.layanan_id),
    layanan_nama: teks(r.layanan_nama),
    kanal: r.kanal === 'live_chat' ? 'live_chat' : 'tatap_muka',
    penangan_id: teks(r.penangan_id),
    penangan_nama: teks(r.penangan_nama),
    fo_nama: teks(r.fo_nama),
    hasil: teks(r.hasil),
    topik: teks(r.topik),
    catatan: teks(r.catatan),
    mulai_at: teks(r.mulai_at),
    selesai_at: teks(r.selesai_at),
    pengunjung_nama: teks(r.pengunjung_nama),
    pengunjung_hp: teks(r.pengunjung_hp),
    pengunjung_email: teks(r.pengunjung_email),
    pengunjung_instansi: teks(r.pengunjung_instansi),
    pengunjung_kategori: teks(r.pengunjung_kategori),
    keperluan: teks(r.keperluan),
    form_type: ft,
    pendataan,
  };
}

export function petaBarisHarian(r: Record<string, unknown>): BarisHarian {
  return {
    tanggal: String(r.tanggal ?? ''),
    unit: r.unit === 'fo' ? 'fo' : 'layanan',
    layanan_id: teks(r.layanan_id),
    layanan_nama: teks(r.layanan_nama),
    tatap_muka: angka(r.tatap_muka),
    live_chat: angka(r.live_chat),
    jumlah: angka(r.jumlah),
  };
}

export function petaBarisKinerja(r: Record<string, unknown>): BarisKinerja {
  return {
    penangan_id: String(r.penangan_id ?? ''),
    penangan_nama: teks(r.penangan_nama),
    unit: r.unit === 'fo' ? 'fo' : 'layanan',
    layanan_id: teks(r.layanan_id),
    layanan_nama: teks(r.layanan_nama),
    jumlah: angka(r.jumlah),
    live_chat: angka(r.live_chat),
    rata_durasi_menit: angkaAtauNull(r.rata_durasi_menit),
  };
}

/** Nama unit untuk tampilan: Front Office atau nama Layanan. */
export function namaUnit(r: { unit: UnitRekap; layanan_nama: string | null }): string {
  return r.unit === 'fo' ? NAMA_UNIT_FO : (r.layanan_nama ?? '(Layanan tidak dikenal)');
}

export interface RingkasanHarian {
  jumlah: number;
  tatap_muka: number;
  live_chat: number;
  per_unit: { nama: string; jumlah: number }[];
}

/** Ringkasan Rekap Harian dari DB (rekap_harian_terpadu.ringkasan; agregat SQL atas SEMUA baris, bukan halaman). */
export function petaRingkasanHarian(r: unknown): RingkasanHarian {
  const o = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>;
  const per = Array.isArray(o.per_unit) ? (o.per_unit as Record<string, unknown>[]) : [];
  return {
    jumlah: angka(o.jumlah),
    tatap_muka: angka(o.tatap_muka),
    live_chat: angka(o.live_chat),
    per_unit: per.map((u) => ({ nama: String(u.nama ?? ''), jumlah: angka(u.jumlah) })),
  };
}

// ---------------------------------------------------------------------------
// Kolom Data Pelayanan (tabel + Excel). Pendataan Khusus Fase 4 ditempel lewat `tambahan`.
// ---------------------------------------------------------------------------

export type NilaiSel = string | number | null;

export interface KolomData {
  kunci: string;
  judul: string;
  ambil: (r: BarisPelayanan) => NilaiSel;
}

const isian = (r: BarisPelayanan, kunci: string): NilaiSel => {
  const v = r.pendataan?.[kunci];
  if (v == null) return null;
  return typeof v === 'number' || typeof v === 'string' ? v : String(v);
};

export function labelHasil(hasil: string | null): string {
  if (!hasil) return '';
  return LABEL_HASIL_PENANGANAN[hasil as HasilPenanganan] ?? hasil;
}

export const KOLOM_PENDATAAN_UMUM: KolomData[] = [
  { kunci: 'tanggal', judul: 'Tanggal', ambil: (r) => (r.tanggal ? formatTanggalId(r.tanggal) : '') },
  { kunci: 'unit', judul: 'Unit', ambil: (r) => namaUnit(r) },
  { kunci: 'kanal', judul: 'Kanal', ambil: (r) => LABEL_KANAL[r.kanal] },
  { kunci: 'nomor_tiket', judul: 'Nomor Tiket', ambil: (r) => r.nomor_tiket },
  { kunci: 'penangan', judul: 'Petugas', ambil: (r) => r.penangan_nama },
  { kunci: 'fo', judul: 'Front Office', ambil: (r) => r.fo_nama },
  { kunci: 'nama', judul: 'Nama Pengunjung', ambil: (r) => r.pengunjung_nama },
  { kunci: 'hp', judul: 'No HP', ambil: (r) => r.pengunjung_hp },
  { kunci: 'email', judul: 'Email', ambil: (r) => r.pengunjung_email },
  { kunci: 'instansi', judul: 'Asal Instansi', ambil: (r) => r.pengunjung_instansi },
  { kunci: 'kategori', judul: 'Kategori', ambil: (r) => r.pengunjung_kategori },
  { kunci: 'keperluan', judul: 'Keperluan', ambil: (r) => r.keperluan },
  { kunci: 'topik', judul: 'Topik', ambil: (r) => r.topik ?? '(tidak tercatat)' },
  { kunci: 'hasil', judul: 'Hasil', ambil: (r) => labelHasil(r.hasil) },
  { kunci: 'catatan', judul: 'Catatan Petugas', ambil: (r) => r.catatan },
  { kunci: 'mulai', judul: 'Mulai', ambil: (r) => formatWaktuId(r.mulai_at) },
  { kunci: 'selesai', judul: 'Selesai', ambil: (r) => formatWaktuId(r.selesai_at) },
  { kunci: 'durasi', judul: 'Durasi (mnt)', ambil: (r) => hitungDurasiMenit(r.mulai_at, r.selesai_at) },
];

export const KOLOM_OSS: KolomData[] = [
  { kunci: 'oss_nama_usaha', judul: '[OSS] Nama Usaha', ambil: (r) => isian(r, 'nama_usaha') },
  { kunci: 'oss_email', judul: '[OSS] Email', ambil: (r) => isian(r, 'email') },
  { kunci: 'oss_tipe', judul: '[OSS] Tipe Pelaku Usaha', ambil: (r) => isian(r, 'tipe_pelaku_usaha') },
  { kunci: 'oss_pm', judul: '[OSS] Status Penanaman Modal', ambil: (r) => isian(r, 'status_penanaman_modal') },
  { kunci: 'oss_lokasi', judul: '[OSS] Lokasi Usaha', ambil: (r) => isian(r, 'lokasi_usaha') },
  { kunci: 'oss_skala', judul: '[OSS] Skala Usaha', ambil: (r) => isian(r, 'skala_usaha') },
  { kunci: 'oss_kbli', judul: '[OSS] KBLI', ambil: (r) => isian(r, 'sektor_usaha_kbli') },
  { kunci: 'oss_tindak', judul: '[OSS] Tindak Lanjut', ambil: (r) => isian(r, 'tindak_lanjut') },
  { kunci: 'oss_uraian', judul: '[OSS] Uraian Solusi', ambil: (r) => isian(r, 'uraian_solusi') },
  { kunci: 'oss_catatan', judul: '[OSS] Catatan Internal', ambil: (r) => isian(r, 'catatan_internal') },
];

export const KOLOM_PERIZINAN: KolomData[] = [
  { kunci: 'per_perusahaan', judul: '[Non OSS] Nama Perusahaan', ambil: (r) => isian(r, 'nama_perusahaan') },
  { kunci: 'per_email', judul: '[Non OSS] Email', ambil: (r) => isian(r, 'email') },
  { kunci: 'per_lokasi', judul: '[Non OSS] Lokasi Usaha', ambil: (r) => isian(r, 'lokasi_usaha') },
  { kunci: 'per_opd', judul: '[Non OSS] OPD Teknis', ambil: (r) => isian(r, 'opd_teknis') },
  { kunci: 'per_uraian', judul: '[Non OSS] Uraian Permohonan', ambil: (r) => isian(r, 'uraian_permohonan') },
  { kunci: 'per_tindak', judul: '[Non OSS] Tindak Lanjut', ambil: (r) => isian(r, 'tindak_lanjut') },
  { kunci: 'per_catatan', judul: '[Non OSS] Catatan Petugas', ambil: (r) => isian(r, 'catatan_petugas') },
];

/**
 * Kolom Data Pelayanan: Pendataan Umum selalu; kolom formulir OSS/Non OSS hanya bila Layanan terpilih memakai
 * formulir itu; `tambahan` = kolom Pendataan Khusus Layanan terpilih (Fase 4), ditempel di akhir.
 */
export function kolomDataPelayanan(formType: FormPendataan | null, tambahan: KolomData[] = []): KolomData[] {
  const khusus = formType === 'oss' ? KOLOM_OSS : formType === 'perizinan' ? KOLOM_PERIZINAN : [];
  return [...KOLOM_PENDATAAN_UMUM, ...khusus, ...tambahan];
}
