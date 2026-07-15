import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { getGenerativeClient, getEmbeddingModel } from '@/lib/gemini';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface FaqRowNeedingEmbed {
  id: string;
  pertanyaan: string;
  jawaban: string;
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

export async function POST() {
  // 1. Auth: must be admin
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (!petugas || petugas.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // 2. Service-role client for bulk UPDATE (bypasses RLS)
  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 500 },
    );
  }

  // 3. Gemini client
  const genAI = getGenerativeClient();
  if (!genAI) {
    return NextResponse.json(
      { error: 'Server misconfigured: GEMINI_API_KEY required' },
      { status: 500 },
    );
  }
  const embedModel = getEmbeddingModel(genAI);

  // 4. Fetch up to 50 FAQs missing embedding
  const { data: pending, error: fetchErr } = await adminClient
    .from('faq_knowledge_base')
    .select('id, pertanyaan, jawaban')
    .is('embedding', null)
    .limit(50);

  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to fetch pending FAQs: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  const rows: FaqRowNeedingEmbed[] = (pending ?? []) as FaqRowNeedingEmbed[];

  // 5. Embed + UPDATE each row
  let embedded = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      const input = `${row.pertanyaan}\n${row.jawaban}`;
      const result = await embedModel.embedContent(input);
      const vector = result.embedding.values;
      if (!vector || vector.length === 0) {
        failed++;
        continue;
      }
      // pgvector accepts a text representation like '[0.1,0.2,...]'.
      const vectorLiteral = `[${vector.join(',')}]`;
      const { error: updateErr } = await adminClient
        .from('faq_knowledge_base')
        .update({ embedding: vectorLiteral })
        .eq('id', row.id);
      if (updateErr) {
        failed++;
        continue;
      }
      embedded++;
    } catch {
      failed++;
    }
  }

  // 6. Count remaining (for progress UI)
  const { count: remaining } = await adminClient
    .from('faq_knowledge_base')
    .select('*', { count: 'exact', head: true })
    .is('embedding', null);

  return NextResponse.json({
    embedded,
    failed,
    remaining: remaining ?? 0,
  });
}
