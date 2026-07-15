-- Production baseline 5/5: public projections, queue estimates, and cron jobs.
BEGIN;

CREATE VIEW public.v_umkm_public
WITH (security_invoker = true)
AS
SELECT
  listing.id,
  listing.nama_umkm,
  listing.kategori_kebutuhan,
  listing.sisi,
  listing.deskripsi,
  listing.foto_produk,
  listing.status,
  listing.created_at,
  listing.updated_at
FROM public.get_public_umkm() AS listing;

REVOKE ALL ON public.v_umkm_public FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_umkm_public TO anon, authenticated;

CREATE VIEW public.v_umkm_match
WITH (security_invoker = true)
AS
SELECT
  need.id AS kebutuhan_id,
  need.nama_umkm AS kebutuhan_nama,
  need.kategori_kebutuhan AS kategori,
  need.deskripsi AS kebutuhan_deskripsi,
  offer.id AS penawaran_id,
  offer.nama_umkm AS penawaran_nama,
  offer.deskripsi AS penawaran_deskripsi
FROM public.v_umkm_public AS need
JOIN public.v_umkm_public AS offer
  ON offer.kategori_kebutuhan = need.kategori_kebutuhan
  AND offer.sisi = 'penawaran'
WHERE need.sisi = 'kebutuhan';

REVOKE ALL ON public.v_umkm_match FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_umkm_match TO anon, authenticated;

CREATE MATERIALIZED VIEW public.mv_estimasi_layanan AS
SELECT
  visit.layanan_id,
  EXTRACT(HOUR FROM visit.waktu_mulai_layan)::integer AS jam_slot,
  avg(EXTRACT(EPOCH FROM (visit.waktu_selesai - visit.waktu_mulai_layan)) / 60)::integer AS avg_durasi_menit,
  count(*)::integer AS sample_count
FROM public.visit AS visit
WHERE visit.status = 'selesai'
  AND visit.waktu_mulai_layan IS NOT NULL
  AND visit.waktu_selesai IS NOT NULL
  AND visit.waktu_mulai_layan > now() - INTERVAL '14 days'
GROUP BY visit.layanan_id, jam_slot;

CREATE UNIQUE INDEX idx_mv_estimasi_layanan_key
  ON public.mv_estimasi_layanan(layanan_id, jam_slot);

CREATE VIEW public.v_antrian_loket AS
SELECT
  service.id AS layanan_id,
  service.nama AS layanan_nama,
  service.tipe,
  count(visit.id) FILTER (WHERE visit.status = 'menunggu') AS antre_count,
  count(visit.id) FILTER (WHERE visit.status = 'dilayani') AS dilayani_count,
  COALESCE((
    SELECT estimate.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS estimate
    WHERE estimate.layanan_id = service.id
      AND estimate.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_durasi_menit,
  count(visit.id) FILTER (WHERE visit.status = 'menunggu') * COALESCE((
    SELECT estimate.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS estimate
    WHERE estimate.layanan_id = service.id
      AND estimate.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_tunggu_total_menit,
  COALESCE((
    SELECT estimate.sample_count
    FROM public.mv_estimasi_layanan AS estimate
    WHERE estimate.layanan_id = service.id
      AND estimate.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 0) AS sample_count
FROM public.layanan AS service
LEFT JOIN public.visit AS visit ON visit.layanan_id = service.id
  AND visit.status IN ('menunggu', 'dilayani')
WHERE service.tipe = 'konsultatif' AND service.aktif = true
GROUP BY service.id, service.nama, service.tipe;

REVOKE ALL ON public.v_antrian_loket FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_antrian_loket TO anon, authenticated;

CREATE FUNCTION public.refresh_estimasi_layanan()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_estimasi_layanan
$$;
REVOKE EXECUTE ON FUNCTION public.refresh_estimasi_layanan() FROM PUBLIC, anon, authenticated;

COMMIT;

-- pg_cron scheduling is kept outside the DDL transaction. Reapplying this
-- section replaces jobs by name rather than creating duplicates.
DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid)
  FROM cron.job AS job
  WHERE job.jobname = 'anonymize_inactive_pengunjung';
  PERFORM cron.schedule(
    'anonymize_inactive_pengunjung',
    '0 2 * * *',
    'SELECT public.anonymize_inactive_pengunjung()'
  );

  PERFORM cron.unschedule(job.jobid)
  FROM cron.job AS job
  WHERE job.jobname = 'refresh_estimasi';
  PERFORM cron.schedule(
    'refresh_estimasi',
    '*/5 * * * *',
    'SELECT public.refresh_estimasi_layanan()'
  );

  PERFORM cron.unschedule(job.jobid)
  FROM cron.job AS job
  WHERE job.jobname = 'prune_anon_rate_limit';
  PERFORM cron.schedule(
    'prune_anon_rate_limit',
    '0 3 * * *',
    'SELECT public.prune_anon_rate_limit()'
  );
END
$$;
