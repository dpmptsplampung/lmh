import type { SupabaseClient } from '@supabase/supabase-js';

// Hak draf diperiksa ulang lewat JWT pengguna; flag hilang atau sesi gagal selalu menolak.
export async function bolehUnggahDraf(
  client: Pick<SupabaseClient, 'from' | 'rpc'>,
  user: { id: string; is_anonymous?: boolean },
): Promise<boolean> {
  if (user.is_anonymous) return false;
  try {
    const { data: staf, error } = await client.from('petugas')
      .select('role, aktif, pemeriksa_umkm').eq('auth_user_id', user.id).maybeSingle();
    if (error || !staf || staf.aktif !== true || staf.pemeriksa_umkm !== true ||
      !['admin', 'petugas'].includes(staf.role)) return false;
    const sesi = await client.rpc('sesi_valid');
    return !sesi.error && sesi.data === true;
  } catch { return false; }
}
