-- ============================================================
-- Migration 001: Fase 1 — Tabel Inti (Layanan, Petugas, Kunjungan)
-- ============================================================

-- Tabel layanan: hanya 3 baris tetap (layanan konsultatif)
CREATE TABLE layanan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama TEXT NOT NULL UNIQUE,
  chatbot_aktif BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE layanan IS 'Daftar layanan konsultatif di DPMPTSP (3 baris tetap)';
COMMENT ON COLUMN layanan.chatbot_aktif IS 'Apakah chatbot FAQ aktif untuk layanan ini (Fase 3)';

-- Tabel petugas: akun individual terikat ke satu layanan
CREATE TABLE petugas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  layanan_id UUID REFERENCES layanan(id) ON DELETE SET NULL,
  role TEXT NOT NULL CHECK (role IN ('petugas', 'admin')) DEFAULT 'petugas',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE petugas IS 'Petugas DPMPTSP — akun individual, terikat ke satu layanan_id (NULL untuk admin)';
COMMENT ON COLUMN petugas.layanan_id IS 'NULL = admin (akses semua layanan)';

-- Tabel kunjungan: Buku Tamu digital
CREATE TABLE kunjungan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama TEXT NOT NULL,
  keperluan TEXT,
  layanan_id UUID NOT NULL REFERENCES layanan(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('menunggu', 'selesai')) DEFAULT 'menunggu',
  waktu_masuk TIMESTAMPTZ NOT NULL DEFAULT now(),
  waktu_selesai TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE kunjungan IS 'Check-in digital (Buku Tamu) — dropdown layanan hanya 3 layanan konsultatif';

-- Index untuk query dashboard
CREATE INDEX idx_kunjungan_layanan ON kunjungan(layanan_id);
CREATE INDEX idx_kunjungan_status ON kunjungan(status);
CREATE INDEX idx_kunjungan_waktu_masuk ON kunjungan(waktu_masuk DESC);
