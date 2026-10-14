-- Rollback manual migrasi 202610140006_pernyataan_kebenaran.sql (kunci Nama Lengkap pengunjung, K12).
-- Terapkan ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-pernyataan-kebenaran-202610140006.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-pernyataan-kebenaran-202610140006.sql --atomic
--
-- Yang dikembalikan:
--   1. DROP trigger trg_jaga_nama_pengunjung pada public.pengunjung (nama kembali bebas diubah pemiliknya).
--   2. DROP fungsi ubah_nama_pengunjung(uuid, text, text), jaga_nama_pengunjung(), pengunjung_profil_lengkap(text x5).
-- Tidak menyentuh data: baris pengunjung, consent_log (baris tujuan 'pernyataan_kebenaran' yang sudah tercatat
-- dibiarkan sebagai bukti) dan audit_log (entri 'ubah_nama_pengunjung' dibiarkan). Idempoten (IF EXISTS).
-- Klien C2 yang masih terpasang tetap berjalan (hanya kehilangan penegakan DB); bila klien ikut dikembalikan,
-- gerbang profil kembali ke empat field tanpa email/pernyataan.

DROP TRIGGER IF EXISTS trg_jaga_nama_pengunjung ON public.pengunjung;
DROP FUNCTION IF EXISTS public.ubah_nama_pengunjung(uuid, text, text);
DROP FUNCTION IF EXISTS public.jaga_nama_pengunjung();
DROP FUNCTION IF EXISTS public.pengunjung_profil_lengkap(text, text, text, text, text);
