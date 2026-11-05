import { NextResponse, type NextRequest } from 'next/server';
import { aktorTinjau, jawabGalatRpc, UUID } from '../../_aksi';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/admin/pengaduan/[id]/tangani';

// Tombol "Tangani": mengisi penangan pengaduan dengan pemanggil (RPC tangani_pengaduan). Admin dan Front Office saja.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  const aktor = await aktorTinjau();
  if ('galat' in aktor) return aktor.galat;
  const { data, error } = await aktor.supabase.rpc('tangani_pengaduan', { p_pengaduan_id: id });
  if (error) return jawabGalatRpc(error, 'admin.pengaduan.tangani', ROUTE);
  return NextResponse.json({ ok: true, penangan: data ?? null });
}
