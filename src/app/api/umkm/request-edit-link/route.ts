import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient, type SupabaseClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { z } from 'zod';

// ============================================================
// K5: Magic-link edit UMKM
// ============================================================
// Pemilik listing request link edit via email. Route handler:
//   1. Validasi input (zod).
//   2. Rate-limit via tabel anon_rate_limit.
//   3. Cek umkm_listing_owner WHERE listing_id + email. Jika
//      tidak match → return 200 { sent: true } TANPA kirim email
//      (jangan leak apakah email terdaftar).
//   4. Jika match → generate magic-link via admin.generateLink.
//      Jika user belum ada di auth.users → createUser dulu.
//   5. Kirim email via Resend dengan absolute callback URL.
//      Jika Resend/config missing → 503 (bukan fake success).
//      DEV: APP_ENV=development AND LMH_DEV_RETURN_LINK=set
//      boleh return { sent: true, dev_link } (tidak di production).
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

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function publicBaseUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_PUBLIC_URL;
  if (!url) return null;
  return url.replace(/\/$/, '');
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
  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();

  const { count, error } = await adminClient
    .from('anon_rate_limit')
    .select('*', { count: 'exact', head: true })
    .eq('action', RATE_LIMIT_ACTION)
    .gte('created_at', since)
    .is('user_id', null);

  if (error) return false;
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

function canReturnDevLink(): boolean {
  return (
    process.env.APP_ENV === 'development' &&
    process.env.LMH_DEV_RETURN_LINK === 'set'
  );
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
    return NextResponse.json(
      { error: 'Service unavailable — email delivery not configured' },
      { status: 503 },
    );
  }

  // Rate-limit (best-effort, global per action).
  void clientIp(request);
  const allowed = await checkRateLimit(adminClient);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi dalam beberapa menit.' },
      { status: 429 },
    );
  }

  await logRateLimit(adminClient);

  const { data: ownerRows, error: ownerError } = await adminClient
    .from('umkm_listing_owner')
    .select('id')
    .eq('listing_id', listing_id)
    .eq('email', email)
    .limit(1);

  if (ownerError) {
    return NextResponse.json({ sent: true }, { status: 200 });
  }

  if (!ownerRows || ownerRows.length === 0) {
    return NextResponse.json({ sent: true }, { status: 200 });
  }

  const base = publicBaseUrl();
  const resend = getResend();
  if (!base || !resend) {
    return NextResponse.json(
      { error: 'Service unavailable — email delivery not configured' },
      { status: 503 },
    );
  }

  const redirectTo = `${base}/auth/callback?next=/umkm/edit/${listing_id}`;

  const { data: existingUser, error: lookupError } = await adminClient
    .from('auth.users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let userExists = false;
  if (!lookupError && existingUser) {
    userExists = true;
  }

  const generateMagicLink = async () => {
    return adminClient.auth.admin.generateLink({
      email,
      type: 'magiclink',
      options: { redirectTo },
    });
  };

  let linkResult = await generateMagicLink();

  if (linkResult.error) {
    const msg = (linkResult.error.message || '').toLowerCase();
    if (!userExists && (msg.includes('not found') || msg.includes('no user') || msg.includes('does not exist'))) {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (createError) {
        return NextResponse.json({ sent: true }, { status: 200 });
      }
      if (created?.user) {
        linkResult = await generateMagicLink();
      }
    }
    if (linkResult.error) {
      return NextResponse.json({ sent: true }, { status: 200 });
    }
  }

  const actionLink = linkResult.data?.properties?.action_link;
  if (!actionLink) {
    return NextResponse.json(
      { error: 'Service unavailable — failed to generate link' },
      { status: 503 },
    );
  }

  const from = process.env.RESEND_FROM || 'DPMPTSP Lampung <noreply@lmh.lampungprov.go.id>';
  const { error: sendError } = await resend.emails.send({
    from,
    to: email,
    subject: 'Link edit listing UMKM — DPMPTSP Lampung',
    html: `
      <p>Anda meminta link untuk mengedit listing UMKM di Layanan Maju Hub.</p>
      <p><a href="${actionLink}">Klik di sini untuk masuk dan mengedit listing</a></p>
      <p>Jika Anda tidak meminta link ini, abaikan email ini.</p>
    `,
  });

  if (sendError) {
    return NextResponse.json(
      { error: 'Service unavailable — failed to send email' },
      { status: 503 },
    );
  }

  if (canReturnDevLink()) {
    return NextResponse.json(
      { sent: true, dev_link: actionLink },
      { status: 200 },
    );
  }

  return NextResponse.json({ sent: true }, { status: 200 });
}
