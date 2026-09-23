import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getGenerativeClient, getChatModel, getEmbeddingModel, buildRagContext, getSystemPrompt, type FaqMatch } from '@/lib/gemini';
import { normalizeQuestion } from '@/lib/chat/normalize';
import { generateWithFallback } from '@/lib/llm/registry';
import { redactPii, detectPromptInjection } from '@/lib/pii';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  pertanyaan: z.string().min(3),
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

  // Weekend mode: petugas libur — bot hanya menjawab hal umum, tanpa eskalasi.
  const todayDow = new Date().getDay();
  const isWeekend = todayDow === 0 || todayDow === 6;

  // 1b. Check for prompt injection attacks
  if (detectPromptInjection(rawPertanyaan)) {
    return NextResponse.json(
      {
        jawaban: 'Maaf, pertanyaan Anda mengandung instruksi yang tidak diizinkan. Saya akan menghubungkan Anda ke petugas.',
        sumber: [],
        eskalasi: true,
        reason: 'prompt_injection',
      },
      { status: 200 },
    );
  }

  // Redact PII before the question is logged or sent to the LLM — FAQ
  // answers never need the caller's email/phone/NIK.
  const pertanyaan = redactPii(rawPertanyaan);


  // 2. Gemini client
  const genAI = getGenerativeClient();
  if (!genAI) {
    return NextResponse.json(
      { jawaban: null, eskalasi: true, reason: 'ai_error' },
      { status: 200 },
    );
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { jawaban: null, eskalasi: true, reason: 'ai_error' },
      { status: 200 },
    );
  }

  // 2b. Identify the caller via the server-side cookie-bound client, then
  // verify they own the sesi_id they claim. Service-role client bypasses
  // RLS so we can read chat_sesi regardless of row ownership; the explicit
  // check below is what enforces ownership (the route is not behind RLS).
  const serverClient = await createServerClient();
  const { data: { user: caller } } = await serverClient.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Resolve the caller's pengunjung.id (pengunjung.auth_user_id = auth.uid).
  const { data: pengunjungRow, error: pengunjungErr } = await adminClient
    .from('pengunjung')
    .select('id')
    .eq('auth_user_id', caller.id)
    .maybeSingle();

  if (pengunjungErr || !pengunjungRow) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Fetch the sesi's pengunjung_id and compare to the caller's.
  const { data: sesiRow, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('pengunjung_id')
    .eq('id', sesi_id)
    .maybeSingle();

  if (sesiErr || !sesiRow || sesiRow.pengunjung_id !== pengunjungRow.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2c. Rate limit (10/60s per user). Manual count + insert pattern
  // (mirrors K3 in /api/umkm/request-edit-link) keyed on the caller's auth
  // UID. We cannot call check_anon_rate() directly because it relies on
  // auth.uid(), which is NULL for the service-role client. Fail-closed: a
  // rate-limit query error rejects the request to protect Gemini quota.
  const allowed = await checkRateLimit(adminClient, caller.id);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }

  // 2d. TINGKAT 0 — pencocok FAQ deterministik di Postgres (tanpa LLM).
  // Bot tetap menjawab pertanyaan yang tercantum di FAQ resmi walau kuota
  // seluruh penyedia LLM habis. Jawaban dikirim VERBATIM (teks resmi).
  try {
    const { data: ftsMatches, error: ftsErr } = await adminClient.rpc('match_faq_teks', {
      p_layanan: layanan_id,
      p_q: normalizeQuestion(pertanyaan),
      p_limit: 3,
    });
    if (!ftsErr && Array.isArray(ftsMatches) && ftsMatches.length > 0) {
      const top = ftsMatches[0] as { id: string; pertanyaan: string; jawaban: string; skor: number };
      if (top.skor >= FTS_THRESHOLD) {
        await logAiCall(adminClient, sesi_id, pertanyaan, [top.id], top.jawaban, null, false, 'fts_exact');
        const { error: ftsInsertErr } = await adminClient.from('chat_pesan').insert({
          sesi_id,
          pengirim: 'bot',
          isi: top.jawaban,
          sumber_faq_id: top.id,
        });
        if (ftsInsertErr) {
          console.error('[api/chat/ai] gagal menyimpan balasan tingkat-0:', ftsInsertErr);
        }
        return NextResponse.json({
          jawaban: top.jawaban,
          sumber: [{ id: top.id, pertanyaan: top.pertanyaan }],
          eskalasi: false,
          reason: 'fts_exact',
        });
      }
    }
  } catch (e) {
    // RPC belum terpasang / DB gangguan → lanjut jalur lama, jangan gagalkan chat.
    console.warn('[api/chat/ai] tingkat-0 dilewati:', e instanceof Error ? e.message : e);
  }

  // 3. Embed the user's question
  let queryEmbedding: number[];
  try {
    const embedModel = getEmbeddingModel(genAI, 'gemini-embedding-001'); // FAQ col = 3072
    const result = await embedModel.embedContent(pertanyaan);
    queryEmbedding = result.embedding.values;
    if (!queryEmbedding || queryEmbedding.length === 0) {
      await logAiCall(adminClient, sesi_id, pertanyaan, [], null, null, true, 'ai_error');
      return NextResponse.json(
        { jawaban: null, eskalasi: true, reason: 'ai_error' },
        { status: 200 },
      );
    }
  } catch {
    await logAiCall(adminClient, sesi_id, pertanyaan, [], null, null, true, 'ai_error');
    return NextResponse.json(
      { jawaban: null, eskalasi: true, reason: 'ai_error' },
      { status: 200 },
    );
  }

  // 4. Call match_faq RPC
  const vectorLiteral = `[${queryEmbedding.join(',')}]`;
  const { data: matches, error: matchErr } = await adminClient.rpc('match_faq', {
    query_embedding: vectorLiteral,
    p_layanan_id: layanan_id,
    match_count: 5,
  });

  if (matchErr) {
    await logAiCall(adminClient, sesi_id, pertanyaan, [], null, null, true, 'ai_error');
    return NextResponse.json(
      { jawaban: null, eskalasi: true, reason: 'ai_error' },
      { status: 200 },
    );
  }

  const faqMatches: FaqMatch[] = (matches ?? []) as FaqMatch[];
  const isExactMatch = faqMatches.length > 0 && faqMatches[0].similarity >= SIMILARITY_THRESHOLD;
  const topSim = faqMatches.length > 0 ? faqMatches[0].similarity : null;
  const faqIds = isExactMatch ? faqMatches.map((m) => m.id) : [];

  // Sapaan MURNI / basa-basi ("halo", "selamat pagi", "terima kasih") tidak
  // memerlukan jawaban faktual, jadi jangan eskalasi hanya karena tidak ada FAQ
  // yang cocok — bot cukup menyapa balik dengan ramah.
  //
  // Ketat sengaja: HANYA cocok bila pesan PENDEK, TANPA tanda tanya, dan murni
  // sapaan/penutup. Pesan yang diawali kata sopan tetapi berisi pertanyaan
  // substantif ("permisi, berapa biaya retribusi?", "siang, syarat NIB apa?")
  // TIDAK dianggap sapaan — tetap dieskalasi bila tidak terjawab FAQ, karena
  // justru pengguna itulah yang paling membutuhkan petugas.
  const GREETING_RE =
    /^(h[ae]lo+|hai+|hi+|hei+|helo+|hallo+|selamat (pagi|siang|sore|malam)|ass?alamu?(['’]?alaikum)?|salam(sejahtera)?|pagi|siang|sore|malam|tes?t?|ping|apa ?kabar|terima ?kasih|makasih|thanks|thank ?you)[.!\s]*$/i;
  const trimmed = pertanyaan.trim();
  const isGreeting =
    trimmed.length <= 30 && !trimmed.includes('?') && GREETING_RE.test(trimmed);

  // 6b. Fetch layanan nama for dynamic persona (dipakai di prompt & context sapaan)
  const { data: layananData } = await adminClient
    .from('layanan')
    .select('nama')
    .eq('id', layanan_id)
    .single();
  const layananNama = layananData?.nama;

  let context: string;
  if (isWeekend) {
    // Weekend: petugas tidak bertugas. Bot menjawab hanya hal umum dan TIDAK
    // menawarkan eskalasi — pengunjung diarahkan kembali pada hari kerja.
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

  // 7. Generasi jawaban: jalur utama (SDK Gemini) → penyedia cadangan
  //    OpenAI-compatible (env LLM_CHAT_PROVIDERS) → jawaban jujur templat.
  let jawaban = '';
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
  if (reply && reply.text && reply.text.trim().length > 0) {
    jawaban = redactPii(reply.text);
  }
  if (!jawaban || jawaban.trim().length === 0) {
    if (isExactMatch) {
      await logAiCall(
        adminClient,
        sesi_id,
        pertanyaan,
        faqIds,
        null,
        topSim,
        true,
        'ai_error',
      );
      return NextResponse.json(
        { jawaban: null, eskalasi: true, reason: 'ai_error' },
      { status: 200 },
    );
  }
    jawaban = reply === null
      ? 'Terima kasih atas pertanyaan Anda. Mohon tunggu sebentar, petugas kami siap membantu Anda.'
      : 'Terima kasih atas pertanyaan Anda. Petugas loket kami siap membantu Anda lebih lanjut.';
  }

  // 8. INSERT to chat_ai_log for audit.
  // Eskalasi hanya bila pertanyaan substantif TIDAK terjawab dari FAQ. Sapaan /
  // basa-basi dan jawaban umum yang dihasilkan bot tidak boleh eskalasi.
  const eskalasi = !isExactMatch && !isWeekend && !isGreeting;
  await logAiCall(
    adminClient,
    sesi_id,
    pertanyaan,
    faqIds,
    jawaban,
    topSim,
    eskalasi,
    isExactMatch ? null : isWeekend ? 'weekend_mode' : isGreeting ? 'greeting' : 'no_match',
  );

  // 9. Persist bot reply server-side + broadcast (trust boundary: clients no
  // longer write bot messages). On eskalasi, move the session to eskalasi so
  // officers actually see it in their queue.
  const botPengirim = {
    sesi_id,
    pengirim: 'bot',
    isi: jawaban,
    sumber_faq_id: isExactMatch && faqMatches.length > 0 ? faqMatches[0].id : null,
  };
  const { error: botInsertErr } = await adminClient
    .from('chat_pesan')
    .insert(botPengirim)
    .select('id, pengirim, isi, created_at')
    .single();

  if (botInsertErr) {
    console.error('[api/chat/ai] gagal menyimpan pesan bot:', botInsertErr);
  }
  // Penyiaran realtime kini dari trigger DB / polling — lihat migrasi
  // 202609230001; tidak ada siaran per-request dari serverless.

  if (eskalasi) {
    const { error: statusErr } = await adminClient
      .from('chat_sesi')
      .update({ status: 'eskalasi' })
      .eq('id', sesi_id)
      .neq('status', 'selesai');
    if (statusErr) {
      console.error('[api/chat/ai] gagal mengubah status eskalasi:', statusErr);
    }
  }

  // 10. Return jawaban + sumber
  return NextResponse.json({
    jawaban,
    sumber: isExactMatch ? faqMatches.map((m) => ({ id: m.id, pertanyaan: m.pertanyaan })) : [],
    eskalasi,
    reason: isExactMatch ? null : isWeekend ? 'weekend_mode' : isGreeting ? 'greeting' : 'no_match',
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
