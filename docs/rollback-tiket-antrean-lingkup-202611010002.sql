-- docs/rollback-tiket-antrean-lingkup-202611010002.sql
-- Rollback 202611010002_tiket_antrean_lingkup. HANYA pemilik, atomik, dry-run dulu:
--   node scripts/apply-migration.mjs docs/rollback-tiket-antrean-lingkup-202611010002.sql --atomic --dry-run
-- Mengembalikan policy tiket_staff_select persis seperti 202607290013 (membuka kembali tiket rekan) dan menghapus fungsi baru.
DROP POLICY IF EXISTS tiket_staff_select ON public.tiket_antrean;
CREATE POLICY tiket_staff_select ON public.tiket_antrean FOR SELECT
  USING (public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id());
DROP FUNCTION IF EXISTS public.boleh_tiket_baca(uuid, uuid, date);
