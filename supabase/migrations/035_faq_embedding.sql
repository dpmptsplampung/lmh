-- ============================================================
-- Migration 035: Fase 3 / I4: FAQ embedding for RAG (pgvector required)
-- ============================================================
--
-- Komponen:
--   1. Kolom `embedding` pada faq_knowledge_base (vector(768))
--   2. Index ivfflat untuk cosine similarity search
--   3. Function `match_faq(query_embedding, p_layanan_id, match_count)`
--      — retrieval RAG berbasis cosine similarity
--   4. Tabel `chat_ai_log` — audit jawaban asisten AI (eskalasi/sumber)
--
-- PRASYARAT (DASHBOARD ACTION): Enable pgvector extension di Supabase Dashboard
-- Database → Extensions → search "vector" → Enable
-- Tanpa pgvector, migration ini akan gagal (tipe `vector` tidak dikenal).
--
-- Sumber data:
--   - /api/admin/faq/embed  → backfill embedding via Gemini text-embedding-004
--   - /api/chat/ai          → RAG retrieval + Gemini gemini-1.5-flash
--
-- Catatan:
--   - Dimensi 768 = output text-embedding-004 (Google).
--   - match_faq() SECURITY DEFINER STABLE agar pengunjung anon bisa retrieve
--     tanpa perlu SELECT langsung ke faq_knowledge_base (filter aktif=true
--     di dalam function).
--   - chat_ai_log hanya bisa dibaca admin (audit). Tidak ada INSERT policy
--     publik karena INSERT dijalankan oleh service-role dari route handler.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Kolom embedding + index ivfflat
-- ------------------------------------------------------------
ALTER TABLE faq_knowledge_base ADD COLUMN embedding vector(768);

CREATE INDEX idx_faq_embedding ON faq_knowledge_base
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);


-- ------------------------------------------------------------
-- 2. Function match_faq — cosine similarity search
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION match_faq(
  query_embedding vector(768),
  p_layanan_id UUID DEFAULT NULL,
  match_count INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  layanan_id UUID,
  pertanyaan TEXT,
  jawaban TEXT,
  similarity FLOAT
) LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT
    f.id, f.layanan_id, f.pertanyaan, f.jawaban,
    1 - (f.embedding <=> query_embedding) AS similarity
  FROM faq_knowledge_base f
  WHERE f.embedding IS NOT NULL
    AND f.aktif = true
    AND (p_layanan_id IS NULL OR f.layanan_id = p_layanan_id)
  ORDER BY f.embedding <=> query_embedding
  LIMIT match_count
$$;

GRANT EXECUTE ON FUNCTION match_faq(vector(768), UUID, INT) TO authenticated;


-- ------------------------------------------------------------
-- 3. Tabel chat_ai_log — audit jawaban asisten AI
-- ------------------------------------------------------------
CREATE TABLE chat_ai_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sesi_id UUID REFERENCES chat_sesi(id) ON DELETE CASCADE,
  pertanyaan TEXT NOT NULL,
  context_faq_ids UUID[] NOT NULL DEFAULT '{}',
  jawaban TEXT,
  top_similarity FLOAT,
  eskalasi BOOLEAN NOT NULL DEFAULT false,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_ai_log_created ON chat_ai_log(created_at DESC);
CREATE INDEX idx_chat_ai_log_eskalasi ON chat_ai_log(eskalasi) WHERE eskalasi = true;

ALTER TABLE chat_ai_log ENABLE ROW LEVEL SECURITY;

-- Audit log hanya dibaca admin. INSERT dilakukan oleh service-role
-- (route handler /api/chat/ai), yang melewati RLS.
CREATE POLICY "chat_ai_log_admin_select" ON chat_ai_log
  FOR SELECT TO authenticated USING (get_my_role() = 'admin');


-- ============================================================
-- ROLLBACK:
--   DROP POLICY IF EXISTS "chat_ai_log_admin_select" ON chat_ai_log;
--   ALTER TABLE chat_ai_log DISABLE ROW LEVEL SECURITY;
--   DROP INDEX IF EXISTS idx_chat_ai_log_eskalasi;
--   DROP INDEX IF EXISTS idx_chat_ai_log_created;
--   DROP TABLE IF EXISTS chat_ai_log;
--   REVOKE EXECUTE ON FUNCTION match_faq(vector(768), UUID, INT) FROM authenticated;
--   DROP FUNCTION IF EXISTS match_faq(vector(768), UUID, INT);
--   DROP INDEX IF EXISTS idx_faq_embedding;
--   ALTER TABLE faq_knowledge_base DROP COLUMN IF EXISTS embedding;
-- ============================================================
