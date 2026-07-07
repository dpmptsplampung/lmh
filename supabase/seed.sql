-- ============================================================
-- Seed Data: 3 Layanan Konsultatif
-- ============================================================

INSERT INTO layanan (nama, chatbot_aktif) VALUES
  ('Helpdesk OSS', false),
  ('Sertifikasi Halal', false),
  ('CS BPJS Kesehatan', false)
ON CONFLICT (nama) DO NOTHING;
