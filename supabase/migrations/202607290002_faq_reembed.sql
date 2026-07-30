-- 202607290002_faq_reembed.sql
-- WP-04 / BOT-11 / TB-01: perbaiki pipeline embedding FAQ.
--
-- Masalah: endpoint embed hanya memproses `embedding IS NULL`, sehingga FAQ yang
-- DIEDIT tetap dicari memakai embedding lama (bot menjawab dari versi lama).
-- ADITIF: tambah kolom + trigger + cron. Tidak menghapus apa pun.

-- 1. Kolom penanda & jejak (BOT-11, BOT-10).
ALTER TABLE public.faq_knowledge_base
  ADD COLUMN IF NOT EXISTS perlu_embed_ulang    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS diubah_oleh          uuid NULL REFERENCES public.petugas(id) ON DELETE SET NULL;

-- 2. Trigger: saat teks pertanyaan/jawaban berubah, tandai perlu embed ulang.
CREATE OR REPLACE FUNCTION public.faq_mark_reembed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.pertanyaan IS DISTINCT FROM OLD.pertanyaan
     OR NEW.jawaban IS DISTINCT FROM OLD.jawaban THEN
    NEW.perlu_embed_ulang := true;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_faq_reembed ON public.faq_knowledge_base;
CREATE TRIGGER trg_faq_reembed
  BEFORE UPDATE ON public.faq_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.faq_mark_reembed();

-- 3. Fungsi embed ulang (dipanggil endpoint/cron): proses yang embedding IS NULL
--    ATAU perlu_embed_ulang. Embedding dihitung di aplikasi (Gemini), fungsi ini
--    hanya menandai baris yang sudah selesai di-embed.
CREATE OR REPLACE FUNCTION public.faq_embedding_selesai(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.faq_knowledge_base
  SET perlu_embed_ulang = false,
      embedding_updated_at = now()
  WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.faq_embedding_selesai(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.faq_embedding_selesai(uuid) TO service_role;

-- 4. Backfill: tandai baris yang embedding-nya NULL agar diproses.
UPDATE public.faq_knowledge_base SET perlu_embed_ulang = true WHERE embedding IS NULL;

-- 5. Penjadwalan pemanggilan embed dilakukan oleh VERCEL CRON memanggil
--    /api/admin/faq/embed?mode=cron (lihat vercel.json), karena pembuatan
--    embedding memerlukan akses ke Gemini (tidak bisa dari pg_cron).
--    Tidak ada pg_cron semu di sini.
