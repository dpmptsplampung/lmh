-- ============================================================
-- Migration 004: Fase 2 — Log FIFO Helpdesk OSS
-- ============================================================

-- View: urutan kedatangan harian khusus Helpdesk OSS
-- Diturunkan dari tabel kunjungan, tidak perlu tabel baru
CREATE OR REPLACE VIEW antrian_helpdesk AS
SELECT
  k.id,
  k.nama,
  k.keperluan,
  k.status,
  k.waktu_masuk,
  k.waktu_selesai,
  DATE(k.waktu_masuk) AS tanggal,
  ROW_NUMBER() OVER (
    PARTITION BY DATE(k.waktu_masuk)
    ORDER BY k.waktu_masuk ASC
  ) AS nomor_urut,
  CASE
    WHEN k.waktu_selesai IS NOT NULL
    THEN EXTRACT(EPOCH FROM (k.waktu_selesai - k.waktu_masuk)) / 60.0
    ELSE NULL
  END AS durasi_menit
FROM kunjungan k
WHERE k.layanan_id = (SELECT id FROM layanan WHERE nama = 'Helpdesk OSS')
ORDER BY k.waktu_masuk DESC;

COMMENT ON VIEW antrian_helpdesk IS 'Log FIFO Helpdesk OSS — nomor urut per hari, durasi tunggu';
