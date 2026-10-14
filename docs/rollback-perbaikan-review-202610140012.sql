-- docs/rollback-perbaikan-review-202610140012.sql
-- Rollback manual migrasi 202610140012_perbaikan_review.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan CEO,
-- ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-perbaikan-review-202610140012.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-perbaikan-review-202610140012.sql --atomic
-- URUTAN: rollback ini setelah rollback 202610140013 (bila 0013 terpasang; penjaga di bawah menolak selama penandanya
-- ada) dan sebelum rollback 202610140011, 202610140009, 202610140008, 202610140007, ... Rollback 0011/0009/0007 menolak
-- dijalankan selama objek 0012 masih ada.
--
-- Yang dikembalikan (salinan PERSIS dari berkas sumber, diuji perbaikan_review.test.ts):
--   layanan_selesai                                   <- 202610140011_pendataan_wajib.sql
--   get_queue_position (+ hak), rollup_rekap_harian (+ hak) <- 202610140005_fo_selaras_antrean.sql
--   fo_mulai_kunjungan, reservasi_buat                <- 202610140004_fo_rpc.sql (hak tidak berubah oleh 0012)
--   layanan_mulai, admin_alihkan, tandai_reservasi_no_show (+ hak) <- 202610140007_wp24_akhiri_dual_write.sql
--   chat_ambil, chat_teruskan (+ hak), chat_sesi_eskalasi_kunjungan, chat_pesan_eskalasi_kunjungan
--                                                     <- 202610140009_chat_online.sql (#13 hari tanpa pelayanan)
--   DROP: job 'chat_tutup_otomatis' + tutup_chat_tertinggal(); hari_tanpa_layanan(date) (setelah fungsi chat
--         dipulihkan); trigger trg_layanan_isi_form_pendataan + layanan_isi_form_pendataan(); constraint + kolom
--         layanan.form_pendataan; form_pendataan_dari_nama(text).
-- TIDAK dikembalikan (data, sengaja): kunjungan walk-in 'terjadwal' yang dibatalkan (audit_log 'tutup_walkin_terjadwal'
-- menyimpan daftar id-nya bila CEO ingin memulihkan), sesi chat yang ditutup otomatis (+ pesan sistem), tahap/kunjungan
-- chat yang ditutup, baris rekap_harian_layanan yang sudah dihitung ulang (jalankan rollup lama ulang bila perlu).
-- Sesi chat yang tetap 'eskalasi' TANPA kunjungan karena hari tanpa pelayanan (#13) tidak di-backfill: kunjungannya
-- tercatat pada pesan pengunjung berikutnya / chat_ambil, atau sesi ditutup tutup_chat_tertinggal (bila masih ada).
-- Pilihan Admin pada layanan.form_pendataan HILANG bersama kolom.
-- KLIEN: kembalikan route /api/admin/pelayanan, admin/antrian, dan Kelola Layanan ke versi yang tidak membaca
-- layanan.form_pendataan SEBELUM rollback ini (query PostgREST atas kolom yang hilang akan gagal). Klien chat
-- (/chat, /admin/chat, /api/chat/ai) tidak memanggil hari_tanpa_layanan (menilai hari dari tabel hari_libur sendiri),
-- jadi tetap jalan; tanpa #13 DB, staf kembali dapat mengambil chat pada akhir pekan walau tombolnya dinonaktifkan.
-- Idempoten (CREATE OR REPLACE / DROP ... IF EXISTS).

DO $$
BEGIN
  -- 202610140013 (keterbukaan data antar FO) harus di-rollback lebih dulu (penanda: komentar boleh_penanganan).
  IF COALESCE(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)'), 'pg_proc'), '') LIKE '%202610140013%' THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140013 masih terpasang (jalankan docs/rollback-fo-keterbukaan-data-202610140013.sql dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.pendataan_validasi_payload(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140011 tidak terpasang (keadaan tak terduga; layanan_selesai 0011 memanggil pendataan_validasi_payload)';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_buat_kunjungan(uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140009 tidak terpasang (keadaan tak terduga)';
  END IF;
END $$;

-- Job dan fungsi baru lebih dulu (tidak ada yang bergantung padanya).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.unschedule(job.jobid) FROM cron.job AS job WHERE job.jobname = 'chat_tutup_otomatis';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.tutup_chat_tertinggal();

-- layanan_selesai <- 202610140011_pendataan_wajib.sql (persis)
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

    -- Pendataan wajib lengkap (keputusan CEO G.5): semua field terisi; divalidasi sebelum menulis apa pun.
    PERFORM public.pendataan_validasi_payload('oss', p_payload);

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

    -- Pendataan wajib lengkap (keputusan CEO G.5): semua field terisi; divalidasi sebelum menulis apa pun.
    PERFORM public.pendataan_validasi_payload('perizinan', p_payload);

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

-- get_queue_position <- 202610140005_fo_selaras_antrean.sql (persis)
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
  SELECT t.layanan_id, t.tanggal, t.nomor, t.status
    INTO v_layanan_id, v_tanggal, v_nomor, v_status
  FROM public.kunjungan AS k
  JOIN public.tiket_antrean AS t ON t.kunjungan_id = k.id
  WHERE k.qr_token = p_qr_token::text
  ORDER BY (t.status = 'menunggu') DESC, t.waktu_terbit DESC, t.id
  LIMIT 1;

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

-- fo_mulai_kunjungan <- 202610140004_fo_rpc.sql (persis)
CREATE OR REPLACE FUNCTION public.fo_mulai_kunjungan(
  p_nama              text,
  p_asal_instansi     text,
  p_kontak_hp         text DEFAULT NULL,
  p_kategori          text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_keperluan         text DEFAULT NULL,
  p_layanan_saran_id  uuid DEFAULT NULL,
  p_pengunjung_id     uuid DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
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
  v_me_lyn   uuid;
  v_now      timestamptz := pg_catalog.now();
  v_tgl      date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_nama     text := pg_catalog.btrim(COALESCE(p_nama, ''));
  v_instansi text := pg_catalog.btrim(COALESCE(p_asal_instansi, ''));
  v_hp       text := NULLIF(pg_catalog.regexp_replace(COALESCE(p_kontak_hp, ''), '[[:space:]-]', '', 'g'), '');
  v_email    text := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), '');
  v_kep      text := NULLIF(pg_catalog.btrim(COALESCE(p_keperluan, '')), '');
  v_kat      text := NULLIF(pg_catalog.btrim(COALESCE(p_kategori, '')), '');
  v_ada      record;
  v_kid      uuid;
  v_pid      uuid;
  v_qr       text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  -- Idempotensi (klik ganda / replay offline).
  IF p_client_request_id IS NOT NULL THEN
    SELECT k.id, k.dibuat_oleh, k.qr_token INTO v_ada FROM public.kunjungan AS k WHERE k.client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_ada.dibuat_oleh IS DISTINCT FROM v_me_id THEN
        RAISE EXCEPTION 'IDEMPOTENSI_BENTROK: client_request_id sudah dipakai staf lain' USING ERRCODE = 'P0001';
      END IF;
      SELECT p.id INTO v_pid FROM public.penanganan AS p WHERE p.kunjungan_id = v_ada.id AND p.tahap_ke = 1;
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_ada', true, 'kunjungan_id', v_ada.id, 'penanganan_id', v_pid, 'qr_token', v_ada.qr_token);
    END IF;
  END IF;

  IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama wajib 3-120 karakter' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_instansi) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: asal/instansi wajib 2-200 karakter' USING ERRCODE = '22023';
  END IF;
  IF v_hp IS NOT NULL AND v_hp !~ '^(\+?62|0)[0-9]{8,14}$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nomor HP tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_kat IS NOT NULL AND v_kat NOT IN ('UMKM', 'Umum', 'Instansi', 'Investor') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: kategori tidak dikenal' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: email tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_kep IS NOT NULL AND pg_catalog.char_length(v_kep) > 500 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan maksimal 500 karakter' USING ERRCODE = '22023';
  END IF;
  IF p_layanan_saran_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_saran_id AND l.aktif) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan saran tidak ada atau nonaktif' USING ERRCODE = '22023';
  END IF;
  IF p_pengunjung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pengunjung AS pg WHERE pg.id = p_pengunjung_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF public.layanan_sudah_tutup() THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: layanan hari ini sudah tutup pukul % WIB', pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, keperluan, layanan_saran_id, client_request_id, dibuat_oleh, created_at, updated_at
  ) VALUES (
    p_pengunjung_id, v_nama, v_hp, 'walk_in', v_qr, v_tgl, v_now, 'dilayani',
    v_instansi, v_kat, v_email, v_kep, p_layanan_saran_id, p_client_request_id, v_me_id, v_now, v_now
  ) RETURNING id INTO v_kid;

  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, penangan_id, status, mulai_at, dibuat_oleh)
  VALUES (v_kid, 1, 'fo', 'walk_in', v_me_id, 'berjalan', v_now, v_me_id)
  RETURNING id INTO v_pid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_ada', false, 'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'qr_token', v_qr, 'mulai_at', v_now);
END $$;

-- layanan_mulai <- 202610140007_wp24_akhiri_dual_write.sql (persis)
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
  SELECT me.id, me.role, me.layanan_id INTO v_me_id, v_me_role, v_me_layanan FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.layanan_id, t.kunjungan_id INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_me_role = 'admin'
    OR (v_me_role = 'petugas' AND v_me_layanan IS NOT NULL AND v_me_layanan = v_t.layanan_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau petugas layanan ini yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;

  -- Urutan kunci global (WP-24): kunjungan -> tiket -> penanganan.
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id FOR UPDATE;

  UPDATE public.tiket_antrean AS t
     SET status = 'dilayani', dilayani_oleh = v_me_id, waktu_mulai_layan = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status IN ('menunggu', 'dipanggil') AND t.dilayani_oleh IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT t.status, t.dilayani_oleh, t.waktu_mulai_layan INTO v_cek
    FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
    IF v_cek.status = 'dilayani' AND v_cek.dilayani_oleh = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_cek.waktu_mulai_layan);
    END IF;
    IF v_cek.status IN ('dilayani', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
  END IF;

  -- Tahap penanganan (tiket hasil eskalasi FO): menunggu -> berjalan oleh pemanggil.
  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now
   WHERE p.tiket_id = p_tiket_id AND p.status = 'menunggu';

  -- Kunjungan ikut 'dilayani' (tiket hasil eskalasi maupun tiket lama; dulu tiket lama lewat trigger dual-write).
  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id AND k.status IS DISTINCT FROM 'dilayani';

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_now);
END $$;

-- admin_alihkan <- 202610140007_wp24_akhiri_dual_write.sql (persis)
CREATE OR REPLACE FUNCTION public.admin_alihkan(
  p_tiket_id       uuid,
  p_layanan_tujuan uuid,
  p_alasan         text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_kid     uuid;
  v_legacy  uuid;
  v_t       record;
  v_p       record;
  v_l       record;
  v_baru    uuid;
  v_nomor   text;
  v_tahap   integer;
  v_pb      uuid;
  v_notif   integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['admin']) AS s;
  IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan pengalihan wajib 5-500 karakter' USING ERRCODE = '22023';
  END IF;

  SELECT t.kunjungan_id, t.legacy_visit_id INTO v_kid, v_legacy
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket_id) THEN
    RAISE EXCEPTION 'TIKET_LAMA: hanya tiket hasil eskalasi FO yang dapat dialihkan' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT t.* INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF v_t.status NOT IN ('menunggu', 'dipanggil', 'dilayani') THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dapat dialihkan (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  IF p_layanan_tujuan = v_t.layanan_id THEN
    RAISE EXCEPTION 'LAYANAN_SAMA: layanan tujuan sama dengan layanan tiket' USING ERRCODE = '22023';
  END IF;
  SELECT l.id, l.nama, l.aktif, l.punya_antrean INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_tujuan;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tanpa antrean' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket terbuka tanpa tahap penanganan terbuka' USING ERRCODE = 'P0001';
  END IF;

  v_baru := public.terbit_tiket(v_kid, p_layanan_tujuan);
  UPDATE public.tiket_antrean AS t SET penanganan_asal_id = v_t.penanganan_asal_id WHERE t.id = v_baru
  RETURNING t.nomor_display INTO v_nomor;

  UPDATE public.tiket_antrean AS t
     SET status = 'dialihkan', waktu_selesai = v_now, updated_at = v_now, dialihkan_ke = v_baru
   WHERE t.id = p_tiket_id AND t.status = v_t.status;

  UPDATE public.penanganan AS p
     SET status = 'batal', batal_karena = 'dialihkan', selesai_at = v_now,
         catatan = pg_catalog.left('Dialihkan Admin: ' || v_alasan, 1000)
   WHERE p.id = v_p.id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'layanan', p_layanan_tujuan, v_p.saluran, v_baru, 'menunggu', v_me_id)
  RETURNING id INTO v_pb;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_kid;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'admin_alihkan', 'tiket_antrean', p_tiket_id::text,
    pg_catalog.jsonb_build_object('tiket_lama', p_tiket_id, 'tiket_baru', v_baru, 'kunjungan_id', v_kid,
      'layanan_lama', v_t.layanan_id, 'layanan_baru', p_layanan_tujuan, 'status_lama', v_t.status,
      'pemilik_lama', v_t.dilayani_oleh, 'alasan', v_alasan),
    pg_catalog.jsonb_build_object('layanan_id', v_t.layanan_id, 'status', v_t.status, 'dilayani_oleh', v_t.dilayani_oleh),
    pg_catalog.jsonb_build_object('layanan_id', p_layanan_tujuan, 'status', 'dialihkan', 'tiket_baru', v_baru)
  );

  v_notif := public.fo_notifikasi_tiket(v_baru, 'dialihkan');

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'tiket_lama_id', p_tiket_id,
    'tiket_baru_id', v_baru,
    'nomor_display', v_nomor,
    'layanan_id', p_layanan_tujuan,
    'layanan_nama', v_l.nama,
    'penanganan_id', v_pb,
    'petugas_hadir', public.antrean_dibuka(p_layanan_tujuan, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

-- reservasi_buat <- 202610140004_fo_rpc.sql (persis)
CREATE OR REPLACE FUNCTION public.reservasi_buat(
  p_tujuan            text,
  p_tanggal           date,
  p_layanan_id        uuid DEFAULT NULL,
  p_nama_yang_ditemui text DEFAULT NULL,
  p_keperluan         text DEFAULT NULL,
  p_jam_rencana       time DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_pg      record;
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_tujuan  text := pg_catalog.btrim(COALESCE(p_tujuan, ''));
  v_ditemui text := NULLIF(pg_catalog.btrim(COALESCE(p_nama_yang_ditemui, '')), '');
  v_kep     text := NULLIF(pg_catalog.btrim(COALESCE(p_keperluan, '')), '');
  v_l       record;
  v_jumlah  integer;
  v_kid     uuid;
  v_qr      text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: masuk terlebih dahulu' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.nama, p.no_hp, p.email, p.asal_instansi, p.kategori INTO v_pg
  FROM public.pengunjung AS p WHERE p.auth_user_id = v_uid;
  IF v_pg.id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: profil pengunjung belum ada' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  IF v_tujuan NOT IN ('loket', 'bertemu_seseorang') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: tujuan harus loket atau bertemu_seseorang' USING ERRCODE = '22023';
  END IF;
  IF p_tanggal IS NULL OR p_tanggal < v_tgl OR p_tanggal > v_tgl + 7 THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: tanggal reservasi hari ini sampai 7 hari ke depan' USING ERRCODE = '22023';
  END IF;
  IF EXTRACT(ISODOW FROM p_tanggal) IN (6, 7) THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: reservasi tidak tersedia pada akhir pekan' USING ERRCODE = '22023';
  END IF;
  IF v_kep IS NOT NULL AND pg_catalog.char_length(v_kep) > 500 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan maksimal 500 karakter' USING ERRCODE = '22023';
  END IF;

  IF v_tujuan = 'loket' THEN
    SELECT l.id, l.nama, l.aktif, l.punya_antrean, l.status_tampilan, l.kuota_harian INTO v_l
    FROM public.layanan AS l WHERE l.id = p_layanan_id;
    IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean OR v_l.status_tampilan = 'nonaktif' THEN
      RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tidak tersedia untuk reservasi' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_layanan_buka_jadwal(p_layanan_id, p_tanggal, NULL) THEN
      RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi pada tanggal tersebut', v_l.nama USING ERRCODE = 'P0001';
    END IF;
    v_ditemui := NULL;
  ELSE
    IF v_ditemui IS NULL OR pg_catalog.char_length(v_ditemui) NOT BETWEEN 3 AND 120 THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: nama yang ditemui wajib 3-120 karakter' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Serialkan reservasi per (layanan/tujuan, tanggal) agar kuota dan cek ganda tidak bocor saat serentak.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('lmh.reservasi:' || COALESCE(p_layanan_id::text, v_tujuan) || ':' || p_tanggal::text));

  IF EXISTS (
    SELECT 1 FROM public.kunjungan AS k
    WHERE k.pengunjung_id = v_pg.id AND k.asal = 'reservasi' AND k.status = 'terjadwal' AND k.tanggal = p_tanggal
      AND k.tujuan = v_tujuan AND k.layanan_saran_id IS NOT DISTINCT FROM (CASE WHEN v_tujuan = 'loket' THEN p_layanan_id END)
  ) THEN
    RAISE EXCEPTION 'RESERVASI_GANDA: Anda sudah punya reservasi yang sama pada tanggal ini' USING ERRCODE = 'P0001';
  END IF;

  IF v_tujuan = 'loket' THEN
    IF v_l.kuota_harian IS NOT NULL THEN
      SELECT pg_catalog.count(*)::integer INTO v_jumlah FROM public.kunjungan AS k
      WHERE k.asal = 'reservasi' AND k.layanan_saran_id = p_layanan_id AND k.tanggal = p_tanggal
        AND k.status IN ('terjadwal', 'menunggu', 'dilayani', 'selesai');
      IF v_jumlah >= v_l.kuota_harian THEN
        RAISE EXCEPTION 'KUOTA_PENUH: kuota reservasi % pada tanggal tersebut sudah penuh', v_l.nama USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, keperluan, tujuan, layanan_saran_id, nama_yang_ditemui, jam_rencana,
    created_at, updated_at
  ) VALUES (
    v_pg.id, v_pg.nama, v_pg.no_hp, 'reservasi', v_qr, p_tanggal, v_now, 'terjadwal',
    v_pg.asal_instansi, v_pg.kategori, v_pg.email, v_kep, v_tujuan,
    CASE WHEN v_tujuan = 'loket' THEN p_layanan_id END, v_ditemui, p_jam_rencana,
    v_now, v_now
  ) RETURNING id INTO v_kid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'kunjungan_id', v_kid, 'qr_token', v_qr, 'tanggal', p_tanggal, 'status', 'terjadwal');
END $$;

-- rollup_rekap_harian <- 202610140005_fo_selaras_antrean.sql (persis)
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
    count(*)                        FILTER (WHERE t.status NOT IN ('terjadwal', 'dialihkan')) AS total_hadir,
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

-- tandai_reservasi_no_show <- 202610140007_wp24_akhiri_dual_write.sql (persis)
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
  UPDATE public.kunjungan AS k
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  k.asal = 'reservasi'
    AND  k.status = 'terjadwal'
    AND  k.tanggal < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.tandai_reservasi_no_show()
  FROM PUBLIC, anon, authenticated;

-- #13 hari tanpa pelayanan: fungsi chat <- 202610140009_chat_online.sql (persis), lalu hari_tanpa_layanan dihapus.
CREATE OR REPLACE FUNCTION public.chat_sesi_eskalasi_kunjungan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_kid uuid;
BEGIN
  -- Batas spam: hanya sesi yang sudah punya pesan pengunjung (sesi kosong menunggu pesan pertamanya).
  IF NEW.status = 'eskalasi' AND NEW.kunjungan_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'eskalasi')
     AND EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = NEW.id AND m.pengirim = 'pengunjung') THEN
    v_kid := public.chat_buat_kunjungan(NEW.id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chat_sesi_eskalasi_kunjungan() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_pesan_eskalasi_kunjungan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s   record;
  v_kid uuid;
BEGIN
  SELECT s.id, s.status, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = NEW.sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NOT NULL AND v_s.status = 'eskalasi' AND v_s.kunjungan_id IS NULL THEN
    v_kid := public.chat_buat_kunjungan(NEW.sesi_id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.sesi_id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chat_pesan_eskalasi_kunjungan() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_ambil(p_sesi_id uuid, p_alasan text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_s       record;
  v_kid     uuid;
  v_p       record;
  v_tahap   integer;
  v_pid     uuid;
  v_peran   text;
  v_lyn     uuid;
  v_n       integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin', 'petugas']) AS s;

  SELECT s.id, s.status, s.layanan_id, s.kunjungan_id, s.ditangani_oleh INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me_role = 'petugas' AND (v_me_lyn IS NULL OR v_s.layanan_id IS DISTINCT FROM v_me_lyn) THEN
    RAISE EXCEPTION 'FORBIDDEN: chat ini bukan untuk layanan Anda' USING ERRCODE = '42501';
  END IF;
  IF v_s.status = 'selesai' THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  -- Sesi bot (belum eskalasi) atau sesi lama tanpa kunjungan: catat sekarang (masuk "kotak masuk" lalu diambil).
  v_kid := v_s.kunjungan_id;
  IF v_kid IS NULL THEN
    v_kid := public.chat_buat_kunjungan(p_sesi_id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', p_sesi_id);
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_kid AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: sesi chat belum selesai tetapi tidak punya tahap terbuka' USING ERRCODE = 'P0001';
  END IF;

  -- Sudah berjalan.
  IF v_p.status = 'berjalan' THEN
    IF v_p.penangan_id = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'ambil_alih', false, 'sesi_id', p_sesi_id, 'kunjungan_id', v_kid,
        'penanganan_id', v_p.id, 'peran_tahap', v_p.peran_tahap, 'mulai_at', v_p.mulai_at);
    END IF;
    IF v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: chat sudah ditangani staf lain' USING ERRCODE = 'P0001';
    END IF;
    -- Admin mengambil alih (alasan wajib, audit), pola admin_ambil_alih.
    IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
      RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih chat wajib 5-500 karakter' USING ERRCODE = '22023';
    END IF;
    UPDATE public.penanganan AS p
       SET status = 'batal', batal_karena = 'diambil_alih', selesai_at = v_now,
           catatan = pg_catalog.left('Diambil alih Admin: ' || v_alasan, CASE WHEN p.peran_tahap = 'fo' THEN 200 ELSE 1000 END)
     WHERE p.id = v_p.id;
    SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status,
                                   mulai_at, chat_sesi_id, dibuat_oleh)
    VALUES (v_kid, v_tahap, v_p.peran_tahap, v_p.layanan_id, 'chat', v_me_id, 'berjalan', v_now, p_sesi_id, v_me_id)
    RETURNING id INTO v_pid;
    PERFORM public.chat_ubah_sesi(p_sesi_id, 'aktif', v_me_id);
    PERFORM public.chat_pesan_sistem(p_sesi_id,
      'Percakapan ini dilanjutkan oleh petugas lain. Pesan Anda akan dibalas langsung oleh petugas.');
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_ambil_alih', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_kid, 'penanganan_lama', v_p.id,
              'penanganan_baru', v_pid, 'pemilik_lama', v_p.penangan_id, 'alasan', v_alasan),
            pg_catalog.jsonb_build_object('penangan_id', v_p.penangan_id),
            pg_catalog.jsonb_build_object('penangan_id', v_me_id));
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'sudah_milik_anda', false, 'ambil_alih', true, 'pemilik_lama', v_p.penangan_id, 'sesi_id', p_sesi_id,
      'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'peran_tahap', v_p.peran_tahap, 'mulai_at', v_now);
  END IF;

  -- Menunggu: tentukan peran tahap setelah diambil.
  IF v_p.peran_tahap = 'fo' THEN
    IF v_me_role = 'petugas' THEN
      -- Petugas mengambil langsung selama BELUM diambil FO: tahap menjadi tahap layanannya (tidak ada tahap FO fiktif).
      v_peran := 'layanan';
      v_lyn   := v_me_lyn;
    ELSE
      v_peran := 'fo';
      v_lyn   := NULL;
    END IF;
  ELSE
    IF v_me_role = 'front_office' THEN
      RAISE EXCEPTION 'FORBIDDEN: chat ini sudah diteruskan dan menunggu petugas layanan' USING ERRCODE = '42501';
    END IF;
    IF v_me_role = 'petugas' AND v_p.layanan_id IS DISTINCT FROM v_me_lyn THEN
      RAISE EXCEPTION 'FORBIDDEN: chat ini menunggu petugas layanan lain' USING ERRCODE = '42501';
    END IF;
    v_peran := 'layanan';
    v_lyn   := v_p.layanan_id;
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now, peran_tahap = v_peran, layanan_id = v_lyn,
         chat_sesi_id = p_sesi_id
   WHERE p.id = v_p.id AND p.status = 'menunggu' AND p.penangan_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'SUDAH_DIAMBIL: chat sudah ditangani staf lain' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now WHERE k.id = v_kid;
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'aktif', v_me_id);
  PERFORM public.chat_pesan_sistem(p_sesi_id,
    'Percakapan ini telah diambil oleh petugas. Pesan Anda akan dibalas langsung oleh petugas.');

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_ambil', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_kid, 'penanganan_id', v_p.id,
              'peran_tahap', v_peran),
            pg_catalog.jsonb_build_object('status_sesi', v_s.status),
            pg_catalog.jsonb_build_object('status_sesi', 'aktif', 'penangan_id', v_me_id));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'ambil_alih', false, 'sesi_id', p_sesi_id, 'kunjungan_id', v_kid,
    'penanganan_id', v_p.id, 'peran_tahap', v_peran, 'mulai_at', v_now);
END $$;

CREATE OR REPLACE FUNCTION public.chat_teruskan(
  p_sesi_id    uuid,
  p_layanan_id uuid,
  p_topik_id   uuid,
  p_catatan    text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_s       record;
  v_p       record;
  v_l       record;
  v_topik   text;
  v_catatan text;
  v_tahap   integer;
  v_pl      uuid;
  v_notif   integer := 0;
  r         record;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT s.id, s.status, s.layanan_id, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_s.status = 'selesai' OR v_s.kunjungan_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat belum diambil atau sudah selesai (status=%)', v_s.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_s.kunjungan_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL OR v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: chat tidak sedang ditangani (ambil dulu dengan chat_ambil)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'BUKAN_TAHAP_FO: chat ini sedang ditangani petugas layanan' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: chat ini ditangani staf lain' USING ERRCODE = '42501';
  END IF;
  v_topik   := public.fo_validasi_topik(p_topik_id, NULL);
  v_catatan := public.fo_validasi_catatan(p_catatan, 200);

  SELECT l.id, l.nama, l.aktif, l.punya_chat INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_id;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT COALESCE(v_l.punya_chat, false) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tidak melayani chat' USING ERRCODE = '22023';
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'dieskalasi', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = v_p.id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_s.kunjungan_id;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, status, chat_sesi_id, dibuat_oleh)
  VALUES (v_s.kunjungan_id, v_tahap, 'layanan', p_layanan_id, 'chat', 'menunggu', p_sesi_id, v_me_id)
  RETURNING id INTO v_pl;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_s.kunjungan_id;
  -- Sesi pindah ke layanan tujuan (RLS chat yang ada memberi petugas layanan itu akses baca/tulis), penangan dilepas.
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'eskalasi', NULL, p_layanan_id);
  PERFORM public.chat_pesan_sistem(p_sesi_id, pg_catalog.format(
    'Percakapan Anda diteruskan ke petugas layanan %s. Mohon tunggu, petugas akan segera membalas.', v_l.nama));

  -- Notifikasi web push ke petugas aktif layanan tujuan (tanpa PII pengunjung).
  FOR r IN
    SELECT p.auth_user_id FROM public.petugas AS p
    WHERE p.layanan_id = p_layanan_id AND p.role = 'petugas' AND p.aktif = true
  LOOP
    PERFORM public.queue_notifikasi(
      r.auth_user_id, NULL, 'web_push',
      'Chat menunggu',
      pg_catalog.format('Front Office meneruskan satu chat ke layanan %s.', v_l.nama),
      pg_catalog.jsonb_build_object('type', 'chat_diteruskan', 'sesi_id', p_sesi_id, 'layanan_id', p_layanan_id,
                                    'url', '/admin/chat'));
    v_notif := v_notif + 1;
  END LOOP;

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_teruskan', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id,
              'penanganan_fo_id', v_p.id, 'penanganan_layanan_id', v_pl),
            pg_catalog.jsonb_build_object('layanan_id', v_s.layanan_id),
            pg_catalog.jsonb_build_object('layanan_id', p_layanan_id));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'sesi_id', p_sesi_id,
    'kunjungan_id', v_s.kunjungan_id,
    'penanganan_fo_id', v_p.id,
    'penanganan_layanan_id', v_pl,
    'layanan_id', p_layanan_id,
    'layanan_nama', v_l.nama,
    'petugas_hadir', public.antrean_dibuka(p_layanan_id, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

REVOKE ALL ON FUNCTION public.chat_ambil(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ambil(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.chat_teruskan(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_teruskan(uuid, uuid, uuid, text) TO authenticated;

DROP FUNCTION IF EXISTS public.hari_tanpa_layanan(date);

-- Kolom form_pendataan dihapus SETELAH layanan_selesai dipulihkan (versi 0011 tidak membacanya).
DROP TRIGGER IF EXISTS trg_layanan_isi_form_pendataan ON public.layanan;
DROP FUNCTION IF EXISTS public.layanan_isi_form_pendataan();
ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_form_pendataan_check;
ALTER TABLE public.layanan DROP COLUMN IF EXISTS form_pendataan;
DROP FUNCTION IF EXISTS public.form_pendataan_dari_nama(text);
