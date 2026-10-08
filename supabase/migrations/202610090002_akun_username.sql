-- 202610090002_akun_username.sql
-- RBAC Tahap 2 (sisi DB): login USERNAME + profil + manajemen akun layanan bersama.
-- Desain: docs/RBAC_USULAN_BAGIAN2_DRAFT.md bagian C (opsi 1b: username -> email login sintetis
-- `{username}@<domain>`; email asli = "email notifikasi", terpisah). Kontrak API: docs/RBAC_AKUN_KONTRAK.md.
--
--   1. petugas: username (unik), no_hp, email_notifikasi (+verified_at), operator_default,
--      wajib_ganti_sandi. Format dijaga CHECK. Kolom lama tidak berubah; akun lama username NULL
--      sampai skrip scripts/migrate-akun-username.mjs dijalankan (atas izin CEO).
--   2. Pengguna biasa TIDAK menulis tabel petugas (RLS lama: hanya admin). Profil sendiri lewat RPC
--      petugas_ubah_profil (hanya no_hp, email_notifikasi, operator_default; BUKAN role/layanan/
--      aktif/username). Mengubah email_notifikasi menghapus status terverifikasi.
--   3. petugas_verif_email: token verifikasi email notifikasi (hash SHA-256, sekali pakai).
--      RLS aktif tanpa policy + REVOKE: hanya service_role.
--   4. RPC admin/service: akun_daftar (daftar + last_sign_in_at dari auth.users, email tersamar),
--      akun_akhiri_sesi (hapus auth.sessions), petugas_verifikasi_email (konsumsi token).
--   5. guard_admin_terakhir: trigger penjaga -- Admin aktif terakhir tidak bisa diturunkan/dinonaktifkan
--      (berlaku juga untuk tulis langsung, bukan hanya lewat RPC).
--   6. Akuntabilitas akun bersama: absensi_petugas.operator_nama diisi otomatis dari
--      petugas.operator_default ("operator bertugas") saat baris absensi dibuat. TIDAK mengubah catat_absensi.
--
-- PENERAPAN: mode ATOMIK (memuat CREATE FUNCTION/TRIGGER):
--   node scripts/apply-migration.mjs supabase/migrations/202610090002_akun_username.sql --atomic --yes
-- Rollback: docs/rollback-rbac-tahap2-202610090002.sql (menghapus kolom => data username dll hilang).

-- ============================================================
-- 1. Kolom & batasan
-- ============================================================
ALTER TABLE public.petugas
  ADD COLUMN IF NOT EXISTS username                      text,
  ADD COLUMN IF NOT EXISTS no_hp                         text,
  ADD COLUMN IF NOT EXISTS email_notifikasi              text,
  ADD COLUMN IF NOT EXISTS email_notifikasi_verified_at  timestamptz,
  ADD COLUMN IF NOT EXISTS operator_default              text,
  ADD COLUMN IF NOT EXISTS wajib_ganti_sandi             boolean NOT NULL DEFAULT false;

ALTER TABLE public.petugas
  ADD CONSTRAINT petugas_username_format CHECK (
    username IS NULL OR (
      username ~ '^[a-z0-9][a-z0-9-]{2,31}$'
      AND username NOT IN ('admin', 'root', 'support', 'system', 'api', 'null', 'undefined')
    )
  ),
  ADD CONSTRAINT petugas_username_key UNIQUE (username),
  ADD CONSTRAINT petugas_no_hp_format CHECK (no_hp IS NULL OR no_hp ~ '^\+?[0-9]{8,15}$'),
  ADD CONSTRAINT petugas_email_notifikasi_format CHECK (
    email_notifikasi IS NULL OR (
      char_length(email_notifikasi) <= 254 AND email_notifikasi ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  ),
  ADD CONSTRAINT petugas_operator_default_len CHECK (
    operator_default IS NULL OR char_length(operator_default) BETWEEN 2 AND 100
  );

COMMENT ON COLUMN public.petugas.username IS 'Nama pengguna login (huruf kecil/angka/-). Email login Supabase = username@<domain sintetis>; jangan kirim email nyata ke sana.';
COMMENT ON COLUMN public.petugas.email_notifikasi IS 'Email asli untuk notifikasi/pemulihan; BUKAN email login. Dipakai hanya bila email_notifikasi_verified_at terisi.';
COMMENT ON COLUMN public.petugas.operator_default IS 'Nama orang yang sedang bertugas memakai akun bersama (akuntabilitas); disalin ke absensi_petugas.operator_nama.';

-- ============================================================
-- 2. Profil sendiri (satu-satunya jalur tulis non-admin ke petugas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.petugas_ubah_profil(p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me uuid;
BEGIN
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch profil tidak valid';
  END IF;

  -- Hanya kunci yang ada di patch yang diubah; nilai kosong = hapus. Semua SET membaca baris LAMA.
  UPDATE public.petugas AS p
  SET no_hp = CASE WHEN p_patch ? 'no_hp'
                   THEN NULLIF(pg_catalog.btrim(p_patch->>'no_hp'), '') ELSE p.no_hp END,
      email_notifikasi = CASE WHEN p_patch ? 'email_notifikasi'
                   THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch->>'email_notifikasi')), '')
                   ELSE p.email_notifikasi END,
      email_notifikasi_verified_at = CASE
                   WHEN p_patch ? 'email_notifikasi'
                    AND NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch->>'email_notifikasi')), '')
                        IS DISTINCT FROM p.email_notifikasi
                   THEN NULL ELSE p.email_notifikasi_verified_at END,
      operator_default = CASE WHEN p_patch ? 'operator_default'
                   THEN NULLIF(pg_catalog.btrim(p_patch->>'operator_default'), '') ELSE p.operator_default END
  WHERE p.id = v_me;
END $$;

REVOKE ALL ON FUNCTION public.petugas_ubah_profil(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_ubah_profil(jsonb) TO authenticated;

-- ============================================================
-- 3. Token verifikasi email notifikasi (hanya service_role)
-- ============================================================
CREATE TABLE public.petugas_verif_email (
  petugas_id  uuid PRIMARY KEY REFERENCES public.petugas(id) ON DELETE CASCADE,
  email       text NOT NULL,
  token_hash  text NOT NULL UNIQUE,
  kedaluwarsa timestamptz NOT NULL,
  dibuat_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.petugas_verif_email ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.petugas_verif_email FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.petugas_verif_email TO service_role;

-- Konsumsi token sekali pakai. NULL = token tidak valid/kedaluwarsa/email sudah berganti.
CREATE OR REPLACE FUNCTION public.petugas_verifikasi_email(p_token_hash text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id    uuid;
  v_email text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'hanya service_role' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.petugas_verif_email AS v
  WHERE v.token_hash = p_token_hash AND v.kedaluwarsa > pg_catalog.now()
  RETURNING v.petugas_id, v.email INTO v_id, v_email;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.petugas AS p
  SET email_notifikasi_verified_at = pg_catalog.now()
  WHERE p.id = v_id AND p.email_notifikasi = v_email;
  IF NOT FOUND THEN
    RETURN NULL; -- email diganti sebelum token dipakai
  END IF;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.petugas_verifikasi_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_verifikasi_email(text) TO service_role;

-- ============================================================
-- 4. Daftar akun (Admin) & akhiri sesi
-- ============================================================
CREATE OR REPLACE FUNCTION public.tersamarkan_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_email IS NULL OR pg_catalog.strpos(p_email, '@') < 2 THEN NULL
    ELSE pg_catalog.substr(p_email, 1, 1) || '***' || pg_catalog.substr(p_email, pg_catalog.strpos(p_email, '@'))
  END
$$;

REVOKE ALL ON FUNCTION public.tersamarkan_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tersamarkan_email(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.akun_daftar()
RETURNS TABLE (
  id uuid,
  auth_user_id uuid,
  nama text,
  username text,
  role text,
  layanan_id uuid,
  layanan_nama text,
  no_hp text,
  aktif boolean,
  nonaktif_sejak timestamptz,
  nonaktif_alasan text,
  email_login text,
  email_notifikasi_tersamar text,
  email_notifikasi_terverifikasi boolean,
  operator_default text,
  wajib_ganti_sandi boolean,
  last_sign_in_at timestamptz,
  belum_pernah_login boolean,
  dibuat_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role'
     AND NOT EXISTS (SELECT 1 FROM public.staf_saya() AS me WHERE me.role = 'admin') THEN
    RAISE EXCEPTION 'hanya Admin aktif yang boleh melihat daftar akun' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.auth_user_id, p.nama, p.username, p.role, p.layanan_id, l.nama,
         p.no_hp, p.aktif, p.nonaktif_sejak, p.nonaktif_alasan,
         u.email::text,
         public.tersamarkan_email(p.email_notifikasi),
         (p.email_notifikasi IS NOT NULL AND p.email_notifikasi_verified_at IS NOT NULL),
         p.operator_default, p.wajib_ganti_sandi,
         u.last_sign_in_at,
         (u.last_sign_in_at IS NULL),
         p.created_at
  FROM public.petugas AS p
  LEFT JOIN public.layanan AS l ON l.id = p.layanan_id
  LEFT JOIN auth.users AS u ON u.id = p.auth_user_id
  ORDER BY (p.role = 'admin') DESC, p.role, l.nama NULLS LAST, p.nama;
END $$;

REVOKE ALL ON FUNCTION public.akun_daftar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akun_daftar() TO authenticated, service_role;

-- Akhiri semua sesi (refresh token ikut terhapus lewat FK). Token akses yang sudah terbit tetap
-- berlaku sampai kedaluwarsa (<= masa JWT); untuk akun nonaktif role-nya sudah dicabut (N7).
CREATE OR REPLACE FUNCTION public.akun_akhiri_sesi(p_auth_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_n integer;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'hanya service_role' USING ERRCODE = '42501';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_auth_user_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.akun_akhiri_sesi(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akun_akhiri_sesi(uuid) TO service_role;

-- ============================================================
-- 5. Penjaga Admin aktif terakhir (tulis langsung pun tidak lolos)
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_admin_terakhir()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.aktif AND (NEW.role <> 'admin' OR NOT NEW.aktif) THEN
    PERFORM 1 FROM public.petugas WHERE role = 'admin' AND aktif = true FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.petugas AS a WHERE a.role = 'admin' AND a.aktif = true AND a.id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'tidak boleh menurunkan atau menonaktifkan Admin aktif terakhir';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_admin_terakhir() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_admin_terakhir ON public.petugas;
CREATE TRIGGER trg_guard_admin_terakhir BEFORE UPDATE OF role, aktif ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_terakhir();

-- ============================================================
-- 6. Operator bertugas pada absensi (akun bersama)
-- ============================================================
ALTER TABLE public.absensi_petugas ADD COLUMN IF NOT EXISTS operator_nama text;

CREATE OR REPLACE FUNCTION public.absensi_isi_operator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.operator_nama IS NULL THEN
    SELECT p.operator_default INTO NEW.operator_nama FROM public.petugas AS p WHERE p.id = NEW.petugas_id;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.absensi_isi_operator() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_absensi_isi_operator ON public.absensi_petugas;
CREATE TRIGGER trg_absensi_isi_operator BEFORE INSERT ON public.absensi_petugas
  FOR EACH ROW EXECUTE FUNCTION public.absensi_isi_operator();
