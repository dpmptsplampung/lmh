import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getGenerativeClient, getChatModel, getEmbeddingModel, buildRagContext, getSystemPrompt, type FaqMatch } from '@/lib/gemini';
import { normalizeQuestion } from '@/lib/chat/normalize';
import { generateWithFallback } from '@/lib/llm/registry';
import { todayWIB } from '@/lib/time';
import { logServerEvent } from '@/lib/observability/logger';
import { redactPii, detectPromptInjection } from '@/lib/pii';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  pertanyaan: z.string().min(3).max(2000),
  layanan_id: z.uuid(),
  sesi_id: z.uuid(),
});

const SIMILARITY_THRESHOLD = 0.7;

// Rate limit: 10 calls per 60s per user. Generous enough for legitimate
// chat, tight enough to prevent Gemini-quota abuse.
const RATE_LIMIT_ACTION = 'chat_ai_call';
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_SEC = 60;

// Ambang tingkat 0 (pencocok FAQ deterministik). Bisa dioverride via env
// BOT_FTS_THRESHOLD tanpa deploy.
const FTS_THRESHOLD = Number(process.env.BOT_FTS_THRESHOLD) || 0.15;

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

type BotRow = { id: string; pengirim: string; isi: string; created_at: string; sumber_faq_id?: string | null };
type Admin = NonNullable<ReturnType<typeof getServiceClient>>;
type SesiStatus = 'bot' | 'eskalasi' | 'aktif' | 'selesai';

const FALLBACK_TEXT =
  'Maaf, asisten virtual sedang mengalami kendala. Percakapan Anda telah diteruskan ke petugas kami dan akan dibalas secepatnya.';

// Hari dalam seminggu menurut WIB (bukan zona server/UTC).
function isWeekendWIB(): boolean {
  const d = new Date(`${todayWIB()}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

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

  // Weekend mode (WIB): petugas libur — bot hanya menjawab hal umum, tanpa eskalasi.
  const isWeekend = isWeekendWIB();

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

  // Injeksi prompt: setelah auth+kepemilikan; bot menolak sopan & eskalasi.
  if (detectPromptInjection(rawPertanyaan)) {
    return failAndEscalate(
      'chat.ai.prompt_injection', new Error('prompt injection terdeteksi'), [], null,
      'Maaf, pertanyaan Anda mengandung instruksi yang tidak diizinkan. Saya akan menghubungkan Anda ke petugas.',
      'prompt_injection',
    );
  }

  // 2d. TINGKAT 0 — pencocok FAQ deterministik di Postgres (tanpa LLM).
  type FtsRow = { id: string; pertanyaan: string; jawaban: string; skor: number };
  let ftsCandidates: FtsRow[] = [];
  try {
    const { data: ftsMatches, error: ftsErr } = await adminClient.rpc('match_faq_teks', {
      p_layanan: layanan_id,
      p_q: normalizeQuestion(pertanyaan),
      p_limit: 3,
    });
    if (ftsErr) {
      logServerEvent('warn', { operation: 'chat.ai.fts', route: '/api/chat/ai', cause: ftsErr.message });
    } else if (Array.isArray(ftsMatches)) {
      ftsCandidates = ftsMatches as FtsRow[];
    }
    const top = ftsCandidates[0];
    if (top && top.skor >= FTS_THRESHOLD) {
      await logAiCall(adminClient, sesi_id, pertanyaan, [top.id], top.jawaban, null, false, 'fts_exact');
      const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, top.jawaban, {
        eskalasi: false,
        sumberFaqId: top.id,
      });
      if (ignored) return NextResponse.json(ignoredBody(status));
      return NextResponse.json({
        jawaban: top.jawaban,
        sumber: [{ id: top.id, pertanyaan: top.pertanyaan }],
        eskalasi: false,
        reason: 'fts_exact',
        pesan,
        status,
      });
    }
  } catch (e) {
    logServerEvent('warn', { operation: 'chat.ai.fts', route: '/api/chat/ai', cause: cause(e) });
  }

  // 3-4. Embedding + match_faq. Kegagalan di sini TIDAK langsung eskalasi:
  // turun ke kandidat FTS (tanpa LLM bila tak ada konteks sama sekali).
  const genAI = getGenerativeClient();
  let faqMatches: FaqMatch[] = [];
  let degraded: string | null = null;
  try {
    if (!genAI) throw new Error('GEMINI_API_KEY tidak diset');
    const embedModel = getEmbeddingModel(genAI, 'gemini-embedding-001'); // FAQ col = 3072
    const result = await embedModel.embedContent(pertanyaan);
    const queryEmbedding = result.embedding.values;
    if (!queryEmbedding || queryEmbedding.length === 0) throw new Error('embedding kosong');
    const { data: matches, error: matchErr } = await adminClient.rpc('match_faq', {
      query_embedding: `[${queryEmbedding.join(',')}]`,
      p_layanan_id: layanan_id,
      match_count: 5,
    });
    if (matchErr) throw new Error(`match_faq: ${matchErr.message}`);
    faqMatches = (matches ?? []) as FaqMatch[];
  } catch (e) {
    degraded = cause(e);
    logServerEvent('error', { operation: 'chat.ai.embed_or_match', route: '/api/chat/ai', sesiId: sesi_id, cause: degraded });
    if (ftsCandidates.length === 0) {
      return failAndEscalate('chat.ai.no_context', e);
    }
    faqMatches = ftsCandidates.map((c) => ({
      id: c.id, layanan_id, pertanyaan: c.pertanyaan, jawaban: c.jawaban, similarity: 0,
    }));
  }

  const isExactMatch = !degraded && faqMatches.length > 0 && faqMatches[0].similarity >= SIMILARITY_THRESHOLD;
  const topSim = !degraded && faqMatches.length > 0 ? faqMatches[0].similarity : null;
  const faqIds = isExactMatch ? faqMatches.map((m) => m.id) : [];

  // Sapaan MURNI / basa-basi: PENDEK, tanpa tanda tanya, murni sapaan/penutup.
  const GREETING_RE =
    /^(h[ae]lo+|hai+|hi+|hei+|helo+|hallo+|selamat (pagi|siang|sore|malam)|ass?alamu?(['’]?alaikum)?|salam(sejahtera)?|pagi|siang|sore|malam|tes?t?|ping|apa ?kabar|terima ?kasih|makasih|thanks|thank ?you)[.!\s]*$/i;
  const trimmed = pertanyaan.trim();
  const isGreeting =
    trimmed.length <= 30 && !trimmed.includes('?') && GREETING_RE.test(trimmed);

  const { data: layananData } = await adminClient
    .from('layanan')
    .select('nama')
    .eq('id', layanan_id)
    .single();
  const layananNama = layananData?.nama;

  let context: string;
  if (isWeekend) {
    const partialContext = faqMatches.length > 0 ? buildRagContext(faqMatches.slice(0, 3)) : '';
    context = `[MODE AKHIR PEKAN]: Hari ini Sabtu/Minggu — petugas tidak bertugas. Jawab HANYA pertanyaan umum seputar layanan, persyaratan, dan jam operasional berdasarkan konteks FAQ resmi. Jika pertanyaan membutuhkan petugas atau di luar konteks, sampaikan dengan sopan bahwa petugas akan membantu pada hari kerja (Senin–Jumat). JANGAN menawarkan eskalasi atau koneksi langsung ke petugas.\n\n${partialContext}`;
  } else if (isExactMatch) {
    context = buildRagContext(faqMatches);
  } else if (isGreeting) {
    context = `[SAPAAN]: Pengunjung membuka dengan sapaan/basa-basi. Balas dengan ramah dan hangat, perkenalkan diri sebagai asisten virtual ${layananNama ?? 'layanan ini'}, dan tawarkan bantuan (mis. tanyakan apa yang ingin mereka ketahui seputar layanan, persyaratan, atau jam operasional). JANGAN menawarkan eskalasi ke petugas.`;
  } else {
    const partialContext = faqMatches.length > 0 ? buildRagContext(faqMatches.slice(0, 3)) : '';
    context = `[INFORMASI LAYANAN]: Jawablah pertanyaan pengunjung secara ramah dan membantu berdasar pedoman layanan publik DPMPTSP Provinsi Lampung. Sampaikan bahwa petugas kami juga siap membantu bila dibutuhkan informasi lanjutan.\n\n${partialContext}`;
  }

  // 7. Generasi jawaban: SDK Gemini → penyedia OpenAI-compatible (LLM_CHAT_PROVIDERS).
  const reply = await generateWithFallback(
    genAI
      ? {
          name: 'gemini',
          generate: async () => {
            const chatModel = getChatModel(genAI, layananNama);
            const result = await chatModel.generateContent([context, pertanyaan]);
            return result.response.text();
          },
        }
      : null,
    {
      system: getSystemPrompt(layananNama),
      prompt: `${context}\n\nPertanyaan pengunjung: ${pertanyaan}`,
    },
  );
  let jawaban = reply && reply.text && reply.text.trim().length > 0 ? redactPii(reply.text) : '';

  if (!jawaban.trim()) {
    // Semua penyedia LLM gagal / kosong.
    if (isGreeting || isWeekend) {
      jawaban = isGreeting
        ? 'Halo! Selamat datang. Ada yang bisa kami bantu seputar layanan kami?'
        : 'Terima kasih atas pertanyaan Anda. Petugas kami akan membantu pada hari kerja (Senin–Jumat).';
    } else {
      // Sertakan FAQ teratas bila ada agar pengunjung tetap mendapat info.
      const best = faqMatches[0];
      const text = isExactMatch && best
        ? `${best.jawaban}\n\nPetugas kami juga akan membantu Anda lebih lanjut.`
        : FALLBACK_TEXT;
      return failAndEscalate('chat.ai.llm_failed', new Error('semua penyedia LLM gagal'), faqIds, topSim, text);
    }
  }

  // 8. Audit log. Eskalasi hanya bila pertanyaan substantif tidak terjawab FAQ.
  const eskalasi = !isExactMatch && !isWeekend && !isGreeting;
  const reasonOut = isExactMatch ? null : degraded ? 'embedding_fallback' : isWeekend ? 'weekend_mode' : isGreeting ? 'greeting' : 'no_match';
  await logAiCall(adminClient, sesi_id, pertanyaan, faqIds, jawaban, topSim, eskalasi, reasonOut);

  // 9. Simpan balasan bot + eskalasi status (hanya dari 'bot').
  const { pesan, status, ignored } = await saveBot(adminClient, sesi_id, sesiStatus, jawaban, {
    eskalasi,
    sumberFaqId: isExactMatch && faqMatches.length > 0 ? faqMatches[0].id : null,
  });
  if (ignored) return NextResponse.json(ignoredBody(status));

  return NextResponse.json({
    jawaban,
    sumber: isExactMatch ? faqMatches.map((m) => ({ id: m.id, pertanyaan: m.pertanyaan })) : [],
    eskalasi,
    reason: reasonOut,
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
