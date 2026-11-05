-- Profil Saya: nama pribadi, audit perubahan nama, dan izin operator per akun.
-- BELUM diterapkan. Jalankan atomik oleh pemilik setelah peninjauan/staging.
-- Rollback manual: docs/rollback-profil-ubah-nama-202611030014.sql.
-- Tidak bergantung pada migrasi 0013; email_nyata berasal dari 202611010003.
DO $$
DECLARE
  v_obj text;
  v_kolom text;
BEGIN
  FOREACH v_obj IN ARRAY ARRAY['public.staf_saya()', 'public.sesi_valid()',
    'public.email_nyata(text)', 'public.petugas_ubah_profil(jsonb)'] LOOP
    IF pg_catalog.to_regprocedure(v_obj) IS NULL THEN
      RAISE EXCEPTION 'PRASYARAT: fungsi % belum ada', v_obj;
    END IF;
  END LOOP;
  FOREACH v_kolom IN ARRAY ARRAY['petugas.id', 'petugas.auth_user_id', 'petugas.nama',
    'petugas.role', 'petugas.aktif', 'petugas.username', 'petugas.no_hp', 'petugas.email_notifikasi',
    'petugas.email_notifikasi_verified_at', 'petugas.operator_default', 'audit_log.actor_id',
    'audit_log.actor_role', 'audit_log.aksi', 'audit_log.entitas', 'audit_log.entitas_id',
    'audit_log.detail', 'audit_log.created_at'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns AS c WHERE c.table_schema = 'public'
      AND c.table_name = pg_catalog.split_part(v_kolom, '.', 1)
      AND c.column_name = pg_catalog.split_part(v_kolom, '.', 2)) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom % belum ada', v_kolom;
    END IF;
  END LOOP;
  FOREACH v_kolom IN ARRAY ARRAY['id', 'email'] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth'
      AND table_name = 'users' AND column_name = v_kolom) THEN
      RAISE EXCEPTION 'PRASYARAT: auth.users.% belum ada', v_kolom;
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.petugas ADD COLUMN IF NOT EXISTS operator_aktif boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.petugas.operator_aktif IS 'Admin mengizinkan isian operator pada profil akun ini; akun individu default false.';

CREATE OR REPLACE FUNCTION public.petugas_ubah_profil(p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me public.petugas%ROWTYPE;
  v_nama text;
  v_hp text;
  v_email text;
  v_operator text;
  v_domain_login text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (SELECT 1 FROM public.staf_saya()) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' OR p_patch = '{}'::jsonb THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: patch profil kosong atau bukan objek' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_patch) AS k(nama)
    WHERE k.nama NOT IN ('nama', 'no_hp', 'email_notifikasi', 'operator_default')) THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: kolom profil tidak diizinkan' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_patch) AS kv
    WHERE pg_catalog.jsonb_typeof(kv.value) NOT IN ('string', 'null')) THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: nilai profil harus teks atau null' USING ERRCODE = '22023';
  END IF;

  -- Satu baris untuk pemilik sesi; serialisasi dengan perubahan flag oleh Admin.
  SELECT p.* INTO v_me FROM public.petugas AS p
    WHERE p.auth_user_id = auth.uid() AND p.aktif = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  v_nama := v_me.nama;
  v_hp := v_me.no_hp;
  v_email := v_me.email_notifikasi;
  v_operator := v_me.operator_default;

  IF p_patch ? 'nama' THEN
    v_nama := pg_catalog.btrim(p_patch->>'nama');
    IF v_nama IS NULL OR pg_catalog.char_length(v_nama) NOT BETWEEN 2 AND 100
      OR (p_patch->>'nama') ~ '[[:cntrl:]]'
      OR v_nama ~ '^[[:space:]]*[=+@-]' THEN
      RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: nama 2-100 karakter tanpa kontrol atau awalan rumus'
        USING ERRCODE = '22023', DETAIL = 'nama';
    END IF;
  END IF;
  IF p_patch ? 'no_hp' THEN
    -- Sama dengan normalizeNoHp: hapus spasi/titik/kurung/hubung, lalu bentuk +62.
    v_hp := NULLIF(pg_catalog.regexp_replace(COALESCE(p_patch->>'no_hp', ''), '[[:space:]().-]', '', 'g'), '');
    IF v_hp IS NOT NULL THEN
      v_hp := CASE WHEN v_hp LIKE '+%' THEN v_hp WHEN v_hp LIKE '0%' THEN '+62' || pg_catalog.substr(v_hp, 2)
        WHEN v_hp LIKE '62%' THEN '+' || v_hp ELSE v_hp END;
      IF v_hp !~ '^\+[0-9]{8,15}$' THEN
        RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: format nomor HP tidak valid' USING ERRCODE = '22023', DETAIL = 'no_hp';
      END IF;
    END IF;
  END IF;
  IF p_patch ? 'email_notifikasi' THEN
    v_email := NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch->>'email_notifikasi')), '');
    -- Domain login kustom diturunkan dari akun sendiri, tanpa membaca konfigurasi rahasia.
    SELECT pg_catalog.lower(pg_catalog.split_part(u.email, '@', 2)) INTO v_domain_login
      FROM auth.users AS u WHERE u.id = auth.uid()
      AND pg_catalog.lower(pg_catalog.split_part(u.email, '@', 1)) = v_me.username;
    IF v_email IS NOT NULL AND (public.email_nyata(v_email) IS NULL
      OR v_email ~ '\.internal$'
      OR pg_catalog.split_part(v_email, '@', 2) = v_domain_login) THEN
      RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: gunakan alamat email notifikasi yang nyata'
        USING ERRCODE = '22023', DETAIL = 'email_notifikasi';
    END IF;
  END IF;
  IF p_patch ? 'operator_default' THEN
    IF NOT v_me.operator_aktif THEN
      RAISE EXCEPTION 'OPERATOR_TIDAK_AKTIF: isian operator belum diaktifkan Admin' USING ERRCODE = '42501';
    END IF;
    v_operator := NULLIF(pg_catalog.btrim(p_patch->>'operator_default'), '');
    IF v_operator IS NOT NULL AND pg_catalog.char_length(v_operator) NOT BETWEEN 2 AND 100 THEN
      RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: operator 2-100 karakter' USING ERRCODE = '22023', DETAIL = 'operator_default';
    END IF;
  END IF;

  UPDATE public.petugas AS p SET nama = v_nama, no_hp = v_hp, email_notifikasi = v_email,
    email_notifikasi_verified_at = CASE WHEN v_email IS DISTINCT FROM p.email_notifikasi
      THEN NULL ELSE p.email_notifikasi_verified_at END,
    operator_default = v_operator WHERE p.id = v_me.id;
  IF v_nama IS DISTINCT FROM v_me.nama THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES (auth.uid(), v_me.role, 'profil_ubah_nama', 'petugas', v_me.id::text,
      pg_catalog.jsonb_build_object('nama_lama', v_me.nama, 'nama_baru', v_nama,
        'petugas_id', v_me.id, 'waktu_wib', pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'Asia/Jakarta',
          'YYYY-MM-DD HH24:MI:SS') || ' WIB'));
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.petugas_ubah_profil(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_ubah_profil(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_atur_operator(p_petugas_id uuid, p_aktif boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin uuid;
  v_lama boolean;
BEGIN
  SELECT me.id INTO v_admin FROM public.staf_saya() AS me WHERE me.role = 'admin';
  IF auth.uid() IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_petugas_id IS NULL OR p_aktif IS NULL THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: akun dan penanda operator wajib diisi' USING ERRCODE = '22023';
  END IF;
  SELECT p.operator_aktif INTO v_lama FROM public.petugas AS p WHERE p.id = p_petugas_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: akun tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_lama IS DISTINCT FROM p_aktif THEN
    UPDATE public.petugas SET operator_aktif = p_aktif WHERE id = p_petugas_id;
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES (auth.uid(), 'admin', 'akun_operator', 'petugas', p_petugas_id::text,
      pg_catalog.jsonb_build_object('dari', v_lama, 'ke', p_aktif, 'admin_id', v_admin));
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'operator_aktif', p_aktif);
END $$;

REVOKE ALL ON FUNCTION public.admin_atur_operator(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atur_operator(uuid, boolean) TO authenticated;
