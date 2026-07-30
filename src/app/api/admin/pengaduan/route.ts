import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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

  let query = supabase
    .from('pengaduan')
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

  const { data, error, count } = await query.limit(100);
  if (error) return NextResponse.json({ error: 'Gagal memuat pengaduan' }, { status: 500 });
  return NextResponse.json({ total: count ?? 0, rows: data ?? [] });
}

// Ubah status pengaduan (verifikasi, proses, selesai, dll) — dicatat di riwayat.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const me = await getRole(supabase);
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  if (me.role === 'petugas' && row.layanan_id !== me.layanan_id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { error: updErr } = await supabase
    .from('pengaduan')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (updErr) return NextResponse.json({ error: 'Gagal memperbarui status' }, { status: 500 });

  await supabase.from('pengaduan_riwayat').insert({
    pengaduan_id: id,
    status_lama: row.status,
    status_baru: status,
    catatan: catatan ?? null,
    diubah_oleh: me.id,
  });

  return NextResponse.json({ ok: true });
}
