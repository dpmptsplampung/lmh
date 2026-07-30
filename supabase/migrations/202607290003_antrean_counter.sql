-- 202607290003_antrean_counter.sql
-- WP-05 / QUE-06 / SVC-04 / SVC-05: penomoran antrean atomik + atribut loket/prefiks.
--
-- Fondasi nomor antrean (belum dipakai alur visit — itu Fase 3). ADITIF murni.

-- 1. Atribut layanan: nomor loket (SVC-04) & prefiks antrean (SVC-05).
ALTER TABLE public.layanan
  ADD COLUMN IF NOT EXISTS nomor_loket     text,
  ADD COLUMN IF NOT EXISTS prefiks_antrean text;

-- Prefiks unik bila diisi (agar nomor display tidak tabrakan antar layanan).
CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_prefiks
  ON public.layanan(prefiks_antrean)
  WHERE prefiks_antrean IS NOT NULL;

-- 2. Tabel penghitung atomik per (layanan, tanggal).
CREATE TABLE IF NOT EXISTS public.antrean_counter (
  layanan_id     uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal        date NOT NULL,
  nomor_terakhir int  NOT NULL DEFAULT 0,
  PRIMARY KEY (layanan_id, tanggal)
);

ALTER TABLE public.antrean_counter ENABLE ROW LEVEL SECURITY;
-- Tidak ada akses langsung; hanya lewat fungsi SECURITY DEFINER.
DROP POLICY IF EXISTS antrean_counter_deny_all ON public.antrean_counter;
CREATE POLICY antrean_counter_deny_all ON public.antrean_counter
  FOR ALL USING (false) WITH CHECK (false);

-- 3. Penomoran atomik: UPSERT + RETURNING (JANGAN "SELECT MAX+1" di aplikasi).
--    Aman untuk dua permintaan bersamaan: baris dikunci pada UPSERT.
CREATE OR REPLACE FUNCTION public.terbit_nomor_antrean(p_layanan_id uuid, p_tanggal date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_nomor int;
BEGIN
  INSERT INTO public.antrean_counter (layanan_id, tanggal, nomor_terakhir)
  VALUES (p_layanan_id, p_tanggal, 1)
  ON CONFLICT (layanan_id, tanggal)
  DO UPDATE SET nomor_terakhir = public.antrean_counter.nomor_terakhir + 1
  RETURNING nomor_terakhir INTO v_nomor;
  RETURN v_nomor;
END $$;

REVOKE ALL ON FUNCTION public.terbit_nomor_antrean(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_nomor_antrean(uuid, date) TO authenticated;
