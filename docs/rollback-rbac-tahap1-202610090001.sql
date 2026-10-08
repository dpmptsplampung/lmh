-- Rollback manual migrasi 202610090001_rbac_tahap1.sql (kembali ke keadaan Tahap 0).
-- URUTAN ROLLBACK (kebalikan penerapan): 0005 -> 0004 -> 0003 -> 0002 -> 0001. Jangan melompati; lihat docs/RUNBOOK_RBAC_PENERAPAN.md.
-- Terapkan ATOMIK: node scripts/apply-migration.mjs docs/rollback-rbac-tahap1-202610090001.sql --atomic --yes
-- Tidak dihapus (data/aditif): kolom absensi_petugas.foto_url, bucket absensi-foto, site_settings.jam_tutup_layanan.
-- PERINGATAN: mengembalikan celah S8 (petugas dapat membuat data terkunci) dan kunjungan lintas layanan.

-- Guard check-in dulu (lepas ketergantungan pada layanan_sudah_tutup).
CREATE OR REPLACE FUNCTION public.guard_visit_layanan_buka()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tanggal date;
BEGIN
  IF NEW.layanan_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.asal = 'reservasi' THEN
    v_tanggal := NEW.tanggal_rencana;
  ELSE
    v_tanggal := COALESCE((NEW.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date,
                          (now() AT TIME ZONE 'Asia/Jakarta')::date);
  END IF;
  IF v_tanggal IS NULL THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_layanan_buka_jadwal(NEW.layanan_id, v_tanggal, NULL) THEN
    RAISE EXCEPTION 'Layanan tidak beroperasi pada tanggal tersebut (libur/di luar jadwal standby). Live chat tetap tersedia.';
  END IF;
  RETURN NEW;
END
$$;
DROP FUNCTION IF EXISTS public.layanan_sudah_tutup(timestamptz);
DROP FUNCTION IF EXISTS public.jam_tutup_layanan();

DO $$
DECLARE
  v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'antrean_tidak_terlayani_akhir_hari';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, schedule := '35 8 * * *');
  END IF;
END $$;

DROP POLICY IF EXISTS layanan_hari_admin_write ON public.layanan_hari;
CREATE POLICY layanan_hari_staff_write ON public.layanan_hari FOR ALL
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

-- catat_absensi kembali ke 3 argumen (definisi Tahap 0)
DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid, text);
CREATE FUNCTION public.catat_absensi(
  p_petugas_id   uuid,
  p_sumber       text,
  p_dicatat_oleh uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_service  boolean := COALESCE(auth.role(), '') = 'service_role';
  v_me_id    uuid;
  v_me_role  text;
  v_dicatat  uuid := p_dicatat_oleh;
  v_verif    boolean := false;
  v_timpa    boolean := false;
  v_id       uuid;
  v_tanggal  date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_sumber NOT IN ('fo', 'petugas_ajukan', 'otomatis') THEN
    RAISE EXCEPTION 'sumber absensi tidak valid';
  END IF;

  IF NOT v_service THEN
    SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
    IF v_me_id IS NULL THEN
      RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
    END IF;
    IF p_sumber = 'otomatis' THEN
      RAISE EXCEPTION 'sumber otomatis hanya untuk sistem' USING ERRCODE = '42501';
    ELSIF p_sumber = 'fo' AND v_me_role NOT IN ('admin', 'front_office') THEN
      RAISE EXCEPTION 'hanya Admin/Front Office yang boleh mencatat hadir atas nama orang lain' USING ERRCODE = '42501';
    ELSIF p_sumber = 'petugas_ajukan' AND p_petugas_id IS DISTINCT FROM v_me_id THEN
      RAISE EXCEPTION 'pengajuan hadir hanya untuk diri sendiri' USING ERRCODE = '42501';
    END IF;
    v_dicatat := v_me_id;
    v_verif := (p_sumber = 'fo');
    v_timpa := (p_sumber = 'fo' AND v_me_role = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.petugas WHERE id = p_petugas_id AND aktif = true) THEN
    RAISE EXCEPTION 'petugas tidak ditemukan atau nonaktif' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.absensi_petugas
    (petugas_id, tanggal, jam_masuk, status, sumber, dicatat_oleh, approved_by)
  VALUES (
    p_petugas_id, v_tanggal, now(),
    CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END,
    p_sumber, COALESCE(v_dicatat, p_petugas_id),
    CASE WHEN v_verif THEN v_me_id END
  )
  ON CONFLICT (petugas_id, tanggal)
  DO UPDATE SET
    jam_masuk   = COALESCE(public.absensi_petugas.jam_masuk, now()),
    status      = CASE
                    WHEN public.absensi_petugas.status = 'approved' THEN 'approved'
                    WHEN public.absensi_petugas.status IN ('pending', 'alpa') AND v_verif THEN 'approved'
                    WHEN public.absensi_petugas.status = 'ditolak' AND v_timpa THEN 'approved'
                    WHEN public.absensi_petugas.status = 'alpa'
                      THEN CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END
                    ELSE public.absensi_petugas.status
                  END,
    approved_by = CASE
                    WHEN (public.absensi_petugas.status IN ('pending', 'alpa') AND v_verif)
                      OR (public.absensi_petugas.status = 'ditolak' AND v_timpa) THEN v_me_id
                    ELSE public.absensi_petugas.approved_by
                  END
  RETURNING id INTO v_id;

  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  SELECT p.layanan_id, v_tanggal, 'dibuka'
  FROM public.petugas AS p WHERE p.id = p_petugas_id AND p.layanan_id IS NOT NULL
  ON CONFLICT (layanan_id, tanggal) DO UPDATE
    SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.catat_absensi(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_absensi(uuid, text, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS absensi_foto_insert ON storage.objects;
DROP POLICY IF EXISTS absensi_foto_select ON storage.objects;
DROP POLICY IF EXISTS absensi_select_own ON public.absensi_petugas;
CREATE POLICY absensi_select_own ON public.absensi_petugas FOR SELECT TO authenticated
  USING (
    petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    OR public.get_my_role() = 'admin'
  );

-- (policy baca pelayanan_* dikembalikan sesuai keadaan PRODUKSI: tanpa klausa nama ILIKE)
-- Pengaduan
DROP VIEW IF EXISTS public.v_pengaduan_petugas;
DROP POLICY IF EXISTS pengaduan_layanan_read ON public.pengaduan;
CREATE POLICY pengaduan_layanan_read ON public.pengaduan FOR SELECT
  USING (jalur = 'layanan' AND (
    public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id()
  ));
DROP POLICY IF EXISTS pengaduan_integritas_admin_only ON public.pengaduan;
CREATE POLICY pengaduan_integritas_admin_only ON public.pengaduan FOR SELECT
  USING (jalur = 'integritas' AND public.get_my_role() = 'admin');
DROP POLICY IF EXISTS pengaduan_update ON public.pengaduan;
CREATE POLICY pengaduan_update ON public.pengaduan FOR UPDATE
  USING (public.get_my_role() = 'admin' OR (jalur = 'layanan' AND public.get_my_role() = 'front_office'))
  WITH CHECK (public.get_my_role() = 'admin' OR (jalur = 'layanan' AND public.get_my_role() = 'front_office'));
DROP POLICY IF EXISTS pengaduan_riwayat_write ON public.pengaduan_riwayat;
CREATE POLICY pengaduan_riwayat_write ON public.pengaduan_riwayat FOR INSERT
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

-- Per layanan
DROP VIEW IF EXISTS public.v_skm_petugas;
DROP POLICY IF EXISTS skm_select_staff ON public.skm_respons;
CREATE POLICY skm_select_staff ON public.skm_respons FOR SELECT TO authenticated
  USING (layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
DROP POLICY IF EXISTS investasi_lead_select_staff ON public.investasi_lead;
CREATE POLICY investasi_lead_select_staff ON public.investasi_lead FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'petugas'));
DROP POLICY IF EXISTS rekap_harian_staff_read ON public.rekap_harian_layanan;
CREATE POLICY rekap_harian_staff_read ON public.rekap_harian_layanan FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office', 'petugas'));
DROP POLICY IF EXISTS visit_select_own ON public.visit;
CREATE POLICY visit_select_own ON public.visit FOR SELECT TO authenticated
  USING (pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
DROP POLICY IF EXISTS visit_update_staff ON public.visit;
CREATE POLICY visit_update_staff ON public.visit FOR UPDATE TO authenticated
  USING (layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin')
  WITH CHECK (layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
DROP POLICY IF EXISTS kunjungan_staff_select ON public.kunjungan;
CREATE POLICY kunjungan_staff_select ON public.kunjungan FOR SELECT
  USING (public.get_my_role() IN ('petugas','admin','front_office'));
DROP POLICY IF EXISTS kunjungan_staff_update ON public.kunjungan;
CREATE POLICY kunjungan_staff_update ON public.kunjungan FOR UPDATE
  USING (public.get_my_role() IN ('petugas','admin','front_office'));

-- Data pelayanan
DROP FUNCTION IF EXISTS public.koreksi_pelayanan(uuid, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.trg_enforce_pelayanan_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.is_locked = true AND (public.get_my_role() <> 'admin') THEN
    RAISE EXCEPTION 'Data pelayanan sudah terkunci dan tidak dapat diubah (is_locked=true)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP POLICY IF EXISTS oss_read_staff ON public.pelayanan_oss;
CREATE POLICY oss_read_staff ON public.pelayanan_oss FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'front_office')
    OR (public.get_my_role() = 'petugas' AND EXISTS (
      SELECT 1 FROM public.petugas p JOIN public.layanan l ON l.id = p.layanan_id
      WHERE p.auth_user_id = auth.uid()
        AND l.id = (SELECT layanan_id FROM public.tiket_antrean WHERE id = pelayanan_oss.tiket_id)))
  );
DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'petugas' AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())));
DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'petugas' AND is_locked = false
        AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())));
DROP POLICY IF EXISTS perizinan_read_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_read_staff ON public.pelayanan_perizinan FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'front_office')
    OR (public.get_my_role() = 'petugas' AND EXISTS (
      SELECT 1 FROM public.petugas p JOIN public.layanan l ON l.id = p.layanan_id
      WHERE p.auth_user_id = auth.uid()
        AND l.id = (SELECT layanan_id FROM public.tiket_antrean WHERE id = pelayanan_perizinan.tiket_id)))
  );
DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'petugas' AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())));
DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin'
    OR (public.get_my_role() = 'petugas' AND is_locked = false
        AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())));

DROP FUNCTION IF EXISTS public.boleh_kunjungan(uuid);
DROP FUNCTION IF EXISTS public.boleh_tiket(uuid);
DROP FUNCTION IF EXISTS public.peran_saya();
