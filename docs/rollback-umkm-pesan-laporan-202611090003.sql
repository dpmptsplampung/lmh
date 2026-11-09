-- Rollback operasional G2 tiket 05, belum dijalankan pada staging/produksi.
-- Tutup pengawasan 0004 lebih dahulu; mempertahankan isi privat, receipt, laju dan audit.
DO $$
BEGIN
  IF to_regprocedure('public.umkm_ringkasan_pengawasan()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback pengawasan UMKM lebih dahulu'; END IF;
END $$;
DROP FUNCTION IF EXISTS public.umkm_kirim_pesan_kontak(text,text,text,text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.umkm_laporkan(uuid,text,uuid,uuid,text);
DROP FUNCTION IF EXISTS public.umkm_detail_pesan(uuid);
DROP FUNCTION IF EXISTS public.umkm_detail_laporan(uuid);
DROP FUNCTION IF EXISTS public.umkm_ambil_pekerjaan(text,uuid,integer,uuid);
DROP FUNCTION IF EXISTS public.umkm_selesaikan_pekerjaan(text,uuid,integer,uuid);
DROP FUNCTION IF EXISTS public.umkm_daftar_tugas(text);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated, service_role;
-- CHECK panjang dan indeks unik laporan baru tetap dipertahankan bersama data.
-- Antrean campuran dan formulir ditutup (RPC hilang, route 503). Signature uuid G1 tidak dipulihkan.
-- Pemeriksa G1 masih dapat mencari/membuka profil; data dan fungsi internal tetap ditahan.
-- Pengaktifan ulang melalui migrasi maju baru, bukan mengedit atau mengulang migrasi ini.
NOTIFY pgrst, 'reload schema';
