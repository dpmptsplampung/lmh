import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { KODE_MIGRASI_BELUM, objekBelumAda } from '@/lib/akses-data/galat';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { MutasiError } from '@/lib/supabase/mutate';
import { kodeDariPesan } from '@/lib/rpc-galat';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/chat/petugas';

// Pengunjung meminta bicara dengan petugas (Fase 5). Seluruhnya lewat RPC chat_minta_petugas atas nama PENGGUNA
// (klien ber-JWT): DB memeriksa kepemilikan sesi, jam operasional Layanan, pembatas laju, pesan tunggu, dan antrean email
// berdedup. Route tidak menulis tabel apa pun.
const bodySchema = z.object({ sesi_id: z.string().uuid() });

const GALAT: Record<string, { status: number; pesan: string }> = {
  FORBIDDEN: { status: 403, pesan: 'Sesi chat ini bukan milik Anda.' },
  LOGIN_GOOGLE: { status: 403, pesan: 'Live chat dengan petugas hanya untuk pengunjung yang login dengan Google.' },
  PESAN_WAJIB: { status: 422, pesan: 'Tulis pertanyaan Anda terlebih dahulu, lalu minta petugas.' },
  NOT_FOUND: { status: 404, pesan: 'Sesi chat tidak ditemukan.' },
  INVALID_STATUS: { status: 409, pesan: 'Sesi chat sudah selesai. Kirim pesan baru untuk memulai sesi berikutnya.' },
  LAYANAN_TIDAK_VALID: { status: 422, pesan: 'Layanan ini tidak lagi melayani chat.' },
  RATE_LIMIT: { status: 429, pesan: 'Terlalu banyak permintaan. Coba lagi sebentar.' },
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // B5 (A3): live chat hanya login Google. Akun anonim ditolak di server (DB menegakkan lagi lewat JWT is_anonymous).
  if ((user as { is_anonymous?: boolean }).is_anonymous === true) {
    return NextResponse.json({ error: GALAT.LOGIN_GOOGLE.pesan, kode: 'LOGIN_GOOGLE' }, { status: 403 });
  }

  const { data, error } = await supabase.rpc('chat_minta_petugas', { p_sesi_id: parsed.data.sesi_id, p_eksplisit: true });
  if (error) {
    if (objekBelumAda(error)) {
      return NextResponse.json(
        { error: 'Permintaan petugas belum tersedia: migrasi 202610310002 belum diterapkan.', kode: KODE_MIGRASI_BELUM },
        { status: 409 },
      );
    }
    const kode = kodeDariPesan(error.message);
    const peta = kode ? GALAT[kode] : undefined;
    if (peta) return NextResponse.json({ error: peta.pesan, kode }, { status: peta.status });
    catatMutasi('error', 'chat.petugas.minta', ROUTE, new MutasiError('database', { asal: error }));
    return NextResponse.json({ error: 'Gagal meneruskan permintaan ke petugas' }, { status: 500 });
  }
  if (!data || typeof data !== 'object' || (data as { ok?: unknown }).ok !== true) {
    catatMutasi('error', 'chat.petugas.minta', ROUTE, new MutasiError('database', { asal: { code: 'RESPON_TIDAK_VALID' } }));
    return NextResponse.json({ error: 'Gagal meneruskan permintaan ke petugas' }, { status: 500 });
  }
  return NextResponse.json(data);
}
