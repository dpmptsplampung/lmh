-- 202607290005_jadwal_harian_beku.sql
-- WP-07 / SCH-05 / I-08: pembekuan jadwal harian.
--
-- Nilai tinggi, biaya rendah, dan datanya TIDAK BISA dibuat surut. Tanpa pembekuan,
-- laporan kepatuhan bisa dianulir dengan mengedit satu baris jadwal secara surut.
-- ADITIF.

-- 1. Tabel snapshot jadwal per layanan per tanggal (TIDAK BOLEH diubah surut).
CREATE TABLE IF NOT EXISTS public.jadwal_harian_beku (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal       date NOT NULL,
  seharusnya_standby boolean NOT NULL,
  jam_mulai     time,
  jam_selesai   time,
  dibekukan_pada timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);

CREATE INDEX IF NOT EXISTS idx_jhb_tanggal ON public.jadwal_harian_beku(tanggal DESC);

-- 2. Fungsi pembeku: isi snapshot untuk suatu tanggal (default: besok, WIB).
--    Sumber sementara: layanan_jadwal (pola mingguan) + layanan_libur (pengecualian).
--    Setelah WP-16 (jadwal_standby), fungsi ini bisa diganti sumbernya — tabel beku
--    tetap tidak berubah.
CREATE OR REPLACE FUNCTION public.bekukan_jadwal(p_tanggal date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date + 1))
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count int := 0;
  v_dow smallint;
BEGIN
  -- ISODOW: 1=Senin .. 7=Minggu (konsisten dengan layanan_jadwal.hari_kerja).
  v_dow := EXTRACT(ISODOW FROM p_tanggal)::smallint;

  INSERT INTO public.jadwal_harian_beku (layanan_id, tanggal, seharusnya_standby, jam_mulai, jam_selesai)
  SELECT
    l.id,
    p_tanggal,
    -- standby bila hari termasuk hari_kerja DAN tanggal tidak ada di layanan_libur
    (lj.hari_kerja @> ARRAY[v_dow]) AND NOT EXISTS (
      SELECT 1 FROM public.layanan_libur ll
      WHERE ll.layanan_id = l.id AND ll.tanggal = p_tanggal
    ),
    lj.jam_buka,
    lj.jam_tutup
  FROM public.layanan l
  LEFT JOIN public.layanan_jadwal lj ON lj.layanan_id = l.id
  WHERE l.aktif = true
  ON CONFLICT (layanan_id, tanggal) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.bekukan_jadwal(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bekukan_jadwal(date) TO service_role;

-- 3. I-08: tabel beku TIDAK BOLEH diubah/dihapus lewat jalur biasa.
--    RLS saja TIDAK cukup karena service_role melewati RLS. Karena itu tambahkan
--    TRIGGER yang menolak UPDATE/DELETE di tingkat DB — berlaku untuk SEMUA peran,
--    termasuk service_role. (Pengecualian Admin dengan alasan lewat fungsi khusus
--    yang memanggil SET LOCAL, di luar cakupan WP ini.)
CREATE OR REPLACE FUNCTION public.jhb_tolak_ubah()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Izinkan hanya bila secara eksplisit dibuka untuk maintenance (misal hapus baris
  -- uji) lewat SET LOCAL app.jhb_allow='on' dalam transaksi yang sama.
  IF current_setting('app.jhb_allow', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'jadwal_harian_beku tidak boleh diubah/dihapus (SCH-05/I-08)';
END $$;

DROP TRIGGER IF EXISTS trg_jhb_no_update ON public.jadwal_harian_beku;
CREATE TRIGGER trg_jhb_no_update
  BEFORE UPDATE OR DELETE ON public.jadwal_harian_beku
  FOR EACH ROW EXECUTE FUNCTION public.jhb_tolak_ubah();

ALTER TABLE public.jadwal_harian_beku ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS jhb_staff_read ON public.jadwal_harian_beku;
CREATE POLICY jhb_staff_read ON public.jadwal_harian_beku
  FOR SELECT USING (public.get_my_role() IN ('petugas','admin','front_office'));

DROP POLICY IF EXISTS jhb_deny_write ON public.jadwal_harian_beku;
CREATE POLICY jhb_deny_write ON public.jadwal_harian_beku
  FOR ALL USING (false) WITH CHECK (false);

-- 4. Cron: bekukan jadwal esok setiap malam (23:00 UTC = 06:00 WIB keesokan harinya
--    terlambat; pakai 16:00 UTC = 23:00 WIB agar sebelum tengah malam WIB).
SELECT cron.schedule(
  'bekukan_jadwal_harian',
  '0 16 * * *',
  $$SELECT public.bekukan_jadwal()$$
)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'bekukan_jadwal_harian');
