// Simpan kunci API (WRITE-ONLY). Kunci dienkripsi AES-256-GCM; respons hanya id + tampilan tersamar.
// Selalu membuat rahasia BARU (versi lama tetap terbaca untuk rollback). Isi kunci tidak pernah di-log/audit.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ambilJatah, json, requireAdmin } from '@/lib/akun/server';
import { EncryptionNotConfiguredError, encryptSecret, maskSecret } from '@/lib/settings/crypto';
import { auditSettings, readJson } from '@/lib/settings/admin';
import { hostOf } from '@/lib/settings/llm-schema';

export const dynamic = 'force-dynamic';

const schema = z.object({ nama: z.string().trim().min(1).max(80), kunci: z.string().trim().min(8).max(500), base_url: z.string().trim().max(300).optional() }).strict();

export async function POST(request: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const { actor, service } = g;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'Invalid input' }, 400);
  // Kunci terikat ke host tujuan (opsional di sini; bila kosong diikat saat pertama dipakai di PUT penyedia).
  const host = parsed.data.base_url ? hostOf(parsed.data.base_url) : null;
  if (parsed.data.base_url && !host) return json({ error: 'base_url tidak valid' }, 400);
  if (!(await ambilJatah(service, `rahasia_set:${actor.id}`, 30, 3600))) return json({ error: 'Terlalu banyak permintaan' }, 429);

  let blob;
  try {
    blob = encryptSecret(parsed.data.kunci);
  } catch (e) {
    if (e instanceof EncryptionNotConfiguredError) {
      return json({ error: e.message, kode: 'ENKRIPSI_BELUM_DIATUR' }, 503);
    }
    return json({ error: 'Gagal mengenkripsi' }, 500);
  }
  const { data, error } = await service
    .from('rahasia_pengaturan')
    .insert({ nama: parsed.data.nama, ...blob, host, diubah_oleh: actor.id })
    .select('id')
    .single();
  if (error || !data) return json({ error: 'Gagal menyimpan rahasia' }, 500);
  await auditSettings(service, actor, 'rahasia_simpan', data.id as string, { nama: parsed.data.nama });
  return json({ ok: true, rahasia_id: data.id, kunci_tersamar: maskSecret(blob.last4) });
}
