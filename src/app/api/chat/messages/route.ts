import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

const getQuerySchema = z.object({
  sesi_id: z.string().uuid(),
});

const postBodySchema = z.object({
  sesi_id: z.string().uuid(),
  pengirim: z.enum(['pengunjung', 'petugas', 'bot']),
  isi: z.string().min(1).max(2000),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sesi_id = searchParams.get('sesi_id');

  const parsed = getQuerySchema.safeParse({ sesi_id });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Valid sesi_id is required' }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('chat_pesan')
    .select('id, pengirim, isi, created_at')
    .eq('sesi_id', parsed.data.sesi_id)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[api/chat/messages GET] error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }

  const { data: sesiData } = await supabase
    .from('chat_sesi')
    .select('status')
    .eq('id', parsed.data.sesi_id)
    .maybeSingle();

  return NextResponse.json({
    messages: data || [],
    status: sesiData?.status || 'bot',
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

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('chat_pesan')
    .insert({
      sesi_id: parsed.data.sesi_id,
      pengirim: parsed.data.pengirim,
      isi: parsed.data.isi.trim(),
    })
    .select('id, pengirim, isi, created_at')
    .single();

  if (error) {
    console.error('[api/chat/messages POST] error:', error);
    return NextResponse.json({ error: 'Failed to insert message' }, { status: 500 });
  }

  // Broadcast the new message to the room channel for instant 0ms sync
  const channel = supabase.channel(`chat-room-${parsed.data.sesi_id}`);
  await channel.send({
    type: 'broadcast',
    event: 'new_message',
    payload: { message: data },
  });
  // Note: we don't need to wait for channel subscription here, we just emit the broadcast.
  // The frontend clients that are subscribed will receive it.

  return NextResponse.json({ message: data }, { status: 201 });
}
