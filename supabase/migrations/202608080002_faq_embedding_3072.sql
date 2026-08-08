-- 202608080002_faq_embedding_3072.sql
-- TB-01 / BOT-14: samakan dimensi embedding dengan model gemini-embedding-001
-- (3072-dim). Embedding lama (768) tidak kompatibel -> dibuang & di-embed ulang.

-- 1. Index lama dibatasi ~2000 dim (ivfflat) dan merujuk tipe lama -> drop.
DROP INDEX IF EXISTS public.idx_faq_embedding;

-- 2. Ubah tipe kolom ke 3072. Data lama tidak bisa dikonversi -> kosongkan.
ALTER TABLE public.faq_knowledge_base
  ALTER COLUMN embedding TYPE extensions.vector(3072);

UPDATE public.faq_knowledge_base
SET embedding = NULL, perlu_embed_ulang = true;

-- 3. Index baru (hnsw mendukung dimensi besar; cosine ops).
CREATE INDEX IF NOT EXISTS idx_faq_embedding
  ON public.faq_knowledge_base
  USING hnsw (embedding extensions.vector_cosine_ops);
