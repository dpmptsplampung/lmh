import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

// CMP-02/CMP-06: daftar pengaduan untuk Admin & FO.
// Jalur integritas HANYA untuk Admin (I-15) — FO & petugas tidak pernah melihatnya.
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

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const me = await getRole(supabase);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const jalurParam = request.nextUrl.searchParams.get('jalur');
  // I-15: jalur integritas hanya boleh diakses Admin.
  if (jalurParam === 'integritas' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Petugas membaca lewat view v_pengaduan_petugas (tanpa kontak/lampiran/sesi chat; RLS tabel menolaknya).
  let query = supabase
    .from(me.role === 'petugas' ? 'v_pengaduan_petugas' : 'pengaduan')
    .select('id, nomor_tiket, jalur, layanan_id, status, batas_verifikasi, batas_penanganan, anonim, created_at, isi', { count: 'exact' })
    .order('created_at', { ascending: false });

  if (me.role === 'admin') {
    if (jalurParam) query = query.eq('jalur', jalurParam);
  } else if (me.role === 'front_office') {
    // FO hanya jalur layanan (tidak pernah integritas).
    query = query.eq('jalur', 'layanan');
  } else {
    // petugas layanan: hanya jalur layanan miliknya.
    query = query.eq('jalur', 'layanan').eq('layanan_id', me.layanan_id);
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
  const { data, error, count } = await query.range(
    from,
    from + pageParams.data.page_size - 1,
  );
  if (error) return NextResponse.json({ error: 'Gagal memuat pengaduan' }, { status: 500 });
  return NextResponse.json({
    total: count ?? 0,
    page: pageParams.data.page,
    page_size: pageParams.data.page_size,
    rows: data ?? [],
  });
}

// Ubah status pengaduan (verifikasi, proses, selesai, dll) — dicatat di riwayat.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const me = await getRole(supabase);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  // Tindak lanjut = Admin/FO. Petugas hanya melihat (sebelumnya RLS menolak diam-diam -> "sukses palsu").
  if (me.role !== 'admin' && me.role !== 'front_office') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { id?: string; status?: string; catatan?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const { id, status, catatan } = body;
  const allowed = ['diverifikasi', 'diproses', 'selesai', 'ditolak'];
  if (!id || !status || !allowed.includes(status)) {
    return NextResponse.json({ error: 'id dan status valid diperlukan' }, { status: 400 });
  }

  // Ambil pengaduan untuk cek jalur & otorisasi.
  const { data: row } = await supabase.from('pengaduan').select('id, jalur, layanan_id, status').eq('id', id).maybeSingle();
  if (!row) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });

  if (row.jalur === 'integritas' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: updated, error: updErr } = await supabase
    .from('pengaduan')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id');
  if (updErr) return NextResponse.json({ error: 'Gagal memperbarui status' }, { status: 500 });
  // RLS menolak UPDATE = 0 baris tanpa galat: jangan melapor sukses.
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await supabase.from('pengaduan_riwayat').insert({
    pengaduan_id: id,
    status_lama: row.status,
    status_baru: status,
    catatan: catatan ?? null,
    diubah_oleh: me.id,
  });

  return NextResponse.json({ ok: true });
}
