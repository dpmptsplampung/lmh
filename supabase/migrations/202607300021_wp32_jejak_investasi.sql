-- WP-32 / INV-01, INV-02, INV-03, RBA-11: Jejak minat investasi.
-- ADITIF.

CREATE TABLE IF NOT EXISTS public.jejak_minat_investasi (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pengunjung_id uuid       REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  jenis_konten  text        NOT NULL,   -- 'galeri' | 'dokumen' | 'peta_potensi' | 'sektor'
  konten_id     text,                   -- gallery id, sector name, etc.
  sumber_halaman text,                  -- URL path that triggered the log
  metadata      jsonb,
  dicatat_pada  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jejak_investasi_pengunjung
  ON public.jejak_minat_investasi(pengunjung_id, dicatat_pada DESC);
CREATE INDEX IF NOT EXISTS idx_jejak_investasi_jenis
  ON public.jejak_minat_investasi(jenis_konten, dicatat_pada DESC);

ALTER TABLE public.jejak_minat_investasi ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE public.jejak_minat_investasi TO authenticated;

-- Pengunjung can INSERT their own trail; admin/FO can read all.
DROP POLICY IF EXISTS jejak_investasi_pengunjung_insert ON public.jejak_minat_investasi;
CREATE POLICY jejak_investasi_pengunjung_insert
  ON public.jejak_minat_investasi
  FOR INSERT TO authenticated
  WITH CHECK (
    pengunjung_id IS NULL
    OR pengunjung_id = (
      SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS jejak_investasi_admin_read ON public.jejak_minat_investasi;
CREATE POLICY jejak_investasi_admin_read
  ON public.jejak_minat_investasi
  FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office'));
