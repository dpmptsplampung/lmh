import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  ossPelayananDraftSchema,
  ossPelayananFinalSchema,
  perizinanPelayananDraftSchema,
  perizinanPelayananFinalSchema,
  FormPelayananType,
  PelayananInitialData,
} from '@/lib/types/pelayanan';

export const dynamic = 'force-dynamic';

function determineFormType(layananNama: string): FormPelayananType | null {
  const norm = layananNama.toLowerCase();
  if (norm.includes('oss')) return 'oss';
  if (norm.includes('perizinan')) return 'perizinan';
  return null;
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
        id, legacy_visit_id, nomor_display, status, layanan_id,
        layanan:layanan_id(id, nama),
        kunjungan:kunjungan_id(id, nama, kontak_hp, pengunjung_id)
      `)
      .eq('id', tiketId)
      .maybeSingle();

    if (tiketErr || !tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const kunjunganData = Array.isArray(tiket.kunjungan) ? tiket.kunjungan[0] : tiket.kunjungan;
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
      .select('id, kunjungan_id, layanan:layanan_id(nama)')
      .eq('id', tiketId)
      .maybeSingle();

    if (!tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = determineFormType(layananData?.nama || '');

    if (!formType) {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const body = await request.json();

    if (formType === 'oss') {
      const { data: existing } = await supabase
        .from('pelayanan_oss')
        .select('is_locked')
        .eq('tiket_id', tiketId)
        .maybeSingle();

      if (existing?.is_locked && staff.role !== 'admin') {
        return NextResponse.json({ error: 'Data pelayanan sudah terkunci dan tidak dapat diubah' }, { status: 403 });
      }

      const parsed = ossPelayananDraftSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid draft data', details: parsed.error.format() }, { status: 400 });
      }

      const payload = {
        tiket_id: tiket.id,
        kunjungan_id: tiket.kunjungan_id,
        petugas_id: staff.id,
        ...parsed.data,
        status_draft: 'draft',
        is_locked: false,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from('pelayanan_oss')
        .upsert(payload, { onConflict: 'tiket_id' });

      if (upsertErr) {
        console.error('[PATCH pelayanan_oss]', upsertErr);
        return NextResponse.json({ error: upsertErr.message }, { status: 400 });
      }

      return NextResponse.json({ ok: true, message: 'Draft OSS tersimpan' });
    } else {
      const { data: existing } = await supabase
        .from('pelayanan_perizinan')
        .select('is_locked')
        .eq('tiket_id', tiketId)
        .maybeSingle();

      if (existing?.is_locked && staff.role !== 'admin') {
        return NextResponse.json({ error: 'Data pelayanan sudah terkunci dan tidak dapat diubah' }, { status: 403 });
      }

      const parsed = perizinanPelayananDraftSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json({ error: 'Invalid draft data', details: parsed.error.format() }, { status: 400 });
      }

      const payload = {
        tiket_id: tiket.id,
        kunjungan_id: tiket.kunjungan_id,
        petugas_id: staff.id,
        ...parsed.data,
        status_draft: 'draft',
        is_locked: false,
        updated_at: new Date().toISOString(),
      };

      const { error: upsertErr } = await supabase
        .from('pelayanan_perizinan')
        .upsert(payload, { onConflict: 'tiket_id' });

      if (upsertErr) {
        console.error('[PATCH pelayanan_perizinan]', upsertErr);
        return NextResponse.json({ error: upsertErr.message }, { status: 400 });
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
      .select('id, legacy_visit_id, kunjungan_id, layanan:layanan_id(nama)')
      .eq('id', tiketId)
      .maybeSingle();

    if (!tiket) {
      return NextResponse.json({ error: 'Tiket tidak ditemukan' }, { status: 404 });
    }

    const layananData = Array.isArray(tiket.layanan) ? tiket.layanan[0] : tiket.layanan;
    const formType = determineFormType(layananData?.nama || '');

    if (!formType) {
      return NextResponse.json({ error: 'Layanan tidak valid' }, { status: 400 });
    }

    const body = await request.json();
    const nowIso = new Date().toISOString();

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

      const payload = {
        tiket_id: tiket.id,
        kunjungan_id: tiket.kunjungan_id,
        petugas_id: staff.id,
        ...parsed.data,
        status_draft: 'selesai',
        is_locked: true,
        updated_at: nowIso,
      };

      const { error: upsertErr } = await supabase
        .from('pelayanan_oss')
        .upsert(payload, { onConflict: 'tiket_id' });

      if (upsertErr) {
        console.error('[POST finalize pelayanan_oss]', upsertErr);
        return NextResponse.json({ error: upsertErr.message }, { status: 400 });
      }
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

      const payload = {
        tiket_id: tiket.id,
        kunjungan_id: tiket.kunjungan_id,
        petugas_id: staff.id,
        ...parsed.data,
        status_draft: 'selesai',
        is_locked: true,
        updated_at: nowIso,
      };

      const { error: upsertErr } = await supabase
        .from('pelayanan_perizinan')
        .upsert(payload, { onConflict: 'tiket_id' });

      if (upsertErr) {
        console.error('[POST finalize pelayanan_perizinan]', upsertErr);
        return NextResponse.json({ error: upsertErr.message }, { status: 400 });
      }
    }

    // 3. Update status tiket dan visit ke 'selesai'
    if (tiket.legacy_visit_id) {
      await supabase
        .from('visit')
        .update({ status: 'selesai', waktu_selesai: nowIso })
        .eq('id', tiket.legacy_visit_id);
    } else {
      await supabase
        .from('tiket_antrean')
        .update({ status: 'selesai', waktu_selesai: nowIso })
        .eq('id', tiket.id);
    }

    return NextResponse.json({
      ok: true,
      message: 'Pelayanan berhasil diselesaikan dan data telah dikunci',
      is_locked: true,
      waktu_selesai: nowIso,
    });
  } catch (err) {
    console.error('[POST /api/admin/pelayanan/finalize]', err);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
