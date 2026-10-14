// Pembantu route admin konsol pengaturan (server-only).
import type { SupabaseClient } from '@supabase/supabase-js';
import { json } from '@/lib/akun/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

/** Audit perubahan pengaturan. Detail TIDAK boleh memuat rahasia/kunci. Gagal audit tidak menggagalkan aksi. */
export async function auditSettings(
  service: SupabaseClient,
  actor: { id: string; role: string },
  aksi: string,
  entitasId: string,
  detail: Record<string, unknown>,
) {
  // best-effort: perubahan pengaturan sudah terjadi; gagal menulis audit tidak boleh menggagalkannya, tetapi dicatat.
  try {
    await mutasiInsert(service.from('audit_log').insert({
      actor_id: actor.id, actor_role: actor.role, aksi, entitas: 'pengaturan', entitas_id: entitasId, detail,
    }));
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    catatMutasi('error', 'settings.audit', 'lib/settings/admin', e, { aksi });
  }
}

const KODE_STATUS: Record<string, number> = {
  TIDAK_ADA: 404,
  BUKAN_DRAF: 409,
  BUKAN_ARSIP: 409,
  BELUM_DIUJI: 409,
  TIDAK_ADA_PENYEDIA_AKTIF: 409,
  ALASAN_WAJIB: 400,
  NILAI_TIDAK_VALID: 400,
};

/** Petakan galat RPC (kode di awal pesan) ke respons HTTP; selain itu 500 generik. */
export function rpcErrorResponse(error: { message: string }) {
  const kode = /^([A-Z_]+):/.exec(error.message)?.[1];
  if (kode && KODE_STATUS[kode]) return json({ error: error.message.slice(kode.length + 2), kode }, KODE_STATUS[kode]);
  console.error('[settings] rpc gagal', error.message.slice(0, 200));
  return json({ error: 'Gagal memproses pengaturan' }, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { return undefined; }
}
