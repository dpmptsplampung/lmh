import { z } from 'zod';
import { queryInput } from '@/lib/umkm-katalog/schemas-g2';
import { layaniPublik } from '@/lib/umkm-katalog/publik-server';
import type { IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
const schema = z.object({ id: z.uuid() }).strict();
export async function GET(request: Request, context: IdContext) {
  return layaniPublik(schema, async () => ({ ...queryInput(request), ...(await context.params) }),
    'umkm_profil_publik', b => ({ p_profil_id: b.id }), false);
}
