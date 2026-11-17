import type { SupabaseClient } from '@supabase/supabase-js';
import { muatFieldKhusus } from './khususServer';
import type { LayananEkspor } from './exportTerpadu';

/** Referensi dibatasi lingkup RPC yang sama dengan rekap, termasuk layanan tanpa baris pada periode ini. */
export async function muatLayananEkspor(supabase: SupabaseClient, tanpaForm: boolean): Promise<LayananEkspor[]> {
  const { data: lingkup, error: galatLingkup } = await supabase.rpc('lingkup_layanan_saya');
  if (galatLingkup) throw galatLingkup;
  const batas = (lingkup as { semua: boolean; layanan_id: string | null }[] | null)?.[0];
  if (!batas) throw new Error('FORBIDDEN: tidak ada lingkup layanan');
  if (!batas.semua && !batas.layanan_id) return [];
  const daftar: LayananEkspor[] = [];
  for (let offset = 0; ;) {
    let qb = supabase.from('layanan').select('id, nama, form_pendataan').order('id').range(offset, offset + 499);
    if (!batas.semua) qb = qb.eq('id', batas.layanan_id);
    if (tanpaForm) qb = qb.is('form_pendataan', null);
    const { data, error } = await qb;
    if (error) throw error;
    const halaman = (data ?? []) as Omit<LayananEkspor, 'fields'>[];
    daftar.push(...halaman.map(l => ({ ...l, fields: [] })));
    if (!halaman.length) break;
    offset += halaman.length;
  }
  // Maksimum empat kueri definisi serentak, tanpa ledakan koneksi bila katalog bertambah.
  for (let i = 0; i < daftar.length; i += 4) await Promise.all(daftar.slice(i, i + 4).map(async l => {
    l.fields = await muatFieldKhusus(supabase, l.id, { semuaHalaman: true });
  }));
  return daftar;
}
