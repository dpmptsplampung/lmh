import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { jalankanBot, FALLBACK_TEXT } from '@/lib/llm/bot';
import { logServerEvent } from '@/lib/observability/logger';
import { redactPii } from '@/lib/pii';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  pertanyaan: z.string().min(3).max(2000),
  layanan_id: z.uuid(),
  sesi_id: z.uuid(),
});

// Rate limit: 10 calls per 60s per user. Generous enough for legitimate
// chat, tight enough to prevent Gemini-quota abuse.
const RATE_LIMIT_ACTION = 'chat_ai_call';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 60;

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

type BotRow = { id: string; pengirim: string; isi: string; created_at: string; sumber_faq_id?: string | null };
type Admin = NonNullable<ReturnType<typeof getServiceClient>>;
type SesiStatus = 'bot' | 'eskalasi' | 'aktif' | 'selesai';

function ignoredBody(status: SesiStatus) {
  return {
    ignored: true, jawaban: null, sumber: [], eskalasi: false,
    reason: status === 'aktif' ? 'sesi_aktif' : 'sesi_selesai', pesan: null, status,
  };
}

function cause(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

// Simpan pesan bot (server-side) dan, bila eskalasi, naikkan status hanya dari 'bot'.
async function saveBot(
  admin: Admin,
  sesiId: string,
  currentStatus: SesiStatus,
  isi: string,
  opts: { eskalasi: boolean; sumberFaqId?: string | null },
): Promise<{ pesan: BotRow | null; status: SesiStatus; ignored?: boolean }> {
  // Baca ulang status: petugas bisa mengambil alih selama LLM berjalan.
  const { data: cur } = await admin.from('chat_sesi').select('status').eq('id', sesiId).maybeSingle();
  const now = (cur?.status ?? currentStatus) as SesiStatus;
  if (now === 'aktif' || now === 'selesai') {
    return { pesan: null, status: now, ignored: true };
  }
  currentStatus = now;
  const { data, error } = await admin
    .from('chat_pesan')
    .insert({ sesi_id: sesiId, pengirim: 'bot', isi, sumber_faq_id: opts.sumberFaqId ?? null })
    .select('id, pengirim, isi, created_at, sumber_faq_id')
    .single();
  if (error) {
    logServerEvent('error', { operation: 'chat.ai.save_bot', route: '/api/chat/ai', cause: error.message });
  }
  let status = currentStatus;
  if (opts.eskalasi && currentStatus === 'bot') {
    const { error: statusErr } = await admin
      .from('chat_sesi')
      .update({ status: 'eskalasi' })
      .eq('id', sesiId)
      .eq('status', 'bot');
    if (statusErr) {
      logServerEvent('error', { operation: 'chat.ai.escalate_status', route: '/api/chat/ai', cause: statusErr.message });
    } else {
      status = 'eskalasi';
    }
  }
  return { pesan: (data as BotRow | null) ?? null, status };
}

export async function POST(request: NextRequest) {
  // 1. Validate input
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { pertanyaan: rawPertanyaan, layanan_id, sesi_id } = parsed.data;

  // Redact PII before the question is logged or sent to the LLM.
  const pertanyaan = redactPii(rawPertanyaan);

  const adminClient = getServiceClient();
  if (!adminClient) {
    // Tanpa service client tidak ada yang bisa disimpan; jujur ke klien.
    logServerEvent('error', { operation: 'chat.ai.no_service_client', route: '/api/chat/ai' });
    return NextResponse.json(
      { jawaban: FALLBACK_TEXT, sumber: [], eskalasi: true, reason: 'ai_error', pesan: null, status: null },
      { status: 200 },
    );
  }

  // 2b. Identify the caller and verify they own sesi_id (service-role bypasses
  // RLS, so this explicit check is the authorization).
  const serverClient = await createServerClient();
  const { data: { user: caller } } = await serverClient.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: pengunjungRow, error: pengunjungErr } = await adminClient
    .from('pengunjung')
    .select('id')
    .eq('auth_user_id', caller.id)
    .maybeSingle();

  if (pengunjungErr || !pengunjungRow) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiRow, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('pengunjung_id, status')
    .eq('id', sesi_id)
    .maybeSingle();

  if (sesiErr || !sesiRow || sesiRow.pengunjung_id !== pengunjungRow.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Petugas memegang sesi ('aktif') atau sudah ditutup: bot diam, tanpa biaya AI.
  const sesiStatus = (sesiRow.status ?? 'bot') as SesiStatus;
  if (sesiStatus === 'aktif' || sesiStatus === 'selesai') {
    return NextResponse.json(ignoredBody(sesiStatus));
  }

  // Bot hidup/mati ditegakkan di server (bukan hanya disembunyikan di layar pengunjung).
  const { data: layananData } = await adminClient
    .from('layanan')
    .select('nama, chatbot_aktif')
    .eq('id', layanan_id)
    .single();
  if (!layananData) {
    return NextResponse.json({ error: 'Layanan tidak ditemukan' }, { status: 404 });
  }
  const layananNama = layananData.nama;
  if (layananData.chatbot_aktif === false) {
    return NextResponse.json({ ...ignoredBody(sesiStatus), reason: 'bot_nonaktif' });
  }

  // 2c. Rate limit (10/60s per user), fail-closed.
  const allowed = await checkRateLimit(adminClient, caller.id);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }

  // Jalur kegagalan terpusat: log penyebab nyata, pesan bot, status eskalasi.
  const failAndEscalate = async (
    operation: string,
    err: unknown,
    faqIds: string[] = [],
    topSim: number | null = null,
    text: string = FALLBACK_TEXT,
    reason: string = 'ai_error',
  ) => {
    logServerEvent('error', { operation, route: '/api/chat/ai', sesiId: sesi_id, cause: cause(err) });
    await logAiCall(adminClient, sesi_id, pertanyaan, faqIds, null, topSim, true, reason);
    const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, text, { eskalasi: true });
    if (ignored) return NextResponse.json(ignoredBody(status));
    return NextResponse.json({
      jawaban: text, sumber: [], eskalasi: true, reason: reason, pesan, status,
    });
  };

  // Logika bot (injeksi prompt -> FAQ FTS -> embedding FAQ + Dokumen Peraturan -> LLM) ada di lib/llm/bot.ts
  // dan dipakai bersama "Coba tanya bot" admin. Route ini hanya mengurus auth, status sesi, dan penyimpanan.
  const hasil = await jalankanBot({
    admin: adminClient, pertanyaan, rawPertanyaan, layananId: layanan_id, layananNama,
  });
  if (hasil.kind === 'gagal') {
    return failAndEscalate(hasil.operation, hasil.err, hasil.faqIds, hasil.topSim, hasil.text, hasil.reason);
  }

  // Audit log + simpan balasan bot + eskalasi status (hanya dari 'bot').
  await logAiCall(adminClient, sesi_id, pertanyaan, hasil.faqIds, hasil.jawaban, hasil.topSim, hasil.eskalasi, hasil.reason);
  const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, hasil.jawaban, {
    eskalasi: hasil.eskalasi,
    sumberFaqId: hasil.sumberFaqId,
  });
  if (ignored) return NextResponse.json(ignoredBody(status));

  return NextResponse.json({
    jawaban: hasil.jawaban,
    sumber: hasil.sumber,
    sumber_dokumen: hasil.sumberDokumen,
    eskalasi: hasil.eskalasi,
    reason: hasil.reason,
    pesan,
    status,
  });
}

async function checkRateLimit(
  adminClient: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // Count existing rate-limit rows for this user+action within the window.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();
  const { count, error } = await adminClient
    .from('anon_rate_limit')
    .select('*', { count: 'exact', head: true })
    .eq('action', RATE_LIMIT_ACTION)
    .eq('user_id', userId)
    .gte('created_at', since);

  if (error) return false;
  if (count !== null && count >= RATE_LIMIT_MAX) return false;

  // Log this call so subsequent requests within the window are counted.
  await adminClient.from('anon_rate_limit').insert({
    user_id: userId,
    action: RATE_LIMIT_ACTION,
  });
  return true;
}

async function logAiCall(
  client: ReturnType<typeof getServiceClient>,
  sesiId: string,
  pertanyaan: string,
  contextFaqIds: string[],
  jawaban: string | null,
  topSimilarity: number | null,
  eskalasi: boolean,
  reason: string | null,
): Promise<void> {
  if (!client) return;
  try {
    await client.from('chat_ai_log').insert({
      sesi_id: sesiId,
      pertanyaan,
      context_faq_ids: contextFaqIds,
      jawaban,
      top_similarity: topSimilarity,
      eskalasi,
      reason,
    });
  } catch {
    // Audit logging is best-effort; do not fail the request if it errors.
  }
}
