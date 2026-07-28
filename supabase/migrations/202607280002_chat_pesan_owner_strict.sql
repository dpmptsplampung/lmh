-- Hardening: pengunjung (owner sesi) hanya boleh insert pesan sebagai dirinya.
-- Pesan 'bot' kini ditulis server-side (/api/chat/ai via service role);
-- pesan 'petugas' tetap butuh scope layanan.
BEGIN;

DROP POLICY "chat_pesan_owner_insert" ON public.chat_pesan;
CREATE POLICY "chat_pesan_owner_insert" ON public.chat_pesan FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chat_sesi
      WHERE id = chat_pesan.sesi_id
        AND (
          (pengirim = 'pengunjung'
            AND pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid()))
          OR (pengirim = 'petugas' AND layanan_id = public.get_my_layanan_id())
          OR public.get_my_role() = 'admin'
        )
    )
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('chat_pesan_insert', 20, 60))
  );

COMMIT;
