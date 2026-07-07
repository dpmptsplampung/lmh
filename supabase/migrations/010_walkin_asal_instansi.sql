-- ============================================================
-- Migration 010: Tambah kolom asal_instansi ke tabel kunjungan
-- ============================================================

ALTER TABLE kunjungan ADD COLUMN asal_instansi TEXT;

COMMENT ON COLUMN kunjungan.asal_instansi IS 'Asal instansi, alamat, atau organisasi pengunjung walk-in';
