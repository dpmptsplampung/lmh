-- Rollback manual migrasi 202610080002_rbac_tahap0_layanan_admin_only.sql.
-- Mengembalikan hak UPDATE petugas pada `layanan` (semua kolom, termasuk is_ptsp), jalur jadwal via
-- is_ptsp_staff(), dan hak tulis FO pada jadwal/libur/standby/pengecualian -- yaitu celah S6.
-- Pakai hanya bila UI petugas/FO terputus.
-- Terapkan secara ATOMIK:  node scripts/apply-migration.mjs docs/rollback-rbac-tahap0-202610080002.sql --atomic --yes
-- (hari_libur_staff_write TIDAK dibuat ulang: policy itu tidak ada di produksi sebelum migrasi.)
DROP POLICY IF EXISTS layanan_petugas_chatbot_toggle ON public.layanan;
CREATE POLICY layanan_petugas_chatbot_toggle ON public.layanan FOR UPDATE TO authenticated
  USING (id = public.get_my_layanan_id())
  WITH CHECK (id = public.get_my_layanan_id());

DROP POLICY IF EXISTS jadwal_ptsp_write ON public.layanan_jadwal;
CREATE POLICY jadwal_ptsp_write ON public.layanan_jadwal FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin' OR public.is_ptsp_staff())
  WITH CHECK (public.get_my_role() = 'admin' OR public.is_ptsp_staff());

DROP POLICY IF EXISTS libur_ptsp_write ON public.layanan_libur;
CREATE POLICY libur_ptsp_write ON public.layanan_libur FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin' OR public.is_ptsp_staff())
  WITH CHECK (public.get_my_role() = 'admin' OR public.is_ptsp_staff());

DROP POLICY IF EXISTS layanan_jadwal_admin_write ON public.layanan_jadwal;
DROP POLICY IF EXISTS layanan_jadwal_cross_service_write ON public.layanan_jadwal;
CREATE POLICY layanan_jadwal_cross_service_write ON public.layanan_jadwal FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office'))
  WITH CHECK (public.get_my_role() IN ('admin', 'front_office'));

DROP POLICY IF EXISTS layanan_libur_admin_write ON public.layanan_libur;
DROP POLICY IF EXISTS layanan_libur_cross_service_write ON public.layanan_libur;
CREATE POLICY layanan_libur_cross_service_write ON public.layanan_libur FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office'))
  WITH CHECK (public.get_my_role() IN ('admin', 'front_office'));

DROP POLICY IF EXISTS jadwal_standby_admin_write ON public.jadwal_standby;
DROP POLICY IF EXISTS jadwal_standby_staff_write ON public.jadwal_standby;
CREATE POLICY jadwal_standby_staff_write ON public.jadwal_standby FOR ALL
  USING (public.get_my_role() IN ('admin', 'front_office'))
  WITH CHECK (public.get_my_role() IN ('admin', 'front_office'));

DROP POLICY IF EXISTS jadwal_pengecualian_admin_write ON public.jadwal_pengecualian;
DROP POLICY IF EXISTS jadwal_pengecualian_staff_write ON public.jadwal_pengecualian;
CREATE POLICY jadwal_pengecualian_staff_write ON public.jadwal_pengecualian FOR ALL
  USING (public.get_my_role() IN ('admin', 'front_office'))
  WITH CHECK (public.get_my_role() IN ('admin', 'front_office'));
