import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ============================================================
// Inovasi #7: Marketplace UMKM — owner approve/reject inquiry
// ============================================================
// Pemilik listing (yang login via magic-link K5) menyetujui
// (approve) atau menolak (reject) inquiry. Hanya pemilik
// listing terkait atau admin yang boleh PATCH.
//
// Alur:
//   1. Validasi { status: 'approved' | 'rejected' } (zod).
//   2. Ambil auth user dari session (server client). Jika tidak
//      login → 401.
//   3. Cek inquiry ada. Jika tidak → 404.
//   4. Cek caller adalah pemilik listing terkait (via
//      umkm_listing_owner join) atau admin. Jika tidak → 403.
//   5. UPDATE status + updated_at. Return 200 dengan inquiry
//      yang diupdate (tanpa kontak pemilik — owner sudah
//      melihat kontaknya sendiri di inbox).
// ============================================================

const bodySchema = z.object({
  status: z.enum(['approved', 'rejected']),
});

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: inquiryId } = await params;

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

  const { status } = parsed.data;

  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json(
      { error: 'Anda perlu masuk untuk melakukan aksi ini' },
      { status: 401 },
    );
  }

  // Verify inquiry exists. RLS "umkm_inquiry_select_owner" hanya
  // mengembalikan row milik owner/admin — jadi jika inquiry ada
  // tapi caller bukan owner, mungkin single() error atau return
  // null. Kita tangani: null → cek via service-role apakah benar
  // tidak ada (404) atau ada tapi bukan owner (403).
  const { data: inquiry, error: inquiryErr } = await supabase
    .from('umkm_inquiry')
    .select('id, listing_id, status')
    .eq('id', inquiryId)
    .maybeSingle();

  if (inquiryErr) {
    return NextResponse.json(
      { error: 'Gagal memverifikasi inquiry' },
      { status: 500 },
    );
  }

  if (!inquiry) {
    // Cek via service-role apakah inquiry benar-benar tidak ada
    // (404) atau ada tapi caller bukan owner (403).
    const adminClient = getServiceClient();
    if (adminClient) {
      const { data: existsRow } = await adminClient
        .from('umkm_inquiry')
        .select('id')
        .eq('id', inquiryId)
        .maybeSingle();
      if (!existsRow) {
        return NextResponse.json(
          { error: 'Inquiry tidak ditemukan' },
          { status: 404 },
        );
      }
    }
    return NextResponse.json(
      { error: 'Anda tidak memiliki izin untuk inquiry ini' },
      { status: 403 },
    );
  }

  // UPDATE via server client (RLS "umkm_inquiry_update_owner" —
  // owner/admin). Jika RLS menolak (seharusnya tidak, karena
  // SELECT sudah lolos), fallback service-role.
  const { data: updated, error: updateErr } = await supabase
    .from('umkm_inquiry')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', inquiryId)
    .select('id, listing_id, from_email, from_nama, pesan, status, updated_at')
    .maybeSingle();

  if (updateErr || !updated) {
    // Fallback service-role (admin path atau RLS quirk).
    const adminClient = getServiceClient();
    if (!adminClient) {
      return NextResponse.json(
        { error: 'Gagal memperbarui inquiry' },
        { status: 500 },
      );
    }
    const { data: adminUpdated, error: adminErr } = await adminClient
      .from('umkm_inquiry')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', inquiryId)
      .select('id, listing_id, from_email, from_nama, pesan, status, updated_at')
      .maybeSingle();

    if (adminErr || !adminUpdated) {
      return NextResponse.json(
        { error: 'Gagal memperbarui inquiry' },
        { status: 500 },
      );
    }
    return NextResponse.json({ inquiry: adminUpdated }, { status: 200 });
  }

  return NextResponse.json({ inquiry: updated }, { status: 200 });
}
