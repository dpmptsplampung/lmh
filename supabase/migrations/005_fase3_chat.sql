-- ============================================================
-- Migration 005: Fase 3 — Live Chat & Chatbot FAQ
-- ============================================================

-- Sesi chat
CREATE TABLE chat_sesi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id UUID NOT NULL REFERENCES layanan(id) ON DELETE RESTRICT,
  kontak_pengunjung TEXT,
  status TEXT NOT NULL CHECK (status IN ('aktif', 'bot', 'eskalasi', 'selesai')) DEFAULT 'bot',
  ditangani_oleh UUID REFERENCES petugas(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chat_sesi IS 'Sesi chat pengunjung — dimulai dari bot, bisa eskalasi ke petugas';
COMMENT ON COLUMN chat_sesi.kontak_pengunjung IS 'HP/email opsional untuk follow up manual';
COMMENT ON COLUMN chat_sesi.status IS 'bot=ditangani bot, eskalasi=menunggu petugas, aktif=petugas sedang membalas, selesai=ditutup';

-- Pesan chat
CREATE TABLE chat_pesan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesi_id UUID NOT NULL REFERENCES chat_sesi(id) ON DELETE CASCADE,
  pengirim TEXT NOT NULL CHECK (pengirim IN ('pengunjung', 'bot', 'petugas')),
  isi TEXT NOT NULL,
  sumber_faq_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chat_pesan IS 'Pesan individual dalam sesi chat';
COMMENT ON COLUMN chat_pesan.sumber_faq_id IS 'Referensi ke FAQ yang digunakan bot (untuk audit)';

-- Knowledge base FAQ per layanan
CREATE TABLE faq_knowledge_base (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id UUID NOT NULL REFERENCES layanan(id) ON DELETE CASCADE,
  pertanyaan TEXT NOT NULL,
  jawaban TEXT NOT NULL,
  aktif BOOLEAN NOT NULL DEFAULT true,
  urutan INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE faq_knowledge_base IS 'Knowledge base FAQ per layanan — sumber jawaban chatbot';

-- Indexes
CREATE INDEX idx_chat_sesi_layanan ON chat_sesi(layanan_id);
CREATE INDEX idx_chat_sesi_status ON chat_sesi(status);
CREATE INDEX idx_chat_pesan_sesi ON chat_pesan(sesi_id);
CREATE INDEX idx_faq_layanan ON faq_knowledge_base(layanan_id);

-- RLS
ALTER TABLE chat_sesi ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_pesan ENABLE ROW LEVEL SECURITY;
ALTER TABLE faq_knowledge_base ENABLE ROW LEVEL SECURITY;

-- Chat sesi: anon insert, petugas select/update layanan sendiri
CREATE POLICY "chat_sesi_anon_insert" ON chat_sesi
  FOR INSERT WITH CHECK (true);

CREATE POLICY "chat_sesi_anon_select_own" ON chat_sesi
  FOR SELECT USING (true);  -- pengunjung perlu baca sesi sendiri (filter by id di client)

CREATE POLICY "chat_sesi_petugas_update" ON chat_sesi
  FOR UPDATE TO authenticated
  USING (
    layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );

-- Chat pesan: anon insert, semua bisa baca (pesan dalam sesi)
CREATE POLICY "chat_pesan_anon_insert" ON chat_pesan
  FOR INSERT WITH CHECK (true);

CREATE POLICY "chat_pesan_select" ON chat_pesan
  FOR SELECT USING (true);

-- FAQ: public read (aktif saja), admin full
CREATE POLICY "faq_public_read" ON faq_knowledge_base
  FOR SELECT USING (aktif = true);

CREATE POLICY "faq_admin_all" ON faq_knowledge_base
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');
