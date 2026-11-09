import { z } from 'zod';
import { flagSchema } from '@/lib/umkm-katalog/schemas';
import { inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
const schema = flagSchema.extend({ id: z.uuid() });
export async function PATCH(request: Request, context: IdContext) {
  return layaniRpc(schema, () => inputAksi(request, context), 'umkm_atur_pemeriksa', b => ({
    p_petugas_id: b.id, p_pemeriksa_umkm: b.pemeriksa_umkm, p_operasi_id: b.operasi_id,
  }));
}
