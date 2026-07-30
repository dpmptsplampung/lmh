-- 202607290001_observability_error_log.sql
-- WP-02 / SEC-03 / OPS-06: error tracking self-contained (tanpa biaya berulang).
--
-- ADITIF: hanya menambah tabel + fungsi. Tidak mengubah/menghapus apa pun.
-- Rollback: tabel & fungsi baru bisa diabaikan (lihat docs/analysis/DB-CHANGES.md).

-- 1. Tabel error_log: menampung error server terstruktur (sudah disanitasi PII).
CREATE TABLE IF NOT EXISTS public.error_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  level       text NOT NULL DEFAULT 'error' CHECK (level IN ('error','warn')),
  route       text,
  method      text,
  operation   text NOT NULL,
  request_id  text,
  status_code int,
  message     text,                -- sudah disanitasi (tanpa PII)
  detail      jsonb,               -- field tambahan yang sudah disanitasi
  environment text NOT NULL DEFAULT 'production',
  version     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Index untuk query alert & dasbor (error terbaru per route).
CREATE INDEX IF NOT EXISTS idx_error_log_created ON public.error_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_log_route   ON public.error_log(route, created_at DESC);

-- 2. Fungsi insert SECURITY DEFINER agar route handler (service-role) bisa menulis
--    tanpa membuka akses tabel ke publik/anon.
CREATE OR REPLACE FUNCTION public.log_error_event(
  p_level       text,
  p_route       text,
  p_method      text,
  p_operation   text,
  p_request_id  text,
  p_status_code int,
  p_message     text,
  p_detail      jsonb,
  p_environment text,
  p_version     text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.error_log (
    level, route, method, operation, request_id, status_code,
    message, detail, environment, version
  ) VALUES (
    COALESCE(p_level, 'error'), p_route, p_method, COALESCE(p_operation, 'unknown'),
    p_request_id, p_status_code, p_message, COALESCE(p_detail, '{}'::jsonb),
    COALESCE(p_environment, 'production'), p_version
  );
END $$;

REVOKE ALL ON FUNCTION public.log_error_event(text,text,text,text,text,int,text,jsonb,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_error_event(text,text,text,text,text,int,text,jsonb,text,text)
  TO service_role;

-- 3. Fungsi alert: hitung error dalam N menit terakhir; bila melewati ambang,
--    enqueue 1 email peringatan ke tabel notifikasi (infra Resend yang sudah ada).
--    Idempoten per jendela (tidak mengirim berulang untuk lonjakan yang sama).
CREATE OR REPLACE FUNCTION public.check_error_alert(
  p_window_minutes int DEFAULT 5,
  p_threshold      int DEFAULT 10,
  p_recipient      text DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count int;
  v_recipient text := COALESCE(p_recipient, current_setting('app.error_alert_email', true));
  v_idem text;
  v_window_start timestamptz := now() - make_interval(mins => p_window_minutes);
  v_sample jsonb;
BEGIN
  -- Tanpa penerima, tidak ada yang bisa dilakukan (hindari error berulang).
  IF v_recipient IS NULL OR v_recipient = '' THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.error_log
  WHERE created_at >= v_window_start AND level = 'error';

  IF v_count < p_threshold THEN
    RETURN 0;
  END IF;

  -- Ambil contoh route yang paling sering error (untuk konteks email).
  SELECT jsonb_agg(t ORDER BY t.n DESC) INTO v_sample FROM (
    SELECT COALESCE(route,'(tanpa route)') AS route, count(*) AS n
    FROM public.error_log
    WHERE created_at >= v_window_start AND level = 'error'
    GROUP BY route ORDER BY n DESC LIMIT 5
  ) t;

  -- Idempotency per jendela 5 menit agar tidak spam saat lonjakan berlanjut.
  v_idem := 'error_alert:' || to_char(date_trunc('minute', now()), 'YYYY-MM-DD"T"HH24:MI');

  INSERT INTO public.notifikasi (
    kanal, tujuan_email, subjek, body, status, idempotency_key, payload
  )
  SELECT
    'email',
    v_recipient,
    format('[LMH] Lonjakan error: %s error dalam %s menit', v_count, p_window_minutes),
    format(
      E'Terdeteksi %s error server dalam %s menit terakhir.\n\nRoute paling sering error:\n%s\n\nWaktu: %s WIB.\nSegera periksa /api/health/error atau dashboard observability.',
      v_count, p_window_minutes, COALESCE(v_sample::text, '-'), to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI')
    ),
    'pending',
    v_idem,
    jsonb_build_object('count', v_count, 'window_minutes', p_window_minutes, 'routes', v_sample)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notifikasi WHERE idempotency_key = v_idem
  );

  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.check_error_alert(int,int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_error_alert(int,int,text) TO service_role;

-- 4. RLS: tabel tidak bisa diakses langsung oleh publik; Admin membaca, service_role menulis.
ALTER TABLE public.error_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS error_log_admin_read ON public.error_log;
CREATE POLICY error_log_admin_read ON public.error_log
  FOR SELECT USING (public.get_my_role() = 'admin');

-- Tidak ada policy INSERT/UPDATE/DELETE untuk peran aplikasi — hanya via fungsi SECURITY DEFINER.

-- 5. Cron: cek alert tiap 5 menit (pakai pg_cron yang sudah ada).
SELECT cron.schedule(
  'observability_error_alert',
  '*/5 * * * *',
  $$SELECT public.check_error_alert(5, 10)$$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'observability_error_alert');
