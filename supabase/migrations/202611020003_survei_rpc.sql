-- 202611020003_survei_rpc.sql
-- SURVEI TERPADU FASE A, langkah 3 (spec: docs/superpowers/specs/2026-10-26-survei-terpadu-design.md §5, §6, §12):
-- dua RPC PUBLIK yang boleh dipanggil anon dengan sekadar memegang token undangan (QR). Inilah SATU-SATUNYA jalur tulis jawaban
-- survei terpadu (tidak ada tulis langsung dari klien ke skm_respons/spak_respons/survei_undangan; tabelnya tertutup untuk klien).
-- Karena siapa pun di internet yang memegang token bisa memanggilnya, kedua fungsi tidak pernah membocorkan identitas, tidak
-- pernah melempar galat untuk kegagalan yang wajar (selalu mengembalikan nilai), dan menyerahkan jam sepenuhnya ke database.
--
-- ISI (semua ADITIF: hanya dua fungsi baru; tanpa tabel/kolom/policy/trigger baru dan tanpa DML pada data yang ada):
--   1. get_survei_context(p_token text) -> jsonb {status, unit, layanan_nama, kedaluwarsa_pada}. Hanya MEMBACA. status:
--      'tidak_valid' (tidak ada undangan dengan token itu, termasuk token NULL/kosong/pendek; unit, layanan_nama, dan
--      kedaluwarsa_pada semuanya null), 'sudah_diisi' (diisi_pada terisi; menang atas kedaluwarsa), 'kedaluwarsa'
--      (now() >= kedaluwarsa_pada: TEPAT di batas sudah kedaluwarsa), selain itu 'ok'. Hanya empat kunci itu yang dikembalikan:
--      tanpa id kunjungan/undangan/layanan, tanpa token, tanpa nama/HP/email pengunjung (sumber identitas tidak disentuh).
--      layanan_nama dari tabel layanan (null untuk unit 'fo'). Fase B menambah bisa_saran/bisa_pengaduan di fungsi yang sama.
--   2. kirim_survei(p_token text, p_spak jsonb, p_skm jsonb) -> text, SATU transaksi, selalu mengembalikan salah satu dari
--      'submitted' | 'invalid' | 'expired' | 'duplicate' | 'not_found' (tanpa RAISE untuk kegagalan yang wajar). Urutan:
--        a. VALIDASI PAYLOAD -> 'invalid' (sebelum menyentuh tabel apa pun; mengalahkan token yang tidak ada/kedaluwarsa):
--           token tidak NULL dan >= 16 karakter; p_spak dan p_skm keduanya objek JSON; kunci p_spak PERSIS p1..p5 dan p_skm
--           PERSIS u1..u11 (jumlah kunci sama dengan yang diharapkan, dan tiap kunci yang diharapkan ada: kunci asing atau
--           kurang ditolak, termasuk payload SKM 9 unsur gaya lama); tiap nilai bertipe JSON number, bilangan bulat, SPAK
--           1-6 dan SKM 1-4 (rentang sama dengan CHECK tabel di 0002 dan baseline).
--        b. SELECT ... FROM survei_undangan WHERE token = p_token FOR UPDATE (mengunci baris undangan) -> 'not_found'.
--        c. diisi_pada terisi -> 'duplicate'.   d. now() >= kedaluwarsa_pada -> 'expired'.
--        e. kunjungan.status <> 'selesai' (mis. dibuka lagi) atau kunjungan tak ada -> 'invalid'.
--        f. INSERT spak_respons, INSERT skm_respons (sumber 'wizard'; SKM versi 2; unit, layanan_id, kunjungan_id dari
--           undangan), UPDATE survei_undangan SET diisi_pada = now(), semuanya dalam SATU blok BEGIN ... EXCEPTION; pelanggaran
--           unik (jawaban lain untuk kunjungan itu sudah ada) -> 'duplicate'. Hasil akhir 'submitted'.
--      ATOMIK: tubuh fungsi plpgsql adalah satu transaksi (satu pernyataan dari klien); blok EXCEPTION adalah subtransaksi,
--      jadi saat unique_violation, INSERT yang sudah jalan (mis. SPAK) ikut dibatalkan dan tidak ada baris tertinggal di
--      kedua tabel. Galat lain (kegagalan tak terduga) tidak ditangkap: seluruh pernyataan dibatalkan dan galat sampai ke
--      pemanggil, tetap tanpa baris setengah jadi. Tidak ada WHEN OTHERS (menelan galat akan menyamarkan kerusakan).
--      KIRIMAN GANDA/BERSAMAAN: FOR UPDATE menyerialkan dua kiriman pada undangan yang sama. Pada READ COMMITTED (bawaan
--      Supabase) kiriman kedua menunggu, lalu membaca versi baris terbaru yang sudah berdiri diisi_pada, jadi 'duplicate'.
--      Pertahanan berlapis bila pemeriksaan itu terlewat: indeks unik kunjungan_id pada spak_respons dan skm_respons -> 'duplicate'
--      lewat unique_violation. Kasus tepi yang diketahui: bila kunjungan itu SUDAH punya jawaban dari jalur lain (form SKM lama,
--      impor) sedangkan undangannya belum diisi, kirim_survei mengembalikan 'duplicate' tanpa menandai diisi_pada; get_survei_context
--      tetap 'ok' sampai itu (antarmuka cukup memperlakukan 'duplicate' sebagai "sudah terisi").
--      JAM: hanya now() database (waktu mulai transaksi), tidak ada parameter waktu. Pembanding kedaluwarsa now() >= kedaluwarsa_pada
--      sama dengan ambil_qr_survei (0001) dan v_survei_status: TEPAT di batas = kedaluwarsa (keputusan R8; Review Focus 2).
--      BENTUK ANGKA (keputusan, diuji): nilai dinilai SECARA MATEMATIS sebagai bilangan bulat, jadi 3.0, 1e0, 6.00, dan 0.5e1
--      DITERIMA dan disimpan sebagai 3, 1, 6, 5 (konversi aman: lewat numeric SETELAH tipe, bilangan bulat, dan rentang terbukti,
--      sehingga cast tidak bisa melempar galat; ::smallint langsung dari teks "3.0" justru galat). 3.5, 2.9999999999999999999
--      (numerik presisi penuh, bukan pembulatan JavaScript), "3" (string), true, null, [3], {"a":3}, kunci hilang, 0, 7 (SPAK
--      di atas 6), 5 (SKM di atas 4), dan 1e1000 semuanya 'invalid'. JSON.stringify klien tidak pernah menghasilkan 3.0, jadi
--      ini tidak berpengaruh pada klien sah; yang dijaga hanya bahwa tidak ada nilai di luar rentang yang bisa tersimpan.
--      Angka yang tak bisa dipecah oleh parser jsonb (mis. eksponen melebihi batas numeric) ditolak PostgreSQL SEBELUM fungsi
--      berjalan, di lapisan route (zod, Task 8) dan PostgREST, bukan oleh fungsi ini.
--   Kedua fungsi SECURITY DEFINER (pemilik postgres melewati RLS tabel tertutup) dengan SET search_path = pg_catalog, public
--   dan semua fungsi bawaan dikualifikasi pg_catalog. REVOKE ALL dari PUBLIC, anon, authenticated lalu GRANT EXECUTE hanya ke
--   anon dan authenticated (service_role mempertahankan hak bawaan Supabase). Keduanya sengaja VOLATILE (bukan STABLE):
--   PostgREST hanya mengekspos fungsi STABLE/IMMUTABLE lewat GET, dan token tidak boleh masuk query string atau log akses;
--   VOLATILE memaksa POST (isi permintaan).
--   Batasan laju untuk anon: tidak ada di Fase A; mengandalkan token yang tidak tertebak (244 bit) dan satu kiriman per undangan
--   (spec §5). Fase B menambahkan pembatasan laju berbasis IP di route.
--
-- SYARAT: survei_undangan (202611020001), spak_respons dan kolom 11 unsur/versi/sumber/unit skm_respons beserta constraint wizard
--   (202611020002), layanan dan kunjungan; dijaga blok PRASYARAT di bawah.
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO; migrasi ini DITULIS tetapi BELUM DITERAPKAN):
--   node scripts/apply-migration.mjs supabase/migrations/202611020003_survei_rpc.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202611020003_survei_rpc.sql --atomic
-- Idempoten (CREATE OR REPLACE; REVOKE/GRANT ulang): menerapkan ulang tidak mengubah data.
-- ROLLBACK: docs/rollback-survei-rpc-202611020003.sql (hanya menghapus kedua fungsi; jawaban yang sudah tersimpan TIDAK dihapus;
--   SETELAH rollback 202611020004, SEBELUM rollback 202611020002 dan 202611020001).
-- UJI PERILAKU: scripts/lokal/skenario-survei-rpc.mjs (PGlite lokal, tanpa DB nyata). Kontrak statis:
--   supabase/migrations/survei_rpc.test.ts.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
DECLARE
  v_kurang text;
BEGIN
  IF pg_catalog.to_regclass('public.kunjungan') IS NULL OR pg_catalog.to_regclass('public.layanan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel kunjungan/layanan belum ada (202607290013_kunjungan_tiket)';
  END IF;
  IF pg_catalog.to_regclass('public.survei_undangan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel survei_undangan belum ada (202611020001_survei_undangan)';
  END IF;
  IF pg_catalog.to_regclass('public.spak_respons') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel spak_respons belum ada (202611020002_survei_jawaban)';
  END IF;
  IF pg_catalog.to_regclass('public.skm_respons') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel skm_respons belum ada (202607140003_domain_schema)';
  END IF;

  -- Kolom yang ditulis kirim_survei (semua dari 202611020002 kecuali yang baseline).
  SELECT pg_catalog.string_agg(c.tabel || '.' || c.kolom, ', ') INTO v_kurang
  FROM (VALUES
    ('skm_respons', 'kunjungan_id'), ('skm_respons', 'layanan_id'), ('skm_respons', 'unit'), ('skm_respons', 'sumber'),
    ('skm_respons', 'versi'), ('skm_respons', 'u1_persyaratan'), ('skm_respons', 'u9_pengaduan'),
    ('skm_respons', 'u10_transparansi'), ('skm_respons', 'u11_integritas'),
    ('spak_respons', 'kunjungan_id'), ('spak_respons', 'layanan_id'), ('spak_respons', 'unit'), ('spak_respons', 'sumber'),
    ('spak_respons', 'p1_tanpa_diskriminasi'), ('spak_respons', 'p5_tanpa_percaloan'),
    ('survei_undangan', 'token'), ('survei_undangan', 'unit'), ('survei_undangan', 'layanan_id'),
    ('survei_undangan', 'kedaluwarsa_pada'), ('survei_undangan', 'diisi_pada')
  ) AS c (tabel, kolom)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.to_regclass('public.' || c.tabel) AND a.attname = c.kolom AND NOT a.attisdropped
  );
  IF v_kurang IS NOT NULL THEN
    RAISE EXCEPTION 'PRASYARAT: kolom belum ada (202611020001_survei_undangan / 202611020002_survei_jawaban): %', v_kurang;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS k
    WHERE k.conrelid = pg_catalog.to_regclass('public.skm_respons') AND k.conname = 'skm_respons_wizard_kunjungan_versi_check'
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: constraint skm_respons_wizard_kunjungan_versi_check belum ada (202611020002_survei_jawaban)';
  END IF;
END $$;

-- ============================================================
-- 1. get_survei_context: status undangan untuk wizard (tanpa identitas)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_survei_context(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u       public.survei_undangan%ROWTYPE;
  v_layanan text;
  v_status  text;
BEGIN
  -- Token NULL tidak pernah sama dengan apa pun (NULL = token tidak menghasilkan baris), jadi jatuh ke tidak_valid.
  SELECT * INTO v_u
  FROM public.survei_undangan AS u
  WHERE u.token = p_token;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'tidak_valid',
      'unit', NULL::text,
      'layanan_nama', NULL::text,
      'kedaluwarsa_pada', NULL::timestamptz
    );
  END IF;

  v_status := CASE
    WHEN v_u.diisi_pada IS NOT NULL THEN 'sudah_diisi'
    WHEN pg_catalog.now() >= v_u.kedaluwarsa_pada THEN 'kedaluwarsa'
    ELSE 'ok'
  END;

  SELECT l.nama INTO v_layanan FROM public.layanan AS l WHERE l.id = v_u.layanan_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'unit', v_u.unit,
    'layanan_nama', v_layanan,
    'kedaluwarsa_pada', v_u.kedaluwarsa_pada
  );
END $$;

REVOKE ALL ON FUNCTION public.get_survei_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_survei_context(text) TO anon, authenticated;

-- ============================================================
-- 2. kirim_survei: satu-satunya jalur tulis jawaban survei (atomik)
-- ============================================================
CREATE OR REPLACE FUNCTION public.kirim_survei(p_token text, p_spak jsonb, p_skm jsonb)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  c_kunci_spak CONSTANT text[] := ARRAY['p1', 'p2', 'p3', 'p4', 'p5'];
  c_kunci_skm  CONSTANT text[] := ARRAY['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8', 'u9', 'u10', 'u11'];
  c_spak_min   CONSTANT numeric := 1;
  c_spak_maks  CONSTANT numeric := 6;
  c_skm_min    CONSTANT numeric := 1;
  c_skm_maks   CONSTANT numeric := 4;
  v_kunci  text;
  v_angka  numeric;
  v_u      public.survei_undangan%ROWTYPE;
  v_status text;
BEGIN
  -- a. Validasi payload (sebelum menyentuh tabel). Bentuk dulu, supaya jsonb_object_keys tidak pernah dipanggil pada non-objek.
  IF p_token IS NULL OR pg_catalog.length(p_token) < 16
     OR p_spak IS NULL OR pg_catalog.jsonb_typeof(p_spak) IS DISTINCT FROM 'object'
     OR p_skm IS NULL OR pg_catalog.jsonb_typeof(p_skm) IS DISTINCT FROM 'object' THEN
    RETURN 'invalid';
  END IF;

  -- Jumlah kunci = jumlah yang diharapkan; bersama pemeriksaan "tiap kunci yang diharapkan ada" di bawah, ini menolak kunci asing.
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_spak)) <> pg_catalog.cardinality(c_kunci_spak)
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_skm)) <> pg_catalog.cardinality(c_kunci_skm) THEN
    RETURN 'invalid';
  END IF;

  -- Tiap kunci: ada dan bertipe number (kunci hilang menghasilkan NULL, string/boolean/null/array/objek bukan number), lalu bilangan
  -- bulat, lalu dalam rentang. Cast ke numeric aman karena tipe sudah terbukti number.
  FOREACH v_kunci IN ARRAY c_kunci_spak LOOP
    IF pg_catalog.jsonb_typeof(p_spak -> v_kunci) IS DISTINCT FROM 'number' THEN RETURN 'invalid'; END IF;
    v_angka := (p_spak ->> v_kunci)::numeric;
    IF v_angka <> pg_catalog.trunc(v_angka) OR v_angka < c_spak_min OR v_angka > c_spak_maks THEN RETURN 'invalid'; END IF;
  END LOOP;

  FOREACH v_kunci IN ARRAY c_kunci_skm LOOP
    IF pg_catalog.jsonb_typeof(p_skm -> v_kunci) IS DISTINCT FROM 'number' THEN RETURN 'invalid'; END IF;
    v_angka := (p_skm ->> v_kunci)::numeric;
    IF v_angka <> pg_catalog.trunc(v_angka) OR v_angka < c_skm_min OR v_angka > c_skm_maks THEN RETURN 'invalid'; END IF;
  END LOOP;

  -- b. Kunci baris undangan: kiriman bersamaan pada undangan yang sama menunggu di sini, lalu melihat diisi_pada terbaru.
  SELECT * INTO v_u
  FROM public.survei_undangan AS u
  WHERE u.token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  -- c. Sudah diisi menang atas kedaluwarsa (konsisten dengan get_survei_context dan ambil_qr_survei).
  IF v_u.diisi_pada IS NOT NULL THEN RETURN 'duplicate'; END IF;
  -- d. Jam dari database; TEPAT di batas sudah kedaluwarsa (R8).
  IF pg_catalog.now() >= v_u.kedaluwarsa_pada THEN RETURN 'expired'; END IF;

  -- e. Kunjungan yang dibuka lagi setelah undangan terbit tidak boleh dinilai.
  SELECT k.status INTO v_status FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'selesai' THEN RETURN 'invalid'; END IF;

  -- f. Tulis. Satu blok = satu subtransaksi: unique_violation membatalkan semua yang sudah ditulis di dalamnya.
  BEGIN
    INSERT INTO public.spak_respons (
      kunjungan_id, layanan_id, unit, sumber,
      p1_tanpa_diskriminasi, p2_tanpa_kecurangan, p3_tanpa_imbalan, p4_tanpa_pungli, p5_tanpa_percaloan
    ) VALUES (
      v_u.kunjungan_id, v_u.layanan_id, v_u.unit, 'wizard',
      ((p_spak ->> 'p1')::numeric)::smallint,
      ((p_spak ->> 'p2')::numeric)::smallint,
      ((p_spak ->> 'p3')::numeric)::smallint,
      ((p_spak ->> 'p4')::numeric)::smallint,
      ((p_spak ->> 'p5')::numeric)::smallint
    );

    INSERT INTO public.skm_respons (
      kunjungan_id, layanan_id, unit, sumber, versi,
      u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk, u6_kompetensi,
      u7_perilaku, u8_sarana, u9_pengaduan, u10_transparansi, u11_integritas
    ) VALUES (
      v_u.kunjungan_id, v_u.layanan_id, v_u.unit, 'wizard', 2,
      ((p_skm ->> 'u1')::numeric)::smallint,
      ((p_skm ->> 'u2')::numeric)::smallint,
      ((p_skm ->> 'u3')::numeric)::smallint,
      ((p_skm ->> 'u4')::numeric)::smallint,
      ((p_skm ->> 'u5')::numeric)::smallint,
      ((p_skm ->> 'u6')::numeric)::smallint,
      ((p_skm ->> 'u7')::numeric)::smallint,
      ((p_skm ->> 'u8')::numeric)::smallint,
      ((p_skm ->> 'u9')::numeric)::smallint,
      ((p_skm ->> 'u10')::numeric)::smallint,
      ((p_skm ->> 'u11')::numeric)::smallint
    );

    UPDATE public.survei_undangan
    SET diisi_pada = pg_catalog.now()
    WHERE id = v_u.id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'duplicate';
  END;

  RETURN 'submitted';
END $$;

REVOKE ALL ON FUNCTION public.kirim_survei(text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_survei(text, jsonb, jsonb) TO anon, authenticated;

-- ============================================================
-- 3. Komentar (penanda untuk migrasi dan penjaga rollback berikutnya)
-- ============================================================
COMMENT ON FUNCTION public.get_survei_context(text) IS
  'Status undangan survei untuk wizard anonim (tidak_valid/sudah_diisi/kedaluwarsa/ok) beserta unit, nama layanan, dan batas waktu; tanpa identitas. Migrasi 202611020003.';
COMMENT ON FUNCTION public.kirim_survei(text, jsonb, jsonb) IS
  'Satu-satunya jalur tulis jawaban survei terpadu (SPAK+SKM), atomik; hasil submitted/invalid/expired/duplicate/not_found, jam dari database. Migrasi 202611020003.';
