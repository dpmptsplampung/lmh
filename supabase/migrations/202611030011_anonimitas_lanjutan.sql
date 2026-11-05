-- 202611030011_anonimitas_lanjutan.sql
-- Lanjutan hotfix 202611030010: bagian anonimitas yang bergantung pada migrasi yang
-- belum diterapkan di produksi (202611030006 pelapor_email + email "diterima",
-- 202611030008 kirim_saran_publik/kirim_pengaduan_publik, 202611010003 email_nyata).
-- DILARANG diterapkan otomatis. Urutan: SESUDAH 0010, 0006, dan 0008.
-- ROLLBACK: docs/rollback-anonimitas-lanjutan-202611030011.sql (sebelum rollback 0010).
--
-- Isi:
--   1. PEMBERSIHAN PERMANEN: saran publik tanpa nama (masuk lewat kirim_saran_publik 0008
--      sebelum berkas ini) ditandai anonim dan waktunya dibulatkan ke 00:00 WIB; pelapor_email
--      pada pengaduan anonim dikosongkan (seharusnya sudah kosong oleh trigger 0010).
--   2. CHECK pengaduan_anonim_tanpa_identitas kini juga mencakup pelapor_email.
--   3. kirim_pengaduan_survei final: versi 0006 (email "diterima" untuk non-anonim) tanpa
--      undangan_id untuk anonim; dedup cukup lewat flag di bawah kunci baris undangan.
--   4. kirim_saran_publik: nama kosong = anonim (saran.anonim = true). API tetap seperti 0008.
--   5. kirim_pengaduan_publik dicabut dari anon/authenticated (pemanggil satu-satunya
--      /api/pengaduan memakai service role).
-- Pembulatan waktu kiriman anonim baru tetap dilakukan trigger 0010 untuk semua jalur.

DO $$
DECLARE
  v_kolom text;
BEGIN
  IF pg_catalog.to_regprocedure('public.jaga_saran_anonim()') IS NULL
     OR pg_catalog.to_regprocedure('public.jaga_pengaduan_anonim()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202611030010 (trigger anonimitas) belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.email_nyata(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.queue_notifikasi(uuid, text, text, text, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: email_nyata / queue_notifikasi belum ada (202611010003)';
  END IF;
  IF pg_catalog.to_regprocedure('public.kirim_saran_publik(text, text)') IS NULL
     OR pg_catalog.to_regprocedure('public.kirim_pengaduan_publik(text, text, uuid, boolean, text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: RPC publik belum ada (202611030008)';
  END IF;
  IF pg_catalog.to_regprocedure('public.kirim_pengaduan_survei(text, text, boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.generate_nomor_laporan()') IS NULL
     OR pg_catalog.to_regprocedure('public.tambah_hari_kerja(date, integer)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: RPC pengaduan survei belum ada (202611030003/202607290007)';
  END IF;
  FOREACH v_kolom IN ARRAY ARRAY['saran.anonim', 'pengaduan.pelapor_email', 'site_settings.value'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.split_part(v_kolom, '.', 1))
        AND a.attname = pg_catalog.split_part(v_kolom, '.', 2)
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom public.% belum ada (202611030006/202611030010)', v_kolom;
    END IF;
  END LOOP;
END $$;

-- =====================================================================================
-- PERINGATAN: PEMBERSIHAN PERMANEN. TIDAK BISA DIBATALKAN oleh rollback.
-- Saran publik tanpa nama ditandai anonim dan jamnya dibulatkan ke 00:00 WIB.
-- trg_saran_anonim (0010) menolak perubahan penanda anonim, jadi dimatikan HANYA selama
-- satu UPDATE ini, di dalam transaksi atomik penerapan.
--
-- DIAGNOSTIK SEBELUM (jalankan manual saat dry-run, catat angkanya):
-- SELECT count(*) AS saran_publik_tanpa_nama FROM public.saran
--  WHERE sumber = 'publik' AND anonim = false AND pelapor_nama IS NULL;
-- SELECT count(*) AS pengaduan_anonim_beremail FROM public.pengaduan WHERE anonim AND pelapor_email IS NOT NULL;
--
-- DIAGNOSTIK SESUDAH (harus 0 semua):
-- SELECT count(*) FROM public.saran WHERE sumber = 'publik' AND anonim = false AND pelapor_nama IS NULL;
-- SELECT count(*) FROM public.saran WHERE anonim
--  AND created_at <> pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
-- SELECT count(*) FROM public.pengaduan WHERE anonim AND pelapor_email IS NOT NULL;
-- =====================================================================================
ALTER TABLE public.saran DISABLE TRIGGER trg_saran_anonim;
UPDATE public.saran
SET anonim = true,
    created_at = pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
WHERE sumber = 'publik' AND anonim = false AND pelapor_nama IS NULL
  AND undangan_id IS NULL AND kunjungan_id IS NULL;
ALTER TABLE public.saran ENABLE TRIGGER trg_saran_anonim;

UPDATE public.pengaduan SET pelapor_email = NULL WHERE anonim AND pelapor_email IS NOT NULL;
-- ============================ AKHIR PEMBERSIHAN PERMANEN ============================

ALTER TABLE public.pengaduan DROP CONSTRAINT IF EXISTS pengaduan_anonim_tanpa_identitas;
ALTER TABLE public.pengaduan ADD CONSTRAINT pengaduan_anonim_tanpa_identitas CHECK (
  NOT anonim OR (undangan_id IS NULL AND kunjungan_id IS NULL AND sesi_chat_id IS NULL
                AND kontak IS NULL AND pelapor_nama IS NULL AND pelapor_email IS NULL)
) NOT VALID;
ALTER TABLE public.pengaduan VALIDATE CONSTRAINT pengaduan_anonim_tanpa_identitas;

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
        CASE WHEN p_anonim THEN NULL ELSE v_u.id END,
        public.tambah_hari_kerja(v_hari, 3), public.tambah_hari_kerja(v_hari, 14)
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Hanya bentrok nomor yang dicoba ulang. Deduplikasi memakai flag undangan
      -- di bawah kunci baris, tanpa mencari atau menyimpan relasi pada baris anonim.
      IF v_coba >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  VALUES (v_id, NULL, 'baru', 'pengaduan diterima dari Pesan Perilaku');
  UPDATE public.survei_undangan SET pengaduan_dikirim = true WHERE id = v_u.id;
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

-- Nama kosong pada jalur publik berarti anonim; API tetap seperti 202611030008.
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
  INSERT INTO public.saran (isi, layanan_id, unit, kunjungan_id, undangan_id, pelapor_nama, sumber, anonim)
  VALUES (v_isi, NULL, 'tidak_diketahui', NULL, NULL, v_nama, 'publik', v_nama IS NULL);
  RETURN 'submitted';
END $$;
REVOKE ALL ON FUNCTION public.kirim_saran_publik(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran_publik(text, text) TO anon, authenticated;

-- P2-3: kirim_pengaduan_publik hanya dipanggil /api/pengaduan lewat service role
-- (src/app/api/pengaduan/route.ts). Panggilan anon langsung melewati rate limit route.
REVOKE ALL ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) TO service_role;
