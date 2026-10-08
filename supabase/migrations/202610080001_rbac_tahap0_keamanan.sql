-- 202610080001_rbac_tahap0_keamanan.sql
-- RBAC Tahap 0 "keamanan darurat" (docs/RBAC_USULAN_DRAFT.md S1-S6 + N7).
--
-- Menutup celah yang bisa dipanggil langsung lewat PostgREST/RPC oleh siapa pun yang
-- login (termasuk anon sign-in pengunjung):
--   1. Helper akses: staf_saya(), boleh_layanan(); get_my_layanan_id()/is_ptsp_staff()
--      kini memeriksa petugas.aktif (S5).
--   2. Fungsi SECURITY DEFINER memeriksa pemanggil di badan fungsi (S1, S2, S3).
--      auth.role() = 'service_role' (route server) tetap lolos.
--      Fungsi internal (terbit_tiket, terbit_nomor_antrean, skm_rr_tambah, match_dokumen)
--      dicabut EXECUTE-nya dari anon/authenticated: hanya dipanggil trigger SECURITY
--      DEFINER milik postgres, atau service_role.
--   3. Policy INSERT `WITH CHECK (true)` pada kunjungan & tiket_antrean dihapus (S4).
--      Check-in publik menulis ke `visit`; kunjungan/tiket dibuat trigger dual-write
--      SECURITY DEFINER (pemilik postgres, RLS tidak FORCE) sehingga TIDAK terpengaruh.
--      Policy INSERT `visit` diperketat (status awal terkunci).
--   4. absensi_petugas: petugas tidak lagi menulis langsung (S3); persetujuan lewat
--      RPC setujui_absensi (admin/front_office aktif).
--   5. Auth Hook set_user_role_claim: akun nonaktif tidak mendapat role (N7).
--
-- TIDAK termasuk (migrasi terpisah 202610080002, diterapkan setelah UI diganti):
--   pencabutan UPDATE petugas pada `layanan`, jalur jadwal via is_ptsp_staff, dan penulisan
--   jadwal/libur/standby/pengecualian oleh FO (S6 + keputusan CEO: jadwal = Admin saja).
--
-- PENERAPAN: gunakan mode ATOMIK (satu transaksi, rollback otomatis bila ada galat):
--   node scripts/apply-migration.mjs supabase/migrations/202610080001_rbac_tahap0_keamanan.sql --atomic --yes
-- Mode lama (per-statement) TIDAK atomik. Lihat docs/MIGRATIONS.md dan
-- docs/RUNBOOK_RBAC_TAHAP0.md. Urutan di dalam file: perubahan yang bisa memutus check-in
-- (policy kunjungan/tiket/visit) sengaja PALING AKHIR.
--
-- CATATAN: catat_absensi tetap 3 argumen (CREATE OR REPLACE, atomik; DROP hanya bentuk 4-argumen
-- lama bila ada, lihat bagian 0). Fitur foto absensi +
-- bucket (202608310003) DIGANTI stub no-op dan dikerjakan di migrasi Tahap 1.
--
-- Bug produksi yang ikut diperbaiki: guard_absensi_tanggal_today() (lihat bagian 4).
-- Cron `absensi_alpa_otomatis` DIJEDA di bagian 4b (rekomendasi F6) agar perbaikan guard tidak
-- tiba-tiba menandai seluruh petugas "alpa" pukul 10:00 WIB. Aktifkan kembali secara sadar:
-- lihat docs/RUNBOOK_RBAC_TAHAP0.md.
--
-- Rollback: docs/rollback-rbac-tahap0-202610080001.sql

-- ============================================================
-- 0. Pembersihan lingkungan lain: bentuk 4-argumen catat_absensi hanya ada bila versi LAMA
--    202608310003 pernah diterapkan (produksi: TIDAK, jadi pernyataan ini no-op). Tanpa ini,
--    lingkungan seperti itu punya dua overload ber-default dan panggilan 3-argumen menjadi
--    ambigu. Ini satu-satunya DROP catat_absensi; bentuk 3-argumen TIDAK pernah di-DROP
--    (CREATE OR REPLACE di bagian 4 = atomik, tanpa jendela tanpa fungsi). Kolom foto_url
--    (bila ada) dibiarkan.
-- ============================================================
DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid, text);

-- ============================================================
-- 1. Helper akses
-- ============================================================
CREATE OR REPLACE FUNCTION public.staf_saya()
RETURNS TABLE (id uuid, role text, layanan_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT staff.id, staff.role, staff.layanan_id
  FROM public.petugas AS staff
  WHERE staff.auth_user_id = auth.uid() AND staff.aktif = true
$$;

REVOKE ALL ON FUNCTION public.staf_saya() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staf_saya() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.boleh_layanan(p_layanan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staf_saya() AS me
    WHERE me.role IN ('admin', 'front_office')
       OR (me.role = 'petugas' AND p_layanan IS NOT NULL AND me.layanan_id = p_layanan)
  )
$$;

REVOKE ALL ON FUNCTION public.boleh_layanan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_layanan(uuid) TO authenticated, service_role;

-- S5: petugas nonaktif tidak lagi lolos policy berbasis layanan.
CREATE OR REPLACE FUNCTION public.get_my_layanan_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT staff.layanan_id FROM public.petugas AS staff
  WHERE staff.auth_user_id = auth.uid() AND staff.aktif = true
$$;

CREATE OR REPLACE FUNCTION public.is_ptsp_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.petugas AS staff
    JOIN public.layanan AS lyn ON lyn.id = staff.layanan_id
    WHERE staff.auth_user_id = auth.uid() AND staff.aktif = true AND lyn.is_ptsp
  )
$$;

-- ============================================================
-- 2. N7: Auth Hook hanya memberi role kepada akun AKTIF.
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_user_role_claim(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT staff.role INTO user_role
  FROM public.petugas AS staff
  WHERE staff.auth_user_id = (event->>'user_id')::uuid
    AND staff.aktif = true;

  user_role := COALESCE(user_role, 'pengunjung');
  event := pg_catalog.jsonb_set(
    event,
    '{claims,app_metadata}',
    COALESCE(event->'claims'->'app_metadata', '{}'::jsonb),
    true
  );
  event := pg_catalog.jsonb_set(
    event,
    '{claims,app_metadata,role}',
    pg_catalog.to_jsonb(user_role),
    true
  );
  RETURN event;
END
$$;

-- ============================================================
-- 3. Fungsi akun: nonaktifkan / aktifkan kembali (S1, S11)
-- ============================================================
CREATE OR REPLACE FUNCTION public.petugas_set_nonaktif(
  p_petugas_id uuid,
  p_alasan     text,
  p_actor      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_actor   uuid;
  v_target  public.petugas%ROWTYPE;
BEGIN
  IF p_alasan IS NULL OR btrim(p_alasan) = '' THEN
    RAISE EXCEPTION 'alasan nonaktif wajib diisi (RBA-08)';
  END IF;

  IF v_service THEN
    -- Route server (sudah memverifikasi admin aktif) menyuplai p_actor.
    v_actor := p_actor;
  ELSE
    -- Pemanggil langsung: hanya Admin aktif; p_actor TIDAK dipercaya.
    SELECT me.id INTO v_actor FROM public.staf_saya() AS me WHERE me.role = 'admin';
    IF v_actor IS NULL THEN
      RAISE EXCEPTION 'hanya Admin aktif yang boleh menonaktifkan akun' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Serialkan penonaktifan agar dua permintaan bersamaan tidak sama-sama lolos cek "admin terakhir".
  PERFORM 1 FROM public.petugas WHERE role = 'admin' AND aktif = true FOR UPDATE;

  SELECT * INTO v_target FROM public.petugas WHERE id = p_petugas_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petugas tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_target.id = v_actor THEN
    RAISE EXCEPTION 'tidak boleh menonaktifkan akun sendiri';
  END IF;
  IF NOT v_target.aktif THEN
    RETURN; -- idempoten: sudah nonaktif
  END IF;
  IF v_target.role = 'admin' AND NOT EXISTS (
    SELECT 1 FROM public.petugas AS a
    WHERE a.role = 'admin' AND a.aktif = true AND a.id <> v_target.id
  ) THEN
    RAISE EXCEPTION 'tidak boleh menonaktifkan Admin aktif terakhir';
  END IF;

  UPDATE public.petugas
  SET aktif = false,
      nonaktif_sejak = now(),
      nonaktif_oleh = v_actor,
      nonaktif_alasan = p_alasan
  WHERE id = p_petugas_id;
END $$;

REVOKE ALL ON FUNCTION public.petugas_set_nonaktif(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_set_nonaktif(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.petugas_set_aktif(p_petugas_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- service_role (route server, auth.uid() NULL) lolos; pemanggil langsung harus Admin aktif.
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.staf_saya() AS me WHERE me.role = 'admin') THEN
    RAISE EXCEPTION 'hanya Admin yang boleh mengaktifkan kembali (RBA-08)' USING ERRCODE = '42501';
  END IF;

  UPDATE public.petugas
  SET aktif = true,
      nonaktif_sejak = NULL,
      nonaktif_oleh = NULL,
      nonaktif_alasan = NULL
  WHERE id = p_petugas_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'petugas tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.petugas_set_aktif(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_set_aktif(uuid) TO authenticated, service_role;

-- ============================================================
-- 4. Absensi (S2, S3)
-- ============================================================
-- BUG PRODUKSI yang ditemukan saat uji perilaku: guard_absensi_tanggal_today() memakai
-- `pg_catalog.CURRENT_DATE` (CURRENT_DATE adalah kata kunci SQL, bukan fungsi) sehingga SETIAP
-- INSERT absensi_petugas gagal "missing FROM-clause entry for table pg_catalog" (catat_absensi,
-- tandai_alpa_otomatis, tulis langsung). Perbaikan: bandingkan dengan tanggal WIB (aturan proyek).
CREATE OR REPLACE FUNCTION public.guard_absensi_tanggal_today()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.tanggal <> (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION 'Tanggal absensi harus hari ini';
  END IF;
  RETURN NEW;
END
$$;

-- 3 argumen dipertahankan (CREATE OR REPLACE, atomik; tanpa DROP/overload).
CREATE OR REPLACE FUNCTION public.catat_absensi(
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
  v_verif    boolean := false;  -- Admin/FO memverifikasi kehadiran fisik (bukan service_role)
  v_timpa    boolean := false;  -- hanya Admin yang boleh membalik 'ditolak'
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
    v_dicatat := v_me_id;                -- identitas pencatat dari sesi, bukan dari parameter
    v_verif := (p_sumber = 'fo');        -- cek di atas menjamin pemanggilnya Admin/FO
    v_timpa := (p_sumber = 'fo' AND v_me_role = 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.petugas WHERE id = p_petugas_id AND aktif = true) THEN
    RAISE EXCEPTION 'petugas tidak ditemukan atau nonaktif' USING ERRCODE = 'P0002';
  END IF;

  -- Jam diambil dari SERVER (now()), TIDAK bisa diatur mundur (I-09).
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
    -- Admin/FO (sumber 'fo') menaikkan 'pending'/'alpa' menjadi 'approved'; 'ditolak' hanya
    -- dibalik Admin. Pengajuan petugas TIDAK pernah menaikkan status ('alpa' -> 'pending').
    -- service_role/'otomatis': perilaku lama ('alpa' -> 'approved', lainnya tetap).
    status      = CASE
                    WHEN public.absensi_petugas.status = 'approved' THEN 'approved'
                    WHEN public.absensi_petugas.status IN ('pending', 'alpa') AND v_verif THEN 'approved'
                    WHEN public.absensi_petugas.status = 'ditolak' AND v_timpa THEN 'approved'
                    WHEN public.absensi_petugas.status = 'alpa'
                      THEN CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END
                    ELSE public.absensi_petugas.status
                  END,
    -- approved_by HANYA ditimpa bila status benar-benar naik (kondisi sama dengan CASE status di atas).
    approved_by = CASE
                    WHEN (public.absensi_petugas.status IN ('pending', 'alpa') AND v_verif)
                      OR (public.absensi_petugas.status = 'ditolak' AND v_timpa) THEN v_me_id
                    ELSE public.absensi_petugas.approved_by
                  END
  RETURNING id INTO v_id;

  -- Buka antrean layanan hari ini (SCH-02): tandai layanan_hari 'dibuka'.
  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  SELECT p.layanan_id, v_tanggal, 'dibuka'
  FROM public.petugas AS p WHERE p.id = p_petugas_id AND p.layanan_id IS NOT NULL
  ON CONFLICT (layanan_id, tanggal) DO UPDATE
    SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.catat_absensi(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_absensi(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.catat_pulang(p_petugas_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id      uuid;
  v_me_role    text;
  v_jam_pulang timestamptz := now();
  v_tanggal    date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
    IF v_me_id IS NULL THEN
      RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
    END IF;
    IF p_petugas_id IS DISTINCT FROM v_me_id AND v_me_role NOT IN ('admin', 'front_office') THEN
      RAISE EXCEPTION 'hanya boleh mencatat pulang diri sendiri' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.absensi_petugas
  SET jam_pulang = v_jam_pulang
  WHERE petugas_id = p_petugas_id
    AND tanggal = v_tanggal
    AND jam_pulang IS NULL; -- Idempoten: jangan timpa pulang yang sudah dicatat

  RETURN v_jam_pulang;
END $$;

REVOKE ALL ON FUNCTION public.catat_pulang(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_pulang(uuid) TO authenticated, service_role;

-- Persetujuan/penolakan absensi: satu-satunya jalur bagi Admin/FO (menggantikan UPDATE langsung).
CREATE OR REPLACE FUNCTION public.setujui_absensi(p_absensi_id uuid, p_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_service boolean := COALESCE(auth.role(), '') = 'service_role';
  v_me_id   uuid;
  v_me_role text;
BEGIN
  IF p_status NOT IN ('approved', 'ditolak') THEN
    RAISE EXCEPTION 'status persetujuan tidak valid';
  END IF;
  IF NOT v_service THEN
    SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
    IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
      RAISE EXCEPTION 'hanya Admin/Front Office yang boleh menyetujui absensi' USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.absensi_petugas
  SET status = p_status, approved_by = v_me_id
  WHERE id = p_absensi_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'absensi tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.setujui_absensi(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.setujui_absensi(uuid, text) TO authenticated, service_role;

-- Policy absensi: petugas hanya MEMBACA miliknya; tulis langsung hanya Admin aktif.
DROP POLICY IF EXISTS absensi_select_own ON public.absensi_petugas;
CREATE POLICY absensi_select_own ON public.absensi_petugas FOR SELECT TO authenticated
  USING (
    petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    OR public.get_my_role() = 'admin'
  );

DROP POLICY IF EXISTS absensi_insert_own ON public.absensi_petugas;
DROP POLICY IF EXISTS absensi_update_own ON public.absensi_petugas;
DROP POLICY IF EXISTS absensi_insert_admin ON public.absensi_petugas;
CREATE POLICY absensi_insert_admin ON public.absensi_petugas FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');
DROP POLICY IF EXISTS absensi_update_admin ON public.absensi_petugas;
CREATE POLICY absensi_update_admin ON public.absensi_petugas FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- 4b. F6: setelah guard diperbaiki, cron `absensi_alpa_otomatis` (tiap 5 menit) akan MULAI
--     berhasil: tiap hari kerja pukul 10:00 WIB menulis status 'alpa' untuk SEMUA petugas
--     layanan yang belum punya absensi approved. Hari ini cron itu gagal terus (rollback) sejak
--     2026-08-31, jadi dijeda = perilaku produksi sekarang tidak berubah. Aktifkan lagi nanti:
--       SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='absensi_alpa_otomatis'), active := true);
DO $$
DECLARE
  v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'absensi_alpa_otomatis';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, active := false);
  ELSE
    -- WARNING (bukan EXCEPTION): lingkungan tanpa job itu tidak perlu menggagalkan seluruh migrasi atomik.
    -- Mode --atomic mencetak NOTICE/WARNING ini; tes perilaku seksi 9 gagal keras bila job ada tetapi aktif.
    RAISE WARNING 'cron job absensi_alpa_otomatis tidak ditemukan: tidak ada yang dijeda';
  END IF;
END $$;

-- ============================================================
-- 5. Antrean: panggil_tiket + fungsi internal (S2)
-- ============================================================
CREATE OR REPLACE FUNCTION public.panggil_tiket(p_tiket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_nomor_display text;
  v_layanan_id    uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.staf_saya()) THEN
      RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT t.nomor_display, t.layanan_id
    INTO v_nomor_display, v_layanan_id
  FROM public.tiket_antrean AS t
  WHERE t.id = p_tiket_id
    AND t.status = 'menunggu';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.boleh_layanan(v_layanan_id) THEN
    RAISE EXCEPTION 'tiket bukan milik layanan Anda' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_notify(
    'nomor_dipanggil',
    json_build_object(
      'tiket_id',      p_tiket_id,
      'nomor_display', v_nomor_display,
      'layanan_id',    v_layanan_id
    )::text
  );

  RETURN v_nomor_display;
END $$;

REVOKE ALL ON FUNCTION public.panggil_tiket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panggil_tiket(uuid) TO authenticated, service_role;

-- Fungsi internal: hanya dipanggil trigger SECURITY DEFINER (pemilik postgres) / service_role.
-- Pemanggil: sync_visit_dual_write -> terbit_tiket -> terbit_nomor_antrean;
--            trg_skm_insert_rr & trg_visit_selesai_rr -> skm_rr_tambah.
-- match_dokumen tidak dipanggil dari src/ (RAG dokumen belum dipakai bot).
REVOKE ALL ON FUNCTION public.terbit_tiket(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_tiket(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.terbit_nomor_antrean(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_nomor_antrean(uuid, date) TO service_role;
REVOKE ALL ON FUNCTION public.skm_rr_tambah(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skm_rr_tambah(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.match_dokumen(extensions.vector, double precision, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_dokumen(extensions.vector, double precision, integer, uuid) TO service_role;

-- ============================================================
-- 6. S4: hapus INSERT "selalu boleh" pada kunjungan & tiket_antrean.
--    Tanpa policy INSERT -> ditolak untuk anon/authenticated. Trigger dual-write
--    (SECURITY DEFINER, pemilik postgres) tetap menulis.
-- ============================================================
DROP POLICY IF EXISTS kunjungan_insert_public ON public.kunjungan;
DROP POLICY IF EXISTS tiket_insert_public ON public.tiket_antrean;

-- visit adalah pintu check-in publik: status awal dikunci agar pengunjung tidak bisa
-- menyisipkan visit 'selesai'/'dilayani' (tiket palsu di layar TV / bypass SKM).
DROP POLICY IF EXISTS visit_insert_walk_in ON public.visit;
CREATE POLICY visit_insert_walk_in ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'walk_in'
    AND status IN ('menunggu', 'terjadwal')
    AND waktu_mulai_layan IS NULL
    AND waktu_selesai IS NULL
    AND waktu_scan IS NULL
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('visit_insert_walk_in', 5, 60))
    AND (pengunjung_id IS NULL OR pengunjung_id IN (
      SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS visit_insert_reservasi ON public.visit;
CREATE POLICY visit_insert_reservasi ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'reservasi'
    AND status = 'terjadwal'
    AND waktu_mulai_layan IS NULL
    AND waktu_selesai IS NULL
    AND waktu_scan IS NULL
    AND pengunjung_id IN (
      SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid()
    )
  );
