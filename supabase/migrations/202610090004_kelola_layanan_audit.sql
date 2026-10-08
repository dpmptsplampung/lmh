-- 202610090004_kelola_layanan_audit.sql
-- RBAC gelombang penutup (sisi DB): Kelola Layanan (CMS), buku tamu, audit/Riwayat Perubahan.
-- Kontrak API/frontend: docs/RBAC_AKHIR_KONTRAK.md. Syarat: Tahap 0 (staf_saya/get_my_role aktif-saja),
-- 202610090002 (kolom petugas.username). Rollback: docs/rollback-rbac-akhir-202610090004.sql
--
--   1. layanan.tampil_di_layar (bool, default true). v_layar_antrian hanya memuat layanan aktif DAN
--      tampil_di_layar. v_layanan_publik = daftar layanan untuk landing/check-in/chat (menyembunyikan
--      status_tampilan='nonaktif'; 'coming_soon' tetap muncul agar bisa diberi label "segera").
--      Check-in/penerbitan tiket TIDAK membaca kolom tampilan ini (tidak diputus).
--      Tulis layanan = Admin saja (layanan_admin_all + Tahap 0); tidak ada perubahan policy di sini.
--   2. Buku tamu: Admin/FO baca & tambah (dicatat_oleh dipaksa = staf yang menulis); ubah/hapus Admin saja.
--   3. Audit: audit_log + kolom nilai_lama/nilai_baru (jsonb). Penulisan LANGSUNG oleh pengguna dicabut
--      (S14): hanya trigger/fungsi definer dan service_role. Trigger audit_perubahan() pada layanan,
--      layanan_jadwal, layanan_libur, site_settings, landing_content, faq_knowledge_base, layar_token,
--      petugas (UPDATE role/aktif/username/layanan_id/nama). Nilai rahasia tidak disimpan (token layar,
--      embedding, kunci/secret pada site_settings; teks > 500 karakter dipotong).
--
-- PENERAPAN ATOMIK: node scripts/apply-migration.mjs supabase/migrations/202610090004_kelola_layanan_audit.sql --atomic --yes

-- ============================================================
-- 1. Kelola Layanan: tampil di layar TV + daftar publik
-- ============================================================
ALTER TABLE public.layanan ADD COLUMN IF NOT EXISTS tampil_di_layar boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.layanan.tampil_di_layar IS 'Admin: layanan ikut tampil di layar TV antrean (v_layar_antrian).';
COMMENT ON COLUMN public.layanan.status_tampilan IS 'aktif=tampil, coming_soon=segera hadir, nonaktif=sembunyi dari daftar publik (v_layanan_publik). Tidak memengaruhi penerbitan tiket.';

-- Hanya WHERE yang berubah (kolom identik), jadi CREATE OR REPLACE aman.
CREATE OR REPLACE VIEW public.v_layar_antrian AS
SELECT
  l.id          AS layanan_id,
  l.nama        AS layanan_nama,
  l.tipe,
  count(t.id) FILTER (WHERE t.status = 'menunggu')   AS antre_count,
  count(t.id) FILTER (WHERE t.status = 'dilayani')   AS dilayani_count,
  max(t.nomor)  FILTER (WHERE t.status = 'dilayani') AS nomor_sedang_dilayani,
  max(t.nomor_display) FILTER (WHERE t.status = 'dilayani') AS nomor_display_dilayani,
  COALESCE((
    SELECT avg(EXTRACT(EPOCH FROM (t2.waktu_selesai - t2.waktu_mulai_layan)) / 60.0)
    FROM public.tiket_antrean t2
    WHERE t2.layanan_id = l.id
      AND t2.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND t2.waktu_selesai    IS NOT NULL
      AND t2.waktu_mulai_layan IS NOT NULL
  ), 15) AS estimasi_durasi_menit,
  count(t.id) FILTER (WHERE t.status = 'menunggu') * COALESCE((
    SELECT avg(EXTRACT(EPOCH FROM (t3.waktu_selesai - t3.waktu_mulai_layan)) / 60.0)
    FROM public.tiket_antrean t3
    WHERE t3.layanan_id = l.id
      AND t3.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND t3.waktu_selesai    IS NOT NULL
      AND t3.waktu_mulai_layan IS NOT NULL
  ), 15) AS estimasi_tunggu_total_menit
FROM public.layanan l
LEFT JOIN public.tiket_antrean t
  ON  t.layanan_id = l.id
  AND t.status IN ('menunggu', 'dilayani')
  AND t.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE l.aktif = true AND l.tampil_di_layar = true
GROUP BY l.id, l.nama, l.tipe;

REVOKE ALL  ON public.v_layar_antrian FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layar_antrian TO anon, authenticated;

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
  l.prefiks_antrean
FROM public.layanan AS l
WHERE l.aktif = true AND l.status_tampilan <> 'nonaktif';

REVOKE ALL  ON public.v_layanan_publik FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layanan_publik TO anon, authenticated;

-- ============================================================
-- 2. Buku tamu: Admin/FO baca + tambah; ubah/hapus Admin saja
-- ============================================================
DROP POLICY IF EXISTS buku_tamu_fo_admin_all ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_staff_select ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_staff_insert ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_admin_update ON public.buku_tamu;
DROP POLICY IF EXISTS buku_tamu_admin_delete ON public.buku_tamu;

CREATE POLICY buku_tamu_staff_select ON public.buku_tamu FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office'));
CREATE POLICY buku_tamu_staff_insert ON public.buku_tamu FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'front_office')
    AND dicatat_oleh IN (SELECT me.id FROM public.staf_saya() AS me)
    AND legacy_visit_id IS NULL
  );
CREATE POLICY buku_tamu_admin_update ON public.buku_tamu FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY buku_tamu_admin_delete ON public.buku_tamu FOR DELETE TO authenticated
  USING (public.get_my_role() = 'admin');

-- ============================================================
-- 3. Audit: kolom nilai, tutup tulis langsung (S14), trigger
-- ============================================================
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS nilai_lama jsonb,
  ADD COLUMN IF NOT EXISTS nilai_baru jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_log_entitas_waktu ON public.audit_log (entitas, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_aksi ON public.audit_log (aksi);

-- Pengguna biasa tidak lagi menulis audit_log. Penulis sah: trigger/fungsi SECURITY DEFINER (pemilik tabel)
-- dan service_role (route server).
DROP POLICY IF EXISTS audit_log_insert_own ON public.audit_log;
REVOKE ALL ON TABLE public.audit_log FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_log TO authenticated;
GRANT ALL ON TABLE public.audit_log TO service_role;

-- Saring jsonb baris: daftar putih bila p_kolom diisi, selain itu semua kolom kecuali yang rahasia/bising.
CREATE OR REPLACE FUNCTION public.audit_saring(p_row jsonb, p_kolom text[])
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(pg_catalog.jsonb_object_agg(
           e.key,
           CASE WHEN pg_catalog.jsonb_typeof(e.value) = 'string' AND pg_catalog.char_length(e.value #>> '{}') > 500
                THEN pg_catalog.to_jsonb(pg_catalog.left(e.value #>> '{}', 500) || '…')
                ELSE e.value END
         ), '{}'::jsonb)
  FROM pg_catalog.jsonb_each(p_row) AS e
  WHERE CASE
          WHEN pg_catalog.cardinality(p_kolom) > 0 THEN e.key = ANY (p_kolom)
          ELSE e.key NOT IN ('embedding', 'token', 'token_hash', 'password', 'created_at', 'updated_at', 'updated_by')
               AND e.key NOT LIKE '%tsv%' AND e.key NOT LIKE '%fts%'
        END
$$;

REVOKE ALL ON FUNCTION public.audit_saring(jsonb, text[]) FROM PUBLIC, anon, authenticated;

-- Trigger umum. TG_ARGV = daftar putih kolom (opsional). Entri hanya bila ada perubahan nyata.
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
    COALESCE(v_baris ->> 'id', v_baris ->> 'layanan_id', v_baris ->> 'key'),
    pg_catalog.jsonb_build_object('op', TG_OP),
    v_old,
    v_new
  );
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.audit_perubahan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_audit_layanan ON public.layanan;
CREATE TRIGGER trg_audit_layanan AFTER INSERT OR UPDATE OR DELETE ON public.layanan
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_layanan_jadwal ON public.layanan_jadwal;
CREATE TRIGGER trg_audit_layanan_jadwal AFTER INSERT OR UPDATE OR DELETE ON public.layanan_jadwal
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_layanan_libur ON public.layanan_libur;
CREATE TRIGGER trg_audit_layanan_libur AFTER INSERT OR UPDATE OR DELETE ON public.layanan_libur
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_site_settings ON public.site_settings;
CREATE TRIGGER trg_audit_site_settings AFTER INSERT OR UPDATE OR DELETE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_landing_content ON public.landing_content;
CREATE TRIGGER trg_audit_landing_content AFTER INSERT OR UPDATE OR DELETE ON public.landing_content
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan();

DROP TRIGGER IF EXISTS trg_audit_faq ON public.faq_knowledge_base;
CREATE TRIGGER trg_audit_faq AFTER INSERT OR UPDATE OR DELETE ON public.faq_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan('id', 'layanan_id', 'pertanyaan', 'jawaban', 'aktif', 'urutan');

-- Nilai kolom `token` layar TV TIDAK pernah dicatat (daftar putih tanpa token).
DROP TRIGGER IF EXISTS trg_audit_layar_token ON public.layar_token;
CREATE TRIGGER trg_audit_layar_token AFTER INSERT OR UPDATE OR DELETE ON public.layar_token
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan('id', 'nama', 'aktif');

-- petugas: INSERT/DELETE sudah dicatat audit_change (baseline); UPDATE role diganti trigger ini
-- (menyimpan nilai lama -> baru) dan diperluas ke aktif/username/layanan_id/nama.
DROP TRIGGER IF EXISTS trg_audit_petugas_role ON public.petugas;
DROP TRIGGER IF EXISTS trg_audit_petugas_ubah ON public.petugas;
CREATE TRIGGER trg_audit_petugas_ubah AFTER UPDATE OF role, aktif, username, layanan_id, nama ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan('id', 'nama', 'role', 'aktif', 'username', 'layanan_id');
