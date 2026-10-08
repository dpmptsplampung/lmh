-- 202610090001_rbac_tahap1.sql
-- RBAC Tahap 1 (sisi database): penegakan per layanan, koreksi data terkunci, jam tutup 16:00 WIB,
-- foto absensi, pengaduan tanpa identitas untuk petugas.
--
--  1. Helper: peran_saya(), boleh_tiket(), boleh_kunjungan() (semua hanya menghitung staf AKTIF).
--  2. Data pelayanan (pelayanan_oss/pelayanan_perizinan): INSERT/UPDATE hanya draf (tidak terkunci)
--     dan hanya untuk layanan yang berhak (S8); data terkunci TIDAK bisa diubah siapa pun lewat
--     UPDATE biasa. Satu-satunya jalur ubah data terkunci = RPC koreksi_pelayanan (Admin/FO,
--     alasan wajib, audit_log nilai lama -> baru).
--  3. Per layanan untuk petugas: kunjungan (SELECT/UPDATE), visit (FO/Admin ikut, S7),
--     rekap_harian_layanan, investasi_lead (Admin saja), skm_respons (rinci hanya Admin/FO;
--     petugas via view tanpa visit_id).
--  4. Jam tutup layanan: site_settings.jam_tutup_layanan (default 16:00 WIB); walk-in baru
--     ditolak mulai jam itu; job akhir-hari digeser ke 09:00 UTC (= 16:00 WIB);
--     layanan_hari tulis = Admin saja.
--  5. Foto absensi: kolom foto_url, bucket privat `absensi-foto` (hanya Admin/FO), catat_absensi
--     4 argumen (p_foto_url opsional) -- satu bentuk saja (DROP 3-arg + CREATE 4-arg, atomik).
--  6. Pengaduan: tabel hanya Admin/FO (jalur integritas Admin saja); petugas membaca lewat
--     v_pengaduan_petugas (tanpa kontak/lampiran/sesi chat).
--
-- PENERAPAN ATOMIK (jangan tanpa --atomic):
--   node scripts/apply-migration.mjs supabase/migrations/202610090001_rbac_tahap1.sql --atomic --yes
-- Rollback: docs/rollback-rbac-tahap1-202610090001.sql. Kontrak frontend: docs/RBAC_TAHAP1_KONTRAK.md

-- ============================================================
-- 1. Helper akses (hanya staf AKTIF)
-- ============================================================
CREATE OR REPLACE FUNCTION public.peran_saya()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT me.role FROM public.staf_saya() AS me
$$;

CREATE OR REPLACE FUNCTION public.boleh_tiket(p_tiket uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tiket_antrean AS t
    WHERE t.id = p_tiket AND public.boleh_layanan(t.layanan_id)
  )
$$;

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
$$;

REVOKE ALL ON FUNCTION public.peran_saya() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peran_saya() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.boleh_tiket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_tiket(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;

-- ============================================================
-- 2. Data pelayanan: kunci, RLS, koreksi
-- ============================================================
-- Trigger: baris terkunci TIDAK bisa di-UPDATE oleh siapa pun (termasuk Admin) kecuali di dalam
-- koreksi_pelayanan(), yang menyalakan flag transaksi-lokal `lmh.koreksi`. Flag tidak bisa diset
-- lewat PostgREST (hanya SQL langsung).
CREATE OR REPLACE FUNCTION public.trg_enforce_pelayanan_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.is_locked = true AND COALESCE(pg_catalog.current_setting('lmh.koreksi', true), '') <> 'on' THEN
    RAISE EXCEPTION 'LOCKED: Data pelayanan sudah terkunci dan tidak dapat diubah (gunakan koreksi_pelayanan)'
      USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- RLS pelayanan_oss
DROP POLICY IF EXISTS oss_read_staff ON public.pelayanan_oss;
CREATE POLICY oss_read_staff ON public.pelayanan_oss FOR SELECT TO authenticated
  USING (public.boleh_tiket(tiket_id));

DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
  );

DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id));

-- RLS pelayanan_perizinan
DROP POLICY IF EXISTS perizinan_read_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_read_staff ON public.pelayanan_perizinan FOR SELECT TO authenticated
  USING (public.boleh_tiket(tiket_id));

DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
  );

DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id));

-- RPC koreksi data terkunci (Admin / Front Office aktif).
CREATE OR REPLACE FUNCTION public.koreksi_pelayanan(
  p_tiket_id   uuid,
  p_form_type  text,
  p_perubahan  jsonb,
  p_alasan     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_tabel   text;
  v_boleh   text[];
  v_wajib   text[];
  v_lama    jsonb;
  v_locked  boolean;
  v_kunci   text;
  v_nilai   jsonb;
  v_baru    text;
  v_set     text := '';
  v_diff    jsonb := '{}'::jsonb;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin/Front Office aktif yang boleh mengoreksi data pelayanan'
      USING ERRCODE = '42501';
  END IF;
  IF p_alasan IS NULL OR char_length(btrim(p_alasan)) < 5 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan koreksi wajib diisi (minimal 5 karakter)' USING ERRCODE = '22023';
  END IF;
  IF p_perubahan IS NULL OR jsonb_typeof(p_perubahan) <> 'object' OR p_perubahan = '{}'::jsonb THEN
    RAISE EXCEPTION 'TIDAK_ADA_PERUBAHAN: p_perubahan harus berupa objek berisi minimal satu kolom' USING ERRCODE = '22023';
  END IF;

  IF p_form_type = 'oss' THEN
    v_tabel := 'pelayanan_oss';
    v_boleh := ARRAY['nama_pemohon','alamat_pemohon','no_hp','email','keperluan_awal','nama_usaha',
                     'tipe_pelaku_usaha','status_penanaman_modal','lokasi_usaha','skala_usaha',
                     'sektor_usaha_kbli','tindak_lanjut','uraian_solusi','catatan_internal'];
    v_wajib := ARRAY['nama_pemohon','nama_usaha','tindak_lanjut','uraian_solusi'];
  ELSIF p_form_type = 'perizinan' THEN
    v_tabel := 'pelayanan_perizinan';
    v_boleh := ARRAY['nama_pemohon','alamat_pemohon','no_hp','email','keperluan_awal','nama_perusahaan',
                     'lokasi_usaha','opd_teknis','uraian_permohonan','tindak_lanjut','catatan_petugas'];
    v_wajib := ARRAY['nama_pemohon','nama_perusahaan','opd_teknis','uraian_permohonan','tindak_lanjut'];
  ELSE
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;

  EXECUTE format('SELECT to_jsonb(t), t.is_locked FROM public.%I AS t WHERE t.tiket_id = $1 FOR UPDATE', v_tabel)
    INTO v_lama, v_locked USING p_tiket_id;
  IF v_lama IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: data pelayanan untuk tiket ini tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF NOT v_locked THEN
    RAISE EXCEPTION 'BELUM_TERKUNCI: data masih draf, ubah lewat simpan draf / selesaikan' USING ERRCODE = '22023';
  END IF;

  FOR v_kunci, v_nilai IN SELECT e.key, e.value FROM jsonb_each(p_perubahan) AS e LOOP
    IF NOT (v_kunci = ANY (v_boleh)) THEN
      RAISE EXCEPTION 'FIELD_TIDAK_VALID: kolom % tidak boleh dikoreksi', v_kunci USING ERRCODE = '22023';
    END IF;
    IF jsonb_typeof(v_nilai) NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'FIELD_TIDAK_VALID: nilai kolom % harus teks atau null', v_kunci USING ERRCODE = '22023';
    END IF;
    v_baru := NULLIF(btrim(v_nilai #>> '{}'), '');
    IF v_baru IS NULL AND v_kunci = ANY (v_wajib) THEN
      RAISE EXCEPTION 'FIELD_TIDAK_VALID: kolom % wajib diisi', v_kunci USING ERRCODE = '22023';
    END IF;
    IF v_baru IS DISTINCT FROM (v_lama ->> v_kunci) THEN
      v_diff := v_diff || jsonb_build_object(
        v_kunci, jsonb_build_object('lama', v_lama -> v_kunci, 'baru', to_jsonb(v_baru))
      );
      v_set := v_set || CASE WHEN v_set = '' THEN '' ELSE ', ' END || format('%I = %L', v_kunci, v_baru);
    END IF;
  END LOOP;

  IF v_diff = '{}'::jsonb THEN
    RAISE EXCEPTION 'TIDAK_ADA_PERUBAHAN: nilai baru sama dengan nilai lama' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('lmh.koreksi', 'on', true);
  EXECUTE format('UPDATE public.%I SET %s WHERE tiket_id = %L', v_tabel, v_set, p_tiket_id);
  PERFORM set_config('lmh.koreksi', 'off', true);

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (auth.uid(), v_me_role, 'koreksi_pelayanan', v_tabel, p_tiket_id::text,
          jsonb_build_object('tiket_id', p_tiket_id, 'staf_id', v_me_id,
                             'alasan', btrim(p_alasan), 'perubahan', v_diff));

  RETURN jsonb_build_object('ok', true, 'perubahan', v_diff);
END $$;

REVOKE ALL ON FUNCTION public.koreksi_pelayanan(uuid, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.koreksi_pelayanan(uuid, text, jsonb, text) TO authenticated;

-- ============================================================
-- 3. Penegakan per layanan
-- ============================================================
-- kunjungan: Admin/FO semua; petugas hanya kunjungan yang punya tiket di layanannya.
DROP POLICY IF EXISTS kunjungan_staff_select ON public.kunjungan;
CREATE POLICY kunjungan_staff_select ON public.kunjungan FOR SELECT TO authenticated
  USING (public.boleh_kunjungan(id));
DROP POLICY IF EXISTS kunjungan_staff_update ON public.kunjungan;
CREATE POLICY kunjungan_staff_update ON public.kunjungan FOR UPDATE TO authenticated
  USING (public.boleh_kunjungan(id))
  WITH CHECK (public.boleh_kunjungan(id));

-- visit: FO/Admin lintas layanan (S7), petugas hanya layanannya. Pengunjung tetap miliknya.
DROP POLICY IF EXISTS visit_select_own ON public.visit;
CREATE POLICY visit_select_own ON public.visit FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid())
    OR public.boleh_layanan(layanan_id)
  );
DROP POLICY IF EXISTS visit_update_staff ON public.visit;
CREATE POLICY visit_update_staff ON public.visit FOR UPDATE TO authenticated
  USING (public.boleh_layanan(layanan_id))
  WITH CHECK (public.boleh_layanan(layanan_id));

-- rekap_harian_layanan: petugas hanya layanannya.
DROP POLICY IF EXISTS rekap_harian_staff_read ON public.rekap_harian_layanan;
CREATE POLICY rekap_harian_staff_read ON public.rekap_harian_layanan FOR SELECT TO authenticated
  USING (public.boleh_layanan(layanan_id));

-- investasi_lead: Admin saja.
DROP POLICY IF EXISTS investasi_lead_select_staff ON public.investasi_lead;
CREATE POLICY investasi_lead_select_staff ON public.investasi_lead FOR SELECT TO authenticated
  USING (public.peran_saya() = 'admin');

-- SKM rinci: Admin/FO membaca tabel; petugas lewat view tanpa visit_id/id (tanpa identitas responden).
DROP POLICY IF EXISTS skm_select_staff ON public.skm_respons;
CREATE POLICY skm_select_staff ON public.skm_respons FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office'));

-- View sengaja TANPA security_invoker: pemilik (postgres) membaca tabel, baris disaring
-- boleh_layanan() terhadap pemanggil. Hanya kolom non-identitas.
CREATE OR REPLACE VIEW public.v_skm_petugas AS
SELECT s.layanan_id, s.u1_persyaratan, s.u2_prosedur, s.u3_waktu, s.u4_biaya, s.u5_produk,
       s.u6_kompetensi, s.u7_perilaku, s.u8_sarana, s.u9_pengaduan, s.saran, s.created_at
FROM public.skm_respons AS s
WHERE public.peran_saya() = 'petugas' AND public.boleh_layanan(s.layanan_id);
REVOKE ALL ON public.v_skm_petugas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_skm_petugas TO authenticated;

-- ============================================================
-- 6. Pengaduan (RLS + view petugas). Policy lama tanpa TO dibuat ulang TO authenticated.
-- ============================================================
DROP POLICY IF EXISTS pengaduan_layanan_read ON public.pengaduan;
CREATE POLICY pengaduan_layanan_read ON public.pengaduan FOR SELECT TO authenticated
  USING (jalur = 'layanan' AND public.peran_saya() IN ('admin', 'front_office'));

DROP POLICY IF EXISTS pengaduan_integritas_admin_only ON public.pengaduan;
CREATE POLICY pengaduan_integritas_admin_only ON public.pengaduan FOR SELECT TO authenticated
  USING (jalur = 'integritas' AND public.peran_saya() = 'admin');

DROP POLICY IF EXISTS pengaduan_update ON public.pengaduan;
CREATE POLICY pengaduan_update ON public.pengaduan FOR UPDATE TO authenticated
  USING (public.peran_saya() = 'admin' OR (jalur = 'layanan' AND public.peran_saya() = 'front_office'))
  WITH CHECK (public.peran_saya() = 'admin' OR (jalur = 'layanan' AND public.peran_saya() = 'front_office'));

DROP POLICY IF EXISTS pengaduan_riwayat_write ON public.pengaduan_riwayat;
CREATE POLICY pengaduan_riwayat_write ON public.pengaduan_riwayat FOR INSERT TO authenticated
  WITH CHECK (
    public.peran_saya() IN ('admin', 'front_office')
    AND diubah_oleh IN (SELECT me.id FROM public.staf_saya() AS me)
    AND pengaduan_id IN (SELECT g.id FROM public.pengaduan AS g)
  );

-- View petugas: jalur layanan, layanannya saja; TANPA kontak, lampiran_path, sesi_chat_id, diteruskan_ke.
CREATE OR REPLACE VIEW public.v_pengaduan_petugas AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, g.isi, g.anonim, g.status,
       g.batas_verifikasi, g.batas_penanganan, g.created_at, g.updated_at
FROM public.pengaduan AS g
WHERE g.jalur = 'layanan' AND public.peran_saya() = 'petugas' AND public.boleh_layanan(g.layanan_id);
REVOKE ALL ON public.v_pengaduan_petugas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pengaduan_petugas TO authenticated;

-- ============================================================
-- 5. Foto absensi
-- ============================================================
ALTER TABLE public.absensi_petugas ADD COLUMN IF NOT EXISTS foto_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('absensi-foto', 'absensi-foto', false, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS absensi_foto_insert ON storage.objects;
CREATE POLICY absensi_foto_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'absensi-foto' AND public.peran_saya() IN ('admin', 'front_office'));
DROP POLICY IF EXISTS absensi_foto_select ON storage.objects;
CREATE POLICY absensi_foto_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'absensi-foto' AND public.peran_saya() IN ('admin', 'front_office'));

-- FO ikut membaca absensi (memilih petugas, menyetujui); tulis langsung tetap Admin.
DROP POLICY IF EXISTS absensi_select_own ON public.absensi_petugas;
CREATE POLICY absensi_select_own ON public.absensi_petugas FOR SELECT TO authenticated
  USING (
    petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    OR public.peran_saya() IN ('admin', 'front_office')
  );

-- Satu bentuk saja: ganti 3-argumen dengan 4-argumen (p_foto_url DEFAULT NULL) di transaksi yang sama;
-- panggilan 3-argumen lama tetap valid (tanpa overload ambigu).
DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.catat_absensi(uuid, text, uuid, text);

CREATE FUNCTION public.catat_absensi(
  p_petugas_id   uuid,
  p_sumber       text,
  p_dicatat_oleh uuid DEFAULT NULL,
  p_foto_url     text DEFAULT NULL
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
  v_foto     text := NULLIF(btrim(p_foto_url), '');
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

  -- Foto hanya dari pencatatan FO/Admin; path harus <tanggal>/<petugas_id>_<angka>.<jpg|png|webp>.
  IF p_sumber <> 'fo' THEN
    v_foto := NULL;
  ELSIF v_foto IS NOT NULL
        AND v_foto !~ ('^[0-9]{4}-[0-9]{2}-[0-9]{2}/' || p_petugas_id::text || '_[0-9]+\.(jpg|jpeg|png|webp)$') THEN
    RAISE EXCEPTION 'foto_url tidak valid' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.petugas WHERE id = p_petugas_id AND aktif = true) THEN
    RAISE EXCEPTION 'petugas tidak ditemukan atau nonaktif' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.absensi_petugas
    (petugas_id, tanggal, jam_masuk, status, sumber, dicatat_oleh, approved_by, foto_url)
  VALUES (
    p_petugas_id, v_tanggal, now(),
    CASE WHEN p_sumber = 'petugas_ajukan' THEN 'pending' ELSE 'approved' END,
    p_sumber, COALESCE(v_dicatat, p_petugas_id),
    CASE WHEN v_verif THEN v_me_id END,
    v_foto
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
                  END,
    foto_url    = COALESCE(public.absensi_petugas.foto_url, EXCLUDED.foto_url)
  RETURNING id INTO v_id;

  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  SELECT p.layanan_id, v_tanggal, 'dibuka'
  FROM public.petugas AS p WHERE p.id = p_petugas_id AND p.layanan_id IS NOT NULL
  ON CONFLICT (layanan_id, tanggal) DO UPDATE
    SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.catat_absensi(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_absensi(uuid, text, uuid, text) TO authenticated, service_role;

-- ============================================================
-- 4. Jam tutup layanan (WIB) + layanan_hari Admin saja + job akhir-hari
-- ============================================================
INSERT INTO public.site_settings (key, value) VALUES ('jam_tutup_layanan', '16:00')
ON CONFLICT (key) DO NOTHING;

-- Nilai tidak valid -> default 16:00. SECURITY DEFINER agar tidak bergantung grant tabel pemanggil.
CREATE OR REPLACE FUNCTION public.jam_tutup_layanan()
RETURNS time
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text;
BEGIN
  SELECT s.value INTO v FROM public.site_settings AS s WHERE s.key = 'jam_tutup_layanan';
  IF v IS NOT NULL AND btrim(v) ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9]$' THEN
    RETURN btrim(v)::time;
  END IF;
  RETURN time '16:00';
END $$;

-- p_waktu untuk pengujian / tampilan; semua perbandingan WIB.
CREATE OR REPLACE FUNCTION public.layanan_sudah_tutup(p_waktu timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT (p_waktu AT TIME ZONE 'Asia/Jakarta')::time >= public.jam_tutup_layanan()
$$;

REVOKE ALL ON FUNCTION public.jam_tutup_layanan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jam_tutup_layanan() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.layanan_sudah_tutup(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_sudah_tutup(timestamptz) TO anon, authenticated, service_role;

-- layanan_hari: tulis Admin saja (tombol tutup darurat FO dibatalkan). catat_absensi & cron = definer.
DROP POLICY IF EXISTS layanan_hari_staff_write ON public.layanan_hari;
DROP POLICY IF EXISTS layanan_hari_admin_write ON public.layanan_hari;
CREATE POLICY layanan_hari_admin_write ON public.layanan_hari FOR ALL TO authenticated
  USING (public.peran_saya() = 'admin')
  WITH CHECK (public.peran_saya() = 'admin');

-- Job akhir-hari: 09:00 UTC = 16:00 WIB (sebelumnya 08:35 UTC).
DO $$
DECLARE
  v_job bigint;
BEGIN
  SELECT jobid INTO v_job FROM cron.job WHERE jobname = 'antrean_tidak_terlayani_akhir_hari';
  IF v_job IS NOT NULL THEN
    PERFORM cron.alter_job(v_job, schedule := '0 9 * * *');
  ELSE
    RAISE WARNING 'cron job antrean_tidak_terlayani_akhir_hari tidak ditemukan: jadwal tidak digeser';
  END IF;
END $$;

-- Guard check-in: JALUR TERAKHIR (bisa memutus check-in bila salah, jadi paling akhir).
-- Walk-in baru ditolak mulai jam tutup; reservasi (INSERT jadwal) dan check-in/scan reservasi
-- (UPDATE) tidak tersentuh. Sisa fungsi identik dengan 202607290010.
CREATE OR REPLACE FUNCTION public.guard_visit_layanan_buka()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tanggal date;
BEGIN
  IF NEW.asal = 'walk_in' AND public.layanan_sudah_tutup() THEN
    RAISE EXCEPTION 'Layanan hari ini sudah tutup pukul % WIB. Silakan datang kembali pada hari kerja berikutnya. Live chat tetap tersedia.',
      to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = 'P0001', DETAIL = 'LAYANAN_TUTUP';
  END IF;

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
