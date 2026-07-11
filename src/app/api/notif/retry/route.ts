import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import webpush from 'web-push';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface FailedRow {
  id: string;
  kanal: 'email' | 'web_push';
  tujuan_email: string | null;
  tujuan_user_id: string | null;
  subjek: string | null;
  body: string;
  payload: Record<string, unknown> | null;
  retry_count: number;
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
  return auth === `Bearer ${secret}`;
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

async function sendEmail(resend: Resend, row: FailedRow): Promise<{ ok: boolean; error?: string }> {
  const from = process.env.RESEND_FROM || 'DPMPTSP Lampung <noreply@lmh.lampungprov.go.id>';
  const { error } = await resend.emails.send({
    from,
    to: row.tujuan_email!,
    subject: row.subjek || 'Notifikasi DPMPTSP Lampung',
    html: row.body,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function sendPush(row: FailedRow): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const adminClient = getServiceClient();
  if (!adminClient) return { ok: false, error: 'service client unavailable' };

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

function updateStatus(
  adminClient: ReturnType<typeof getServiceClient>,
  id: string,
  status: 'sent' | 'failed' | 'skipped',
  retryCount: number,
  error?: string,
): void {
  if (!adminClient) return;
  const patch: Record<string, unknown> = {
    status,
    retry_count: retryCount + 1,
  };
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  if (error) patch.error = error;
  adminClient.from('notifikasi').update(patch).eq('id', id);
}

export async function POST(request: NextRequest) {
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

  const { data: failed, error: fetchErr } = await adminClient
    .from('notifikasi')
    .select('id, kanal, tujuan_email, tujuan_user_id, subjek, body, payload, retry_count')
    .eq('status', 'failed')
    .lt('retry_count', 3)
    .limit(10);

  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to fetch failed: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  const rows: FailedRow[] = (failed ?? []) as FailedRow[];
  let sent = 0;
  let failedAgain = 0;

  const resend = getResend();

  for (const row of rows) {
    if (row.kanal === 'email') {
      if (!row.tujuan_email) {
        updateStatus(adminClient, row.id, 'skipped', row.retry_count, 'no tujuan_email');
        continue;
      }
      if (!resend) {
        updateStatus(adminClient, row.id, 'failed', row.retry_count, 'RESEND_API_KEY not configured');
        failedAgain++;
        continue;
      }
      const result = await sendEmail(resend, row);
      if (result.ok) {
        updateStatus(adminClient, row.id, 'sent', row.retry_count);
        sent++;
      } else {
        updateStatus(adminClient, row.id, 'failed', row.retry_count, result.error);
        failedAgain++;
      }
    } else if (row.kanal === 'web_push') {
      if (!row.tujuan_user_id) {
        updateStatus(adminClient, row.id, 'skipped', row.retry_count, 'no tujuan_user_id');
        continue;
      }
      const result = await sendPush(row);
      if (result.ok && !result.skipped) {
        updateStatus(adminClient, row.id, 'sent', row.retry_count);
        sent++;
      } else if (result.skipped) {
        updateStatus(adminClient, row.id, 'skipped', row.retry_count, 'no subscriptions');
      } else {
        updateStatus(adminClient, row.id, 'failed', row.retry_count, result.error);
        failedAgain++;
      }
    }
  }

  return NextResponse.json({ sent, failed: failedAgain, retried: rows.length });
}
