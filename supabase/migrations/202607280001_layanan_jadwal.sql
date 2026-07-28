-- Layanan schedule: jadwal otomatis per layanan (dikelola petugas PTSP/admin),
-- antrian ditutup saat libur, live chat tetap buka.
BEGIN;

-- (a) flag PTSP pada layanan DPMPTSP
ALTER TABLE public.layanan ADD COLUMN IF NOT EXISTS is_ptsp boolean NOT NULL DEFAULT false;
UPDATE public.layanan SET is_ptsp = true
  WHERE nama = 'Layanan Perizinan DPMPTSP Provinsi Lampung';

-- (b) jadwal mingguan per layanan (1=Senin .. 7=Minggu)
CREATE TABLE public.layanan_jadwal (
  layanan_id uuid PRIMARY KEY REFERENCES public.layanan(id) ON DELETE CASCADE,
  hari_kerja smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'
    CHECK (hari_kerja <@ '{1,2,3,4,5,6,7}'::smallint[]),
  jam_buka time NOT NULL DEFAULT '08:00',
  jam_tutup time NOT NULL DEFAULT '16:00',
  updated_by uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- default jadwal untuk semua layanan yang sudah ada
INSERT INTO public.layanan_jadwal (layanan_id)
SELECT id FROM public.layanan
ON CONFLICT (layanan_id) DO NOTHING;

-- (c) override tanggal libur spesifik
CREATE TABLE public.layanan_libur (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal date NOT NULL,
  keterangan text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);
CREATE INDEX idx_layanan_libur_tanggal ON public.layanan_libur(tanggal);

-- (d) helper: apakah layanan buka pada tanggal (+jam opsional) tertentu
CREATE FUNCTION public.is_layanan_buka(
  p_layanan_id uuid,
  p_tanggal date,
  p_jam time DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_layanan_id IS NULL OR p_tanggal IS NULL THEN true
    WHEN EXISTS (
      SELECT 1 FROM public.layanan_libur AS libur
      WHERE libur.layanan_id = p_layanan_id AND libur.tanggal = p_tanggal
    ) THEN false
    ELSE COALESCE((
      SELECT
        EXTRACT(ISODOW FROM p_tanggal)::smallint = ANY (jadwal.hari_kerja)
        AND (
          p_jam IS NULL
          OR (p_jam >= jadwal.jam_buka AND p_jam <= jadwal.jam_tutup)
        )
      FROM public.layanan_jadwal AS jadwal
      WHERE jadwal.layanan_id = p_layanan_id
    ), true)
  END
$$;
REVOKE EXECUTE ON FUNCTION public.is_layanan_buka(uuid, date, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_layanan_buka(uuid, date, time) TO anon, authenticated;

-- (e) helper: apakah caller petugas PTSP (atau admin)
CREATE FUNCTION public.is_ptsp_staff()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.petugas AS staff
    JOIN public.layanan AS lyn ON lyn.id = staff.layanan_id
    WHERE staff.auth_user_id = auth.uid() AND lyn.is_ptsp
  )
$$;
REVOKE EXECUTE ON FUNCTION public.is_ptsp_staff() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_ptsp_staff() TO authenticated;

-- (f) RLS jadwal & libur: baca publik; tulis admin + petugas PTSP
ALTER TABLE public.layanan_jadwal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.layanan_libur ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jadwal_public_read" ON public.layanan_jadwal FOR SELECT USING (true);
CREATE POLICY "jadwal_ptsp_write" ON public.layanan_jadwal FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin' OR public.is_ptsp_staff())
  WITH CHECK (public.get_my_role() = 'admin' OR public.is_ptsp_staff());

CREATE POLICY "libur_public_read" ON public.layanan_libur FOR SELECT USING (true);
CREATE POLICY "libur_ptsp_write" ON public.layanan_libur FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin' OR public.is_ptsp_staff())
  WITH CHECK (public.get_my_role() = 'admin' OR public.is_ptsp_staff());

-- (g) guard: antrian (walk-in hari ini / reservasi tanggal rencana) hanya saat layanan buka
CREATE FUNCTION public.guard_visit_layanan_buka()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tanggal date;
BEGIN
  IF NEW.layanan_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.asal = 'reservasi' THEN
    v_tanggal := NEW.tanggal_rencana;
  ELSE
    v_tanggal := COALESCE(NEW.waktu_masuk::date, pg_catalog.now()::date);
  END IF;

  IF v_tanggal IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_layanan_buka(NEW.layanan_id, v_tanggal) THEN
    RAISE EXCEPTION 'Layanan tidak beroperasi pada tanggal tersebut (libur/di luar jadwal). Live chat tetap tersedia.';
  END IF;

  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.guard_visit_layanan_buka() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_visit_layanan_buka BEFORE INSERT ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.guard_visit_layanan_buka();

COMMIT;
