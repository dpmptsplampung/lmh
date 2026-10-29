import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { kirimPesanSchema } from '@/lib/survei/schemas';

// Pengaduan dari Pesan Perilaku (sesudah survei terkirim) oleh pengunjung anonim lewat token undangan.
// RPC `kirim_pengaduan_survei` (migrasi 202611030003) mengunci undangan, memeriksa survei sudah terkirim, batas waktu, dan satu kali per undangan.
// Route ini hanya pembatas bentuk (zod strict). Pembatasan laju per IP sengaja tidak ketat (keputusan pemilik): satu per undangan.
const OPERASI = 'survei.pengaduan';
const RUTE = '/api/survei/pengaduan';
const GALAT_UMUM = 'Gagal mengirim';

const PEMETAAN: Record<string, { status: number; error: string }> = {
  invalid: { status: 400, error: 'Isi tidak valid' },
  not_found: { status: 404, error: 'Tautan tidak ditemukan' },
  belum_survei: { status: 409, error: 'Isi survei terlebih dahulu' },
  duplicate: { status: 409, error: 'Sudah pernah dikirim untuk kunjungan ini' },
  expired: { status: 410, error: 'Batas waktu pengiriman sudah lewat' },
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = kirimPesanSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Input tidak valid' }, { status: 400 });

  const { token, isi, anonim } = parsed.data;
  let hasil: unknown;
  try {
    const supabase = await createClient();
    [hasil] = await mutasiInsert<unknown>(supabase.rpc('kirim_pengaduan_survei', { p_token: token, p_isi: isi, p_anonim: anonim }));
  } catch (e) {
    catatMutasi('error', OPERASI, RUTE, e);
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }

  const h = hasil as { hasil?: string; nomor?: string } | null;
  if (h?.hasil === 'submitted' && typeof h.nomor === 'string') {
    return NextResponse.json({ ok: true, nomor: h.nomor }, { status: 201 });
  }
  const dipetakan = typeof h?.hasil === 'string' ? PEMETAAN[h.hasil] : undefined;
  if (!dipetakan) {
    catatMutasi('error', OPERASI, RUTE, new MutasiError('database'), { statusRpc: String(h?.hasil).slice(0, 32) });
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }
  return NextResponse.json({ error: dipetakan.error }, { status: dipetakan.status });
}
