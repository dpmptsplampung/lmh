-- Rollback manual migrasi 202610140011_pendataan_wajib.sql (Tahap C3: Pendataan semua field wajib).
-- Terapkan ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-pendataan-wajib-202610140011.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-pendataan-wajib-202610140011.sql --atomic
--
-- Yang dikembalikan:
--   1. layanan_selesai(uuid, text, jsonb, uuid, text) = salinan PERSIS versi 202610140007_wp24_akhiri_dual_write.sql
--      (tanpa validasi pendataan wajib).
--   2. DROP FUNCTION pendataan_validasi_payload(text, jsonb).
-- TIDAK dikembalikan (sengaja): CHECK tipe_pelaku_usaha / skala_usaha yang diperlonggar tetap superset (menyempitkannya
-- akan menolak baris yang sudah memakai 'tidak_berlaku' / 'Tidak berlaku'; tetap aman bagi kode lama).
-- Klien: kembalikan juga PelayananWizardModal dan route POST ke versi sebelumnya bila perlu (versi lama hanya
-- mewajibkan nama usaha/perusahaan, uraian, tindak lanjut, dan OPD teknis).
-- Idempoten.
-- URUTAN: rollback 202610140012 (perbaikan review) WAJIB lebih dulu; penjaga di bawah menolak bila 0012 masih ada
-- (0012 menimpa layanan_selesai; memulihkan versi 0007 di atasnya akan membuang kewajiban form per layanan).

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.form_pendataan_dari_nama(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140012 masih terpasang (jalankan docs/rollback-perbaikan-review-202610140012.sql dulu)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.layanan_selesai(
  p_tiket_id  uuid,
  p_form_type text DEFAULT NULL,
  p_payload   jsonb DEFAULT NULL,
  p_topik_id  uuid DEFAULT NULL,
  p_catatan   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id    uuid;
  v_me_role  text;
  v_kunj     uuid;
  v_t        record;
  v_p        record;
  v_existing record;
  v_topik    text;
  v_catatan  text;
  v_now      timestamptz := pg_catalog.now();
  v_n        integer;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh menyelesaikan layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF v_me_role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: Front Office tidak menyelesaikan tiket layanan' USING ERRCODE = '42501';
  END IF;
  IF p_form_type IS NOT NULL AND p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;

  SELECT t.kunjungan_id INTO v_kunj FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Urutan kunci global (WP-24): kunjungan -> tiket -> penanganan.
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT t.id, t.kunjungan_id, t.layanan_id, t.status, t.dilayani_oleh INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status dilayani (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain' USING ERRCODE = '42501';
  END IF;

  -- Tahap penanganan (hanya tiket hasil eskalasi): topik + catatan wajib, divalidasi sebelum menulis apa pun.
  SELECT p.id INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    v_topik   := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
    v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
  END IF;

  -- Pendataan (logika finalize_pelayanan 202610010001 bagian e, apa adanya; petugas_id = pemilik).
  IF p_form_type = 'oss' THEN
    SELECT * INTO v_existing FROM public.pelayanan_oss WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_oss (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_usaha, tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha,
        skala_usaha, sektor_usaha_kbli, tindak_lanjut, uraian_solusi,
        catatan_internal, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_t.kunjungan_id, v_me_id,
        COALESCE(p_payload->>'nama_pemohon', ''),
        NULLIF(p_payload->>'alamat_pemohon', ''),
        NULLIF(p_payload->>'no_hp', ''),
        NULLIF(p_payload->>'email', ''),
        NULLIF(p_payload->>'keperluan_awal', ''),
        COALESCE(p_payload->>'nama_usaha', ''),
        NULLIF(p_payload->>'tipe_pelaku_usaha', ''),
        NULLIF(p_payload->>'status_penanaman_modal', ''),
        NULLIF(p_payload->>'lokasi_usaha', ''),
        NULLIF(p_payload->>'skala_usaha', ''),
        NULLIF(p_payload->>'sektor_usaha_kbli', ''),
        COALESCE(p_payload->>'tindak_lanjut', ''),
        COALESCE(p_payload->>'uraian_solusi', ''),
        NULLIF(p_payload->>'catatan_internal', ''),
        'selesai', true, v_now, v_now
      );
    ELSE
      UPDATE public.pelayanan_oss SET
        petugas_id             = v_me_id,
        nama_pemohon           = COALESCE(p_payload->>'nama_pemohon', nama_pemohon),
        alamat_pemohon         = COALESCE(NULLIF(p_payload->>'alamat_pemohon', ''), alamat_pemohon),
        no_hp                  = COALESCE(NULLIF(p_payload->>'no_hp', ''), no_hp),
        email                  = COALESCE(NULLIF(p_payload->>'email', ''), email),
        keperluan_awal         = COALESCE(NULLIF(p_payload->>'keperluan_awal', ''), keperluan_awal),
        nama_usaha             = COALESCE(p_payload->>'nama_usaha', nama_usaha),
        tipe_pelaku_usaha      = COALESCE(NULLIF(p_payload->>'tipe_pelaku_usaha', ''), tipe_pelaku_usaha),
        status_penanaman_modal = COALESCE(NULLIF(p_payload->>'status_penanaman_modal', ''), status_penanaman_modal),
        lokasi_usaha           = COALESCE(NULLIF(p_payload->>'lokasi_usaha', ''), lokasi_usaha),
        skala_usaha            = COALESCE(NULLIF(p_payload->>'skala_usaha', ''), skala_usaha),
        sektor_usaha_kbli      = COALESCE(NULLIF(p_payload->>'sektor_usaha_kbli', ''), sektor_usaha_kbli),
        tindak_lanjut          = COALESCE(p_payload->>'tindak_lanjut', tindak_lanjut),
        uraian_solusi          = COALESCE(p_payload->>'uraian_solusi', uraian_solusi),
        catatan_internal       = COALESCE(NULLIF(p_payload->>'catatan_internal', ''), catatan_internal),
        status_draft           = 'selesai',
        is_locked              = true,
        updated_at             = v_now
      WHERE tiket_id = p_tiket_id;
    END IF;

  ELSIF p_form_type = 'perizinan' THEN
    SELECT * INTO v_existing FROM public.pelayanan_perizinan WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_perizinan (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_perusahaan, lokasi_usaha, opd_teknis, uraian_permohonan, tindak_lanjut,
        catatan_petugas, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_t.kunjungan_id, v_me_id,
        COALESCE(p_payload->>'nama_pemohon', ''),
        NULLIF(p_payload->>'alamat_pemohon', ''),
        NULLIF(p_payload->>'no_hp', ''),
        NULLIF(p_payload->>'email', ''),
        NULLIF(p_payload->>'keperluan_awal', ''),
        COALESCE(p_payload->>'nama_perusahaan', ''),
        NULLIF(p_payload->>'lokasi_usaha', ''),
        COALESCE(p_payload->>'opd_teknis', ''),
        COALESCE(p_payload->>'uraian_permohonan', ''),
        COALESCE(p_payload->>'tindak_lanjut', ''),
        NULLIF(p_payload->>'catatan_petugas', ''),
        'selesai', true, v_now, v_now
      );
    ELSE
      UPDATE public.pelayanan_perizinan SET
        petugas_id        = v_me_id,
        nama_pemohon      = COALESCE(p_payload->>'nama_pemohon', nama_pemohon),
        alamat_pemohon    = COALESCE(NULLIF(p_payload->>'alamat_pemohon', ''), alamat_pemohon),
        no_hp             = COALESCE(NULLIF(p_payload->>'no_hp', ''), no_hp),
        email             = COALESCE(NULLIF(p_payload->>'email', ''), email),
        keperluan_awal    = COALESCE(NULLIF(p_payload->>'keperluan_awal', ''), keperluan_awal),
        nama_perusahaan   = COALESCE(p_payload->>'nama_perusahaan', nama_perusahaan),
        lokasi_usaha      = COALESCE(NULLIF(p_payload->>'lokasi_usaha', ''), lokasi_usaha),
        opd_teknis        = COALESCE(p_payload->>'opd_teknis', opd_teknis),
        uraian_permohonan = COALESCE(p_payload->>'uraian_permohonan', uraian_permohonan),
        tindak_lanjut     = COALESCE(p_payload->>'tindak_lanjut', tindak_lanjut),
        catatan_petugas   = COALESCE(NULLIF(p_payload->>'catatan_petugas', ''), catatan_petugas),
        status_draft      = 'selesai',
        is_locked         = true,
        updated_at        = v_now
      WHERE tiket_id = p_tiket_id;
    END IF;
  END IF;

  UPDATE public.tiket_antrean AS t
     SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket % berubah selama penyelesaian', p_tiket_id USING ERRCODE = 'P0001';
  END IF;

  IF v_p.id IS NOT NULL THEN
    UPDATE public.penanganan AS p
       SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
           selesai_at = v_now
     WHERE p.id = v_p.id;
  END IF;

  -- Kunjungan 'selesai' bila tidak ada tahap atau tiket lain yang masih terbuka (tiket lama: dulu lewat dual-write).
  -- Trigger kunjungan (202610140007 bagian 5-7) mengantrekan SKM, menambah response rate, dan mencatat audit.
  UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id
     AND k.status IS DISTINCT FROM 'selesai'
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                     WHERE x.kunjungan_id = v_t.kunjungan_id AND x.status IN ('menunggu', 'berjalan'))
     AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS y
                     WHERE y.kunjungan_id = v_t.kunjungan_id AND y.status IN ('menunggu', 'dipanggil', 'dilayani'));

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now,
    'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id));
END $$;

DROP FUNCTION IF EXISTS public.pendataan_validasi_payload(text, jsonb);
