import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { aktorTinjau, jawabGalatRpc, UUID } from '../../_aksi';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/admin/pengaduan/[id]/ambil-alih';

const bodySchema = z.object({ alasan: z.string().trim().min(5).max(500) }).strict();

// Ambil alih penangan pengaduan dengan alasan singkat (RPC ambil_alih_pengaduan; tercatat di riwayat dan audit_log).
// Hanya Admin dan Front Office; petugas layanan ditolak.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: 'Alasan wajib diisi, 5 sampai 500 karakter.' }, { status: 400 });
  const aktor = await aktorTinjau();
  if ('galat' in aktor) return aktor.galat;
  const { data, error } = await aktor.supabase.rpc('ambil_alih_pengaduan', { p_pengaduan_id: id, p_alasan: body.data.alasan });
  if (error) return jawabGalatRpc(error, 'admin.pengaduan.ambil_alih', ROUTE);
  return NextResponse.json({ ok: true, penangan: data ?? null });
}
