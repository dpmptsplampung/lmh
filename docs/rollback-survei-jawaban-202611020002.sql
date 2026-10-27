-- docs/rollback-survei-jawaban-202611020002.sql
-- Rollback manual migrasi 202611020002_survei_jawaban.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan CEO,
-- ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-survei-jawaban-202611020002.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-survei-jawaban-202611020002.sql --atomic
-- PERINGATAN: rollback ini MENGHAPUS tabel spak_respons beserta SEMUA jawaban SPAK di dalamnya, dan membuang kolom
--   skm_respons.u10_transparansi, u11_integritas, versi, sumber, unit, jenis_kelamin, pendidikan beserta isinya (nilai
--   transparansi dan integritas, penanda sumber/unit). Data itu tidak bisa dipulihkan dari migrasi. Baris skm_respons TIDAK
--   dihapus: jawaban wizard yang sudah masuk tetap ada sebagai baris 9 unsur (dua nilai terakhirnya hilang), sehingga IKM
--   dihitung ulang dari sembilan unsur pertama. Menerapkan ulang migrasi sesudah rollback menandai semua baris itu sebagai
--   form_lama versi 1 (tanpa pemulihan sumber/unit sebelumnya).
-- URUTAN: jalankan SETELAH rollback 202611020004 dan 202611020003 (fungsi di migrasi itu memakai spak_respons dan kolom
--   u10/u11), dan SEBELUM rollback 202611020001 (survei_undangan dibaca oleh ringkasan_response_rate yang dihapus di sini).
-- PENJAGA (blok DO di awal; JANGAN dihapus): Postgres menolak DROP tanpa CASCADE hanya untuk ketergantungan yang ia
--   CATAT (view, FK, trigger, policy, constraint, ...). Badan fungsi PL/pgSQL (dan fungsi SQL biasa) terikat lambat:
--   TIDAK ada ketergantungan tercatat ke tabel, kolom, atau fungsi yang dipanggilnya, jadi DROP TABLE/COLUMN/FUNCTION di
--   bawah akan berhasil walau fungsi lain masih memakainya, dan fungsi itu baru gagal saat dipanggil (mis. fungsi kirim
--   jawaban survei yang menyisipkan ke spak_respons). Penjaga menolak seluruh rollback (PRASYARAT ROLLBACK) bila ada fungsi di
--   schema public, selain empat fungsi yang di-DROP atau dipulihkan di sini (hitung_ikm dipulihkan ke versi asli yang tidak
--   menyebut objek baru), yang teks badannya menyebut spak_respons, u10_transparansi, u11_integritas, atau salah satu
--   fungsi ringkasan. Pencocokan teks bersifat konservatif (komentar di badan fungsi ikut dihitung): bila penjaga menolak,
--   rollback migrasi yang memakai objek itu dulu, atau periksa nama fungsi yang dilaporkan. Penjaga ini tidak melihat
--   pemakai di luar pg_proc (mis. job pg_cron atau kode klien/PostgREST).
-- Urutan di bawah: (1) pulihkan hitung_ikm ke versi asli (202607140004) SEBELUM kolom dibuang; (2) pulihkan v_skm_petugas
--   ke versi asli (202610090001) lewat DROP lalu CREATE, karena CREATE OR REPLACE VIEW tidak bisa membuang kolom dan view
--   itu bergantung pada u10/u11 (ketergantungan TERCATAT, jadi DROP COLUMN akan gagal bila view tidak dipulihkan dulu);
--   (3) hapus tiga fungsi ringkasan dan tabel spak_respons; (4) buang constraint wizard dan kolom baru skm_respons;
--   (5) kosongkan komentar visit_id dan saran (sebelum migrasi tidak ada komentar).
-- Tanpa CASCADE (supaya ketergantungan yang TERCATAT menggagalkan DROP, bukan menghapus objek lain diam-diam).
-- Idempoten (IF EXISTS, CREATE OR REPLACE; menjalankan ulang menghasilkan keadaan yang sama).

DO $$
DECLARE
  v_fungsi text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT p.oid::pg_catalog.regprocedure::text, ', ') INTO v_fungsi
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('hitung_ikm', 'ringkasan_ikm', 'ringkasan_response_rate', 'ringkasan_spak')
    AND p.prosrc ~* '(spak_respons|u10_transparansi|u11_integritas|ringkasan_ikm|ringkasan_spak|ringkasan_response_rate)';
  IF v_fungsi IS NOT NULL THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: fungsi lain masih memakai spak_respons/u10_transparansi/u11_integritas/ringkasan_* (rollback migrasi yang memakainya dulu: 202611020004, 202611020003): %', v_fungsi;
  END IF;
END $$;

-- 1. hitung_ikm: versi ASLI 202607140004_security_and_automation.sql (9 unsur, penyebut 9.0), hak EXECUTE anon + authenticated.
CREATE OR REPLACE FUNCTION public.hitung_ikm(p_layanan_id uuid, p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, layanan_nama text, ikm numeric, responden integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_layanan_id, service.nama,
    pg_catalog.avg(
      (response.u1_persyaratan + response.u2_prosedur + response.u3_waktu +
       response.u4_biaya + response.u5_produk + response.u6_kompetensi +
       response.u7_perilaku + response.u8_sarana + response.u9_pengaduan) / 9.0
    ) * 25 AS ikm,
    pg_catalog.count(*)::integer AS responden
  FROM public.skm_respons AS response
  JOIN public.layanan AS service ON service.id = p_layanan_id
  WHERE response.layanan_id = p_layanan_id
    AND response.created_at::date BETWEEN p_start AND p_end
  GROUP BY service.nama
$$;
REVOKE EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated;

-- 2. v_skm_petugas: versi ASLI 202610090001_rbac_tahap1.sql (tanpa u10/u11). DROP lalu CREATE (kolom tidak bisa dibuang
--    oleh CREATE OR REPLACE VIEW); hak seperti asli.
DROP VIEW IF EXISTS public.v_skm_petugas;
CREATE VIEW public.v_skm_petugas AS
SELECT s.layanan_id, s.u1_persyaratan, s.u2_prosedur, s.u3_waktu, s.u4_biaya, s.u5_produk,
       s.u6_kompetensi, s.u7_perilaku, s.u8_sarana, s.u9_pengaduan, s.saran, s.created_at
FROM public.skm_respons AS s
WHERE public.peran_saya() = 'petugas' AND public.boleh_layanan(s.layanan_id);
REVOKE ALL ON public.v_skm_petugas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_skm_petugas TO authenticated;

-- 3. Fungsi ringkasan dan tabel SPAK (policy spak_select_staff ikut terhapus bersama tabel).
DROP FUNCTION IF EXISTS public.ringkasan_response_rate(date, date);
DROP FUNCTION IF EXISTS public.ringkasan_spak(date, date);
DROP FUNCTION IF EXISTS public.ringkasan_ikm(date, date);
DROP TABLE IF EXISTS public.spak_respons;

-- 4. skm_respons: constraint wizard lalu ketujuh kolom baru (data di kolom itu hilang).
ALTER TABLE public.skm_respons DROP CONSTRAINT IF EXISTS skm_respons_wizard_kunjungan_versi_check;
ALTER TABLE public.skm_respons
  DROP COLUMN IF EXISTS u10_transparansi,
  DROP COLUMN IF EXISTS u11_integritas,
  DROP COLUMN IF EXISTS versi,
  DROP COLUMN IF EXISTS sumber,
  DROP COLUMN IF EXISTS unit,
  DROP COLUMN IF EXISTS jenis_kelamin,
  DROP COLUMN IF EXISTS pendidikan;

-- 5. Sebelum migrasi tidak ada komentar pada kedua kolom lama ini.
COMMENT ON COLUMN public.skm_respons.visit_id IS NULL;
COMMENT ON COLUMN public.skm_respons.saran IS NULL;
