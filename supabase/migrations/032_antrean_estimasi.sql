-- ============================================================
-- Migration 032: Fase 2 / I2: Antrean pintar — materialized view + refresh function
-- ============================================================
--
-- Komponen:
--   1. mv_estimasi_layanan   — materialized view: rolling 14-day avg service
--                              duration per layanan per hour slot (from selesai visits)
--   2. v_antrian_loket       — live view: current queue state per konsultatif layanan
--                              (antre_count, dilayani_count, estimasi_durasi, estimasi_tunggu)
--   3. refresh_estimasi_layanan() — SECURITY DEFINER function for CONCURRENTLY refresh
--   4. pg_cron schedule     — refresh every 5 minutes (if pg_cron installed)
--
-- Sumber data:
--   - visit (migration 029): waktu_mulai_layan, waktu_selesai, status, layanan_id
--   - layanan (migration 025): tipe = 'konsultatif' (skip modul_publik/mitra — no queue)
--
-- Catatan:
--   - mv_estimasi_layanan butuh unique index agar REFRESH CONCURRENTLY bisa jalan.
--   - v_antrian_loket adalah view biasa (bukan materialized) agar selalu fresh.
--   - Jika belum ada visit selesai dalam 14 hari, COALESCE default 15 menit.
--   - Asumsi v1: 1 loket per layanan. estimasi_tunggu = antre_count * avg_durasi.
--
-- pg_cron belum di-enable di instance ini. Migration tetap berhasil
-- walaupun pg_cron belum terpasang (DO block menangani ketiadaan).
-- Human prerequisite: enable pg_cron via Supabase Dashboard
-- (Database → Extensions → pg_cron → enable). Sebelum itu, jalankan manual:
--   SELECT refresh_estimasi_layanan();
-- ============================================================


-- ------------------------------------------------------------
-- 1. Materialized view: rolling 14-day avg duration per layanan per hour slot
-- ------------------------------------------------------------
CREATE MATERIALIZED VIEW mv_estimasi_layanan AS
SELECT
  layanan_id,
  EXTRACT(HOUR FROM waktu_mulai_layan)::int AS jam_slot,
  AVG(EXTRACT(EPOCH FROM (waktu_selesai - waktu_mulai_layan))/60)::int AS avg_durasi_menit,
  COUNT(*)::int AS sample_count
FROM visit
WHERE status = 'selesai'
  AND waktu_mulai_layan IS NOT NULL
  AND waktu_selesai IS NOT NULL
  AND waktu_mulai_layan > now() - INTERVAL '14 days'
GROUP BY layanan_id, jam_slot;

-- Unique index wajib agar REFRESH MATERIALIZED VIEW CONCURRENTLY bisa jalan
CREATE UNIQUE INDEX idx_mv_estimasi_layanan_key
  ON mv_estimasi_layanan(layanan_id, jam_slot);

COMMENT ON MATERIALIZED VIEW mv_estimasi_layanan IS
  'Rolling 14-day avg service duration (menit) per layanan per hour slot. Refresh via refresh_estimasi_layanan() (pg_cron */5).';


-- ------------------------------------------------------------
-- 2. View: current queue state per konsultatif layanan (live, not materialized)
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_antrian_loket AS
SELECT
  l.id AS layanan_id,
  l.nama AS layanan_nama,
  l.tipe,
  COUNT(v.id) FILTER (WHERE v.status = 'menunggu') AS antre_count,
  COUNT(v.id) FILTER (WHERE v.status = 'dilayani') AS dilayani_count,
  COALESCE(
    (SELECT avg_durasi_menit FROM mv_estimasi_layanan m
     WHERE m.layanan_id = l.id AND m.jam_slot = EXTRACT(HOUR FROM now())
     LIMIT 1),
    15
  ) AS estimasi_durasi_menit,
  -- estimasi tunggu: antre_count * avg_durasi (jika 1 loket)
  -- Asumsi 1 loket per layanan untuk v1
  (COUNT(v.id) FILTER (WHERE v.status = 'menunggu')) *
  COALESCE(
    (SELECT avg_durasi_menit FROM mv_estimasi_layanan m
     WHERE m.layanan_id = l.id AND m.jam_slot = EXTRACT(HOUR FROM now())
     LIMIT 1),
    15
  ) AS estimasi_tunggu_total_menit
FROM layanan l
LEFT JOIN visit v ON v.layanan_id = l.id
  AND v.status IN ('menunggu', 'dilayani')
WHERE l.tipe = 'konsultatif'
GROUP BY l.id, l.nama, l.tipe;

COMMENT ON VIEW v_antrian_loket IS
  'Live queue state per konsultatif layanan: antre_count, dilayani_count, estimasi_durasi (from mv_estimasi_layanan, default 15), estimasi_tunggu_total.';

-- Public read access (anon + authenticated) — queue state is non-sensitive
GRANT SELECT ON v_antrian_loket TO anon, authenticated;


-- ------------------------------------------------------------
-- 3. Refresh function (callable by pg_cron or manually)
--    SECURITY DEFINER agar bisa REFRESH CONCURRENTLY tanpa privilese eksplisit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION refresh_estimasi_layanan()
RETURNS void LANGUAGE sql SECURITY DEFINER
AS $$ REFRESH MATERIALIZED VIEW CONCURRENTLY mv_estimasi_layanan; $$;


-- ------------------------------------------------------------
-- 4. pg_cron schedule (in DO block — seperti migration 028 / I8)
--    Refresh tiap 5 menit. Hanya jika pg_cron terpasang.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Hindari error duplikat: unschedule dulu jika sudah ada
    BEGIN
      PERFORM cron.unschedule('refresh_estimasi');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule('refresh_estimasi', '*/5 * * * *', 'SELECT refresh_estimasi_layanan()');
  ELSE
    RAISE NOTICE 'pg_cron tidak terinstall. Refresh manual: SELECT refresh_estimasi_layanan();';
  END IF;
END $$;


-- ============================================================
-- ROLLBACK:
--   DO $$
--   BEGIN
--     IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--       BEGIN
--         PERFORM cron.unschedule('refresh_estimasi');
--       EXCEPTION WHEN OTHERS THEN NULL;
--       END;
--     END IF;
--   END $$;
--
--   DROP FUNCTION IF EXISTS refresh_estimasi_layanan();
--   DROP VIEW IF EXISTS v_antrian_loket;
--   DROP INDEX IF EXISTS idx_mv_estimasi_layanan_key;
--   DROP MATERIALIZED VIEW IF EXISTS mv_estimasi_layanan;
-- ============================================================
