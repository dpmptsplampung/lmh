import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { ubahStatusMinatSchema } from '@/lib/investasi/skema-minat';
import { bacaJson, galat, headersPrivat, kodeRpc } from '@/lib/investasi/http';

export const dynamic = 'force-dynamic';

const hasilSchema = ubahStatusMinatSchema.extend({ id: z.uuid() });

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const requestId = crypto.randomUUID();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return galat('INPUT_TIDAK_VALID', requestId);
  let body: unknown;
  try { body = await bacaJson(request); }
  catch { return galat('INPUT_TIDAK_VALID', requestId); }
  const parsed = ubahStatusMinatSchema.safeParse(body);
  if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return galat('LOGIN_DIPERLUKAN', requestId);
    const akses = await client.rpc('boleh_kelola_investasi');
    if (akses.error) return galat(kodeRpc(akses.error), requestId);
    if (akses.data !== true) return galat('DILARANG', requestId);
    const { data, error } = await client.rpc('investasi_ubah_status_minat', {
      p_id: id, p_status: parsed.data.status, p_versi: parsed.data.versi,
    });
    if (error) return galat(kodeRpc(error), requestId);
    const hasil = hasilSchema.safeParse(data);
    if (!hasil.success) return galat('GAGAL_INTERNAL', requestId);
    return Response.json({ data: hasil.data }, { headers: headersPrivat });
  } catch {
    return galat('GAGAL_INTERNAL', requestId);
  }
}
