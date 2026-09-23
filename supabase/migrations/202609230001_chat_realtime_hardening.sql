-- 202609230001_chat_realtime_hardening.sql
-- CHAT-REALTIME-2: hardening jalur realtime chat + idempotensi pesan + RLS FO.
-- Idempoten: aman dijalankan berulang (publikasi & indeks dijaga pemeriksaan).

BEGIN;

-- 1. Publikasi realtime: pastikan chat_sesi & chat_pesan terpublikasi.
--    Tanpa ini listener postgres_changes di halaman pengunjung/petugas tidak
--    pernah menerima event -> "harus refresh". Guard agar re-run tidak error.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_sesi'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_sesi;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'chat_pesan'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_pesan;
  END IF;
END $$;

-- REPLICA IDENTITY FULL: set ulang adalah no-op bila sudah sama.
ALTER TABLE public.chat_sesi REPLICA IDENTITY FULL;
ALTER TABLE public.chat_pesan REPLICA IDENTITY FULL;

-- 2. Idempotensi pesan: satu baris per (sesi_id, client_uuid). Retry jaringan /
--    klik ganda tidak lagi menghasilkan pesan dobel di database.
DROP INDEX IF EXISTS idx_chat_pesan_client_uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_pesan_sesi_client_uuid
  ON public.chat_pesan(sesi_id, client_uuid)
  WHERE client_uuid IS NOT NULL;

-- 3. RLS: front_office punya pandangan lintas-layanan (RBA-02/CHT-08 takeover).
--    Sebelumnya FO tidak bisa melihat daftar sesi & pesan sama sekali.
DROP POLICY IF EXISTS "chat_sesi_owner_select" ON public.chat_sesi;
CREATE POLICY "chat_sesi_owner_select" ON public.chat_sesi FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id()
    OR public.get_my_role() IN ('admin', 'front_office')
  );

DROP POLICY IF EXISTS "chat_sesi_petugas_update" ON public.chat_sesi;
CREATE POLICY "chat_sesi_petugas_update" ON public.chat_sesi FOR UPDATE TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id()
    OR public.get_my_role() IN ('admin', 'front_office')
  )
  WITH CHECK (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id()
    OR public.get_my_role() IN ('admin', 'front_office')
  );

DROP POLICY IF EXISTS "chat_pesan_owner_select" ON public.chat_pesan;
CREATE POLICY "chat_pesan_owner_select" ON public.chat_pesan FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sesi
      WHERE id = chat_pesan.sesi_id
        AND (
          pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
          OR layanan_id = public.get_my_layanan_id()
          OR public.get_my_role() IN ('admin', 'front_office')
        )
    )
  );

COMMIT;
