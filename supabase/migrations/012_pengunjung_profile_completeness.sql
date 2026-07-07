-- ============================================================
-- Migration 012: Tambah Kolom Kelengkapan Profil Pengunjung
-- ============================================================

-- Tambah kolom asal_instansi dan kategori pada tabel pengunjung
ALTER TABLE pengunjung ADD COLUMN IF NOT EXISTS asal_instansi TEXT;
ALTER TABLE pengunjung ADD COLUMN IF NOT EXISTS kategori TEXT;

-- Tambah komentar penjelasan
COMMENT ON COLUMN pengunjung.asal_instansi IS 'Asal instansi atau alamat asal pengunjung (Fase 3)';
COMMENT ON COLUMN pengunjung.kategori IS 'Kategori pengunjung (UMKM, Umum, Instansi, Investor) (Fase 3)';
