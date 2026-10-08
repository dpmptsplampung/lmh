-- Rollback manual migrasi 202610090005_perbaikan_review.sql.
-- URUTAN ROLLBACK: 0005 -> 0004 -> 0003 -> 0002 -> 0001 (kebalikan penerapan). Jangan melompati.
-- Menghapus kolom rahasia_pengaturan.host (ikatan host hilang; rahasia tetap). Terapkan ATOMIK:
--   node scripts/apply-migration.mjs docs/rollback-rbac-akhir-202610090005.sql --atomic --yes
DROP TRIGGER IF EXISTS trg_guard_jam_tutup_layanan ON public.site_settings;
DROP FUNCTION IF EXISTS public.guard_jam_tutup_layanan();
DROP TRIGGER IF EXISTS trg_guard_admin_terakhir_hapus ON public.petugas;
DROP FUNCTION IF EXISTS public.guard_admin_terakhir_hapus();
ALTER TABLE public.rahasia_pengaturan DROP COLUMN IF EXISTS host;
DROP POLICY IF EXISTS petugas_fo_read ON public.petugas;
