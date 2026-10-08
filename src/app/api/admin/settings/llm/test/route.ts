// Tombol UJI satu penyedia: memanggil gateway langsung (SSRF-guard) dengan nilai DRAF (atau aktif) termasuk
// kunci tersimpan. Hasil: ok, status HTTP, latensi, cuplikan balasan, curl setara (kunci tersamar).
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ambilJatah, json, requireAdmin } from '@/lib/akun/server';
import { ujiPenyedia } from '@/lib/llm/uji';
import { decryptSecret } from '@/lib/settings/crypto';
import { LLM_KUNCI, entryToSpec, hostEntri, rantaiSchema } from '@/lib/settings/llm-schema';
import { auditSettings, readJson } from '@/lib/settings/admin';

export const dynamic = 'force-dynamic';

const schema = z.object({ entry_id: z.uuid(), sumber: z.enum(['draf', 'aktif']).optional() }).strict();

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'Invalid input' }, 400);
  if (!(await ambilJatah(service, `llm_uji:${actor.id}`, 20, 3600))) {
    return json({ error: 'Batas uji tercapai (20 per jam)' }, 429);
  }

  const sumber = parsed.data.sumber ?? 'draf';
  const { data: row } = await service
    .from('pengaturan_sistem')
    .select('id, nilai, hasil_uji')
    .eq('kunci', LLM_KUNCI)
    .eq('status', sumber === 'draf' ? 'draf' : 'aktif')
    .maybeSingle();
  if (!row) return json({ error: sumber === 'draf' ? 'Belum ada draf' : 'Belum ada konfigurasi aktif' }, 404);
  const list = rantaiSchema.safeParse(row.nilai);
  const entry = list.success ? list.data.find((e) => e.id === parsed.data.entry_id) : undefined;
  if (!entry) return json({ error: 'Entri tidak ditemukan' }, 404);

  let key: string | undefined;
  let last4: string | null = null;
  if (entry.rahasia_id) {
    const { data: r } = await service
      .from('rahasia_pengaturan')
      .select('ciphertext, iv, tag, last4, host')
      .eq('id', entry.rahasia_id)
      .maybeSingle();
    const hostTerikat = (r as { host?: string | null } | null)?.host;
    if (hostTerikat && hostTerikat !== hostEntri(entry)) {
      return json({ error: `Kunci terikat ke host ${hostTerikat}, tidak cocok dengan base URL entri.`, kode: 'HOST_KUNCI_BEDA' }, 409);
    }
    try {
      if (r) key = decryptSecret(r as { ciphertext: string; iv: string; tag: string });
      last4 = (r as { last4?: string } | null)?.last4 ?? null;
    } catch {
      key = undefined;
    }
    if (!key) {
      return json({ error: 'Kunci tersimpan tidak dapat dibaca (kunci induk berubah atau env belum diset). Masukkan ulang kunci.', kode: 'KUNCI_TAK_TERBACA' }, 409);
    }
  } else if (entry.tipe === 'gemini') {
    key = process.env.GEMINI_API_KEY || undefined;
  }

  const hasil = await ujiPenyedia(entryToSpec(entry, key), last4);

  if (sumber === 'draf') {
    const at = new Date().toISOString();
    const uji = {
      ...(row.hasil_uji as Record<string, unknown>),
      [entry.id]: { ok: hasil.ok, http_status: hasil.http_status, latensi_ms: hasil.latensi_ms, at },
    };
    await service.from('pengaturan_sistem').update({ hasil_uji: uji, diuji_at: at }).eq('id', row.id).eq('status', 'draf');
  }
  await auditSettings(service, actor, 'llm_uji', LLM_KUNCI, {
    entry_id: entry.id, ok: hasil.ok, http_status: hasil.http_status, latensi_ms: hasil.latensi_ms,
  });
  return json(hasil);
}
