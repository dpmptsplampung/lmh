-- 202611030003_saran_pengaduan_pesan_perilaku.sql
-- PESAN PERILAKU, saran dan pengaduan (Fase B, bagian inti; spec docs/superpowers/specs/2026-10-26-survei-terpadu-design.md §4.4, §4.5, §5, §6):
-- sesudah survei terkirim, pengunjung boleh menyampaikan SARAN dan/atau PENGADUAN lewat token undangan yang sama, anonim bila mau.
-- Keputusan pemilik 2026-10-28: SKM lama dihapus; pembatasan laju per IP tidak ketat (dibatasi satu saran dan satu pengaduan per undangan).
-- ISI (aditif kecuali butir 7):
--   1. tabel saran (RLS: hanya admin/front_office membaca; tulis hanya lewat kirim_saran).
--   2. pengaduan: kolom sumber ('web'|'wizard'|'impor'), kunjungan_id, pelapor_nama, undangan_id (unik).
--   3. generate_nomor_laporan(): 'P' + 8 karakter dari alfabet 31 karakter (nomor laporan = satu-satunya kunci pantau).
--   4. kirim_saran(p_token, p_isi, p_anonim) -> text dan kirim_pengaduan_survei(p_token, p_isi, p_anonim) -> jsonb, anon, SECURITY DEFINER:
--      syarat survei SUDAH terkirim (diisi_pada), satu kali per undangan (saran_dikirim/pengaduan_dikirim, baris undangan dikunci FOR UPDATE),
--      berlaku sampai greatest(kedaluwarsa_pada, diisi_pada + 30 menit). Anonim: tanpa kunjungan_id dan nama.
--   5. lacak_pengaduan_nomor(p_nomor) -> status pengaduan sumber 'wizard' (hanya nomor, tanpa kontak).
--   6. ringkasan_saran(p_start, p_end) dan ringkasan_pengaduan(p_start, p_end): angka untuk grafik/cetak (admin dan front_office; jalur integritas hanya admin).
--   7. v_pengaduan_petugas tidak menampilkan sumber 'wizard' (petugas layanan tidak membaca pengaduan dari wizard).
--   8. SKM LAMA DIHENTIKAN: hak anon/authenticated pada submit_skm_response dan get_skm_context dicabut (halaman /skm sudah dihapus).
-- SYARAT: survei_undangan (202611020001), pengaduan (202607290007), v_pengaduan_petugas (202610090001), peran_saya().
-- ROLLBACK: docs/rollback-saran-pengaduan-pesan-perilaku-202611030003.sql.

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.survei_undangan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.survei_undangan belum ada (202611020001)';
  END IF;
  IF pg_catalog.to_regclass('public.pengaduan') IS NULL OR pg_catalog.to_regclass('public.v_pengaduan_petugas') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.pengaduan / v_pengaduan_petugas belum ada';
  END IF;
  IF pg_catalog.to_regprocedure('public.peran_saya()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.peran_saya() belum ada (202610090001)';
  END IF;
END $$;

-- ============================================================
-- 1. saran
-- ============================================================
CREATE TABLE IF NOT EXISTS public.saran (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  isi           text NOT NULL CHECK (pg_catalog.char_length(isi) BETWEEN 1 AND 2000),
  layanan_id    uuid REFERENCES public.layanan(id) ON DELETE SET NULL,
  unit          text NOT NULL DEFAULT 'tidak_diketahui' CHECK (unit IN ('layanan', 'fo', 'tidak_diketahui')),
  kunjungan_id  uuid REFERENCES public.kunjungan(id) ON DELETE SET NULL,
  undangan_id   uuid UNIQUE REFERENCES public.survei_undangan(id) ON DELETE SET NULL,
  pelapor_nama  text CHECK (pelapor_nama IS NULL OR pg_catalog.char_length(pelapor_nama) <= 120),
  sumber        text NOT NULL DEFAULT 'wizard' CHECK (sumber IN ('wizard', 'impor')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saran_created_at ON public.saran (created_at DESC);
ALTER TABLE public.saran ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.saran FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.saran TO authenticated;
DROP POLICY IF EXISTS saran_select_staf ON public.saran;
CREATE POLICY saran_select_staf ON public.saran FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office'));

-- ============================================================
-- 2. pengaduan diperluas
-- ============================================================
ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS sumber text NOT NULL DEFAULT 'web';
ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE SET NULL;
ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS pelapor_nama text;
ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS undangan_id uuid REFERENCES public.survei_undangan(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'pengaduan_sumber_check' AND conrelid = 'public.pengaduan'::regclass) THEN
    ALTER TABLE public.pengaduan ADD CONSTRAINT pengaduan_sumber_check CHECK (sumber IN ('web', 'wizard', 'impor'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS pengaduan_undangan_unik ON public.pengaduan (undangan_id) WHERE undangan_id IS NOT NULL;

-- ============================================================
-- 3. nomor laporan 8 karakter
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_nomor_laporan()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  chars  CONSTANT text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := 'P';
  i int;
BEGIN
  FOR i IN 1..8 LOOP
    result := result || pg_catalog.substr(chars, pg_catalog.floor(pg_catalog.random() * pg_catalog.length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.generate_nomor_laporan() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4a. kirim_saran
-- ============================================================
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

-- ============================================================
-- 4b. kirim_pengaduan_survei
-- ============================================================
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

-- ============================================================
-- 5. lacak dengan nomor laporan (pengaduan dari Pesan Perilaku)
-- ============================================================
CREATE OR REPLACE FUNCTION public.lacak_pengaduan_nomor(p_nomor text)
RETURNS TABLE (nomor_tiket text, status text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.nomor_tiket, p.status, p.created_at, p.updated_at
  FROM public.pengaduan AS p
  WHERE p.sumber = 'wizard'
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.lacak_pengaduan_nomor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lacak_pengaduan_nomor(text) TO anon, authenticated;

-- ============================================================
-- 6. ringkasan angka (grafik dan cetak)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ringkasan_saran(p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, unit text, nama text, jumlah integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE WHEN s.unit = 'fo' THEN NULL::uuid ELSE s.layanan_id END,
         CASE WHEN s.unit = 'fo' THEN 'fo' WHEN s.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END,
         CASE WHEN s.unit = 'fo' THEN 'Front Office' WHEN s.layanan_id IS NOT NULL THEN l.nama ELSE 'Tidak terklasifikasi' END,
         pg_catalog.count(*)::integer
  FROM public.saran AS s
  LEFT JOIN public.layanan AS l ON l.id = s.layanan_id
  WHERE (SELECT public.peran_saya()) IN ('admin', 'front_office')
    AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_start AND p_end
  GROUP BY 1, 2, 3
  ORDER BY 4 DESC, 3
$$;
REVOKE ALL ON FUNCTION public.ringkasan_saran(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringkasan_saran(date, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.ringkasan_pengaduan(p_start date, p_end date)
RETURNS TABLE (jalur text, sumber text, status text, jumlah integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.jalur, p.sumber, p.status, pg_catalog.count(*)::integer
  FROM public.pengaduan AS p
  WHERE ((SELECT public.peran_saya()) = 'admin' OR ((SELECT public.peran_saya()) = 'front_office' AND p.jalur = 'layanan'))
    AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_start AND p_end
  GROUP BY p.jalur, p.sumber, p.status
  ORDER BY p.jalur, p.sumber, p.status
$$;
REVOKE ALL ON FUNCTION public.ringkasan_pengaduan(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringkasan_pengaduan(date, date) TO authenticated;

-- ============================================================
-- 7. petugas layanan tidak membaca pengaduan dari Pesan Perilaku
-- ============================================================
CREATE OR REPLACE VIEW public.v_pengaduan_petugas AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, g.isi, g.anonim, g.status,
       g.batas_verifikasi, g.batas_penanganan, g.created_at, g.updated_at
FROM public.pengaduan AS g
WHERE g.jalur = 'layanan' AND g.sumber <> 'wizard' AND public.peran_saya() = 'petugas' AND public.boleh_layanan(g.layanan_id);

-- ============================================================
-- 8. SKM lama dihentikan (hak anon dicabut; fungsi dibiarkan agar data dan rollback utuh)
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.submit_skm_response(text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.submit_skm_response(text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
  END IF;
  IF pg_catalog.to_regprocedure('public.get_skm_context(text)') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.get_skm_context(text) FROM PUBLIC, anon, authenticated;
  END IF;
END $$;
