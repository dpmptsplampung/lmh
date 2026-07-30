import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// CMP-05: lacak status pengaduan TANPA login — butuh nomor tiket + kontak.
// Rate limit ketat untuk mencegah penebakan nomor tiket.
const querySchema = z.object({
  tiket: z.string().min(5).max(20),
  kontak: z.string().min(3).max(200),
});

const RATE_MAX = 10;
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

export async function GET(request: NextRequest) {
  if (!checkRate(getClientIp(request))) {
    return NextResponse.json(
      { error: 'Terlalu banyak percobaan. Coba lagi nanti.' },
      { status: 429 },
    );
  }

  const parsed = querySchema.safeParse({
    tiket: request.nextUrl.searchParams.get('tiket') ?? '',
    kontak: request.nextUrl.searchParams.get('kontak') ?? '',
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'Nomor tiket dan kontak wajib diisi' }, { status: 400 });
  }

  const { tiket, kontak } = parsed.data;
  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }

  const { data, error } = await service.rpc('lacak_pengaduan', {
    p_tiket: tiket,
    p_kontak: kontak,
  });

  if (error) {
    return NextResponse.json({ error: 'Gagal melacak pengaduan' }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // Jangan ungkap apakah tiket ada — pesan generik (CMP-05).
    return NextResponse.json(
      { error: 'Pengaduan tidak ditemukan. Periksa kembali nomor tiket dan kontak.' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    nomor_tiket: row.nomor_tiket,
    jalur: row.jalur,
    status: row.status,
    dibuat_pada: row.created_at,
  });
}
