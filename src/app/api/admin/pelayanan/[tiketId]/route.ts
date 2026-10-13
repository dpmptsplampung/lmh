import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MutasiError, mutasiInsert, mutasiWajibBaris } from '@/lib/supabase/mutate';
import { catatMutasiGagal } from '@/app/api/admin/_mutasi';
import {
  determineFormType,
  canAccessPelayananStaff,
  bolehSelesaikanTiket,
  kodeGalatAntrean,
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

// Status HTTP per kode galat RPC antrean (migrasi 202610140002). SESI_TIDAK_SAH = 401 (sesi tidak berlaku lagi,
// klien harus masuk ulang); pelanggaran kepemilikan/peran = 403; konflik status (kalah balapan) = 409.
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
};

function responsGalatAntrean(kode: KodeGalatAntrean, pesan?: string) {
  return NextResponse.json({ error: pesan ?? PESAN_GALAT_ANTREAN[kode], kode }, { status: STATUS_GALAT_ANTREAN[kode] });
}

// Draf hanya boleh ditulis pemilik tiket yang sedang 'dilayani' (keputusan CEO 7.5; RLS pemilik_tiket menegakkan
// hal yang sama di DB). Admin yang perlu mengisi draf tiket orang lain harus "Ambil alih" dulu.
function tolakDrafBukanPemilik(
  staff: { id: string; role: string | null },
  tiket: { status?: string | null; dilayani_oleh?: string | null },
) {
  const status = tiket.status ?? '';
  if (bolehSelesaikanTiket(staff, { status, dilayani_oleh: tiket.dilayani_oleh })) return null;
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

    // 2. Ambil Tiket, Layanan, Kunjungan, dan Visit
    const { data: tiket, error: tiketErr } = await supabase
      .from('tiket_antrean')
      .select(`
        id, legacy_visit_id, nomor_display, status, layanan_id, dilayani_oleh,
        layanan:layanan_id(id, nama),
        pelayan:dilayani_oleh(nama),
        kunjungan:kunjungan_id(id, nama, kontak_hp, pengunjung_id)
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
    const formType = determineFormType(layananNama);

    if (!formType) {
      return NextResponse.json(
        { error: 'Layanan ini tidak mendukung form pendataan teknis' },
        { status: 400 }
      );
    }

    // 3. Ambil data registrasi tambahan dari visit / pengunjung bila ada
    let asalInstansi: string | null = null;
    let email: string | null = null;
    let keperluan: string | null = null;

    if (tiket.legacy_visit_id) {
      const { data: v } = await supabase
        .from('visit')
        .select('asal_instansi, keperluan, pengunjung_id')
        .eq('id', tiket.legacy_visit_id)
        .maybeSingle();
      if (v) {
        asalInstansi = v.asal_instansi;
        keperluan = v.keperluan;
      }
    }

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
      boleh_ubah: !isLocked && bolehSelesaikanTiket(staff, { status: tiket.status, dilayani_oleh: tiket.dilayani_oleh }),
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
      .select('id, kunjungan_id, layanan_id, status, dilayani_oleh, layanan:layanan_id(nama)')
      .eq('id', tiketId)
      .maybeSingle();

    if (!tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    if (!canAccessPelayananStaff(staff, tiket.layanan_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = determineFormType(layananData?.nama || '');

    if (!formType) {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const tolak = tolakDrafBukanPemilik(staff, tiket);
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
      .select('id, legacy_visit_id, kunjungan_id, layanan_id, layanan:layanan_id(nama)')
      .eq('id', tiketId)
      .maybeSingle();

    if (!tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    if (!canAccessPelayananStaff(staff, tiket.layanan_id)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = determineFormType(layananData?.nama || '');

    if (!formType) {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const body = await request.json();

    // Validasi ketat field wajib di server sebelum finalize
    let finalData: Record<string, unknown>;
    if (formType === 'oss') {
      // Validasi ketat field wajib OSS: nama_pemohon, nama_usaha, uraian_solusi, tindak_lanjut
      const parsed = ossPelayananFinalSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Lengkapi semua field wajib sebelum menyelesaikan layanan (nama usaha, uraian, tindak lanjut)',
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 422 }
        );
      }
      finalData = parsed.data;
    } else {
      // Validasi ketat field wajib Perizinan: nama_pemohon, nama_perusahaan, opd_teknis, uraian_permohonan, tindak_lanjut
      const parsed = perizinanPelayananFinalSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          {
            error: 'Lengkapi semua field wajib sebelum menyelesaikan perizinan (nama perusahaan, OPD teknis, uraian permohonan, tindak lanjut)',
            details: parsed.error.flatten().fieldErrors,
          },
          { status: 422 }
        );
      }
      finalData = parsed.data;
    }

    // Selesaikan atomik via RPC layanan_selesai (migrasi 202610140002): hanya pemilik tiket (dilayani_oleh =
    // pemanggil) dengan sesi sah; upsert data + kunci + selesaikan tiket/visit dalam SATU transaksi DB.
    const { data: rpcData, error: rpcErr } = await supabase.rpc('layanan_selesai', {
      p_tiket_id: tiketId,
      p_form_type: formType,
      p_payload: finalData,
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
      .select('id, layanan:layanan_id(nama)')
      .eq('id', tiketId)
      .maybeSingle();
    if (!tiket) return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = determineFormType(layananData?.nama || '');
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
