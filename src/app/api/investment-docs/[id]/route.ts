import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { mutasiWajibBaris } from '@/lib/supabase/mutate';
import { logServerEvent } from '@/lib/observability/logger';
import { catatMutasi } from '@/lib/observability/catat-mutasi';
import { kunciObjek } from '@/lib/storage/area';
import { hapusHalaman, LEASE_MS, milikDokumen } from '../_logika/unggahan';
import { nowServer } from '@/lib/time';
import { deleteObjects } from '@/lib/storage/r2';

type RouteContext = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: petugas } = await supabase
    .from('petugas')
    .select('role')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  let boleh = false;
  try {
    const akses = await supabase.rpc('boleh_kelola_investasi');
    boleh = !akses.error && akses.data === true;
  } catch { /* Akses tetap tertutup bila pemeriksaan sesi gagal. */ }
  if (!petugas || !boleh) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: doc } = await supabase
    .from('investment_documents')
    .select('id, file_path, halaman_gambar, diproses_pada')
    .eq('id', id)
    .maybeSingle();

  if (!doc) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Lease aktif menjadi fence DELETE. Lease basi (fungsi render mati karena timeout) tidak boleh mengunci
  // dokumen selamanya: DELETE memakai CAS pada nilai lease basi itu, jadi render yang baru mengklaim menang.
  if (doc.diproses_pada && nowServer().getTime() - Date.parse(doc.diproses_pada) < LEASE_MS) {
    return NextResponse.json({ error: 'Pemrosesan sedang berjalan. Coba hapus lagi sebentar lagi.' }, { status: 409 });
  }

  const paths: string[] = [];
  const kandidat = [doc.file_path, ...(Array.isArray(doc.halaman_gambar) ? doc.halaman_gambar : [])];
  for (const p of kandidat) {
    if (typeof p !== 'string' || p.length === 0) continue;
    if (milikDokumen(p, id)) paths.push(p);
    else logServerEvent('warn', { operation: 'investment_docs.delete.path_asing', route: '/api/investment-docs/[id]', docId: id });
  }

  // Urutan: baris DB DULU, baru file storage. Bila DB gagal, tidak ada yang berubah (dokumen utuh beserta filenya).
  // Bila storage gagal sesudahnya, yang tersisa file yatim (tak terlihat, bisa dibersihkan) -- jauh lebih aman daripada
  // baris yatim: dokumen tampil di galeri tanpa file-nya. Kegagalan storage dicatat, tidak menggagalkan respons sukses.
  try {
    // Wajib baris: 0 baris (RLS menolak / baris sudah hilang) bukan sukses.
    if (doc.diproses_pada) {
      await mutasiWajibBaris(supabase.from('investment_documents').delete().eq('id', id).eq('diproses_pada', doc.diproses_pada).select('id'));
    } else {
      await mutasiWajibBaris(supabase.from('investment_documents').delete().eq('id', id).is('diproses_pada', null).select('id'));
    }
  } catch (e) {
    catatMutasi('error', 'investment_docs.delete', '/api/investment-docs/[id]', e, { docId: id });
    return NextResponse.json({ error: 'Gagal menghapus dokumen. Coba lagi.' }, { status: 500 });
  }

  // Jalankan keduanya meski salah satu gagal: daftar DB belum tentu memuat PNG terakhir sebelum timeout.
  const hasil = await Promise.allSettled([
    deleteObjects('private', paths.map(p => kunciObjek('investment-docs', p))),
    hapusHalaman(id),
  ]);
  if (hasil.some(r => r.status === 'rejected')) {
    logServerEvent('warn', { operation: 'investment_docs.delete.storage', route: '/api/investment-docs/[id]', docId: id, nFile: paths.length });
  }

  return NextResponse.json({ ok: true, id }, { status: 200 });
}
