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

export const MIN_ALASAN_AMBIL_ALIH = 5;

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
  | 'INVALID_FORM';

const POLA_GALAT_ANTREAN =
  /\b(SUDAH_DIAMBIL|BUKAN_PEMILIK|INVALID_STATUS|DIVERGENSI|SESI_TIDAK_SAH|NOT_FOUND|FORBIDDEN|ALASAN_WAJIB|TRANSISI_LEWAT_RPC|LOCKED|INVALID_FORM)\b/;

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
