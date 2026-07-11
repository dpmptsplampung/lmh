-- ============================================================
-- Migration 031: Fase 2 / I3 fix — Unique constraint on skm_respons.visit_id
-- ============================================================
--
-- Masalah:
--   RLS policy `skm_select_staff` hanya `TO authenticated`, sehingga visitor
--   anonim tidak bisa SELECT `skm_respons`. Akibatnya, pengecekan duplikat
--   di Route Handler (dan di form) selalu mengembalikan null untuk anon.
--   Tanpa constraint UNIQUE di DB, INSERT service-role untuk visit yang sama
--   tetap berhasil → duplikat terjadi.
--
-- Solusi:
--   Tambah partial UNIQUE INDEX pada `skm_respons(visit_id) WHERE visit_id IS NOT NULL`.
--   Partial karena `visit_id` bisa NULL (FK ON DELETE SET NULL). Index ini
--   memberlakukan uniquness di level DB sehingga race condition / bypass RLS
--   tetap dicegah. Route Handler memetakan error `23505` (unique_violation)
--   ke HTTP 409.
--
-- Additive terhadap migration 030 (tidak mengubah tabel/RLS/function yang ada).
-- ============================================================

-- Fase 2 / I3 fix: Unique constraint on skm_respons.visit_id to prevent duplicate submissions
-- Partial index karena visit_id bisa NULL (ON DELETE SET NULL) — kita hanya unique yang non-NULL
CREATE UNIQUE INDEX IF NOT EXISTS skm_respons_visit_id_uniq
  ON skm_respons(visit_id)
  WHERE visit_id IS NOT NULL;

-- ============================================================
-- ROLLBACK:
--   DROP INDEX IF EXISTS skm_respons_visit_id_uniq;
-- ============================================================
