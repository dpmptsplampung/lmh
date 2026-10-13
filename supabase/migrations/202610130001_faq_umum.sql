-- 202610130001_faq_umum.sql
-- FAQ umum (tanpa layanan): keputusan CEO + spec docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md §3.3.
--
-- FAQ yang berlaku untuk SEMUA layanan (jam buka kantor, alamat, cara mengurus akun OSS, dst.) disimpan
-- sebagai baris `faq_knowledge_base` dengan `layanan_id IS NULL`. Hak kelola:
--   - Admin          : semua baris (faq_admin_all, tidak diubah).
--   - Front Office   : HANYA baris umum (policy baru faq_fo_umum: layanan_id IS NULL).
--   - Petugas layanan: HANYA FAQ layanannya (faq_petugas_all, tidak diubah). Baris umum tidak terjangkau
--                      karena `layanan_id = get_my_layanan_id()` bernilai NULL (bukan true) bila salah satu
--                      sisinya NULL; ini berlaku juga untuk petugas tanpa layanan (NULL = NULL tetap NULL).
--   - Publik/anon    : membaca baris aktif (faq_public_read, tidak diubah; baris umum ikut terbaca).
-- Alternatif "layanan semu Umum" ditolak: mencemari daftar layanan publik, antrean, jadwal, dan rekap.
--
-- Isi migrasi:
--   1. faq_knowledge_base.layanan_id: DROP NOT NULL (NULL = FAQ umum). FK ke layanan, indeks idx_faq_layanan,
--      trigger audit trg_audit_faq, trigger trg_faq_reembed, dan kolom fts tidak bergantung pada NOT NULL.
--   2. Policy faq_fo_umum (FOR ALL TO authenticated): USING dan WITH CHECK sama-sama
--      `layanan_id IS NULL AND get_my_role() = 'front_office'`. FO tidak dapat menulis FAQ layanan mana pun
--      dan tidak dapat memindahkan baris umum ke sebuah layanan (WITH CHECK).
--   3. match_faq_teks (FTS/trigram, bot tingkat 0): `(layanan_id = p_layanan OR layanan_id IS NULL)`; pada skor
--      yang sama FAQ layanan diurutkan sebelum FAQ umum. Kolom hasil, SECURITY DEFINER, search_path, dan
--      REVOKE/GRANT dipertahankan persis seperti 202609230002_faq_fts.sql.
--   4. match_faq (embedding 3072-dim): dengan p_layanan_id terisi -> `(layanan_id = p_layanan_id OR layanan_id
--      IS NULL)`; dengan NULL perilaku lama (semua baris). Pada jarak sama FAQ layanan diutamakan. Kolom hasil,
--      SECURITY DEFINER, search_path, dan REVOKE/GRANT dipertahankan persis seperti 202608080002.
--
-- Definisi SEBELUMNYA (sumber salinan): match_faq_teks = 202609230002_faq_fts.sql; match_faq =
-- 202608080002_faq_embedding_3072.sql (tidak ada migrasi lain yang mendefinisikan ulang keduanya; guard peran
-- 202610080001/202610090001 tidak menyentuh dua fungsi ini maupun policy FAQ).
-- Kedua fungsi memakai CREATE OR REPLACE (tanda tangan identik, tanpa DROP): tidak ada jendela tanpa fungsi.
-- Data FAQ yang sudah ada TIDAK diubah.
--
-- PENERAPAN: berkas ini mengubah policy dan fungsi, jadi WAJIB mode atomik (satu transaksi). Dry-run dulu:
--   node scripts/apply-migration.mjs supabase/migrations/202610130001_faq_umum.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610130001_faq_umum.sql --atomic
-- Idempoten (aman dijalankan dua kali). Sentuh produksi hanya setelah konfirmasi CEO (docs/ATURAN_MIGRASI.md).
-- Rollback: docs/rollback-faq-umum-202610130001.sql (menolak SET NOT NULL bila masih ada FAQ umum).

-- ============================================================
-- 1. layanan_id boleh NULL (NULL = FAQ umum)
-- ============================================================
ALTER TABLE public.faq_knowledge_base ALTER COLUMN layanan_id DROP NOT NULL;

COMMENT ON COLUMN public.faq_knowledge_base.layanan_id IS
  'Layanan pemilik FAQ. NULL = FAQ umum (berlaku untuk semua layanan, dikelola Front Office dan Admin).';

-- ============================================================
-- 2. Front Office mengelola FAQ umum (hanya baris umum)
-- ============================================================
DROP POLICY IF EXISTS faq_fo_umum ON public.faq_knowledge_base;
CREATE POLICY faq_fo_umum ON public.faq_knowledge_base FOR ALL TO authenticated
  USING (layanan_id IS NULL AND public.get_my_role() = 'front_office')
  WITH CHECK (layanan_id IS NULL AND public.get_my_role() = 'front_office');

-- ============================================================
-- 3. match_faq_teks: FAQ umum ikut dicari di semua layanan
-- ============================================================
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
    AND (f.layanan_id = p_layanan OR f.layanan_id IS NULL)
    AND (
      f.fts @@ websearch_to_tsquery('indonesian', public.unaccent_imm(p_q))
      OR f.pertanyaan % public.unaccent_imm(p_q)
    )
  ORDER BY skor DESC, (f.layanan_id IS NULL)
  LIMIT GREATEST(COALESCE(p_limit, 5), 1);
$$;

REVOKE ALL ON FUNCTION public.match_faq_teks(uuid, text, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.match_faq_teks(uuid, text, integer)
  TO authenticated, service_role;

-- ============================================================
-- 4. match_faq (embedding): FAQ umum ikut dicari bila layanan diberikan
-- ============================================================
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
    AND (p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id OR faq.layanan_id IS NULL)
  ORDER BY faq.embedding OPERATOR(extensions.<=>) query_embedding, (faq.layanan_id IS NULL)
  LIMIT match_count
$$;

REVOKE EXECUTE ON FUNCTION public.match_faq(extensions.vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_faq(extensions.vector, uuid, integer) TO authenticated;
