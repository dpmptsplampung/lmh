import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

const bodySchema = z.object({
  visit_id: z.uuid(),
  layanan_id: z.uuid(),
  u1: z.number().int().min(1).max(4),
  u2: z.number().int().min(1).max(4),
  u3: z.number().int().min(1).max(4),
  u4: z.number().int().min(1).max(4),
  u5: z.number().int().min(1).max(4),
  u6: z.number().int().min(1).max(4),
  u7: z.number().int().min(1).max(4),
  u8: z.number().int().min(1).max(4),
  u9: z.number().int().min(1).max(4),
  saran: z.string().max(2000).optional(),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

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

  const { visit_id, layanan_id, u1, u2, u3, u4, u5, u6, u7, u8, u9, saran } = parsed.data;

  const supabase = await createClient();

  // Verify visit exists and status='selesai'
  const { data: visit, error: visitErr } = await supabase
    .from('visit')
    .select('id, layanan_id, status')
    .eq('id', visit_id)
    .maybeSingle();

  if (visitErr) {
    return NextResponse.json(
      { error: `Failed to fetch visit: ${visitErr.message}` },
      { status: 500 },
    );
  }

  if (!visit) {
    return NextResponse.json(
      { error: 'Visit not found' },
      { status: 404 },
    );
  }

  if (visit.status !== 'selesai') {
    return NextResponse.json(
      { error: 'Survei tersedia setelah layanan Anda selesai' },
      { status: 400 },
    );
  }

  // Check if already submitted. RLS policy `skm_select_staff` is TO authenticated
  // only, so an anon visitor's SELECT via the cookie-bound server client silently
  // returns null. Use the service-role client for the duplicate check so it
  // actually sees existing rows regardless of the caller's auth state. The DB
  // partial unique index (migration 031) is the real enforcement; this SELECT
  // is a fast-path UX nicety for authenticated users.
  const adminCheckClient = getServiceClient();
  if (adminCheckClient) {
    const { data: existing } = await adminCheckClient
      .from('skm_respons')
      .select('id')
      .eq('visit_id', visit_id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: 'Anda sudah mengisi survei ini. Terima kasih.' },
        { status: 409 },
      );
    }
  }

  const insertPayload = {
    visit_id,
    layanan_id: layanan_id || visit.layanan_id,
    u1_persyaratan: u1,
    u2_prosedur: u2,
    u3_waktu: u3,
    u4_biaya: u4,
    u5_produk: u5,
    u6_kompetensi: u6,
    u7_perilaku: u7,
    u8_sarana: u8,
    u9_pengaduan: u9,
    saran: saran ?? null,
  };

  // INSERT path: try authenticated client first (RLS "skm_insert" TO authenticated),
  // then fall back to service-role. Either path can raise `23505` (unique_violation)
  // from the partial unique index — map that to 409 so the form can transition to
  // already_submitted state on a race.
  type InsertErr = { code?: string; message?: string } | null;

  // Try authenticated client first (RLS policy "skm_insert" TO authenticated)
  let insertErr: InsertErr = null;
  try {
    const res = await supabase.from('skm_respons').insert(insertPayload);
    insertErr = res.error as InsertErr;
  } catch (err) {
    insertErr = err as InsertErr;
  }

  if (insertErr) {
    if (insertErr.code === '23505') {
      return NextResponse.json(
        { error: 'Anda sudah mengisi survei ini' },
        { status: 409 },
      );
    }
    // Fallback to service-role client if RLS rejects the public INSERT
    const adminClient = getServiceClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: `Failed to submit SKM: ${insertErr.message}` },
        { status: 500 },
      );
    }

    let adminInsertErr: InsertErr = null;
    try {
      const res = await adminClient.from('skm_respons').insert(insertPayload);
      adminInsertErr = res.error as InsertErr;
    } catch (err) {
      adminInsertErr = err as InsertErr;
    }

    if (adminInsertErr) {
      if (adminInsertErr.code === '23505') {
        return NextResponse.json(
          { error: 'Anda sudah mengisi survei ini' },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: `Failed to submit SKM: ${adminInsertErr.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json(
    { message: 'Terima kasih atas penilaian Anda.' },
    { status: 201 },
  );
}
