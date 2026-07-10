-- ============================================================
-- Migration 025: Tipe layanan (konsultatif / mitra / modul_publik)
-- Fase 1 / B2: Tipe layanan
-- ============================================================
--
-- Memisahkan layanan ke 3 tipe agar UMKM & Investment Gallery
-- (modul publik) tidak muncul di dropdown check-in / reservasi / chat.
--
--   konsultatif  -> layanan DPMPTSP yang menerima kunjungan/chat
--   mitra        -> layanan instansi mitra (Bank Lampung, BALMON)
--   modul_publik -> modul publik (Matchmaking UMKM, Investment Gallery)
-- ============================================================

ALTER TABLE layanan ADD COLUMN tipe TEXT NOT NULL DEFAULT 'konsultatif'
  CHECK (tipe IN ('konsultatif', 'mitra', 'modul_publik'));

-- Backfill: tandai modul publik & mitra. Sisanya tetap 'konsultatif'
-- (Helpdesk OSS, Sertifikasi Halal, BPJS Kesehatan,
--  Sertifikasi Mutu Keamanan Hasil Perikanan, Layanan Jasa Industri).
UPDATE layanan SET tipe = 'modul_publik' WHERE nama IN ('Matchmaking UMKM', 'Investment Gallery');
UPDATE layanan SET tipe = 'mitra' WHERE nama IN ('Bank Lampung', 'BALMON');

COMMENT ON COLUMN layanan.tipe IS 'Tipe layanan: konsultatif (check-in/chat), mitra (instansi mitra), modul_publik (modul publik — bukan target check-in)';

-- ROLLBACK:
-- ALTER TABLE layanan DROP COLUMN tipe;
