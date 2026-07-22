import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const bodySchema = z.object({
  doc_id: z.uuid(),
  nama: z.string().min(1).max(200),
  email: z.email(),
  instansi: z.string().max(200).optional(),
  minat: z.string().max(1000).optional(),
  catatan: z.string().max(2000).optional(),
});

export async function POST(request: NextRequest) {
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

  const { doc_id, nama, email, instansi, minat, catatan } = parsed.data;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Sesi diperlukan. Silakan masuk terlebih dahulu.', code: 'AUTH_REQUIRED' },
      { status: 401 },
    );
  }

  const { data: doc, error: docErr } = await supabase
    .from('investment_documents')
    .select('id, status')
    .eq('id', doc_id)
    .maybeSingle();

  if (docErr) {
    console.error('[investasi/lead] gagal mengambil dokumen', docErr);
    return NextResponse.json(
      { error: 'Gagal memuat dokumen. Silakan coba lagi.' },
      { status: 500 },
    );
  }

  if (!doc || doc.status !== 'aktif') {
    return NextResponse.json(
      { error: 'Dokumen tidak ditemukan' },
      { status: 404 },
    );
  }

  const insertPayload = {
    doc_id,
    nama,
    email,
    instansi: instansi ?? null,
    minat: minat ?? null,
    catatan: catatan ?? null,
  };

  type InsertErr = { code?: string; message?: string } | null;

  let insertErr: InsertErr = null;
  let insertData: { id: string } | null = null;
  try {
    const res = await supabase.from('investasi_lead').insert(insertPayload).select('id').maybeSingle();
    insertErr = res.error as InsertErr;
    insertData = res.data as { id: string } | null;
  } catch (err) {
    insertErr = err as InsertErr;
  }

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'Permintaan sudah tercatat' },
        { status: 409 },
      );
    }
    if (
      insertErr.code === '42501' ||
      /row-level security|rate|check_anon_rate/i.test(insertErr.message ?? '')
    ) {
      return NextResponse.json(
        { error: 'Terlalu banyak permintaan. Coba lagi nanti.', code: 'RATE_LIMIT' },
        { status: 429 },
      );
    }
    console.error('[investasi/lead] gagal menyimpan lead', insertErr);
    return NextResponse.json(
      { error: 'Gagal mengirim permintaan. Silakan coba lagi.' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      id: insertData?.id,
      message: 'Permintaan minat investasi Anda tercatat. Tim kami akan menghubungi Anda.',
    },
    { status: 201 },
  );
}
