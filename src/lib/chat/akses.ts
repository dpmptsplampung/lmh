// Lingkup baca chat staf di route handler (Fase 5, K3). Route chat memakai service-role (melewati RLS), jadi lingkup
// ditegakkan di sini lewat RPC boleh_chat_sesi dengan JWT PENGGUNA (klien server berkuki): satu sumber kebenaran dengan
// policy RLS chat_sesi/chat_pesan. Sebelum migrasi 202610310001 diterapkan: aturan TS lama (`fallback`).
import type { SupabaseClient } from '@supabase/supabase-js';
import { objekBelumAda } from '@/lib/akses-data/galat';

export async function bolehAksesSesiStaf(
  userClient: SupabaseClient,
  sesiId: string,
  fallback: () => boolean,
): Promise<boolean> {
  // Klien tanpa rpc (tiruan uji lama): aturan lama. Galat jaringan/DB lain = TOLAK (gagal tertutup).
  if (typeof (userClient as { rpc?: unknown }).rpc !== 'function') return fallback();
  try {
    const { data, error } = await userClient.rpc('boleh_chat_sesi', { p_sesi: sesiId });
    if (!error) return data === true;
    if (objekBelumAda(error)) return fallback();
    return false;
  } catch {
    return false;
  }
}

/**
 * Izin riwayat LINTAS SESI untuk staf (RPC chat_boleh_riwayat, review Fase 5 A1): admin, FO Koordinator, atau petugas
 * Layanan jangkar yang Koordinator/penangan kini. true = boleh memuat semua sesi percakapan; false = hanya sesi yang
 * boleh dibaca RLS (muat dengan klien berJWT pengguna); null = RPC belum ada (migrasi belum diterapkan: perilaku lama).
 * Galat lain = false (gagal tertutup).
 */
export async function bolehRiwayatPenuh(userClient: SupabaseClient, sesiId: string): Promise<boolean | null> {
  if (typeof (userClient as { rpc?: unknown }).rpc !== 'function') return null;
  try {
    const { data, error } = await userClient.rpc('chat_boleh_riwayat', { p_sesi: sesiId });
    if (!error) return data === true;
    if (objekBelumAda(error)) return null;
    return false;
  } catch {
    return false;
  }
}
