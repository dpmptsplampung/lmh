-- Rollback manual migrasi 202610080001_rbac_tahap0_keamanan.sql (pakai hanya bila dibutuhkan).
-- PERINGATAN: ini MENGEMBALIKAN celah keamanan S1-S5 (RPC tanpa cek role, INSERT "selalu boleh",
-- petugas menyetujui absensi sendiri). Dipakai hanya bila migrasi memutus alur produksi dan
-- perbaikan-maju belum siap.
-- Bila 202610080002 sudah diterapkan, jalankan docs/rollback-rbac-tahap0-202610080002.sql TERLEBIH DAHULU.
-- Terapkan secara ATOMIK:  node scripts/apply-migration.mjs docs/rollback-rbac-tahap0-202610080001.sql --atomic --yes
--
-- YANG SENGAJA TIDAK DIKEMBALIKAN:
--  * guard_absensi_tanggal_today(): versi lama RUSAK (`pg_catalog.CURRENT_DATE` tidak valid, semua INSERT
--    absensi gagal). Versi benar (tanggal WIB) dipertahankan.
--  * cron `absensi_alpa_otomatis` tetap DIJEDA (active=false). Untuk menyalakan lagi (menandai alpa
--    pukul 10:00 WIB): SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname='absensi_alpa_otomatis'), active := true);

-- 1. Policy absensi lama
DROP POLICY IF EXISTS absensi_insert_admin ON public.absensi_petugas;
DROP POLICY IF EXISTS absensi_update_admin ON public.absensi_petugas;
DROP POLICY IF EXISTS absensi_select_own ON public.absensi_petugas;
CREATE POLICY absensi_select_own ON public.absensi_petugas FOR SELECT TO authenticated
  USING (
    petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    OR public.get_my_role() = 'admin'
  );
DROP POLICY IF EXISTS absensi_insert_own ON public.absensi_petugas;
CREATE POLICY absensi_insert_own ON public.absensi_petugas FOR INSERT TO authenticated
  WITH CHECK (
    petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    OR public.get_my_role() = 'admin'
  );
DROP POLICY IF EXISTS absensi_update_own ON public.absensi_petugas;
CREATE POLICY absensi_update_own ON public.absensi_petugas FOR UPDATE TO authenticated
  USING (
    petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    OR public.get_my_role() = 'admin'
  )
  WITH CHECK (
    petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    OR public.get_my_role() = 'admin'
  );

-- 2. Policy kunjungan / tiket_antrean / visit lama
DROP POLICY IF EXISTS kunjungan_insert_public ON public.kunjungan;
CREATE POLICY kunjungan_insert_public ON public.kunjungan FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS tiket_insert_public ON public.tiket_antrean;
CREATE POLICY tiket_insert_public ON public.tiket_antrean FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS visit_insert_walk_in ON public.visit;
CREATE POLICY visit_insert_walk_in ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'walk_in'
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('visit_insert_walk_in', 5, 60))
    AND (pengunjung_id IS NULL OR pengunjung_id IN (
      SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid()
    ))
  );
DROP POLICY IF EXISTS visit_insert_reservasi ON public.visit;
CREATE POLICY visit_insert_reservasi ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'reservasi'
    AND pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
  );

-- 3. Fungsi internal kembali terbuka untuk authenticated
GRANT EXECUTE ON FUNCTION public.terbit_tiket(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_nomor_antrean(uuid, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.skm_rr_tambah(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.match_dokumen(extensions.vector, double precision, integer, uuid) TO authenticated;

-- 4. Fungsi: definisi lama (salinan persis dari produksi sebelum migrasi). ACL tidak berubah oleh
--    CREATE OR REPLACE (authenticated + service_role).
DROP FUNCTION IF EXISTS public.setujui_absensi(uuid, text);

CREATE OR REPLACE FUNCTION public.catat_absensi(p_petugas_id uuid, p_sumber text, p_dicatat_oleh uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_id uuid;
  v_tanggal date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF p_sumber NOT IN ('fo','petugas_ajukan','otomatis') THEN
    RAISE EXCEPTION 'sumber absensi tidak valid';
  END IF;

  -- Jam diambil dari SERVER (now()), TIDAK bisa diatur mundur (I-09).
  INSERT INTO public.absensi_petugas (petugas_id, tanggal, jam_masuk, status, sumber, dicatat_oleh)
  VALUES (p_petugas_id, v_tanggal, now(),
          CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END,
          p_sumber, COALESCE(p_dicatat_oleh, p_petugas_id))
  ON CONFLICT (petugas_id, tanggal)
  DO UPDATE SET jam_masuk = COALESCE(public.absensi_petugas.jam_masuk, now()),
                status = CASE WHEN public.absensi_petugas.status = 'alpa' THEN 'approved' ELSE public.absensi_petugas.status END
  RETURNING id INTO v_id;

  -- Buka antrean layanan hari ini (SCH-02): tandai layanan_hari 'dibuka'.
  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  SELECT p.layanan_id, v_tanggal, 'dibuka'
  FROM public.petugas p WHERE p.id = p_petugas_id AND p.layanan_id IS NOT NULL
  ON CONFLICT (layanan_id, tanggal) DO UPDATE
    SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $function$;

CREATE OR REPLACE FUNCTION public.catat_pulang(p_petugas_id uuid)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_jam_pulang timestamptz := now();
  v_tanggal    date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  UPDATE public.absensi_petugas
  SET jam_pulang = v_jam_pulang
  WHERE petugas_id = p_petugas_id
    AND tanggal = v_tanggal
    AND jam_pulang IS NULL; -- Idempoten: jangan timpa pulang yang sudah dicatat

  RETURN v_jam_pulang;
END $function$;

CREATE OR REPLACE FUNCTION public.get_my_layanan_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT staff.layanan_id FROM public.petugas AS staff WHERE staff.auth_user_id = auth.uid()
$function$;

CREATE OR REPLACE FUNCTION public.is_ptsp_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.petugas AS staff
    JOIN public.layanan AS lyn ON lyn.id = staff.layanan_id
    WHERE staff.auth_user_id = auth.uid() AND lyn.is_ptsp
  )
$function$;

CREATE OR REPLACE FUNCTION public.panggil_tiket(p_tiket_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_nomor_display text;
  v_layanan_id    uuid;
BEGIN
  SELECT t.nomor_display, t.layanan_id
    INTO v_nomor_display, v_layanan_id
  FROM public.tiket_antrean AS t
  WHERE t.id = p_tiket_id
    AND t.status = 'menunggu';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Emit a Postgres NOTIFY event; Supabase Realtime or a listening process
  -- can forward this to the display screen (DSP-08 hook).
  PERFORM pg_notify(
    'nomor_dipanggil',
    json_build_object(
      'tiket_id',      p_tiket_id,
      'nomor_display', v_nomor_display,
      'layanan_id',    v_layanan_id
    )::text
  );

  RETURN v_nomor_display;
END $function$;

CREATE OR REPLACE FUNCTION public.petugas_set_aktif(p_petugas_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF public.get_my_role() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'hanya Admin yang boleh mengaktifkan kembali (RBA-08)';
  END IF;
  UPDATE public.petugas
  SET aktif = true,
      nonaktif_sejak = NULL,
      nonaktif_oleh = NULL,
      nonaktif_alasan = NULL
  WHERE id = p_petugas_id;
END $function$;

CREATE OR REPLACE FUNCTION public.petugas_set_nonaktif(p_petugas_id uuid, p_alasan text, p_actor uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF p_alasan IS NULL OR btrim(p_alasan) = '' THEN
    RAISE EXCEPTION 'alasan nonaktif wajib diisi (RBA-08)';
  END IF;
  UPDATE public.petugas
  SET aktif = false,
      nonaktif_sejak = now(),
      nonaktif_oleh = p_actor,
      nonaktif_alasan = p_alasan
  WHERE id = p_petugas_id;
END $function$;

CREATE OR REPLACE FUNCTION public.set_user_role_claim(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  user_role text;
BEGIN
  SELECT staff.role INTO user_role
  FROM public.petugas AS staff
  WHERE staff.auth_user_id = (event->>'user_id')::uuid;

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
$function$;

-- 5. Helper baru dibuang terakhir (tidak ada lagi policy yang memakainya setelah langkah 1).
DROP FUNCTION IF EXISTS public.boleh_layanan(uuid);
DROP FUNCTION IF EXISTS public.staf_saya();
