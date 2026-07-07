-- ============================================================
-- Migration 008: Tabel Pengunjung (Profil Google OAuth)
-- ============================================================

-- Tabel pengunjung: profil user yang login via Google
CREATE TABLE pengunjung (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  nama TEXT NOT NULL,
  email TEXT,
  foto_url TEXT,
  provider TEXT NOT NULL DEFAULT 'google',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE pengunjung IS 'Profil pengunjung yang login via Google OAuth';
COMMENT ON COLUMN pengunjung.auth_user_id IS 'Referensi ke auth.users — satu user = satu profil pengunjung';
COMMENT ON COLUMN pengunjung.provider IS 'OAuth provider yang digunakan (google)';

-- Index
CREATE INDEX idx_pengunjung_auth_user ON pengunjung(auth_user_id);

-- RLS
ALTER TABLE pengunjung ENABLE ROW LEVEL SECURITY;

-- Pengunjung bisa baca profil sendiri
CREATE POLICY "pengunjung_self_select" ON pengunjung
  FOR SELECT USING (auth_user_id = auth.uid());

-- Insert otomatis saat pertama login
CREATE POLICY "pengunjung_self_insert" ON pengunjung
  FOR INSERT WITH CHECK (auth_user_id = auth.uid());

-- Update profil sendiri
CREATE POLICY "pengunjung_self_update" ON pengunjung
  FOR UPDATE USING (auth_user_id = auth.uid());

-- Admin bisa lihat semua pengunjung
CREATE POLICY "pengunjung_admin_select" ON pengunjung
  FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');
