-- 202610080002_rbac_tahap0_layanan_admin_only.sql
-- RBAC Tahap 0, bagian S6 + keputusan CEO: data layanan, bot hidup/mati, jadwal, libur,
-- pola standby dan pengecualian = ADMIN saja. FO dan petugas hanya MEMBACA.
--
-- SYARAT TERAPKAN: frontend sudah berhenti menulis `layanan`/`layanan_jadwal`/`layanan_libur`
-- sebagai petugas/FO (daftar handoff UI di laporan S0):
--   - src/app/admin/chat/faq/page.tsx : toggle chatbot_aktif (update langsung ke `layanan`)
--   - src/app/admin/settings/jadwal/page.tsx : canEdit untuk petugas layanan PTSP
-- Bila diterapkan lebih awal, aksi itu gagal diam-diam (0 baris berubah) untuk petugas.
--
-- Yang TIDAK berubah: Admin (layanan_admin_all; admin tetap menulis semua tabel di bawah),
-- `layanan_hari` (Admin + FO; juga ditulis fungsi definer catat_absensi & cron), `jadwal_harian_beku`
-- (deny-all), dan semua kebijakan BACA publik.
--
-- PENERAPAN ATOMIK:
--   node scripts/apply-migration.mjs supabase/migrations/202610080002_rbac_tahap0_layanan_admin_only.sql --atomic --yes
--
-- Rollback: docs/rollback-rbac-tahap0-202610080002.sql

-- 1. Petugas tidak lagi boleh mengubah kolom apa pun pada `layanan` (termasuk is_ptsp, chatbot_aktif).
DROP POLICY IF EXISTS layanan_petugas_chatbot_toggle ON public.layanan;

-- 2. Jalur jadwal via is_ptsp_staff() (petugas layanan PTSP menulis jadwal SEMUA layanan) dihapus.
DROP POLICY IF EXISTS jadwal_ptsp_write ON public.layanan_jadwal;
DROP POLICY IF EXISTS libur_ptsp_write ON public.layanan_libur;
DROP POLICY IF EXISTS hari_libur_staff_write ON public.hari_libur;   -- ada di repo (202609020001), tidak ada di produksi

-- 3. Tulis jadwal/libur/standby/pengecualian: FO dicabut, Admin tetap (aktif via get_my_role()).
DROP POLICY IF EXISTS layanan_jadwal_cross_service_write ON public.layanan_jadwal;
DROP POLICY IF EXISTS layanan_jadwal_admin_write ON public.layanan_jadwal;  -- idempoten (aman diterapkan ulang)
CREATE POLICY layanan_jadwal_admin_write ON public.layanan_jadwal FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS layanan_libur_cross_service_write ON public.layanan_libur;
DROP POLICY IF EXISTS layanan_libur_admin_write ON public.layanan_libur;  -- idempoten (aman diterapkan ulang)
CREATE POLICY layanan_libur_admin_write ON public.layanan_libur FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS jadwal_standby_staff_write ON public.jadwal_standby;
DROP POLICY IF EXISTS jadwal_standby_admin_write ON public.jadwal_standby;  -- idempoten (aman diterapkan ulang)
CREATE POLICY jadwal_standby_admin_write ON public.jadwal_standby FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

DROP POLICY IF EXISTS jadwal_pengecualian_staff_write ON public.jadwal_pengecualian;
DROP POLICY IF EXISTS jadwal_pengecualian_admin_write ON public.jadwal_pengecualian;  -- idempoten (aman diterapkan ulang)
CREATE POLICY jadwal_pengecualian_admin_write ON public.jadwal_pengecualian FOR ALL
  USING (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
