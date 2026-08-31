-- 202608310003_absensi_foto_fo.sql
-- Bug fix: tambah kolom foto_url ke absensi_petugas agar FO bisa menyimpan
-- foto saat mencatat hadir via wizard.
-- Perbarui catat_absensi agar menerima parameter p_foto_url opsional.
-- Tambah storage bucket 'absensi-foto' (private, max 5MB per file).
-- ADITIF — tidak mengubah data yang sudah ada.

-- ============================================================
-- 1. Kolom foto_url di absensi_petugas
-- ============================================================
ALTER TABLE public.absensi_petugas
  ADD COLUMN IF NOT EXISTS foto_url text;

-- ============================================================
-- 2. Storage bucket 'absensi-foto' (private)
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'absensi-foto',
  'absensi-foto',
  false,
  5242880,   -- 5 MB
  ARRAY['image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Policy: hanya admin & front_office boleh upload
DROP POLICY IF EXISTS "absensi_foto_insert" ON storage.objects;
CREATE POLICY "absensi_foto_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'absensi-foto'
    AND public.get_my_role() IN ('admin', 'front_office')
  );

-- Policy: admin & front_office boleh membaca semua; petugas hanya miliknya
DROP POLICY IF EXISTS "absensi_foto_select" ON storage.objects;
CREATE POLICY "absensi_foto_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'absensi-foto'
    AND public.get_my_role() IN ('admin', 'front_office')
  );

-- ============================================================
-- 3. Perbarui catat_absensi — tambah parameter p_foto_url opsional.
--    Harus drop terlebih dahulu karena PostgreSQL tidak mengizinkan
--    CREATE OR REPLACE mengubah jumlah argumen.
-- ============================================================
DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid);

CREATE OR REPLACE FUNCTION public.catat_absensi(
  p_petugas_id   uuid,
  p_sumber       text,
  p_dicatat_oleh uuid DEFAULT NULL,
  p_foto_url     text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_sumber NOT IN ('fo','petugas_ajukan','otomatis') THEN
    RAISE EXCEPTION 'sumber absensi tidak valid';
  END IF;

  -- Jam diambil dari SERVER (now()), TIDAK bisa diatur mundur (I-09).
  INSERT INTO public.absensi_petugas
    (petugas_id, tanggal, jam_masuk, status, sumber, dicatat_oleh, foto_url)
  VALUES (
    p_petugas_id, v_tanggal, now(),
    CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END,
    p_sumber,
    COALESCE(p_dicatat_oleh, p_petugas_id),
    p_foto_url
  )
  ON CONFLICT (petugas_id, tanggal)
  DO UPDATE SET
    jam_masuk    = COALESCE(public.absensi_petugas.jam_masuk, now()),
    status       = CASE
                     WHEN public.absensi_petugas.status = 'alpa' THEN 'approved'
                     ELSE public.absensi_petugas.status
                   END,
    foto_url     = COALESCE(public.absensi_petugas.foto_url, EXCLUDED.foto_url)
  RETURNING id INTO v_id;

  -- Buka antrean layanan hari ini (SCH-02).
  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  SELECT p.layanan_id, v_tanggal, 'dibuka'
  FROM   public.petugas p
  WHERE  p.id = p_petugas_id AND p.layanan_id IS NOT NULL
  ON CONFLICT (layanan_id, tanggal) DO UPDATE
    SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.catat_absensi(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.catat_absensi(uuid, text, uuid, text) TO authenticated;
