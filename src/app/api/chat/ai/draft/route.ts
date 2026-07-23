import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getGenerativeClient, getChatModel, buildRagContext, type FaqMatch } from '@/lib/gemini';
import { redactPii } from '@/lib/pii';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const bodySchema = z.object({
  sesi_id: z.uuid(),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  // 1. Authenticate caller (Must be logged in user)
  const serverClient = await createServerClient();
  const { data: { user: caller } } = await serverClient.auth.getUser();
  if (!caller) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
  }

  // 2. Verify caller is a petugas/admin
  const { data: petugasRow, error: petugasErr } = await adminClient
    .from('petugas')
    .select('id, role')
    .eq('auth_user_id', caller.id)
    .maybeSingle();

  if (petugasErr || !petugasRow) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 3. Validate input
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { sesi_id } = parsed.data;

  // 4. Fetch session details
  const { data: sesiRow, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('id, layanan_id')
    .eq('id', sesi_id)
    .maybeSingle();

  if (sesiErr || !sesiRow) {
    return NextResponse.json({ error: 'Sesi chat tidak ditemukan' }, { status: 404 });
  }

  // 5. Fetch recent chat messages for context (last 5)
  const { data: rawMessages } = await adminClient
    .from('chat_pesan')
    .select('pengirim, isi')
    .eq('sesi_id', sesi_id)
    .order('created_at', { ascending: false })
    .limit(5);

  const messages = (rawMessages || []).reverse();
  const lastVisitorMsg = [...messages].reverse().find((m) => m.pengirim === 'pengunjung')?.isi || '';

  // 6. Gemini Client & RAG FAQ Match
  const genAI = getGenerativeClient();
  if (!genAI) {
    return NextResponse.json({ error: 'Gemini service unavailable' }, { status: 503 });
  }

  let matches: FaqMatch[] = [];
  if (lastVisitorMsg) {
    try {
      const embedModel = genAI.getGenerativeModel({
        model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004',
      });
      const embedRes = await embedModel.embedContent(redactPii(lastVisitorMsg));
      if (embedRes.embedding.values?.length) {
        const vectorLiteral = `[${embedRes.embedding.values.join(',')}]`;
        const { data: faqMatches } = await adminClient.rpc('match_faq', {
          query_embedding: vectorLiteral,
          p_layanan_id: sesiRow.layanan_id,
          match_count: 3,
        });
        matches = (faqMatches || []) as FaqMatch[];
      }
    } catch {
      /* fallback to empty matches */
    }
  }

  // Fetch Layanan nama
  const { data: layananData } = await adminClient
    .from('layanan')
    .select('nama')
    .eq('id', sesiRow.layanan_id)
    .single();

  const layananNama = layananData?.nama || 'DPMPTSP';
  const ragContext = buildRagContext(matches);

  const chatHistoryStr = messages
    .map((m) => `${m.pengirim.toUpperCase()}: ${m.isi}`)
    .join('\n');

  // 7. Prompt Gemini for Officer Draft
  try {
    const chatModel = getChatModel(genAI, layananNama);
    const copilotPrompt = `Sebagai asisten Copilot Petugas ${layananNama}, buatlah DRAF BALASAN RINGKAS, RAMAH, DAN SOPAN untuk petugas kirimkan kepada pengunjung.
Konteks Percakapan:
${chatHistoryStr}

${ragContext}

Buat balasan dalam Bahasa Indonesia resmi yang siap dikirim petugas.`;

    const result = await chatModel.generateContent([copilotPrompt]);
    const draftText = redactPii(result.response.text());

    return NextResponse.json({ draft: draftText });
  } catch {
    return NextResponse.json({ error: 'Gagal membuat draf balasan' }, { status: 500 });
  }
}
