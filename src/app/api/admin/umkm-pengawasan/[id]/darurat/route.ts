import { z } from 'zod';
import { daruratSchema } from '@/lib/umkm-katalog/schemas-g2';
import { inputAksi, layaniRpc, type IdContext } from '@/lib/umkm-katalog/server';
import { setelahVisibilitas } from '@/lib/umkm-katalog/foto-server';
export const dynamic = 'force-dynamic';
const schema = daruratSchema.extend({ id: z.uuid() });
export async function POST(request: Request, context: IdContext) {
  return layaniRpc(schema, () => inputAksi(request, context), 'umkm_tindakan_darurat', b => ({
    p_profil_id: b.id, p_aksi: b.aksi, p_alasan: b.alasan,
    p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
  }), setelahVisibilitas);
}
