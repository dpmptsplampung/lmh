import { randomUUID } from 'node:crypto';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { bacaJson, galat, headersPrivat, kodeRpc } from './server';

export function penulisStatistik() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function dikecualikan(request: Request) {
  return /bot|crawler|spider|headless|preview/i.test(request.headers.get('user-agent') ?? '')
    || /prefetch/i.test(`${request.headers.get('purpose')} ${request.headers.get('sec-purpose')}`)
    || request.headers.has('next-router-prefetch');
}
async function identitas(request: Request) {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  const uid = !error && user && !user.is_anonymous ? user.id : null;
  const kandidat = request.headers.get('cookie')?.split(';').map(v => v.trim())
    .find(v => v.startsWith('umkm_statistik='))?.slice('umkm_statistik='.length);
  const lama = z.uuid().safeParse(kandidat);
  return { uid, kunci: uid ?? (lama.success ? lama.data : randomUUID()), baru: !uid && !lama.success };
}
export const beaconSchema = z.object({
  jenis: z.enum(['dilihat', 'klik_formulir']), profil_id: z.uuid(),
}).strict();
export async function layaniStatistik(request: Request) {
  const requestId = randomUUID();
  try {
    const body = beaconSchema.safeParse(await bacaJson(request));
    if (!body.success) return galat('INPUT_TIDAK_VALID', requestId);
    let dicatat = false;
    const response = () => NextResponse.json({ data: { dicatat }, meta: { request_id: requestId } },
      { headers: headersPrivat });
    if (dikecualikan(request)) return response();
    const writer = penulisStatistik();
    if (!writer) return response();
    const actor = await identitas(request);
    const { data, error } = await writer.rpc('umkm_catat_statistik', {
      p_jenis: body.data.jenis, p_profil_id: body.data.profil_id,
      p_identitas: actor.kunci, p_aktor_uid: actor.uid,
    });
    if (error) return galat(kodeRpc(error), requestId);
    dicatat = data?.dicatat === true;
    const r = response();
    if (dicatat && actor.baru) r.cookies.set('umkm_statistik', actor.kunci, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400, secure: process.env.NODE_ENV === 'production',
    });
    return r;
  } catch (error) {
    return galat(error instanceof Error && error.message === 'INPUT_TIDAK_VALID'
      ? 'INPUT_TIDAK_VALID' : 'GAGAL_INTERNAL', requestId);
  }
}
export async function catatTanpaHasil(request: Request, kategori: string | null, kota: string | null) {
  if (dikecualikan(request)) return;
  try {
    const writer = penulisStatistik();
    if (!writer) return;
    const actor = await identitas(request);
    const { error } = await writer.rpc('umkm_catat_tanpa_hasil', {
      p_kategori: kategori, p_kabupaten_kota: kota, p_aktor_uid: actor.uid,
    });
    if (error) return;
  } catch { /* Pencatatan opsional tidak menggagalkan hasil pencarian. */ }
}
