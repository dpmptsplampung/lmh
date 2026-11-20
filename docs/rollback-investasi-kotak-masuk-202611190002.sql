-- Rollback operasional Kotak Masuk Investasi; belum dijalankan di staging/produksi.
-- Pulihkan aplikasi lebih dahulu dan nonaktifkan formulir; paket lanjutan harus dinonaktifkan lebih dahulu.
-- Hanya pemilik DB menjalankan dalam satu transaksi setelah menyetujui penghentian retensi.
-- Tabel, kolom, lead, consent, audit, notifikasi dan indeks dipertahankan.
-- Insert/update langsung tetap ditutup; rollback tidak mengembalikan policy lama yang bisa dipalsukan klien.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'investasi_retensi_harian';
DROP FUNCTION IF EXISTS public.investasi_kirim_minat(text, uuid, text, text, text, text, text, boolean, text, uuid);
DROP FUNCTION IF EXISTS public.investasi_ubah_status_minat(uuid, text, integer);
REVOKE ALL ON FUNCTION public.investasi_bersihkan_retensi() FROM PUBLIC, anon, authenticated, service_role;
-- RLS baca tetap admin/petugas investasi; semua baris dan bukti persetujuan tetap dapat ditinjau.
-- Pengaktifan kembali lewat migrasi maju baru, bukan mengulang atau mengedit migrasi lama.
NOTIFY pgrst, 'reload schema';
