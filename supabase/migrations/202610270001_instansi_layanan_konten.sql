-- 202610270001_instansi_layanan_konten.sql
-- Fase 1 (fondasi Layanan dinamis), langkah 1: model konten. Spesifikasi: docs/superpowers/specs
-- (rancangan layanan dinamis) dan ADR 0001. BELUM diterapkan ke database mana pun; tes kontrak statis
-- di supabase/migrations/instansi_layanan_konten.test.ts.
--
--   1. Tabel instansi (penyelenggara layanan) dan layanan_tautan (website terkait per layanan).
--   2. Kolom baru layanan (semua aditif): instansi_id, slug, deskripsi, urutan, konten_sumber_url,
--      konten_diperbarui_at, diarsipkan_at. slug diisi otomatis dari nama (trigger saat INSERT) dan
--      dibackfill untuk baris lama; ini SATU-SATUNYA UPDATE atas layanan.
--   3. Trigger tebakan form dari nama (trg_layanan_isi_form_pendataan, 202610140012) dicabut: form
--      pendataan kini ditetapkan eksplisit oleh Admin. Fungsinya dibiarkan.
--   4. v_layanan_publik: kolom baru ditambahkan DI AKHIR (WHERE tidak berubah).
--   5. RLS: baca publik; tulis Admin saja (TO authenticated). Audit lewat audit_perubahan().
--
-- Data lama tidak dihapus/diubah. Tabel jadwal lama tidak disentuh.

-- ============================================================
-- 1. Instansi
-- ============================================================
CREATE TABLE IF NOT EXISTS public.instansi (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama       text NOT NULL UNIQUE CHECK (char_length(nama) BETWEEN 2 AND 150),
  singkatan  text CHECK (char_length(singkatan) <= 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.instansi IS 'Instansi penyelenggara layanan (mis. DPMPTSP, Dinas Perdagangan). Dikelola Admin; dibaca publik.';
COMMENT ON COLUMN public.instansi.singkatan IS 'Singkatan tampilan (maks 30 karakter), opsional.';

DROP TRIGGER IF EXISTS trg_instansi_updated_at ON public.instansi;
CREATE TRIGGER trg_instansi_updated_at
  BEFORE UPDATE ON public.instansi
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. Slug layanan (fungsi, trigger isi otomatis)
-- ============================================================
-- Tanpa extension unaccent: karakter selain [a-z0-9] menjadi pemisah '-'.
CREATE OR REPLACE FUNCTION public.slug_dari_nama(p_nama text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(
    NULLIF(
      pg_catalog.btrim(
        pg_catalog.regexp_replace(pg_catalog.lower(COALESCE(p_nama, '')), '[^a-z0-9]+', '-', 'g'),
        '-'
      ),
      ''
    ),
    'layanan'
  );
$$;

REVOKE ALL ON FUNCTION public.slug_dari_nama(text) FROM PUBLIC, anon, authenticated;

-- Slug dasar dari nama + akhiran -2, -3, ... sampai belum dipakai layanan lain.
CREATE OR REPLACE FUNCTION public.layanan_slug_unik(p_nama text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dasar text := public.slug_dari_nama(p_nama);
  v_slug  text := v_dasar;
  v_n     integer := 1;
BEGIN
  WHILE EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.slug = v_slug) LOOP
    v_n := v_n + 1;
    v_slug := v_dasar || '-' || v_n::text;
  END LOOP;
  RETURN v_slug;
END $$;

REVOKE ALL ON FUNCTION public.layanan_slug_unik(text) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. Kolom baru layanan (aditif)
-- ============================================================
ALTER TABLE public.layanan
  ADD COLUMN IF NOT EXISTS instansi_id uuid REFERENCES public.instansi(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS slug text CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD COLUMN IF NOT EXISTS deskripsi text CHECK (char_length(deskripsi) <= 4000),
  ADD COLUMN IF NOT EXISTS urutan integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS konten_sumber_url text CHECK (konten_sumber_url ~ '^https://\S+$' AND char_length(konten_sumber_url) <= 500),
  ADD COLUMN IF NOT EXISTS konten_diperbarui_at timestamptz,
  ADD COLUMN IF NOT EXISTS diarsipkan_at timestamptz;

COMMENT ON COLUMN public.layanan.instansi_id IS 'Instansi penyelenggara layanan (opsional; ON DELETE RESTRICT).';
COMMENT ON COLUMN public.layanan.slug IS 'Pengenal URL unik (huruf kecil, angka, tanda hubung). Diisi otomatis dari nama bila kosong saat INSERT.';
COMMENT ON COLUMN public.layanan.deskripsi IS 'Deskripsi layanan untuk publik (maks 4000 karakter).';
COMMENT ON COLUMN public.layanan.urutan IS 'Urutan tampil di daftar publik (kecil dulu).';
COMMENT ON COLUMN public.layanan.konten_sumber_url IS 'Tautan https sumber konten layanan (maks 500 karakter).';
COMMENT ON COLUMN public.layanan.konten_diperbarui_at IS 'Kapan konten layanan terakhir diperbarui/ditinjau oleh Admin.';
COMMENT ON COLUMN public.layanan.diarsipkan_at IS 'Terisi bila layanan diarsipkan Admin (data historis tetap utuh).';

CREATE OR REPLACE FUNCTION public.layanan_isi_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := public.layanan_slug_unik(NEW.nama);
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.layanan_isi_slug() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_layanan_isi_slug ON public.layanan;
CREATE TRIGGER trg_layanan_isi_slug
  BEFORE INSERT ON public.layanan
  FOR EACH ROW EXECUTE FUNCTION public.layanan_isi_slug();

-- Backfill: hanya baris yang slug-nya masih NULL, urut nama agar akhiran -2/-3 deterministik.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, nama FROM public.layanan WHERE slug IS NULL ORDER BY nama LOOP
    UPDATE public.layanan SET slug = public.layanan_slug_unik(r.nama) WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE public.layanan ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_slug ON public.layanan (slug);

-- Form pendataan tidak lagi ditebak dari nama layanan (202610140012); Admin menetapkannya eksplisit.
DROP TRIGGER IF EXISTS trg_layanan_isi_form_pendataan ON public.layanan;

-- ============================================================
-- 4. Website terkait per layanan
-- ============================================================
CREATE TABLE IF NOT EXISTS public.layanan_tautan (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  url        text NOT NULL CHECK (url ~ '^https://\S+$' AND char_length(url) <= 500),
  urut       integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_layanan_tautan_layanan_urut ON public.layanan_tautan (layanan_id, urut);

COMMENT ON TABLE public.layanan_tautan IS 'Website terkait suatu layanan (label + URL https). Dikelola Admin; dibaca publik.';

-- ============================================================
-- 5. RLS + grant: baca publik, tulis Admin saja
-- ============================================================
ALTER TABLE public.instansi ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS instansi_public_read ON public.instansi;
DROP POLICY IF EXISTS instansi_admin_all ON public.instansi;
CREATE POLICY instansi_public_read ON public.instansi
  FOR SELECT USING (true);
CREATE POLICY instansi_admin_all ON public.instansi
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
GRANT SELECT ON TABLE public.instansi TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.instansi TO authenticated;

ALTER TABLE public.layanan_tautan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS layanan_tautan_public_read ON public.layanan_tautan;
DROP POLICY IF EXISTS layanan_tautan_admin_all ON public.layanan_tautan;
CREATE POLICY layanan_tautan_public_read ON public.layanan_tautan
  FOR SELECT USING (true);
CREATE POLICY layanan_tautan_admin_all ON public.layanan_tautan
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
GRANT SELECT ON TABLE public.layanan_tautan TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.layanan_tautan TO authenticated;

-- ============================================================
-- 6. Audit perubahan
-- ============================================================
DROP TRIGGER IF EXISTS trg_audit_instansi ON public.instansi;
CREATE TRIGGER trg_audit_instansi AFTER INSERT OR UPDATE OR DELETE ON public.instansi
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_layanan_tautan ON public.layanan_tautan;
CREATE TRIGGER trg_audit_layanan_tautan AFTER INSERT OR UPDATE OR DELETE ON public.layanan_tautan
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

-- ============================================================
-- 7. v_layanan_publik: kolom lama tetap di urutan semula, kolom baru di akhir; WHERE tidak berubah
-- ============================================================
CREATE OR REPLACE VIEW public.v_layanan_publik WITH (security_invoker = true) AS
SELECT
  l.id,
  l.nama,
  l.tipe,
  l.penyerta,
  l.status_tampilan,
  l.punya_antrean,
  l.punya_chat,
  l.chatbot_aktif,
  l.nomor_loket,
  l.prefiks_antrean,
  l.slug,
  l.deskripsi,
  l.urutan,
  i.nama      AS instansi_nama,
  i.singkatan AS instansi_singkatan,
  COALESCE(
    (
      SELECT pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('label', t.label, 'url', t.url)
               ORDER BY t.urut, t.created_at
             )
      FROM public.layanan_tautan AS t
      WHERE t.layanan_id = l.id
    ),
    '[]'::jsonb
  ) AS website_terkait
FROM public.layanan AS l
LEFT JOIN public.instansi AS i ON i.id = l.instansi_id
WHERE l.aktif = true AND l.status_tampilan <> 'nonaktif';

REVOKE ALL  ON public.v_layanan_publik FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layanan_publik TO anon, authenticated;
