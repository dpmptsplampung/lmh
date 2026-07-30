-- 202607290004_petugas_aktif.sql
-- WP-06 / RBA-06 / RBA-08 (fondasi): kolom aktif/nonaktif pada petugas.
--
-- Masalah: petugas tidak punya status nonaktif; satu-satunya cara menghentikan akses
-- adalah MENGHAPUS baris — menghancurkan riwayat. ADITIF.

ALTER TABLE public.petugas
  ADD COLUMN IF NOT EXISTS aktif            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nonaktif_sejak   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS nonaktif_oleh    uuid NULL REFERENCES public.petugas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nonaktif_alasan  text NULL;

-- Petugas nonaktif tidak boleh dianggap punya peran (I-22). get_my_role() mengembalikan
-- NULL untuk petugas nonaktif sehingga policy RLS yang memakai get_my_role() gagal tertutup.
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT staff.role FROM public.petugas AS staff
  WHERE staff.auth_user_id = auth.uid() AND staff.aktif = true
$$;

-- Jejak perubahan status aktif (RBA-08): catat siapa menonaktifkan, kapan, dan alasan.
CREATE OR REPLACE FUNCTION public.petugas_set_nonaktif(
  p_petugas_id uuid,
  p_alasan text,
  p_actor uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_alasan IS NULL OR btrim(p_alasan) = '' THEN
    RAISE EXCEPTION 'alasan nonaktif wajib diisi (RBA-08)';
  END IF;
  UPDATE public.petugas
  SET aktif = false,
      nonaktif_sejak = now(),
      nonaktif_oleh = p_actor,
      nonaktif_alasan = p_alasan
  WHERE id = p_petugas_id;
END $$;

REVOKE ALL ON FUNCTION public.petugas_set_nonaktif(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_set_nonaktif(uuid, text, uuid) TO authenticated;

-- Reaktivasi hanya oleh Admin (satu arah untuk FO) — fungsi terpisah yang mengecek peran.
CREATE OR REPLACE FUNCTION public.petugas_set_aktif(p_petugas_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'hanya Admin yang boleh mengaktifkan kembali (RBA-08)';
  END IF;
  UPDATE public.petugas
  SET aktif = true,
      nonaktif_sejak = NULL,
      nonaktif_oleh = NULL,
      nonaktif_alasan = NULL
  WHERE id = p_petugas_id;
END $$;

REVOKE ALL ON FUNCTION public.petugas_set_aktif(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_set_aktif(uuid) TO authenticated;
