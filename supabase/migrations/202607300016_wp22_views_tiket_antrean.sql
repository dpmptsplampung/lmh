-- WP-22: Update v_antrian_loket and get_queue_position to read from
-- tiket_antrean + kunjungan instead of visit.
-- visit remains writable; trg_visit_dual_write keeps tiket_antrean in sync.
-- ADITIF: no visit table, column, or row is changed.

-- ----------------------------------------------------------------
-- 1. v_antrian_loket — count active tickets per layanan today
-- ----------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_antrian_loket AS
SELECT
  service.id    AS layanan_id,
  service.nama  AS layanan_nama,
  service.tipe,
  count(t.id) FILTER (WHERE t.status = 'menunggu')  AS antre_count,
  count(t.id) FILTER (WHERE t.status = 'dilayani')  AS dilayani_count,
  COALESCE((
    SELECT e.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_durasi_menit,
  count(t.id) FILTER (WHERE t.status = 'menunggu') * COALESCE((
    SELECT e.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_tunggu_total_menit,
  COALESCE((
    SELECT e.sample_count
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 0) AS sample_count
FROM public.layanan AS service
LEFT JOIN public.tiket_antrean AS t
  ON  t.layanan_id = service.id
  AND t.status IN ('menunggu', 'dilayani')
  AND t.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE service.tipe = 'konsultatif'
  AND service.aktif = true
GROUP BY service.id, service.nama, service.tipe;

REVOKE ALL  ON public.v_antrian_loket FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_antrian_loket TO anon, authenticated;

-- ----------------------------------------------------------------
-- 2. get_queue_position — look up ticket position via kunjungan.qr_token
-- ----------------------------------------------------------------
-- QUE-04: tickets are only issued after physical scan (terjadwal has no ticket).
-- If the visitor's reservation is still terjadwal the function returns no row.
CREATE OR REPLACE FUNCTION public.get_queue_position(p_qr_token uuid)
RETURNS TABLE (posisi int, total_menunggu int)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_layanan_id  uuid;
  v_tanggal     date;
  v_nomor       int;
  v_status      text;
BEGIN
  -- Find the issued ticket for this visitor via kunjungan.qr_token.
  -- A single kunjungan maps to at most one tiket (UNIQUE legacy_visit_id).
  SELECT t.layanan_id, t.tanggal, t.nomor, t.status
    INTO v_layanan_id, v_tanggal, v_nomor, v_status
  FROM public.kunjungan AS k
  JOIN public.tiket_antrean AS t ON t.kunjungan_id = k.id
  WHERE k.qr_token = p_qr_token::text
  LIMIT 1;

  -- Only return position when the visitor is actively waiting.
  IF NOT FOUND OR v_status <> 'menunggu' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (pg_catalog.count(*) FILTER (WHERE t2.nomor <= v_nomor))::integer AS posisi,
    pg_catalog.count(*)::integer AS total_menunggu
  FROM public.tiket_antrean AS t2
  WHERE t2.layanan_id = v_layanan_id
    AND t2.status      = 'menunggu'
    AND t2.tanggal     = v_tanggal;
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_queue_position(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_queue_position(uuid) TO anon, authenticated;