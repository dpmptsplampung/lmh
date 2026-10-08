// Aktifkan draf (wajib lulus uji, atau "tanpa uji" + alasan) atau rollback ke versi arsip.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, requireAdmin } from '@/lib/akun/server';
import { LLM_KUNCI } from '@/lib/settings/llm-schema';
import { resetLlmConfigCache } from '@/lib/settings/llm-config';
import { readJson, rpcErrorResponse } from '@/lib/settings/admin';

export const dynamic = 'force-dynamic';

const schema = z
  .object({
    aksi: z.enum(['aktifkan', 'rollback']),
    versi: z.int().min(1),
    alasan: z.string().trim().max(500).optional(),
    tanpa_uji: z.boolean().optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'Invalid input' }, 400);
  const b = parsed.data;

  const { data, error } =
    b.aksi === 'aktifkan'
      ? await service.rpc('aktifkan_pengaturan', {
          p_kunci: LLM_KUNCI, p_versi: b.versi, p_oleh: actor.id, p_alasan: b.alasan ?? null, p_tanpa_uji: b.tanpa_uji === true,
        })
      : await service.rpc('rollback_pengaturan', {
          p_kunci: LLM_KUNCI, p_versi_sumber: b.versi, p_oleh: actor.id, p_alasan: b.alasan ?? '',
        });
  if (error) return rpcErrorResponse(error);
  resetLlmConfigCache(); // instance ini langsung; instance lain paling lambat 60 dtk
  return json({ ok: true, versi_aktif: data, berlaku: 'paling lambat sekitar 1 menit' });
}
