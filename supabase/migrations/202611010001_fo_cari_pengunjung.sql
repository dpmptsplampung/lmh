-- 202611010001_fo_cari_pengunjung.sql
-- Fase 6 (spec docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md §9; rencana
-- docs/superpowers/plans/2026-11-01-fase-6-cari-pengunjung.md). Forward-only, ADITIF terhadap data (B1): hanya fungsi
-- baru dan dua indeks baru. Tidak ada DELETE/TRUNCATE/DROP TABLE/DROP COLUMN, tidak ada UPDATE nilai lama. Tidak ada
-- ekstensi baru (pg_trgm sudah ada sejak 202609230002; migrasi ini hanya memeriksanya).
--
-- MASALAH
--   Sejak Fase 3 (202610290001) Front Office biasa hanya membaca kunjungan dalam jendela operasional + yang ia tangani,
--   sehingga bantuan "pengunjung lama" di formulir walk-in (membaca tabel kunjungan langsung) mengecil. Fase 6 menggantinya
--   dengan pencarian TERKENDALI lewat RPC, tanpa melonggarkan RLS.
--
-- ISI
--   1. hp_normal(text): bentuk kanonik nomor HP untuk pencarian (digit saja; awalan 62 -> 0). IMMUTABLE (dipakai indeks).
--   2. Indeks trigram: nama (ILIKE '%q%') dan hp_normal(kontak_hp) (LIKE '%q%') pada kunjungan.
--   3. fo_cari_pengunjung(p_q): hanya FO/admin AKTIF dengan sesi sah. Minimal 3 karakter (nama) atau 3 digit (HP) DI
--      SERVER; selebihnya mengembalikan 0 baris. Paling banyak 5 orang (satu baris per orang: kunjungan terkininya), berisi
--      id kunjungan (opak), nama, HP DISAMARKAN (0812****789), asal instansi, tanggal kunjungan terakhir (WIB). Tidak
--      pernah mengembalikan HP penuh/email.
--   4. fo_ambil_pengunjung(p_id): identitas penuh SATU kunjungan terpilih (nama, asal, kategori, email, HP) untuk mengisi
--      formulir. Hanya FO/admin aktif; dicatat di audit_log (aksi fo_ambil_pengunjung; detail hanya id kunjungan, tanpa PII)
--      dan dibatasi 60 pengambilan per 10 menit per akun (RATE_LIMIT) agar tidak bisa dipakai menyedot data.
--   Data TERANONIMKAN tidak muncul: nama '[anonim]', asal_instansi kosong (kebijakan PDP: anonimisasi 730 hari), dan sebagai
--   sabuk pengaman kunjungan bertanggal lebih dari 730 hari (WIB) dikecualikan walau pekerjaan anonimisasi terlambat.
--
-- KODE GALAT RPC (awal pesan): FORBIDDEN, SESI_TIDAK_SAH, NOT_FOUND, RATE_LIMIT.
-- SYARAT / URUTAN: setelah 202610290001 (staf_lingkup), 202609230002 (pg_trgm), dan 202610310002 (migrasi terakhir sebelum ini).
-- PENERAPAN (pemilik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202611010001_fo_cari_pengunjung.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202611010001_fo_cari_pengunjung.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi ini (kolom pencarian disembunyikan bila RPC belum ada).
-- ROLLBACK: docs/rollback-fo-cari-pengunjung-202611010001.sql (hanya DROP objek baru milik migrasi ini).
-- Idempoten.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290001_koordinator_akses_data belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140001_sesi_staf belum diterapkan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'PRASYARAT: ekstensi pg_trgm belum ada (202609230002_faq_fts)';
  END IF;
  IF pg_catalog.to_regclass('public.kunjungan') IS NULL OR pg_catalog.to_regclass('public.audit_log') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel kunjungan/audit_log belum ada';
  END IF;
END $$;

-- ============================================================
-- 1. Nomor HP kanonik untuk pencarian
-- ============================================================
CREATE OR REPLACE FUNCTION public.hp_normal(p_hp text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
           WHEN x.d IS NULL OR x.d = '' THEN NULL
           WHEN x.d LIKE '62%' THEN '0' || pg_catalog.substr(x.d, 3)
           ELSE x.d
         END
  FROM (SELECT pg_catalog.regexp_replace(p_hp, '\D', '', 'g') AS d) AS x
$$;

REVOKE ALL ON FUNCTION public.hp_normal(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hp_normal(text) TO authenticated, service_role;

-- ============================================================
-- 2. Indeks pencarian (trigram)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_kunjungan_nama_trgm
  ON public.kunjungan USING gin (nama gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_kunjungan_hp_trgm
  ON public.kunjungan USING gin ((public.hp_normal(kontak_hp)) gin_trgm_ops);

-- ============================================================
-- 3. fo_cari_pengunjung
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_cari_pengunjung(p_q text)
RETURNS TABLE (id uuid, nama text, hp_samar text, asal_instansi text, tanggal date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   text;
  v_q      text := pg_catalog.btrim(COALESCE(p_q, ''));
  v_qd     text;
  v_pola   text;
  v_batas  date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 730;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Front Office atau Admin aktif' USING ERRCODE = '42501';
  END IF;

  IF v_q ~ '^[0-9+()\s-]+$' THEN
    -- Mode nomor HP: minimal 3 digit (setelah dikanonkan).
    v_qd := public.hp_normal(v_q);
    IF v_qd IS NULL OR pg_catalog.length(v_qd) < 3 THEN
      RETURN;
    END IF;
    RETURN QUERY
    WITH kandidat AS (
      SELECT k.id AS kid, k.nama AS knama, public.hp_normal(k.kontak_hp) AS hp, k.asal_instansi AS kasal,
             k.tanggal AS ktgl, k.created_at AS kdibuat
      FROM public.kunjungan AS k
      WHERE public.hp_normal(k.kontak_hp) LIKE '%' || v_qd || '%'
        AND k.nama <> '[anonim]'
        AND k.asal_instansi IS NOT NULL AND pg_catalog.btrim(k.asal_instansi) <> ''
        AND k.tanggal >= v_batas
      ORDER BY k.tanggal DESC, k.created_at DESC
      LIMIT 300
    ), terakhir AS (
      SELECT DISTINCT ON (c.hp) c.*
      FROM kandidat AS c
      ORDER BY c.hp, c.ktgl DESC, c.kdibuat DESC
    )
    SELECT t.kid, t.knama,
           CASE WHEN pg_catalog.length(t.hp) >= 9
                THEN pg_catalog.left(t.hp, 4) || '****' || pg_catalog.right(t.hp, 3)
                ELSE '****' || pg_catalog.right(t.hp, 2) END,
           t.kasal, t.ktgl
    FROM terakhir AS t
    ORDER BY t.ktgl DESC, t.knama
    LIMIT 5;
  ELSE
    -- Mode nama: minimal 3 karakter. Pembungkus LIKE (% _ \) dinetralkan.
    IF pg_catalog.length(v_q) < 3 THEN
      RETURN;
    END IF;
    v_pola := pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_q, '\', '\\'), '%', '\%'), '_', '\_');
    RETURN QUERY
    WITH kandidat AS (
      SELECT k.id AS kid, k.nama AS knama, public.hp_normal(k.kontak_hp) AS hp, k.asal_instansi AS kasal,
             k.tanggal AS ktgl, k.created_at AS kdibuat,
             COALESCE(public.hp_normal(k.kontak_hp),
                      pg_catalog.lower(pg_catalog.btrim(k.nama)) || '|' || pg_catalog.lower(pg_catalog.btrim(k.asal_instansi))) AS kunci
      FROM public.kunjungan AS k
      WHERE k.nama ILIKE '%' || v_pola || '%'
        AND k.nama <> '[anonim]'
        AND k.asal_instansi IS NOT NULL AND pg_catalog.btrim(k.asal_instansi) <> ''
        AND k.tanggal >= v_batas
      ORDER BY k.tanggal DESC, k.created_at DESC
      LIMIT 300
    ), terakhir AS (
      SELECT DISTINCT ON (c.kunci) c.*
      FROM kandidat AS c
      ORDER BY c.kunci, c.ktgl DESC, c.kdibuat DESC
    )
    SELECT t.kid, t.knama,
           CASE WHEN t.hp IS NULL THEN NULL
                WHEN pg_catalog.length(t.hp) >= 9
                THEN pg_catalog.left(t.hp, 4) || '****' || pg_catalog.right(t.hp, 3)
                ELSE '****' || pg_catalog.right(t.hp, 2) END,
           t.kasal, t.ktgl
    FROM terakhir AS t
    ORDER BY t.ktgl DESC, t.knama
    LIMIT 5;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.fo_cari_pengunjung(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_cari_pengunjung(text) TO authenticated;

-- ============================================================
-- 4. fo_ambil_pengunjung
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_ambil_pengunjung(p_id uuid)
RETURNS TABLE (nama text, asal_instansi text, kategori text, email text, kontak_hp text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   text;
  v_batas  date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 730;
  v_jumlah int;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Front Office atau Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  SELECT pg_catalog.count(*) INTO v_jumlah
  FROM public.audit_log AS a
  WHERE a.actor_id = auth.uid() AND a.aksi = 'fo_ambil_pengunjung'
    AND a.created_at > pg_catalog.now() - INTERVAL '10 minutes';
  IF v_jumlah >= 60 THEN
    RAISE EXCEPTION 'RATE_LIMIT: terlalu banyak pengambilan data pengunjung; coba lagi beberapa menit lagi' USING ERRCODE = '54000';
  END IF;

  RETURN QUERY
  SELECT k.nama, k.asal_instansi, k.kategori, k.email, k.kontak_hp
  FROM public.kunjungan AS k
  WHERE k.id = p_id
    AND k.nama <> '[anonim]'
    AND k.asal_instansi IS NOT NULL AND pg_catalog.btrim(k.asal_instansi) <> ''
    AND k.tanggal >= v_batas;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (
    auth.uid(), v_role, 'fo_ambil_pengunjung', 'kunjungan', p_id::text,
    pg_catalog.jsonb_build_object('kunjungan_id', p_id)
  );
END $$;

REVOKE ALL ON FUNCTION public.fo_ambil_pengunjung(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_ambil_pengunjung(uuid) TO authenticated;

COMMENT ON FUNCTION public.fo_cari_pengunjung(text) IS
  'Fase 6 (202611010001): pencarian pengunjung lama untuk FO/admin; maks 5 baris, HP disamarkan, tanpa data teranonimkan.';
COMMENT ON FUNCTION public.fo_ambil_pengunjung(uuid) IS
  'Fase 6 (202611010001): identitas penuh satu kunjungan terpilih untuk mengisi formulir; FO/admin; diaudit dan dibatasi 60/10 menit.';
