-- docs/rollback-saran-pengaduan-pesan-perilaku-202611030003.sql
-- Rollback manual 202611030003. BUKAN migrasi. Menghapus saran dan pengaduan dari Pesan Perilaku (data HILANG) lalu memulihkan hak SKM lama.
-- Pengaduan sumber 'wizard' dihapus; kolom tambahan pengaduan dilepas.
DROP FUNCTION IF EXISTS public.ringkasan_pengaduan(date, date);
DROP FUNCTION IF EXISTS public.ringkasan_saran(date, date);
DROP FUNCTION IF EXISTS public.lacak_pengaduan_nomor(text);
DROP FUNCTION IF EXISTS public.kirim_pengaduan_survei(text, text, boolean);
DROP FUNCTION IF EXISTS public.kirim_saran(text, text, boolean);
DROP FUNCTION IF EXISTS public.generate_nomor_laporan();
CREATE OR REPLACE VIEW public.v_pengaduan_petugas AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, g.isi, g.anonim, g.status,
       g.batas_verifikasi, g.batas_penanganan, g.created_at, g.updated_at
FROM public.pengaduan AS g
WHERE g.jalur = 'layanan' AND public.peran_saya() = 'petugas' AND public.boleh_layanan(g.layanan_id);
DELETE FROM public.pengaduan WHERE sumber = 'wizard';
DROP INDEX IF EXISTS public.pengaduan_undangan_unik;
ALTER TABLE public.pengaduan DROP CONSTRAINT IF EXISTS pengaduan_sumber_check;
ALTER TABLE public.pengaduan DROP COLUMN IF EXISTS undangan_id, DROP COLUMN IF EXISTS pelapor_nama, DROP COLUMN IF EXISTS kunjungan_id, DROP COLUMN IF EXISTS sumber;
DROP TABLE IF EXISTS public.saran;
GRANT EXECUTE ON FUNCTION public.get_skm_context(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_skm_response(text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) TO anon, authenticated;
