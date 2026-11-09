import type { SupabaseClient } from '@supabase/supabase-js';
import { profilDrafDariPath } from '@/lib/storage/area';

// Hak draf diperiksa ulang lewat JWT pengguna; flag hilang atau sesi gagal selalu menolak.
export async function bolehUnggahDraf(
  client: Pick<SupabaseClient, 'from' | 'rpc'>,
  user: { id: string; is_anonymous?: boolean },
  path?: string,
): Promise<boolean> {
  if (user.is_anonymous) return false;
  try {
    const { data: staf, error } = await client.from('petugas')
      .select('role, aktif, pemeriksa_umkm').eq('auth_user_id', user.id).maybeSingle();
    if (error) return false;
    if (!staf) {
      const profil = profilDrafDariPath(path);
      if (!profil) return false;
      const hak = await client.rpc('umkm_akses_draf_pemilik', { p_profil_id: profil });
      return !hak.error && hak.data?.diizinkan === true;
    }
    if (staf.aktif !== true || staf.pemeriksa_umkm !== true ||
      !['admin', 'petugas'].includes(staf.role)) return false;
    const sesi = await client.rpc('sesi_valid');
    return !sesi.error && sesi.data === true;
  } catch { return false; }
}
