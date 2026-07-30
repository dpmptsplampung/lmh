-- JALANKAN SEKALI di Supabase SQL Editor (sebagai pemilik proyek).
-- Fungsi jembatan agar migrasi bisa diterapkan terprogram dari CLI dengan service_role.
-- Hanya service_role yang boleh mengeksekusi; anon/authenticated ditolak.
CREATE OR REPLACE FUNCTION public.exec_sql(q text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  EXECUTE q;
  RETURN 'ok';
END $$;

REVOKE ALL ON FUNCTION public.exec_sql(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_sql(text) TO service_role;
