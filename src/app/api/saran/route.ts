import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

export const dynamic = 'force-dynamic';

// Saran dari tautan publik /saran: tanpa login dan tanpa harus selesai dilayani. RPC `kirim_saran_publik` (migrasi 202611030008)
// hanya menyimpan isi dan (bila diketik pengirim) nama; tidak ada kaitan ke kunjungan atau akun. Route ini pembatas bentuk,
// pembatas laju per IP (penghitung bersama di DB), dan jebakan bot (`website` harus kosong; bot yang mengisinya dijawab sukses tanpa menyimpan apa pun).
// Sejak 202611040001 RPC hanya untuk service_role (dicabut dari anon/authenticated) agar panggilan anon langsung ke
// PostgREST tidak melewati pembatas di atas; pola sama dengan route pengaduan publik.
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

// Penghitung laju BERSAMA di DB (RPC catat_laju_publik, migrasi 202611040001, hanya service_role): satu kuota untuk
// semua instance/proses dan tahan restart. Kunci = SHA-256 IP (IP mentah tidak dikirim ke DB). Hanya kiriman yang
// lolos validasi dan jebakan bot yang dihitung. Pemeriksaan gagal = tolak (fail-closed), bukan diloloskan.
const LAJU_AKSI = 'saran.publik';
const RATE_MAX = 5;
const RATE_WINDOW_DETIK = 10 * 60;

function getClientIp(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim();
  return request.headers.get('x-real-ip') ?? '0.0.0.0';
}

const kunciIp = (ip: string) => createHash('sha256').update(`lmh-laju:${ip}`).digest('hex');

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function POST(request: NextRequest) {
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

  const service = getServiceClient();
  if (!service) {
    catatMutasi('error', OPERASI, RUTE, new MutasiError('database'), { sebab: 'service_role_tidak_dikonfigurasi' });
    return NextResponse.json({ error: GALAT_UMUM }, { status: 500 });
  }

  let diterima: unknown;
  let kodeLaju: string | null = null;
  try {
    const laju = await service.rpc('catat_laju_publik', {
      p_aksi: LAJU_AKSI,
      p_kunci: kunciIp(getClientIp(request)),
      p_maks: RATE_MAX,
      p_jendela_detik: RATE_WINDOW_DETIK,
    });
    diterima = laju.error ? null : laju.data;
    kodeLaju = laju.error?.code ?? null;
  } catch {
    diterima = null;
  }
  if (typeof diterima !== 'boolean') {
    catatMutasi('error', OPERASI, RUTE, new MutasiError('database'), { sebab: 'pembatas_laju_gagal', kode: kodeLaju });
    return NextResponse.json({ error: GALAT_UMUM }, { status: 503 });
  }
  if (!diterima) {
    return NextResponse.json({ error: 'Terlalu banyak kiriman. Coba lagi beberapa menit lagi.' }, { status: 429 });
  }

  let hasil: unknown;
  try {
    [hasil] = await mutasiInsert<unknown>(
      service.rpc('kirim_saran_publik', { p_isi: parsed.data.isi, p_nama: parsed.data.nama || null }),
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
