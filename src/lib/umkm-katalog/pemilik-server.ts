import { z } from 'zod';
import { bucketTerpisah, presignGet, r2Tersedia } from '@/lib/storage/r2';
import { kunciObjek } from '@/lib/storage/area';
import { aksiKlaimSchema, cabutKepemilikanSchema, putusanKlaimSchema } from './schemas-g5';
import { queryInput } from './schemas-g2';
import { createClient } from '@/lib/supabase/server';
import { galat, headersPrivat, idSchema, inputAksi, kodeRpc, layaniRpc, type IdContext } from './server';
import { panggilRpc } from './rpc';
import type { ApiSukses } from './types';
import type { DetailUsaha } from './types-g5';

export async function detailPemilik(request: Request, context: IdContext) {
  return layaniRpc(idSchema, async () => ({ ...queryInput(request), ...(await context.params) }),
    'umkm_detail_usaha', b => ({ p_profil_id: b.id }));
}
export async function detailKlaim(request: Request, context: IdContext) {
  return layaniRpc(idSchema, async () => ({ ...queryInput(request), ...(await context.params) }),
    'umkm_detail_klaim', b => ({ p_id: b.id }));
}
export async function ambilKlaim(request: Request, context: IdContext) {
  return layaniRpc(aksiKlaimSchema, () => inputAksi(request, context), 'umkm_ambil_klaim', b => ({
    p_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
  }));
}
export async function putuskanKlaim(request: Request, context: IdContext) {
  return layaniRpc(putusanKlaimSchema, () => inputAksi(request, context), 'umkm_putuskan_klaim', b => ({
    p_id: b.id, p_keputusan: b.keputusan, p_alasan: b.alasan ?? null,
    p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
  }));
}
export async function cabutKepemilikan(request: Request, context: IdContext) {
  return layaniRpc(cabutKepemilikanSchema, () => inputAksi(request, context), 'umkm_cabut_kepemilikan', b => ({
    p_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id, p_alasan: b.alasan,
  }));
}
// Penanda tahap C boleh dibaca tanpa login; selain aktif dianggap modul belum tersedia.
export async function tahapPemilik() {
  const requestId = crypto.randomUUID();
  try {
    const client = await createClient();
    const modul = await panggilRpc(client, 'umkm_tahap_c', {});
    if (modul.error) return galat(kodeRpc(modul.error), requestId);
    if (modul.data?.aktif !== true) return galat('MODUL_BELUM_TERSEDIA', requestId);
    return Response.json({ data: { aktif: true }, meta: { request_id: requestId } }, { headers: headersPrivat });
  } catch { return galat('GAGAL_INTERNAL', requestId); }
}
const fotoSchema = z.object({ id: z.uuid(), fotoId: z.uuid() }).strict();
export async function fotoPemilik(_request: Request, context: { params: Promise<{ id: string; fotoId: string }> }) {
  const response = await layaniRpc(fotoSchema, () => context.params,
    'umkm_detail_usaha', b => ({ p_profil_id: b.id }));
  if (!response.ok) return response;
  const { data, meta } = await response.json() as ApiSukses<DetailUsaha>;
  try {
    const { fotoId } = await context.params;
    const foto = data.foto.find(f => f.id === fotoId);
    if (!foto || foto.asal !== 'unggahan' || !foto.r2_key?.startsWith('umkm-draf/'))
      return galat('TIDAK_DITEMUKAN', meta.request_id);
    const key = kunciObjek('umkm-draf', foto.r2_key.slice('umkm-draf/'.length));
    const tipe: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp' };
    const mime = tipe[key.split('.').at(-1) ?? ''];
    if (!mime) return galat('TIDAK_DITEMUKAN', meta.request_id);
    if (!r2Tersedia() || !bucketTerpisah()) return galat('MODUL_BELUM_TERSEDIA', meta.request_id);
    const url = await presignGet('private', key, 60, { contentType: mime, contentDisposition: 'inline' });
    return new Response(null, { status: 307, headers: { ...headersPrivat,
      Location: url, 'Referrer-Policy': 'no-referrer' } });
  } catch { return galat('GAGAL_INTERNAL', meta.request_id); }
}
