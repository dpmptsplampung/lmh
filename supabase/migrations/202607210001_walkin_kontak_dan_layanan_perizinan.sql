-- ============================================================
-- Walk-in: kolom kontak HP pada visit + layanan "Perizinan DPMPTSP"
-- ============================================================
-- (1) kontak_hp opsional untuk kunjungan (diisi petugas saat registrasi
--     walk-in; dipakai untuk follow-up/SKM manual bila diperlukan).
-- (2) Baris layanan baru agar muncul sebagai pilihan loket pada wizard
--     walk-in & form reservasi. Idempotent: aman di-apply ulang.

BEGIN;

ALTER TABLE public.visit
  ADD COLUMN IF NOT EXISTS kontak_hp text;

INSERT INTO public.layanan (nama, tipe, chatbot_aktif)
VALUES ('Layanan Perizinan DPMPTSP Provinsi Lampung', 'konsultatif', false)
ON CONFLICT (nama) DO NOTHING;

COMMIT;
