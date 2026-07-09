-- ============================================================
-- Migration 019: Database Fixes
--   1. Triggers updated_at untuk 5 tabel yang belum punya
--   2. CHECK constraint pada pengunjung.kategori
--   3. Fix nama layanan mismatch di landing_content
-- ============================================================

-- ------------------------------------------------------------
-- 1. Triggers updated_at
--    Fungsi update_updated_at_column() sudah ada (migration 016).
--    5 tabel berikut punya kolom updated_at tapi belum ada trigger.
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS trigger_chat_sesi_updated_at ON chat_sesi;
CREATE TRIGGER trigger_chat_sesi_updated_at
  BEFORE UPDATE ON chat_sesi
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_faq_knowledge_base_updated_at ON faq_knowledge_base;
CREATE TRIGGER trigger_faq_knowledge_base_updated_at
  BEFORE UPDATE ON faq_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_listing_umkm_updated_at ON listing_umkm;
CREATE TRIGGER trigger_listing_umkm_updated_at
  BEFORE UPDATE ON listing_umkm
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_investment_documents_updated_at ON investment_documents;
CREATE TRIGGER trigger_investment_documents_updated_at
  BEFORE UPDATE ON investment_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_reservasi_updated_at ON reservasi;
CREATE TRIGGER trigger_reservasi_updated_at
  BEFORE UPDATE ON reservasi
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ------------------------------------------------------------
-- 2. CHECK constraint pada pengunjung.kategori
--    Kolom kategori (migration 012) tadinya TEXT tanpa CHECK.
--    Nilai valid: UMKM, Umum, Instansi, Investor.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pengunjung_kategori_check'
  ) THEN
    ALTER TABLE pengunjung ADD CONSTRAINT pengunjung_kategori_check
      CHECK (kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor'));
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Fix nama layanan mismatch di landing_content
--    Seed (migration 016) menulis "Balai Monitor SFR" sebagai
--    judul service, tapi di tabel layanan (migration 015) namanya
--    "BALMON". Samakan ke "BALMON" agar konsisten.
-- ------------------------------------------------------------
UPDATE landing_content SET item_value = 'BALMON'
WHERE section = 'service' AND item_key = 'title' AND item_value = 'Balai Monitor SFR';
