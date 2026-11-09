import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { bolehUnggahDraf } from '@/lib/umkm-katalog/akses-server';
import { logServerEvent } from '@/lib/observability/logger';
import { ATURAN_AREA, adalahArea, kunciObjek, profilDrafDariPath, type Area } from '@/lib/storage/area';
import { presignPut, r2Tersedia, bucketTerpisah } from '@/lib/storage/r2';

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
  const response = await proses(request);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

async function proses(request: NextRequest) {
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
  if (area !== 'umkm-draf' && (!staf || staf.aktif === false || !aturan.peran.includes(staf.role as never))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (area === 'umkm-draf' && !(await bolehUnggahDraf(supabase, user, path))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!aturan.mime.includes(mime)) return NextResponse.json({ error: 'Tipe berkas tidak diizinkan' }, { status: 400 });
  if (ukuran > aturan.maksByte) return NextResponse.json({ error: 'Ukuran berkas melebihi batas' }, { status: 400 });

  let kunci: string;
  try {
    const ekstensi = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
    const profil = !staf ? profilDrafDariPath(path) : null;
    const nama = `${profil ? `${profil}/` : ''}${randomUUID()}.${ekstensi}`;
    kunci = kunciObjek(area, area === 'umkm-draf' ? nama : path);
  } catch {
    return NextResponse.json({ error: 'Path berkas tidak valid' }, { status: 400 });
  }
  if (!r2Tersedia() || (area === 'umkm-draf' && !bucketTerpisah())) {
    logServerEvent('error', { operation: 'storage.presign.r2_belum_dikonfigurasi', route: ROUTE });
    return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });
  }
  try {
    const uploadUrl = await presignPut(aturan.bucket, kunci, {
      contentType: mime, contentLength: ukuran,
      ...(area === 'umkm-draf' ? { tandatanganiContentType: true } : {}),
    });
    return NextResponse.json({ uploadUrl, kunci, headers: { 'Content-Type': mime } },
      area === 'umkm-draf' ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined);
  } catch (error) {
    logServerEvent('error', { operation: 'storage.presign', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal menyiapkan unggahan' }, { status: 500 });
  }
}
