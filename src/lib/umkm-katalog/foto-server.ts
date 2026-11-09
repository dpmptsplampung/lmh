import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';
import { copyObject, deleteObjects, headObject, r2Tersedia, bucketTerpisah, urlPublik } from '@/lib/storage/r2';
import type { Detail, FotoPublikasi, Mutasi } from './types';

export function invalidasiKatalog() {
  try { revalidateTag('umkm-katalog', { expire: 0 }); } catch { /* TTL tetap membatasi umur kartu. */ }
}
export async function hapusFotoPublik(client: SupabaseClient, id: string): Promise<number> {
  try {
    const { data, error } = await client.rpc('umkm_antrian_hapus_foto', { p_profil_id: id });
    if (error) return 1;
    const items = (data?.items ?? []) as { id: string; r2_key_publik: string }[];
    const total = data?.total ?? items.length;
    if (!r2Tersedia()) return total;
    let tertunda = Math.max(0, total - items.length);
    for (const item of items) {
      try { await deleteObjects('public', [item.r2_key_publik]); }
      catch { tertunda++; continue; }
      // FO dapat menghapus objek, tetapi penutupan antrean tetap pekerjaan pemeriksa.
      try {
        const { error: selesaiError } = await client.rpc('umkm_selesai_hapus_foto', { p_id: item.id });
        if (selesaiError && selesaiError.code !== '42501' && selesaiError.message !== 'DILARANG') tertunda++;
      }
      catch { tertunda++; }
    }
    return tertunda;
  } catch { return 1; }
}
export async function publikasiFoto(client: SupabaseClient, id: string): Promise<FotoPublikasi> {
  const { data, error } = await client.rpc('umkm_detail_tugas', { p_profil_id: id });
  if (error || !data) return { status: 'tertunda', tertunda: 0, hapus_tertunda: 1 };
  const detail = data as Detail;
  const foto = (detail.foto_disetujui ?? detail.foto).filter(f =>
    f.asal === 'unggahan' && !f.tersembunyi && !f.perlu_review && !f.r2_key_publik);
  if (!detail.dipegang_saya) throw new Error('DILARANG');
  let tertunda = foto.length;
  if (r2Tersedia() && bucketTerpisah() && detail.status === 'terbit') for (const f of foto) {
    try {
      if (!f.r2_key || !/^umkm-draf\/(?:[a-f0-9-]{36}\/)?[a-f0-9-]{36}\.(jpg|png|webp)$/.test(f.r2_key)) continue;
      const head = await headObject('private', f.r2_key);
      const ekstensi = f.r2_key.split('.').at(-1)!;
      const tipe = ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' })[ekstensi];
      if (!head?.etag || head.size < 1 || head.size > 2097152 || head.contentType !== tipe) continue;
      const bukti = await client.rpc('umkm_bukti_foto', { p_profil_id: id, p_foto_id: f.id,
        p_etag: head.etag, p_ukuran: head.size, p_tipe: head.contentType });
      if (bukti.error) continue;
      const keyBaru = `umkm-katalog/${crypto.randomUUID()}.${ekstensi}`;
      const rencana = await client.rpc('umkm_rencana_foto', { p_profil_id: id, p_foto_id: f.id,
        p_r2_key_publik: keyBaru });
      if (rencana.error) continue;
      await copyObject('private', f.r2_key, 'public', keyBaru, head.etag);
      const taut = await client.rpc('umkm_terbitkan_foto', { p_profil_id: id, p_foto_id: f.id,
        p_etag: head.etag, p_r2_key_publik: keyBaru, p_url_publik: urlPublik(keyBaru) });
      if (taut.error) throw new Error('Salinan belum ditautkan');
      tertunda--;
    } catch { /* Rencana tersimpan dibersihkan antrean sesudah masa tunggu. */ }
  }
  // Salinan baru ditautkan dahulu agar antrean lama tidak menghilangkan foto pengganti.
  const hapus_tertunda = await hapusFotoPublik(client, id);
  invalidasiKatalog();
  return { status: tertunda || hapus_tertunda ? 'tertunda' : 'selesai', tertunda, hapus_tertunda };
}
export async function setelahPutusan(data: Mutasi, client: SupabaseClient): Promise<Mutasi> {
  invalidasiKatalog();
  try {
    return data.status === 'terbit' ? { ...data, foto_publikasi: await publikasiFoto(client, data.id) } : data;
  } catch { return { ...data, foto_publikasi: { status: 'tertunda', tertunda: 0, hapus_tertunda: 1 } }; }
}
export async function setelahVisibilitas<T extends { id: string }>(
  data: T, client: SupabaseClient,
): Promise<T & { foto_publikasi: FotoPublikasi }> {
  invalidasiKatalog();
  const hapus_tertunda = await hapusFotoPublik(client, data.id);
  return { ...data, foto_publikasi: {
    status: hapus_tertunda ? 'tertunda' : 'selesai', tertunda: 0, hapus_tertunda,
  } };
}
