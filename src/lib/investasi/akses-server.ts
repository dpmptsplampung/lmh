import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { galat, kodeRpc } from './http';

export async function requireKelolaInvestasi(requestId: string) {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { response: galat('LOGIN_DIPERLUKAN', requestId) };
  try {
    const akses = await client.rpc('boleh_kelola_investasi');
    if (akses.error) return { response: galat(kodeRpc(akses.error), requestId) };
    if (akses.data !== true) return { response: galat('DILARANG', requestId) };
  } catch { return { response: galat('GAGAL_INTERNAL', requestId) }; }
  return { client, user };
}

export type IdContext = { params: Promise<{ id: string }> };
export type GambarContext = { params: Promise<{ id: string; gambarId: string }> };
export async function layaniKelola(kerjakan: (client: SupabaseClient, requestId: string) => Promise<Response>): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    const akses = await requireKelolaInvestasi(requestId);
    if (akses.response) return akses.response;
    return await kerjakan(akses.client, requestId);
  } catch (error) {
    return galat(error instanceof Error ? kodeRpc(error) : 'GAGAL_INTERNAL', requestId);
  }
}
