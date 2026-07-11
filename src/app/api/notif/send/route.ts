import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import webpush from 'web-push';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface NotifikasiRow {
  id: string;
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

async function sendEmail(resend: Resend, row: NotifikasiRow): Promise<{ ok: boolean; error?: string }> {
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

async function sendPush(row: NotifikasiRow): Promise<{ ok: boolean; error?: string }> {
  const adminClient = getServiceClient();
  if (!adminClient) return { ok: false, error: 'service client unavailable' };

  const { data: subs, error: subErr } = await adminClient
    .from('push_subscriptions')
    .select('endpoint, keys')
    .eq('user_id', row.tujuan_user_id!);

  if (subErr) return { ok: false, error: subErr.message };
  if (!subs || subs.length === 0) return { ok: true, skipped: true } as { ok: boolean; skipped: boolean };

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

async function updateStatus(
  adminClient: ReturnType<typeof getServiceClient>,
  id: string,
  status: 'sent' | 'failed' | 'skipped',
  error?: string,
): Promise<void> {
  if (!adminClient) return;
  const patch: Record<string, unknown> = { status };
  if (status === 'sent') patch.sent_at = new Date().toISOString();
  if (error) patch.error = error;
  await adminClient.from('notifikasi').update(patch).eq('id', id);
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

  const { data: pending, error: fetchErr } = await adminClient
    .from('notifikasi')
    .select('id, kanal, tujuan_email, tujuan_user_id, subjek, body, payload')
    .eq('status', 'pending')
    .limit(10);

  if (fetchErr) {
    return NextResponse.json(
      { error: `Failed to fetch pending: ${fetchErr.message}` },
      { status: 500 },
    );
  }

  const rows: NotifikasiRow[] = (pending ?? []) as NotifikasiRow[];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  const resend = getResend();

  for (const row of rows) {
    if (row.kanal === 'email') {
      if (!row.tujuan_email) {
        await updateStatus(adminClient, row.id, 'skipped', 'no tujuan_email');
        skipped++;
        continue;
      }
      if (!resend) {
        await updateStatus(adminClient, row.id, 'failed', 'RESEND_API_KEY not configured');
        failed++;
        continue;
      }
      const result = await sendEmail(resend, row);
      if (result.ok) {
        await updateStatus(adminClient, row.id, 'sent');
        sent++;
      } else {
        await updateStatus(adminClient, row.id, 'failed', result.error);
        failed++;
      }
    } else if (row.kanal === 'web_push') {
      if (!row.tujuan_user_id) {
        await updateStatus(adminClient, row.id, 'skipped', 'no tujuan_user_id');
        skipped++;
        continue;
      }
      const result = await sendPush(row);
      if (result.ok) {
        if ('skipped' in result && result.skipped) {
          await updateStatus(adminClient, row.id, 'skipped', 'no subscriptions');
          skipped++;
        } else {
          await updateStatus(adminClient, row.id, 'sent');
          sent++;
        }
      } else {
        await updateStatus(adminClient, row.id, 'failed', result.error);
        failed++;
      }
    } else {
      await updateStatus(adminClient, row.id, 'skipped', `unknown kanal: ${row.kanal}`);
      skipped++;
    }
  }

  return NextResponse.json({ sent, failed, skipped, processed: rows.length });
}
