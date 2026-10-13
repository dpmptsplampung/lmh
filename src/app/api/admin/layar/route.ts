// WP-29 / DSP-07: Admin API for managing layar_token rows.
// POST { aksi: 'buat', nama: string } → creates and returns a new token
// POST { aksi: 'cabut', id: string } → deactivates a token

import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal, statusMutasi } from '@/app/api/admin/_mutasi';
import { logServerEvent } from '@/lib/observability/logger';
import { NextRequest, NextResponse } from 'next/server';

interface BuatBody { aksi: 'buat'; nama: string }
interface CabutBody { aksi: 'cabut'; id: string }
type Body = BuatBody | CabutBody;

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('layar_token')
    .select('id, token, nama, aktif, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    // Pesan DB tidak dikirim ke klien; hanya kode SQLSTATE yang dicatat.
    logServerEvent('error', { operation: 'admin.layar.daftar', route: '/api/admin/layar', asalCode: error.code || undefined });
    return NextResponse.json({ error: 'Gagal memuat daftar layar. Coba lagi.' }, { status: 500 });
  }
  return NextResponse.json({ data });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  // Verify admin role
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: petugas } = await supabase
    .from('petugas')
    .select('id, role')
    .eq('auth_user_id', user.id)
    .single();

  if (petugas?.role !== 'admin') {
    return NextResponse.json({ error: 'Hanya Admin yang dapat mengelola layar' }, { status: 403 });
  }

  const body: Body = await req.json();

  if (body.aksi === 'buat') {
    if (!body.nama?.trim()) {
      return NextResponse.json({ error: 'Nama layar wajib diisi' }, { status: 400 });
    }
    const { data, error } = await supabase
      .from('layar_token')
      .insert({ nama: body.nama.trim(), dibuat_oleh: petugas.id })
      .select('id, token, nama, aktif, created_at')
      .single();
    if (error) {
      logServerEvent('error', { operation: 'admin.layar.buat', route: '/api/admin/layar', asalCode: error.code || undefined });
      return NextResponse.json({ error: 'Gagal membuat token layar. Coba lagi.' }, { status: 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  }

  if (body.aksi === 'cabut') {
    if (!body.id) {
      return NextResponse.json({ error: 'ID layar wajib diisi' }, { status: 400 });
    }
    // Keamanan: 0 baris (id salah / ditolak RLS) berarti token layar TETAP aktif, jadi tidak boleh dilaporkan ok.
    try {
      await mutasiWajibBaris(
        supabase.from('layar_token').update({ aktif: false }).eq('id', body.id).select('id'),
      );
    } catch (e) {
      if (!(e instanceof MutasiError)) throw e;
      catatMutasiGagal('/api/admin/layar', 'admin.layar.cabut', e, { layarId: body.id });
      return NextResponse.json({ error: e.pesan }, { status: statusMutasi(e) });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Aksi tidak dikenal' }, { status: 400 });
}