import { z } from 'zod';
import { versiSchema } from '@/lib/umkm-katalog/schemas';
import { inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
import { setelahVisibilitas } from '@/lib/umkm-katalog/foto-server';
export const dynamic = 'force-dynamic';
const schema = versiSchema.extend({ id: z.uuid() });
export async function POST(request: Request, context: IdContext) {
  return layaniRpc(schema, () => inputAksi(request, context), 'umkm_selesaikan_mendesak', b => ({
    p_profil_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
  }), setelahVisibilitas);
}
