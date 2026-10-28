-- docs/rollback-koordinator-akses-data-202610290001.sql
-- Rollback 202610290001_koordinator_akses_data (Fase 3). HANYA pemilik, atomik, dry-run dulu:
--   node scripts/apply-migration.mjs docs/rollback-koordinator-akses-data-202610290001.sql --atomic --dry-run
-- URUTAN: SETELAH docs/rollback-rekap-terpadu-202610290002.sql (penjaga di bawah). Memulihkan keterbukaan antar FO
-- (202610140013): boleh_penanganan PERSIS 0013 (+ COMMENT penanda 0013, sehingga penjaga rollback 0012/0013 kembali
-- bekerja), boleh_kunjungan PERSIS 0009, policy baca/tulis Pendataan, rekap_harian_staff_read dan visit_select_own versi
-- 202610090001/202610140002. Hak RPC ambil alih dicabut. Kolom petugas.koordinator, tabel ambil_alih_pendataan, dan
-- helper baru DIBIARKAN (B1: data tidak dihapus; objek tidak lagi dipakai policy). Tanpa DROP objek/DELETE data.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.rekap_pelayanan_inti(date,date,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610290002 masih terpasang (jalankan docs/rollback-rekap-terpadu-202610290002.sql dulu)';
  END IF;
  IF COALESCE(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)'), 'pg_proc'), '') NOT LIKE '%202610290001%' THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610290001 tidak terpasang (penanda boleh_penanganan tidak ada)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.boleh_penanganan(
  p_kunjungan   uuid,
  p_peran_tahap text,
  p_layanan     uuid,
  p_penangan    uuid,
  p_status      text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_saya() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  IF v_role = 'front_office' THEN
    -- Keputusan CEO 2026-10-14 (202610140013): semua FO satu unit layanan; baca saja, tulis tetap lewat RPC pemilik.
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    ) OR EXISTS (
      -- Tahap C: kunjungan chat yang sesinya sedang berada di layanan petugas (ambil langsung / setelah diteruskan).
      SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
      WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS
  '202610140013: RLS baca penanganan. Admin & Front Office semua (keputusan CEO 2026-10-14: keterbukaan antar FO, baca saja); petugas layanannya + konteks.';

CREATE OR REPLACE FUNCTION public.boleh_kunjungan(p_kunjungan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.staf_saya() AS me WHERE me.role IN ('admin', 'front_office'))
      OR EXISTS (
        SELECT 1 FROM public.tiket_antrean AS t
        WHERE t.kunjungan_id = p_kunjungan AND public.boleh_layanan(t.layanan_id)
      )
      OR EXISTS (
        -- Tahap C: kunjungan chat yang sesinya sedang berada di layanan petugas.
        SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
        WHERE k.id = p_kunjungan AND k.asal = 'online' AND public.boleh_layanan(s.layanan_id)
      )
$$;

REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_kunjungan(uuid) IS NULL;

-- Pendataan: baca versi 202610090001, tulis versi 202610140002.
DROP POLICY IF EXISTS oss_read_staff ON public.pelayanan_oss;
CREATE POLICY oss_read_staff ON public.pelayanan_oss FOR SELECT TO authenticated
  USING (public.boleh_tiket(tiket_id));
DROP POLICY IF EXISTS perizinan_read_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_read_staff ON public.pelayanan_perizinan FOR SELECT TO authenticated
  USING (public.boleh_tiket(tiket_id));

DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
    AND public.pemilik_tiket(tiket_id)
  );
DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id));
DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
    AND public.pemilik_tiket(tiket_id)
  );
DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id));

-- Agregat lama dan arsip visit: versi 202610090001.
DROP POLICY IF EXISTS rekap_harian_staff_read ON public.rekap_harian_layanan;
CREATE POLICY rekap_harian_staff_read ON public.rekap_harian_layanan FOR SELECT TO authenticated
  USING (public.boleh_layanan(layanan_id));
DROP POLICY IF EXISTS visit_select_own ON public.visit;
CREATE POLICY visit_select_own ON public.visit FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid())
    OR public.boleh_layanan(layanan_id)
  );

-- Pemicu pencabutan penanda Koordinator (petugas.koordinator dibiarkan; tidak dipakai policy lagi).
DROP TRIGGER IF EXISTS trg_petugas_cabut_koordinator ON public.petugas;

-- RPC ambil alih Koordinator dan status QR tidak lagi dapat dipanggil klien.
REVOKE ALL ON FUNCTION public.koordinator_ambil_alih_tiket(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.koordinator_ambil_alih_fo(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ambil_alih_tandai_dilihat(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fo_status_qr(text) FROM PUBLIC, anon, authenticated;
