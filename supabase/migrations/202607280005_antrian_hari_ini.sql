-- Antrean aktif = hari ini saja (WIB, Asia/Jakarta).
-- Sebelumnya v_antrian_loket menghitung visit menunggu/dilayani TANPA batas tanggal,
-- sehingga kunjungan yang tidak ditutup petugas terus dihitung selamanya
-- (kasus nyata: 2 visit 16 & 20 Jul 2026 masih tampil sebagai "antre" di landing).
-- Antrean lintas hari secara definisi bukan antrean — petugas wajib menutup di akhir hari.

CREATE OR REPLACE VIEW public.v_antrian_loket AS
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
  AND (visit.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date
      = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE service.tipe = 'konsultatif' AND service.aktif = true
GROUP BY service.id, service.nama, service.tipe;

REVOKE ALL ON public.v_antrian_loket FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_antrian_loket TO anon, authenticated;
