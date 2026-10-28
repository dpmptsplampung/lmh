-- Rollback manual 202611030006. BUKAN migrasi. Menghapus tanggapan/lampiran pengaduan (data HILANG; objek R2 tidak dihapus) dan memulihkan kirim_pengaduan_survei versi 202611030003.
DROP FUNCTION IF EXISTS public.lampiran_pengaduan_nomor(text, uuid);
DROP FUNCTION IF EXISTS public.tanggapan_pengaduan_nomor(text);
DROP FUNCTION IF EXISTS public.tanggapi_pengaduan(uuid, text, text, boolean, jsonb);
DROP TABLE IF EXISTS public.pengaduan_lampiran;
DROP TABLE IF EXISTS public.pengaduan_tanggapan;
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
END $$;
REVOKE ALL ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) TO anon, authenticated;
ALTER TABLE public.pengaduan DROP COLUMN IF EXISTS pelapor_email;
