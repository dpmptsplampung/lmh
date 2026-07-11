import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ============================================================
// Inovasi #7: Marketplace UMKM dua sisi — inquiry endpoint
// ============================================================
// Pengunjung mengirim pesan ke pemilik listing tanpa melihat
// kontak mentah pemilik. Kontak hanya dibuka setelah pemilik
// menyetujui (approve) inquiry lewat inbox magic-link (K5).
//
// Alur:
//   1. Validasi input (zod): listing_id uuid, from_email email,
//      from_nama opsional ≤200, pesan non-empty ≤2000.
//   2. Verifikasi listing ada + status='published'. Jika tidak
//      → 404.
//   3. INSERT via server client (RLS "umkm_inquiry_insert"
//      TO authenticated + rate limit). Fallback service-role
//      jika RLS menolak (sesuai pola skm/submit).
//   4. Return 201 dengan pesan generik. TIDAK mengembalikan
//      kontak_email/kontak_hp pemilik (no contact leak).
// ============================================================

const bodySchema = z.object({
  listing_id: z.uuid(),
  from_email: z.email(),
  from_nama: z.string().max(200).optional(),
  pesan: z.string().min(1).max(2000),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
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

  const { listing_id, from_email, from_nama, pesan } = parsed.data;

  const supabase = await createClient();

  // Verify listing exists + status='published'. Gunakan select kolom
  // minimal supaya kontak_email/kontak_hp TIDAK ikut terambil ke memori
  // route handler (defense-in-depth terhadap contact leak).
  const { data: listing, error: listingErr } = await supabase
    .from('listing_umkm')
    .select('id, status')
    .eq('id', listing_id)
    .maybeSingle();

  if (listingErr) {
    return NextResponse.json(
      { error: 'Gagal memverifikasi listing' },
      { status: 500 },
    );
  }

  if (!listing || listing.status !== 'published') {
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

  // INSERT path: try authenticated client first (RLS "umkm_inquiry_insert"
  // TO authenticated + rate limit), then fall back to service-role.
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
    const adminClient = getServiceClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Gagal mengirim pesan' },
        { status: 500 },
      );
    }

    let adminResult: InsertResult;
    try {
      adminResult = await adminClient
        .from('umkm_inquiry')
        .insert(insertPayload)
        .select('id')
        .single() as unknown as InsertResult;
    } catch (err) {
      adminResult = { data: null, error: err as InsertErr };
    }

    if (adminResult.error || !adminResult.data) {
      return NextResponse.json(
        { error: 'Gagal mengirim pesan' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        id: adminResult.data.id,
        message:
          'Pesan Anda terkirim ke pemilik listing. Anda akan dihubungi jika disetujui.',
      },
      { status: 201 },
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
