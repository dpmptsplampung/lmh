// src/lib/pelayanan.ts
// Helper bersama untuk fitur Pendataan Pelayanan (OSS & Perizinan DPMPTSP).
// Satu sumber kebenaran untuk deteksi form dan otorisasi — dipakai API route,
// halaman antrian, dan komponen wizard agar tidak ada logika terduplikasi.

import type { FormPelayananType } from '@/lib/types/pelayanan';

/**
 * Menentukan tipe form pendataan dari nama layanan.
 * "Non OSS" harus diperiksa lebih dulu karena juga memuat substring "oss".
 * Selain itu layanan tidak mendukung pendataan teknis.
 */
export function determineFormType(layananNama: string): FormPelayananType | null {
  const norm = layananNama.toLowerCase();
  if (norm.includes('non oss') || norm.includes('perizinan')) return 'perizinan';
  if (norm.includes('oss')) return 'oss';
  return null;
}

/**
 * Apakah layanan dengan nama tersebut mendukung wizard pendataan.
 * Dipakai di UI (halaman antrian) untuk menampilkan tombol Form Pendataan.
 */
export function isLayananPendataan(layananNama: string): boolean {
  return determineFormType(layananNama) !== null;
}

/** Bentuk minimal baris layanan untuk menentukan Formulir Pendataan. */
export interface LayananPendataan {
  nama?: string | null;
  /** Kolom layanan.form_pendataan (migrasi 202610140012). `undefined` = kolom tidak ikut di-select. */
  form_pendataan?: string | null;
}

/**
 * Jenis Formulir Pendataan WAJIB untuk layanan. Sumber kebenaran = kolom DB `layanan.form_pendataan` (ditegakkan
 * layanan_selesai sejak 202610140012; disetel Admin di Kelola Layanan). Bila kolom tidak ikut di-select (undefined),
 * jatuh ke deteksi nama lama (determineFormType) yang juga menjadi nilai awal kolom tersebut.
 */
export function formPendataanLayanan(layanan: LayananPendataan | null | undefined): FormPelayananType | null {
  if (!layanan) return null;
  if (layanan.form_pendataan !== undefined) {
    return layanan.form_pendataan === 'oss' || layanan.form_pendataan === 'perizinan' ? layanan.form_pendataan : null;
  }
  return determineFormType(layanan.nama ?? '');
}

export interface PelayananStaffContext {
  role: string | null;
  layanan_id: string | null;
}

/**
 * Otorisasi akses pendataan: admin & front_office akses semua layanan;
 * petugas hanya untuk tiket pada layanan tempatnya bertugas.
 * Konsisten dengan policy RLS read pada pelayanan_oss / pelayanan_perizinan.
 */
export function canAccessPelayananStaff(
  staff: PelayananStaffContext,
  tiketLayananId: string | null | undefined
): boolean {
  if (staff.role === 'admin' || staff.role === 'front_office') return true;
  if (staff.role === 'petugas' && staff.layanan_id && tiketLayananId) {
    return staff.layanan_id === tiketLayananId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Kepemilikan tiket (migrasi 202610140002_tiket_kepemilikan; aturan CEO: tiket hanya boleh
// diselesaikan oleh orang yang memulainya). Fungsi di bawah hanya untuk TAMPILAN; penegakan
// sebenarnya ada di RPC layanan_mulai / layanan_selesai / admin_ambil_alih dan RLS draf.
// ---------------------------------------------------------------------------

export interface StafKepemilikan {
  id: string | null | undefined;
  role: string | null | undefined;
  layanan_id?: string | null;
}

export interface TiketKepemilikan {
  status: string;
  dilayani_oleh: string | null | undefined;
  layanan_id?: string | null;
  /** Tahap FO yang melahirkan tiket (migrasi 202610140003+). null/undefined = tiket lama (alur visit). */
  penanganan_asal_id?: string | null;
}

/** Admin (semua layanan) atau petugas layanan tiket; Front Office tidak memulai layanan (keputusan CEO 7.1). */
export function bolehMulaiTiket(staf: StafKepemilikan | null, tiket: TiketKepemilikan): boolean {
  if (!staf?.id || tiket.status !== 'menunggu') return false;
  if (staf.role === 'admin') return true;
  return staf.role === 'petugas' && !!staf.layanan_id && staf.layanan_id === tiket.layanan_id;
}

/** Hanya pemilik (dilayani_oleh = pemanggil) tiket berstatus 'dilayani' yang boleh menyelesaikan / mengisi draf. */
export function bolehSelesaikanTiket(staf: StafKepemilikan | null, tiket: TiketKepemilikan): boolean {
  if (!staf?.id || (staf.role !== 'admin' && staf.role !== 'petugas')) return false;
  return tiket.status === 'dilayani' && !!tiket.dilayani_oleh && tiket.dilayani_oleh === staf.id;
}

/** Jalur darurat: Admin mengambil alih tiket 'dilayani' milik orang lain (atau tanpa pemilik tercatat). */
export function bolehAmbilAlihTiket(staf: StafKepemilikan | null, tiket: TiketKepemilikan): boolean {
  if (!staf?.id || staf.role !== 'admin') return false;
  return tiket.status === 'dilayani' && tiket.dilayani_oleh !== staf.id;
}

/** Tiket hasil eskalasi Front Office (punya tahap asal). Tiket lama (alur visit) tidak. */
export function tiketHasilEskalasi(tiket: Pick<TiketKepemilikan, 'penanganan_asal_id'>): boolean {
  return !!tiket.penanganan_asal_id;
}

/** "Kembalikan ke FO" (layanan_kembalikan): hanya pemilik tiket hasil eskalasi yang sedang dilayani. */
export function bolehKembalikanTiket(staf: StafKepemilikan | null, tiket: TiketKepemilikan): boolean {
  return tiketHasilEskalasi(tiket) && bolehSelesaikanTiket(staf, tiket);
}

/** "Alihkan" (admin_alihkan): hanya Admin, tiket hasil eskalasi berstatus menunggu/dilayani. */
export function bolehAlihkanTiket(staf: StafKepemilikan | null, tiket: TiketKepemilikan): boolean {
  if (!staf?.id || staf.role !== 'admin') return false;
  return tiketHasilEskalasi(tiket) && (tiket.status === 'menunggu' || tiket.status === 'dilayani');
}

export const MIN_ALASAN_AMBIL_ALIH = 5;
/** admin_alihkan: alasan 5-500 karakter (kontrak §3.5). */
export const MIN_ALASAN_ALIHKAN = 5;
export const MAX_ALASAN_ALIHKAN = 500;
/** layanan_selesai / layanan_kembalikan: catatan petugas layanan 1-1000 karakter (kontrak §3.2-3.3). */
export const MAX_CATATAN_LAYANAN = 1000;

export type KodeGalatAntrean =
  | 'SUDAH_DIAMBIL'
  | 'BUKAN_PEMILIK'
  | 'INVALID_STATUS'
  | 'DIVERGENSI'
  | 'SESI_TIDAK_SAH'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'ALASAN_WAJIB'
  | 'TRANSISI_LEWAT_RPC'
  | 'LOCKED'
  | 'INVALID_FORM'
  | 'INVALID_PAYLOAD'
  // Alur eskalasi FO (migrasi 202610140004): topik/catatan penanganan, tiket lama, alih layanan.
  | 'TOPIK_WAJIB'
  | 'TOPIK_TIDAK_VALID'
  | 'CATATAN_WAJIB'
  | 'CATATAN_TERLALU_PANJANG'
  | 'TIKET_LAMA'
  | 'LAYANAN_SAMA'
  | 'LAYANAN_TIDAK_VALID'
  // Perbaikan review (migrasi 202610140012): antrean tanggal lain, layanan tujuan alih libur/tutup.
  | 'BUKAN_HARI_INI'
  | 'LAYANAN_TIDAK_BUKA'
  | 'LAYANAN_TUTUP';

const POLA_GALAT_ANTREAN =
  /\b(SUDAH_DIAMBIL|BUKAN_PEMILIK|INVALID_STATUS|DIVERGENSI|SESI_TIDAK_SAH|NOT_FOUND|FORBIDDEN|ALASAN_WAJIB|TRANSISI_LEWAT_RPC|LOCKED|INVALID_FORM|INVALID_PAYLOAD|TOPIK_WAJIB|TOPIK_TIDAK_VALID|CATATAN_WAJIB|CATATAN_TERLALU_PANJANG|TIKET_LAMA|LAYANAN_SAMA|LAYANAN_TIDAK_VALID|BUKAN_HARI_INI|LAYANAN_TIDAK_BUKA|LAYANAN_TUTUP)\b/;

/** Pesan siap tampil per kode galat RPC antrean (tanpa detail teknis). */
export const PESAN_GALAT_ANTREAN: Record<KodeGalatAntrean, string> = {
  SUDAH_DIAMBIL: 'Tiket ini sudah ditangani petugas lain.',
  BUKAN_PEMILIK: 'Tiket ini sedang dilayani petugas lain. Hanya petugas yang memulai yang dapat mengubah atau menyelesaikannya.',
  INVALID_STATUS: 'Status tiket sudah berubah.',
  DIVERGENSI: 'Data antrean tidak sinkron sehingga tidak ada perubahan yang disimpan. Hubungi Admin.',
  SESI_TIDAK_SAH: 'Sesi Anda sudah tidak berlaku (masuk di perangkat lain atau terlalu lama tidak aktif). Silakan masuk kembali.',
  NOT_FOUND: 'Tiket tidak ditemukan.',
  FORBIDDEN: 'Anda tidak berwenang melakukan aksi ini pada tiket ini.',
  ALASAN_WAJIB: `Alasan wajib diisi (minimal ${MIN_ALASAN_AMBIL_ALIH} karakter).`,
  TRANSISI_LEWAT_RPC: 'Halaman ini masih versi lama. Muat ulang halaman lalu coba lagi.',
  LOCKED: 'Data pelayanan sudah terkunci dan tidak dapat diubah.',
  INVALID_FORM: 'Jenis formulir pendataan tidak dikenal.',
  INVALID_PAYLOAD: 'Semua field pendataan wajib diisi (isi "Belum ada" / "Tidak berlaku" bila tidak ada, atau "-" untuk catatan).',
  TOPIK_WAJIB: 'Topik penanganan wajib dipilih.',
  TOPIK_TIDAK_VALID: 'Topik yang dipilih tidak valid atau sudah dinonaktifkan. Pilih topik lain.',
  CATATAN_WAJIB: `Catatan wajib diisi (1-${MAX_CATATAN_LAYANAN} karakter).`,
  CATATAN_TERLALU_PANJANG: `Catatan terlalu panjang (maksimal ${MAX_CATATAN_LAYANAN} karakter).`,
  TIKET_LAMA: 'Tiket ini berasal dari alur lama (bukan eskalasi Front Office), sehingga aksi ini tidak berlaku.',
  LAYANAN_SAMA: 'Layanan tujuan sama dengan layanan tiket saat ini. Pilih layanan lain.',
  LAYANAN_TIDAK_VALID: 'Layanan tujuan tidak valid atau sedang tidak aktif.',
  BUKAN_HARI_INI: 'Tiket ini bukan antrean hari ini sehingga tidak dapat dimulai. Muat ulang daftar antrean.',
  LAYANAN_TIDAK_BUKA: 'Layanan tujuan tidak beroperasi hari ini (libur atau di luar jadwal). Pilih layanan lain.',
  LAYANAN_TUTUP: 'Layanan hari ini sudah tutup, sehingga tiket tidak dapat dialihkan.',
};

/** Kode galat dari pesan error database/RPC (awalan `KODE:`), atau null bila bukan galat antrean yang dikenal. */
export function kodeGalatAntrean(pesan: string | null | undefined): KodeGalatAntrean | null {
  if (typeof pesan !== 'string') return null;
  return (pesan.match(POLA_GALAT_ANTREAN)?.[1] as KodeGalatAntrean | undefined) ?? null;
}

/**
 * Kode galat antrean dari error apa pun yang dilempar helper mutasi (`MutasiError.asal.message`)
 * atau objek error PostgREST (`{ message }`).
 */
export function kodeGalatDariError(e: unknown): KodeGalatAntrean | null {
  if (typeof e !== 'object' || e === null) return null;
  const asal = (e as { asal?: unknown }).asal;
  const sumber = typeof asal === 'object' && asal !== null ? asal : e;
  const pesan = (sumber as { message?: unknown }).message;
  return kodeGalatAntrean(typeof pesan === 'string' ? pesan : null);
}
