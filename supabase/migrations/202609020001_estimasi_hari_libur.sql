-- 202609020001_estimasi_hari_libur.sql
-- Libur nasional / hari libur kantor (berlaku untuk SEMUA layanan, tidak
-- per-layanan seperti layanan_libur/jadwal_pengecualian).
--
-- EstimasiAntrean membaca tabel ini untuk menampilkan banner "hari ini libur"
-- dan per-layanan status tutup via is_layanan_buka_jadwal(). Pengunjung tidak
-- boleh menulis; hanya admin / petugas PTSP (is_ptsp_staff) yang mengelola.

BEGIN;

-- (a) Tabel libur nasional.
CREATE TABLE IF NOT EXISTS public.hari_libur (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggal     date NOT NULL UNIQUE,
  keterangan  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hari_libur_tanggal ON public.hari_libur(tanggal);

-- (b) RLS: baca publik; tulis admin + petugas PTSP (pola sama seperti
--     layanan_libur di 202607280001 dan jadwal_pengecualian di 202607290010).
ALTER TABLE public.hari_libur ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hari_libur_public_read" ON public.hari_libur
  FOR SELECT USING (true);

CREATE POLICY "hari_libur_staff_write" ON public.hari_libur
  FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin' OR public.is_ptsp_staff())
  WITH CHECK (public.get_my_role() = 'admin' OR public.is_ptsp_staff());

COMMIT;
