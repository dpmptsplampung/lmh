import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { bolehAksesSesiStaf } from '@/lib/chat/akses';
import { canAccessSesi, resolveActor } from '@/app/api/chat/messages/route';
import { getObjectStream, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/chat/lampiran/[pesanId]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIDAK_ADA = () => NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });

// 404 SERAGAM untuk pesan yang tidak ada, tanpa lampiran, atau bukan hak pemanggil (tidak membocorkan ada/tidaknya pesan).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ pesanId: string }> }) {
  const { pesanId } = await params;
  if (!UUID.test(pesanId)) return TIDAK_ADA();
  const server = await createClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !r2Tersedia()) return TIDAK_ADA();
  const admin = createServiceClient(url, key, { auth: { persistSession: false } });

  const actor = await resolveActor(admin, user.id);
  if (!actor) return TIDAK_ADA();
  const { data: pesan } = await admin
    .from('chat_pesan')
    .select('sesi_id, lampiran_kunci, lampiran_mime')
    .eq('id', pesanId)
    .maybeSingle();
  if (!pesan?.lampiran_kunci || !pesan.lampiran_mime) return TIDAK_ADA();
  const { data: sesi } = await admin.from('chat_sesi').select('id, pengunjung_id, layanan_id').eq('id', pesan.sesi_id).maybeSingle();
  if (!sesi) return TIDAK_ADA();
  const boleh = actor.kind === 'staff'
    ? await bolehAksesSesiStaf(server, sesi.id, () => canAccessSesi(actor, sesi))
    : canAccessSesi(actor, sesi);
  if (!boleh) return TIDAK_ADA();

  try {
    const obj = await getObjectStream('private', pesan.lampiran_kunci);
    if (!obj) return TIDAK_ADA();
    return new NextResponse(obj.stream, {
      headers: {
        'Content-Type': pesan.lampiran_mime,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logServerEvent('error', { operation: 'chat.lampiran.baca', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal memuat lampiran' }, { status: 500 });
  }
}
