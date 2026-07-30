-- WP-26 / CMS-01..05: CMS registry, versioned history, locked keys.
-- site_settings already exists (key, value, updated_at). ADITIF.

ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS keterangan            text,
  ADD COLUMN IF NOT EXISTS boleh_diubah_dashboard boolean NOT NULL DEFAULT true;

-- CMS-04: mark system keys that the dashboard must not allow editing.
UPDATE public.site_settings
SET boleh_diubah_dashboard = false
WHERE key IN ('app_name', 'app_version', 'maintenance_mode', 'schema_version');

-- CMS-02/03: content version history table.
CREATE TABLE IF NOT EXISTS public.konten_versi (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  jenis         text        NOT NULL,
  referensi_id  text        NOT NULL,
  nilai_lama    text,
  nilai_baru    text,
  diubah_oleh   uuid        REFERENCES public.petugas(id) ON DELETE SET NULL,
  catatan       text,
  dibuat_pada   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_konten_versi_ref
  ON public.konten_versi(jenis, referensi_id, dibuat_pada DESC);

ALTER TABLE public.konten_versi ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT ON TABLE public.konten_versi TO authenticated;

DROP POLICY IF EXISTS konten_versi_admin_all ON public.konten_versi;
CREATE POLICY konten_versi_admin_all
  ON public.konten_versi
  FOR ALL TO authenticated
  USING  (public.get_my_role() = 'admin')
  WITH CHECK (public.get_my_role() = 'admin');
