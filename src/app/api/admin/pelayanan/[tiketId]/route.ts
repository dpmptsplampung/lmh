import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import {
  formPendataanLayanan,
  canAccessPelayananStaff,
  bolehSelesaikanTiket,
  kodeGalatAntrean,
  MAX_CATATAN_LAYANAN,
  PESAN_GALAT_ANTREAN,
  type KodeGalatAntrean,
} from '@/lib/pelayanan';
import {
  ossPelayananDraftSchema,
  ossPelayananFinalSchema,
  perizinanPelayananDraftSchema,
  perizinanPelayananFinalSchema,
  PelayananInitialData,
} from '@/lib/types/pelayanan';

export const dynamic = 'force-dynamic';

// Respons gagal simpan draf. Kontrak lama: semua kegagalan simpan = 400 + pesan umum (pesan DB tidak bocor).
// Tambahan: 0 baris pada UPDATE (terkunci sejak dicek / ditolak RLS) = 409, penolakan database = 403.
function responsGagalDraf(e: MutasiError, pesanUmum: string) {
  if (e.kode === 'tidak_ada_baris') {
    return NextResponse.json(
      { error: 'Draf tidak tersimpan: data sudah terkunci, sudah tidak ada, atau Anda tidak berwenang mengubahnya' },
      { status: 409 },
    );
  }
  if (e.kode === 'ditolak') {
    return NextResponse.json({ error: 'Anda tidak berwenang menyimpan draf ini atau data sudah terkunci' }, { status: 403 });
  }
  return NextResponse.json({ error: pesanUmum }, { status: 400 });
}

// Status HTTP per kode galat RPC antrean (migrasi 202610140002 dan 202610140004). SESI_TIDAK_SAH = 401 (sesi tidak
// berlaku lagi, klien harus masuk ulang); pelanggaran kepemilikan/peran = 403; konflik status (kalah balapan) = 409;
// isian tidak valid (topik/catatan/alasan/layanan) = 422, sama seperti ALASAN_WAJIB / INVALID_FORM.
const STATUS_GALAT_ANTREAN: Record<KodeGalatAntrean, number> = {
  SESI_TIDAK_SAH: 401,
  BUKAN_PEMILIK: 403,
  FORBIDDEN: 403,
  LOCKED: 403,
  NOT_FOUND: 404,
  SUDAH_DIAMBIL: 409,
  INVALID_STATUS: 409,
  DIVERGENSI: 409,
  TRANSISI_LEWAT_RPC: 409,
  ALASAN_WAJIB: 422,
  INVALID_FORM: 422,
  INVALID_PAYLOAD: 422,
  TOPIK_WAJIB: 422,
  TOPIK_TIDAK_VALID: 422,
  CATATAN_WAJIB: 422,
  CATATAN_TERLALU_PANJANG: 422,
  LAYANAN_SAMA: 422,
  LAYANAN_TIDAK_VALID: 422,
  TIKET_LAMA: 409,
  // 202610140012: tiket bukan hari ini / layanan tujuan libur atau tutup (konflik keadaan, bukan isian salah).
  BUKAN_HARI_INI: 409,
  LAYANAN_TIDAK_BUKA: 409,
  LAYANAN_TUTUP: 409,
  // Fase 3: ambil alih Koordinator (tidak dipakai route ini, wajib ada agar peta lengkap).
  BUKAN_SATU_UNIT: 403,
  KANAL_CHAT: 409,
  // 202611010003: email pengunjung yang dieskalasi wajib nyata (isian salah, bukan konflik keadaan).
  EMAIL_WAJIB: 422,
};

function responsGalatAntrean(kode: KodeGalatAntrean, pesan?: string) {
  return NextResponse.json({ error: pesan ?? PESAN_GALAT_ANTREAN[kode], kode }, { status: STATUS_GALAT_ANTREAN[kode] });
}

type KlienRpc = Awaited<ReturnType<typeof createClient>>;

// Fase 3 (spec §6.2, migrasi 202610290001): pemegang lama yang pendataannya diambil alih Koordinator tetap boleh
// menyunting draf selama tiket masih 'dilayani'. Ditentukan DB (boleh_sunting_pendataan, juga dipakai RLS draf);
// sebelum migrasi diterapkan RPC belum ada -> false (perilaku lama: hanya pemilik).
async function bolehSuntingDraf(
  supabase: KlienRpc,
  staff: { id: string; role: string | null },
  tiket: { id: string; status?: string | null; dilayani_oleh?: string | null },
): Promise<boolean> {
  const status = tiket.status ?? '';
  if (bolehSelesaikanTiket(staff, { status, dilayani_oleh: tiket.dilayani_oleh })) return true;
  if (status !== 'dilayani' || (staff.role !== 'petugas' && staff.role !== 'admin')) return false;
  try {
    const { data, error } = await supabase.rpc('boleh_sunting_pendataan', { p_tiket_id: tiket.id });
    return !error && data === true;
  } catch {
    return false;
  }
}

// Draf hanya boleh ditulis pemilik tiket yang sedang 'dilayani' (keputusan CEO 7.5; RLS menegakkan hal yang sama di
// DB) atau pemegang lama yang diambil alih Koordinator. Admin yang perlu mengisi draf tiket orang lain harus
// "Ambil alih" dulu.
async function tolakDrafBukanPemilik(
  supabase: KlienRpc,
  staff: { id: string; role: string | null },
  tiket: { id: string; status?: string | null; dilayani_oleh?: string | null },
) {
  const status = tiket.status ?? '';
  if (await bolehSuntingDraf(supabase, staff, tiket)) return null;
  if (status !== 'dilayani') {
    return responsGalatAntrean(
      'INVALID_STATUS',
      'Draf hanya dapat disimpan saat tiket sedang dilayani. Mulai layanan terlebih dahulu.',
    );
  }
  return responsGalatAntrean('BUKAN_PEMILIK');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tiketId: string }> }
) {
  try {
    const { tiketId } = await params;
    const supabase = await createClient();

    // 1. Otorisasi Staf
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: staff } = await supabase
      .from('petugas')
      .select('id, role, layanan_id, aktif')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!staff || staff.aktif === false) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Ambil Tiket, Layanan, dan Kunjungan (visit = arsip baca-saja sejak WP-24; tidak dibaca lagi)
    const { data: tiket, error: tiketErr } = await supabase
      .from('tiket_antrean')
      .select(`
        id, legacy_visit_id, nomor_display, status, layanan_id, dilayani_oleh, penanganan_asal_id,
        layanan:layanan_id(id, nama, form_pendataan),
        pelayan:dilayani_oleh(nama),
        kunjungan:kunjungan_id(id, nama, kontak_hp, pengunjung_id, asal_instansi, email, keperluan)
      `)
      .eq('id', tiketId)
      .maybeSingle();

    if (tiketErr || !tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    // 1b. Otorisasi: petugas hanya boleh akses tiket pada layanannya sendiri
    if (!canAccessPelayananStaff(staff, tiket.layanan_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const kunjunganData = Array.isArray(tiket.kunjungan) ? tiket.kunjungan[0] : tiket.kunjungan;
    const pelayanData = Array.isArray(tiket.pelayan) ? tiket.pelayan[0] : tiket.pelayan;
    const layananNama = layananData?.nama || '';
    // Jenis form = layanan.form_pendataan (sumber kebenaran DB, migrasi 202610140012).
    const formType = formPendataanLayanan(layananData);

    if (!formType) {
      return NextResponse.json(
        { error: 'Layanan ini tidak mendukung form pendataan teknis' },
        { status: 400 }
      );
    }

    // 3. Data registrasi tambahan: kolom kunjungan (walk-in FO / reservasi), lalu profil pengunjung bila ada.
    let asalInstansi: string | null = kunjunganData?.asal_instansi ?? null;
    let email: string | null = kunjunganData?.email ?? null;
    const keperluan: string | null = kunjunganData?.keperluan ?? null;

    const pengunjungId = kunjunganData?.pengunjung_id;
    if (pengunjungId) {
      const { data: p } = await supabase
        .from('pengunjung')
        .select('email, asal_instansi')
        .eq('id', pengunjungId)
        .maybeSingle();
      if (p) {
        if (!email) email = p.email;
        if (!asalInstansi) asalInstansi = p.asal_instansi;
      }
    }

    // 4. Ambil eksisting data pendataan jika sudah ada
    let isLocked = false;
    let statusDraft: 'draft' | 'selesai' | 'belum_diisi' = 'belum_diisi';
    let dataOss = null;
    let dataPerizinan = null;

    if (formType === 'oss') {
      const { data: oss } = await supabase
        .from('pelayanan_oss')
        .select('*')
        .eq('tiket_id', tiketId)
        .maybeSingle();
      if (oss) {
        isLocked = oss.is_locked;
        statusDraft = oss.status_draft as 'draft' | 'selesai';
        dataOss = oss;
      }
    } else {
      const { data: pz } = await supabase
        .from('pelayanan_perizinan')
        .select('*')
        .eq('tiket_id', tiketId)
        .maybeSingle();
      if (pz) {
        isLocked = pz.is_locked;
        statusDraft = pz.status_draft as 'draft' | 'selesai';
        dataPerizinan = pz;
      }
    }

    // Tiket hasil eskalasi FO (informasi saja): sejak 202610140015 petugas tidak lagi memilih topik / menulis catatan
    // penanganan; DB menurunkan catatan tahap layanan dari Pendataan (topik NULL).
    const dariEskalasi = !!tiket.penanganan_asal_id;

    const responsePayload: PelayananInitialData = {
      tiket_id: tiket.id,
      legacy_visit_id: tiket.legacy_visit_id,
      nomor_display: tiket.nomor_display,
      layanan_id: tiket.layanan_id,
      layanan_nama: layananNama,
      form_type: formType,
      nama_pemohon: kunjunganData?.nama || '',
      alamat_pemohon: asalInstansi,
      no_hp: kunjunganData?.kontak_hp || null,
      email: email,
      keperluan_awal: keperluan,
      status_tiket: tiket.status,
      dilayani_oleh: tiket.dilayani_oleh ?? null,
      dilayani_oleh_nama: pelayanData?.nama ?? null,
      boleh_ubah: !isLocked && (await bolehSuntingDraf(supabase, staff, tiket)),
      // Menyelesaikan tetap hanya pemilik tiket (layanan_selesai); pemegang lama setelah ambil alih hanya menyunting draf.
      boleh_selesaikan: !isLocked && bolehSelesaikanTiket(staff, { status: tiket.status, dilayani_oleh: tiket.dilayani_oleh }),
      dari_eskalasi: dariEskalasi,
      is_locked: isLocked,
      status_draft: statusDraft,
      data_oss: dataOss,
      data_perizinan: dataPerizinan,
    };

    return NextResponse.json(responsePayload);
  } catch (err) {
    console.error('[GET /api/admin/pelayanan]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tiketId: string }> }
) {
  try {
    const { tiketId } = await params;
    const supabase = await createClient();

    // 1. Otorisasi
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: staff } = await supabase
      .from('petugas')
      .select('id, role, layanan_id, aktif')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!staff || staff.aktif === false) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Ambil Tiket
    const { data: tiket } = await supabase
      .from('tiket_antrean')
      .select('id, kunjungan_id, layanan_id, status, dilayani_oleh, layanan:layanan_id(nama, form_pendataan)')
      .eq('id', tiketId)
      .maybeSingle();

    if (!tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    if (!canAccessPelayananStaff(staff, tiket.layanan_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = formPendataanLayanan(layananData);

    if (!formType) {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const tolak = await tolakDrafBukanPemilik(supabase, staff, tiket);
    if (tolak) return tolak;

    const body = await request.json();

    if (formType === 'oss') {
      const { data: existing } = await supabase
        .from('pelayanan_oss')
        .select('tiket_id, is_locked')
        .eq('tiket_id', tiketId)
        .maybeSingle();

      if (existing?.is_locked) {
        return NextResponse.json({ error: 'Data pelayanan sudah terkunci dan tidak dapat diubah' }, { status: 403 });
      }

      const parsed = ossPelayananDraftSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid draft data', details: parsed.error.format() }, { status: 400 });
      }

      const baseData = {
        ...parsed.data,
        status_draft: 'draft',
        is_locked: false,
        updated_at: new Date().toISOString(),
      };

      // Baris eksisting → update tanpa mengubah petugas_id (kepemilikan tetap
      // milik petugas asli meski admin ikut menyunting). Baris baru → insert
      // dengan petugas_id = penyimpan pertama.
      try {
        if (existing) {
          // 0 baris (terkunci sejak dicek / ditolak RLS) = draf TIDAK tersimpan -> wajib ada baris terdampak.
          await mutasiWajibBaris(
            supabase.from('pelayanan_oss').update(baseData).eq('tiket_id', tiketId).select('tiket_id'),
          );
        } else {
          await mutasiInsert(
            supabase.from('pelayanan_oss').insert({
              tiket_id: tiket.id,
              kunjungan_id: tiket.kunjungan_id,
              petugas_id: staff.id,
              ...baseData,
            }),
          );
        }
      } catch (e) {
        if (!(e instanceof MutasiError)) throw e;
        catatMutasiGagal('/api/admin/pelayanan/[tiketId]', 'admin.pelayanan.draf_oss', e, { tiketId });
        return responsGagalDraf(e, 'Gagal menyimpan draft OSS');
      }

      return NextResponse.json({ ok: true, message: 'Draft OSS tersimpan' });
    } else {
      const { data: existing } = await supabase
        .from('pelayanan_perizinan')
        .select('tiket_id, is_locked')
        .eq('tiket_id', tiketId)
        .maybeSingle();

      if (existing?.is_locked) {
        return NextResponse.json({ error: 'Data pelayanan sudah terkunci dan tidak dapat diubah' }, { status: 403 });
      }

      const parsed = perizinanPelayananDraftSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid draft data', details: parsed.error.format() }, { status: 400 });
      }

      const baseData = {
        ...parsed.data,
        status_draft: 'draft',
        is_locked: false,
        updated_at: new Date().toISOString(),
      };

      // Baris eksisting → update tanpa mengubah petugas_id; baru → insert.
      try {
        if (existing) {
          await mutasiWajibBaris(
            supabase.from('pelayanan_perizinan').update(baseData).eq('tiket_id', tiketId).select('tiket_id'),
          );
        } else {
          await mutasiInsert(
            supabase.from('pelayanan_perizinan').insert({
              tiket_id: tiket.id,
              kunjungan_id: tiket.kunjungan_id,
              petugas_id: staff.id,
              ...baseData,
            }),
          );
        }
      } catch (e) {
        if (!(e instanceof MutasiError)) throw e;
        catatMutasiGagal('/api/admin/pelayanan/[tiketId]', 'admin.pelayanan.draf_perizinan', e, { tiketId });
        return responsGagalDraf(e, 'Gagal menyimpan draft Perizinan');
      }

      return NextResponse.json({ ok: true, message: 'Draft Perizinan tersimpan' });
    }
  } catch (err) {
    console.error('[PATCH /api/admin/pelayanan]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tiketId: string }> }
) {
  try {
    const { tiketId } = await params;
    const supabase = await createClient();

    // 1. Otorisasi
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: staff } = await supabase
      .from('petugas')
      .select('id, role, layanan_id, aktif')
      .eq('auth_user_id', user.id)
      .maybeSingle();

    if (!staff || staff.aktif === false) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 2. Ambil Tiket
    const { data: tiket } = await supabase
      .from('tiket_antrean')
      .select('id, legacy_visit_id, kunjungan_id, layanan_id, layanan:layanan_id(nama, form_pendataan)')
      .eq('id', tiketId)
      .maybeSingle();

    if (!tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    if (!canAccessPelayananStaff(staff, tiket.layanan_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = formPendataanLayanan(layananData);

    if (!formType) {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const body = await request.json();

    // Topik + catatan penanganan: wizard sejak 202610140015 tidak mengirimnya (DB menurunkan catatan dari Pendataan);
    // tetap diterima dari klien lama (opsional, divalidasi DB bila ada), terpisah dari isi form pendataan.
    const bodyObj = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    const { topik_id: topikRaw, catatan_penanganan: catatanRaw, ...isiForm } = bodyObj;

    // Validasi ketat field wajib di server sebelum finalize
    let finalData: Record<string, unknown>;
    if (formType === 'oss') {
      // Validasi ketat OSS: SEMUA field wajib non-kosong (keputusan CEO G.5; server DB 202610140011 menegakkan hal sama)
      const parsed = ossPelayananFinalSchema.safeParse(isiForm);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Lengkapi SEMUA field pendataan sebelum menyelesaikan layanan (isi "Belum ada" / "Tidak berlaku" bila tidak ada, atau "-" untuk catatan)',
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 422 }
        );
      }
      finalData = parsed.data;
    } else {
      // Validasi ketat Perizinan: SEMUA field wajib non-kosong (keputusan CEO G.5)
      const parsed = perizinanPelayananFinalSchema.safeParse(isiForm);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Lengkapi SEMUA field pendataan sebelum menyelesaikan perizinan (isi "Belum ada" / "Tidak berlaku" bila tidak ada, atau "-" untuk catatan)',
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 422 }
        );
      }
      finalData = parsed.data;
    }

    // Topik + catatan (opsional): bentuknya dicek di sini (uuid / panjang); DB memvalidasi isinya bila dikirim.
    let topikId: string | null = null;
    if (topikRaw !== undefined && topikRaw !== null && topikRaw !== '') {
      if (typeof topikRaw !== 'string' || !z.uuid().safeParse(topikRaw).success) {
        return responsGalatAntrean('TOPIK_TIDAK_VALID');
      }
      topikId = topikRaw;
    }
    let catatan: string | null = null;
    if (catatanRaw !== undefined && catatanRaw !== null) {
      if (typeof catatanRaw !== 'string') return responsGalatAntrean('CATATAN_WAJIB');
      const bersih = catatanRaw.trim();
      if (bersih.length > MAX_CATATAN_LAYANAN) return responsGalatAntrean('CATATAN_TERLALU_PANJANG');
      catatan = bersih === '' ? null : bersih;
    }

    // Selesaikan atomik via RPC layanan_selesai (migrasi 202610140002; 5 parameter sejak 202610140004): hanya pemilik
    // tiket (dilayani_oleh = pemanggil) dengan sesi sah; upsert data + kunci + selesaikan tiket/penanganan
    // dalam SATU transaksi DB.
    const { data: rpcData, error: rpcErr } = await supabase.rpc('layanan_selesai', {
      p_tiket_id: tiketId,
      p_form_type: formType,
      p_payload: finalData,
      p_topik_id: topikId,
      p_catatan: catatan,
    });

    if (rpcErr) {
      const msg = rpcErr.message || '';
      const kode = kodeGalatAntrean(msg);
      if (kode === 'INVALID_STATUS') {
        return responsGalatAntrean(kode, 'Tiket tidak sedang dilayani sehingga tidak dapat diselesaikan');
      }
      if (kode) {
        if (kode === 'DIVERGENSI') console.error('[POST layanan_selesai]', msg);
        return responsGalatAntrean(kode);
      }
      console.error('[POST layanan_selesai]', msg);
      return NextResponse.json({ error: 'Gagal menyelesaikan pelayanan' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: 'Pelayanan berhasil diselesaikan dan data telah dikunci',
      is_locked: true,
      waktu_selesai: (rpcData as { waktu_selesai?: string } | null)?.waktu_selesai ?? null,
    });
  } catch (err) {
    console.error('[POST /api/admin/pelayanan/finalize]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Koreksi data pelayanan yang sudah terkunci (Admin/FO). Alasan wajib; nilai lama -> baru masuk audit_log
// lewat RPC koreksi_pelayanan (migrasi 202610090001). Petugas tidak berwenang (403).
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tiketId: string }> }
) {
  try {
    const { tiketId } = await params;
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: staff } = await supabase
      .from('petugas')
      .select('id, role, layanan_id, aktif')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    if (!staff || staff.aktif === false || (staff.role !== 'admin' && staff.role !== 'front_office')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { data: tiket } = await supabase
      .from('tiket_antrean')
      .select('id, layanan:layanan_id(nama, form_pendataan)')
      .eq('id', tiketId)
      .maybeSingle();
    if (!tiket) return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = formPendataanLayanan(layananData);
    if (!formType) return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });

    let body: { perubahan?: unknown; alasan?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    if (typeof body.alasan !== 'string' || !body.perubahan || typeof body.perubahan !== 'object') {
      return NextResponse.json({ error: 'perubahan dan alasan wajib diisi' }, { status: 422 });
    }

    const { data, error } = await supabase.rpc('koreksi_pelayanan', {
      p_tiket_id: tiketId,
      p_form_type: formType,
      p_perubahan: body.perubahan,
      p_alasan: body.alasan,
    });
    if (error) {
      const msg = error.message || '';
      if (msg.includes('FORBIDDEN')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      if (msg.includes('NOT_FOUND')) return NextResponse.json({ error: 'Data pelayanan tidak ditemukan' }, { status: 404 });
      if (msg.includes('BELUM_TERKUNCI')) {
        return NextResponse.json({ error: 'Data masih draf; ubah lewat simpan draf' }, { status: 409 });
      }
      if (/ALASAN_WAJIB|TIDAK_ADA_PERUBAHAN|FIELD_TIDAK_VALID|INVALID_FORM/.test(msg)) {
        return NextResponse.json({ error: msg.replace(/^[A-Z_]+:\s*/, '') }, { status: 422 });
      }
      console.error('[PUT koreksi_pelayanan]', msg);
      return NextResponse.json({ error: 'Gagal menyimpan koreksi' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, perubahan: data?.perubahan ?? {} });
  } catch (err) {
    console.error('[PUT /api/admin/pelayanan]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
