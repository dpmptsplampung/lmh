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

  const { nama, layanan_id, keperluan } = parsed.data;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (user) {
    await supabase.from('consent_log').insert({
      subjek_ref: user.id,
      tujuan: 'checkin_data',
      disetujui: true,
      versi_kebijakan: '1.0',
    });
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
