import { MutasiError } from '@/lib/supabase/mutate';

/**
 * Setelah mutasi gagal karena RLS menolak (`ditolak`) atau baris tak ada/tak boleh disentuh
 * (`tidak_ada_baris`), tampilan klien kemungkinan basi (data sudah berubah, atau hak akses
 * berbeda dari anggapan UI) -> pemanggil sebaiknya memuat ulang datanya. Gangguan jaringan atau
 * galat database biasa tidak menandakan data basi, jadi tidak perlu muat ulang.
 */
export function perluMuatUlang(e: unknown): boolean {
  return e instanceof MutasiError && (e.kode === 'ditolak' || e.kode === 'tidak_ada_baris');
}
