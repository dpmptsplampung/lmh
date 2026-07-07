-- ============================================================
-- Migration 011: Perbarui Daftar Layanan Konsultatif
-- ============================================================

-- 1. Rename CS BPJS Kesehatan -> BPJS Kesehatan (untuk mempertahankan relasi)
UPDATE layanan 
SET nama = 'BPJS Kesehatan' 
WHERE nama = 'CS BPJS Kesehatan';

-- 2. Tambah layanan baru
INSERT INTO layanan (nama, chatbot_aktif) VALUES
  ('Helpdesk OSS', false),
  ('Sertifikasi Halal', false),
  ('BPJS Kesehatan', false),
  ('Bank Lampung', false),
  ('Matchmaking UMKM', false),
  ('Investment Gallery', false)
ON CONFLICT (nama) DO NOTHING;
