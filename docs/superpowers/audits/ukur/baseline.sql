-- baseline.sql: pengukuran BACA SAJA untuk G0 (SPEC refaktor-arsitektur-ui §10 butir 1-4).
-- Tanpa kredensial. Ganti placeholder sebelum menjalankan (lihat README.md):
--   <UID_ADMIN>   auth.users.id milik SATU akun admin aktif (bukan petugas.id)
--   <SAMPAI>      tanggal akhir, format YYYY-MM-DD (mis. hari ini WIB)
--   <DARI_7>      <SAMPAI> dikurangi 6 hari;  <DARI_30> = dikurangi 29;  <DARI_366> = dikurangi 365
--   <LAYANAN_ID>  uuid satu layanan yang ramai (hanya blok 1a'')
--   <JENIS_UMKM>  nilai umkm_revisi.jenis yang nyata (blok 3b)
--   <DARI_x>      hanya blok 2: pilih salah satu dari <DARI_7>/<DARI_30>/<DARI_366>, jalankan tiga kali
-- Tiap blok: BEGIN ... ROLLBACK. EXPLAIN ANALYZE menjalankan query, tetapi semua fungsi STABLE (tidak menulis).
-- rekap_pelayanan_inti menolak rentang >= 366 hari selisih, maka "366 hari" = <SAMPAI> dikurangi 365.

-- =====================================================================
-- 1. RPC rekap, rentang 7 / 30 / 366 hari
-- =====================================================================
-- 1a. rekap_data_pelayanan 7 hari, p_hitung=false
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_7>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, false, false);
ROLLBACK;

-- 1a. rekap_data_pelayanan 7 hari, p_hitung=true
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_7>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, true, false);
ROLLBACK;

-- 1a. rekap_data_pelayanan 30 hari, p_hitung=false
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_30>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, false, false);
ROLLBACK;

-- 1a. rekap_data_pelayanan 30 hari, p_hitung=true
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_30>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, true, false);
ROLLBACK;

-- 1a. rekap_data_pelayanan 366 hari, p_hitung=false
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_366>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, false, false);
ROLLBACK;

-- 1a. rekap_data_pelayanan 366 hari, p_hitung=true
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_366>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, true, false);
ROLLBACK;

-- 1a'. rekap_data_pelayanan 30 hari, p_tanpa_form=true (tab Data Pelayanan)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_30>'::date, '<SAMPAI>'::date, NULL, NULL, 50, 0, NULL, true, true);
ROLLBACK;

-- 1a''. rekap_data_pelayanan 30 hari, satu layanan
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_data_pelayanan('<DARI_30>'::date, '<SAMPAI>'::date, NULL, '<LAYANAN_ID>'::uuid, 50, 0, NULL, true, false);
ROLLBACK;

-- 1b. rekap_ringkasan_dilayani 7 hari (p_dari,p_sampai,p_unit,p_layanan_id,p_tanpa_form)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_ringkasan_dilayani('<DARI_7>'::date, '<SAMPAI>'::date, NULL, NULL, false);
ROLLBACK;

-- 1b. rekap_ringkasan_dilayani 30 hari (p_dari,p_sampai,p_unit,p_layanan_id,p_tanpa_form)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_ringkasan_dilayani('<DARI_30>'::date, '<SAMPAI>'::date, NULL, NULL, false);
ROLLBACK;

-- 1b. rekap_ringkasan_dilayani 366 hari (p_dari,p_sampai,p_unit,p_layanan_id,p_tanpa_form)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_ringkasan_dilayani('<DARI_366>'::date, '<SAMPAI>'::date, NULL, NULL, false);
ROLLBACK;

-- 1c. rekap_harian_terpadu 7 hari (p_dari,p_sampai,p_unit,p_layanan_id)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_harian_terpadu('<DARI_7>'::date, '<SAMPAI>'::date, NULL, NULL);
ROLLBACK;

-- 1c. rekap_harian_terpadu 30 hari (p_dari,p_sampai,p_unit,p_layanan_id)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_harian_terpadu('<DARI_30>'::date, '<SAMPAI>'::date, NULL, NULL);
ROLLBACK;

-- 1c. rekap_harian_terpadu 366 hari (p_dari,p_sampai,p_unit,p_layanan_id)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_harian_terpadu('<DARI_366>'::date, '<SAMPAI>'::date, NULL, NULL);
ROLLBACK;

-- 1d. rekap_kinerja_petugas 7 hari (p_dari,p_sampai,p_unit,p_layanan_id)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_kinerja_petugas('<DARI_7>'::date, '<SAMPAI>'::date, NULL, NULL);
ROLLBACK;

-- 1d. rekap_kinerja_petugas 30 hari (p_dari,p_sampai,p_unit,p_layanan_id)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_kinerja_petugas('<DARI_30>'::date, '<SAMPAI>'::date, NULL, NULL);
ROLLBACK;

-- 1d. rekap_kinerja_petugas 366 hari (p_dari,p_sampai,p_unit,p_layanan_id)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.rekap_kinerja_petugas('<DARI_366>'::date, '<SAMPAI>'::date, NULL, NULL);
ROLLBACK;

-- =====================================================================
-- 2. Rencana dalam rekap_pelayanan_inti (salinan dua cabang SELECT, literal, tanpa predikat lingkup)
-- Sumber: supabase/migrations/202611040001_perbaikan_tinjauan_akhir.sql baris 621-654.
-- Disalin sebagai admin (v_semua=true): predikat lingkup dan filter p_unit/p_layanan_id NULL dibuang.
-- =====================================================================
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT p.id, 'penanganan'::text, k.tanggal, COALESCE(p.mulai_at, p.selesai_at), p.kunjungan_id, p.tiket_id,
       p.tahap_ke, p.peran_tahap, p.layanan_id,
       CASE WHEN p.saluran = 'chat' THEN 'live_chat' ELSE 'tatap_muka' END,
       p.penangan_id, p.hasil, p.topik, p.catatan, p.mulai_at, p.selesai_at
FROM public.penanganan AS p
JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
WHERE p.status = 'selesai'
  AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
  AND k.tanggal BETWEEN '<DARI_x>'::date AND '<SAMPAI>'::date
UNION ALL
SELECT t.id, 'tiket_lama'::text, COALESCE(k.tanggal, t.tanggal), COALESCE(t.waktu_mulai_layan, t.waktu_selesai),
       t.kunjungan_id, t.id, NULL::integer, 'layanan'::text, t.layanan_id, 'tatap_muka'::text,
       COALESCE(o.petugas_id, pz.petugas_id, t.dilayani_oleh), 'selesai'::text, NULL::text, NULL::text,
       t.waktu_mulai_layan, t.waktu_selesai
FROM public.tiket_antrean AS t
LEFT JOIN public.kunjungan AS k ON k.id = t.kunjungan_id
LEFT JOIN public.pelayanan_oss AS o ON o.tiket_id = t.id
LEFT JOIN public.pelayanan_perizinan AS pz ON pz.tiket_id = t.id
WHERE t.status = 'selesai'
  AND t.waktu_selesai IS NOT NULL
  AND COALESCE(k.tanggal, t.tanggal) BETWEEN '<DARI_x>'::date AND '<SAMPAI>'::date
  AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)
  AND COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai';
ROLLBACK;

-- =====================================================================
-- 3. umkm_cari_katalog(p_q,p_jenis,p_kategori,p_spesifik,p_kabupaten_kota,p_sort,p_cursor) (202611100003)
-- p_sort hanya boleh 'paling_sesuai'.
-- =====================================================================
-- 3a. tanpa filter
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.umkm_cari_katalog(NULL, NULL, NULL, NULL, NULL, 'paling_sesuai', NULL);
ROLLBACK;

-- 3b. dengan p_jenis
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.umkm_cari_katalog(NULL, '<JENIS_UMKM>', NULL, NULL, NULL, 'paling_sesuai', NULL);
ROLLBACK;

-- 3c. dengan p_q 4 huruf (ganti 'kopi' bila perlu)
BEGIN;
SET LOCAL role authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<UID_ADMIN>","role":"authenticated"}';
EXPLAIN (ANALYZE, BUFFERS)
SELECT public.umkm_cari_katalog('kopi', NULL, NULL, NULL, NULL, 'paling_sesuai', NULL);
ROLLBACK;

-- =====================================================================
-- 4. Jumlah baris dan pg_stat_statements (baca saja)
-- Dijalankan TANPA SET LOCAL role: jumlah baris apa adanya (bukan hasil RLS).
-- =====================================================================
BEGIN;
SET LOCAL statement_timeout = '30s';
SELECT 'kunjungan' AS tabel, count(*) AS baris FROM public.kunjungan
UNION ALL SELECT 'penanganan', count(*) FROM public.penanganan
UNION ALL SELECT 'tiket_antrean', count(*) FROM public.tiket_antrean
UNION ALL SELECT 'umkm_profil_terbit', count(*) FROM public.umkm_profil WHERE status = 'terbit'
UNION ALL SELECT 'umkm_produk', count(*) FROM public.umkm_produk;
ROLLBACK;

-- 4b. pg_stat_statements: butuh ekstensi aktif dan hak baca; bila galat "relation does not exist" catat "tidak tersedia".
BEGIN;
SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 120) AS query, calls,
       round(mean_exec_time::numeric, 2) AS rata_ms, round(total_exec_time::numeric, 0) AS total_ms, rows
FROM pg_stat_statements
WHERE query ILIKE '%rekap_data_pelayanan%' OR query ILIKE '%rekap_ringkasan_dilayani%'
   OR query ILIKE '%rekap_harian_terpadu%' OR query ILIKE '%rekap_kinerja_petugas%'
   OR query ILIKE '%rekap_pelayanan_inti%' OR query ILIKE '%umkm_cari_katalog%'
   OR (query ILIKE '%count(*)%' AND (query ILIKE '%notifikasi%' OR query ILIKE '%chat_sesi%'
                                     OR query ILIKE '%tiket_antrean%' OR query ILIKE '%penanganan%'))
ORDER BY total_exec_time DESC
LIMIT 40;
ROLLBACK;
