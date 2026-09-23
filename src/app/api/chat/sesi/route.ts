import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { resolveActor, canAccessSesi } from '../messages/route';

export const dynamic = 'force-dynamic';

// Aksi staf pada sesi chat (ambil alih / kembalikan ke bot / selesaikan)
// dilakukan di server: sebelumnya ditulis langsung dari browser sehingga
// (1) tidak tersiar ke pengunjung, (2) ditolak RLS untuk petugas non-admin
// tanpa pesan error. Server menulis status + pesan sistem + audit log.

const bodySchema = z.object({
  sesi_id: z.string().uuid(),
  aksi: z.enum(['takeover', 'kembali_ke_bot', 'selesaikan']),
});

const SYSTEM_MESSAGES: Record<string, string> = {
  takeover: '✓ Percakapan ini telah diambil alih oleh petugas loket. Pesan Anda akan dibalas langsung oleh petugas.',
  kembali_ke_bot: '↩ Percakapan dikembalikan ke asisten virtual. Silakan lanjutkan pertanyaan Anda.',
  selesaikan: '✕ Sesi chat telah ditutup oleh petugas. Terima kasih.',
};

const NEXT_STATUS: Record<string, 'aktif' | 'bot' | 'selesai'> = {
  takeover: 'aktif',
  kembali_ke_bot: 'bot',
  selesaikan: 'selesai',
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 422 },
    );
  }

  const serverClient = await createServerClient();
  const {
    data: { user },
  } = await serverClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const adminClient = getServiceClient();
  if (!adminClient) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const actor = await resolveActor(adminClient, user.id);
  if (!actor || actor.kind !== 'staff') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiData, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('id, status, pengunjung_id, layanan_id')
    .eq('id', parsed.data.sesi_id)
    .maybeSingle();
  if (sesiErr) {
    console.error('[api/chat/sesi] sesi error:', sesiErr);
    return NextResponse.json({ error: 'Gagal mengubah sesi' }, { status: 500 });
  }
  if (!sesiData || !canAccessSesi(actor, sesiData)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (sesiData.status === 'selesai') {
    return NextResponse.json({ error: 'Sesi sudah selesai' }, { status: 409 });
  }

  let ditanganiOleh: string | null = null;
  if (parsed.data.aksi === 'takeover') {
    const { data: p } = await adminClient
      .from('petugas')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    ditanganiOleh = p?.id ?? null;
  }

  const nextStatus = NEXT_STATUS[parsed.data.aksi];
  const { error: updateErr } = await adminClient
    .from('chat_sesi')
    .update({ status: nextStatus, ditangani_oleh: ditanganiOleh })
    .eq('id', parsed.data.sesi_id);
  if (updateErr) {
    console.error('[api/chat/sesi] update error:', updateErr);
    return NextResponse.json({ error: 'Gagal mengubah sesi' }, { status: 500 });
  }

  const { error: pesanErr } = await adminClient.from('chat_pesan').insert({
    sesi_id: parsed.data.sesi_id,
    pengirim: 'bot',
    isi: SYSTEM_MESSAGES[parsed.data.aksi],
  });
  if (pesanErr) {
    console.error('[api/chat/sesi] gagal menulis pesan sistem:', pesanErr);
  }

  await adminClient.from('audit_log').insert({
    actor_id: user.id,
    actor_role: actor.role,
    aksi: `chat_sesi_${parsed.data.aksi}`,
    entitas: 'chat_sesi',
    detail: { sesi_id: parsed.data.sesi_id },
  });

  return NextResponse.json({ ok: true, status: nextStatus });
}
