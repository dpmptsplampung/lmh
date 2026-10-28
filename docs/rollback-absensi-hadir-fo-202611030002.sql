-- docs/rollback-absensi-hadir-fo-202611030002.sql
-- Rollback manual 202611030002. BUKAN migrasi. Menghapus catatan hadir FO bernama manual (foto di R2 tidak dihapus).
DROP FUNCTION IF EXISTS public.fo_catat_hadir_layanan(uuid, text, text);
DROP TABLE IF EXISTS public.absensi_hadir_fo;
