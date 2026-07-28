-- Petugas layanan mengelola FAQ layanannya sendiri (scoped), admin tetap full.
-- Petugas juga dapat mengaktif/nonaktifkan chatbot untuk layanannya sendiri.
BEGIN;

CREATE POLICY "faq_petugas_all" ON public.faq_knowledge_base FOR ALL TO authenticated
  USING (layanan_id = public.get_my_layanan_id())
  WITH CHECK (layanan_id = public.get_my_layanan_id());

CREATE POLICY "layanan_admin_all" ON public.layanan FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "layanan_petugas_chatbot_toggle" ON public.layanan FOR UPDATE TO authenticated
  USING (id = public.get_my_layanan_id())
  WITH CHECK (id = public.get_my_layanan_id());

COMMIT;
