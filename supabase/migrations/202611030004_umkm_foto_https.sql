-- 202611030004_umkm_foto_https.sql
-- Foto UMKM kini boleh berupa unggahan ke Cloudflare R2 ATAU tautan web eksternal; keduanya disimpan sebagai URL penuh di
-- listing_umkm.foto_produk. Admin menulis kolom ini langsung dari browser, jadi validasi klien saja tidak cukup:
-- CHECK menolak elemen yang bukan https:// (javascript:, data:, http:). NOT VALID: baris lama (URL Supabase https) tidak diperiksa ulang,
-- baris baru/ubahan wajib lolos. Aditif.
-- ROLLBACK: docs/rollback-umkm-foto-https-202611030004.sql.
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.listing_umkm') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.listing_umkm belum ada';
  END IF;
END $$;

-- CHECK tidak boleh berisi subquery, jadi aturan dibungkus fungsi IMMUTABLE.
CREATE OR REPLACE FUNCTION public.foto_umkm_semua_https(p_foto text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT p_foto IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.unnest(p_foto) AS u(f)
    WHERE f IS NULL OR f !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$' OR pg_catalog.length(f) > 500
  )
$$;
REVOKE ALL ON FUNCTION public.foto_umkm_semua_https(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.foto_umkm_semua_https(text[]) TO anon, authenticated, service_role;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'listing_umkm_foto_https' AND conrelid = 'public.listing_umkm'::regclass) THEN
    ALTER TABLE public.listing_umkm ADD CONSTRAINT listing_umkm_foto_https
      CHECK (public.foto_umkm_semua_https(foto_produk)) NOT VALID;
  END IF;
END $$;
