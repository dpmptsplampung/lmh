import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { kunciObjek } from '@/lib/storage/area';
import { getObjectStream, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/absensi/foto/[id]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Foto absensi FO (privat di R2). Izin = RLS absensi_hadir_fo (hanya admin/front_office): baris tak terlihat -> 404 seragam.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data } = await supabase.from('absensi_hadir_fo').select('foto_path').eq('id', id).maybeSingle();
  if (!data?.foto_path || !r2Tersedia()) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });

  try {
    const obj = await getObjectStream('private', kunciObjek('absensi-foto', data.foto_path));
    if (!obj) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
    return new NextResponse(obj.stream, {
      headers: {
        'Content-Type': obj.contentType,
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    logServerEvent('error', { operation: 'absensi.foto.baca', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal memuat foto' }, { status: 500 });
  }
}
