import { z } from 'zod';
import { layaniKelola } from '@/lib/investasi/akses-server';
import { bacaJson, galat, galatRpc, sukses } from '@/lib/investasi/http';
import { invalidasiInvestasiPublik } from '@/lib/investasi/cache-server';
import { metadataDokumen, statusDokumenTerbit, urutanDokumen } from '../_logika/metadata';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiBolehKosong, mutasiWajibBaris } from '@/lib/supabase/mutate';
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

  invalidasiInvestasiPublik();
  return NextResponse.json({ ok: true, id }, { status: 200 });
}


const permintaanMutasi = z.discriminatedUnion('aksi', [
  z.strictObject({
    aksi: z.literal('status'), status: statusDokumenTerbit, status_lama: statusDokumenTerbit, urutan_lama: z.never().optional(),
  }),
  z.strictObject({
    ...metadataDokumen,
    aksi: z.literal('metadata'), deskripsi: metadataDokumen.deskripsi.nullable(),
    nilai_investasi: metadataDokumen.nilai_investasi.nullable(), image_url: metadataDokumen.image_url.nullable(),
    status: statusDokumenTerbit.optional(), status_lama: statusDokumenTerbit.optional(),
    urutan_tampil: urutanDokumen.optional(), urutan_lama: z.int32().optional(),
  }).refine(v => (v.status === undefined) === (v.status_lama === undefined) &&
    (v.urutan_tampil === undefined) === (v.urutan_lama === undefined)),
  z.strictObject({
    aksi: z.literal('urutan'), tetangga_id: z.uuid(), urutan_lama: z.int32(), urutan_tetangga: z.int32(),
  }),
]);

export async function PATCH(request: Request, context: RouteContext) {
  return layaniKelola(async (client, requestId) => {
    const { id } = await context.params;
    const parsed = permintaanMutasi.safeParse(await bacaJson(request));
    if (!z.uuid().safeParse(id).success || !parsed.success) return galat('INPUT_TIDAK_VALID', requestId);
    const input = parsed.data;
    if (input.aksi === 'urutan') {
      if (input.tetangga_id === id) return galat('INPUT_TIDAK_VALID', requestId);
      const { error } = await client.rpc('investasi_tukar_urutan_dokumen', {
        p_id: id, p_tetangga_id: input.tetangga_id,
        p_urutan_lama: input.urutan_lama, p_urutan_tetangga: input.urutan_tetangga,
      });
      if (error) return galatRpc(error, requestId);
    } else {
      const { aksi, status_lama, urutan_lama, ...perubahan } = input;
      let query = client.from('investment_documents').update(perubahan).eq('id', id);
      if (status_lama !== undefined) query = query.eq('status', status_lama);
      if (urutan_lama !== undefined) query = query.eq('urutan_tampil', urutan_lama);
      try {
        const baris = await mutasiBolehKosong(query.select('id').maybeSingle());
        if (!baris.length) {
          const adaPembanding = aksi === 'status' || status_lama !== undefined || urutan_lama !== undefined;
          return galat(adaPembanding ? 'KONFLIK_VERSI' : 'TIDAK_DITEMUKAN', requestId);
        }
      } catch (error) {
        return galatRpc(error instanceof MutasiError ? error.asal : error, requestId);
      }
    }
    invalidasiInvestasiPublik();
    return sukses({ id });
  });
}
