-- Rollback manual migrasi 202610090002_akun_username.sql.
-- URUTAN ROLLBACK (kebalikan penerapan): 0005 -> 0004 -> 0003 -> 0002 -> 0001. Jangan melompati; lihat docs/RUNBOOK_RBAC_PENERAPAN.md.
-- PERINGATAN: menghapus kolom username/no_hp/email_notifikasi/operator_default/wajib_ganti_sandi
-- dan absensi_petugas.operator_nama beserta ISINYA. Bila skrip migrate-akun-username.mjs sudah
-- dijalankan (email login akun = sintetis), kembalikan dulu email login lama dari berkas cadangan
-- skrip itu (--rollback) SEBELUM menjalankan berkas ini, atau akun tidak bisa login dengan email lama.
-- Terapkan secara ATOMIK:  node scripts/apply-migration.mjs docs/rollback-rbac-tahap2-202610090002.sql --atomic --yes
DROP TRIGGER IF EXISTS trg_absensi_isi_operator ON public.absensi_petugas;
DROP FUNCTION IF EXISTS public.absensi_isi_operator();
DROP TRIGGER IF EXISTS trg_guard_admin_terakhir ON public.petugas;
DROP FUNCTION IF EXISTS public.guard_admin_terakhir();
DROP FUNCTION IF EXISTS public.akun_akhiri_sesi(uuid);
DROP FUNCTION IF EXISTS public.akun_daftar();
DROP FUNCTION IF EXISTS public.tersamarkan_email(text);
DROP FUNCTION IF EXISTS public.petugas_verifikasi_email(text);
DROP TABLE IF EXISTS public.petugas_verif_email;
DROP FUNCTION IF EXISTS public.petugas_ubah_profil(jsonb);
ALTER TABLE public.absensi_petugas DROP COLUMN IF EXISTS operator_nama;
ALTER TABLE public.petugas
  DROP CONSTRAINT IF EXISTS petugas_operator_default_len,
  DROP CONSTRAINT IF EXISTS petugas_email_notifikasi_format,
  DROP CONSTRAINT IF EXISTS petugas_no_hp_format,
  DROP CONSTRAINT IF EXISTS petugas_username_key,
  DROP CONSTRAINT IF EXISTS petugas_username_format,
  DROP COLUMN IF EXISTS wajib_ganti_sandi,
  DROP COLUMN IF EXISTS operator_default,
  DROP COLUMN IF EXISTS email_notifikasi_verified_at,
  DROP COLUMN IF EXISTS email_notifikasi,
  DROP COLUMN IF EXISTS no_hp,
  DROP COLUMN IF EXISTS username;
