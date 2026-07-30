-- 202607290007_pengaduan.sql
-- WP-12 / CMP-01..08: kanal pengaduan dua jalur (UU 25/2009).
--
-- Jalur INTEGRITAS adalah yang paling kritikal: HANYA Admin yang boleh membaca
-- (BUKAN petugas, BUKAN FO) — I-15, wajib diuji perilaku (SEC-04).
-- ADITIF.

-- ============================================================
-- 0. Tabel hari libur (CMP-03 / OQ-05): input manual oleh Admin.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.hari_libur (
  tanggal    date PRIMARY KEY,
  keterangan text NOT NULL
);
ALTER TABLE public.hari_libur ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hari_libur_public_read ON public.hari_libur;
CREATE POLICY hari_libur_public_read ON public.hari_libur FOR SELECT USING (true);
DROP POLICY IF EXISTS hari_libur_admin_write ON public.hari_libur;
CREATE POLICY hari_libur_admin_write ON public.hari_libur FOR ALL
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');

-- ============================================================
-- 1. Fungsi hari kerja (Sabtu, Minggu, hari libur nasional dikecualikan).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tambah_hari_kerja(p_mulai date, p_hari int)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v date := p_mulai;
  v_added int := 0;
BEGIN
  WHILE v_added < p_hari LOOP
    v := v + 1;
    IF EXTRACT(ISODOW FROM v) NOT IN (6,7)
       AND NOT EXISTS (SELECT 1 FROM public.hari_libur hl WHERE hl.tanggal = v) THEN
      v_added := v_added + 1;
    END IF;
  END LOOP;
  RETURN v;
END $$;

-- ============================================================
-- 2. Generator nomor tiket pengaduan: 'P' + 6 karakter acak (OQ-07).
--    BUKAN berurutan — agar tidak bisa ditebak (CMP-05).
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_nomor_tiket()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- tanpa karakter ambigu (I,O,0,1)
  result text := 'P';
  i int;
BEGIN
  FOR i IN 1..6 LOOP
    result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN result;
END $$;

-- ============================================================
-- 3. Tabel pengaduan.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pengaduan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor_tiket     text NOT NULL UNIQUE DEFAULT public.generate_nomor_tiket(),
  jalur           text NOT NULL CHECK (jalur IN ('layanan','integritas')),  -- CMP-06
  layanan_id      uuid REFERENCES public.layanan(id) ON DELETE SET NULL,
  isi             text NOT NULL,
  kontak          text,                    -- untuk pelacakan tanpa login (CMP-05)
  anonim          boolean NOT NULL DEFAULT false,
  sesi_chat_id    uuid REFERENCES public.chat_sesi(id) ON DELETE SET NULL,  -- CMP-08
  status          text NOT NULL DEFAULT 'baru'
        CHECK (status IN ('baru','diverifikasi','diproses','eskalasi','selesai','ditolak')),
  batas_verifikasi  date NOT NULL,
  batas_penanganan  date NOT NULL,
  diteruskan_ke   uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  lampiran_path   text,                    -- bucket PRIVAT pengaduan-bukti (CMP-07)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pengaduan_tiket   ON public.pengaduan(nomor_tiket);
CREATE INDEX IF NOT EXISTS idx_pengaduan_status  ON public.pengaduan(status, batas_penanganan);
CREATE INDEX IF NOT EXISTS idx_pengaduan_jalur   ON public.pengaduan(jalur);

CREATE TABLE IF NOT EXISTS public.pengaduan_riwayat (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengaduan_id uuid NOT NULL REFERENCES public.pengaduan(id) ON DELETE CASCADE,
  status_lama text,
  status_baru text NOT NULL,
  catatan     text,
  diubah_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pengaduan_riwayat ON public.pengaduan_riwayat(pengaduan_id);

-- ============================================================
-- 4. Fungsi buat pengaduan (publik, tanpa login) — hitung SLA hari kerja.
-- ============================================================
CREATE OR REPLACE FUNCTION public.buat_pengaduan(
  p_jalur      text,
  p_isi        text,
  p_kontak     text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL,
  p_anonim     boolean DEFAULT false,
  p_sesi_chat_id uuid DEFAULT NULL
)
RETURNS TABLE (id uuid, nomor_tiket text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_tiket text;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_jalur NOT IN ('layanan','integritas') THEN
    RAISE EXCEPTION 'jalur tidak valid';
  END IF;
  IF p_isi IS NULL OR btrim(p_isi) = '' THEN
    RAISE EXCEPTION 'isi pengaduan wajib diisi';
  END IF;
  -- Pelacakan butuh kontak bila tidak anonim.
  IF NOT p_anonim AND (p_kontak IS NULL OR btrim(p_kontak) = '') THEN
    RAISE EXCEPTION 'kontak diperlukan untuk pelacakan (atau pilih anonim)';
  END IF;

  INSERT INTO public.pengaduan (
    jalur, isi, kontak, layanan_id, anonim, sesi_chat_id,
    batas_verifikasi, batas_penanganan
  ) VALUES (
    p_jalur, btrim(p_isi), NULLIF(btrim(COALESCE(p_kontak,'')) ,''), p_layanan_id, p_anonim, p_sesi_chat_id,
    public.tambah_hari_kerja(v_today, 3),   -- CMP-03: verifikasi 3 hari kerja
    public.tambah_hari_kerja(v_today, 14)   -- CMP-03: penanganan 14 hari kerja
  )
  RETURNING pengaduan.id, pengaduan.nomor_tiket INTO v_id, v_tiket;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  VALUES (v_id, NULL, 'baru', 'pengaduan diterima sistem');

  RETURN QUERY SELECT v_id, v_tiket;
END $$;

REVOKE ALL ON FUNCTION public.buat_pengaduan(text,text,text,uuid,boolean,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buat_pengaduan(text,text,text,uuid,boolean,uuid) TO anon, authenticated;

-- ============================================================
-- 5. Fungsi lacak pengaduan tanpa login (tiket + kontak). Rate limit di route.
-- ============================================================
CREATE OR REPLACE FUNCTION public.lacak_pengaduan(p_tiket text, p_kontak text)
RETURNS TABLE (nomor_tiket text, jalur text, status text, created_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.nomor_tiket, p.jalur, p.status, p.created_at
  FROM public.pengaduan p
  WHERE p.nomor_tiket = btrim(p_tiket)
    AND p.kontak IS NOT NULL
    AND p.kontak = btrim(p_kontak)
  LIMIT 1;
END $$;

REVOKE ALL ON FUNCTION public.lacak_pengaduan(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lacak_pengaduan(text, text) TO anon, authenticated;

-- ============================================================
-- 6. Fungsi eskalasi SLA (CMP-04): naik ke Admin bila batas terlampaui.
-- ============================================================
CREATE OR REPLACE FUNCTION public.eskalasi_pengaduan_lewat_batas()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count int;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  UPDATE public.pengaduan p
  SET status = 'eskalasi', updated_at = now()
  WHERE p.status IN ('baru','diverifikasi','diproses')
    AND p.batas_penanganan < v_today;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  SELECT p.id, 'diproses', 'eskalasi', 'batas waktu terlampaui — naik ke Admin/pimpinan'
  FROM public.pengaduan p
  WHERE p.status = 'eskalasi' AND p.batas_penanganan < v_today
    AND NOT EXISTS (
      SELECT 1 FROM public.pengaduan_riwayat r
      WHERE r.pengaduan_id = p.id AND r.status_baru = 'eskalasi'
    );

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.eskalasi_pengaduan_lewat_batas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eskalasi_pengaduan_lewat_batas() TO service_role;

-- Cron eskalasi tiap jam.
SELECT cron.schedule(
  'pengaduan_eskalasi',
  '0 * * * *',
  $$SELECT public.eskalasi_pengaduan_lewat_batas()$$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pengaduan_eskalasi');

-- ============================================================
-- 7. RLS — DUA JALUR TERPISAH (CMP-06 / I-15).
-- ============================================================
ALTER TABLE public.pengaduan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengaduan_riwayat ENABLE ROW LEVEL SECURITY;

-- INSERT langsung dilarang (pakai fungsi buat_pengaduan).
DROP POLICY IF EXISTS pengaduan_deny_insert ON public.pengaduan;
CREATE POLICY pengaduan_deny_insert ON public.pengaduan FOR INSERT WITH CHECK (false);

-- Jalur LAYANAN: Admin, FO, petugas layanan terkait boleh membaca.
DROP POLICY IF EXISTS pengaduan_layanan_read ON public.pengaduan;
CREATE POLICY pengaduan_layanan_read ON public.pengaduan FOR SELECT
  USING (jalur = 'layanan' AND (
    public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id()
  ));

-- Jalur INTEGRITAS: HANYA Admin (BUKAN petugas, BUKAN FO) — I-15.
DROP POLICY IF EXISTS pengaduan_integritas_admin_only ON public.pengaduan;
CREATE POLICY pengaduan_integritas_admin_only ON public.pengaduan FOR SELECT
  USING (jalur = 'integritas' AND public.get_my_role() = 'admin');

-- UPDATE status: Admin (semua jalur) & FO (hanya jalur layanan).
DROP POLICY IF EXISTS pengaduan_update ON public.pengaduan;
CREATE POLICY pengaduan_update ON public.pengaduan FOR UPDATE
  USING (public.get_my_role() = 'admin' OR (jalur = 'layanan' AND public.get_my_role() = 'front_office'))
  WITH CHECK (public.get_my_role() = 'admin' OR (jalur = 'layanan' AND public.get_my_role() = 'front_office'));

-- Riwayat: ikuti visibilitas induk pengaduannya.
DROP POLICY IF EXISTS pengaduan_riwayat_read ON public.pengaduan_riwayat;
CREATE POLICY pengaduan_riwayat_read ON public.pengaduan_riwayat FOR SELECT
  USING (pengaduan_id IN (SELECT id FROM public.pengaduan));
DROP POLICY IF EXISTS pengaduan_riwayat_write ON public.pengaduan_riwayat;
CREATE POLICY pengaduan_riwayat_write ON public.pengaduan_riwayat FOR INSERT
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

-- ============================================================
-- 8. Bucket PRIVAT untuk lampiran bukti (CMP-07). JANGAN pakai umkm-photos (publik).
-- ============================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('pengaduan-bukti', 'pengaduan-bukti', false)
ON CONFLICT (id) DO NOTHING;
