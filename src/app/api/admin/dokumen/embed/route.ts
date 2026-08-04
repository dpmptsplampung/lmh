// WP-27 / BOT-02/03: Chunk dokumen_peraturan text and embed each chunk.
// Called by admin/dokumen/page.tsx after saving a new document.
// Chunking strategy: split by paragraph (double newline), max 1500 chars each.

import { createClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { parseServerEnv } from '@/lib/env/server';
import { NextRequest, NextResponse } from 'next/server';
import { getGenerativeClient, getEmbeddingModel } from '@/lib/gemini';

const MAX_CHUNK = 1500;
const OVERLAP   = 100;

function chunkText(text: string): string[] {
  // Split on double newlines (paragraphs / pasal boundaries)
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = [];

  for (const para of paragraphs) {
    if (para.length <= MAX_CHUNK) {
      chunks.push(para);
    } else {
      // Hard-split long paragraphs with overlap
      let start = 0;
      while (start < para.length) {
        chunks.push(para.slice(start, start + MAX_CHUNK));
        start += MAX_CHUNK - OVERLAP;
      }
    }
  }
  return chunks.filter(c => c.length > 20);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // Auth check
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role')
    .eq('auth_user_id', user.id)
    .single();
  if (petugas?.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya Admin' }, { status: 403 });
  }

  const { dokumen_id } = await req.json();
  if (!dokumen_id) return NextResponse.json({ error: 'dokumen_id wajib' }, { status: 400 });

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(dokumen_id)) {
    return NextResponse.json({ error: 'dokumen_id harus UUID valid' }, { status: 400 });
  }

  const env = parseServerEnv();
  const serviceClient = createServiceRoleClient(env);

  // Fetch source document
  const { data: dok, error: dokErr } = await supabase
    .from('dokumen_peraturan')
    .select('id, teks_utama, status')
    .eq('id', dokumen_id)
    .single();

  if (dokErr || !dok) return NextResponse.json({ error: 'Dokumen tidak ditemukan' }, { status: 404 });
  if (dok.status === 'dicabut') return NextResponse.json({ error: 'Dokumen sudah dicabut' }, { status: 400 });
  if (!dok.teks_utama?.trim()) return NextResponse.json({ error: 'Teks dokumen kosong' }, { status: 400 });

  // Delete existing chunks (re-embed is safe since we replace all)
  await serviceClient.from('dokumen_potongan').delete().eq('dokumen_id', dokumen_id);

  // Chunk the text
  const chunks = chunkText(dok.teks_utama);
  if (chunks.length === 0) return NextResponse.json({ error: 'Tidak ada teks yang bisa diproses' }, { status: 400 });

  // Embed each chunk using Gemini
  try {
    const geminiClient = getGenerativeClient();
    if (!geminiClient) return NextResponse.json({ error: 'GEMINI_API_KEY tidak dikonfigurasi' }, { status: 503 });
    const embeddingModel = getEmbeddingModel(geminiClient);
    const embeddedChunks: Array<{ dokumen_id: string; nomor_pasal: string | null; teks: string; embedding: number[]; embedding_updated_at: string; perlu_embed_ulang: boolean }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const result = await embeddingModel.embedContent(chunk);
      const embedding = result.embedding.values;
      embeddedChunks.push({
        dokumen_id,
        nomor_pasal: null,
        teks: chunk,
        embedding: embedding as number[],
        embedding_updated_at: new Date().toISOString(),
        perlu_embed_ulang: false,
      });
    }

    // Insert all chunks
    const { error: insertErr } = await serviceClient
      .from('dokumen_potongan')
      .insert(embeddedChunks);

    if (insertErr) throw insertErr;

    return NextResponse.json({ ok: true, potongan: embeddedChunks.length });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Embedding gagal';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}