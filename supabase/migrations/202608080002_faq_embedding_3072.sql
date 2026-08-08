-- 202608080002_faq_embedding_3072.sql
-- TB-01 / BOT-14: samakan dimensi embedding dengan model gemini-embedding-001
-- (3072-dim). Embedding lama (768) tidak kompatibel -> dibuang & di-embed ulang.
--
-- Urutan penting:
--   pgvector TIDAK bisa cast vector(768) -> vector(3072), jadi kolom harus
--   dikosongkan (NULL) SEBELUM ALTER TYPE, jika tidak ALTER error pada baris
--   yang masih ber-embedding. match_faq juga dimigrasi ke 3072 agar tetap bisa
--   dipanggil dengan query embedding baru (signature lama 768 akan diganti).

-- 1. Index lama dibatasi ~2000 dim (ivfflat) dan merujuk tipe lama -> drop.
DROP INDEX IF EXISTS public.idx_faq_embedding;

-- 2. Kosongkan embedding + tandai re-embed SEBELUM mengubah tipe kolom.
UPDATE public.faq_knowledge_base
SET embedding = NULL, perlu_embed_ulang = true;

-- 3. Ubah tipe kolom ke 3072 (aman sekarang karena kolom sudah NULL semua).
ALTER TABLE public.faq_knowledge_base
  ALTER COLUMN embedding TYPE extensions.vector(3072);

-- 4. Index embedding sengaja TIDAK dibuat ulang.
--    pgvector 0.8.2 membatasi index hnsw/ivfflat maksimal 2000 dimensi, sehingga
--    kolom vector(3072) tidak bisa di-index dengan tipe tersebut. Itu tidak
--    masalah: tabel FAQ sangat kecil, jadi match_faq memakai sequential scan +
--    cosine distance yang sudah lebih dari cukup cepat. Tambahkan index kembali
--    hanya jika tabel tumbuh besar DAN pgvector di-upgrade (atau pakai
--    halfvec(3072) yang mendukung dimensi lebih besar).

-- 5. Migrasi match_faq ke 3072-dim. CREATE OR REPLACE tidak bisa mengubah tipe
--    parameter, jadi DROP dulu signature lama lalu buat ulang.
DROP FUNCTION IF EXISTS public.match_faq(extensions.vector, uuid, integer);

CREATE FUNCTION public.match_faq(
  query_embedding extensions.vector(3072),
  p_layanan_id uuid DEFAULT NULL,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  layanan_id uuid,
  pertanyaan text,
  jawaban text,
  similarity double precision
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT faq.id, faq.layanan_id, faq.pertanyaan, faq.jawaban,
    1 - (faq.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.faq_knowledge_base AS faq
  WHERE faq.embedding IS NOT NULL
    AND faq.aktif = true
    AND (p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id)
  ORDER BY faq.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count
$$;

REVOKE EXECUTE ON FUNCTION public.match_faq(extensions.vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_faq(extensions.vector, uuid, integer) TO authenticated;
