-- 202611030002_absensi_hadir_fo.sql
-- Absensi petugas oleh Front Office dengan NAMA DIKETIK MANUAL (keputusan pemilik 2026-10-28): FO memilih Layanan, mengambil foto
-- (dikompres di browser, disimpan di Cloudflare R2), lalu mengetik nama petugas. Tidak semua petugas layanan punya akun (mis. mitra
-- instansi), sehingga kehadiran dicatat per (Layanan, tanggal, nama) di tabel baru; bila nama cocok persis dengan petugas aktif Layanan itu,
-- kehadirannya ikut dicatat ke absensi_petugas lewat catat_absensi (gerbang antrean tetap berlaku).
-- Aditif: tabel baru + RPC baru. Tidak mengubah catat_absensi/absensi_petugas.
-- ROLLBACK: docs/rollback-absensi-hadir-fo-202611030002.sql.

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.layanan_hari') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.layanan_hari belum ada (202607290011_absensi_gerbang)';
  END IF;
  IF pg_catalog.to_regprocedure('public.catat_absensi(uuid, text, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.catat_absensi(uuid, text, uuid, text) belum ada (202610090001_rbac_tahap1)';
  END IF;
  IF pg_catalog.to_regprocedure('public.staf_saya()') IS NULL OR pg_catalog.to_regprocedure('public.peran_saya()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: staf_saya()/peran_saya() belum ada (202610080001/202610090001)';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.absensi_hadir_fo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE RESTRICT,
  tanggal       date NOT NULL,
  nama_petugas  text NOT NULL CHECK (pg_catalog.char_length(pg_catalog.btrim(nama_petugas)) BETWEEN 2 AND 100),
  foto_path     text NOT NULL CHECK (foto_path ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9a-f-]{36}_[0-9]+\.(jpg|webp)$'),
  petugas_id    uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  dicatat_oleh  uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Satu nama dicatat sekali per Layanan per hari (huruf besar/kecil dan spasi ganda diabaikan).
CREATE UNIQUE INDEX IF NOT EXISTS absensi_hadir_fo_unik
  ON public.absensi_hadir_fo (layanan_id, tanggal, (pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(nama_petugas, '\s+', ' ', 'g')))));
CREATE INDEX IF NOT EXISTS absensi_hadir_fo_tanggal ON public.absensi_hadir_fo (tanggal DESC);

ALTER TABLE public.absensi_hadir_fo ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.absensi_hadir_fo FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.absensi_hadir_fo TO authenticated;
DROP POLICY IF EXISTS absensi_hadir_fo_select ON public.absensi_hadir_fo;
CREATE POLICY absensi_hadir_fo_select ON public.absensi_hadir_fo FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office'));

CREATE OR REPLACE FUNCTION public.fo_catat_hadir_layanan(p_layanan_id uuid, p_nama text, p_foto_path text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id    uuid;
  v_me_role  text;
  v_nama     text := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_nama, ''), '\s+', ' ', 'g'));
  v_foto     text := pg_catalog.btrim(COALESCE(p_foto_path, ''));
  v_tanggal  date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_cocok    uuid;
  v_id       uuid;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'hanya Admin/Front Office yang boleh mencatat hadir' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.char_length(v_nama) < 2 OR pg_catalog.char_length(v_nama) > 100 THEN
    RAISE EXCEPTION 'nama petugas harus 2-100 karakter' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_id AND l.diarsipkan_at IS NULL) THEN
    RAISE EXCEPTION 'layanan tidak ditemukan atau sudah diarsipkan' USING ERRCODE = 'P0002';
  END IF;
  -- Foto wajib: path <tanggal>/<layanan_id>_<angka>.<jpg|webp>.
  IF v_foto !~ ('^[0-9]{4}-[0-9]{2}-[0-9]{2}/' || p_layanan_id::text || '_[0-9]+\.(jpg|webp)$') THEN
    RAISE EXCEPTION 'foto absensi tidak valid' USING ERRCODE = '22023';
  END IF;

  -- Nama cocok persis dengan petugas aktif Layanan itu -> kehadirannya ikut tercatat (gerbang antrean).
  SELECT p.id INTO v_cocok
  FROM public.petugas AS p
  WHERE p.layanan_id = p_layanan_id AND p.aktif = true
    AND pg_catalog.lower(pg_catalog.btrim(pg_catalog.regexp_replace(p.nama, '\s+', ' ', 'g'))) = pg_catalog.lower(v_nama)
  ORDER BY p.id
  LIMIT 1;

  BEGIN
    INSERT INTO public.absensi_hadir_fo (layanan_id, tanggal, nama_petugas, foto_path, petugas_id, dicatat_oleh)
    VALUES (p_layanan_id, v_tanggal, v_nama, v_foto, v_cocok, v_me_id)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'petugas ini sudah tercatat hadir hari ini' USING ERRCODE = '23505';
  END;

  IF v_cocok IS NOT NULL THEN
    PERFORM public.catat_absensi(v_cocok, 'fo', NULL, NULL);
  END IF;

  -- Layanan dinyatakan dibuka hari ini (sama dengan catat_absensi).
  INSERT INTO public.layanan_hari (layanan_id, tanggal, status_hari)
  VALUES (p_layanan_id, v_tanggal, 'dibuka')
  ON CONFLICT (layanan_id, tanggal) DO UPDATE SET status_hari = 'dibuka', updated_at = now();

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.fo_catat_hadir_layanan(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_catat_hadir_layanan(uuid, text, text) TO authenticated;
