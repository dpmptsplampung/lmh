import { idSchema, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
import { queryInput } from '@/lib/umkm-katalog/schemas-g2';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: IdContext) {
  return layaniRpc(idSchema, async () => ({ ...queryInput(request), ...(await context.params) }), 'umkm_baca_nomor',
    b => ({ p_permintaan_id: b.id }));
}
