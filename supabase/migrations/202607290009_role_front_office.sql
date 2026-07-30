-- 202607290009_role_front_office.sql
-- WP-15 / RBA-02 / RBA-01: tambah peran 'front_office' pada petugas.role.
--
-- FO punya wewenang LINTAS-LAYANAN (absensi semua P4, jadwal, takeover chat, buku
-- tamu, pengaduan jalur layanan) yang tidak bisa diwakili oleh 'petugas'.
-- ADITIF (nilai CHECK diperluas). OPS-08: kode TS diperbarui di WP yang sama.

-- 1. Perluas CHECK role agar menampung front_office.
ALTER TABLE public.petugas DROP CONSTRAINT IF EXISTS petugas_role_check;
ALTER TABLE public.petugas ADD CONSTRAINT petugas_role_check
  CHECK (role IN ('petugas','admin','front_office'));

-- 2. get_my_layanan_id(): untuk FO, mengembalikan NULL (lintas layanan) — tidak
--    berubah, tapi dokumentasikan bahwa FO tidak terikat satu layanan.
--    (get_my_role() sudah mengembalikan role apa pun untuk petugas aktif.)

-- 3. Helper: apakah pengguna saat ini punya pandangan lintas-layanan (admin ATAU FO).
CREATE OR REPLACE FUNCTION public.is_cross_service_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.get_my_role() IN ('admin','front_office')
$$;

REVOKE ALL ON FUNCTION public.is_cross_service_staff() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_cross_service_staff() TO authenticated;

-- 4. Perluas RLS yang perlu lintas-layanan FO (pengaduan jalur layanan sudah
--    memasukkan front_office di WP-12). Tambahkan FO ke absensi & jadwal lintas-layanan.
DROP POLICY IF EXISTS absensi_cross_service_read ON public.absensi_petugas;
CREATE POLICY absensi_cross_service_read ON public.absensi_petugas FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin','front_office'));

DROP POLICY IF EXISTS layanan_jadwal_cross_service_write ON public.layanan_jadwal;
CREATE POLICY layanan_jadwal_cross_service_write ON public.layanan_jadwal FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

DROP POLICY IF EXISTS layanan_libur_cross_service_write ON public.layanan_libur;
CREATE POLICY layanan_libur_cross_service_write ON public.layanan_libur FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));
