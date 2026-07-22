import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import webpush from 'web-push';
import crypto from 'node:crypto';
import { bodyToEmailHtml } from '@/lib/email-html';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface NotifikasiRow {
  id: string;
  claim_token: string;
  kanal: 'email' | 'web_push';
  tujuan_email: string | null;
  tujuan_user_id: string | null;
  subjek: string | null;
  body: string;
  payload: Record<string, unknown> | null;
}

interface PushSubscriptionRow {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

function verifyCronSecret(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = request.headers.get('authorization');
  if (!auth) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  const actual = Buffer.from(auth, 'utf8');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function configureWebPush(): boolean {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.NEXT_PUBLIC_PUBLIC_URL || 'mailto:admin@lmh.lampungprov.go.id';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

async function sendEmail(resend: Resend, row: NotifikasiRow): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.RESEND_FROM || 'DPMPTSP Lampung <noreply@lmh.lampungprov.go.id>';
  const { error } = await resend.emails.send({
    from,
    to: row.tujuan_email!,
    subject: row.subjek || 'Notifikasi DPMPTSP Lampung',
    html: bodyToEmailHtml(row.body),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function sendPush(
  adminClient: NonNullable<ReturnType<typeof getServiceClient>>,
  row: NotifikasiRow,
): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { data: subs, error: subErr } = await adminClient
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', row.tujuan_user_id!);

  if (subErr) return { ok: false, error: subErr.message };
  if (!subs || subs.length === 0) return { ok: true, skipped: true };

  configureWebPush();
  let lastError: string | undefined;
  let anySent = false;
  for (const sub of subs as PushSubscriptionRow[]) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: sub.keys },
        JSON.stringify({ title: row.subjek || 'Notifikasi', body: row.body, payload: row.payload }),
      );
      anySent = true;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  if (anySent) return { ok: true };
  return { ok: false, error: lastError || 'all push attempts failed' };
}

async function completeNotifikasi(
  adminClient: NonNullable<ReturnType<typeof getServiceClient>>,
  id: string,
  claimToken: string,
  status: 'sent' | 'failed' | 'skipped',
  error?: string,
): Promise<void> {
  await adminClient.rpc('complete_notifikasi', {
    p_id: id,
    p_claim_token: claimToken,
    p_status: status,
    p_error: error ?? null,
  });
}

async function processPending(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET not configured' },
      { status: 500 },
    );
  }
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json(
      { error: 'Server misconfigured: SUPABASE_SERVICE_ROLE_KEY required' },
      { status: 500 },
    );
  }

  const { data: claimed, error: claimErr } = await adminClient.rpc('claim_notifikasi', {
    p_limit: 10,
    p_status: 'pending',
  });

  if (claimErr) {
    return NextResponse.json(
      { error: `Failed to claim pending: ${claimErr.message}` },
      { status: 500 },
    );
  }

  const rows: NotifikasiRow[] = (claimed ?? []) as NotifikasiRow[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const resend = getResend();

  for (const row of rows) {
    if (row.kanal === 'email') {
      if (!row.tujuan_email) {
        await completeNotifikasi(adminClient, row.id, row.claim_token, 'skipped', 'no tujuan_email');
        skipped++;
        continue;
      }
      if (!resend) {
        await completeNotifikasi(adminClient, row.id, row.claim_token, 'failed', 'RESEND_API_KEY not configured');
        failed++;
        continue;
      }
      const result = await sendEmail(resend, row);
      if (result.ok) {
        await completeNotifikasi(adminClient, row.id, row.claim_token, 'sent');
        sent++;
      } else {
        await completeNotifikasi(adminClient, row.id, row.claim_token, 'failed', result.error);
        failed++;
      }
    } else if (row.kanal === 'web_push') {
      if (!row.tujuan_user_id) {
        await completeNotifikasi(adminClient, row.id, row.claim_token, 'skipped', 'no tujuan_user_id');
        skipped++;
        continue;
      }
      const result = await sendPush(adminClient, row);
      if (result.ok) {
        if (result.skipped) {
          await completeNotifikasi(adminClient, row.id, row.claim_token, 'skipped', 'no subscriptions');
          skipped++;
        } else {
          await completeNotifikasi(adminClient, row.id, row.claim_token, 'sent');
          sent++;
        }
      } else {
        await completeNotifikasi(adminClient, row.id, row.claim_token, 'failed', result.error);
        failed++;
      }
    } else {
      await completeNotifikasi(adminClient, row.id, row.claim_token, 'skipped', `unknown kanal: ${row.kanal}`);
      skipped++;
    }
  }

  return NextResponse.json({ sent, failed, skipped, processed: rows.length });
}

export async function POST(request: NextRequest) {
  return processPending(request);
}

/** Vercel Cron invokes scheduled paths with GET + Authorization: Bearer CRON_SECRET */
export async function GET(request: NextRequest) {
  return processPending(request);
}
