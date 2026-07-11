import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getGenerativeClient, getChatModel, buildRagContext, type FaqMatch } from '@/lib/gemini';

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

  const { pertanyaan, layanan_id, sesi_id } = parsed.data;

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

  // 3. Embed the user's question
  let queryEmbedding: number[];
  try {
    const embedModel = genAI.getGenerativeModel({
      model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
    });
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

  // 5. No matches OR top-1 similarity < 0.7 → eskalasi
  if (faqMatches.length === 0 || faqMatches[0].similarity < SIMILARITY_THRESHOLD) {
    const topSim = faqMatches.length > 0 ? faqMatches[0].similarity : null;
    await logAiCall(
      adminClient,
      sesi_id,
      pertanyaan,
      [],
      null,
      topSim,
      true,
      'no_match',
    );
    return NextResponse.json(
      { jawaban: null, eskalasi: true, reason: 'no_match' },
      { status: 200 },
    );
  }

  // 6. Build context from top-5 FAQ
  const context = buildRagContext(faqMatches);
  const faqIds = faqMatches.map((m) => m.id);

  // 7. Call Gemini with the strict system prompt
  let jawaban: string;
  try {
    const chatModel = getChatModel(genAI);
    const result = await chatModel.generateContent([
      context,
      pertanyaan,
    ]);
    jawaban = result.response.text();
    if (!jawaban || jawaban.trim().length === 0) {
      await logAiCall(
        adminClient,
        sesi_id,
        pertanyaan,
        faqIds,
        null,
        faqMatches[0].similarity,
        true,
        'ai_error',
      );
      return NextResponse.json(
        { jawaban: null, eskalasi: true, reason: 'ai_error' },
        { status: 200 },
      );
    }
  } catch {
    await logAiCall(
      adminClient,
      sesi_id,
      pertanyaan,
      faqIds,
      null,
      faqMatches[0].similarity,
      true,
      'ai_error',
    );
    return NextResponse.json(
      { jawaban: null, eskalasi: true, reason: 'ai_error' },
      { status: 200 },
    );
  }

  // 8. INSERT to chat_ai_log for audit
  await logAiCall(
    adminClient,
    sesi_id,
    pertanyaan,
    faqIds,
    jawaban,
    faqMatches[0].similarity,
    false,
    null,
  );

  // 9. Return jawaban + sumber
  return NextResponse.json({
    jawaban,
    sumber: faqMatches.map((m) => ({ id: m.id, pertanyaan: m.pertanyaan })),
    eskalasi: false,
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
