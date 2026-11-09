import { idSchema, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: IdContext) {
  return layaniRpc(idSchema, () => context.params, 'umkm_detail_tugas', b => ({ p_profil_id: b.id }));
}
