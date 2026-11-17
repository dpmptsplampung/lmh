// Daftar Layanan untuk halaman Kelola Akun, beserta kolom `modul` (query di luar page.tsx; pagar anggaran kode).
import { createClient } from '@/lib/supabase/client';

/**
 * Daftar Layanan beserta `modul` (migrasi 202611160001). Sebelum migrasi diterapkan kolom `modul` belum ada: kueri diulang
 * tanpa kolom itu (modul null) agar nama Layanan tetap tampil; galat lain menghasilkan daftar kosong seperti sebelumnya.
 */
export async function muatLayananDenganModul(): Promise<{ daftar: { id: string; nama: string; modul: string | null }[] }> {
  const sb = createClient();
  const penuh = await sb.from('layanan').select('id, nama, modul').order('nama');
  if (!penuh.error) return { daftar: (penuh.data ?? []) as { id: string; nama: string; modul: string | null }[] };
  const lama = await sb.from('layanan').select('id, nama').order('nama');
  return { daftar: ((lama.data ?? []) as { id: string; nama: string }[]).map((l) => ({ ...l, modul: null })) };
}
