import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

const bodySchema = z.object({
  listing_id: z.uuid(),
  from_email: z.email(),
  from_nama: z.string().max(200).optional(),
  pesan: z.string().min(1).max(2000),
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

  const { listing_id, from_email, from_nama, pesan } = parsed.data;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'Sesi diperlukan. Silakan masuk terlebih dahulu.', code: 'AUTH_REQUIRED' },
      { status: 401 },
    );
  }

  const { data: listing, error: listingErr } = await supabase
    .from('v_umkm_public')
    .select('id')
    .eq('id', listing_id)
    .maybeSingle();

  if (listingErr) {
    return NextResponse.json(
      { error: 'Gagal memverifikasi listing' },
      { status: 500 },
    );
  }

  if (!listing) {
    return NextResponse.json(
      { error: 'Listing tidak ditemukan atau tidak tayang' },
      { status: 404 },
    );
  }

  const insertPayload = {
    listing_id,
    from_email,
    from_nama: from_nama ?? null,
    pesan,
  };

  type InsertErr = { code?: string; message?: string } | null;
  type InsertResult = { data: { id: string } | null; error: InsertErr };

  let insertResult: InsertResult;
  try {
    insertResult = await supabase
      .from('umkm_inquiry')
      .insert(insertPayload)
      .select('id')
      .single() as unknown as InsertResult;
  } catch (err) {
    insertResult = { data: null, error: err as InsertErr };
  }

  if (insertResult.error) {
    if (
      insertResult.error.code === '42501' ||
      /row-level security|rate|check_anon_rate/i.test(insertResult.error.message ?? '')
    ) {
      return NextResponse.json(
        { error: 'Terlalu banyak permintaan. Coba lagi nanti.', code: 'RATE_LIMIT' },
        { status: 429 },
      );
    }
    return NextResponse.json(
      { error: 'Gagal mengirim pesan' },
      { status: 500 },
    );
  }

  if (!insertResult.data) {
    return NextResponse.json(
      { error: 'Gagal mengirim pesan' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      id: insertResult.data.id,
      message:
        'Pesan Anda terkirim ke pemilik listing. Anda akan dihubungi jika disetujui.',
    },
    { status: 201 },
  );
}
