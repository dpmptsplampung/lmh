-- 202610090005_perbaikan_review.sql
-- Perbaikan hasil review independen R-F atas migrasi 20261009 0001-0004. Syarat: 0001-0004 sudah diterapkan.
--
--   1. FO aktif boleh MEMBACA tabel petugas (daftar petugas per layanan di modal absensi, embed nama pada
--      halaman absensi). Hanya SELECT; tulis tetap Admin saja. Catatan: FO ikut melihat kolom lain pada
--      baris petugas (mis. email_notifikasi, no_hp); FO adalah staf kantor yang sama dan matriks K1
--      memang membuka daftar akun (nama/layanan/no HP/status) bagi FO. Lihat residual di runbook.
--   2. rahasia_pengaturan.host: kunci API terikat ke host base_url (diikat saat dibuat atau saat pertama
--      dipakai; route menolak host lain). Rahasia lama (host NULL) diikat saat pertama kali dipakai.
--   3. Penjaga hapus Admin aktif terakhir. AFTER DELETE per baris (dipicu di AKHIR pernyataan, jadi
--      penghapusan beberapa admin sekaligus pun tertangkap) dan ikut terpicu oleh cascade dari auth.users.
--      Batas: TRUNCATE dan session_replication_role=replica melewati trigger (hanya pemilik DB).
--   4. Jam tutup layanan dikunci 16:00: job akhir-hari pg_cron (09:00 UTC = 16:00 WIB) berjadwal tetap,
--      jadi site_settings.jam_tutup_layanan selain '16:00' ditolak (menghindari walk-in diterima setelah
--      job menutup tiket, atau ditolak sebelum job). Mengubah jam = migrasi yang menggeser job dan nilai
--      ini bersamaan. Bypass untuk tes/migrasi: set_config('lmh.izinkan_jam_tutup','on',true).
--
-- PENERAPAN ATOMIK: node scripts/apply-migration.mjs supabase/migrations/202610090005_perbaikan_review.sql --atomic --yes
-- Rollback: docs/rollback-rbac-akhir-202610090005.sql (urutan rollback 5 -> 4 -> 3 -> 2 -> 1).

-- ============================================================
-- 1. FO membaca petugas
-- ============================================================
DROP POLICY IF EXISTS petugas_fo_read ON public.petugas;
CREATE POLICY petugas_fo_read ON public.petugas FOR SELECT TO authenticated
  USING (public.get_my_role() = 'front_office');

-- ============================================================
-- 2. Ikat rahasia ke host
-- ============================================================
ALTER TABLE public.rahasia_pengaturan ADD COLUMN IF NOT EXISTS host text;
COMMENT ON COLUMN public.rahasia_pengaturan.host IS 'Host base_url tempat kunci ini boleh dikirim. NULL = belum terikat (diikat saat pertama dipakai).';

-- ============================================================
-- 3. Admin aktif terakhir tidak boleh dihapus
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_admin_terakhir_hapus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.role = 'admin' AND OLD.aktif
     AND NOT EXISTS (SELECT 1 FROM public.petugas AS a WHERE a.role = 'admin' AND a.aktif = true) THEN
    RAISE EXCEPTION 'tidak boleh menghapus Admin aktif terakhir';
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.guard_admin_terakhir_hapus() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_admin_terakhir_hapus ON public.petugas;
CREATE TRIGGER trg_guard_admin_terakhir_hapus AFTER DELETE ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_terakhir_hapus();

-- ============================================================
-- 4. Jam tutup layanan = 16:00 (mengikuti job akhir-hari)
-- ============================================================
CREATE OR REPLACE FUNCTION public.guard_jam_tutup_layanan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.key = 'jam_tutup_layanan'
     AND NEW.value IS DISTINCT FROM '16:00'
     AND COALESCE(pg_catalog.current_setting('lmh.izinkan_jam_tutup', true), '') <> 'on' THEN
    RAISE EXCEPTION 'jam_tutup_layanan dikunci 16:00 (job akhir-hari berjadwal 09:00 UTC); ubah lewat migrasi bersama jadwal job'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_jam_tutup_layanan ON public.site_settings;
CREATE TRIGGER trg_guard_jam_tutup_layanan BEFORE INSERT OR UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_jam_tutup_layanan();
