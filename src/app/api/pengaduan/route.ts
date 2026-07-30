import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// CMP-01/CMP-05: buat pengaduan baru (publik, tanpa login wajib).
// Rate limit per-IP sederhana untuk mencegah spam (CMP-05).
const bodySchema = z.object({
  jalur: z.enum(['layanan', 'integritas']),
  isi: z.string().min(10).max(5000),
  kontak: z.string().max(200).optional(),
  layanan_id: z.string().uuid().optional(),
  anonim: z.boolean().optional(),
});

const RATE_MAX = 5;
const RATE_WINDOW_MS = 60_000;
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

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key);
}

export async function POST(request: NextRequest) {
  if (!checkRate(getClientIp(request))) {
    return NextResponse.json(
      { error: 'Terlalu banyak permintaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }

  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(parsedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Input tidak valid', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const { jalur, isi, kontak, layanan_id, anonim } = parsed.data;
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data, error } = await service.rpc('buat_pengaduan', {
    p_jalur: jalur,
    p_isi: isi,
    p_kontak: kontak ?? null,
    p_layanan_id: layanan_id ?? null,
    p_anonim: anonim ?? false,
    p_sesi_chat_id: null,
  });

  if (error) {
    return NextResponse.json(
      { error: error.message || 'Gagal menyimpan pengaduan' },
      { status: 400 },
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  return NextResponse.json(
    {
      nomor_tiket: row?.nomor_tiket,
      pesan:
        'Pengaduan Anda tercatat. Simpan nomor tiket ini untuk melacak status. ' +
        'Batas verifikasi 3 hari kerja, penanganan 14 hari kerja.',
    },
    { status: 201 },
  );
}
