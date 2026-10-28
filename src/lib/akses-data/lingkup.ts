// Lingkup akses data Fase 3 (spec §6.1, ADR 0003): Koordinator = penanda pada akun FO / Petugas Layanan (bukan role).
// Modul murni untuk UI + pembaca penanda yang aman sebelum migrasi 202610290001 diterapkan (kolom belum ada -> false).
// Penegakan sebenarnya ada di database (RLS + RPC SECURITY DEFINER); fungsi di sini hanya menentukan tampilan tombol/label.
import type { SupabaseClient } from '@supabase/supabase-js';

export type PeranStaf = 'admin' | 'front_office' | 'petugas';

/** Bentuk balasan RPC lingkup_data_saya() (migrasi 202610290002). */
export interface LingkupData {
  petugas_id: string;
  role: PeranStaf;
  koordinator: boolean;
  layanan_id: string | null;
  layanan_nama: string | null;
}

/** true bila akun melihat lebih dari data miliknya sendiri (admin atau Koordinator). */
export function lingkupLuas(l: Pick<LingkupData, 'role' | 'koordinator'>): boolean {
  return l.role === 'admin' || ((l.role === 'front_office' || l.role === 'petugas') && l.koordinator);
}

export function labelLingkup(l: LingkupData): string {
  if (l.role === 'admin') return 'Anda melihat semua data semua Layanan (Admin).';
  if (l.role === 'front_office' && l.koordinator) return 'Anda melihat semua data semua Layanan (Koordinator Front Office).';
  if (l.role === 'petugas' && l.koordinator) return `Semua data Layanan ${l.layanan_nama ?? 'Anda'} (Koordinator).`;
  return 'Hanya data yang Anda tangani sendiri.';
}

export interface StafKoordinator {
  id: string;
  role: string | null;
  layanan_id?: string | null;
  koordinator?: boolean;
}

/** Koordinator Petugas Layanan mengambil alih tiket 'dilayani' milik petugas lain di Layanannya (RPC koordinator_ambil_alih_tiket). */
export function bolehKoordinatorAmbilAlihTiket(
  staf: StafKoordinator | null,
  tiket: { status: string; dilayani_oleh: string | null; layanan_id: string | null },
): boolean {
  if (!staf?.id || staf.role !== 'petugas' || !staf.koordinator || !staf.layanan_id) return false;
  return tiket.status === 'dilayani' && !!tiket.dilayani_oleh && tiket.dilayani_oleh !== staf.id
    && tiket.layanan_id === staf.layanan_id;
}

/** Koordinator FO mengambil alih tahap FO 'berjalan' milik FO lain, bukan chat (RPC koordinator_ambil_alih_fo). */
export function bolehKoordinatorAmbilAlihFo(
  staf: StafKoordinator | null,
  tahap: { status: string; penangan_id?: string | null; saluran: string },
): boolean {
  if (!staf?.id || staf.role !== 'front_office' || !staf.koordinator) return false;
  return tahap.status === 'berjalan' && !!tahap.penangan_id && tahap.penangan_id !== staf.id && tahap.saluran !== 'chat';
}

type KlienBaca = Pick<SupabaseClient, 'from'>;

/** Penanda Koordinator milik petugas; false bila kolom belum ada (migrasi belum diterapkan) atau gagal dibaca. */
export async function muatKoordinator(supabase: KlienBaca, petugasId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.from('petugas').select('koordinator').eq('id', petugasId).maybeSingle();
    if (error || !data) return false;
    return (data as { koordinator?: unknown }).koordinator === true;
  } catch {
    return false;
  }
}
