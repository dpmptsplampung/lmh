import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { paramsDariRequest } from '@/lib/rekap/akses';
import { labelLingkup, lingkupLuas } from '@/lib/akses-data/lingkup';
import {
  petaBarisHarian,
  petaBarisKinerja,
  petaBarisPelayanan,
  petaRingkasanHarian,
  rekapTerpaduQuerySchema,
  type UnitRekap,
} from '@/lib/rekap/terpadu';
import { argData, argRekap, formLayanan, muatLingkup, responsGalatRekap } from '@/lib/rekap/terpaduServer';
import { lampirkanKhusus } from '@/lib/rekap/khusus';
import type { FieldKhusus } from '@/lib/pendataan-khusus/jenis';
import { muatFieldKhusus, muatJawabanKhusus } from '@/lib/rekap/khususServer';
import { muatRingkasanDilayani } from '@/lib/rekap/ringkasan';
import { buatPengukur } from '@/lib/observability/durasi';

export const dynamic = 'force-dynamic';

const LABEL = 'api/admin/rekap/terpadu';

// Rekap terpadu (Fase 3, spec §6.3): bagian=lingkup | harian | data | kinerja. Semua angka dan baris berasal dari RPC
// SECURITY DEFINER migrasi 202610290002 yang menegakkan lingkup §6.1 sendiri; filter unit/layanan diteruskan ke DB dan
// hanya mempersempit. Harian/Kinerja = agregat SQL dalam satu nilai jsonb (tidak terkena batas baris PostgREST);
// Data = satu halaman + total dari DB. Klien pengguna (bukan service-role).
export async function GET(request: NextRequest) {
  const pengukur = buatPengukur();
  const sukses = (body: unknown) =>
    NextResponse.json(body, { headers: { 'Server-Timing': pengukur.header() } });
  const supabase = await createClient();
  const parsed = rekapTerpaduQuerySchema.safeParse(paramsDariRequest(request));
  if (!parsed.success) {
    // Sesi diperiksa lebih dulu agar pengguna anonim tidak mendapat detail validasi.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }
  const q = parsed.data;
  const staf = await pengukur.ukur('lingkup', () => muatLingkup(supabase, LABEL));
  if (!staf.ok) return staf.res;
  const { lingkup } = staf;

  if (q.bagian === 'lingkup') {
    // Admin dan Koordinator FO memilih dari semua Layanan; petugas hanya Layanannya; FO biasa hanya unit Front Office.
    const semua = lingkup.role === 'admin' || (lingkup.role === 'front_office' && lingkupLuas(lingkup));
    let opsi: { id: string; nama: string; form_pendataan: string | null }[] = [];
    if (semua || (lingkup.role === 'petugas' && lingkup.layanan_id)) {
      let kueri = supabase.from('layanan').select('id, nama, form_pendataan').order('nama');
      if (!semua && lingkup.layanan_id) kueri = kueri.eq('id', lingkup.layanan_id);
      const { data, error } = await pengukur.ukur('opsi_layanan', async () => await kueri);
      if (!error) opsi = (data ?? []) as typeof opsi;
    }
    const unit_opsi: UnitRekap[] = semua ? ['fo', 'layanan'] : lingkup.role === 'front_office' ? ['fo'] : ['layanan'];
    return sukses({ lingkup, label: labelLingkup(lingkup), opsi_layanan: opsi, unit_opsi });
  }

  const arg = argRekap(q);
  const hemat = q.bagian === 'data' && q.hemat === '1';
  // Ringkasan dan RPC bagian berjalan bersamaan; lingkup sudah lolos di atas. Hemat = lewati ringkasan (klien memegang nilainya).
  const ringkasanJanji = hemat
    ? Promise.resolve(null)
    : pengukur.ukur('ringkasan', () => muatRingkasanDilayani(supabase, q.bagian === 'data' ? argData(q) : arg));
  ringkasanJanji.catch(() => {}); // galat dilaporkan lewat await di bawah; cegah unhandled rejection bila RPC bagian gagal lebih dulu
  const ambilRingkasan = async () => {
    try {
      return { dilayani: await ringkasanJanji };
    } catch (error) {
      return { res: responsGalatRekap(error, LABEL) };
    }
  };
  const daftar = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);
  if (q.bagian === 'harian') {
    const [{ data, error }, rk] = await Promise.all([
      pengukur.ukur('rpc_harian', async () => await supabase.rpc('rekap_harian_terpadu', arg)),
      ambilRingkasan(),
    ]);
    if (rk.res) return rk.res;
    const dilayani = rk.dilayani;
    if (error) return responsGalatRekap(error, LABEL);
    const b = (data ?? {}) as { rows?: unknown; ringkasan?: unknown };
    return sukses({ rows: daftar(b.rows).map(petaBarisHarian), ringkasan: petaRingkasanHarian(b.ringkasan), dilayani });
  }

  if (q.bagian === 'kinerja') {
    const [{ data, error }, rk] = await Promise.all([
      pengukur.ukur('rpc_kinerja', async () => await supabase.rpc('rekap_kinerja_petugas', arg)),
      ambilRingkasan(),
    ]);
    if (rk.res) return rk.res;
    const dilayani = rk.dilayani;
    if (error) return responsGalatRekap(error, LABEL);
    return sukses({ rows: daftar((data as { rows?: unknown } | null)?.rows).map(petaBarisKinerja), dilayani });
  }

  // bagian === 'data': satu halaman (detail hanya untuk halaman ini) + total dari DB.
  const [{ data, error }, rk] = await Promise.all([
    pengukur.ukur('rpc_data', async () => await supabase.rpc('rekap_data_pelayanan', {
      ...argData(q), p_batas: q.page_size, p_lewati: q.page * q.page_size, p_setelah: null, p_hitung: !hemat,
    })),
    ambilRingkasan(),
  ]);
  if (rk.res) return rk.res;
  const dilayani = rk.dilayani;
  if (error) return responsGalatRekap(error, LABEL);
  const b = (data ?? {}) as { total?: unknown; rows?: unknown };
  let rows = daftar(b.rows).map(petaBarisPelayanan);
  // Fase 4: kolom Pendataan Khusus hanya bila satu Layanan dipilih. Jawaban dibaca lewat klien pengguna (RLS = lingkup
  // ketat) hanya untuk pelayanan yang sudah lolos RPC di atas.
  let kolom_khusus: FieldKhusus[] = [];
  try {
    kolom_khusus = await pengukur.ukur('field_khusus', () => muatFieldKhusus(supabase, q.layanan_id));
    if (kolom_khusus.length > 0) {
      const jawaban = await pengukur.ukur('jawaban_khusus', () => muatJawabanKhusus(supabase, rows.filter((r) => r.sumber === 'penanganan').map((r) => r.pelayanan_id)));
      rows = lampirkanKhusus(rows, jawaban);
    }
  } catch (e) {
    return responsGalatRekap(e, LABEL);
  }
  const form_type = await pengukur.ukur('form_layanan', () => formLayanan(supabase, q.layanan_id));
  return sukses({
    dilayani,
    total: hemat ? null : Number(b.total ?? 0) || 0,
    ...(hemat ? { ringkasan: null } : {}),
    form_type,
    kolom_khusus,
    rows,
  });
}
