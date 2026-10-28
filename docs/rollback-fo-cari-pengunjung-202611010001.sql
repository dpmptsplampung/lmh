-- docs/rollback-fo-cari-pengunjung-202611010001.sql
-- Rollback 202611010001_fo_cari_pengunjung (Fase 6). HANYA pemilik, atomik, dry-run dulu:
--   node scripts/apply-migration.mjs docs/rollback-fo-cari-pengunjung-202611010001.sql --atomic --dry-run
-- Migrasi itu hanya menambah fungsi dan indeks; rollback menghapus objek baru tersebut (tidak ada data yang tersentuh).
-- Baris audit_log aksi 'fo_ambil_pengunjung' dibiarkan (jejak audit tidak dihapus). Setelah ini kolom pencarian di
-- formulir FO tersembunyi sendiri (RPC tidak ada).
DROP FUNCTION IF EXISTS public.fo_ambil_pengunjung(uuid);
DROP FUNCTION IF EXISTS public.fo_cari_pengunjung(text);
DROP INDEX IF EXISTS public.idx_kunjungan_hp_trgm;
DROP INDEX IF EXISTS public.idx_kunjungan_nama_trgm;
DROP FUNCTION IF EXISTS public.hp_normal(text);
