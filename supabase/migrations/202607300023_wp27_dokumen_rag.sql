-- WP-27 / BOT-01..10, BOT-12, CMS-04: RAG document store.
-- dokumen_peraturan: source documents (staff uploads, no PDF embed — BOT-07).
-- dokumen_potongan:  chunked segments with embeddings.
-- match_dokumen():   similarity search filtered to berlaku docs only (I-16).
-- ADITIF.

-- Ensure pgvector extension is available (may already exist from baseline).
CREATE EXTENSION IF NOT EXISTS vector SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.dokumen_peraturan (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid    REFERENCES public.layanan(id) ON DELETE SET NULL,
  judul         text    NOT NULL,
  nomor         text,                          -- 'Permenpan No. 14/2017'
  jenis         text    NOT NULL DEFAULT 'peraturan',
    -- 'peraturan' | 'sop' | 'maklumat' | 'standar_pelayanan'
  sumber_url    text,                          -- JDIH reference link (BOT-07)
  teks_utama    text,                          -- pasted plain text (BOT-07)
  status        text    NOT NULL DEFAULT 'berlaku',
    -- 'berlaku' | 'dicabut'
  diunggah_oleh uuid    REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dokumen_peraturan_layanan
  ON public.dokumen_peraturan(layanan_id, status);

CREATE TABLE IF NOT EXISTS public.dokumen_potongan (
  id                   uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  dokumen_id           uuid    NOT NULL REFERENCES public.dokumen_peraturan(id) ON DELETE CASCADE,
  nomor_pasal          text,    -- 'Pasal 3 Ayat 2', etc.
  teks                 text    NOT NULL,
  embedding            extensions.vector(768),   -- gemini-embedding-004 (768-dim, TB-01)
  embedding_updated_at timestamptz,
  perlu_embed_ulang    boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dokumen_potongan_dokumen
  ON public.dokumen_potongan(dokumen_id);
CREATE INDEX IF NOT EXISTS idx_dokumen_potongan_embedding
  ON public.dokumen_potongan USING ivfflat (embedding extensions.vector_cosine_ops)
  WHERE embedding IS NOT NULL;

-- RLS
ALTER TABLE public.dokumen_peraturan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dokumen_potongan  ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON TABLE public.dokumen_peraturan TO authenticated;
GRANT SELECT ON TABLE public.dokumen_potongan  TO authenticated;

DROP POLICY IF EXISTS dokumen_peraturan_staff_read ON public.dokumen_peraturan;
CREATE POLICY dokumen_peraturan_staff_read
  ON public.dokumen_peraturan FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office', 'petugas'));

DROP POLICY IF EXISTS dokumen_peraturan_admin_write ON public.dokumen_peraturan;
CREATE POLICY dokumen_peraturan_admin_write
  ON public.dokumen_peraturan FOR ALL TO authenticated
  USING  (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS dokumen_potongan_staff_read ON public.dokumen_potongan;
CREATE POLICY dokumen_potongan_staff_read
  ON public.dokumen_potongan FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office', 'petugas'));

-- match_dokumen: cosine similarity search; only 'berlaku' docs (I-16).
-- search_path includes extensions so the <=> operator and vector type are accessible.
CREATE OR REPLACE FUNCTION public.match_dokumen(
  p_embedding       extensions.vector(768),
  p_match_threshold float   DEFAULT 0.7,
  p_match_count     integer DEFAULT 5,
  p_layanan_id      uuid    DEFAULT NULL
)
RETURNS TABLE (
  id            uuid,
  dokumen_id    uuid,
  nomor_pasal   text,
  teks          text,
  judul         text,
  jenis         text,
  sumber_url    text,
  similarity    float
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dp.id,
    dp.dokumen_id,
    dp.nomor_pasal,
    dp.teks,
    dok.judul,
    dok.jenis,
    dok.sumber_url,
    1.0 - (dp.embedding <=> p_embedding) AS similarity
  FROM public.dokumen_potongan AS dp
  JOIN public.dokumen_peraturan AS dok ON dok.id = dp.dokumen_id
  WHERE dok.status = 'berlaku'
    AND dp.embedding IS NOT NULL
    AND (p_layanan_id IS NULL OR dok.layanan_id = p_layanan_id)
    AND 1.0 - (dp.embedding <=> p_embedding) >= p_match_threshold
  ORDER BY dp.embedding <=> p_embedding
  LIMIT p_match_count;
END $$;

REVOKE ALL   ON FUNCTION public.match_dokumen(extensions.vector, float, integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_dokumen(extensions.vector, float, integer, uuid) TO authenticated;
