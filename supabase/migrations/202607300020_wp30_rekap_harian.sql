-- WP-30 / RPT-01..06, RPT-08, RBA-10: Daily recap tables + nightly rollup.
-- Reads from tiket_antrean (WP-22). ADITIF.

CREATE TABLE IF NOT EXISTS public.rekap_harian_layanan (
  layanan_id              uuid        NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal                 date        NOT NULL,
  total_hadir             int         NOT NULL DEFAULT 0,
  total_selesai           int         NOT NULL DEFAULT 0,
  total_tidak_terlayani   int         NOT NULL DEFAULT 0,
  total_batal             int         NOT NULL DEFAULT 0,
  rata_durasi_menit       numeric,
  petugas_hadir           boolean     NOT NULL DEFAULT false,
  petugas_alpa            boolean     NOT NULL DEFAULT false,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (layanan_id, tanggal)
);

CREATE TABLE IF NOT EXISTS public.laporan_snapshot (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  nama            text        NOT NULL,
  jenis           text        NOT NULL DEFAULT 'harian',
  periode_mulai   date        NOT NULL,
  periode_selesai date        NOT NULL,
  dibuat_oleh     uuid        REFERENCES public.petugas(id) ON DELETE SET NULL,
  payload         jsonb       NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rekap_harian_layanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.laporan_snapshot     ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.rekap_harian_layanan TO authenticated;
GRANT SELECT ON TABLE public.laporan_snapshot     TO authenticated;

DROP POLICY IF EXISTS rekap_harian_staff_read ON public.rekap_harian_layanan;
CREATE POLICY rekap_harian_staff_read
  ON public.rekap_harian_layanan FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office', 'petugas'));

DROP POLICY IF EXISTS laporan_snapshot_admin_read ON public.laporan_snapshot;
CREATE POLICY laporan_snapshot_admin_read
  ON public.laporan_snapshot FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office'));

DROP POLICY IF EXISTS laporan_snapshot_admin_insert ON public.laporan_snapshot;
CREATE POLICY laporan_snapshot_admin_insert
  ON public.laporan_snapshot FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

-- Rollup function: aggregate today's (or any date's) tiket_antrean into rekap.
CREATE OR REPLACE FUNCTION public.rollup_rekap_harian(p_tanggal date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.rekap_harian_layanan (
    layanan_id, tanggal,
    total_hadir, total_selesai, total_tidak_terlayani, total_batal,
    rata_durasi_menit, petugas_hadir, petugas_alpa, updated_at
  )
  SELECT
    t.layanan_id,
    p_tanggal,
    count(*)                        FILTER (WHERE t.status <> 'terjadwal')         AS total_hadir,
    count(*)                        FILTER (WHERE t.status = 'selesai')             AS total_selesai,
    count(*)                        FILTER (WHERE t.status = 'tidak_terlayani')     AS total_tidak_terlayani,
    count(*)                        FILTER (WHERE t.status = 'batal')               AS total_batal,
    AVG(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60.0)
                                    FILTER (WHERE t.waktu_selesai IS NOT NULL
                                               AND t.waktu_mulai_layan IS NOT NULL) AS rata_durasi_menit,
    EXISTS(
      SELECT 1 FROM public.absensi_petugas ap
      JOIN public.petugas p ON p.id = ap.petugas_id
      WHERE ap.tanggal = p_tanggal
        AND p.layanan_id = t.layanan_id
        AND ap.status = 'approved'
    ) AS petugas_hadir,
    EXISTS(
      SELECT 1 FROM public.absensi_petugas ap
      JOIN public.petugas p ON p.id = ap.petugas_id
      WHERE ap.tanggal = p_tanggal
        AND p.layanan_id = t.layanan_id
        AND ap.status = 'alpa'
    ) AS petugas_alpa,
    now()
  FROM public.tiket_antrean t
  WHERE t.tanggal = p_tanggal
  GROUP BY t.layanan_id
  ON CONFLICT (layanan_id, tanggal) DO UPDATE SET
    total_hadir           = EXCLUDED.total_hadir,
    total_selesai         = EXCLUDED.total_selesai,
    total_tidak_terlayani = EXCLUDED.total_tidak_terlayani,
    total_batal           = EXCLUDED.total_batal,
    rata_durasi_menit     = EXCLUDED.rata_durasi_menit,
    petugas_hadir         = EXCLUDED.petugas_hadir,
    petugas_alpa          = EXCLUDED.petugas_alpa,
    updated_at            = EXCLUDED.updated_at;
END $$;

REVOKE ALL ON FUNCTION public.rollup_rekap_harian(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_rekap_harian(date) TO service_role;

-- Nightly cron: rollup yesterday's data at 00:05 WIB (17:05 UTC).
SELECT cron.schedule(
  'rollup_rekap_harian_nightly',
  '5 17 * * *',
  $$SELECT public.rollup_rekap_harian((now() AT TIME ZONE 'Asia/Jakarta')::date - 1)$$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rollup_rekap_harian_nightly');
