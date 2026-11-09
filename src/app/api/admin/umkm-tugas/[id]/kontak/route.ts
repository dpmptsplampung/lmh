import { idSchema, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function POST(_request: Request, context: IdContext) {
  return layaniRpc(idSchema, () => context.params, 'umkm_akses_kontak_petugas', b => ({ p_profil_id: b.id }));
}
