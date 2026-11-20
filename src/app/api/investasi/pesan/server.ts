import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import {
  pesanDokumenSchema, pesanIproSchema,
} from '@/lib/investasi/skema-minat';
import { VERSI_KEBIJAKAN_INVESTASI } from '@/lib/investasi/konstanta';
import { bacaJson, galat, headersPrivat, kodeRpc } from '@/lib/investasi/http';

const tandaTerimaSchema = z.object({ id: z.uuid() });

export async function kirimMinat(request: Request, kanal: 'ipro' | 'dokumen') {
  const requestId = crypto.randomUUID();
  let body: unknown;
  try { body = await bacaJson(request); }
  catch { return galat('INPUT_TIDAK_VALID', requestId); }
  const parsed = (kanal === 'ipro' ? pesanIproSchema : pesanDokumenSchema).safeParse(body);
  if (!parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
  const input = parsed.data;
  if (input.situs_web) {
    logServerEvent('info', { operation: 'investasi.honeypot' });
    return Response.json({ data: { id: crypto.randomUUID() } }, { status: 201, headers: headersPrivat });
  }
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return galat('LOGIN_DIPERLUKAN', requestId);
    const { data, error } = await client.rpc('investasi_kirim_minat', {
      p_kanal: kanal, p_ref_id: 'ipro_id' in input ? input.ipro_id : input.doc_id,
      p_nama: input.nama, p_email: input.email,
      p_no_hp: 'no_hp' in input ? input.no_hp ?? null : null,
      p_instansi: input.instansi ?? null, p_pesan: input.pesan ?? null,
      p_setuju_pdp: input.setuju_pdp, p_versi_kebijakan: VERSI_KEBIJAKAN_INVESTASI,
      p_operasi_id: input.operasi_id,
    });
    if (error) return galat(kodeRpc(error), requestId);
    const hasil = tandaTerimaSchema.safeParse(data);
    if (!hasil.success) return galat('GAGAL_INTERNAL', requestId);
    return Response.json({ data: hasil.data }, { status: 201, headers: headersPrivat });
  } catch {
    return galat('GAGAL_INTERNAL', requestId);
  }
}
