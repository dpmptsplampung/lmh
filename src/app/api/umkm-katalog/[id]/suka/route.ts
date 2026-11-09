import { z } from 'zod';
import { idSchema, inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
const sukaSchema = idSchema.extend({ aktif: z.boolean() });
export async function GET(_request: Request, context: IdContext) {
  return layaniRpc(idSchema, () => context.params, 'umkm_status_suka', b => ({ p_profil_id: b.id }));
}
export async function POST(request: Request, context: IdContext) {
  return layaniRpc(sukaSchema, () => inputAksi(request, context), 'umkm_suka', b => ({
    p_profil_id: b.id, p_aktif: b.aktif,
  }));
}
