import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import { z } from 'zod';
import { objekBelumAda } from '@/lib/akses-data/galat';
import { UUID } from './_aksi';
import { KOLOM_KERJA, KOLOM_LEGACY, KOLOM_PETUGAS_BARU, filterValid, type FilterPengaduan, type RingkasanPengaduan } from '@/lib/pengaduan/tampilan';

export const dynamic = 'force-dynamic';

// CMP-02/CMP-06: daftar pengaduan untuk Admin & FO.
// Jalur integritas HANYA untuk Admin (I-15): FO dan petugas tidak pernah melihatnya.
async function getRole(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: p } = await supabase
    .from('petugas')
    .select('id, role, layanan_id, aktif')
    .eq('auth_user_id', user.id)
    .maybeSingle();
  return p && p.aktif !== false ? p : null;
}

type Klien = Awaited<ReturnType<typeof createClient>>;
// Antarmuka sempit: tipe generik query Supabase terlalu dalam bila diteruskan antarfungsi (TS2589).
interface Saring {
  eq(k: string, v: string | boolean | null): Saring;
  in(k: string, v: string[]): Saring;
  order(k: string, o: { ascending?: boolean; nullsFirst?: boolean }): Saring;
  range(a: number, b: number): PromiseLike<{ data: unknown[] | null; error: { code?: string } | null; count: number | null }>;
}
const saring = (q: unknown) => q as Saring;
type Peran = NonNullable<Awaited<ReturnType<typeof getRole>>>;

// Filter ringkasan -> kondisi kolom view v_pengaduan_kerja (terbuka/sla_status dihitung server, hari kerja).
function terapkanFilterKerja(q: Saring, filter: FilterPengaduan): Saring {
  switch (filter) {
    case 'aktif': return q.eq('terbuka', true);
    case 'baru': return q.eq('status', 'baru');
    case 'diproses': return q.in('status', ['diverifikasi', 'diproses', 'eskalasi']);
    case 'mendekati': return q.eq('sla_status', 'mendekati');
    case 'terlambat': return q.eq('sla_status', 'terlambat');
    case 'selesai': return q.eq('status', 'selesai');
    case 'arsip': return q.eq('terbuka', false);
    default: return q;
  }
}

// Sebelum migrasi 202611030013 diterapkan: filter berdasar status saja (tanpa SLA hari kerja dan penangan).
function terapkanFilterLegacy(q: Saring, filter: FilterPengaduan): Saring {
  switch (filter) {
    case 'aktif': return q.in('status', ['baru', 'diverifikasi', 'diproses', 'eskalasi']);
    case 'baru': return q.eq('status', 'baru');
    case 'diproses': return q.in('status', ['diverifikasi', 'diproses', 'eskalasi']);
    case 'selesai': return q.eq('status', 'selesai');
    case 'arsip': return q.in('status', ['selesai', 'ditolak']);
    default: return q;
  }
}

function batasiJalur(q: Saring, me: Peran, jalurParam: string | null): Saring {
  if (me.role === 'admin') return jalurParam ? q.eq('jalur', jalurParam) : q;
  if (me.role === 'front_office') return q.eq('jalur', 'layanan'); // FO tidak pernah melihat integritas
  return q.eq('jalur', 'layanan').eq('layanan_id', me.layanan_id); // petugas layanan: layanannya sendiri
}

async function ringkasan(supabase: Klien, jalur: string): Promise<RingkasanPengaduan | null> {
  const { data, error } = await supabase.rpc('ringkasan_pengaduan_kerja', { p_jalur: jalur });
  if (error || !data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const n = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : 0);
  return { baru: n('baru'), diproses: n('diproses'), mendekati: n('mendekati'), terlambat: n('terlambat'), selesai: n('selesai'), ditolak: n('ditolak') };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const me = await getRole(supabase);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jalurParam = request.nextUrl.searchParams.get('jalur');
  // I-15: jalur integritas hanya boleh diakses Admin.
  if (jalurParam === 'integritas' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Paginasi eksplisit: tanpa .range() PostgREST memotong di 1.000 baris dan
  // .limit(100) menyembunyikan sisanya tanpa indikasi.
  const pageParams = z
    .object({
      page: z.coerce.number().int().min(0).default(0),
      page_size: z.coerce.number().int().min(1).max(100).default(50),
    })
    .safeParse({
      page: request.nextUrl.searchParams.get('page') ?? undefined,
      page_size: request.nextUrl.searchParams.get('page_size') ?? undefined,
    });
  if (!pageParams.success) {
    return NextResponse.json({ error: 'Parameter halaman tidak valid' }, { status: 422 });
  }
  const from = pageParams.data.page * pageParams.data.page_size;
  const to = from + pageParams.data.page_size - 1;
  const filter = filterValid(request.nextUrl.searchParams.get('filter'));
  // ?id=<uuid>: satu baris (menyegarkan panel rincian setelah aksi), tanpa filter status dan tanpa ringkasan.
  const idParam = request.nextUrl.searchParams.get('id');
  if (idParam && !UUID.test(idParam)) return NextResponse.json({ error: 'Parameter id tidak valid' }, { status: 422 });
  const tinjau = me.role === 'admin' || me.role === 'front_office';

  // Petugas layanan: view v_pengaduan_petugas (tanpa kontak/lampiran/sesi chat; RLS tabel menolaknya), urut terbaru, tanpa filter kerja.
  if (!tinjau) {
    const baca = (kolom: string) => {
      const q = batasiJalur(saring(supabase.from('v_pengaduan_petugas').select(kolom, { count: 'exact' })), me, jalurParam);
      return (idParam ? q.eq('id', idParam) : q).order('created_at', { ascending: false }).range(from, to);
    };
    let hasil = await baca(KOLOM_PETUGAS_BARU);
    if (hasil.error && objekBelumAda(hasil.error)) hasil = await baca(KOLOM_LEGACY);
    if (hasil.error) return NextResponse.json({ error: 'Gagal memuat pengaduan' }, { status: 500 });
    return NextResponse.json({ total: hasil.count ?? 0, page: pageParams.data.page, page_size: pageParams.data.page_size, rows: hasil.data ?? [], ringkasan: null, fitur: { kerja: false } });
  }

  // Admin/FO: view kerja. Urutan: urutan_kerja (0 baru, 1 terbuka lain, 2 arsip), batas aktif terdekat dulu, lalu terbaru.
  const bacaKerja = batasiJalur(saring(supabase.from('v_pengaduan_kerja').select(KOLOM_KERJA, { count: 'exact' })), me, jalurParam);
  const kerja = await (idParam ? bacaKerja.eq('id', idParam) : terapkanFilterKerja(bacaKerja, filter)).order('urutan_kerja', { ascending: true }).order('batas_aktif', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).range(from, to);

  if (!kerja.error) {
    return NextResponse.json({
      total: kerja.count ?? 0,
      page: pageParams.data.page,
      page_size: pageParams.data.page_size,
      rows: kerja.data ?? [],
      ringkasan: idParam ? null : await ringkasan(supabase, jalurParam ?? 'layanan'),
      fitur: { kerja: true },
    });
  }
  if (!objekBelumAda(kerja.error)) return NextResponse.json({ error: 'Gagal memuat pengaduan' }, { status: 500 });

  // Migrasi belum diterapkan: tabel lama, tanpa penangan dan SLA hari kerja server.
  const bacaLama = batasiJalur(saring(supabase.from('pengaduan').select(KOLOM_LEGACY, { count: 'exact' })), me, jalurParam);
  const lama = await (idParam ? bacaLama.eq('id', idParam) : terapkanFilterLegacy(bacaLama, filter)).order('created_at', { ascending: false }).range(from, to);
  if (lama.error) return NextResponse.json({ error: 'Gagal memuat pengaduan' }, { status: 500 });
  return NextResponse.json({ total: lama.count ?? 0, page: pageParams.data.page, page_size: pageParams.data.page_size, rows: lama.data ?? [], ringkasan: null, fitur: { kerja: false } });
}

// Ubah status pengaduan (verifikasi, proses, selesai, dll), dicatat di riwayat.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const me = await getRole(supabase);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Tindak lanjut = Admin/FO. Petugas hanya melihat (sebelumnya RLS menolak diam-diam -> "sukses palsu").
  if (me.role !== 'admin' && me.role !== 'front_office') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = z.object({
    id: z.string().uuid(),
    status: z.enum(['diverifikasi', 'diproses', 'selesai', 'ditolak']),
    catatan: z.string().trim().max(2000).optional(),
  }).strict().refine((data) => data.status !== 'ditolak' || !!data.catatan, {
    message: 'Alasan penolakan wajib diisi',
    path: ['catatan'],
  }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'ID, status, dan catatan tidak valid. Alasan wajib untuk penolakan.' }, { status: 400 });
  }
  const { id, status, catatan } = parsed.data;

  // Ambil pengaduan untuk cek jalur & otorisasi.
  const { data: row } = await supabase.from('pengaduan').select('id, jalur, layanan_id, status').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });

  if (row.jalur === 'integritas' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    // RLS menolak UPDATE = 0 baris tanpa galat: jangan melapor sukses (kontrak lama: 403).
    await mutasiWajibBaris(
      supabase
        .from('pengaduan')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('id'),
    );
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    catatMutasiGagal('/api/admin/pengaduan', 'admin.pengaduan.ubah_status', e, { pengaduanId: id });
    if (e.kode === 'tidak_ada_baris' || e.kode === 'ditolak') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ error: 'Gagal memperbarui status' }, { status: 500 });
  }

  // Status SUDAH berubah; riwayat gagal ditulis tidak membatalkannya (tidak ada transaksi lintas-klien di sini),
  // tetapi tidak boleh hilang diam-diam: dicatat dan dikabarkan lewat `peringatan` (klien lama hanya membaca res.ok).
  try {
    await mutasiInsert(
      supabase.from('pengaduan_riwayat').insert({
        pengaduan_id: id,
        status_lama: row.status,
        status_baru: status,
        catatan: catatan ?? null,
        diubah_oleh: me.id,
      }),
    );
  } catch (e) {
    if (!(e instanceof MutasiError)) throw e;
    catatMutasiGagal('/api/admin/pengaduan', 'admin.pengaduan.riwayat', e, { pengaduanId: id });
    return NextResponse.json({ ok: true, peringatan: 'Status diperbarui, tetapi riwayat perubahan gagal dicatat.' });
  }

  return NextResponse.json({ ok: true });
}
