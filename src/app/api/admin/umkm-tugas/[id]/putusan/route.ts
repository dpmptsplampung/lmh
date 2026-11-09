import { z } from 'zod';
import { putusanSchema } from '@/lib/umkm-katalog/schemas';
import { inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
const schema = putusanSchema.extend({ id: z.uuid() });
export async function POST(request: Request, context: IdContext) {
  return layaniRpc(schema, () => inputAksi(request, context), 'umkm_putuskan_profil', b => ({
    p_profil_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id, p_keputusan: b.keputusan, p_alasan: b.alasan ?? null,
  }));
}
