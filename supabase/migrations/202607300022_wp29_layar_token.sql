-- WP-29 / DSP-01..07: Token-based TV queue display screen.
-- layar_token: admin-managed tokens for URL-based access (DSP-07).
-- v_layar_antrian: queue view WITHOUT PII columns (DSP-06 / I-14).
-- ADITIF.

CREATE TABLE IF NOT EXISTS public.layar_token (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text    UNIQUE NOT NULL DEFAULT replace(gen_random_uuid()::text, '-', ''),
  nama        text    NOT NULL,          -- admin label, e.g. "Layar Lobby Utama"
  dibuat_oleh uuid    REFERENCES public.petugas(id) ON DELETE SET NULL,
  aktif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.layar_token ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.layar_token TO authenticated;

DROP POLICY IF EXISTS layar_token_admin_all ON public.layar_token;
CREATE POLICY layar_token_admin_all
  ON public.layar_token
  FOR ALL TO authenticated
  USING  (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- v_layar_antrian: queue status per service, today only.
-- NEVER exposes nama, kontak_hp, pengunjung_id (I-14/DSP-06).
-- Reads from tiket_antrean (WP-22).
CREATE OR REPLACE VIEW public.v_layar_antrian AS
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
WHERE l.aktif = true
GROUP BY l.id, l.nama, l.tipe;

-- Anon can read the layar view (token validation happens in the route).
REVOKE ALL  ON public.v_layar_antrian FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layar_antrian TO anon, authenticated;

-- validate_layar_token: check a display token is active.
-- Called from the Next.js route handler before serving the display page.
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