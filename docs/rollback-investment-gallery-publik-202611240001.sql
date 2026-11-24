-- Kembalikan versi aplikasi yang belum memakai kedua fungsi sebelum rollback.
DROP FUNCTION public.investasi_angka_publik();
DROP FUNCTION public.investasi_tukar_urutan_dokumen(uuid, uuid, integer, integer);
