// Lingkup rekap untuk TAMPILAN (G3, migrasi 202611160001): Petugas = seluruh Layanannya (semua petugas di Layanan itu),
// Front Office = semua Layanan, Admin = penuh. Penanda Koordinator tidak lagi memengaruhi lingkup baca. Penegakan ada di
// RPC rekap (lingkup_layanan_saya()); fungsi di sini hanya menentukan label dan pilihan filter. Murni, tanpa I/O.
import type { UnitRekap } from './terpadu';

export interface OpsiLayananRekap {
  id: string;
  nama: string;
  form_pendataan: string | null;
}

export interface LingkupRekap {
  role?: string;
  layanan_nama?: string | null;
}

export interface InfoRekap {
  lingkup?: LingkupRekap | null;
  label: string;
  opsi_layanan: OpsiLayananRekap[];
  unit_opsi: UnitRekap[];
}

/** Admin dan Front Office melihat rekap semua Layanan (tombol rekap lengkap, pilihan semua Layanan). */
export function lingkupSemuaLayanan(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'front_office';
}

/** Kalimat lingkup di atas rekap. Tanpa peran yang dikenal: label dari server dipertahankan. */
export function labelLingkupRekap(info: Pick<InfoRekap, 'lingkup' | 'label'>): string {
  const l = info.lingkup;
  if (l?.role === 'admin') return 'Anda melihat data semua Layanan (Admin).';
  if (l?.role === 'front_office') return 'Anda melihat data semua Layanan (Front Office, hanya baca).';
  if (l?.role === 'petugas') {
    return `Anda melihat seluruh data Layanan ${l.layanan_nama ?? 'Anda'} (semua petugas di Layanan ini).`;
  }
  return info.label;
}

/**
 * Pilihan unit dan Layanan yang dipakai UI. Front Office kini semua Layanan: bila server (lama) hanya mengirim unit
 * Front Office tanpa daftar Layanan, dilengkapi dari `semuaLayanan` (referensi bersama). Peran lain apa adanya.
 */
export function lingkupEfektif(info: InfoRekap, semuaLayanan: readonly OpsiLayananRekap[] | null | undefined): InfoRekap {
  if (info.lingkup?.role !== 'front_office') return info;
  const opsi = info.opsi_layanan.length > 0 ? info.opsi_layanan : [...(semuaLayanan ?? [])];
  const unit: UnitRekap[] = opsi.length > 0 || info.unit_opsi.includes('layanan') ? ['fo', 'layanan'] : info.unit_opsi;
  return { ...info, opsi_layanan: opsi, unit_opsi: unit };
}

/** Pilihan "Layanan" ditampilkan hanya bila ada lebih dari satu pilihan: Petugas satu Layanan tidak punya pilihan lain. */
export function perluPilihanLayanan(opsi: readonly unknown[]): boolean {
  return opsi.length > 1;
}
