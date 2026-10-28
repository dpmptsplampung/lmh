import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { ATURAN_AREA, adalahArea, kunciObjek, type Area } from '@/lib/storage/area';
import { presignPut, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/storage/presign';

const bodySchema = z.object({
  area: z.string(),
  path: z.string().min(1).max(300),
  mime: z.string().min(1).max(100),
  ukuran: z.number().int().positive(),
}).strict();

// Area chat-lampiran punya route sendiri (izinnya per sesi chat), jadi tidak dilayani di sini.
const AREA_DILAYANI = (a: Area) => a !== 'chat-lampiran';

export async function POST(request: NextRequest) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success || !adalahArea(body.data.area) || !AREA_DILAYANI(body.data.area)) {
    return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 });
  }
  const { path, mime, ukuran } = body.data;
  const area = body.data.area as Area;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: staf } = await supabase.from('petugas').select('role, aktif').eq('auth_user_id', user.id).maybeSingle();
  const aturan = ATURAN_AREA[area];
  if (!staf || staf.aktif === false || !aturan.peran.includes(staf.role as never)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!aturan.mime.includes(mime)) return NextResponse.json({ error: 'Tipe berkas tidak diizinkan' }, { status: 400 });
  if (ukuran > aturan.maksByte) return NextResponse.json({ error: 'Ukuran berkas melebihi batas' }, { status: 400 });

  let kunci: string;
  try {
    kunci = kunciObjek(area, path);
  } catch {
    return NextResponse.json({ error: 'Path berkas tidak valid' }, { status: 400 });
  }
  if (!r2Tersedia()) {
    logServerEvent('error', { operation: 'storage.presign.r2_belum_dikonfigurasi', route: ROUTE });
    return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });
  }
  try {
    const uploadUrl = await presignPut(aturan.bucket, kunci, { contentType: mime, contentLength: ukuran });
    return NextResponse.json({ uploadUrl, kunci, headers: { 'Content-Type': mime } });
  } catch (error) {
    logServerEvent('error', { operation: 'storage.presign', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal menyiapkan unggahan' }, { status: 500 });
  }
}
