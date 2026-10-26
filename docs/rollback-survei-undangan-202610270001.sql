-- docs/rollback-survei-undangan-202610270001.sql
-- Rollback manual migrasi 202610270001_survei_undangan.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan
-- CEO, ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-survei-undangan-202610270001.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-survei-undangan-202610270001.sql --atomic
-- PERINGATAN: rollback ini menghapus SEMUA data undangan (tabel survei_undangan: token, batas kedaluwarsa, penanda sudah
--   diisi). Undangan tidak bisa dipulihkan dari migrasi; kunjungan yang sudah selesai TIDAK otomatis mendapat undangan lagi
--   setelah migrasi diterapkan ulang (trigger hanya untuk perubahan status berikutnya, tanpa backfill). QR yang sudah
--   ditampilkan/dipindai berhenti berlaku.
-- URUTAN: jalankan PALING AKHIR dalam seri survei terpadu Fase A, yaitu SETELAH rollback 202610270004, 202610270003, dan
--   202610270002 (objek di migrasi itu bergantung pada survei_undangan dan ensure_undangan). Tanpa CASCADE: bila masih ada
--   objek yang bergantung, DROP gagal dan seluruh rollback batal (atomik), bukan menghapus objek lain diam-diam.
-- Urutan DROP di bawah = kebalikan pembuatan: view, ambil_qr_survei, trigger, fungsi trigger, ensure_undangan, tabel.
-- Idempoten (semua IF EXISTS).

DROP VIEW IF EXISTS public.v_survei_status;
DROP FUNCTION IF EXISTS public.ambil_qr_survei(uuid);
DROP TRIGGER IF EXISTS trg_kunjungan_selesai_undangan ON public.kunjungan;
DROP FUNCTION IF EXISTS public.kunjungan_selesai_undangan();
DROP FUNCTION IF EXISTS public.ensure_undangan(uuid);
DROP TABLE IF EXISTS public.survei_undangan;
