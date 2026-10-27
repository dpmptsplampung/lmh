import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { kirimSurveiSchema } from '@/lib/survei/schemas';

// Pengiriman jawaban "Pesan Perilaku" (SPAK + SKM) oleh pengunjung anonim. Satu-satunya jalur tulis jawaban: RPC
// `kirim_survei` (migrasi 202610270003) memvalidasi ulang, mengunci undangan, dan menulis atomik dengan jam database.
// Route ini hanya pembatas bentuk (zod strict) agar payload nakal tidak pernah sampai ke RPC.
const OPERASI = 'survei.kirim';
const RUTE = '/api/survei/kirim';

const GALAT_UMUM = 'Gagal mengirim survei';

// Status teks dari RPC selain 'submitted'. Status lain yang tak dikenal diperlakukan sebagai kegagalan server (500).
const PEMETAAN: Record<string, { status: number; error: string }> = {
  invalid: { status: 400, error: 'Jawaban survei tidak valid' },
  not_found: { status: 404, error: 'Tautan survei tidak ditemukan' },
  duplicate: { status: 409, error: 'Survei ini sudah terisi' },
  expired: { status: 410, error: 'Tautan survei sudah kedaluwarsa' },
};

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Sengaja tanpa `details` zod: wizard menyusun payload sendiri, dan galat tidak perlu memantulkan isi kiriman.
  const parsed = kirimSurveiSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Input survei tidak valid' }, { status: 400 });
  }

  const { token, spak, skm } = parsed.data;
  let hasil: unknown;
  try {
    const supabase = await createClient();
    // RPC mengembalikan teks status ('submitted' | 'invalid' | 'expired' | 'duplicate' | 'not_found').
    [hasil] = await mutasiInsert<string>(supabase.rpc('kirim_survei', { p_token: token, p_spak: spak, p_skm: skm }));
  } catch (e) {
    catatMutasi('error', OPERASI, RUTE, e);
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }

  if (typeof hasil !== 'string') {
    catatMutasi('error', OPERASI, RUTE, new MutasiError('tidak_ada_baris'));
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }
  if (hasil === 'submitted') {
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const dipetakan = PEMETAAN[hasil];
  if (!dipetakan) {
    // Status baru di RPC yang belum dipetakan di sini: jangan dianggap sukses, dan catat agar ketahuan.
    catatMutasi('error', OPERASI, RUTE, new MutasiError('database'), { statusRpc: hasil.slice(0, 32) });
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }
  return NextResponse.json({ error: dipetakan.error }, { status: dipetakan.status });
}
