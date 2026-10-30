import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { MutasiError, mutasiInsert } from '@/lib/supabase/mutate';
import { catatMutasi } from '@/lib/observability/catat-mutasi';

export const dynamic = 'force-dynamic';

const ROUTE = '/api/pengaduan';

// CMP-01/CMP-05: buat pengaduan baru (publik, tanpa login wajib).
// Rate limit per-IP sederhana untuk mencegah spam (CMP-05).
const bodySchema = z.object({
  jalur: z.enum(['layanan', 'integritas']),
  isi: z.string().min(10).max(5000),
  kontak: z.string().max(200).optional(),
  layanan_id: z.string().uuid().optional(),
  anonim: z.boolean().optional(),
});

const POLA_NOMOR_LAPORAN = /^P[A-HJKMNP-Z2-9]{8}$/;

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

  // Anonim sungguhan: kontak dibuang di server walau klien mengirimnya (mis. diketik lalu kotak anonim dicentang).
  const kontakFinal = anonim ? null : (kontak?.trim() || null);

  let rows: { nomor_tiket?: string }[];
  try {
    try {
      rows = await mutasiInsert<{ nomor_tiket?: string }>(
        service.rpc('kirim_pengaduan_publik', {
          p_jalur: jalur,
          p_isi: isi,
          p_layanan_id: layanan_id ?? null,
          p_anonim: anonim ?? false,
          p_kontak: kontakFinal,
        }),
      );
    } catch (e) {
      // Migrasi 202611030008 belum diterapkan: pakai jalur lama (nomor tiket lama, pelacakan butuh kontak) agar kanal tidak mati.
      const asalLama = (e instanceof MutasiError ? e.asal : undefined) as { code?: string } | undefined;
      if (asalLama?.code !== 'PGRST202' && asalLama?.code !== '42883') throw e;
      rows = await mutasiInsert<{ nomor_tiket?: string }>(
        service.rpc('buat_pengaduan', {
          p_jalur: jalur,
          p_isi: isi,
          p_kontak: kontakFinal,
          p_layanan_id: layanan_id ?? null,
          p_anonim: anonim ?? false,
          p_sesi_chat_id: null,
        }),
      );
    }
  } catch (e) {
    const asal = (e instanceof MutasiError ? e.asal : undefined) as { code?: string; message?: string } | undefined;
    // RAISE EXCEPTION di RPC (P0001) = pesan validasi yang memang ditulis untuk pengguna (kontrak lama: 400).
    if (asal?.code === 'P0001') {
      return NextResponse.json({ error: asal.message || 'Gagal menyimpan pengaduan' }, { status: 400 });
    }
    // layanan_id yang tidak ada (FK): salah input, tetapi pesan database-nya memuat nama konstrain -> pesan baku.
    if (asal?.code === '23503') {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }
    // Selebihnya galat teknis: dicatat, jangan bocorkan pesan database ke klien publik.
    catatMutasi('error', 'pengaduan.buat', ROUTE, e);
    return NextResponse.json({ error: 'Gagal menyimpan pengaduan' }, { status: 500 });
  }

  // RPC sukses tanpa nomor tiket = tidak ada yang bisa dilacak pelapor; jangan dijawab 201 "simpan nomor tiket ini".
  const row = rows[0];
  if (!row?.nomor_tiket) {
    catatMutasi('error', 'pengaduan.buat', ROUTE, new MutasiError('tidak_ada_baris'));
    return NextResponse.json({ error: 'Gagal menyimpan pengaduan' }, { status: 500 });
  }
  // Nomor laporan baru ('P' + 8 karakter acak) cukup untuk memantau tanpa kontak; nomor lama tetap perlu kontak.
  const lacakDenganNomor = POLA_NOMOR_LAPORAN.test(row.nomor_tiket);
  return NextResponse.json(
    {
      nomor_tiket: row.nomor_tiket,
      lacak_dengan_nomor: lacakDenganNomor,
      pesan:
        'Pengaduan Anda tercatat. Simpan nomor laporan ini untuk memantau status. ' +
        'Batas verifikasi 3 hari kerja, penanganan 14 hari kerja.',
    },
    { status: 201 },
  );
}
