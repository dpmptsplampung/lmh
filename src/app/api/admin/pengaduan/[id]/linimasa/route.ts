import { NextResponse, type NextRequest } from 'next/server';
import { aktorTinjau, jawabGalatRpc, UUID } from '../../_aksi';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/admin/pengaduan/[id]/linimasa';

// Riwayat satu pengaduan berurut waktu (status, tanggapan, penangan) dari RPC linimasa_pengaduan. Admin dan Front Office saja.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  const aktor = await aktorTinjau();
  if ('galat' in aktor) return aktor.galat;
  const { data, error } = await aktor.supabase.rpc('linimasa_pengaduan', { p_pengaduan_id: id });
  if (error) return jawabGalatRpc(error, 'admin.pengaduan.linimasa', ROUTE);
  return NextResponse.json({ entri: Array.isArray(data) ? data : [] });
}
