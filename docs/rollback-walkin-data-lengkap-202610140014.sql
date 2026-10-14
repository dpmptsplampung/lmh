-- docs/rollback-walkin-data-lengkap-202610140014.sql
-- Rollback manual migrasi 202610140014_walkin_data_lengkap.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan
-- CEO, ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-walkin-data-lengkap-202610140014.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-walkin-data-lengkap-202610140014.sql --atomic
-- URUTAN: rollback ini PERTAMA (sebelum rollback 202610140013, 202610140012, ...). Rollback 0012 juga mengganti
-- fo_mulai_kunjungan (ke versi 0004); jalankan rollback ini lebih dulu agar setiap langkah memulihkan versi tepat
-- sebelumnya.
--
-- Yang dikembalikan: fo_mulai_kunjungan <- 202610140012_perbaikan_review.sql (PERSIS, diuji walkin_data_lengkap.test.ts);
-- hak tidak diubah oleh 0014 (CREATE OR REPLACE mempertahankan ACL), jadi tidak ada GRANT/REVOKE di sini; komentar
-- fungsi dihapus (versi 0012 tidak berkomentar). Setelah rollback: HP/kategori/email/keperluan kembali opsional, nama
-- 3-120, asal 2-200, HP disimpan apa adanya (hanya spasi/strip dibuang).
-- TIDAK dikembalikan (data, sengaja): kunjungan yang tercatat selama 0014 terpasang tetap memakai HP kanonik
-- 08xxxxxxxxxx dan nama yang spasinya dirapatkan (bentuk yang tetap sah menurut versi 0012).
-- KLIEN: halaman /admin/fo/daftar yang mewajibkan semua field tetap berjalan (validasi klien lebih ketat dari DB).
-- Idempoten (CREATE OR REPLACE / COMMENT).

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.fo_mulai_kunjungan(text,text,text,text,text,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: fo_mulai_kunjungan tidak ada (keadaan tak terduga)';
  END IF;
  IF pg_catalog.to_regprocedure('public.hari_tanpa_layanan(date)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140012 tidak terpasang (keadaan tak terduga; versi yang dipulihkan adalah versi 0012)';
  END IF;
  IF pg_catalog.to_regprocedure('public.staf_wajib_sesi(text[])') IS NULL
     OR pg_catalog.to_regprocedure('public.layanan_sudah_tutup(timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: staf_wajib_sesi / layanan_sudah_tutup tidak ada (dipakai versi 0012)';
  END IF;
END $$;

-- fo_mulai_kunjungan <- 202610140012_perbaikan_review.sql (persis)
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
    v_instansi, v_kat, v_email, v_kep, p_layanan_saran_id, p_client_request_id, v_me_id, v_now, v_now
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

COMMENT ON FUNCTION public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid) IS NULL;
