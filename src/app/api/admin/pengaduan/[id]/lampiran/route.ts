import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerEvent } from '@/lib/observability/logger';
import { kunciObjek } from '@/lib/storage/area';
import { presignGet, r2Tersedia } from '@/lib/storage/r2';
import { jawabGalatRpc, UUID } from '../../_aksi';

export const dynamic = 'force-dynamic';
const ROUTE = '/api/admin/pengaduan/[id]/lampiran';
const TTL_DETIK = 60;
const AREA = 'pengaduan-bukti';

// UI-04: membuka bukti pelapor (tanpa query) atau lampiran tanggapan (?lampiran_id=<uuid>) dari panel rincian.
// Mengembalikan {url} = URL GET R2 bucket PRIVAT bertanda tangan 60 detik; tidak pernah URL bucket publik.
// Otorisasi selaras RPC pengaduan: Admin/Front Office aktif dengan sesi_valid() = true, baris dibaca dengan JWT pengguna (RLS),
// dan Front Office ditolak untuk jalur integritas.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  const lampiranId = request.nextUrl.searchParams.get('lampiran_id');
  if (lampiranId !== null && !UUID.test(lampiranId)) {
    return NextResponse.json({ error: 'Parameter lampiran_id tidak valid' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { data: me } = await supabase.from('petugas').select('role, aktif').eq('auth_user_id', user.id).maybeSingle();
  if (!me || me.aktif === false || (me.role !== 'admin' && me.role !== 'front_office')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  // JWT Supabase bisa masih hidup setelah sesi staf digantikan login baru / idle. RLS tabel tidak memeriksa sesi,
  // jadi gerbang ada di sini (pola linimasa_pengaduan): hanya `true` yang lanjut; false = 401, galat = 403 (gagal-tertutup).
  const sesi = await supabase.rpc('sesi_valid').then((r) => r, (e: unknown) => ({ data: null, error: e }));
  if (sesi.error) {
    logServerEvent('error', { operation: 'admin.pengaduan.lampiran.sesi', route: ROUTE, error: sesi.error });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (sesi.data !== true) {
    return NextResponse.json({ error: 'Sesi Anda tidak berlaku lagi; silakan masuk kembali', kode: 'SESI_TIDAK_SAH' }, { status: 401 });
  }

  const { data: pengaduan, error } = await supabase
    .from('pengaduan')
    .select('id, jalur, lampiran_path')
    .eq('id', id)
    .maybeSingle();
  if (error) return jawabGalatRpc(error, 'admin.pengaduan.lampiran.baca', ROUTE);
  if (!pengaduan) return NextResponse.json({ error: 'Tidak ditemukan' }, { status: 404 });
  if (pengaduan.jalur !== 'layanan' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let kunci: string | null = null;
  if (lampiranId === null) {
    kunci = kunciBuktiPelapor(pengaduan.lampiran_path);
  } else {
    const { data: lampiran, error: galatLampiran } = await supabase
      .from('pengaduan_lampiran')
      .select('id, kunci, pengaduan_tanggapan!inner(pengaduan_id)')
      .eq('id', lampiranId)
      .eq('pengaduan_tanggapan.pengaduan_id', id)
      .maybeSingle();
    if (galatLampiran) return jawabGalatRpc(galatLampiran, 'admin.pengaduan.lampiran.baca', ROUTE);
    // Pertahanan berlapis: kunci harus milik pengaduan ini (pola sama dengan tanggapi_pengaduan).
    const pola = new RegExp(`^${AREA}/${id}/[0-9a-f-]{36}\\.(jpg|png|webp|pdf)$`);
    kunci = lampiran && typeof lampiran.kunci === 'string' && pola.test(lampiran.kunci) ? lampiran.kunci : null;
  }
  if (!kunci) return NextResponse.json({ error: 'Lampiran tidak ditemukan' }, { status: 404 });

  if (!r2Tersedia()) return NextResponse.json({ error: 'Penyimpanan berkas belum dikonfigurasi' }, { status: 503 });
  try {
    const url = await presignGet('private', kunci, TTL_DETIK);
    return NextResponse.json({ url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    logServerEvent('error', { operation: 'admin.pengaduan.lampiran.tandatangan', route: ROUTE, error: e });
    return NextResponse.json({ error: 'Gagal membuka lampiran' }, { status: 500 });
  }
}

/** `lampiran_path` lama = path di bucket pengaduan-bukti (disalin ke R2 sebagai `pengaduan-bukti/<path>`); null bila kosong/tidak sah. */
function kunciBuktiPelapor(path: unknown): string | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  const relatif = path.startsWith(`${AREA}/`) ? path.slice(AREA.length + 1) : path;
  try {
    return kunciObjek(AREA, relatif);
  } catch {
    return null;
  }
}
