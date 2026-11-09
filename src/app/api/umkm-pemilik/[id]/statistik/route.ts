import { queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { idSchema, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: IdContext) {
  return layaniRpc(idSchema, async () => ({ ...queryInput(request), ...(await context.params) }),
    'umkm_statistik_pemilik', b => ({ p_profil_id: b.id }));
}
