import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { mutasiWajibBaris } from '@/lib/supabase/mutate';
import { logServerEvent } from '@/lib/observability/logger';
import { RETENSI_LAMPIRAN_HARI } from '@/lib/chat/lampiran';
import { deleteObjects, r2Tersedia } from '@/lib/storage/r2';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/chat/lampiran/bersihkan';
const MAKS_PER_PANGGILAN = 500;

function cronSahih(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get('authorization');
  if (!secret || !auth) return false;
  const harap = Buffer.from(`Bearer ${secret}`, 'utf8');
  const nyata = Buffer.from(auth, 'utf8');
  return harap.length === nyata.length && crypto.timingSafeEqual(harap, nyata);
}

// Retensi lampiran chat (RETENSI_LAMPIRAN_HARI, 90 hari): hapus objek R2 dulu; kolom lampiran dikosongkan HANYA untuk kunci yang
// berhasil dihapus (teks pesan tetap). Dipanggil cron harian dengan Authorization: Bearer $CRON_SECRET.
async function jalankan(request: NextRequest) {
  if (!cronSahih(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !r2Tersedia()) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const admin = createServiceClient(url, key, { auth: { persistSession: false } });

  const batas = new Date(Date.now() - RETENSI_LAMPIRAN_HARI * 86_400_000).toISOString();
  const { data, error } = await admin
    .from('chat_pesan')
    .select('id, lampiran_kunci')
    .not('lampiran_kunci', 'is', null)
    .lt('created_at', batas)
    .limit(MAKS_PER_PANGGILAN);
  if (error) {
    logServerEvent('error', { operation: 'chat.lampiran.bersihkan.baca', route: ROUTE, error });
    return NextResponse.json({ error: 'Gagal membaca daftar lampiran' }, { status: 500 });
  }
  const baris = (data ?? []) as Array<{ id: string; lampiran_kunci: string }>;
  if (baris.length === 0) return NextResponse.json({ dihapus: 0 });

  try {
    await deleteObjects('private', baris.map((b) => b.lampiran_kunci));
  } catch (e) {
    logServerEvent('error', { operation: 'chat.lampiran.bersihkan.hapus', route: ROUTE, error: e });
    return NextResponse.json({ error: 'Gagal menghapus berkas' }, { status: 500 });
  }
  try {
    await mutasiWajibBaris(
      admin
        .from('chat_pesan')
        .update({ lampiran_kunci: null, lampiran_mime: null, lampiran_ukuran: null, lampiran_nama: null })
        .in('id', baris.map((b) => b.id))
        .select('id'),
    );
  } catch (e) {
    logServerEvent('error', { operation: 'chat.lampiran.bersihkan.kosongkan', route: ROUTE, error: e });
    return NextResponse.json({ error: 'Berkas terhapus tetapi kolom gagal dikosongkan' }, { status: 500 });
  }
  return NextResponse.json({ dihapus: baris.length });
}

export const POST = jalankan;
// Vercel Cron memanggil dengan GET.
export const GET = jalankan;
