// Bantuan datalist asal/instansi untuk formulir walk-in FO: menyarankan asal/instansi yang sering dipakai. Pengenalan
// pengunjung lama (nama/HP) kini lewat RPC terkendali `fo_cari_pengunjung` (`cari-pengunjung.ts`, Fase 6). Fitur PEMBANTU:
// semua kegagalan ditelan dan menghasilkan daftar kosong.
import type { SupabaseClient } from '@supabase/supabase-js';

type KlienBaca = Pick<SupabaseClient, 'from'>;

const teks = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Asal/instansi yang paling baru dipakai (unik tanpa membedakan huruf besar/kecil), untuk datalist. */
export async function muatAsalSering(supabase: KlienBaca, batas = 50): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('kunjungan')
      .select('asal_instansi')
      .not('asal_instansi', 'is', null)
      .order('created_at', { ascending: false })
      .limit(batas * 8);
    if (error || !Array.isArray(data)) return [];
    const lihat = new Set<string>();
    const hasil: string[] = [];
    for (const baris of data as Array<{ asal_instansi?: unknown }>) {
      const a = teks(baris.asal_instansi);
      const kunci = a.toLowerCase();
      if (a.length < 3 || lihat.has(kunci)) continue;
      lihat.add(kunci);
      hasil.push(a);
      if (hasil.length >= batas) break;
    }
    return hasil;
  } catch {
    return [];
  }
}
