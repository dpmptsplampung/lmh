import { z } from 'zod';
import { cursorOpaqueSchema, queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
const schema = cursorOpaqueSchema.extend({ id: z.uuid() });
export async function GET(request: Request, context: IdContext) {
  return layaniRpc(schema, async () => ({ ...queryInput(request), ...(await context.params) }),
    'umkm_perusahaan_penerima', b => ({ p_profil_id: b.id, p_cursor: b.cursor ?? null }));
}
