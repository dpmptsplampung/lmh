// Identitas staf untuk route rekap penanganan/performa. Mengikuti pola route rekap yang ada: 401 bila belum masuk
// atau akun tidak aktif; peran dibaca dari tabel `petugas` lewat klien pengguna (RLS).
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StafRekap } from './penanganan';

export type HasilMuatStaf = { ok: true; userId: string; me: StafRekap } | { ok: false };

export async function muatStafRekap(supabase: SupabaseClient): Promise<HasilMuatStaf> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false };
  const { data: me } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  if (!me || me.aktif === false) return { ok: false };
  return { ok: true, userId: user.id, me: { id: me.id, role: me.role, layanan_id: me.layanan_id ?? null } };
}

/** Parameter query dari URL; nilai terakhir menang bila key diulang (skema hanya satu nilai per key). */
export function paramsDariRequest(request: { url: string; nextUrl?: { searchParams: URLSearchParams } }): Record<string, string> {
  const hasil: Record<string, string> = {};
  (request.nextUrl?.searchParams ?? new URL(request.url).searchParams).forEach((v, k) => {
    hasil[k] = v;
  });
  return hasil;
}
