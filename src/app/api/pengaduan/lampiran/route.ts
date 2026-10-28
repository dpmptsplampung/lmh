import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { logServerEvent } from '@/lib/observability/logger';
import { getObjectStream, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/pengaduan/lampiran';
const querySchema = z.object({ nomor: z.string().min(5).max(20), id: z.string().uuid() });
const TIDAK_ADA = () => NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });

// Unduh lampiran tanggapan di halaman pantau. Kunci = nomor laporan (pengaduan sumber 'wizard'); nomor salah -> 404 seragam.
export async function GET(request: NextRequest) {
  const q = querySchema.safeParse({ nomor: request.nextUrl.searchParams.get('nomor'), id: request.nextUrl.searchParams.get('id') });
  if (!q.success) return TIDAK_ADA();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !r2Tersedia()) return TIDAK_ADA();
  const service = createServiceClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await service.rpc('lampiran_pengaduan_nomor', { p_nomor: q.data.nomor, p_lampiran_id: q.data.id });
  const baris = Array.isArray(data) ? data[0] : data;
  if (error || !baris) return TIDAK_ADA();

  try {
    const obj = await getObjectStream('private', baris.kunci as string);
    if (!obj) return TIDAK_ADA();
    const aman = String(baris.nama_asli ?? 'lampiran').replace(/[^\w.\- ]/g, '_').slice(0, 100);
    return new NextResponse(obj.stream, {
      headers: {
        'Content-Type': baris.mime as string,
        'Content-Disposition': `attachment; filename="${aman}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (e) {
    logServerEvent('error', { operation: 'pengaduan.lampiran.baca', route: ROUTE, error: e });
    return NextResponse.json({ error: 'Gagal memuat lampiran' }, { status: 500 });
  }
}
