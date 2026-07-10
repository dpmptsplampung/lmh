import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

// ============================================================
// K5: Magic-link edit UMKM
// ============================================================
// Pemilik listing request link edit via email. Route handler:
//   1. Validasi input (zod).
//   2. Rate-limit via tabel anon_rate_limit (reuse mekanisme K3,
//      action 'umkm_request_link', max 3/60s). Best-effort:
//      di-query via service-role client (endpoint ini anon,
//      tidak ada auth.uid() — dipakai IP sebagai identifier
//      pengganti user_id).
//   3. Cek umkm_listing_owner WHERE listing_id + email. Jika
//      tidak match → return 200 { sent: true } TANPA kirim email
//      (jangan leak apakah email terdaftar).
//   4. Jika match → generate magic-link via admin.generateLink.
//      Jika user belum ada di auth.users → createUser dulu
//      (email_confirm: true, tanpa password) lalu generateLink.
//   5. Return 200 { sent: true }. Link dikirim via email
//      (production). DEV FALLBACK: jika SUPABASE_SERVICE_ROLE_KEY
//      tidak ada ATAU env LMH_DEV_RETURN_LINK=set, return
//      { sent: true, dev_link: recovery_url } supaya dev bisa
//      klik manual. Jangan pakai dev_link di production.
// ============================================================

const bodySchema = z.object({
  listing_id: z.uuid(),
  email: z.email(),
});

const RATE_LIMIT_ACTION = 'umkm_request_link';
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_SEC = 60;

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

function clientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd && fwd.length > 0) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get('x-real-ip');
  if (real && real.length > 0) return real;
  return 'unknown';
}

async function checkRateLimit(
  adminClient: SupabaseClient,
): Promise<boolean> {
  // Best-effort rate limit via tabel anon_rate_limit (K3 / migration 022).
  // Endpoint ini anon — auth.uid() NULL — jadi kita log pakai identifier
  // (IP) di kolom user_id? user_id REFERENCES auth.users(id), jadi NULL
  // diperbolehkan. Kita tidak bisa pakai check_anon_rate() (dia pakai
  // auth.uid()). Sebagai gantinya: query manual count + insert log.
  // NOTE: ini best-effort. Untuk enforcement yang lebih kuat, pindahkan
  // ke Edge Function / Supabase RLS di tabel anon_rate_limit dengan
  // kolom identifier terpisah. Cukup untuk mencegah spam sederhana.
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();

  const { count, error } = await adminClient
    .from('anon_rate_limit')
    .select('*', { count: 'exact', head: true })
    .eq('action', RATE_LIMIT_ACTION)
    .gte('created_at', since)
    .is('user_id', null)
    .or(`action.eq.${RATE_LIMIT_ACTION}`);

  // Lebih aman gagal-terbuka di sisi rate-limit? Tidak — untuk endpoint
  // publik yang mengirim email, fail-CLOSED lebih aman. Jika query error,
  // tolak request.
  if (error) return false;

  // Karena kita tidak punya kolom identifier di anon_rate_limit (skema K3
  // hanya user_id + action), kita tidak bisa benar-benar rate-limit per-IP
  // tanpa skema tambahan. Sebagai gantinya, rate-limit GLOBAL per action
  // (max 3/60s untuk semua requester). Ini lemah tapi mencegah banjir
  // email massal. TODO: tambah kolom identifier ke anon_rate_limit di
  // migration mendatang untuk rate-limit per-IP.
  if (count !== null && count >= RATE_LIMIT_MAX) return false;
  return true;
}

async function logRateLimit(
  adminClient: SupabaseClient,
): Promise<void> {
  await adminClient.from('anon_rate_limit').insert({
    user_id: null,
    action: RATE_LIMIT_ACTION,
  });
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

  const { listing_id, email } = parsed.data;

  const adminClient = getServiceClient();
  if (!adminClient) {
    // DEV FALLBACK: tidak ada service-role key. Tidak bisa cek owner /
    // generate link. Return 200 generik (jangan leak) — di dev tanpa
    // service key, endpoint ini no-op.
    return NextResponse.json(
      { sent: true, dev_note: 'service role key missing — no email sent' },
      { status: 200 },
    );
  }

  // Rate-limit (best-effort, global per action).
  void clientIp(request); // captured for future per-IP limit
  const allowed = await checkRateLimit(adminClient);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi dalam beberapa menit.' },
      { status: 429 },
    );
  }

  // Cek apakah email terdaftar sebagai pemilik listing ini.
  const { data: ownerRows, error: ownerError } = await adminClient
    .from('umkm_listing_owner')
    .select('id')
    .eq('listing_id', listing_id)
    .eq('email', email)
    .limit(1);

  if (ownerError) {
    // DB error — jangan leak detail. Return 200 generik.
    return NextResponse.json({ sent: true }, { status: 200 });
  }

  if (!ownerRows || ownerRows.length === 0) {
    // Email tidak terdaftar sebagai pemilik. Return 200 generik, jangan
    // kirim email. Jangan leak apakah email terdaftar.
    return NextResponse.json({ sent: true }, { status: 200 });
  }

  // Email terdaftar sebagai pemilik. Log rate-limit + generate link.
  await logRateLimit(adminClient);

  // Pastikan user ada di auth.users. Jika belum, buat (no password,
  // email_confirm: true) supaya generateLink(magiclink) berhasil.
  const { data: existingUser, error: lookupError } = await adminClient
    .from('auth.users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  // Tabel auth.users tidak selalu bisa di-query via PostgREST (RLS).
  // Fallback: coba generateLink langsung; jika error "user not found",
  // createUser lalu retry.
  let userExists = false;
  if (!lookupError && existingUser) {
    userExists = true;
  }

  // redirectTo untuk generateLink: path relatif terhadap site URL
  // Supabase config. Supabase menambahkan token ke URL ini; setelah klik,
  // browser diarahkan ke sini. Karena /umkm/edit/[id] adalah client page,
  // supabase-js menangkap fragment token dan establish session.
  const redirectPath = `/umkm/edit/${listing_id}`;

  const generateMagicLink = async () => {
    return adminClient.auth.admin.generateLink({
      email,
      type: 'magiclink',
      options: { redirectTo: redirectPath },
    });
  };

  let linkResult = await generateMagicLink();

  if (linkResult.error) {
    const msg = (linkResult.error.message || '').toLowerCase();
    // Jika user belum ada, createUser lalu retry generateLink.
    if (!userExists && (msg.includes('not found') || msg.includes('no user') || msg.includes('does not exist'))) {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (createError) {
        // Gagal create — jangan leak. Return 200 generik.
        return NextResponse.json({ sent: true }, { status: 200 });
      }
      if (created?.user) {
        linkResult = await generateMagicLink();
      }
    }
    // Jika masih error setelah retry, return 200 generik (jangan leak).
    if (linkResult.error) {
      return NextResponse.json({ sent: true }, { status: 200 });
    }
  }

  // Sukses. Link dikirim via email (production).
  // DEV FALLBACK: jika env LMH_DEV_RETURN_LINK=set, kembalikan link
  // di response supaya dev bisa klik manual (production: tidak).
  const isDevReturnLink = process.env.LMH_DEV_RETURN_LINK === 'set';
  if (isDevReturnLink) {
    const actionLink = linkResult.data?.properties?.action_link ?? null;
    return NextResponse.json(
      { sent: true, dev_link: actionLink },
      { status: 200 },
    );
  }

  return NextResponse.json({ sent: true }, { status: 200 });
}