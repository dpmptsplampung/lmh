import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { publikasiFoto } from '@/lib/umkm-katalog/foto-server';
import { galat, headersPrivat, inputAksi, kodeRpc, type IdContext } from '@/lib/umkm-katalog/server';
export const dynamic = 'force-dynamic';
const schema = z.object({ id: z.uuid() }).strict();
export async function POST(request: Request, context: IdContext) {
  const requestId = crypto.randomUUID();
  try {
    const client = await createClient();
    const { data: { user }, error } = await client.auth.getUser();
    if (error || !user) return galat('LOGIN_DIPERLUKAN', requestId);
    const parsed = schema.safeParse(await inputAksi(request, context));
    if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const detail = await client.rpc('umkm_detail_tugas', { p_profil_id: parsed.data.id });
    if (detail.error) return galat(kodeRpc(detail.error), requestId);
    if (!detail.data) return galat('TIDAK_DITEMUKAN', requestId);
    if (!detail.data.dipegang_saya) return galat('DILARANG', requestId);
    const foto = await publikasiFoto(client, parsed.data.id);
    return Response.json({ data: { id: parsed.data.id, foto_publikasi: foto }, meta: { request_id: requestId } },
      { headers: headersPrivat });
  } catch (error) {
    return galat(error instanceof Error && error.message === 'INPUT_TIDAK_VALID'
      ? 'INPUT_TIDAK_VALID' : 'GAGAL_INTERNAL', requestId);
  }
}
