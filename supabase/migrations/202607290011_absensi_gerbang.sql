-- 202607290011_absensi_gerbang.sql
-- WP-17 / SCH-02 / SCH-08 / SCH-09 / SCH-10 / QUE-08: absensi sebagai gerbang antrean.
--
-- Jam absensi dari SERVER, tidak bisa diatur mundur (I-09). Alpa otomatis pada batas
-- (default 10:00 WIB, dapat diatur Admin via site_settings.batas_jam_alpa, OQ-12).
-- ADITIF (kolom baru + nilai CHECK diperluas + tabel baru + cron).

-- ============================================================
-- 1. Kolom & status pada absensi_petugas.
-- ============================================================
ALTER TABLE public.absensi_petugas
  ADD COLUMN IF NOT EXISTS sumber        text CHECK (sumber IN ('fo','petugas_ajukan','otomatis')),
  ADD COLUMN IF NOT EXISTS dicatat_oleh  uuid NULL REFERENCES public.petugas(id) ON DELETE SET NULL;

-- Tambah nilai 'alpa' (SCH-10) — perluas CHECK (aditif).
ALTER TABLE public.absensi_petugas DROP CONSTRAINT IF EXISTS absensi_petugas_status_check;
ALTER TABLE public.absensi_petugas ADD CONSTRAINT absensi_petugas_status_check
  CHECK (status IN ('pending','approved','ditolak','alpa'));

-- ============================================================
-- 2. Tabel layanan_hari: status operasional per layanan per hari (jam efektif, tutup
--    manual FO, jam selesai aktual) — QUE-11/QUE-14, SCH-06.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.layanan_hari (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id         uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal            date NOT NULL,
  jam_buka_efektif   time,
  jam_tutup_efektif  time,
  ditutup_manual     boolean NOT NULL DEFAULT false,
  alasan_tutup       text,
  ditutup_oleh       uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  jam_selesai_aktual timestamptz,
  status_hari        text NOT NULL DEFAULT 'belum_dibuka'
        CHECK (status_hari IN ('belum_dibuka','dibuka','ditutup','alpa')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);

ALTER TABLE public.layanan_hari ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS layanan_hari_public_read ON public.layanan_hari;
CREATE POLICY layanan_hari_public_read ON public.layanan_hari FOR SELECT USING (true);
DROP POLICY IF EXISTS layanan_hari_staff_write ON public.layanan_hari;
CREATE POLICY layanan_hari_staff_write ON public.layanan_hari FOR ALL
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

-- ============================================================
-- 3. Catat absensi dengan jam dari SERVER (I-09). Mengembalikan baris absensi.
--    - sumber 'fo'           : FO mengklik hadir untuk petugas lain (dicatat_oleh = FO)
--    - sumber 'petugas_ajukan': petugas menekan "saya sudah hadir" (dicatat_oleh = diri)
-- ============================================================
CREATE OR REPLACE FUNCTION public.catat_absensi(
  p_petugas_id uuid,
  p_sumber     text,
  p_dicatat_oleh uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_sumber NOT IN ('fo','petugas_ajukan','otomatis') THEN
    RAISE EXCEPTION 'sumber absensi tidak valid';
  END IF;

  -- Jam diambil dari SERVER (now()), TIDAK bisa diatur mundur (I-09).
  INSERT INTO public.absensi_petugas (petugas_id, tanggal, jam_masuk, status, sumber, dicatat_oleh)
  VALUES (p_petugas_id, v_tanggal, now(),
          CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END,
          p_sumber, COALESCE(p_dicatat_oleh, p_petugas_id))
  ON CONFLICT (petugas_id, tanggal)
  DO UPDATE SET jam_masuk = COALESCE(public.absensi_petugas.jam_masuk, now()),
                status = CASE WHEN public.absensi_petugas.status = 'alpa' THEN 'approved' ELSE public.absensi_petugas.status END
  RETURNING id INTO v_id;

  -- Buka antrean layanan hari ini (SCH-02): tandai layanan_hari 'dibuka'.
  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  SELECT p.layanan_id, v_tanggal, 'dibuka'
  FROM public.petugas p WHERE p.id = p_petugas_id AND p.layanan_id IS NOT NULL
  ON CONFLICT (layanan_id, tanggal) DO UPDATE
    SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.catat_absensi(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_absensi(uuid, text, uuid) TO authenticated;

-- ============================================================
-- 4. Gerbang antrean (SCH-02 / I-05): layanan boleh menerbitkan antrean hari ini hanya
--    bila ada absensi petugas layanan itu yang approved.
-- ============================================================
CREATE OR REPLACE FUNCTION public.antrean_dibuka(p_layanan_id uuid, p_tanggal date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date))
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.absensi_petugas a
    JOIN public.petugas p ON p.id = a.petugas_id
    WHERE p.layanan_id = p_layanan_id
      AND a.tanggal = p_tanggal
      AND a.status = 'approved'
  )
$$;

-- ============================================================
-- 5. Alpa otomatis (SCH-10): pada hari berjadwal tanpa absensi sampai batas, tandai
--    'alpa' + layanan_hari 'alpa'. Batas dari site_settings.batas_jam_alpa (default 10:00).
-- ============================================================
CREATE OR REPLACE FUNCTION public.tandai_alpa_otomatis()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count int := 0;
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_batas time := COALESCE(
    (SELECT value::time FROM public.site_settings WHERE key = 'batas_jam_alpa'),
    time '10:00'
  );
  v_jam_wib time := (now() AT TIME ZONE 'Asia/Jakarta')::time;
  rec record;
BEGIN
  -- Hanya berjalan setelah batas jam WIB.
  IF v_jam_wib < v_batas THEN
    RETURN 0;
  END IF;

  -- Untuk setiap layanan yang SEHARUSNYA standby hari ini (dari jadwal_harian_beku bila
  -- ada, fallback jadwal_standby) tapi tidak ada absensi approved -> tandai alpa.
  FOR rec IN
    SELECT DISTINCT p.layanan_id
    FROM public.petugas p
    WHERE p.layanan_id IS NOT NULL
      AND p.aktif = true
      AND public.is_layanan_buka_jadwal(p.layanan_id, v_tanggal, NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.absensi_petugas a
        WHERE a.petugas_id = p.id AND a.tanggal = v_tanggal AND a.status = 'approved'
      )
  LOOP
    -- Tandai absensi alpa untuk petugas layanan itu (jaga UNIQUE(petugas_id,tanggal)).
    INSERT INTO public.absensi_petugas (petugas_id, tanggal, status, sumber)
    SELECT p.id, v_tanggal, 'alpa', 'otomatis'
    FROM public.petugas p
    WHERE p.layanan_id = rec.layanan_id AND p.aktif = true
    ON CONFLICT (petugas_id, tanggal) DO UPDATE
      SET status = CASE WHEN public.absensi_petugas.status = 'approved' THEN 'approved' ELSE 'alpa' END;

    -- Tandai layanan_hari 'alpa'.
    INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
    VALUES (rec.layanan_id, v_tanggal, 'alpa')
    ON CONFLICT (layanan_id, tanggal) DO UPDATE SET status_hari = 'alpa', updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.tandai_alpa_otomatis() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tandai_alpa_otomatis() TO service_role;

-- Cron: cek alpa tiap 5 menit (fungsi sendiri yang membatasi jam WIB).
SELECT cron.schedule(
  'absensi_alpa_otomatis',
  '*/5 * * * *',
  $$SELECT public.tandai_alpa_otomatis()$$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'absensi_alpa_otomatis');

-- Default batas jam alpa di site_settings (boleh diubah Admin — CMS-05).
INSERT INTO public.site_settings (key, value)
VALUES ('batas_jam_alpa', '10:00')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 6. Enum visit + 'tidak_terlayani' (QUE-08) — perluas CHECK (aditif, OPS-08 di TS).
-- ============================================================
ALTER TABLE public.visit DROP CONSTRAINT IF EXISTS visit_status_check;
ALTER TABLE public.visit ADD CONSTRAINT visit_status_check
  CHECK (status IN ('terjadwal','menunggu','dilayani','selesai','batal','no_show','tidak_terlayani'));
