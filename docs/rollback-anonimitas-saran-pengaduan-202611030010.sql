-- Rollback manual 202611030010_anonimitas_saran_pengaduan.sql (HOTFIX).
-- DILARANG diterapkan otomatis. Jalankan atomik: node scripts/apply-migration.mjs --atomic <berkas>
-- (berkas ini sengaja TANPA BEGIN/COMMIT agar lolos --atomic dan --dry-run).
-- Urutan: rollback 202611030011 lebih dulu (penjaga di bawah menolak bila masih terpasang).
--
-- Memulihkan kirim_saran versi 202611030003 dan kirim_pengaduan_survei versi 202611030006
-- (bila kolom pengaduan.pelapor_email sudah ada) atau 202611030003 (bila belum), serta hak
-- anon/authenticated pada buat_pengaduan. Ini membuka kembali celah tautan identitas pada
-- kiriman anonim; perlu persetujuan pemilik.
--
-- Pembersihan identitas dan pembulatan waktu kiriman anonim TIDAK BISA DIBATALKAN:
-- undangan_id, kunjungan_id, sesi_chat_id, kontak, pelapor_nama, pelapor_email, dan jam
-- created_at/updated_at/riwayat awal yang telah dikosongkan atau dibulatkan hilang permanen.
-- Rollback tidak menebak identitas, tidak memulihkan data dari audit/backup/log, tidak
-- mengubah flag dedup undangan atau jawaban SKM/SPAK. Saran yang ditandai anonim kehilangan
-- penandanya saat kolom dihapus, tetapi tautannya tetap NULL.
-- Jalankan hanya setelah menghentikan penerimaan kiriman melalui prosedur operasional.

-- PRASYARAT ROLLBACK: 202611030011 (CHECK dengan pelapor_email, kirim_saran_publik yang
-- menulis saran.anonim) harus sudah di-rollback; tanpa itu menghapus saran.anonim
-- mematahkan kirim_saran_publik.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = pg_catalog.to_regclass('public.pengaduan')
      AND c.conname = 'pengaduan_anonim_tanpa_identitas'
      AND pg_catalog.pg_get_constraintdef(c.oid) LIKE '%pelapor_email%'
  ) THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: 202611030011 masih terpasang; jalankan docs/rollback-anonimitas-lanjutan-202611030011.sql dahulu';
  END IF;
END $$;

-- kirim_saran: versi 202611030003 (persis).
CREATE OR REPLACE FUNCTION public.kirim_saran(p_token text, p_isi text, p_anonim boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u    public.survei_undangan%ROWTYPE;
  v_isi  text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama text;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(p_token) < 16 OR p_anonim IS NULL
     OR pg_catalog.char_length(v_isi) < 1 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN 'invalid';
  END IF;
  SELECT * INTO v_u FROM public.survei_undangan AS u WHERE u.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_u.diisi_pada IS NULL THEN RETURN 'belum_survei'; END IF;
  IF v_u.saran_dikirim THEN RETURN 'duplicate'; END IF;
  IF pg_catalog.now() >= GREATEST(v_u.kedaluwarsa_pada, v_u.diisi_pada + interval '30 minutes') THEN RETURN 'expired'; END IF;

  IF NOT p_anonim THEN
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120) INTO v_nama FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  INSERT INTO public.saran (isi, layanan_id, unit, kunjungan_id, undangan_id, pelapor_nama, sumber)
  VALUES (v_isi, v_u.layanan_id, v_u.unit, CASE WHEN p_anonim THEN NULL ELSE v_u.kunjungan_id END, v_u.id,
          CASE WHEN p_anonim THEN NULL ELSE NULLIF(v_nama, '') END, 'wizard');
  UPDATE public.survei_undangan SET saran_dikirim = true WHERE id = v_u.id;
  RETURN 'submitted';
END $$;
REVOKE ALL ON FUNCTION public.kirim_saran(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran(text, text, boolean) TO anon, authenticated;

-- kirim_pengaduan_survei: versi 202611030006 bila pelapor_email ada, selain itu 202611030003 (persis).
DO $do$
BEGIN
  IF pg_catalog.to_regclass('public.pengaduan') IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.to_regclass('public.pengaduan') AND a.attname = 'pelapor_email'
      AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    EXECUTE $ddl$
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
END $$
$ddl$;
  ELSE
    EXECUTE $ddl$
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
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120) INTO v_nama FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  LOOP
    v_coba := v_coba + 1;
    v_nomor := public.generate_nomor_laporan();
    BEGIN
      INSERT INTO public.pengaduan (
        nomor_tiket, jalur, layanan_id, isi, kontak, anonim, sumber, kunjungan_id, pelapor_nama, undangan_id,
        batas_verifikasi, batas_penanganan
      ) VALUES (
        v_nomor, 'layanan', v_u.layanan_id, v_isi, NULL, p_anonim, 'wizard',
        CASE WHEN p_anonim THEN NULL ELSE v_u.kunjungan_id END,
        CASE WHEN p_anonim THEN NULL ELSE NULLIF(v_nama, '') END,
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
  RETURN pg_catalog.jsonb_build_object('hasil', 'submitted', 'nomor', v_nomor);
END $$
$ddl$;
  END IF;
END $do$;
REVOKE ALL ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) TO anon, authenticated;

-- Hak buat_pengaduan seperti 202607290007 (membuka kembali panggilan anon langsung).
GRANT EXECUTE ON FUNCTION public.buat_pengaduan(text, text, text, uuid, boolean, uuid) TO anon, authenticated;

DROP TRIGGER IF EXISTS trg_saran_anonim ON public.saran;
DROP TRIGGER IF EXISTS trg_pengaduan_anonim ON public.pengaduan;
DROP TRIGGER IF EXISTS trg_riwayat_pengaduan_anonim ON public.pengaduan_riwayat;
ALTER TABLE public.saran DROP CONSTRAINT IF EXISTS saran_anonim_tanpa_identitas;
ALTER TABLE public.pengaduan DROP CONSTRAINT IF EXISTS pengaduan_anonim_tanpa_identitas;
DROP FUNCTION IF EXISTS public.jaga_saran_anonim();
DROP FUNCTION IF EXISTS public.jaga_pengaduan_anonim();
DROP FUNCTION IF EXISTS public.jaga_riwayat_pengaduan_anonim();
ALTER TABLE public.saran DROP COLUMN IF EXISTS anonim;
