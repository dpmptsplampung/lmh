-- Rollback 202611030012_layar_tv.sql
-- Tanpa BEGIN/COMMIT (agar lolos --atomic):
--   node scripts/apply-migration.mjs docs/rollback-layar-tv-202611030012.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-layar-tv-202611030012.sql --atomic
-- MENGHAPUS data: seluruh kejadian panggilan_layar (hanya riwayat panggilan hari ini, tanpa identitas)
-- dan nilai layanan.nama_layar / layanan.urutan_layar.
-- Token layar 8 angka yang sudah dibuat TETAP sah (validate_layar_token lama mencocokkan persis);
-- DEFAULT kembali 32 hex (route admin yang membangkitkan 8 angka tidak terpengaruh).
-- Klien layar TV dan halaman Layar admin yang memakai kolom/tabel ini harus dikembalikan lebih dulu.

-- 1. Job retensi
DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid) FROM cron.job AS job WHERE job.jobname = 'layar_bersihkan';
END $$;
DROP FUNCTION IF EXISTS public.layar_bersihkan();

-- 2a. Token layar: DEFAULT dan validasi versi 202607300022
ALTER TABLE public.layar_token ALTER COLUMN token SET DEFAULT replace(gen_random_uuid()::text, '-', '');
ALTER TABLE public.layar_token DROP CONSTRAINT IF EXISTS layar_token_format_check;
DROP FUNCTION IF EXISTS public.layar_token_baru();

CREATE OR REPLACE FUNCTION public.validate_layar_token(p_token text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.layar_token
    WHERE token = p_token AND aktif = true
  );
END $$;

REVOKE ALL   ON FUNCTION public.validate_layar_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_layar_token(text) TO anon, authenticated;

-- 2b. panggil_tiket kembali ke versi 202610080001 (tanpa pencatatan kejadian)
CREATE OR REPLACE FUNCTION public.panggil_tiket(p_tiket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_nomor_display text;
  v_layanan_id    uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.staf_saya()) THEN
      RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT t.nomor_display, t.layanan_id
    INTO v_nomor_display, v_layanan_id
  FROM public.tiket_antrean AS t
  WHERE t.id = p_tiket_id
    AND t.status = 'menunggu';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.boleh_layanan(v_layanan_id) THEN
    RAISE EXCEPTION 'tiket bukan milik layanan Anda' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_notify(
    'nomor_dipanggil',
    json_build_object(
      'tiket_id',      p_tiket_id,
      'nomor_display', v_nomor_display,
      'layanan_id',    v_layanan_id
    )::text
  );

  RETURN v_nomor_display;
END $$;

REVOKE ALL ON FUNCTION public.panggil_tiket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panggil_tiket(uuid) TO authenticated, service_role;

-- 3. Publikasi Realtime + tabel kejadian
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'panggilan_layar') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.panggilan_layar;
  END IF;
END $$;

DROP TABLE IF EXISTS public.panggilan_layar;

-- 4. v_layar_antrian kembali ke versi 202610090004. Kolom view tidak bisa dibuang lewat
--    CREATE OR REPLACE, jadi view dibuat ulang (sebelum kolom layanan dibuang).
DROP VIEW IF EXISTS public.v_layar_antrian;
CREATE VIEW public.v_layar_antrian AS
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

-- 5. Kolom layanan (CHECK ikut terbuang bersama kolomnya)
ALTER TABLE public.layanan DROP COLUMN IF EXISTS nama_layar;
ALTER TABLE public.layanan DROP COLUMN IF EXISTS urutan_layar;
