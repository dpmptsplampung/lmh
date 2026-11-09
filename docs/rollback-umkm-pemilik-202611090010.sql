-- Jalankan hanya sesudah pemulihan aplikasi tahap B, urutan 0011 lalu 0010.

-- Tabel, revisi, kontak, kepemilikan dan bukti dipertahankan; tidak ada data yang dihapus.

CREATE OR REPLACE FUNCTION public.umkm_usaha_saya(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_detail_usaha(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_akses_draf_pemilik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_daftar_usaha(p_data jsonb,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_simpan_draf(p_profil_id uuid,p_data jsonb,p_expected_version integer,
  p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

DROP TRIGGER IF EXISTS umkm_sahkan_pendaftar ON public.umkm_profil;
DROP TRIGGER IF EXISTS umkm_jaga_sumber_mandiri ON public.umkm_profil;

CREATE OR REPLACE FUNCTION public.umkm_tahap_c() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT '{"aktif":false}'::jsonb $$;

CREATE OR REPLACE FUNCTION public.umkm_cabut_izin_pemilik(p_profil_id uuid,p_expected_version integer,
  p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;
