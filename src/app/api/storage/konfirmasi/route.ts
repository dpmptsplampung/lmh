import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { ATURAN_AREA, adalahArea, cocokMagicBytes, kunciObjek, type Area } from '@/lib/storage/area';
import { deleteObjects, getObjectRange, headObject, r2Tersedia, urlPublik } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/storage/konfirmasi';

const bodySchema = z.object({ area: z.string(), path: z.string().min(1).max(300) }).strict();

// Memastikan objek yang baru diunggah sesuai aturan area (ukuran, tipe, magic bytes). Objek yang tidak sesuai dihapus.
export async function POST(request: NextRequest) {
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success || !adalahArea(body.data.area) || body.data.area === 'chat-lampiran') {
    return NextResponse.json({ error: 'Permintaan tidak valid' }, { status: 400 });
  }
  const area = body.data.area as Area;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: staf } = await supabase.from('petugas').select('role, aktif').eq('auth_user_id', user.id).maybeSingle();
  const aturan = ATURAN_AREA[area];
  if (!staf || staf.aktif === false || !aturan.peran.includes(staf.role as never)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let kunci: string;
  try {
    kunci = kunciObjek(area, body.data.path);
  } catch {
    return NextResponse.json({ error: 'Path berkas tidak valid' }, { status: 400 });
  }
  if (!r2Tersedia()) return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });

  try {
    const head = await headObject(aturan.bucket, kunci);
    if (!head) return NextResponse.json({ error: 'Berkas tidak ditemukan' }, { status: 404 });
    const mime = head.contentType.split(';')[0].trim();
    const awal = await getObjectRange(aturan.bucket, kunci, 12);
    const sah = head.size > 0 && head.size <= aturan.maksByte && aturan.mime.includes(mime) && !!awal && cocokMagicBytes(mime, awal);
    if (!sah) {
      await deleteObjects(aturan.bucket, [kunci]).catch((error) =>
        logServerEvent('warn', { operation: 'storage.konfirmasi.hapus_gagal', route: ROUTE, error }));
      return NextResponse.json({ error: 'Berkas tidak sesuai aturan' }, { status: 422 });
    }
    return NextResponse.json({ kunci, ...(aturan.bucket === 'public' ? { url: urlPublik(kunci) } : {}) });
  } catch (error) {
    logServerEvent('error', { operation: 'storage.konfirmasi', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal memeriksa berkas' }, { status: 500 });
  }
}
