-- 202610290002_rekap_terpadu.sql
-- Fase 3 (spec §6.3; rencana docs/superpowers/plans/2026-10-29-fase-3-koordinator-rekap.md Task 2): sumber tunggal
-- Rekap terpadu. Hanya MENAMBAH fungsi baca (tidak ada tabel/kolom/policy baru; tidak mengubah data, B1).
--
-- SATU DEFINISI "DILAYANI" (dipakai semua angka, satu fungsi dasar rekap_pelayanan_inti):
--   - tahap penanganan berstatus 'selesai', KECUALI tahap Layanan berhasil 'dikembalikan' (pengunjung dikembalikan ke FO,
--     belum dilayani Layanan). Tahap FO 'dieskalasi' tetap dihitung untuk unit Front Office. Tanggal = kunjungan.tanggal
--     (WIB);
--   - tiket lama tanpa tahap penanganan: tiket_antrean.status = 'selesai' DAN waktu_selesai terisi (tiket yang ditutup
--     otomatis tanpa waktu selesai tidak dihitung) DAN Pendataan (bila ada) bukan draf;
--   - batal, menunggu, berjalan, draf TIDAK dihitung.
--   Unit: 'fo' (Front Office) atau 'layanan'. Kanal: saluran 'chat' -> 'live_chat', selain itu 'tatap_muka' (kunjungan chat
--   yang diambil langsung petugas tidak punya tahap FO, sehingga hanya masuk unit Layanannya dengan kanal live_chat).
--
-- LINGKUP (KETAT, tanpa jendela operasional; sama dengan boleh_data_pelayanan 202610290001):
--   admin semua; FO+Koordinator semua; Petugas+Koordinator unit 'layanan' di layanannya; selain itu penangan = dirinya.
--   Bukan staf aktif -> kosong. Predikat lingkup + unit + layanan + tanggal diterapkan DI DALAM tiap cabang dasar sebelum
--   join detail (kinerja).
--
-- FUNGSI:
--   rekap_pelayanan_inti(...)  internal (tanpa GRANT ke klien): baris ringan tanpa PII/jsonb.
--   lingkup_data_saya()        jsonb identitas lingkup pemanggil.
--   rekap_data_pelayanan(...)  jsonb {total, rows, berikut}: satu halaman (maks 1000) + detail PII/Pendataan; paging
--                              offset (tabel) atau keyset `p_setelah` {tanggal, urut, id} (ekspor). Tidak pernah memotong
--                              diam-diam: `berikut` terisi bila masih ada halaman.
--   rekap_harian_terpadu(...)  jsonb {rows, ringkasan}: agregat SQL (satu nilai, tidak terkena batas baris PostgREST).
--   rekap_kinerja_petugas(...) jsonb {rows}: agregat SQL per penangan per unit.
--   Galat: RENTANG_TIDAK_VALID (22023; maksimal 366 hari inklusif, sama dengan aplikasi), UNIT_TIDAK_VALID (22023).
-- SYARAT: 202610290001 (staf_lingkup, petugas.koordinator). URUTAN: 202610290001 -> 202610290002.
-- PENERAPAN (pemilik; atomik; dry-run dulu; deploy + migrasi dalam SATU jendela):
--   node scripts/apply-migration.mjs supabase/migrations/202610290002_rekap_terpadu.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610290002_rekap_terpadu.sql --atomic
-- Rollback: docs/rollback-rekap-terpadu-202610290002.sql. Idempoten.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290001_koordinator_akses_data belum diterapkan';
  END IF;
END $$;

-- ============================================================
-- 1. Lingkup pemanggil (untuk label halaman Rekap)
-- ============================================================
CREATE OR REPLACE FUNCTION public.lingkup_data_saya()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.jsonb_build_object(
    'petugas_id', me.id, 'role', me.role, 'koordinator', me.koordinator,
    'layanan_id', me.layanan_id, 'layanan_nama', l.nama
  )
  FROM public.staf_lingkup() AS me
  LEFT JOIN public.layanan AS l ON l.id = me.layanan_id
$$;

-- ============================================================
-- 2. Dasar: satu baris ringan per pelayanan dilayani dalam lingkup pemanggil
-- ============================================================
CREATE OR REPLACE FUNCTION public.rekap_pelayanan_inti(
  p_dari       date,
  p_sampai     date,
  p_unit       text,
  p_layanan_id uuid
)
RETURNS TABLE (
  pelayanan_id uuid,
  sumber       text,
  tanggal      date,
  urut         timestamptz,
  kunjungan_id uuid,
  tiket_id     uuid,
  tahap_ke     integer,
  unit         text,
  layanan_id   uuid,
  kanal        text,
  penangan_id  uuid,
  hasil        text,
  topik        text,
  catatan      text,
  mulai_at     timestamptz,
  selesai_at   timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
#variable_conflict use_column
DECLARE
  v_id       uuid;
  v_role     text;
  v_layanan  uuid;
  v_koord    boolean;
  v_semua    boolean;
  v_unit_lyn uuid;
BEGIN
  IF p_dari IS NULL OR p_sampai IS NULL OR p_sampai < p_dari OR p_sampai - p_dari >= 366 THEN
    RAISE EXCEPTION 'RENTANG_TIDAK_VALID: rentang tanggal wajib diisi, urut, dan paling lama 366 hari'
      USING ERRCODE = '22023';
  END IF;
  IF p_unit IS NOT NULL AND p_unit NOT IN ('fo', 'layanan') THEN
    RAISE EXCEPTION 'UNIT_TIDAK_VALID: unit harus fo atau layanan' USING ERRCODE = '22023';
  END IF;
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN;
  END IF;
  -- Lingkup ketat (§6.1): admin dan FO+Koordinator semua; Petugas+Koordinator unit layanannya; selain itu milik sendiri.
  v_semua := v_role = 'admin' OR (v_role = 'front_office' AND v_koord);
  v_unit_lyn := CASE WHEN v_role = 'petugas' AND v_koord THEN v_layanan END;

  RETURN QUERY
  -- A. Tahap penanganan selesai (alur Front Office -> eskalasi, chat).
  SELECT p.id, 'penanganan'::text, k.tanggal, COALESCE(p.mulai_at, p.selesai_at), p.kunjungan_id, p.tiket_id,
         p.tahap_ke, p.peran_tahap, p.layanan_id,
         CASE WHEN p.saluran = 'chat' THEN 'live_chat' ELSE 'tatap_muka' END,
         p.penangan_id, p.hasil, p.topik, p.catatan, p.mulai_at, p.selesai_at
  FROM public.penanganan AS p
  JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
  WHERE p.status = 'selesai'
    AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
    AND k.tanggal BETWEEN p_dari AND p_sampai
    AND (p_unit IS NULL OR p.peran_tahap = p_unit)
    AND (p_layanan_id IS NULL OR p.layanan_id = p_layanan_id)
    AND (v_semua OR p.penangan_id = v_id
         OR (v_unit_lyn IS NOT NULL AND p.peran_tahap = 'layanan' AND p.layanan_id = v_unit_lyn))
  UNION ALL
  -- B. Tiket lama (sebelum alur penanganan) yang benar-benar diselesaikan; Pendataan draf tidak dihitung.
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
    AND COALESCE(k.tanggal, t.tanggal) BETWEEN p_dari AND p_sampai
    AND (p_unit IS NULL OR p_unit = 'layanan')
    AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
    AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)
    AND COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai'
    AND (v_semua OR COALESCE(o.petugas_id, pz.petugas_id, t.dilayani_oleh) = v_id
         OR (v_unit_lyn IS NOT NULL AND t.layanan_id = v_unit_lyn));
END $$;

-- ============================================================
-- 3. Data Pelayanan: satu halaman + detail (PII, Pendataan) hanya untuk baris halaman itu
-- ============================================================
CREATE OR REPLACE FUNCTION public.rekap_data_pelayanan(
  p_dari       date,
  p_sampai     date,
  p_unit       text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL,
  p_batas      integer DEFAULT 50,
  p_lewati     integer DEFAULT 0,
  p_setelah    jsonb DEFAULT NULL,
  p_hitung     boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batas  integer := LEAST(GREATEST(COALESCE(p_batas, 50), 1), 1000);
  v_lewati integer := GREATEST(COALESCE(p_lewati, 0), 0);
  v_s_tgl  date := (p_setelah ->> 'tanggal')::date;
  v_s_urut timestamptz := (p_setelah ->> 'urut')::timestamptz;
  v_s_id   uuid := (p_setelah ->> 'id')::uuid;
  v_total  bigint;
  v_rows   jsonb;
  v_akhir  jsonb;
BEGIN
  IF p_hitung THEN
    SELECT pg_catalog.count(*) INTO v_total FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id);
  END IF;

  WITH pilih AS (
    SELECT i.*
    FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
    WHERE v_s_id IS NULL OR (i.tanggal, i.urut, i.pelayanan_id) > (v_s_tgl, v_s_urut, v_s_id)
    ORDER BY i.tanggal, i.urut, i.pelayanan_id
    LIMIT v_batas OFFSET CASE WHEN v_s_id IS NULL THEN v_lewati ELSE 0 END
  ),
  detail AS (
    SELECT
      i.pelayanan_id, i.sumber, i.tanggal, i.urut, i.kunjungan_id, i.tiket_id, t.nomor_display AS nomor_tiket,
      i.unit, i.layanan_id, l.nama AS layanan_nama, i.kanal, i.penangan_id, pg.nama AS penangan_nama,
      CASE WHEN i.unit = 'fo' THEN pg.nama ELSE (
        SELECT pf.nama
        FROM public.penanganan AS f JOIN public.petugas AS pf ON pf.id = f.penangan_id
        WHERE f.kunjungan_id = i.kunjungan_id AND f.peran_tahap = 'fo'
          AND (i.tahap_ke IS NULL OR f.tahap_ke < i.tahap_ke)
        ORDER BY f.tahap_ke DESC
        LIMIT 1
      ) END AS fo_nama,
      i.hasil, i.topik, i.catatan, i.mulai_at, i.selesai_at,
      kj.nama AS pengunjung_nama, kj.kontak_hp AS pengunjung_hp, kj.email AS pengunjung_email,
      kj.asal_instansi AS pengunjung_instansi, kj.kategori AS pengunjung_kategori, kj.keperluan,
      CASE WHEN o.tiket_id IS NOT NULL THEN 'oss' WHEN pz.tiket_id IS NOT NULL THEN 'perizinan' END AS form_type,
      (CASE WHEN o.tiket_id IS NOT NULL THEN pg_catalog.to_jsonb(o)
            WHEN pz.tiket_id IS NOT NULL THEN pg_catalog.to_jsonb(pz) END)
        - ARRAY['id', 'tiket_id', 'kunjungan_id', 'petugas_id', 'status_draft', 'is_locked', 'created_at', 'updated_at']
        AS pendataan
    FROM pilih AS i
    LEFT JOIN public.tiket_antrean AS t ON t.id = i.tiket_id
    LEFT JOIN public.kunjungan AS kj ON kj.id = i.kunjungan_id
    LEFT JOIN public.layanan AS l ON l.id = i.layanan_id
    LEFT JOIN public.petugas AS pg ON pg.id = i.penangan_id
    LEFT JOIN public.pelayanan_oss AS o ON i.unit = 'layanan' AND o.tiket_id = i.tiket_id
    LEFT JOIN public.pelayanan_perizinan AS pz ON i.unit = 'layanan' AND pz.tiket_id = i.tiket_id
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(d) ORDER BY d.tanggal, d.urut, d.pelayanan_id), '[]'::jsonb)
    INTO v_rows
  FROM detail AS d;

  IF pg_catalog.jsonb_array_length(v_rows) = v_batas THEN
    v_akhir := pg_catalog.jsonb_build_object(
      'tanggal', v_rows -> -1 -> 'tanggal', 'urut', v_rows -> -1 -> 'urut', 'id', v_rows -> -1 -> 'pelayanan_id');
  END IF;
  RETURN pg_catalog.jsonb_build_object('total', v_total, 'rows', v_rows, 'berikut', v_akhir);
END $$;

-- ============================================================
-- 4. Rekap Harian: agregat per tanggal x unit (Front Office / Layanan) x kanal, plus ringkasan, dalam SATU nilai jsonb
-- ============================================================
CREATE OR REPLACE FUNCTION public.rekap_harian_terpadu(
  p_dari       date,
  p_sampai     date,
  p_unit       text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH dasar AS (
    SELECT i.tanggal, i.unit, i.layanan_id, i.kanal
    FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
  ),
  baris AS (
    SELECT d.tanggal, d.unit, d.layanan_id, l.nama AS layanan_nama,
           pg_catalog.count(*) FILTER (WHERE d.kanal = 'tatap_muka') AS tatap_muka,
           pg_catalog.count(*) FILTER (WHERE d.kanal = 'live_chat') AS live_chat,
           pg_catalog.count(*) AS jumlah
    FROM dasar AS d
    LEFT JOIN public.layanan AS l ON l.id = d.layanan_id
    GROUP BY d.tanggal, d.unit, d.layanan_id, l.nama
  ),
  per_unit AS (
    SELECT b.unit, b.layanan_id,
           CASE WHEN b.unit = 'fo' THEN 'Front Office' ELSE COALESCE(b.layanan_nama, '(Layanan tidak dikenal)') END AS nama,
           pg_catalog.sum(b.jumlah) AS jumlah
    FROM baris AS b
    GROUP BY b.unit, b.layanan_id, b.layanan_nama
  )
  SELECT pg_catalog.jsonb_build_object(
    'rows', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) ORDER BY b.tanggal DESC, b.unit, b.layanan_nama)
                      FROM baris AS b), '[]'::jsonb),
    'ringkasan', pg_catalog.jsonb_build_object(
      'jumlah', COALESCE((SELECT pg_catalog.sum(b.jumlah) FROM baris AS b), 0),
      'tatap_muka', COALESCE((SELECT pg_catalog.sum(b.tatap_muka) FROM baris AS b), 0),
      'live_chat', COALESCE((SELECT pg_catalog.sum(b.live_chat) FROM baris AS b), 0),
      'per_unit', COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('nama', u.nama, 'jumlah', u.jumlah)
                                                         ORDER BY u.jumlah DESC, u.nama)
                            FROM per_unit AS u), '[]'::jsonb)
    )
  )
$$;

-- ============================================================
-- 5. Kinerja Petugas: per penangan per unit, dalam SATU nilai jsonb
-- ============================================================
CREATE OR REPLACE FUNCTION public.rekap_kinerja_petugas(
  p_dari       date,
  p_sampai     date,
  p_unit       text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH agr AS (
    SELECT i.penangan_id, i.unit, i.layanan_id,
           pg_catalog.count(*) AS jumlah,
           pg_catalog.count(*) FILTER (WHERE i.kanal = 'live_chat') AS live_chat,
           pg_catalog.round((pg_catalog.avg(EXTRACT(EPOCH FROM (i.selesai_at - i.mulai_at)) / 60.0)
             FILTER (WHERE i.mulai_at IS NOT NULL AND i.selesai_at IS NOT NULL))::numeric, 1) AS rata_durasi_menit
    FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
    WHERE i.penangan_id IS NOT NULL
    GROUP BY i.penangan_id, i.unit, i.layanan_id
  )
  SELECT pg_catalog.jsonb_build_object('rows', COALESCE((
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'penangan_id', a.penangan_id, 'penangan_nama', pg.nama, 'unit', a.unit,
             'layanan_id', a.layanan_id, 'layanan_nama', l.nama, 'jumlah', a.jumlah,
             'live_chat', a.live_chat, 'rata_durasi_menit', a.rata_durasi_menit)
           ORDER BY a.jumlah DESC, pg.nama)
    FROM agr AS a
    LEFT JOIN public.petugas AS pg ON pg.id = a.penangan_id
    LEFT JOIN public.layanan AS l ON l.id = a.layanan_id
  ), '[]'::jsonb))
$$;

-- rekap_pelayanan_inti: internal, TANPA GRANT ke klien (dipanggil fungsi definer di atas sebagai pemilik).
REVOKE ALL ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lingkup_data_saya() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lingkup_data_saya() TO authenticated;
REVOKE ALL ON FUNCTION public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.rekap_harian_terpadu(date, date, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_harian_terpadu(date, date, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rekap_kinerja_petugas(date, date, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_kinerja_petugas(date, date, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) IS
  '202610290002: dasar rekap terpadu, satu baris per pelayanan dilayani (tahap selesai kecuali layanan dikembalikan / tiket lama selesai ber-waktu_selesai non-draf), lingkup ketat §6.1. Internal.';
