-- ============================================================
-- Migration 036: Fase 0 / K3 follow-up: Prune anon_rate_limit (unbounded growth fix)
-- ============================================================
--
-- Problem:
--   Tabel anon_rate_limit (migration 022) tumbuh tanpa batas. Query
--   rate-limit memfilter berdasarkan created_at dalam window 60 detik,
--   jadi baris lama tidak pernah dibaca tapi tetap mengonsumsi ruang
--   dan memperlambat index scan.
--
-- Solusi:
--   1. Function prune_anon_rate_limit() — DELETE baris > 7 hari.
--   2. pg_cron schedule '0 3 * * *' (daily 3am) jika pg_cron terpasang.
--      Jika tidak, RAISE NOTICE dengan instruksi manual.
--
-- Catatan:
--   - 7 hari dipilih sebagai buffer aman; window rate-limit terlama
--     yang dipakai adalah 60 detik, jadi 7 hari jauh mencukupi untuk
--     audit/debugging tanpa menahan pertumbuhan tabel.
--   - SECURITY DEFINER supaya bisa DELETE meskipun caller (pg_cron
--     background worker) tidak punya hak akses langsung ke tabel
--     (REVOKE ALL dari migration 022 berlaku untuk anon/authenticated).
--   - pg_cron menjalankan query sebagai superuser role cron, sehingga
--     dapat melewati REVOKE; SECURITY DEFINER tetap aman karena
--     function hanya melakukan DELETE sederhana dengan kriteria waktu.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Function prune_anon_rate_limit()
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION prune_anon_rate_limit()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM anon_rate_limit WHERE created_at < now() - INTERVAL '7 days';
$$;


-- ------------------------------------------------------------
-- 2. Schedule via pg_cron (jika terpasang)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('prune_anon_rate_limit');
    PERFORM cron.schedule('prune_anon_rate_limit', '0 3 * * *', 'SELECT prune_anon_rate_limit()');
  ELSE
    RAISE NOTICE 'pg_cron tidak terinstall. Prune manual: SELECT prune_anon_rate_limit();';
  END IF;
END $$;


-- ============================================================
-- ROLLBACK:
--   DO $$ BEGIN PERFORM cron.unschedule('prune_anon_rate_limit'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
--   DROP FUNCTION IF EXISTS prune_anon_rate_limit();
-- ============================================================
