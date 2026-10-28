-- Rollback manual 202611030004. BUKAN migrasi.
ALTER TABLE public.listing_umkm DROP CONSTRAINT IF EXISTS listing_umkm_foto_https;
DROP FUNCTION IF EXISTS public.foto_umkm_semua_https(text[]);
