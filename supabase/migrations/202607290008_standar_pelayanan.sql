-- 202607290008_standar_pelayanan.sql
-- WP-13 / CMP-09: Standar Pelayanan & Maklumat Pelayanan (UU 25/2009).
-- Isi sekaligus menjadi bahan pengetahuan bot (fase 4). ADITIF.

CREATE TABLE IF NOT EXISTS public.standar_pelayanan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  persyaratan text,
  prosedur    text,
  jangka_waktu text,
  biaya       text,
  produk_layanan text,
  penanganan_pengaduan text,
  maklumat    text,
  aktif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id)
);

ALTER TABLE public.standar_pelayanan ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS standar_public_read ON public.standar_pelayanan;
CREATE POLICY standar_public_read ON public.standar_pelayanan FOR SELECT USING (aktif = true);
DROP POLICY IF EXISTS standar_admin_write ON public.standar_pelayanan;
CREATE POLICY standar_admin_write ON public.standar_pelayanan FOR ALL
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
