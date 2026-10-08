import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { json, requireStaf } from '@/lib/akun/server';
import { normalizeNoHp } from '@/lib/akun/login';
import { todayWIB } from '@/lib/time';

export const dynamic = 'force-dynamic';

const KOLOM = 'id, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk, dicatat_oleh';
type Baris = {
  id: string; nama: string; asal: string | null; no_hp: string | null; menemui_siapa: string;
  keperluan: string | null; waktu_masuk: string; dicatat_oleh: string | null;
};
const peta = (r: Baris) => ({
  id: r.id, nama: r.nama, instansi: r.asal, no_hp: r.no_hp, bertemu: r.menemui_siapa,
  tujuan: r.keperluan, waktu_masuk: r.waktu_masuk, dicatat_oleh: r.dicatat_oleh,
});

const tgl = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const query = z.object({
  dari: tgl.optional(),
  sampai: tgl.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const body = z
  .object({
    nama: z.string().trim().min(2).max(200),
    instansi: z.string().trim().max(200).optional(),
    no_hp: z.string().trim().max(30).optional(),
    bertemu: z.string().trim().min(2).max(200),
    tujuan: z.string().trim().max(500).optional(),
    waktu_masuk: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

// Buku tamu kantor: Admin + Front Office (RLS menegakkan; Petugas ditolak di sini dan di DB).
async function guard() {
  const g = await requireStaf();
  if ('res' in g) return g;
  if (g.me.role !== 'admin' && g.me.role !== 'front_office') return { res: json({ error: 'Forbidden' }, 403) };
  return g;
}

export async function GET(request: NextRequest) {
  const g = await guard();
  if ('res' in g) return g.res;
  const sp = Object.fromEntries(request.nextUrl.searchParams);
  const parsed = query.safeParse(sp);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const { q, page, limit } = parsed.data;
  const dari = parsed.data.dari ?? todayWIB();
  const sampai = parsed.data.sampai ?? dari;

  let qb = g.supabase
    .from('buku_tamu')
    .select(KOLOM, { count: 'exact' })
    .gte('waktu_masuk', `${dari}T00:00:00+07:00`)
    .lte('waktu_masuk', `${sampai}T23:59:59.999+07:00`)
    .order('waktu_masuk', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);
  if (q) {
    const s = q.replace(/[%_,()\\]/g, ' ');
    qb = qb.or(`nama.ilike.%${s}%,asal.ilike.%${s}%,menemui_siapa.ilike.%${s}%`);
  }
  const { data, count, error } = await qb;
  if (error) {
    console.error('[admin/buku-tamu GET] gagal', error.message);
    return json({ error: 'Gagal memuat buku tamu' }, 500);
  }
  return json({ items: ((data ?? []) as unknown as Baris[]).map(peta), total: count ?? 0, page, limit });
}

export async function POST(request: NextRequest) {
  const g = await guard();
  if ('res' in g) return g.res;
  let raw: unknown;
  try { raw = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const parsed = body.safeParse(raw);
  if (!parsed.success) return json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, 400);
  const b = parsed.data;

  let noHp: string | null = null;
  if (b.no_hp) {
    noHp = normalizeNoHp(b.no_hp);
    if (!noHp) return json({ error: 'Format nomor HP tidak valid' }, 400);
  }
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
      nama: b.nama,
      asal: b.instansi || null,
      no_hp: noHp,
      menemui_siapa: b.bertemu,
      keperluan: b.tujuan || null,
      waktu_masuk: waktu.toISOString(),
      dicatat_oleh: g.me.id,
    })
    .select(KOLOM)
    .single();
  if (error || !data) {
    console.error('[admin/buku-tamu POST] gagal', error?.message);
    return json({ error: 'Gagal menyimpan tamu' }, 500);
  }
  return json({ tamu: peta(data as unknown as Baris) }, 201);
}
