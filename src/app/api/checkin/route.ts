import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

// I9: Route handler for checkin — used by both online form submit and
// offline replay. Centralizes the visit INSERT + consent log so the
// offline replay path is identical to the online path.

const bodySchema = z.object({
  nama: z.string().min(1).max(200),
  layanan_id: z.uuid(),
  keperluan: z.string().max(2000).optional(),
  pengunjung_id: z.uuid().optional(),
  consent_given: z.boolean().optional(),
  versi_kebijakan: z.string().min(1).max(32).optional(),
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

  const { nama, layanan_id, keperluan, consent_given, versi_kebijakan } = parsed.data;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  // Authenticated callers must explicitly assert consent before any consent_log write.
  // Offline replay must carry the same assertion from the offline form.
  if (user) {
    if (consent_given !== true) {
      return NextResponse.json(
        { error: 'Consent required', code: 'CONSENT_REQUIRED' },
        { status: 400 },
      );
    }

    const { error: consentError } = await supabase.from('consent_log').insert({
      subjek_ref: user.id,
      tujuan: 'checkin_data',
      disetujui: true,
      versi_kebijakan: versi_kebijakan ?? '1.0',
    });

    if (consentError) {
      return NextResponse.json(
        { error: 'Gagal mencatat consent', code: 'CONSENT_FAILED' },
        { status: 500 },
      );
    }
  }

  const { error: insertError, data: insertData } = await supabase
    .from('visit')
    .insert({
      asal: 'walk_in',
      nama: nama.trim(),
      keperluan: keperluan?.trim() || null,
      layanan_id,
      tujuan: 'loket',
      status: 'menunggu',
      waktu_masuk: new Date().toISOString(),
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    return NextResponse.json(
      { error: `Gagal menyimpan: ${insertError.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { id: insertData?.id, message: 'Check-in berhasil' },
    { status: 201 },
  );
}
