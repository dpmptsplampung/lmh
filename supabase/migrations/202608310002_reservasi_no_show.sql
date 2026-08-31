-- 202608310002_reservasi_no_show.sql
-- QUE-15: Reservasi tanpa check-in sampai akhir hari layanan → status 'no_show'
--         (QR code hangus). Mengimplementasikan kebutuhan terdokumentasi QUE-15
--         yang sebelumnya belum ada implementasinya.
-- ADITIF murni (OPS-01): tidak mengubah kolom/tabel/flow existing.
-- Status 'no_show' sudah valid di CHECK constraint visit sejak 202607290011.

-- ----------------------------------------------------------------
-- 1. tandai_reservasi_no_show()
--    Menandai semua reservasi ('terjadwal') yang tanggal_rencana-nya
--    sudah lewat menjadi 'no_show' → QR hangus, hilang dari daftar
--    "Akan Datang" pengunjung dan tidak bisa dipakai check-in.
--    Dijalankan pg_cron harian setelah pekerjaan akhir-hari WP-23.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tandai_reservasi_no_show()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_count integer := 0;
BEGIN
  UPDATE public.visit
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  asal = 'reservasi'
    AND  status = 'terjadwal'
    AND  tanggal_rencana < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

-- Hanya pg_cron (superuser) yang boleh mengeksekusi.
REVOKE ALL ON FUNCTION public.tandai_reservasi_no_show()
  FROM PUBLIC, anon, authenticated;

-- Jadwal harian 15:45 WIB = 08:45 UTC (setelah job WP-23 15:35 WIB).
SELECT cron.schedule(
  'reservasi_no_show_harian',
  '45 8 * * *',
  $$SELECT public.tandai_reservasi_no_show()$$
);

-- ----------------------------------------------------------------
-- 2. Guard trigger trg_visit_qr_hangus
--    Pertahanan di DB: meskipun cron belum jalan / petugas scan ulang
--    QR lama / API ditembak langsung, check-in reservasi kedaluwarsa
--    DITOLAK. Reservasi 'terjadwal' yang tanggal_rencana-nya sudah
--    lewat tidak boleh bertransisi ke 'menunggu'.
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cegah_checkin_reservasi_kedaluwarsa()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.asal = 'reservasi'
     AND OLD.status = 'terjadwal'
     AND NEW.status = 'menunggu'
     AND NEW.tanggal_rencana < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN
    RAISE EXCEPTION
      'QR hangus: reservasi % kedaluwarsa (rencana %). Check-in ditolak (QUE-15).',
      NEW.id, NEW.tanggal_rencana;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_visit_qr_hangus
  BEFORE UPDATE OF status ON public.visit
  FOR EACH ROW
  EXECUTE FUNCTION public.cegah_checkin_reservasi_kedaluwarsa();

REVOKE ALL ON FUNCTION public.cegah_checkin_reservasi_kedaluwarsa()
  FROM PUBLIC, anon, authenticated;
