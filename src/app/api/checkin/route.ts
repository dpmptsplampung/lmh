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
  // Idempotensi: uuid dari klien (klik ganda / replay offline → 1 kunjungan).
  client_request_id: z.string().uuid().optional(),
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

  // Resolve ownership from the session — never trust client-supplied pengunjung_id.
  let resolvedPengunjungId: string | null = null;

  // Authenticated callers must explicitly assert consent before any consent_log write.
  // Offline replay must carry the same assertion from the offline form.
  if (user) {
    if (consent_given !== true) {
      return NextResponse.json(
        { error: 'Consent required', code: 'CONSENT_REQUIRED' },
        { status: 400 },
      );
    }

    const { data: pengunjungRow } = await supabase
      .from('pengunjung')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    resolvedPengunjungId = pengunjungRow?.id ?? null;

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
      ...(parsed.data.client_request_id
        ? { client_request_id: parsed.data.client_request_id }
        : {}),
      // Bind to authenticated profile when present so SKM/notif/history attach.
      ...(resolvedPengunjungId ? { pengunjung_id: resolvedPengunjungId } : {}),
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    // Duplikat idempotensi: kembalikan kunjungan yang sudah ada (200).
    if (
      (insertError as { code?: string }).code === '23505' &&
      parsed.data.client_request_id
    ) {
      const { data: existing } = await supabase
        .from('visit')
        .select('id')
        .eq('client_request_id', parsed.data.client_request_id)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { id: existing.id, message: 'Check-in sudah tercatat', duplicate: true },
          { status: 200 },
        );
      }
    }
    console.error('[checkin] gagal menyimpan visit', insertError);
    return NextResponse.json(
      { error: 'Gagal menyimpan. Silakan coba lagi.' },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { id: insertData?.id, message: 'Check-in berhasil' },
    { status: 201 },
  );
}
