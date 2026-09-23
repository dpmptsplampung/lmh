-- 202609230002_faq_fts.sql
-- Bot multi-tingkat (Fase 1b): pencocok FAQ deterministik di Postgres agar bot
-- tetap menjawab walau kuota LLM habis. Idempoten.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Bungkus unaccent agar IMMUTABLE (unaccent asli STABLE — tidak bisa dipakai
-- di generated column / ekspresi indeks tanpa immutable wrapper).
CREATE OR REPLACE FUNCTION public.unaccent_imm(text)
RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, $1)
$$;

-- Kolom pencarian teks bahasa Indonesia: bobot A untuk pertanyaan,
-- B untuk jawaban (1-gram 0.1, kata 0.2, gram pendek 0.4, panjang 1.0).
ALTER TABLE public.faq_knowledge_base
  ADD COLUMN IF NOT EXISTS fts tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('indonesian'::regconfig, public.unaccent_imm(COALESCE(pertanyaan, ''))), 'A')
    || setweight(to_tsvector('indonesian'::regconfig, public.unaccent_imm(COALESCE(jawaban, ''))), 'B')
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_faq_fts
  ON public.faq_knowledge_base USING gin (fts);
CREATE INDEX IF NOT EXISTS idx_faq_trgm
  ON public.faq_knowledge_base USING gin (pertanyaan gin_trgm_ops);

-- Kamus sinonim/singkatan untuk normalisasi pertanyaan (dikelola admin).
CREATE TABLE IF NOT EXISTS public.faq_sinonim (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kata       text NOT NULL UNIQUE,
  sinonim    text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.faq_sinonim ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.faq_sinonim TO authenticated;
GRANT ALL ON public.faq_sinonim TO service_role;

DROP POLICY IF EXISTS faq_sinonim_read ON public.faq_sinonim;
CREATE POLICY faq_sinonim_read ON public.faq_sinonim
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS faq_sinonim_admin_all ON public.faq_sinonim;
CREATE POLICY faq_sinonim_admin_all ON public.faq_sinonim
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- Seed sinonim umum (referensi, idempoten).
INSERT INTO public.faq_sinonim (kata, sinonim) VALUES
  ('nib', ARRAY['nomor induk berusaha']),
  ('oss', ARRAY['online single submission']),
  ('nib', ARRAY['nomor induk berusaha'])
ON CONFLICT (kata) DO NOTHING;

-- Pencocok FAQ teks: gabungan peringkat teks (FTS Bahasa Indonesia) dan
-- kemiripan trigram (toleran salah ketik). Mengembalikan skor konsisten
-- (0..1 kira-kira); ambang diputuskan di aplikasi.
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

COMMIT;
