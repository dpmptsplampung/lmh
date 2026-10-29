import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

export const dynamic = 'force-dynamic';

// Saran dari tautan publik /saran: tanpa login dan tanpa harus selesai dilayani. RPC `kirim_saran_publik` (migrasi 202611030008)
// hanya menyimpan isi dan (bila diketik pengirim) nama; tidak ada kaitan ke kunjungan atau akun. Route ini pembatas bentuk,
// pembatas laju per IP, dan jebakan bot (`website` harus kosong; bot yang mengisinya dijawab sukses tanpa menyimpan apa pun).
const OPERASI = 'saran.publik';
const RUTE = '/api/saran';
const GALAT_UMUM = 'Gagal mengirim saran';

const bodySchema = z
  .object({
    isi: z.string().trim().min(5, 'Saran minimal 5 karakter').max(2000),
    nama: z.string().trim().max(120).optional(),
    website: z.string().max(200).optional(),
  })
  .strict();

const RATE_MAX = 5;
const RATE_WINDOW_MS = 10 * 60_000;
const rateBuckets = new Map<string, { start: number; count: number }>();

function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? '0.0.0.0';
}

function checkRate(ip: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(ip);
  if (!b || now - b.start >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return true;
  }
  b.count += 1;
  return b.count <= RATE_MAX;
}

export async function POST(request: NextRequest) {
  if (!checkRate(getClientIp(request))) {
    return NextResponse.json({ error: 'Terlalu banyak kiriman. Coba lagi beberapa menit lagi.' }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    const pesan = parsed.error.issues[0]?.message;
    return NextResponse.json({ error: pesan && pesan.startsWith('Saran') ? pesan : 'Input tidak valid' }, { status: 400 });
  }

  // Jebakan bot: kolom tersembunyi terisi = bukan manusia. Dijawab sukses supaya bot tidak belajar menghindarinya.
  if (parsed.data.website) return NextResponse.json({ ok: true }, { status: 201 });

  let hasil: unknown;
  try {
    const supabase = await createClient();
    [hasil] = await mutasiInsert<unknown>(
      supabase.rpc('kirim_saran_publik', { p_isi: parsed.data.isi, p_nama: parsed.data.nama || null }),
    );
  } catch (e) {
    catatMutasi('error', OPERASI, RUTE, e);
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }

  if (hasil === 'submitted') return NextResponse.json({ ok: true }, { status: 201 });
  if (hasil === 'invalid') return NextResponse.json({ error: 'Saran minimal 5 karakter dan maksimal 2000 karakter' }, { status: 400 });
  catatMutasi('error', OPERASI, RUTE, new MutasiError('database'), { statusRpc: String(hasil).slice(0, 32) });
  return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
}
