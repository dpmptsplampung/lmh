-- Rollback manual 202611030011_anonimitas_lanjutan.sql.
-- DILARANG diterapkan otomatis. Jalankan atomik: node scripts/apply-migration.mjs --atomic <berkas>
-- (TANPA BEGIN/COMMIT agar lolos --atomic dan --dry-run). Jalankan SEBELUM rollback 0010.
--
-- Memulihkan kirim_pengaduan_survei versi 202611030006, kirim_saran_publik versi
-- 202611030008, CHECK pengaduan versi 202611030010 (tanpa pelapor_email), dan hak
-- anon/authenticated pada kirim_pengaduan_publik. Trigger 0010 tetap mengosongkan identitas
-- kiriman anonim, tetapi mengembalikan versi lama ini membuka kembali celah pada
-- kirim_saran_publik (saran publik tanpa nama tidak lagi bertanda anonim).
--
-- Pembersihan 0011 TIDAK BISA DIBATALKAN: penanda anonim pada saran publik tanpa nama dan
-- jam created_at yang telah dibulatkan tetap seperti sesudah migrasi; pelapor_email yang
-- dikosongkan pada pengaduan anonim tidak dipulihkan.

-- kirim_pengaduan_survei: versi 202611030006 (persis).
CREATE OR REPLACE FUNCTION public.kirim_pengaduan_survei(p_token text, p_isi text, p_anonim boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u      public.survei_undangan%ROWTYPE;
  v_isi    text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama   text;
  v_email  text;
  v_publik text;
  v_nomor  text;
  v_id     uuid;
  v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_coba   int := 0;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(p_token) < 16 OR p_anonim IS NULL
     OR pg_catalog.char_length(v_isi) < 1 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN pg_catalog.jsonb_build_object('hasil', 'invalid');
  END IF;
  SELECT * INTO v_u FROM public.survei_undangan AS u WHERE u.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('hasil', 'not_found'); END IF;
  IF v_u.diisi_pada IS NULL THEN RETURN pg_catalog.jsonb_build_object('hasil', 'belum_survei'); END IF;
  IF v_u.pengaduan_dikirim THEN RETURN pg_catalog.jsonb_build_object('hasil', 'duplicate'); END IF;
  IF pg_catalog.now() >= GREATEST(v_u.kedaluwarsa_pada, v_u.diisi_pada + interval '30 minutes') THEN
    RETURN pg_catalog.jsonb_build_object('hasil', 'expired');
  END IF;

  IF NOT p_anonim THEN
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120), public.email_nyata(k.email) INTO v_nama, v_email FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  LOOP
    v_coba := v_coba + 1;
    v_nomor := public.generate_nomor_laporan();
    BEGIN
      INSERT INTO public.pengaduan (
        nomor_tiket, jalur, layanan_id, isi, kontak, anonim, sumber, kunjungan_id, pelapor_nama, pelapor_email, undangan_id,
        batas_verifikasi, batas_penanganan
      ) VALUES (
        v_nomor, 'layanan', v_u.layanan_id, v_isi, NULL, p_anonim, 'wizard',
        CASE WHEN p_anonim THEN NULL ELSE v_u.kunjungan_id END,
        CASE WHEN p_anonim THEN NULL ELSE NULLIF(v_nama, '') END,
        CASE WHEN p_anonim THEN NULL ELSE v_email END,
        v_u.id,
        public.tambah_hari_kerja(v_hari, 3), public.tambah_hari_kerja(v_hari, 14)
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Bentrok nomor: coba lagi. Bentrok undangan_id (kiriman bersamaan yang lolos kunci) = duplikat.
      IF EXISTS (SELECT 1 FROM public.pengaduan AS p WHERE p.undangan_id = v_u.id) THEN
        RETURN pg_catalog.jsonb_build_object('hasil', 'duplicate');
      END IF;
      IF v_coba >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  VALUES (v_id, NULL, 'baru', 'pengaduan diterima dari Pesan Perilaku');
  UPDATE public.survei_undangan SET pengaduan_dikirim = true WHERE id = v_u.id;
  -- Email "diterima" hanya bila tidak anonim dan ada email nyata.
  IF NOT p_anonim AND v_email IS NOT NULL THEN
    SELECT s.value INTO v_publik FROM public.site_settings AS s WHERE s.key = 'public_url';
    PERFORM public.queue_notifikasi(
      NULL, v_email, 'email',
      'Laporan Anda diterima - DPMPTSP Lampung',
      'Laporan Anda sudah kami terima dengan nomor ' || v_nomor || '. Pantau statusnya di '
        || COALESCE(v_publik, 'https://lmh.lampungprov.go.id') || '/pengaduan/lacak (masukkan nomor laporan).',
      pg_catalog.jsonb_build_object('type', 'pengaduan_diterima', 'pengaduan_id', v_id)
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('hasil', 'submitted', 'nomor', v_nomor);
END $$;

REVOKE ALL ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) TO anon, authenticated;

-- kirim_saran_publik: versi 202611030008 (persis).
CREATE OR REPLACE FUNCTION public.kirim_saran_publik(p_isi text, p_nama text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_isi  text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_nama, '')), 120), '');
BEGIN
  IF pg_catalog.char_length(v_isi) < 5 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN 'invalid';
  END IF;
  INSERT INTO public.saran (isi, layanan_id, unit, kunjungan_id, undangan_id, pelapor_nama, sumber)
  VALUES (v_isi, NULL, 'tidak_diketahui', NULL, NULL, v_nama, 'publik');
  RETURN 'submitted';
END $$;
REVOKE ALL ON FUNCTION public.kirim_saran_publik(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran_publik(text, text) TO anon, authenticated;

-- CHECK versi 202611030010.
ALTER TABLE public.pengaduan DROP CONSTRAINT IF EXISTS pengaduan_anonim_tanpa_identitas;
ALTER TABLE public.pengaduan ADD CONSTRAINT pengaduan_anonim_tanpa_identitas CHECK (
  NOT anonim OR (undangan_id IS NULL AND kunjungan_id IS NULL AND sesi_chat_id IS NULL
                AND kontak IS NULL AND pelapor_nama IS NULL)
) NOT VALID;
ALTER TABLE public.pengaduan VALIDATE CONSTRAINT pengaduan_anonim_tanpa_identitas;

-- Hak kirim_pengaduan_publik seperti 202611030008.
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) TO anon, authenticated;
