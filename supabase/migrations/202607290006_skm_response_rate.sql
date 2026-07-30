-- 202607290006_skm_response_rate.sql
-- WP-08 / SRV-03 / SEC-15: catat response rate SKM (dilayani vs mengisi).
--
-- Data ini TIDAK BISA dibuat surut — penilai eksternal selalu menanyakannya.
-- ADITIF.

-- 1. Tabel agregat harian per layanan.
CREATE TABLE IF NOT EXISTS public.skm_response_rate (
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal     date NOT NULL,
  dilayani    int NOT NULL DEFAULT 0,   -- jumlah kunjungan selesai dilayani
  mengisi     int NOT NULL DEFAULT 0,   -- jumlah respons SKM masuk
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (layanan_id, tanggal)
);

ALTER TABLE public.skm_response_rate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS skm_rr_staff_read ON public.skm_response_rate;
CREATE POLICY skm_rr_staff_read ON public.skm_response_rate
  FOR SELECT USING (public.get_my_role() IN ('petugas','admin','front_office'));
-- Tidak ada policy tulis langsung; diisi via fungsi SECURITY DEFINER.

-- 2. Fungsi tambah hitungan (dipanggil trigger). Tanggal memakai Asia/Jakarta (RPT-07).
CREATE OR REPLACE FUNCTION public.skm_rr_tambah(
  p_layanan_id uuid,
  p_field      text  -- 'dilayani' | 'mengisi'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_layanan_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.skm_response_rate (layanan_id, tanggal, dilayani, mengisi)
  VALUES (
    p_layanan_id, v_tanggal,
    CASE WHEN p_field = 'dilayani' THEN 1 ELSE 0 END,
    CASE WHEN p_field = 'mengisi'  THEN 1 ELSE 0 END
  )
  ON CONFLICT (layanan_id, tanggal) DO UPDATE SET
    dilayani = public.skm_response_rate.dilayani + (CASE WHEN p_field = 'dilayani' THEN 1 ELSE 0 END),
    mengisi  = public.skm_response_rate.mengisi  + (CASE WHEN p_field = 'mengisi'  THEN 1 ELSE 0 END),
    updated_at = now();
END $$;

REVOKE ALL ON FUNCTION public.skm_rr_tambah(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skm_rr_tambah(uuid, text) TO authenticated;

-- 3. Trigger: kunjungan selesai -> +dilayani.
CREATE OR REPLACE FUNCTION public.trg_visit_selesai_rr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'selesai' AND (OLD.status IS DISTINCT FROM 'selesai') THEN
    PERFORM public.skm_rr_tambah(NEW.layanan_id, 'dilayani');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_visit_selesai_rr ON public.visit;
CREATE TRIGGER trg_visit_selesai_rr
  AFTER UPDATE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.trg_visit_selesai_rr();

-- 4. Trigger: respons SKM masuk -> +mengisi.
CREATE OR REPLACE FUNCTION public.trg_skm_insert_rr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.skm_rr_tambah(NEW.layanan_id, 'mengisi');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_skm_insert_rr ON public.skm_respons;
CREATE TRIGGER trg_skm_insert_rr
  AFTER INSERT ON public.skm_respons
  FOR EACH ROW EXECUTE FUNCTION public.trg_skm_insert_rr();
