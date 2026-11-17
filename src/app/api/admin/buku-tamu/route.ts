import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json } from '@/lib/akun/server';
import { normalizeNoHp } from '@/lib/akun/login';
import { guardTamu, KOLOM_TAMU, petaTamu, queryTamu, kueriTamu, type BarisTamu } from '@/lib/buku-tamu/server';
import { normalisasiAsal, normalisasiHp, normalisasiNama, periksaAsal, periksaHp, periksaNama } from '@/lib/fo/walkin';

export const dynamic = 'force-dynamic';

// Bentuk dasar saja; aturan isian (nama, instansi, nomor HP) memakai pemeriksa yang SAMA dengan formulir klien dan
// walk-in Front Office (`lib/fo/walkin`), agar pesan galatnya identik di semua tempat.
const body = z
  .object({
    nama: z.string().max(200),
    instansi: z.string().max(200).optional(),
    no_hp: z.string().max(30).optional(),
    bertemu: z.string().trim().min(2).max(200),
    menemui_petugas_id: z.uuid().nullable().optional(),
    tujuan: z.string().trim().max(500).optional(),
    waktu_masuk: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

// Buku tamu kantor: Admin + Front Office (RLS menegakkan; Petugas ditolak di sini dan di DB).
export async function GET(request: NextRequest) {
  const g = await guardTamu();
  if ('res' in g) return g.res;
  const parsed = queryTamu.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { page, limit } = parsed.data;
  const { data, count, error } = await kueriTamu(g.supabase, parsed.data, true).range((page - 1) * limit, page * limit - 1);
  if (error) return json({ error: 'Gagal memuat buku tamu' }, 500);
  return json({ items: ((data ?? []) as unknown as BarisTamu[]).map(petaTamu), total: count ?? 0, page, limit });
}

const keluar = z.object({ id: z.uuid(), waktu_keluar: z.iso.datetime({ offset: true }).optional() }).strict();
export async function PATCH(request: NextRequest) {
  const g = await guardTamu();
  if ('res' in g) return g.res;
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = keluar.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { data, error } = await g.supabase.rpc('buku_tamu_catat_keluar', {
    p_id: parsed.data.id, p_waktu_keluar: parsed.data.waktu_keluar ?? null,
  });
  if (error) {
    const kode = /^(TAMU_TIDAK_ADA|WAKTU_TIDAK_VALID|FORBIDDEN|SESI_TIDAK_SAH):/.exec(error.message)?.[1];
    const status = kode === 'TAMU_TIDAK_ADA' ? 404 : kode === 'WAKTU_TIDAK_VALID' ? 400 : kode === 'FORBIDDEN' ? 403 : kode === 'SESI_TIDAK_SAH' ? 401 : 500;
    return json({ error: kode ? error.message.replace(/^[A-Z_]+: */g, '') : 'Gagal mencatat waktu keluar', ...(kode ? { kode } : {}) }, status);
  }
  return json({ tamu: data });
}

export async function POST(request: NextRequest) {
  const g = await guardTamu();
  if ('res' in g) return g.res;
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = body.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const b = parsed.data;

  const galat: Record<string, string[]> = {};
  const gNama = periksaNama(b.nama);
  if (gNama) galat.nama = [gNama];
  const gAsal = periksaAsal(b.instansi ?? '');
  if (gAsal) galat.instansi = [gAsal];
  const gHp = periksaHp(b.no_hp ?? '');
  if (gHp) galat.no_hp = [gHp];
  if (Object.keys(galat).length > 0) {
    // `error` = pesan isian pertama (urutan formulir) agar klien yang hanya membaca `error` tetap menampilkan hal yang benar.
    const pertama = galat.nama?.[0] ?? galat.instansi?.[0] ?? galat.no_hp?.[0];
    return json({ error: pertama, details: galat }, 400);
  }
  // Disimpan sebagai E.164 (+62...), bentuk yang sudah dipakai data lama.
  const noHp = normalizeNoHp(normalisasiHp(b.no_hp ?? ''));
  if (!noHp) return json({ error: 'Format nomor HP tidak valid', details: { no_hp: ['Format nomor HP tidak valid'] } }, 400);
  let waktu = new Date();
  if (b.waktu_masuk) {
    waktu = new Date(b.waktu_masuk);
    const selisih = Date.now() - waktu.getTime();
    if (selisih < -5 * 60_000 || selisih > 48 * 3_600_000) {
      return json({ error: 'waktu_masuk harus dalam 48 jam terakhir dan tidak di masa depan' }, 400);
    }
  }

  const { data, error } = await g.supabase
    .from('buku_tamu')
    .insert({
      nama: normalisasiNama(b.nama),
      asal: normalisasiAsal(b.instansi ?? ''),
      no_hp: noHp,
      menemui_siapa: b.bertemu,
      menemui_petugas_id: b.menemui_petugas_id ?? null,
      keperluan: b.tujuan || null,
      waktu_masuk: waktu.toISOString(),
      dicatat_oleh: g.me.id,
    })
    .select(KOLOM_TAMU)
    .single();
  if (error?.code === '23503') return json({ error: 'Petugas yang ditemui tidak ditemukan' }, 400);
  if (error || !data) {
    console.error('[admin/buku-tamu POST] gagal', error?.message);
    return json({ error: 'Gagal menyimpan tamu' }, 500);
  }
  return json({ tamu: petaTamu(data as unknown as BarisTamu) }, 201);
}
