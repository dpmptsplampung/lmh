-- 202610270002_survei_jawaban.sql
-- SURVEI TERPADU FASE A, langkah 2 (spec: docs/superpowers/specs/2026-10-26-survei-terpadu-design.md §4.2, §4.3, §6):
-- tempat menyimpan jawaban survei terpadu. SKM diperluas dari 9 ke 11 unsur (u10 transparansi, u11 integritas) tanpa
-- merusak baris lama; SPAK (5 butir, nilai 1-6) mendapat tabel sendiri yang tidak terbaca petugas; ringkasan IKM, SPAK,
-- dan response rate tersedia sebagai RPC untuk halaman admin. Penulisan jawaban (kirim_survei) menyusul di 202610270003;
-- tidak ada tulis langsung dari klien ke tabel jawaban.
--
-- ISI:
--   1. skm_respons (aditif, baris lama tetap valid): kolom u10_transparansi dan u11_integritas (smallint, CHECK 1-4, boleh
--      kosong), versi (smallint NOT NULL default 1), sumber ('form_lama' | 'wizard' | 'impor', default 'form_lama'), unit
--      ('layanan' | 'fo' | 'tidak_diketahui', default 'tidak_diketahui'), jenis_kelamin dan pendidikan (teks asli, boleh
--      kosong; hanya impor). Constraint skm_respons_wizard_kunjungan_versi_check: sumber 'wizard' mewajibkan kunjungan_id
--      terisi dan versi = 2 (indeks unik parsial kunjungan_id yang sudah ada tetap menjamin satu jawaban per kunjungan).
--      UPDATE sekali: baris lama ber-layanan_id (sumber 'form_lama', unit masih default) ditandai unit 'layanan'; yang
--      layanan_id-nya kosong tetap 'tidak_diketahui' (tidak bisa dibedakan dari Front Office). Syarat sumber = 'form_lama'
--      membuat penerapan ulang tidak menimpa baris impor yang sengaja berunit 'tidak_diketahui'. visit_id dan saran diberi
--      komentar "tidak dipakai alur baru". Policy, hak, RLS, dan trigger skm_respons TIDAK diubah (trigger skm_response_rate
--      tetap mengisi response rate lama; layanan NULL, yaitu jawaban FO, diabaikan olehnya).
--      CATATAN INTERAKSI FK: kunjungan_id memakai ON DELETE SET NULL (202610140007). Menghapus kunjungan yang jawabannya
--      berasal dari wizard kini DITOLAK (SQLSTATE 23514: SET NULL melanggar constraint wizard); jawaban form_lama tetap
--      menjadi kunjungan_id NULL seperti dulu. Aplikasi tidak pernah menghapus kunjungan (retensi hanya menganonimkan).
--   2. Tabel spak_respons: kunjungan_id UNIK (boleh kosong untuk impor; FK kunjungan, ON DELETE SET NULL), layanan_id
--      (FK layanan, ON DELETE SET NULL), unit, sumber ('wizard' | 'impor'), p1_tanpa_diskriminasi .. p5_tanpa_percaloan
--      (smallint NOT NULL, CHECK 1-6; 6 = Sangat Setuju), jenis_kelamin, pendidikan, created_at. RLS aktif; hak tabel dicabut
--      dari PUBLIC/anon/authenticated lalu GRANT SELECT hanya authenticated; satu policy spak_select_staff (FOR SELECT, TO
--      authenticated, hanya peran_saya() admin/front_office). Petugas layanan dan non-staf tidak membaca apa pun; tanpa
--      policy dan tanpa hak tulis untuk klien (penulisan lewat fungsi SECURITY DEFINER di 202610270003).
--   3. hitung_ikm(uuid, date, date) diganti (signature, hak, dan klausa FROM/WHERE identik): rata-rata per baris
--      (u1..u9 + COALESCE(u10, 0) + COALESCE(u11, 0)) / (9.0 + u10 terisi + u11 terisi) x 25. Penyebut memakai 9.0 (numerik;
--      9 bulat akan memotong hasil bagi). Baris 9 unsur lama menghasilkan nilai yang sama persis dengan rumus lama; baris
--      dengan salah satu u1..u9 kosong tetap keluar dari rata-rata (tetapi dihitung di responden), sama seperti dulu.
--      EXECUTE tetap anon dan authenticated (halaman transparansi publik). Periode tetap memakai created_at::date (zona
--      sesi) seperti versi lama; fungsi ringkasan di bawah memakai tanggal WIB.
--   4. ringkasan_ikm(p_start, p_end): satu baris per layanan yang punya jawaban, satu baris unit 'fo' ("Front Office"), dan
--      satu baris 'tidak_diketahui' ("Tidak terklasifikasi (data lama/impor)"); hanya kelompok yang punya jawaban. Rumus
--      sama dengan hitung_ikm (responden = jumlah baris, seperti hitung_ikm). Pengelompokan: unit 'fo' -> Front Office;
--      selain itu layanan_id terisi -> baris layanan (jadi baris gaya lama yang masih ditulis submit_skm_response lama,
--      yang unit-nya jatuh ke default, tetap dihitung ke layanannya); selain itu -> tidak terklasifikasi. NULL lama tidak
--      pernah bercampur dengan FO. Peran: admin, front_office, petugas (agregat tanpa identitas, sama jenisnya dengan
--      hitung_ikm publik); selain itu hasil kosong. Periode = tanggal WIB (created_at).
--   5. ringkasan_spak(p_start, p_end): pengelompokan yang sama, rata-rata p1..p5 dan responden; HANYA admin/front_office
--      (petugas dan non-staf: kosong). Periode = tanggal WIB.
--   6. ringkasan_response_rate(p_start, p_end): dari survei_undangan (migrasi 202610270001): diundang = undangan yang
--      dibuat_pada-nya jatuh dalam periode WIB, mengisi = di antaranya yang diisi_pada-nya terisi (kohort undangan); baris per
--      layanan dan satu baris 'fo'; undangan yang layanannya sudah dihapus masuk 'tidak_diketahui' agar jumlah tidak hilang.
--      HANYA admin/front_office.
--   7. v_skm_petugas diganti (CREATE OR REPLACE VIEW): kolom lama berurutan, lalu u10_transparansi dan u11_integritas di
--      AKHIR (CREATE OR REPLACE VIEW hanya boleh menambah kolom di akhir). Klausa FROM/WHERE dan hak identik; tetap tanpa
--      id, visit_id, kunjungan_id, unit, sumber, versi, jenis_kelamin, pendidikan.
--   Semua fungsi SECURITY DEFINER dengan SET search_path = pg_catalog, public; REVOKE dari PUBLIC/anon/authenticated lalu
--   GRANT eksplisit. Ketiga fungsi ringkasan hanya authenticated (anon ditolak oleh hak, SQLSTATE 42501).
--
-- SYARAT: skm_respons.kunjungan_id (202610140007), survei_undangan (202610270001), hitung_ikm (202607140004), v_skm_petugas
--   dan peran_saya (202610090001), boleh_layanan (202610080001); dijaga blok PRASYARAT di bawah.
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO; migrasi ini DITULIS tetapi BELUM DITERAPKAN):
--   node scripts/apply-migration.mjs supabase/migrations/202610270002_survei_jawaban.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610270002_survei_jawaban.sql --atomic
-- Idempoten (ADD COLUMN IF NOT EXISTS, DROP lalu ADD untuk constraint sendiri, CREATE OR REPLACE, DROP POLICY IF EXISTS):
-- menerapkan ulang tidak mengubah data, kecuali menandai unit 'layanan' pada baris form_lama ber-layanan_id yang masih
-- berunit default (mis. ditulis form lama sesudah migrasi); baris wizard dan impor tidak pernah disentuh UPDATE itu.
-- ROLLBACK: docs/rollback-survei-jawaban-202610270002.sql (memulihkan hitung_ikm dan v_skm_petugas ke versi asli, menghapus
--   yang ditambahkan; MENGHAPUS data kolom u10/u11 dan tabel spak_respons; jalankan SETELAH rollback 202610270004 dan
--   202610270003, SEBELUM rollback 202610270001).
-- UJI PERILAKU: scripts/lokal/skenario-survei-jawaban.mjs (PGlite lokal, tanpa DB nyata). Kontrak statis:
--   supabase/migrations/survei_jawaban.test.ts.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.skm_respons') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel skm_respons belum ada (202607140003_domain_schema)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.to_regclass('public.skm_respons') AND a.attname = 'kunjungan_id' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom skm_respons.kunjungan_id belum ada (202610140007_wp24_akhiri_dual_write)';
  END IF;
  IF pg_catalog.to_regclass('public.survei_undangan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel survei_undangan belum ada (202610270001_survei_undangan)';
  END IF;
  IF pg_catalog.to_regclass('public.v_skm_petugas') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: view v_skm_petugas belum ada (202610090001_rbac_tahap1)';
  END IF;
  IF pg_catalog.to_regprocedure('public.hitung_ikm(uuid, date, date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: hitung_ikm(uuid, date, date) belum ada (202607140004_security_and_automation)';
  END IF;
  IF pg_catalog.to_regprocedure('public.peran_saya()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: peran_saya() belum ada (202610090001_rbac_tahap1)';
  END IF;
  IF pg_catalog.to_regprocedure('public.boleh_layanan(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: boleh_layanan(uuid) belum ada (202610080001_rbac_tahap0_keamanan)';
  END IF;
END $$;

-- ============================================================
-- 1. skm_respons: 11 unsur, versi, sumber, unit (aditif)
-- ============================================================
ALTER TABLE public.skm_respons
  ADD COLUMN IF NOT EXISTS u10_transparansi smallint CHECK (u10_transparansi BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS u11_integritas smallint CHECK (u11_integritas BETWEEN 1 AND 4),
  ADD COLUMN IF NOT EXISTS versi smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS sumber text NOT NULL DEFAULT 'form_lama' CHECK (sumber IN ('form_lama', 'wizard', 'impor')),
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT 'tidak_diketahui' CHECK (unit IN ('layanan', 'fo', 'tidak_diketahui')),
  ADD COLUMN IF NOT EXISTS jenis_kelamin text,
  ADD COLUMN IF NOT EXISTS pendidikan text;

-- Jawaban wizard wajib tertaut ke kunjungan dan berversi 2 (kolom kunjungan_id sudah ada sejak 202610140007).
ALTER TABLE public.skm_respons DROP CONSTRAINT IF EXISTS skm_respons_wizard_kunjungan_versi_check;
ALTER TABLE public.skm_respons
  ADD CONSTRAINT skm_respons_wizard_kunjungan_versi_check
  CHECK (sumber <> 'wizard' OR (kunjungan_id IS NOT NULL AND versi = 2));

-- Baris lama yang punya layanan_id = unit layanan. Yang layanan_id-nya kosong tetap tidak_diketahui.
UPDATE public.skm_respons
   SET unit = 'layanan'
 WHERE layanan_id IS NOT NULL AND sumber = 'form_lama' AND unit = 'tidak_diketahui';

COMMENT ON COLUMN public.skm_respons.visit_id IS
  'Kolom lama (alur form lama berbasis visit). tidak dipakai alur baru: jawaban wizard menautkan kunjungan_id.';
COMMENT ON COLUMN public.skm_respons.saran IS
  'Kolom lama (saran teks bebas pada form lama). tidak dipakai alur baru: saran wizard disimpan di tabel tersendiri.';

-- ============================================================
-- 2. spak_respons (tanpa akses tulis klien; baca hanya admin/front_office)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.spak_respons (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kunjungan_id          uuid        UNIQUE REFERENCES public.kunjungan (id) ON DELETE SET NULL,
  layanan_id            uuid        REFERENCES public.layanan (id) ON DELETE SET NULL,
  unit                  text        NOT NULL CHECK (unit IN ('layanan', 'fo', 'tidak_diketahui')),
  sumber                text        NOT NULL CHECK (sumber IN ('wizard', 'impor')),
  p1_tanpa_diskriminasi smallint    NOT NULL CHECK (p1_tanpa_diskriminasi BETWEEN 1 AND 6),
  p2_tanpa_kecurangan   smallint    NOT NULL CHECK (p2_tanpa_kecurangan BETWEEN 1 AND 6),
  p3_tanpa_imbalan      smallint    NOT NULL CHECK (p3_tanpa_imbalan BETWEEN 1 AND 6),
  p4_tanpa_pungli       smallint    NOT NULL CHECK (p4_tanpa_pungli BETWEEN 1 AND 6),
  p5_tanpa_percaloan    smallint    NOT NULL CHECK (p5_tanpa_percaloan BETWEEN 1 AND 6),
  jenis_kelamin         text,
  pendidikan            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.spak_respons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.spak_respons FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.spak_respons TO authenticated;

DROP POLICY IF EXISTS spak_select_staff ON public.spak_respons;
CREATE POLICY spak_select_staff ON public.spak_respons FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office'));

-- ============================================================
-- 3. hitung_ikm: rata-rata unsur terisi x 25 (baris 9 unsur lama tetap valid)
-- ============================================================
CREATE OR REPLACE FUNCTION public.hitung_ikm(p_layanan_id uuid, p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, layanan_nama text, ikm numeric, responden integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_layanan_id, service.nama,
    pg_catalog.avg(
      (response.u1_persyaratan + response.u2_prosedur + response.u3_waktu +
       response.u4_biaya + response.u5_produk + response.u6_kompetensi +
       response.u7_perilaku + response.u8_sarana + response.u9_pengaduan +
       COALESCE(response.u10_transparansi, 0) + COALESCE(response.u11_integritas, 0))
      / (9.0 + (response.u10_transparansi IS NOT NULL)::int + (response.u11_integritas IS NOT NULL)::int)
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

-- ============================================================
-- 4. ringkasan_ikm: per layanan, Front Office, dan tidak terklasifikasi
-- ============================================================
CREATE OR REPLACE FUNCTION public.ringkasan_ikm(p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, unit text, nama text, ikm numeric, responden integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH baris AS (
    SELECT
      CASE WHEN s.unit = 'fo' THEN 'fo' WHEN s.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END AS unit_grup,
      CASE WHEN s.unit = 'fo' THEN NULL::uuid ELSE s.layanan_id END AS layanan_grup,
      (s.u1_persyaratan + s.u2_prosedur + s.u3_waktu + s.u4_biaya + s.u5_produk +
       s.u6_kompetensi + s.u7_perilaku + s.u8_sarana + s.u9_pengaduan +
       COALESCE(s.u10_transparansi, 0) + COALESCE(s.u11_integritas, 0))
      / (9.0 + (s.u10_transparansi IS NOT NULL)::int + (s.u11_integritas IS NOT NULL)::int) AS rata
    FROM public.skm_respons AS s
    WHERE (SELECT public.peran_saya()) IN ('admin', 'front_office', 'petugas')
      AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_start AND p_end
  )
  SELECT b.layanan_grup,
         b.unit_grup,
         CASE b.unit_grup
           WHEN 'fo' THEN 'Front Office'
           WHEN 'layanan' THEN l.nama
           ELSE 'Tidak terklasifikasi (data lama/impor)'
         END,
         pg_catalog.avg(b.rata) * 25,
         pg_catalog.count(*)::integer
  FROM baris AS b
  LEFT JOIN public.layanan AS l ON l.id = b.layanan_grup
  GROUP BY b.layanan_grup, b.unit_grup, l.nama
  ORDER BY CASE b.unit_grup WHEN 'layanan' THEN 0 WHEN 'fo' THEN 1 ELSE 2 END, l.nama, b.layanan_grup
$$;
REVOKE ALL ON FUNCTION public.ringkasan_ikm(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringkasan_ikm(date, date) TO authenticated;

-- ============================================================
-- 5. ringkasan_spak: hanya admin/front_office
-- ============================================================
CREATE OR REPLACE FUNCTION public.ringkasan_spak(p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, unit text, nama text, responden integer, p1 numeric, p2 numeric, p3 numeric, p4 numeric, p5 numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH baris AS (
    SELECT
      CASE WHEN s.unit = 'fo' THEN 'fo' WHEN s.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END AS unit_grup,
      CASE WHEN s.unit = 'fo' THEN NULL::uuid ELSE s.layanan_id END AS layanan_grup,
      s.p1_tanpa_diskriminasi, s.p2_tanpa_kecurangan, s.p3_tanpa_imbalan, s.p4_tanpa_pungli, s.p5_tanpa_percaloan
    FROM public.spak_respons AS s
    WHERE (SELECT public.peran_saya()) IN ('admin', 'front_office')
      AND (s.created_at AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_start AND p_end
  )
  SELECT b.layanan_grup,
         b.unit_grup,
         CASE b.unit_grup
           WHEN 'fo' THEN 'Front Office'
           WHEN 'layanan' THEN l.nama
           ELSE 'Tidak terklasifikasi (data lama/impor)'
         END,
         pg_catalog.count(*)::integer,
         pg_catalog.avg(b.p1_tanpa_diskriminasi) AS p1,
         pg_catalog.avg(b.p2_tanpa_kecurangan) AS p2,
         pg_catalog.avg(b.p3_tanpa_imbalan) AS p3,
         pg_catalog.avg(b.p4_tanpa_pungli) AS p4,
         pg_catalog.avg(b.p5_tanpa_percaloan) AS p5
  FROM baris AS b
  LEFT JOIN public.layanan AS l ON l.id = b.layanan_grup
  GROUP BY b.layanan_grup, b.unit_grup, l.nama
  ORDER BY CASE b.unit_grup WHEN 'layanan' THEN 0 WHEN 'fo' THEN 1 ELSE 2 END, l.nama, b.layanan_grup
$$;
REVOKE ALL ON FUNCTION public.ringkasan_spak(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringkasan_spak(date, date) TO authenticated;

-- ============================================================
-- 6. ringkasan_response_rate: dari survei_undangan, hanya admin/front_office
-- ============================================================
CREATE OR REPLACE FUNCTION public.ringkasan_response_rate(p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, unit text, nama text, diundang integer, mengisi integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH baris AS (
    SELECT
      CASE WHEN u.unit = 'fo' THEN 'fo' WHEN u.layanan_id IS NOT NULL THEN 'layanan' ELSE 'tidak_diketahui' END AS unit_grup,
      CASE WHEN u.unit = 'fo' THEN NULL::uuid ELSE u.layanan_id END AS layanan_grup,
      (u.diisi_pada IS NOT NULL) AS terisi
    FROM public.survei_undangan AS u
    WHERE (SELECT public.peran_saya()) IN ('admin', 'front_office')
      AND (u.dibuat_pada AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_start AND p_end
  )
  SELECT b.layanan_grup,
         b.unit_grup,
         CASE b.unit_grup
           WHEN 'fo' THEN 'Front Office'
           WHEN 'layanan' THEN l.nama
           ELSE 'Tidak terklasifikasi (data lama/impor)'
         END,
         pg_catalog.count(*)::integer AS diundang,
         (pg_catalog.count(*) FILTER (WHERE b.terisi))::integer AS mengisi
  FROM baris AS b
  LEFT JOIN public.layanan AS l ON l.id = b.layanan_grup
  GROUP BY b.layanan_grup, b.unit_grup, l.nama
  ORDER BY CASE b.unit_grup WHEN 'layanan' THEN 0 WHEN 'fo' THEN 1 ELSE 2 END, l.nama, b.layanan_grup
$$;
REVOKE ALL ON FUNCTION public.ringkasan_response_rate(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringkasan_response_rate(date, date) TO authenticated;

-- ============================================================
-- 7. v_skm_petugas: kolom lama + u10/u11 di akhir (tanpa identitas)
-- ============================================================
-- View sengaja TANPA security_invoker (pola 202610090001): pemilik membaca tabel, baris disaring boleh_layanan() terhadap
-- pemanggil. Hanya kolom non-identitas.
CREATE OR REPLACE VIEW public.v_skm_petugas AS
SELECT s.layanan_id, s.u1_persyaratan, s.u2_prosedur, s.u3_waktu, s.u4_biaya, s.u5_produk,
       s.u6_kompetensi, s.u7_perilaku, s.u8_sarana, s.u9_pengaduan, s.saran, s.created_at,
       s.u10_transparansi, s.u11_integritas
FROM public.skm_respons AS s
WHERE public.peran_saya() = 'petugas' AND public.boleh_layanan(s.layanan_id);
REVOKE ALL ON public.v_skm_petugas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_skm_petugas TO authenticated;

-- ============================================================
-- 8. Komentar objek baru
-- ============================================================
COMMENT ON TABLE public.spak_respons IS
  'Jawaban SPAK survei terpadu (migrasi 202610270002): 5 butir, nilai 1-6 (6 = Sangat Setuju). Baca hanya admin/front_office; tanpa tulis langsung dari klien.';
COMMENT ON FUNCTION public.ringkasan_ikm(date, date) IS
  'IKM per layanan, Front Office, dan tidak terklasifikasi (periode tanggal WIB). Admin, front_office, petugas; selain itu kosong.';
COMMENT ON FUNCTION public.ringkasan_spak(date, date) IS
  'Rata-rata SPAK p1..p5 per layanan, Front Office, dan tidak terklasifikasi (periode tanggal WIB). Hanya admin/front_office; selain itu kosong.';
COMMENT ON FUNCTION public.ringkasan_response_rate(date, date) IS
  'Response rate survei dari survei_undangan: diundang (dibuat_pada dalam periode WIB) dan mengisi (diisi_pada terisi), per layanan dan Front Office. Hanya admin/front_office.';
