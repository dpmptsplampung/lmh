-- 202610140011_pendataan_wajib.sql
-- Tahap C3 (keputusan CEO G.5): SEMUA field Pendataan Pelayanan (pelayanan_oss / pelayanan_perizinan) WAJIB terisi saat
-- layanan diselesaikan. Field usaha yang memang tidak ada diisi eksplisit "Belum ada" / "Tidak berlaku"; kolom catatan
-- boleh "-". Zod (src/lib/types/pelayanan.ts) dan UI (PelayananWizardModal) menegakkan hal yang sama; migrasi ini
-- menegakkan di DB agar klien lama / panggilan RPC langsung tidak dapat menyelesaikan tiket dengan data bolong.
--
-- ISI
--   0. Penjaga prasyarat: 202610140007 sudah diterapkan (layanan_selesai versi tanpa visit; bila migrasi ini jalan lebih
--      dulu, 0007 akan menimpa fungsi dan validasi hilang diam-diam).
--   1. CHECK tipe_pelaku_usaha dan skala_usaha pada pelayanan_oss DILONGGARKAN (superset): tambah 'tidak_berlaku' /
--      'Tidak berlaku' agar pemohon tanpa usaha tidak terpaksa memilih nilai yang salah. status_penanaman_modal sudah
--      punya 'tidak_ada'. Data lama tetap valid (hanya menambah nilai yang diizinkan).
--   2. pendataan_validasi_payload(form, payload) BARU (invoker, tanpa hak publik): menolak dengan INVALID_PAYLOAD (22023)
--      bila ada field wajib yang hilang / bukan teks / kosong (spasi saja), atau nilai pilihan di luar daftar.
--        oss       : nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal, nama_usaha, tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha, skala_usaha, sektor_usaha_kbli, tindak_lanjut, uraian_solusi, catatan_internal
--        perizinan : nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal, nama_perusahaan, lokasi_usaha, opd_teknis, uraian_permohonan, tindak_lanjut, catatan_petugas
--      Payload dinilai APA ADANYA (tidak digabung dengan draf yang sudah ada): klien (route /api/admin/pelayanan POST)
--      selalu mengirim seluruh formulir.
--   3. layanan_selesai(uuid, text, jsonb, uuid, text) = salinan PERSIS versi 202610140007 (tanpa visit; signature, urutan
--      kunci kunjungan -> tiket -> penanganan, semua kode galat, hasil jsonb, grant tidak berubah) ditambah SATU
--      pemanggilan pendataan_validasi_payload di tiap cabang form, SESUDAH pemeriksaan LOCKED dan SEBELUM menulis apa pun.
--      p_form_type NULL (tiket tanpa form pendataan) tidak divalidasi.
-- TIDAK berubah: draf (PATCH/autosave) tetap longgar; koreksi_pelayanan (data terkunci, 202610090001); data lama tidak
-- divalidasi ulang dan tidak dikunci (validasi hanya pada penyelesaian BARU). Draf lama yang belum lengkap tetap bisa
-- dilanjutkan, tetapi baru dapat diselesaikan setelah semua field terisi.
-- KLIEN: halaman admin (PelayananWizardModal) dan route POST harus dideploy bersama; klien lama yang mengirim isian
-- bolong mendapat INVALID_PAYLOAD (HTTP 422).
-- SYARAT: 202610140007. PENERAPAN (hanya setelah konfirmasi CEO; urutan cutover 0002..0008 -> 0011):
--   node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic
-- Idempoten. Rollback: docs/rollback-pendataan-wajib-202610140011.sql.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.visit_arsip_jaga()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140007_wp24_akhiri_dual_write belum diterapkan (layanan_selesai versi tanpa visit)';
  END IF;
  IF pg_catalog.to_regprocedure('public.layanan_selesai(uuid,text,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: layanan_selesai 5-argumen belum ada';
  END IF;
END $$;

-- ============================================================
-- 1. CHECK pilihan dilonggarkan: opsi eksplisit "tidak berlaku"
-- ============================================================
DO $$
DECLARE
  v_nama text;
BEGIN
  FOR v_nama IN
    SELECT c.conname::text FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.pelayanan_oss'::regclass AND c.contype = 'c'
      AND (pg_catalog.pg_get_constraintdef(c.oid) LIKE '%tipe_pelaku_usaha%'
           OR pg_catalog.pg_get_constraintdef(c.oid) LIKE '%skala_usaha%')
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.pelayanan_oss DROP CONSTRAINT %I', v_nama);
  END LOOP;
END $$;

ALTER TABLE public.pelayanan_oss
  ADD CONSTRAINT pelayanan_oss_tipe_pelaku_usaha_check
  CHECK (tipe_pelaku_usaha IS NULL OR tipe_pelaku_usaha IN ('perseorangan', 'non_perseorangan', 'tidak_berlaku'));
ALTER TABLE public.pelayanan_oss
  ADD CONSTRAINT pelayanan_oss_skala_usaha_check
  CHECK (skala_usaha IS NULL OR skala_usaha IN ('Mikro', 'Kecil', 'Menengah', 'Besar', 'Tidak berlaku'));

-- ============================================================
-- 2. pendataan_validasi_payload
-- ============================================================
CREATE OR REPLACE FUNCTION public.pendataan_validasi_payload(p_form_type text, p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_wajib  text[];
  v_kunci  text;
  v_nilai  jsonb;
  v_kurang text[] := ARRAY[]::text[];
  v_salah  text[] := ARRAY[]::text[];
BEGIN
  IF p_form_type = 'oss' THEN
    v_wajib := ARRAY['nama_pemohon', 'alamat_pemohon', 'no_hp', 'email', 'keperluan_awal', 'nama_usaha', 'tipe_pelaku_usaha', 'status_penanaman_modal', 'lokasi_usaha', 'skala_usaha', 'sektor_usaha_kbli', 'tindak_lanjut', 'uraian_solusi', 'catatan_internal'];
  ELSIF p_form_type = 'perizinan' THEN
    v_wajib := ARRAY['nama_pemohon', 'alamat_pemohon', 'no_hp', 'email', 'keperluan_awal', 'nama_perusahaan', 'lokasi_usaha', 'opd_teknis', 'uraian_permohonan', 'tindak_lanjut', 'catatan_petugas'];
  ELSE
    RETURN;
  END IF;

  IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: payload pendataan wajib berupa objek berisi semua field' USING ERRCODE = '22023';
  END IF;

  FOREACH v_kunci IN ARRAY v_wajib LOOP
    v_nilai := p_payload -> v_kunci;
    IF v_nilai IS NULL
       OR pg_catalog.jsonb_typeof(v_nilai) <> 'string'
       OR pg_catalog.btrim(v_nilai #>> '{}', E' \t\r\n') = '' THEN
      v_kurang := pg_catalog.array_append(v_kurang, v_kunci);
    END IF;
  END LOOP;
  IF pg_catalog.cardinality(v_kurang) > 0 THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: field wajib belum lengkap: %', pg_catalog.array_to_string(v_kurang, ', ')
      USING ERRCODE = '22023';
  END IF;

  IF p_form_type = 'oss' THEN
    IF (p_payload ->> 'tipe_pelaku_usaha') NOT IN ('perseorangan', 'non_perseorangan', 'tidak_berlaku') THEN
      v_salah := pg_catalog.array_append(v_salah, 'tipe_pelaku_usaha');
    END IF;
    IF (p_payload ->> 'status_penanaman_modal') NOT IN ('PMDN', 'PMA', 'tidak_ada') THEN
      v_salah := pg_catalog.array_append(v_salah, 'status_penanaman_modal');
    END IF;
    IF (p_payload ->> 'skala_usaha') NOT IN ('Mikro', 'Kecil', 'Menengah', 'Besar', 'Tidak berlaku') THEN
      v_salah := pg_catalog.array_append(v_salah, 'skala_usaha');
    END IF;
    IF pg_catalog.cardinality(v_salah) > 0 THEN
      RAISE EXCEPTION 'INVALID_PAYLOAD: nilai pilihan tidak dikenal: %', pg_catalog.array_to_string(v_salah, ', ')
        USING ERRCODE = '22023';
    END IF;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.pendataan_validasi_payload(text, jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. layanan_selesai: salinan PERSIS 202610140007 + validasi pendataan
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
