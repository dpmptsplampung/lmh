import { idSchema, type IdContext } from '@/lib/umkm-katalog/server';
import { layaniPublik } from '@/lib/umkm-katalog/publik-server';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: IdContext) {
  return layaniPublik(idSchema, () => context.params, 'umkm_serupa', b => ({ p_profil_id: b.id }), false);
}
