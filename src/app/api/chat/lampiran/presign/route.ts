import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { bolehAksesSesiStaf } from '@/lib/chat/akses';
import { canAccessSesi, resolveActor } from '@/app/api/chat/messages/route';
import { ekstensiDariMime, MAKS_LAMPIRAN_BYTE, MIME_LAMPIRAN, pathLampiran } from '@/lib/chat/lampiran';
import { kunciObjek } from '@/lib/storage/area';
import { presignPut, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/chat/lampiran/presign';

const bodySchema = z.object({
  sesi_id: z.string().uuid(),
  mime: z.enum(MIME_LAMPIRAN),
  ukuran: z.number().int().positive().max(MAKS_LAMPIRAN_BYTE),
}).strict();

// Izin unggah lampiran = izin mengirim pesan di sesi itu: pengunjung pemilik sesi, atau staf dalam lingkup (sesi harus belum selesai).
export async function POST(request: NextRequest) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Permintaan tidak valid (JPG/PNG/WEBP, maks 5 MB)' }, { status: 400 });

  const server = await createClient();
  const { data: { user } } = await server.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const admin = createServiceClient(url, key, { auth: { persistSession: false } });

  const actor = await resolveActor(admin, user.id);
  if (!actor) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { data: sesi } = await admin.from('chat_sesi').select('id, status, pengunjung_id, layanan_id').eq('id', body.data.sesi_id).maybeSingle();
  const boleh = !!sesi && (actor.kind === 'staff'
    ? await bolehAksesSesiStaf(server, sesi.id, () => canAccessSesi(actor, sesi))
    : canAccessSesi(actor, sesi));
  if (!sesi || !boleh) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (sesi.status === 'selesai') return NextResponse.json({ error: 'Sesi sudah selesai' }, { status: 409 });
  if (!r2Tersedia()) {
    logServerEvent('error', { operation: 'chat.lampiran.r2_belum_dikonfigurasi', route: ROUTE });
    return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });
  }

  const ext = ekstensiDariMime(body.data.mime)!;
  const kunci = kunciObjek('chat-lampiran', pathLampiran(sesi.id, ext));
  try {
    const uploadUrl = await presignPut('private', kunci, { contentType: body.data.mime, contentLength: body.data.ukuran });
    return NextResponse.json({ uploadUrl, kunci, headers: { 'Content-Type': body.data.mime } });
  } catch (error) {
    logServerEvent('error', { operation: 'chat.lampiran.presign', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal menyiapkan unggahan' }, { status: 500 });
  }
}
