-- JALANKAN SEKALI di SQL Editor: perbaiki exec_sql agar bisa mengembalikan hasil query (JSON).
-- Menambah varian exec_query untuk SELECT; exec_sql tetap untuk DDL (return 'ok').
CREATE OR REPLACE FUNCTION public.exec_query(q text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE r jsonb;
BEGIN
  EXECUTE format('SELECT COALESCE(jsonb_agg(t), ''[]''::jsonb) FROM (%s) t', q) INTO r;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.exec_query(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.exec_query(text) TO service_role;
