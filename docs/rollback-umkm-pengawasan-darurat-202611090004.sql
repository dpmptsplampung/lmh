-- Rollback operasional G2 tiket 06, belum dijalankan pada staging/produksi.
-- Jalankan sebelum rollback 0003 lalu 0002. Tidak menghapus tabel, izin, flag darurat atau jejak.
-- Pekerjaan darurat yang sudah masuk tetap dapat diperiksa pemegang melalui modul pemeriksa.
DROP FUNCTION IF EXISTS public.umkm_ringkasan_pengawasan();
DROP FUNCTION IF EXISTS public.umkm_jejak_pengawasan(text);
DROP FUNCTION IF EXISTS public.umkm_cari_pengawasan(text,uuid);
DROP FUNCTION IF EXISTS public.umkm_tindakan_darurat(uuid,text,text,integer,uuid);
DROP FUNCTION IF EXISTS public.umkm_selesaikan_mendesak(uuid,integer,uuid);
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated, service_role;
-- Hook pembersihan selesai-mendesak ikut tertutup; retry pemeriksa foto tetap tersedia sampai rollback 0002.
-- Endpoint terkait memperoleh MODUL_BELUM_TERSEDIA (503), bukan keberhasilan kosong.
-- Pengaktifan ulang wajib migrasi maju baru; jangan menjalankan ulang atau mengubah migrasi lama.
NOTIFY pgrst, 'reload schema';
