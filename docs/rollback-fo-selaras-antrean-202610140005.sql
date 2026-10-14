-- Rollback manual migrasi 202610140005_fo_selaras_antrean.sql (kembali ke versi A3 / versi lama PERSIS).
-- Terapkan ATOMIK (dry-run dulu), SEBELUM rollback 202610140004 dan 202610140003:
--   node scripts/apply-migration.mjs docs/rollback-fo-selaras-antrean-202610140005.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-fo-selaras-antrean-202610140005.sql --atomic
--
-- Yang dikembalikan (salinan persis, dirakit dari berkas migrasi sumber):
--   1. layanan_mulai(uuid)                 <- 202610140002_tiket_kepemilikan.sql
--   2. layanan_selesai: DROP bentuk 5-argumen, CREATE bentuk 3-argumen (uuid, text, jsonb) + REVOKE/GRANT A3
--   3. admin_ambil_alih(uuid, text)        <- 202610140002_tiket_kepemilikan.sql
--   4. get_queue_position(uuid)            <- 202607300016_wp22_views_tiket_antrean.sql
--   5. tandai_tidak_terlayani_akhir_hari() <- 202607300017_wp23_akhir_hari_panggil.sql
--   6. rollup_rekap_harian(date)           <- 202607300020_wp30_rekap_harian.sql
--   7. tandai_reservasi_no_show()          <- 202608310002_reservasi_no_show.sql
-- TIDAK dikembalikan (data): baris penanganan / tiket / kunjungan yang ditulis versi baru. Setelah rollback ini, tahap
-- penanganan tiket hasil eskalasi TIDAK lagi ikut berubah saat Mulai/Selesai; jalankan hanya bila klien Tahap B juga
-- dikembalikan dan antrean hasil eskalasi kosong.
-- Idempoten (DROP ... IF EXISTS / CREATE OR REPLACE).

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.layanan_selesai(uuid,text,jsonb,uuid,text)') IS NULL
     AND pg_catalog.to_regprocedure('public.layanan_selesai(uuid,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: layanan_selesai tidak ditemukan dalam bentuk apa pun (keadaan tak terduga)';
  END IF;
END $$;

-- 1. layanan_mulai (A3)
CREATE OR REPLACE FUNCTION public.layanan_mulai(p_tiket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id      uuid;
  v_me_role    text;
  v_me_layanan uuid;
  v_t          record;
  v_cek        record;
  v_now        timestamptz := pg_catalog.now();
  v_n          integer;
BEGIN
  -- Identitas dari sesi (bukan parameter).
  SELECT me.id, me.role, me.layanan_id INTO v_me_id, v_me_role, v_me_layanan FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.layanan_id, t.kunjungan_id, t.legacy_visit_id INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Peran (keputusan CEO 7.1): admin semua layanan; petugas hanya layanannya; front_office ditolak.
  IF NOT (
    v_me_role = 'admin'
    OR (v_me_role = 'petugas' AND v_me_layanan IS NOT NULL AND v_me_layanan = v_t.layanan_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau petugas layanan ini yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;

  -- Urutan kunci = jalur lama (visit -> kunjungan -> tiket).
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_t.legacy_visit_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id FOR UPDATE;

  -- Guard atomik: hanya satu pemanggil yang menang (read committed mengevaluasi ulang WHERE pada versi terbaru).
  UPDATE public.tiket_antrean AS t
     SET status = 'dilayani', dilayani_oleh = v_me_id, waktu_mulai_layan = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status IN ('menunggu', 'dipanggil') AND t.dilayani_oleh IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT t.status, t.dilayani_oleh, t.waktu_mulai_layan INTO v_cek
    FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
    -- Idempoten untuk klik ganda oleh pemilik yang sama.
    IF v_cek.status = 'dilayani' AND v_cek.dilayani_oleh = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_cek.waktu_mulai_layan);
    END IF;
    IF v_cek.status IN ('dilayani', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
  END IF;

  -- Sinkron visit (WP-24 / Tahap B: hapus blok ini). Nilai identik; trigger penjaga diizinkan lewat flag lokal.
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'on', true);
    UPDATE public.visit AS v
       SET status = 'dilayani', waktu_mulai_layan = v_now
     WHERE v.id = v_t.legacy_visit_id AND v.status = 'menunggu';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'off', true);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'DIVERGENSI: visit % tidak berstatus menunggu; tidak ada perubahan disimpan', v_t.legacy_visit_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_now);
END $$;

-- 2. layanan_selesai (A3, 3 argumen)
DROP FUNCTION IF EXISTS public.layanan_selesai(uuid, text, jsonb, uuid, text);

CREATE OR REPLACE FUNCTION public.layanan_selesai(
  p_tiket_id  uuid,
  p_form_type text DEFAULT NULL,
  p_payload   jsonb DEFAULT NULL
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
  v_legacy   uuid;
  v_kunj     uuid;
  v_t        record;
  v_existing record;
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
  -- Keputusan CEO 7.1: Front Office tidak memulai/menyelesaikan tiket layanan.
  IF v_me_role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: Front Office tidak menyelesaikan tiket layanan' USING ERRCODE = '42501';
  END IF;
  IF p_form_type IS NOT NULL AND p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;

  SELECT t.legacy_visit_id, t.kunjungan_id INTO v_legacy, v_kunj
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Urutan kunci = jalur lama (visit -> kunjungan -> tiket). Pemanggil konkuren kedua menunggu di sini,
  -- lalu melihat status 'selesai' (INVALID_STATUS).
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT t.id, t.legacy_visit_id, t.kunjungan_id, t.layanan_id, t.status, t.dilayani_oleh INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status dilayani (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  -- Aturan CEO: hanya orang yang memulai yang boleh menyelesaikan (Admin pun lewat admin_ambil_alih dulu).
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain' USING ERRCODE = '42501';
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
      -- petugas_id = pemilik (yang menyelesaikan), bukan penyimpan draf pertama (keputusan CEO 7.4).
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

  -- Guard atomik tiket (baris sudah dikunci di atas; 0 baris = keadaan tak terduga).
  UPDATE public.tiket_antrean AS t
     SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket % berubah selama penyelesaian', p_tiket_id USING ERRCODE = 'P0001';
  END IF;

  -- Sinkron visit (WP-24 / Tahap B: hapus blok ini). SKM/notifikasi/audit/response-rate tetap lewat trigger visit.
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'on', true);
    UPDATE public.visit AS v
       SET status = 'selesai', waktu_selesai = v_now
     WHERE v.id = v_t.legacy_visit_id AND v.status = 'dilayani';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'off', true);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'DIVERGENSI: visit % tidak berstatus dilayani; tidak ada perubahan disimpan', v_t.legacy_visit_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now);
END $$;

REVOKE ALL ON FUNCTION public.layanan_selesai(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai(uuid, text, jsonb) TO authenticated;

-- 3. admin_ambil_alih (A3)
CREATE OR REPLACE FUNCTION public.admin_ambil_alih(p_tiket_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_t       record;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin aktif yang boleh mengambil alih tiket' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_alasan IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_alasan)) < 5 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih wajib diisi (minimal 5 karakter)' USING ERRCODE = '22023';
  END IF;

  -- Kunci baris tiket (menserialkan dengan layanan_selesai yang juga mengunci baris ini).
  SELECT t.id, t.status, t.dilayani_oleh INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya tiket yang sedang dilayani yang dapat diambil alih (status=%)', v_t.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh = v_me_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id);
  END IF;

  -- Status dan waktu TIDAK berubah; updated_at sengaja tidak disentuh (tetap = visit.updated_at, A0 §1.3).
  UPDATE public.tiket_antrean AS t SET dilayani_oleh = v_me_id WHERE t.id = p_tiket_id AND t.status = 'dilayani';

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'admin_ambil_alih', 'tiket_antrean', p_tiket_id::text,
    pg_catalog.jsonb_build_object(
      'tiket_id', p_tiket_id,
      'pemilik_lama', v_t.dilayani_oleh,
      'pemilik_baru', v_me_id,
      'alasan', pg_catalog.btrim(p_alasan)
    ),
    pg_catalog.jsonb_build_object('dilayani_oleh', v_t.dilayani_oleh),
    pg_catalog.jsonb_build_object('dilayani_oleh', v_me_id)
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'pemilik_lama', v_t.dilayani_oleh, 'dilayani_oleh', v_me_id);
END $$;

REVOKE ALL ON FUNCTION public.admin_ambil_alih(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ambil_alih(uuid, text) TO authenticated;

-- 4. get_queue_position (WP-22)
CREATE OR REPLACE FUNCTION public.get_queue_position(p_qr_token uuid)
RETURNS TABLE (posisi int, total_menunggu int)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_layanan_id  uuid;
  v_tanggal     date;
  v_nomor       int;
  v_status      text;
BEGIN
  -- Find the issued ticket for this visitor via kunjungan.qr_token.
  -- A single kunjungan maps to at most one tiket (UNIQUE legacy_visit_id).
  SELECT t.layanan_id, t.tanggal, t.nomor, t.status
    INTO v_layanan_id, v_tanggal, v_nomor, v_status
  FROM public.kunjungan AS k
  JOIN public.tiket_antrean AS t ON t.kunjungan_id = k.id
  WHERE k.qr_token = p_qr_token::text
  LIMIT 1;

  -- Only return position when the visitor is actively waiting.
  IF NOT FOUND OR v_status <> 'menunggu' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (pg_catalog.count(*) FILTER (WHERE t2.nomor <= v_nomor))::integer AS posisi,
    pg_catalog.count(*)::integer AS total_menunggu
  FROM public.tiket_antrean AS t2
  WHERE t2.layanan_id = v_layanan_id
    AND t2.status      = 'menunggu'
    AND t2.tanggal     = v_tanggal;
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_queue_position(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_queue_position(uuid) TO anon, authenticated;

-- 5. tandai_tidak_terlayani_akhir_hari (WP-23)
CREATE OR REPLACE FUNCTION public.tandai_tidak_terlayani_akhir_hari()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  -- Update visit rows whose ticket is still menunggu at end of day.
  -- The dual-write trigger will propagate the status to tiket_antrean.
  UPDATE public.visit AS v
  SET    status     = 'tidak_terlayani',
         updated_at = now()
  FROM   public.tiket_antrean AS t
  WHERE  t.legacy_visit_id = v.id
    AND  t.status   = 'menunggu'
    AND  t.tanggal  = v_today
    AND  v.status   = 'menunggu';
END $$;

REVOKE ALL  ON FUNCTION public.tandai_tidak_terlayani_akhir_hari() FROM PUBLIC, anon, authenticated;

-- 6. rollup_rekap_harian (WP-30)
CREATE OR REPLACE FUNCTION public.rollup_rekap_harian(p_tanggal date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.rekap_harian_layanan (
    layanan_id, tanggal,
    total_hadir, total_selesai, total_tidak_terlayani, total_batal,
    rata_durasi_menit, petugas_hadir, petugas_alpa, updated_at
  )
  SELECT
    t.layanan_id,
    p_tanggal,
    count(*)                        FILTER (WHERE t.status <> 'terjadwal')         AS total_hadir,
    count(*)                        FILTER (WHERE t.status = 'selesai')             AS total_selesai,
    count(*)                        FILTER (WHERE t.status = 'tidak_terlayani')     AS total_tidak_terlayani,
    count(*)                        FILTER (WHERE t.status = 'batal')               AS total_batal,
    AVG(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60.0)
                                    FILTER (WHERE t.waktu_selesai IS NOT NULL
                                               AND t.waktu_mulai_layan IS NOT NULL) AS rata_durasi_menit,
    EXISTS(
      SELECT 1 FROM public.absensi_petugas ap
      JOIN public.petugas p ON p.id = ap.petugas_id
      WHERE ap.tanggal = p_tanggal
        AND p.layanan_id = t.layanan_id
        AND ap.status = 'approved'
    ) AS petugas_hadir,
    EXISTS(
      SELECT 1 FROM public.absensi_petugas ap
      JOIN public.petugas p ON p.id = ap.petugas_id
      WHERE ap.tanggal = p_tanggal
        AND p.layanan_id = t.layanan_id
        AND ap.status = 'alpa'
    ) AS petugas_alpa,
    now()
  FROM public.tiket_antrean t
  WHERE t.tanggal = p_tanggal
  GROUP BY t.layanan_id
  ON CONFLICT (layanan_id, tanggal) DO UPDATE SET
    total_hadir           = EXCLUDED.total_hadir,
    total_selesai         = EXCLUDED.total_selesai,
    total_tidak_terlayani = EXCLUDED.total_tidak_terlayani,
    total_batal           = EXCLUDED.total_batal,
    rata_durasi_menit     = EXCLUDED.rata_durasi_menit,
    petugas_hadir         = EXCLUDED.petugas_hadir,
    petugas_alpa          = EXCLUDED.petugas_alpa,
    updated_at            = EXCLUDED.updated_at;
END $$;

REVOKE ALL ON FUNCTION public.rollup_rekap_harian(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_rekap_harian(date) TO service_role;

-- 7. tandai_reservasi_no_show (QUE-15)
CREATE OR REPLACE FUNCTION public.tandai_reservasi_no_show()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_count integer := 0;
BEGIN
  UPDATE public.visit
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  asal = 'reservasi'
    AND  status = 'terjadwal'
    AND  tanggal_rencana < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.tandai_reservasi_no_show()
  FROM PUBLIC, anon, authenticated;
