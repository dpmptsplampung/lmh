-- Rollback manual migrasi 202610130002_faq_petugas_hanya_petugas.sql.
-- Memulihkan policy faq_petugas_all ke definisi 202607280003_faq_petugas_scope.sql (tanpa pemeriksaan peran).
-- Terapkan ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-faq-petugas-hanya-petugas-202610130002.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-faq-petugas-hanya-petugas-202610130002.sql --atomic
--
-- PERINGATAN: setelah rollback, Front Office yang baris `petugas`-nya punya layanan_id kembali boleh menulis FAQ
-- layanannya dan (bila 202610130001 masih terpasang) memindahkan baris antara FAQ umum dan FAQ layanan.
-- Bila rollback juga mencakup 202610130001, rollback-faq-umum-202610130001.sql dijalankan SETELAH berkas ini.

DROP POLICY IF EXISTS faq_petugas_all ON public.faq_knowledge_base;
CREATE POLICY faq_petugas_all ON public.faq_knowledge_base FOR ALL TO authenticated
  USING (layanan_id = public.get_my_layanan_id())
  WITH CHECK (layanan_id = public.get_my_layanan_id());
