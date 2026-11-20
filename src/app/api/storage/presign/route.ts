import { NextResponse, type NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { bolehUnggahDraf } from '@/lib/umkm-katalog/akses-server';
import { logServerEvent } from '@/lib/observability/logger';
import { AWALAN_AKUN, ATURAN_AREA, adalahArea, bolehUnggahArea, kunciObjek, pathMentahIproSah, profilDrafDariPath, type Area } from '@/lib/storage/area';
import { bacaJson } from '@/lib/investasi/http';
import { presignPut, r2Tersedia, bucketTerpisah } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/storage/presign';

const bodySchema = z.object({
  area: z.string(),
  path: z.string().min(1).max(300).optional(),
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
  const body = bodySchema.safeParse(await bacaJson(request).catch(() => null));
  if (!body.success || !adalahArea(body.data.area) || !AREA_DILAYANI(body.data.area)) {
    return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 });
  }
  const { mime, ukuran } = body.data;
  const path = body.data.path ?? '';
  // Kunci PDF investasi dibuat server (raw/<uid>/<uuid>.pdf); klien tidak boleh menentukan atau mengulang path.
  if (body.data.area === 'investment-docs' && body.data.path !== undefined) {
    return NextResponse.json({ error: 'Path ditetapkan server untuk PDF investasi' }, { status: 400 });
  }
  if (body.data.area !== 'investment-docs' && !path) return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 });
  const area = body.data.area as Area;

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: staf } = await supabase.from('petugas').select('role, aktif').eq('auth_user_id', user.id).maybeSingle();
  const aturan = ATURAN_AREA[area];
  if (area !== 'umkm-draf' && (!staf || staf.aktif === false || !aturan.peran.includes(staf.role as never))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (area === 'umkm-draf' && !(await bolehUnggahDraf(supabase, user, path))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: { 'Cache-Control': 'private, no-store' } });
  }
  if (!(await bolehUnggahArea(supabase, staf, area))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (area === 'ipro-mentah' && !pathMentahIproSah(path)) return NextResponse.json({ error: 'Path berkas tidak valid' }, { status: 400 });
  if (!aturan.mime.includes(mime)) return NextResponse.json({ error: 'Tipe berkas tidak diizinkan' }, { status: 400 });
  if (ukuran > aturan.maksByte) return NextResponse.json({ error: 'Ukuran berkas melebihi batas' }, { status: 400 });

  let kunci: string;
  try {
    const ekstensi = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime];
    const profil = !staf ? (path.startsWith(AWALAN_AKUN) ? user.id : profilDrafDariPath(path)) : null;
    const nama = `${profil ? `${profil}/` : ''}${randomUUID()}.${ekstensi}`;
    kunci = kunciObjek(area, area === 'investment-docs' ? `raw/${user.id}/${randomUUID()}.pdf` : area === 'umkm-draf' ? nama : path);
  } catch {
    return NextResponse.json({ error: 'Path berkas tidak valid' }, { status: 400 });
  }
  if (!r2Tersedia() || (['umkm-draf', 'ipro-mentah', 'investment-docs'].includes(area) && !bucketTerpisah())) {
    logServerEvent('error', { operation: 'storage.presign.r2_belum_dikonfigurasi', route: ROUTE });
    return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });
  }
  try {
    const uploadUrl = await presignPut(aturan.bucket, kunci, {
      contentType: mime, contentLength: ukuran,
      ...(['umkm-draf', 'ipro-mentah', 'investment-docs'].includes(area) ? { tandatanganiContentType: true } : {}),
    });
    return NextResponse.json({ uploadUrl, kunci, headers: { 'Content-Type': mime } },
      area === 'umkm-draf' ? { headers: { 'Cache-Control': 'private, no-store' } } : undefined);
  } catch (error) {
    logServerEvent('error', { operation: 'storage.presign', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal menyiapkan unggahan' }, { status: 500 });
  }
}
