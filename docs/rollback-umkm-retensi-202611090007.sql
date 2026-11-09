-- Jalankan sebagai pemilik DB setelah versi aplikasi G2 dipulihkan.
-- Data dan indeks dipertahankan; penghentian retensi memerlukan pembatasan formulir saat rilis.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='umkm_retensi_harian';
REVOKE ALL ON FUNCTION public.umkm_draf_dilindungi(text[]) FROM PUBLIC,anon,authenticated,service_role;
