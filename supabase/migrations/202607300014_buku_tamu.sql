-- 202607300014_buku_tamu.sql
-- WP-21 / GST-01..04: private guest book with a traceable legacy-visit link.
--
-- ADITIF: visit remains unchanged and is still the transition source of truth.

BEGIN;

CREATE TABLE IF NOT EXISTS public.buku_tamu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_visit_id uuid UNIQUE REFERENCES public.visit(id) ON DELETE RESTRICT,
  nama text NOT NULL,
  asal text,
  no_hp text,
  menemui_siapa text NOT NULL,
  keperluan text,
  waktu_masuk timestamptz NOT NULL DEFAULT now(),
  tanda_tangan_svg text,
  dicatat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buku_tamu_waktu
  ON public.buku_tamu(waktu_masuk DESC);
CREATE INDEX IF NOT EXISTS idx_buku_tamu_legacy_visit_id
  ON public.buku_tamu(legacy_visit_id)
  WHERE legacy_visit_id IS NOT NULL;

ALTER TABLE public.buku_tamu ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.buku_tamu TO authenticated;

DROP POLICY IF EXISTS buku_tamu_fo_admin_all ON public.buku_tamu;
CREATE POLICY buku_tamu_fo_admin_all ON public.buku_tamu
  FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

COMMIT;
