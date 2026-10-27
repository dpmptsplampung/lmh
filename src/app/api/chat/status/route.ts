import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { muatStatusLayananChat } from '@/lib/chat/status-layanan';

export const dynamic = 'force-dynamic';

// Status publik "petugas chat tersedia?" per Layanan (Fase 5). Tanpa PII dan tanpa login: keputusan jadwal dibaca dari
// RPC chat_layanan_status (data publik, seperti layanan_status_hari_ini); sebelum migrasi turun ke kalender global lama.
const querySchema = z.object({ layanan_id: z.string().uuid() });

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse({ layanan_id: new URL(request.url).searchParams.get('layanan_id') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'layanan_id harus UUID' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }
  const supabase = await createServerClient();
  const status = await muatStatusLayananChat(supabase, parsed.data.layanan_id);
  return NextResponse.json({ status }, { headers: { 'Cache-Control': 'no-store' } });
}
