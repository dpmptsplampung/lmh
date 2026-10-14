-- Rollback manual migrasi 202610140008_wp24_tutup_otomatis_retensi.sql.
-- Terapkan ATOMIK (dry-run dulu), SEBELUM rollback 202610140007:
--   node scripts/apply-migration.mjs docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql --atomic
--
-- Yang dikembalikan:
--   1. Job pg_cron 'penanganan_tutup_otomatis' dihapus; fungsi tutup_penanganan_tertinggal() di-DROP.
--   2. anonymize_inactive_pengunjung() dipulihkan PERSIS dari 202607140004_security_and_automation.sql (hanya tabel
--      pengunjung; job 'anonymize_inactive_pengunjung' tidak disentuh).
--   3. CHECK penanganan_batal_karena_check kembali ke (dialihkan, diambil_alih, tidak_terlayani) seperti 202610140003.
--      Bila sudah ada tahap batal_karena = 'tidak_ditutup', rollback DITOLAK kecuali flag transaksi sadar
--      lmh.rollback_paksa = 'on' (SELECT set_config('lmh.rollback_paksa','on',true) di transaksi yang sama); dengan flag,
--      tahap itu diubah menjadi 'tidak_terlayani' (catatan sistem "Ditutup otomatis ..." tetap menjelaskan asalnya).
-- TIDAK dikembalikan (data): status tiket/kunjungan yang sudah ditutup job, baris audit_log 'tutup_otomatis_penanganan',
-- nilai yang sudah dianonimkan (anonimisasi tidak dapat dibalik).
-- Idempoten.

DO $$
DECLARE
  v_paksa boolean := COALESCE(pg_catalog.current_setting('lmh.rollback_paksa', true), '') = 'on';
  v_n     integer;
BEGIN
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.penanganan WHERE batal_karena = 'tidak_ditutup';
  IF v_n > 0 AND NOT v_paksa THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: % tahap batal_karena tidak_ditutup (ekspor dulu; lalu nyalakan lmh.rollback_paksa)', v_n;
  END IF;
  IF v_n > 0 THEN
    UPDATE public.penanganan SET batal_karena = 'tidak_terlayani' WHERE batal_karena = 'tidak_ditutup';
    RAISE NOTICE 'rollback 202610140008: % tahap tidak_ditutup diubah menjadi tidak_terlayani', v_n;
  END IF;
END $$;

-- 1. Job + fungsi penutupan otomatis
DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid) FROM cron.job AS job WHERE job.jobname = 'penanganan_tutup_otomatis';
END $$;
DROP FUNCTION IF EXISTS public.tutup_penanganan_tertinggal();

-- 2. anonymize_inactive_pengunjung <- 202607140004_security_and_automation.sql
CREATE OR REPLACE FUNCTION public.anonymize_inactive_pengunjung()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.pengunjung
  SET nama = '[anonim]', email = NULL, foto_url = NULL
  WHERE updated_at < pg_catalog.now() - INTERVAL '730 days' AND email IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.anonymize_inactive_pengunjung() FROM PUBLIC, anon, authenticated;

-- 3. CHECK batal_karena <- 202610140003_fo_model_data.sql
ALTER TABLE public.penanganan DROP CONSTRAINT IF EXISTS penanganan_batal_karena_check;
ALTER TABLE public.penanganan ADD CONSTRAINT penanganan_batal_karena_check
  CHECK (batal_karena IN ('dialihkan', 'diambil_alih', 'tidak_terlayani'));
