// Konteks undangan survei untuk halaman publik /survei/<token>: membungkus RPC anon `get_survei_context`
// (migrasi 202611020003, hanya MEMBACA, tanpa identitas). Modul murni: tidak menyentuh DOM atau env.
import type { SupabaseClient } from '@supabase/supabase-js';

export type StatusKonteks = 'ok' | 'kedaluwarsa' | 'sudah_diisi' | 'tidak_valid';

export type KonteksSurvei = {
  status: StatusKonteks;
  unit: 'layanan' | 'fo' | null;
  layananNama: string | null;
  kedaluwarsaPada: string | null;
};

const STATUS_DIKENAL: readonly StatusKonteks[] = ['ok', 'kedaluwarsa', 'sudah_diisi', 'tidak_valid'];

function adalahObjek(nilai: unknown): nilai is Record<string, unknown> {
  return typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);
}

const teksAtauNull = (nilai: unknown): string | null => (typeof nilai === 'string' ? nilai : null);

/**
 * Mengambil status undangan. Galat jaringan/RPC dan bentuk hasil yang tidak dikenal MELEMPAR: pemanggil menampilkan
 * ErrorRetry, bukan "tautan tidak dikenali" (supabase-js tidak melempar, jadi `{ error }` diubah menjadi lemparan di sini).
 */
export async function ambilKonteks(supabase: Pick<SupabaseClient, 'rpc'>, token: string): Promise<KonteksSurvei> {
  const { data, error } = await supabase.rpc('get_survei_context', { p_token: token });
  if (error) throw new Error('Gagal memuat konteks survei');

  if (!adalahObjek(data) || !STATUS_DIKENAL.includes(data.status as StatusKonteks)) {
    throw new Error('Bentuk konteks survei tidak dikenal');
  }
  return {
    status: data.status as StatusKonteks,
    // Unit lain (mis. tidak_diketahui) bukan sesuatu yang bisa dinilai pengunjung: dianggap tidak ada.
    unit: data.unit === 'layanan' || data.unit === 'fo' ? data.unit : null,
    layananNama: teksAtauNull(data.layanan_nama),
    kedaluwarsaPada: teksAtauNull(data.kedaluwarsa_pada),
  };
}
