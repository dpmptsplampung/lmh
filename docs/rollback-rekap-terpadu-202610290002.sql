-- docs/rollback-rekap-terpadu-202610290002.sql
-- Rollback 202610290002_rekap_terpadu (Fase 3). HANYA pemilik, atomik, dry-run dulu:
--   node scripts/apply-migration.mjs docs/rollback-rekap-terpadu-202610290002.sql --atomic --dry-run
-- Migrasi itu hanya menambah fungsi baca; rollback menghapus fungsi tersebut (tidak ada data yang tersentuh). Jalankan
-- SEBELUM docs/rollback-koordinator-akses-data-202610290001.sql. Setelah ini halaman Rekap menjawab 409
-- MIGRASI_BELUM_DITERAPKAN.
DROP FUNCTION IF EXISTS public.rekap_kinerja_petugas(date, date, text, uuid);
DROP FUNCTION IF EXISTS public.rekap_harian_terpadu(date, date, text, uuid);
DROP FUNCTION IF EXISTS public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean);
DROP FUNCTION IF EXISTS public.lingkup_data_saya();
DROP FUNCTION IF EXISTS public.rekap_pelayanan_inti(date, date, text, uuid);
