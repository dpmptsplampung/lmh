-- ============================================================
-- Pengunjung: Tambah kolom no_hp
-- ============================================================
BEGIN;

ALTER TABLE public.pengunjung
  ADD COLUMN IF NOT EXISTS no_hp text;

COMMIT;
