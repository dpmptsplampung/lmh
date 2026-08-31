// src/lib/pelayanan.ts
// Helper bersama untuk fitur Pendataan Pelayanan (OSS & Perizinan DPMPTSP).
// Satu sumber kebenaran untuk deteksi form dan otorisasi — dipakai API route,
// halaman antrian, dan komponen wizard agar tidak ada logika terduplikasi.

import type { FormPelayananType } from '@/lib/types/pelayanan';

/**
 * Menentukan tipe form pendataan dari nama layanan.
 * Layanan yang mengandung "oss" → form OSS, mengandung "perizinan" → form Perizinan.
 * Selain itu layanan tidak mendukung pendataan teknis.
 */
export function determineFormType(layananNama: string): FormPelayananType | null {
  const norm = layananNama.toLowerCase();
  if (norm.includes('oss')) return 'oss';
  if (norm.includes('perizinan')) return 'perizinan';
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
