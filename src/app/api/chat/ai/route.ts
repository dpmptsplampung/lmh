import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getGenerativeClient, getChatModel, buildRagContext, type FaqMatch } from '@/lib/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  pertanyaan: z.string().min(3),
  layanan_id: z.uuid(),
  sesi_id: z.uuid(),
});

const SIMILARITY_THRESHOLD = 0.7;

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
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
