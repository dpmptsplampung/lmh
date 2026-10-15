-- 202610140015_pendataan_tanpa_topik_email_opsional.sql
-- Permintaan CEO 2026-10-15. Forward-only: kedua fungsi di-CREATE OR REPLACE PENUH dari versi terakhirnya (signature,
-- RETURNS, atribut, hak EXECUTE, urutan kunci, kode galat lama dipertahankan; tidak ada kode galat baru).
--
-- ISI
--   1. Pendataan petugas layanan TANPA "Pilih topik" + "Catatan penanganan" (tiket hasil eskalasi FO):
--      layanan_selesai = versi 202610140012 dengan perubahan HANYA pada tahap penanganan 'layanan' yang berjalan:
--      - layanan ber-Pendataan (layanan.form_pendataan NOT NULL; form sudah wajib + divalidasi
--        pendataan_validasi_payload): p_topik_id dan p_catatan OPSIONAL. Bila dikirim (klien lama) tetap divalidasi
--        seperti sebelumnya (TOPIK_TIDAK_VALID / CATATAN_TERLALU_PANJANG). Bila tidak dikirim: topik = NULL,
--        catatan DITURUNKAN di server dari Pendataan (langkah 3 "Tindakan & Solusi"):
--          oss       : 'Tindak lanjut: ' || tindak_lanjut || baris baru || uraian_solusi
--          perizinan : 'Tindak lanjut: ' || tindak_lanjut || baris baru || catatan_petugas (diabaikan bila '-')
--        dipotong <= 1000 karakter (batas penanganan_catatan_panjang); bila kosong '-'.
--      - layanan TANPA Pendataan (SelesaiEskalasiModal, mis. BPJS/Bank): TIDAK berubah (topik + catatan wajib), karena
--        tidak ada data lain yang merekam hasil layanan.
--      - CHECK penanganan_status_konsisten: tahap 'selesai' peran 'layanan' boleh tanpa topik (tahap 'fo' tetap wajib
--        topik kecuali 'dikembalikan'; catatan tetap wajib non-kosong untuk semua tahap selesai).
--      Tahap FO (fo_selesai / fo_eskalasi / chat_*) TIDAK berubah.
--   2. Email walk-in FO OPSIONAL: fo_mulai_kunjungan = versi 202610140014 dengan perubahan HANYA: email kosong/NULL
--      diterima (disimpan NULL); email terisi tetap divalidasi regex + panjang yang sama (DATA_TIDAK_VALID, DETAIL
--      'email'). Email untuk tiket hasil eskalasi tetap WAJIB di Pendataan (pendataan_validasi_payload 0011: 'email'
--      wajib non-kosong, "Tidak berlaku" bila memang tidak ada).
--
-- SYARAT: 202610140014 (penanda komentar fo_mulai_kunjungan) dan 202610140012 (layanan_selesai 5 argumen +
--   layanan.form_pendataan). URUTAN: ... -> 0013 -> 0014 -> 0015.
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140015_pendataan_tanpa_topik_email_opsional.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140015_pendataan_tanpa_topik_email_opsional.sql --atomic
-- KLIEN: wizard Pendataan tanpa topik/catatan dan form walk-in dengan email opsional ditolak DB lama (TOPIK_WAJIB /
--   DATA_TIDAK_VALID email) -> terapkan migrasi ini SEBELUM atau BERSAMAAN dengan deploy klien. Klien lama tetap jalan.
-- Penanda: COMMENT ON FUNCTION layanan_selesai dan fo_mulai_kunjungan memuat '202610140015'.
-- Idempoten. Rollback: docs/rollback-pendataan-tanpa-topik-email-opsional-202610140015.sql.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF COALESCE(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.fo_mulai_kunjungan(text,text,text,text,text,text,uuid,uuid,uuid)'), 'pg_proc'), '')
       NOT LIKE '202610140014%'
     AND COALESCE(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.fo_mulai_kunjungan(text,text,text,text,text,text,uuid,uuid,uuid)'), 'pg_proc'), '')
       NOT LIKE '202610140015%' THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140014_walkin_data_lengkap belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.layanan_selesai(uuid,text,jsonb,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.pendataan_validasi_payload(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: layanan_selesai 5 argumen / pendataan_validasi_payload tidak ada (0005, 0011)';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'public.layanan'::regclass AND attname = 'form_pendataan' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140012_perbaikan_review belum diterapkan (layanan.form_pendataan)';
  END IF;
END $$;

-- ============================================================
-- 1. CHECK penanganan_status_konsisten: tahap 'layanan' selesai boleh tanpa topik
-- ============================================================
-- Sama dengan 202610140003 kecuali klausa topik (tambahan: OR peran_tahap = 'layanan'). Baris lama tetap sah.
ALTER TABLE public.penanganan DROP CONSTRAINT IF EXISTS penanganan_status_konsisten;
ALTER TABLE public.penanganan ADD CONSTRAINT penanganan_status_konsisten CHECK (
  (status = 'menunggu' AND penangan_id IS NULL AND mulai_at IS NULL AND selesai_at IS NULL
     AND hasil IS NULL AND batal_karena IS NULL)
  OR (status = 'berjalan' AND penangan_id IS NOT NULL AND mulai_at IS NOT NULL AND selesai_at IS NULL
     AND hasil IS NULL AND batal_karena IS NULL)
  OR (status = 'selesai' AND penangan_id IS NOT NULL AND mulai_at IS NOT NULL AND selesai_at IS NOT NULL
     AND hasil IS NOT NULL AND batal_karena IS NULL
     AND catatan IS NOT NULL AND btrim(catatan) <> ''
     AND (hasil = 'dikembalikan' OR peran_tahap = 'layanan' OR (topik IS NOT NULL AND btrim(topik) <> '')))
  OR (status = 'batal' AND selesai_at IS NOT NULL AND hasil IS NULL AND batal_karena IS NOT NULL)
);

-- ============================================================
-- 2. layanan_selesai: versi 202610140012 + topik/catatan opsional untuk layanan ber-Pendataan
-- ============================================================
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
  v_form_wajib text;
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

  -- Pendataan wajib per layanan (202610140012 #1): jenis form ditentukan DB (layanan.form_pendataan), bukan klien.
  -- Berlaku untuk SEMUA peran (Admin pengambil alih pun wajib form; keputusan CEO 2026-10-14). Tiket macet tanpa data
  -- ditutup otomatis oleh job tutup_penanganan_tertinggal 23:00 WIB (jalur otomatis, bukan lewat fungsi ini).
  SELECT l.form_pendataan INTO v_form_wajib FROM public.layanan AS l WHERE l.id = v_t.layanan_id;
  IF v_form_wajib IS NOT NULL AND p_form_type IS DISTINCT FROM v_form_wajib THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: layanan ini wajib Formulir Pendataan % (dikirim: %)',
      v_form_wajib, COALESCE(p_form_type, 'tanpa form') USING ERRCODE = '22023';
  END IF;

  -- Tahap penanganan (hanya tiket hasil eskalasi), divalidasi sebelum menulis apa pun.
  -- 202610140015: layanan TANPA Pendataan -> topik + catatan wajib (tidak berubah). Layanan ber-Pendataan -> topik dan
  -- catatan dari klien opsional (divalidasi bila dikirim); catatan kosong diturunkan dari Pendataan di bawah.
  SELECT p.id INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    IF v_form_wajib IS NULL THEN
      v_topik   := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
      v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
    ELSE
      IF p_topik_id IS NOT NULL THEN
        v_topik := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
      END IF;
      IF pg_catalog.btrim(COALESCE(p_catatan, '')) <> '' THEN
        v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
      END IF;
    END IF;
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
    -- 202610140015: catatan tahap layanan diturunkan dari Pendataan (payload sudah lolos pendataan_validasi_payload).
    IF v_catatan IS NULL THEN
      v_catatan := COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.left(pg_catalog.concat_ws(E'\n',
          'Tindak lanjut: ' || NULLIF(pg_catalog.btrim(p_payload->>'tindak_lanjut'), ''),
          NULLIF(NULLIF(pg_catalog.btrim(CASE p_form_type WHEN 'oss' THEN p_payload->>'uraian_solusi'
                                                          ELSE p_payload->>'catatan_petugas' END), ''), '-')),
        1000)), ''), '-');
    END IF;
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

COMMENT ON FUNCTION public.layanan_selesai(uuid, text, jsonb, uuid, text) IS
  '202610140015: layanan ber-Pendataan tanpa topik/catatan dari klien (topik NULL, catatan diturunkan dari Pendataan); layanan tanpa Pendataan tetap wajib topik + catatan.';

-- ============================================================
-- 3. fo_mulai_kunjungan: versi 202610140014 + email opsional
-- ============================================================
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
  v_nama     text := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_nama, ''), '[[:space:]]+', ' ', 'g'));
  v_instansi text := pg_catalog.regexp_replace(COALESCE(p_asal_instansi, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_hp       text := pg_catalog.regexp_replace(COALESCE(p_kontak_hp, ''), '[^0-9]', '', 'g');
  v_email    text := pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(p_email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  v_kep      text := pg_catalog.regexp_replace(COALESCE(p_keperluan, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_kat      text := pg_catalog.regexp_replace(COALESCE(p_kategori, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_ada      record;
  v_kid      uuid;
  v_pid      uuid;
  v_qr       text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  -- Idempotensi (klik ganda / replay offline), jalur cepat. Balapan serentak ditangani ON CONFLICT di INSERT.
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

  -- 202610140014: semua field wajib. Urutan pemeriksaan = urutan form (nama, asal, HP, kategori, email, keperluan).
  IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama wajib 3-100 karakter' USING ERRCODE = '22023', DETAIL = 'nama';
  END IF;
  IF v_nama !~ '^[[:alpha:]][[:alpha:] .,''’-]*$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama hanya boleh huruf, spasi, titik, koma, apostrof, dan tanda hubung (diawali huruf, tanpa angka)'
      USING ERRCODE = '22023', DETAIL = 'nama';
  END IF;
  IF pg_catalog.char_length(pg_catalog.regexp_replace(v_nama, '[^[:alpha:]]', '', 'g')) < 3 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama minimal 3 huruf' USING ERRCODE = '22023', DETAIL = 'nama';
  END IF;
  IF pg_catalog.char_length(v_instansi) NOT BETWEEN 3 AND 120
     OR pg_catalog.char_length(pg_catalog.regexp_replace(v_instansi, '[[:space:]]', '', 'g')) < 3 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: asal/instansi wajib 3-120 karakter (minimal 3 karakter selain spasi)'
      USING ERRCODE = '22023', DETAIL = 'asal_instansi';
  END IF;
  -- HP kanonik: non-digit sudah dibuang (DECLARE); awalan 62 (dari 62 / +62) -> 0.
  IF pg_catalog.left(v_hp, 2) = '62' THEN
    v_hp := '0' || pg_catalog.substr(v_hp, 3);
  END IF;
  IF v_hp !~ '^08[1-9][0-9]{7,10}$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nomor HP wajib, format 08xxxxxxxxxx (10-13 digit; +62/62 diterima)'
      USING ERRCODE = '22023', DETAIL = 'kontak_hp';
  END IF;
  IF v_kat NOT IN ('Umum', 'UMKM', 'Investor', 'Instansi') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: kategori wajib salah satu Umum, UMKM, Investor, Instansi'
      USING ERRCODE = '22023', DETAIL = 'kategori';
  END IF;
  -- 202610140015: email OPSIONAL (kosong -> NULL); bila diisi, aturan 0014 tetap berlaku.
  IF v_email <> '' AND (pg_catalog.char_length(v_email) > 254
     OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: email tidak valid (boleh dikosongkan; bila diisi format valid, maksimal 254 karakter)'
      USING ERRCODE = '22023', DETAIL = 'email';
  END IF;
  IF pg_catalog.char_length(v_kep) NOT BETWEEN 10 AND 500
     OR pg_catalog.char_length(pg_catalog.regexp_replace(v_kep, '[[:space:]]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan wajib 10-500 karakter (minimal 10 karakter selain spasi)'
      USING ERRCODE = '22023', DETAIL = 'keperluan';
  END IF;
  -- Layanan saran: NULL = "Belum tahu" (tetap diizinkan); bila diisi wajib layanan aktif.
  IF p_layanan_saran_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_saran_id AND l.aktif) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan saran tidak ada atau nonaktif' USING ERRCODE = '22023';
  END IF;
  IF p_pengunjung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pengunjung AS pg WHERE pg.id = p_pengunjung_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  -- #12: tautan ke akun pengunjung hanya bila relevan hari ini (punya kunjungan/reservasi/QR bertanggal hari ini WIB);
  -- UUID sembarang dari klien tidak bisa menempelkan kunjungan ke akun orang lain.
  IF p_pengunjung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS kx WHERE kx.pengunjung_id = p_pengunjung_id AND kx.tanggal = v_tgl) THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: pengunjung hanya dapat ditautkan bila punya kunjungan/reservasi hari ini'
      USING ERRCODE = '22023';
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
    v_instansi, v_kat, NULLIF(v_email, ''), v_kep, p_layanan_saran_id, p_client_request_id, v_me_id, v_now, v_now
  )
  ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_kid;

  IF v_kid IS NULL THEN
    -- Kalah balapan: permintaan serentak dengan client_request_id yang sama sudah tercatat (sudah COMMIT).
    SELECT k.id, k.dibuat_oleh, k.qr_token INTO v_ada FROM public.kunjungan AS k WHERE k.client_request_id = p_client_request_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DIVERGENSI: client_request_id bentrok tetapi kunjungan tidak terbaca' USING ERRCODE = 'P0001';
    END IF;
    IF v_ada.dibuat_oleh IS DISTINCT FROM v_me_id THEN
      RAISE EXCEPTION 'IDEMPOTENSI_BENTROK: client_request_id sudah dipakai staf lain' USING ERRCODE = 'P0001';
    END IF;
    SELECT p.id INTO v_pid FROM public.penanganan AS p WHERE p.kunjungan_id = v_ada.id AND p.tahap_ke = 1;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'sudah_ada', true, 'kunjungan_id', v_ada.id, 'penanganan_id', v_pid, 'qr_token', v_ada.qr_token);
  END IF;

  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, penangan_id, status, mulai_at, dibuat_oleh)
  VALUES (v_kid, 1, 'fo', 'walk_in', v_me_id, 'berjalan', v_now, v_me_id)
  RETURNING id INTO v_pid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_ada', false, 'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'qr_token', v_qr, 'mulai_at', v_now);
END $$;

COMMENT ON FUNCTION public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid) IS
  '202610140015: walk-in FO, field wajib (nama, asal/instansi, HP kanonik 08xxxxxxxxxx, kategori, keperluan); email OPSIONAL (NULL bila kosong, divalidasi bila diisi); layanan saran NULL = belum tahu.';
