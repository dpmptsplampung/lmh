-- WP-31 / MMK-01..08: UMKM three-tier verification, legal docs, expiry cron.
-- listing_umkm already exists; this migration ADDS columns only (ADITIF).
-- bucket 'umkm-legalitas' must be created manually in Supabase Dashboard (MMK-04).

-- A.5: extend listing_umkm with verification columns
ALTER TABLE public.listing_umkm
  ADD COLUMN IF NOT EXISTS nib                   text,
  ADD COLUMN IF NOT EXISTS npwp                  text,
  ADD COLUMN IF NOT EXISTS nama_badan_usaha       text,
  ADD COLUMN IF NOT EXISTS berkas_legalitas_path  text,  -- path in private bucket 'umkm-legalitas'
  ADD COLUMN IF NOT EXISTS kontak_terverifikasi   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS berlaku_sampai         date,
  ADD COLUMN IF NOT EXISTS catatan_review         text,
  ADD COLUMN IF NOT EXISTS snapshot_approved      jsonb; -- MMK-08: frozen copy at approval time

-- Extend status CHECK to include 'perlu_perbaikan' (MMK-03)
ALTER TABLE public.listing_umkm
  DROP CONSTRAINT IF EXISTS listing_umkm_status_check;
ALTER TABLE public.listing_umkm
  ADD CONSTRAINT listing_umkm_status_check
  CHECK (status IN ('draft','pending_review','published','nonaktif','expired','perlu_perbaikan'));

-- B.16: umkm_verifikasi_jejak — audit trail for each verification action (MMK-02/05)
CREATE TABLE IF NOT EXISTS public.umkm_verifikasi_jejak (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid        NOT NULL REFERENCES public.listing_umkm(id) ON DELETE CASCADE,
  jenis         text        NOT NULL,
    -- 'konten' | 'legalitas' | 'kontak'
  status_hasil  text        NOT NULL,
    -- 'lulus' | 'ditolak' | 'perlu_perbaikan'
  catatan       text,
  diproses_oleh uuid        REFERENCES public.petugas(id) ON DELETE SET NULL,
  dibuat_pada   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_umkm_jejak_listing
  ON public.umkm_verifikasi_jejak(listing_id, dibuat_pada DESC);

ALTER TABLE public.umkm_verifikasi_jejak ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.umkm_verifikasi_jejak TO authenticated;

DROP POLICY IF EXISTS umkm_jejak_admin_all ON public.umkm_verifikasi_jejak;
CREATE POLICY umkm_jejak_admin_all
  ON public.umkm_verifikasi_jejak
  FOR ALL TO authenticated
  USING  (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');

-- MMK-07: auto-expire published listings past berlaku_sampai
CREATE OR REPLACE FUNCTION public.tandai_listing_umkm_expired()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.listing_umkm
  SET    status     = 'expired',
         updated_at = now()
  WHERE  status       = 'published'
    AND  berlaku_sampai IS NOT NULL
    AND  berlaku_sampai < (now() AT TIME ZONE 'Asia/Jakarta')::date;
END $$;

REVOKE ALL ON FUNCTION public.tandai_listing_umkm_expired() FROM PUBLIC, anon, authenticated;

-- Daily expiry check at 01:05 WIB (= 18:05 UTC previous day)
SELECT cron.schedule(
  'listing_umkm_expired',
  '5 18 * * *',
  $$SELECT public.tandai_listing_umkm_expired()$$
);