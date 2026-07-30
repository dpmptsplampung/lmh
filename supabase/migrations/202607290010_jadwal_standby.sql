-- 202607290010_jadwal_standby.sql
-- WP-16 / SCH-01 / SCH-04 / SCH-11: struktur jadwal standby + fungsi jadwal berikutnya.
--
-- Jam layanan resmi kantor: 08:00–15:30 (keputusan pemilik, OQ-04 — mengoreksi data
-- live 08:00–16:00). ADITIF. layanan_jadwal & layanan_libur dipertahankan selama transisi.

-- 1. Pola berulang mingguan per layanan (hari + jam mulai + jam selesai).
CREATE TABLE IF NOT EXISTS public.jadwal_standby (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  hari        smallint NOT NULL CHECK (hari BETWEEN 1 AND 7),  -- 1=Senin..7=Minggu
  jam_mulai   time NOT NULL DEFAULT '08:00',
  jam_selesai time NOT NULL DEFAULT '15:30',
  aktif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, hari)
);

-- 2. Penyimpangan per tanggal (libur / ganti jam) + alasan.
CREATE TABLE IF NOT EXISTS public.jadwal_pengecualian (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal     date NOT NULL,
  jenis       text NOT NULL CHECK (jenis IN ('libur','ganti_hari','jam_beda')),
  jam_mulai   time,
  jam_selesai time,
  alasan      text NOT NULL,
  dibuat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);

-- 3. Apakah layanan buka pada tanggal+jam tertentu (Asia/Jakarta untuk tanggal).
CREATE OR REPLACE FUNCTION public.is_layanan_buka_jadwal(
  p_layanan_id uuid,
  p_tanggal date,
  p_jam time DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dow smallint := EXTRACT(ISODOW FROM p_tanggal)::smallint;
  v_exc public.jadwal_pengecualian%ROWTYPE;
  v_std public.jadwal_standby%ROWTYPE;
BEGIN
  -- Pengecualian menang atas pola.
  SELECT * INTO v_exc FROM public.jadwal_pengecualian
   WHERE layanan_id = p_layanan_id AND tanggal = p_tanggal;
  IF FOUND THEN
    IF v_exc.jenis = 'libur' THEN
      RETURN false;
    END IF;
    -- ganti_hari / jam_beda: buka bila ada jam; cek jam bila diberikan.
    IF p_jam IS NULL THEN
      RETURN v_exc.jam_mulai IS NOT NULL;
    END IF;
    RETURN p_jam >= COALESCE(v_exc.jam_mulai, time '08:00')
       AND p_jam <= COALESCE(v_exc.jam_selesai, time '15:30');
  END IF;

  -- Pola mingguan.
  SELECT * INTO v_std FROM public.jadwal_standby
   WHERE layanan_id = p_layanan_id AND hari = v_dow AND aktif = true;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_jam IS NULL THEN
    RETURN true;
  END IF;
  RETURN p_jam >= v_std.jam_mulai AND p_jam <= v_std.jam_selesai;
END $$;

-- 4. Jadwal standby berikutnya (tanggal terdekat yang buka), untuk pesan penolakan P3.
CREATE OR REPLACE FUNCTION public.jadwal_berikutnya(
  p_layanan_id uuid,
  p_dari_tanggal date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date)
)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v date := p_dari_tanggal;
  v_limit date := p_dari_tanggal + 60; -- batas pencarian 60 hari
BEGIN
  WHILE v <= v_limit LOOP
    IF public.is_layanan_buka_jadwal(p_layanan_id, v, NULL) THEN
      RETURN v;
    END IF;
    v := v + 1;
  END LOOP;
  RETURN NULL;
END $$;

-- 5. RLS: publik membaca jadwal (untuk tampilan & validasi), FO & Admin mengelola (SCH-07).
ALTER TABLE public.jadwal_standby ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_pengecualian ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jadwal_standby_public_read ON public.jadwal_standby;
CREATE POLICY jadwal_standby_public_read ON public.jadwal_standby FOR SELECT USING (true);
DROP POLICY IF EXISTS jadwal_standby_staff_write ON public.jadwal_standby;
CREATE POLICY jadwal_standby_staff_write ON public.jadwal_standby FOR ALL
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

DROP POLICY IF EXISTS jadwal_pengecualian_public_read ON public.jadwal_pengecualian;
CREATE POLICY jadwal_pengecualian_public_read ON public.jadwal_pengecualian FOR SELECT USING (true);
DROP POLICY IF EXISTS jadwal_pengecualian_staff_write ON public.jadwal_pengecualian;
CREATE POLICY jadwal_pengecualian_staff_write ON public.jadwal_pengecualian FOR ALL
  USING (public.get_my_role() IN ('admin','front_office'))
  WITH CHECK (public.get_my_role() IN ('admin','front_office'));

-- 6. Backfill dari layanan_jadwal (1 baris/layanan, hari_kerja[]) -> jadwal_standby
--    (1 baris per hari). Jam dari data yang ada; yang 16:00 dikoreksi ke 15:30 (OQ-04).
INSERT INTO public.jadwal_standby (layanan_id, hari, jam_mulai, jam_selesai)
SELECT lj.layanan_id, h.hari, lj.jam_buka,
       CASE WHEN lj.jam_tutup > time '15:30' THEN time '15:30' ELSE lj.jam_tutup END
FROM public.layanan_jadwal lj
CROSS JOIN LATERAL unnest(lj.hari_kerja) AS h(hari)
ON CONFLICT (layanan_id, hari) DO NOTHING;

-- Layanan yang belum punya baris jadwal_standby sama sekali -> default Senin–Jumat 08:00–15:30.
INSERT INTO public.jadwal_standby (layanan_id, hari, jam_mulai, jam_selesai)
SELECT l.id, h.hari, time '08:00', time '15:30'
FROM public.layanan l
CROSS JOIN generate_series(1,5) AS h(hari)
WHERE l.aktif = true
  AND NOT EXISTS (SELECT 1 FROM public.jadwal_standby js WHERE js.layanan_id = l.id)
ON CONFLICT (layanan_id, hari) DO NOTHING;

-- Backfill layanan_libur -> jadwal_pengecualian (jenis 'libur').
INSERT INTO public.jadwal_pengecualian (layanan_id, tanggal, jenis, alasan)
SELECT ll.layanan_id, ll.tanggal, 'libur', COALESCE(ll.keterangan, 'Libur')
FROM public.layanan_libur ll
ON CONFLICT (layanan_id, tanggal) DO NOTHING;

-- 7. Perkuat trigger guard: pakai fungsi baru + tanggal Asia/Jakarta (RPT-07).
CREATE OR REPLACE FUNCTION public.guard_visit_layanan_buka()
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
    v_tanggal := COALESCE((NEW.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date,
                          (now() AT TIME ZONE 'Asia/Jakarta')::date);
  END IF;

  IF v_tanggal IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_layanan_buka_jadwal(NEW.layanan_id, v_tanggal, NULL) THEN
    RAISE EXCEPTION 'Layanan tidak beroperasi pada tanggal tersebut (libur/di luar jadwal standby). Live chat tetap tersedia.';
  END IF;

  RETURN NEW;
END
$$;
