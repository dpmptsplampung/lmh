-- Stub skema untuk harness verifikasi lokal PGlite (scripts/lokal/pglite-harness.mjs).
--
-- TUJUAN: memuat SEKEDAR cukup skema produksi agar migrasi baru (survei terpadu Fase A) bisa dijalankan
-- dan perilakunya (RLS, RPC, trigger) diuji di Postgres lokal dalam-proses, TANPA koneksi ke DB mana pun.
-- BUKAN replika Supabase penuh dan BUKAN pengganti dry-run/test:rls pemilik di DB nyata.
--
-- BATAS (jangan dilupakan saat membaca hasil uji):
--   * Tabel stub memuat hanya kolom yang dipakai fitur ini. Kolom NOT NULL produksi yang tidak
--     dipakai (mis. tiket_antrean.tanggal/nomor/nomor_display, kunjungan.waktu_masuk) sengaja
--     tidak ada, jadi INSERT uji tidak perlu mengisinya.
--   * RLS diaktifkan pada SEMUA tabel stub. Policy hanya ada bila disalin dari produksi
--     (skm_respons, layanan). Tabel stub lain tanpa policy = anon/authenticated DITOLAK semua
--     (lebih ketat dari produksi): jangan memakai harness ini untuk membuktikan RLS tabel stub itu
--     sendiri, hanya perilaku objek BARU yang dibaca lewat fungsi SECURITY DEFINER/view.
--   * petugas.auth_user_id tanpa FK ke auth.users (stub tidak punya tabel itu); chat_sesi tidak
--     ada; visit dan pengunjung hanya berisi kolom id, semata agar FK baseline skm_respons dan
--     kunjungan terselesaikan.
--   * Hak akses meniru default Supabase: tabel/fungsi baru di `public` memberi ALL kepada
--     anon, authenticated, service_role (lewat ALTER DEFAULT PRIVILEGES). Jadi migrasi yang lupa
--     REVOKE terlihat terbuka di sini seperti di produksi. service_role = BYPASSRLS.
--
-- Dijalankan SEKALI pada DB kosong oleh bukaDb(). Superuser lokal = `postgres` (pemilik objek,
-- seperti pemilik migrasi di Supabase).

-- ============================================================
-- 1. Role, schema, ekstensi
-- ============================================================
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;

-- pgcrypto di schema `extensions`, sama seperti baseline 202607140001 (fungsi harus dikualifikasi:
-- extensions.gen_random_bytes). Paket pgcrypto dimuat oleh bukaDb().
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE SCHEMA auth;

-- auth.uid(): pengganti JWT Supabase. Nilainya dibaca dari GUC sesi `app.uid`, yang diisi
-- sebagai() per panggilan (kosong/NULL = tidak login).
CREATE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(pg_catalog.current_setting('app.uid', true), '')::uuid
$$;

-- ============================================================
-- 2. Hak default seperti Supabase (sebelum objek apa pun dibuat)
-- ============================================================
GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- ============================================================
-- 3. Tabel
-- ============================================================
-- Baseline 202607140002 (disederhanakan: kolom lain dibuang).
CREATE TABLE public.layanan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama text NOT NULL UNIQUE
);

-- Baseline 202607140002 + 202607290004 (aktif) + 202607290009 (front_office).
CREATE TABLE public.petugas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE,                 -- stub: tanpa FK ke auth.users
  role text NOT NULL DEFAULT 'petugas' CHECK (role IN ('petugas', 'admin', 'front_office')),
  aktif boolean NOT NULL DEFAULT true,
  layanan_id uuid REFERENCES public.layanan(id) ON DELETE SET NULL
);

-- Stub minimal agar FK baseline terselesaikan (aturan R4). Kolom lain tidak dimodelkan.
CREATE TABLE public.visit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
CREATE TABLE public.pengunjung (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

-- 202607290013 + 202610140003 (kolom selesai_at/email/kategori/layanan_saran_id). Tanpa waktu_masuk,
-- chat_sesi_id, legacy_visit_id, dan kolom FO lain. CHECK asal memuat 'online' tetapi stub tidak
-- punya chat_sesi_id, jadi kunjungan online produksi (wajib chat_sesi_id) tidak bisa ditiru penuh.
CREATE TABLE public.kunjungan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengunjung_id uuid REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  nama text NOT NULL,
  kontak_hp text,
  email text,
  kategori text,
  asal text NOT NULL CHECK (asal IN ('walk_in', 'reservasi', 'online')),
  qr_token text UNIQUE,
  tanggal date NOT NULL,
  status text NOT NULL DEFAULT 'menunggu'
    CHECK (status IN ('terjadwal', 'menunggu', 'dilayani', 'selesai', 'batal', 'no_show', 'tidak_terlayani')),
  selesai_at timestamptz,
  layanan_saran_id uuid REFERENCES public.layanan(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT kunjungan_kategori_check
    CHECK (kategori IS NULL OR kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor'))
);

-- 202607290013, hanya kolom yang dipakai fitur ini (waktu_terbit dibaca kunjungan_layanan_skm).
CREATE TABLE public.tiket_antrean (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunjungan_id uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  layanan_id uuid NOT NULL REFERENCES public.layanan(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'menunggu'
    CHECK (status IN ('menunggu', 'dipanggil', 'dilayani', 'selesai', 'batal', 'no_show', 'tidak_terlayani')),
  waktu_terbit timestamptz NOT NULL DEFAULT now(),
  waktu_selesai timestamptz
);

-- Baseline 202607140003 persis, ditambah kunjungan_id + indeks unik parsial dari 202610140007.
CREATE TABLE public.skm_respons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id uuid REFERENCES public.visit(id) ON DELETE SET NULL,
  layanan_id uuid REFERENCES public.layanan(id) ON DELETE RESTRICT,
  u1_persyaratan smallint CHECK (u1_persyaratan BETWEEN 1 AND 4),
  u2_prosedur smallint CHECK (u2_prosedur BETWEEN 1 AND 4),
  u3_waktu smallint CHECK (u3_waktu BETWEEN 1 AND 4),
  u4_biaya smallint CHECK (u4_biaya BETWEEN 1 AND 4),
  u5_produk smallint CHECK (u5_produk BETWEEN 1 AND 4),
  u6_kompetensi smallint CHECK (u6_kompetensi BETWEEN 1 AND 4),
  u7_perilaku smallint CHECK (u7_perilaku BETWEEN 1 AND 4),
  u8_sarana smallint CHECK (u8_sarana BETWEEN 1 AND 4),
  u9_pengaduan smallint CHECK (u9_pengaduan BETWEEN 1 AND 4),
  saran text,
  created_at timestamptz NOT NULL DEFAULT now(),
  kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE SET NULL
);
CREATE INDEX idx_skm_layanan ON public.skm_respons(layanan_id);
CREATE INDEX idx_skm_visit ON public.skm_respons(visit_id);
CREATE INDEX idx_skm_created ON public.skm_respons(created_at DESC);
CREATE UNIQUE INDEX skm_respons_visit_id_uniq
  ON public.skm_respons(visit_id) WHERE visit_id IS NOT NULL;
CREATE UNIQUE INDEX skm_respons_kunjungan_id_uniq
  ON public.skm_respons (kunjungan_id) WHERE kunjungan_id IS NOT NULL;

-- ============================================================
-- 4. Fungsi helper akses (badan ASLI dari produksi kecuali dicatat)
-- ============================================================
-- Salinan 202610080001 (staf_saya, boleh_layanan).
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

-- Salinan 202610090001:28 (peran_saya).
CREATE OR REPLACE FUNCTION public.peran_saya()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT me.role FROM public.staf_saya() AS me
$$;

REVOKE ALL ON FUNCTION public.peran_saya() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peran_saya() TO authenticated, service_role;

-- STUB (disederhanakan): boleh_kunjungan produksi terakhir ada di 202610140009 dan punya cabang
-- ketiga untuk kunjungan online (join chat_sesi). Stub tidak punya chat_sesi, jadi cabang itu
-- dibuang; dua cabang lain sama persis dengan produksi (admin/front_office, atau petugas yang
-- layanannya punya tiket pada kunjungan itu).
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

REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;

-- Salinan 202610140007:1115 (kunjungan_layanan_skm).
CREATE OR REPLACE FUNCTION public.kunjungan_layanan_skm(p_kunjungan_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.layanan_id
  FROM public.tiket_antrean AS t
  WHERE t.kunjungan_id = p_kunjungan_id AND t.status = 'selesai'
  ORDER BY t.waktu_selesai DESC NULLS LAST, t.waktu_terbit DESC, t.id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.kunjungan_layanan_skm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kunjungan_layanan_skm(uuid) TO service_role;

-- ============================================================
-- 5. Trigger selesai_at (salinan 202610140003; BEFORE INSERT/UPDATE kunjungan)
-- ============================================================
-- Tanpa ini selesai_at tidak pernah terisi saat status berubah, padahal produksi mengisinya dari jam
-- server dan pembaca (mis. kedaluwarsa undangan survei) bergantung padanya. Catatan perilaku produksi:
-- saat status BERUBAH ke status akhir, selesai_at dipaksa now() (nilai yang dikirim diabaikan); selama
-- status tidak berubah, selesai_at lama dipertahankan.
CREATE OR REPLACE FUNCTION public.kunjungan_isi_selesai_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IN ('selesai', 'batal', 'no_show', 'tidak_terlayani') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.selesai_at := COALESCE(NEW.selesai_at, pg_catalog.now());
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.selesai_at := pg_catalog.now();
    ELSE
      NEW.selesai_at := OLD.selesai_at;
    END IF;
  ELSE
    NEW.selesai_at := NULL;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.kunjungan_isi_selesai_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_kunjungan_selesai_at
  BEFORE INSERT OR UPDATE ON public.kunjungan
  FOR EACH ROW EXECUTE FUNCTION public.kunjungan_isi_selesai_at();

-- ============================================================
-- 6. RLS (aktif di semua tabel stub; policy hanya yang disalin dari produksi)
-- ============================================================
ALTER TABLE public.layanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petugas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengunjung ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kunjungan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiket_antrean ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skm_respons ENABLE ROW LEVEL SECURITY;

-- Baseline 202607140004:624.
CREATE POLICY "layanan_public_read" ON public.layanan FOR SELECT USING (true);

-- 202610090001:268 (RBAC tahap 1): SKM rinci hanya Admin/FO; petugas lewat view.
CREATE POLICY skm_select_staff ON public.skm_respons FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office'));
