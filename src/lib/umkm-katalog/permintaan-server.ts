import { createClient } from '@/lib/supabase/server';
import { panggilRpc } from './rpc';
import { aksiPermintaanSchema, catatHasilSchema, tolakPermintaanSchema, tautkanSchema } from './schemas-g4';
import { bacaJson, galat, headersPrivat, idSchema, inputAksi, kodeRpc, layaniRpc, type IdContext } from './server';
import { queryInput } from './schemas-g2';

export async function perusahaanSaya() {
  const requestId = crypto.randomUUID();
  try {
    const client = await createClient();
    const modul = await panggilRpc(client, 'umkm_tahap_b', {});
    if (modul.error) return galat(kodeRpc(modul.error), requestId);
    if (modul.data?.aktif !== true) return galat('MODUL_BELUM_TERSEDIA', requestId);
    const { data: { user } } = await client.auth.getUser();
    let perusahaan = null;
    const masuk = !!user && !user.is_anonymous;
    if (masuk) {
      const result = await panggilRpc(client, 'umkm_perusahaan_saya', {});
      if (result.error) return galat(kodeRpc(result.error), requestId);
      perusahaan = result.data?.perusahaan ?? null;
    }
    return Response.json({ data: { masuk, perusahaan }, meta: { request_id: requestId } }, { headers: headersPrivat });
  } catch { return galat('GAGAL_INTERNAL', requestId); }
}

export async function tautkanAkun(request: Request) {
  const response = await layaniRpc(tautkanSchema, () => bacaJson(request),
    'umkm_tautkan_akun', b => ({ p_kode: b.kode }));
  if (response.ok) {
    const body = await response.clone().json();
    if (body.data?.tertaut === false) return galat('KODE_TIDAK_VALID', body.meta.request_id);
  }
  return response;
}

export async function detailPermintaan(request: Request, context: IdContext) {
  return layaniRpc(idSchema, async () => ({ ...queryInput(request), ...(await context.params) }),
    'umkm_detail_permintaan', b => ({ p_id: b.id }));
}
export async function aksiPermintaan(
  request: Request, context: IdContext, aksi: 'ambil' | 'setujui' | 'tolak' | 'lepas-tahan' | 'tahan',
) {
  if (aksi === 'tolak' || aksi === 'tahan') {
    return layaniRpc(tolakPermintaanSchema, () => inputAksi(request, context),
      aksi === 'tolak' ? 'umkm_tolak_permintaan' : 'umkm_tahan_permintaan', b => ({
        p_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id, p_alasan: b.alasan,
      }));
  }
  return layaniRpc(aksiPermintaanSchema, () => inputAksi(request, context),
    aksi === 'ambil' ? 'umkm_ambil_pekerjaan' : aksi === 'setujui' ? 'umkm_setujui_dan_buka' : 'umkm_lepas_tahan',
    b => ({ p_id: b.id, p_expected_version: b.expected_version, p_operasi_id: b.operasi_id,
      ...(aksi === 'ambil' ? { p_jenis: 'permintaan' as const } : {}),
    }));
}
export async function catatPemberitahuan(request: Request, context: IdContext) {
  return layaniRpc(idSchema, () => inputAksi(request, context),
    'umkm_catat_pemberitahuan', b => ({ p_id: b.id }));
}
export async function catatHasil(request: Request, context: IdContext) {
  return layaniRpc(catatHasilSchema, () => inputAksi(request, context),
    'umkm_catat_hasil', b => ({ p_id: b.id, p_hasil: b.hasil }));
}
