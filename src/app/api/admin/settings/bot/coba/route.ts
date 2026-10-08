// "Coba tanya bot": menjalankan jalur bot yang SAMA (lib/llm/bot.ts) tanpa menyimpan pesan/sesi/log dan tanpa eskalasi.
// Admin & front_office: layanan mana pun; petugas: layanan sendiri.
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ambilJatah, getServiceClient, json, requireStaf } from '@/lib/akun/server';
import { jalankanBot } from '@/lib/llm/bot';
import { redactPii } from '@/lib/pii';
import { readJson } from '@/lib/settings/admin';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const schema = z.object({ pertanyaan: z.string().trim().min(3).max(2000), layanan_id: z.uuid() }).strict();

export async function POST(request: NextRequest) {
  const g = await requireStaf();
  if ('res' in g) return g.res;
  const { me } = g;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: 'Invalid input' }, 400);
  const { pertanyaan: raw, layanan_id } = parsed.data;
  if (me.role === 'petugas' && me.layanan_id !== layanan_id) return json({ error: 'Hanya layanan Anda' }, 403);

  const service = getServiceClient();
  if (!service) return json({ error: 'Server misconfigured' }, 500);
  if (!(await ambilJatah(service, `bot_coba:${me.id}`, 30, 3600))) return json({ error: 'Batas uji tercapai (30 per jam)' }, 429);

  const { data: lay } = await service.from('layanan').select('nama, chatbot_aktif').eq('id', layanan_id).maybeSingle();
  if (!lay) return json({ error: 'Layanan tidak ditemukan' }, 404);

  const t0 = Date.now();
  const hasil = await jalankanBot({
    admin: service, pertanyaan: redactPii(raw), rawPertanyaan: raw, layananId: layanan_id, layananNama: lay.nama as string,
  });
  const latensi_ms = Date.now() - t0;
  const chatbot_aktif = lay.chatbot_aktif === true;

  if (hasil.kind === 'gagal') {
    return json({ ok: false, jawaban: hasil.text, reason: hasil.reason, operasi: hasil.operation, latensi_ms, chatbot_aktif });
  }
  return json({
    ok: true,
    jawaban: hasil.jawaban,
    sumber: hasil.sumber,
    sumber_dokumen: hasil.sumberDokumen,
    eskalasi: hasil.eskalasi,
    reason: hasil.reason,
    penyedia: hasil.provider,
    skor_faq: hasil.topSim,
    mode: { tutup: hasil.mode.tutup, alasan: hasil.mode.alasan, kerja_berikutnya: hasil.mode.kerjaBerikutnya },
    latensi_ms,
    chatbot_aktif,
  });
}
