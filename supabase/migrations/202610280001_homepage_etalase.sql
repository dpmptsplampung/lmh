-- 202610280001_homepage_etalase.sql
-- Fase 2 (homepage etalase + popup layanan). Spesifikasi: docs/superpowers/specs (rancangan layanan
-- dinamis) bagian 5; rencana: docs/superpowers/plans/2026-10-28-fase-2-homepage-etalase.md.
-- BELUM diterapkan ke database mana pun; tes kontrak statis di supabase/migrations/homepage_etalase.test.ts.
-- Urutan terap: 202610270001, 202610270002, lalu berkas ini.
--
--   1. layanan.tampil_di_homepage (saklar baru, default true) + v_layanan_publik memuatnya (kolom di AKHIR).
--   1b. audit_perubahan() ditambah 'jenis' pada COALESCE entitas_id (tabel homepage_blok berkunci 'jenis').
--   2. homepage_blok: konfigurasi blok homepage (aktif, urutan, teks) per jenis blok tetap. Baris awal
--      diisi insert-if-missing; teks hero/layanan/ajakan/footer DISALIN dari landing_content aktif
--      (baris lama tidak diubah).
--   3. layanan_status_hari_ini(): status buka/tutup SAAT INI (hari + jam WIB) + jadwal mingguan tiap layanan publik,
--      memakai is_layanan_buka_jadwal (satu-satunya logika keputusan jadwal), dibaca anon.
--
-- Tidak ada UPDATE/DELETE/DROP atas data yang ada.

-- ============================================================
-- 1. Saklar tampil di homepage
-- ============================================================
ALTER TABLE public.layanan
  ADD COLUMN IF NOT EXISTS tampil_di_homepage boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.layanan.tampil_di_homepage IS 'Admin: layanan punya kartu di etalase homepage. Popup /?layanan=<slug> tetap bisa dibuka walau false.';

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
  ) AS website_terkait,
  l.tampil_di_homepage
FROM public.layanan AS l
LEFT JOIN public.instansi AS i ON i.id = l.instansi_id
WHERE l.aktif = true AND l.status_tampilan <> 'nonaktif';

REVOKE ALL  ON public.v_layanan_publik FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layanan_publik TO anon, authenticated;

-- ============================================================
-- 2. Blok homepage
-- ============================================================
CREATE TABLE IF NOT EXISTS public.homepage_blok (
  jenis      text PRIMARY KEY CHECK (jenis IN ('hero', 'jalur_cepat', 'status_hari_ini', 'layanan', 'papan_kinerja', 'ajakan', 'footer')),
  aktif      boolean NOT NULL DEFAULT true,
  urutan     integer NOT NULL DEFAULT 100,
  teks       jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(teks) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.homepage_blok IS 'Blok homepage berjenis tetap: aktif (tampil/tidak), urutan, dan teks yang bisa diubah Admin. Blok tidak aktif tidak dirender. Dibaca publik.';
COMMENT ON COLUMN public.homepage_blok.teks IS 'Objek JSON kunci->teks; kunci yang kosong memakai teks bawaan aplikasi.';

DROP TRIGGER IF EXISTS trg_homepage_blok_updated_at ON public.homepage_blok;
CREATE TRIGGER trg_homepage_blok_updated_at
  BEFORE UPDATE ON public.homepage_blok
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.homepage_blok ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS homepage_blok_public_read ON public.homepage_blok;
DROP POLICY IF EXISTS homepage_blok_admin_all ON public.homepage_blok;
CREATE POLICY homepage_blok_public_read ON public.homepage_blok
  FOR SELECT USING (true);
CREATE POLICY homepage_blok_admin_all ON public.homepage_blok
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
GRANT SELECT ON TABLE public.homepage_blok TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.homepage_blok TO authenticated;

-- audit_perubahan() (202610090004) disalin UTUH; satu-satunya perubahan: entitas_id juga mencoba kolom 'jenis'
-- (kunci utama homepage_blok) supaya entri audit tidak NULL. Tabel lain tidak terpengaruh (id/layanan_id/key menang lebih dulu).
CREATE OR REPLACE FUNCTION public.audit_perubahan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor   uuid := auth.uid();
  v_role    text;
  v_old     jsonb;
  v_new     jsonb;
  v_d_old   jsonb;
  v_d_new   jsonb;
  v_baris   jsonb;
  v_aksi    text;
BEGIN
  -- petugas: perubahan lewat service_role (tanpa auth.uid) sudah dicatat route akun; jangan dobel.
  IF TG_TABLE_NAME = 'petugas' AND v_actor IS NULL THEN
    RETURN NULL;
  END IF;

  IF TG_OP <> 'INSERT' THEN v_old := public.audit_saring(pg_catalog.to_jsonb(OLD), TG_ARGV); END IF;
  IF TG_OP <> 'DELETE' THEN v_new := public.audit_saring(pg_catalog.to_jsonb(NEW), TG_ARGV); END IF;
  v_baris := CASE WHEN TG_OP = 'DELETE' THEN pg_catalog.to_jsonb(OLD) ELSE pg_catalog.to_jsonb(NEW) END;

  IF TG_OP = 'UPDATE' THEN
    SELECT pg_catalog.jsonb_object_agg(e.key, e.value) INTO v_d_old
      FROM pg_catalog.jsonb_each(v_old) AS e WHERE v_new -> e.key IS DISTINCT FROM e.value;
    SELECT pg_catalog.jsonb_object_agg(e.key, e.value) INTO v_d_new
      FROM pg_catalog.jsonb_each(v_new) AS e WHERE v_old -> e.key IS DISTINCT FROM e.value;
    IF v_d_new IS NULL AND v_d_old IS NULL THEN
      RETURN NULL;   -- tidak ada perubahan pada kolom yang dicatat
    END IF;
    v_old := v_d_old; v_new := v_d_new;
  END IF;

  -- site_settings: nilai kunci rahasia tidak disimpan.
  IF TG_TABLE_NAME = 'site_settings'
     AND (v_baris ->> 'key') ~* '(secret|token|password|passwd|api[_-]?key|private)' THEN
    IF v_old ? 'value' THEN v_old := pg_catalog.jsonb_set(v_old, '{value}', '"[disamarkan]"'); END IF;
    IF v_new ? 'value' THEN v_new := pg_catalog.jsonb_set(v_new, '{value}', '"[disamarkan]"'); END IF;
  END IF;

  SELECT p.role INTO v_role FROM public.petugas AS p WHERE p.auth_user_id = v_actor;
  v_aksi := TG_TABLE_NAME || '_' || CASE TG_OP WHEN 'INSERT' THEN 'tambah' WHEN 'UPDATE' THEN 'ubah' ELSE 'hapus' END;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    v_actor,
    COALESCE(v_role, CASE WHEN v_actor IS NULL THEN 'system' ELSE 'pengunjung' END),
    v_aksi,
    TG_TABLE_NAME,
    COALESCE(v_baris ->> 'id', v_baris ->> 'layanan_id', v_baris ->> 'key', v_baris ->> 'jenis'),
    pg_catalog.jsonb_build_object('op', TG_OP),
    v_old,
    v_new
  );
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.audit_perubahan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_homepage_blok ON public.homepage_blok;
CREATE TRIGGER trg_audit_homepage_blok AFTER INSERT OR UPDATE OR DELETE ON public.homepage_blok
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

-- Baris awal (insert-if-missing). Teks disalin dari landing_content aktif bila ada; kunci yang tidak ada
-- memakai teks bawaan aplikasi. Judul bagian layanan lama ("10 Layanan ...") sengaja TIDAK disalin:
-- judul kini dihitung dari data.
INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('hero', true, 10,
  COALESCE((
    SELECT jsonb_object_agg(c.item_key, c.item_value)
    FROM public.landing_content AS c
    WHERE c.section = 'hero' AND c.is_active = true AND c.item_value IS NOT NULL AND c.item_value <> ''
      AND c.item_key IN ('badge_text', 'description', 'cta_primary_text', 'cta_primary_link', 'cta_secondary_text', 'cta_secondary_link')
  ), '{}'::jsonb))
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('jalur_cepat', true, 20, '{}'::jsonb)
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('status_hari_ini', true, 30, '{}'::jsonb)
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('layanan', true, 40,
  COALESCE((
    SELECT jsonb_object_agg(c.item_key, c.item_value)
    FROM public.landing_content AS c
    WHERE c.section = 'section_header' AND c.is_active = true AND c.item_value IS NOT NULL AND c.item_value <> ''
      AND c.item_key IN ('label', 'description')
  ), '{}'::jsonb))
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('papan_kinerja', false, 50, '{}'::jsonb)
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('ajakan', true, 60,
  COALESCE((
    SELECT jsonb_object_agg(c.item_key, c.item_value)
    FROM public.landing_content AS c
    WHERE c.section = 'cta' AND c.is_active = true AND c.item_value IS NOT NULL AND c.item_value <> ''
      AND c.item_key IN ('title', 'description', 'button_text', 'button_link')
  ), '{}'::jsonb))
ON CONFLICT (jenis) DO NOTHING;

INSERT INTO public.homepage_blok (jenis, aktif, urutan, teks)
VALUES ('footer', true, 70,
  COALESCE((
    SELECT jsonb_object_agg(c.item_key, c.item_value)
    FROM public.landing_content AS c
    WHERE c.section = 'footer' AND c.is_active = true AND c.item_value IS NOT NULL AND c.item_value <> ''
      AND c.item_key IN ('copyright')
  ), '{}'::jsonb))
ON CONFLICT (jenis) DO NOTHING;

-- ============================================================
-- 3. Status buka/tutup hari ini + jadwal mingguan, untuk etalase publik
-- ============================================================
-- SECURITY DEFINER: hanya memuat data jadwal yang memang publik (jadwal_standby/hari_libur dibaca anon),
-- digabung dalam satu panggilan agar etalase tidak memanggil is_layanan_buka_jadwal per layanan.
-- Keputusan buka/tutup tetap SATU: is_layanan_buka_jadwal (arsip, hari libur, pengecualian, pola mingguan),
-- dinilai pada JAM WIB SEKARANG: sebelum jam buka dan sesudah jam tutup hasilnya false.
CREATE OR REPLACE FUNCTION public.layanan_status_hari_ini()
RETURNS TABLE (
  layanan_id      uuid,
  buka_sekarang   boolean,
  libur_keterangan text,
  jadwal          jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hari_ini date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_jam      time := (now() AT TIME ZONE 'Asia/Jakarta')::time;
  v_libur    text;
BEGIN
  SELECT h.keterangan INTO v_libur FROM public.hari_libur AS h WHERE h.tanggal = v_hari_ini;

  RETURN QUERY
  SELECT
    l.id,
    public.is_layanan_buka_jadwal(l.id, v_hari_ini, v_jam),
    v_libur,
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
                 pg_catalog.jsonb_build_object(
                   'hari', s.hari,
                   'jam_mulai', pg_catalog.to_char(s.jam_mulai, 'HH24:MI'),
                   'jam_selesai', pg_catalog.to_char(s.jam_selesai, 'HH24:MI')
                 )
                 ORDER BY s.hari
               )
        FROM public.jadwal_standby AS s
        WHERE s.layanan_id = l.id AND s.aktif = true
      ),
      '[]'::jsonb
    )
  FROM public.layanan AS l
  WHERE l.aktif = true AND l.status_tampilan <> 'nonaktif';
END $$;

REVOKE ALL ON FUNCTION public.layanan_status_hari_ini() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.layanan_status_hari_ini() TO anon, authenticated;
