-- 202611010002_tiket_antrean_lingkup.sql
-- Menutup celah RLS tiket_antrean yang dicatat di docs/SERAH-TERIMA-LAYANAN-DINAMIS.md bagian C. Forward-only, ADITIF terhadap
-- data (B1): hanya satu fungsi baru dan penggantian satu policy SELECT. Tidak ada DELETE/TRUNCATE/DROP TABLE/DROP COLUMN.
--
-- MASALAH (terbukti lewat scripts/lokal-rantai/skenario-akses-data.mjs pada skema asli)
--   Policy tiket_staff_select (202607290013) tidak punya klausa TO dan memakai `admin/front_office = semua tiket,
--   petugas = semua tiket layanannya, SEMUA tanggal`. Setelah Fase 3 (202610290001) kunjungan, penanganan, dan pendataan
--   sudah per orang, tetapi tiket rekan yang sudah tutup (nomor, layanan, status, waktu mulai/selesai, siapa yang melayani)
--   masih terbaca oleh setiap FO dan setiap petugas satu layanan, semua tanggal.
--
-- ISI
--   1. boleh_tiket_baca(p_kunjungan, p_layanan, p_tanggal): TRUE bila (a) admin atau FO Koordinator, (b) boleh_kunjungan() atas
--      kunjungan tiket itu (data yang ia tangani, kunjungan terbuka dalam jendela operasional, Petugas Koordinator =
--      layanannya), atau (c) HARI INI (WIB): FO membaca semua tiket hari ini, petugas membaca tiket layanannya hari ini
--      (antrean, hitungan, dan rata-rata durasi hari berjalan di dasbor tetap bekerja).
--   2. tiket_staff_select diganti: TO authenticated USING boleh_tiket_baca(...). Policy tiket_select_own (pengunjung) tidak berubah.
--   DAMPAK PRODUK: tiket hari-hari SEBELUMNYA milik rekan tidak lagi terbaca oleh FO/petugas biasa (mis. halaman Antrian
--   dengan tanggal lampau). Koordinator dan admin tetap melihat sesuai lingkup; riwayat lintas orang lewat Rekap (RPC berlingkup).
--
-- SYARAT / URUTAN: setelah 202611010001 (dan 202610290001 untuk boleh_kunjungan/staf_lingkup).
-- PENERAPAN (pemilik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202611010002_tiket_antrean_lingkup.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202611010002_tiket_antrean_lingkup.sql --atomic
-- KLIEN: aman di-deploy sebelum/sesudah migrasi ini (tidak ada kontrak API yang berubah).
-- ROLLBACK: docs/rollback-tiket-antrean-lingkup-202611010002.sql (mengembalikan policy 202607290013).
-- Idempoten.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_kunjungan(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290001_koordinator_akses_data belum diterapkan';
  END IF;
  IF pg_catalog.to_regclass('public.tiket_antrean') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel tiket_antrean belum ada';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.boleh_tiket_baca(p_kunjungan uuid, p_layanan uuid, p_tanggal date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staf_lingkup() AS me
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (p_tanggal = (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
           AND (me.role = 'front_office'
                OR (me.role = 'petugas' AND me.layanan_id IS NOT NULL AND me.layanan_id = p_layanan)))
  ) OR public.boleh_kunjungan(p_kunjungan)
$$;

REVOKE ALL ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) IS
  '202611010002: lingkup baca tiket_antrean staf. Admin/FO Koordinator semua; boleh_kunjungan(); hari ini (WIB): FO semua, petugas layanannya.';

DROP POLICY IF EXISTS tiket_staff_select ON public.tiket_antrean;
CREATE POLICY tiket_staff_select ON public.tiket_antrean FOR SELECT TO authenticated
  USING (public.boleh_tiket_baca(kunjungan_id, layanan_id, tanggal));
