-- Rollback manual migrasi 202610130001_faq_umum.sql (kembali ke keadaan sebelum FAQ umum).
-- Terapkan ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-faq-umum-202610130001.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-faq-umum-202610130001.sql --atomic
--
-- Yang dikembalikan:
--   1. (penjaga) menolak seluruh rollback bila masih ada FAQ umum (layanan_id IS NULL), lihat di bawah.
--   2. match_faq_teks  -> definisi 202609230002_faq_fts.sql (hanya FAQ layanan yang diminta).
--   3. match_faq       -> definisi 202608080002_faq_embedding_3072.sql (p_layanan_id terisi = hanya layanan itu).
--   4. policy faq_fo_umum dihapus (Front Office kembali tanpa akses tulis FAQ).
--   5. faq_knowledge_base.layanan_id kembali NOT NULL; komentar kolom dihapus.
--
-- PENJAGA DATA: SET NOT NULL tidak mungkin selama ada baris umum, dan rollback TIDAK boleh menghapus atau
-- memberi layanan pada FAQ umum secara diam-diam. Penjaga di bawah melempar galat (paling awal, sebelum ada
-- perubahan) bila ada baris layanan_id IS NULL. Mode --atomic membatalkan semuanya. Putuskan nasib baris itu
-- lebih dulu (sebagai Admin lewat halaman Kelola FAQ: pindahkan ke sebuah layanan atau hapus), lalu ulangi.
-- Daftar baris umum:
--   SELECT id, pertanyaan, aktif FROM public.faq_knowledge_base WHERE layanan_id IS NULL ORDER BY urutan, created_at;
-- Bila hanya ingin menarik akses Front Office dan perilaku pencarian lama TANPA menghapus FAQ umum, cukup
-- jalankan pernyataan DROP POLICY dan dua CREATE OR REPLACE FUNCTION di bawah secara terpisah (kolom tetap
-- nullable); jangan menjalankan penjaga dan SET NOT NULL.
--
-- Data FAQ yang ber-layanan tidak diubah. Setelah rollback fungsi lama, FAQ umum (bila masih ada) tidak lagi
-- ditemukan bot dan hanya terbaca lewat faq_public_read/faq_admin_all.

DO $$
DECLARE
  v_umum bigint;
BEGIN
  SELECT count(*) INTO v_umum FROM public.faq_knowledge_base WHERE layanan_id IS NULL;
  IF v_umum > 0 THEN
    RAISE EXCEPTION 'rollback dibatalkan: masih ada % FAQ umum (layanan_id IS NULL); pindahkan ke layanan atau hapus dulu (lihat komentar berkas ini)', v_umum;
  END IF;
END $$;

-- Definisi match_faq_teks dari 202609230002_faq_fts.sql
CREATE OR REPLACE FUNCTION public.match_faq_teks(
  p_layanan uuid,
  p_q text,
  p_limit integer DEFAULT 5
)
RETURNS TABLE(id uuid, pertanyaan text, jawaban text, skor double precision)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    f.id,
    f.pertanyaan,
    f.jawaban,
    (
      0.6 * ts_rank_cd(f.fts, websearch_to_tsquery('indonesian', public.unaccent_imm(p_q)), 32)
      + 0.4 * similarity(public.unaccent_imm(p_q), f.pertanyaan)
    )::double precision AS skor
  FROM public.faq_knowledge_base f
  WHERE f.aktif = true
    AND f.layanan_id = p_layanan
    AND (
      f.fts @@ websearch_to_tsquery('indonesian', public.unaccent_imm(p_q))
      OR f.pertanyaan % public.unaccent_imm(p_q)
    )
  ORDER BY skor DESC
  LIMIT GREATEST(COALESCE(p_limit, 5), 1);
$$;

REVOKE ALL ON FUNCTION public.match_faq_teks(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_faq_teks(uuid, text, integer)
  TO authenticated, service_role;

-- Definisi match_faq dari 202608080002_faq_embedding_3072.sql
CREATE OR REPLACE FUNCTION public.match_faq(
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

DROP POLICY IF EXISTS faq_fo_umum ON public.faq_knowledge_base;

COMMENT ON COLUMN public.faq_knowledge_base.layanan_id IS NULL;
ALTER TABLE public.faq_knowledge_base ALTER COLUMN layanan_id SET NOT NULL;
