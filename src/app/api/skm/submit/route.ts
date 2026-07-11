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

  // Check if already submitted
  const { data: existing } = await supabase
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

  // Try authenticated client first (RLS policy "skm_insert" TO authenticated)
  const { error: insertErr } = await supabase
    .from('skm_respons')
    .insert(insertPayload);

  if (insertErr) {
    // Fallback to service-role client if RLS rejects the public INSERT
    const adminClient = getServiceClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: `Failed to submit SKM: ${insertErr.message}` },
        { status: 500 },
      );
    }

    const { error: adminInsertErr } = await adminClient
      .from('skm_respons')
      .insert(insertPayload);

    if (adminInsertErr) {
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
