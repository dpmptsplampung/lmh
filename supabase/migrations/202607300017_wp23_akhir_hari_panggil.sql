-- WP-23: End-of-day queue rules + ticket recall event.
-- Implements QUE-09 (auto tidak_terlayani) and QUE-17 (panggil_ulang event).
-- visit remains the write source; trg_visit_dual_write propagates status changes.
-- ADITIF: no column or row in visit/kunjungan/tiket_antrean is dropped.

-- ----------------------------------------------------------------
-- 1. tandai_tidak_terlayani_akhir_hari()
--    QUE-09: mark all lingering 'menunggu' tickets as 'tidak_terlayani'
--    at end of service day. Called by pg_cron at 15:35 WIB (= 08:35 UTC).
--    Updating visit triggers trg_visit_dual_write → tiket_antrean.status.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tandai_tidak_terlayani_akhir_hari()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  -- Update visit rows whose ticket is still menunggu at end of day.
  -- The dual-write trigger will propagate the status to tiket_antrean.
  UPDATE public.visit AS v
  SET    status     = 'tidak_terlayani',
         updated_at = now()
  FROM   public.tiket_antrean AS t
  WHERE  t.legacy_visit_id = v.id
    AND  t.status   = 'menunggu'
    AND  t.tanggal  = v_today
    AND  v.status   = 'menunggu';
END $$;

REVOKE ALL  ON FUNCTION public.tandai_tidak_terlayani_akhir_hari() FROM PUBLIC, anon, authenticated;

-- Schedule at 15:35 WIB = 08:35 UTC (after 15:30 close, grace 5 min).
SELECT cron.schedule(
  'antrean_tidak_terlayani_akhir_hari',
  '35 8 * * *',
  $$SELECT public.tandai_tidak_terlayani_akhir_hari()$$
);

-- ----------------------------------------------------------------
-- 2. panggil_tiket(p_tiket_id)
--    QUE-17: emit a realtime event with the ticket number so the
--    queue display screen (DSP-08) can announce the call.
--    Returns the nomor_display that was called, or NULL if not found.
-- ----------------------------------------------------------------
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
  SELECT t.nomor_display, t.layanan_id
    INTO v_nomor_display, v_layanan_id
  FROM public.tiket_antrean AS t
  WHERE t.id = p_tiket_id
    AND t.status = 'menunggu';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Emit a Postgres NOTIFY event; Supabase Realtime or a listening process
  -- can forward this to the display screen (DSP-08 hook).
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

REVOKE ALL  ON FUNCTION public.panggil_tiket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panggil_tiket(uuid) TO authenticated;