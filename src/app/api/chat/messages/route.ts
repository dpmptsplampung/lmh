import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

// P0: service-role is only for broadcast after an authorized write.
// Auth + ownership are enforced explicitly — never trust client-supplied pengirim.

// Broadcast reliably: supabase-js v2 only delivers channel.send() after the
// channel has joined (SUBSCRIBED). Sending before subscribe drops the message.
export async function broadcastNewMessage(
  adminClient: SupabaseClient,
  sesiId: string,
  message: unknown,
): Promise<void> {
  const channel = adminClient.channel(`chat-room-${sesiId}`);
  try {
    await new Promise<void>((resolve) => {
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') resolve();
      });
    });
    await channel.send({
      type: 'broadcast',
      event: 'new_message',
      payload: { message },
    });
  } catch {
    // Broadcast failure must not fail the write.
  } finally {
    try { await channel.unsubscribe(); } catch { /* ignore */ }
  }
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

const getQuerySchema = z.object({
  sesi_id: z.string().uuid(),
});

// pengirim is derived server-side; body only carries sesi_id + isi.
const postBodySchema = z.object({
  sesi_id: z.string().uuid(),
  isi: z.string().min(1).max(2000),
  // Accepted for backward-compat with clients; ignored for authorization.
  pengirim: z.enum(['pengunjung', 'petugas', 'bot']).optional(),
  // Idempotency: client-generated UUID for optimistic-dedup across broadcast.
  client_uuid: z.string().uuid().optional(),
});

type Actor =
  | { kind: 'staff'; role: 'admin' | 'petugas' | 'front_office'; layananId: string | null }
  | { kind: 'pengunjung'; pengunjungId: string };

async function resolveActor(
  adminClient: NonNullable<ReturnType<typeof getServiceClient>>,
  authUserId: string,
): Promise<Actor | null> {
  const { data: petugas } = await adminClient
    .from('petugas')
    .select('role, layanan_id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (petugas && (petugas.role === 'admin' || petugas.role === 'petugas' || petugas.role === 'front_office')) {
    return {
      kind: 'staff',
      role: petugas.role,
      layananId: petugas.layanan_id ?? null,
    };
  }

  const { data: pengunjung } = await adminClient
    .from('pengunjung')
    .select('id')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (!pengunjung) return null;
  return { kind: 'pengunjung', pengunjungId: pengunjung.id };
}

function canAccessSesi(
  actor: Actor,
  sesi: { pengunjung_id: string | null; layanan_id: string | null },
): boolean {
  if (actor.kind === 'staff') {
    // Admin & FO punya pandangan lintas-layanan (CHT-08 takeover); petugas hanya layanannya.
    if (actor.role === 'admin' || actor.role === 'front_office') return true;
    return !!actor.layananId && actor.layananId === sesi.layanan_id;
  }
  return !!sesi.pengunjung_id && sesi.pengunjung_id === actor.pengunjungId;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    sesi_id: searchParams.get('sesi_id'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid sesi_id is required' }, { status: 400 });
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
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiData, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('id, status, pengunjung_id, layanan_id')
    .eq('id', parsed.data.sesi_id)
    .maybeSingle();

  if (sesiErr) {
    console.error('[api/chat/messages GET] sesi error:', sesiErr);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
  if (!sesiData || !canAccessSesi(actor, sesiData)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data, error } = await adminClient
    .from('chat_pesan')
    .select('id, pengirim, isi, created_at, client_uuid')
    .eq('sesi_id', parsed.data.sesi_id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/chat/messages GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }

  return NextResponse.json({
    messages: data || [],
    status: sesiData.status || 'bot',
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
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
  if (!actor) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: sesiData, error: sesiErr } = await adminClient
    .from('chat_sesi')
    .select('id, status, pengunjung_id, layanan_id')
    .eq('id', parsed.data.sesi_id)
    .maybeSingle();

  if (sesiErr) {
    console.error('[api/chat/messages POST] sesi error:', sesiErr);
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 });
  }
  if (!sesiData || !canAccessSesi(actor, sesiData)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Force role — never trust client-supplied pengirim (impersonation vector).
  const pengirim = actor.kind === 'staff' ? 'petugas' : 'pengunjung';

  const { data, error } = await adminClient
    .from('chat_pesan')
    .insert({
      sesi_id: parsed.data.sesi_id,
      pengirim,
      isi: parsed.data.isi.trim(),
      client_uuid: parsed.data.client_uuid ?? null,
    })
    .select('id, pengirim, isi, created_at, client_uuid')
    .single();

  if (error) {
    console.error('[api/chat/messages POST] error:', error);
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 });
  }

  // Best-effort realtime broadcast for cross-client sync.
  await broadcastNewMessage(adminClient, parsed.data.sesi_id, data);

  return NextResponse.json({ message: data }, { status: 201 });
}
