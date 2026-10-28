-- 202611010005_rekap_data_tanpa_form.sql
-- Tab "Data Pelayanan" di Rekap menjadi data LAYANAN LAIN: Helpdesk OSS dan Non OSS (volume terbanyak) punya tab sendiri,
-- sehingga tab umum perlu dapat mengecualikan keduanya di DB (total, halaman, dan unduhan Excel ikut benar). Forward-only,
-- ADITIF terhadap data (B1): hanya mengganti satu fungsi baca. Tidak ada DELETE/TRUNCATE/DROP TABLE/DROP COLUMN/UPDATE.
--
-- ISI
--   rekap_data_pelayanan mendapat argumen ke-9 `p_tanpa_form boolean DEFAULT false`. Bila TRUE, baris unit 'layanan'
--   milik Layanan berformulir (layanan.form_pendataan IS NOT NULL: 'oss' / 'perizinan') dikecualikan, baik di total maupun di
--   halaman. Baris Front Office tidak pernah dikecualikan. Default FALSE = perilaku 202610290002 persis. Filter hanya
--   MEMPERSEMPIT hasil; lingkup akses (§6.1) tetap ditegakkan rekap_pelayanan_inti. Rekap Harian dan Kinerja Petugas tidak berubah.
--   Karena menambah argumen mengubah tanda tangan fungsi, tanda tangan 8-argumen lama di-DROP dalam transaksi yang sama
--   (pemanggil dengan argumen bernama, seperti PostgREST, tetap berjalan lewat DEFAULT).
--
-- SYARAT / URUTAN: setelah 202610290002 (rekap_pelayanan_inti + rekap_data_pelayanan 8 argumen).
-- PENERAPAN (pemilik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202611010005_rekap_data_tanpa_form.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202611010005_rekap_data_tanpa_form.sql --atomic
-- KLIEN: deploy aplikasi SESUDAH migrasi ini. Sebelum diterapkan, tab Data Pelayanan menjawab 409 MIGRASI_BELUM_DITERAPKAN
--   (fungsi 9 argumen belum ada); tab Helpdesk OSS / Non OSS tidak memakai argumen baru dan tetap berjalan.
-- ROLLBACK: docs/rollback-rekap-data-tanpa-form-202611010005.sql (mengembalikan fungsi 8 argumen 202610290002). Jalankan
--   SEBELUM docs/rollback-rekap-terpadu-202610290002.sql.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.rekap_pelayanan_inti(date,date,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.rekap_data_pelayanan(date,date,text,uuid,integer,integer,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290002_rekap_terpadu belum diterapkan';
  END IF;
  IF pg_catalog.to_regclass('public.layanan') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                    WHERE attrelid = 'public.layanan'::regclass AND attname = 'form_pendataan' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom layanan.form_pendataan belum ada (202610140012)';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean);

CREATE FUNCTION public.rekap_data_pelayanan(
  p_dari       date,
  p_sampai     date,
  p_unit       text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL,
  p_batas      integer DEFAULT 50,
  p_lewati     integer DEFAULT 0,
  p_setelah    jsonb DEFAULT NULL,
  p_hitung     boolean DEFAULT false,
  p_tanpa_form boolean DEFAULT false
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
    SELECT pg_catalog.count(*) INTO v_total
    FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
    WHERE (p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'
           OR NOT EXISTS (SELECT 1 FROM public.layanan AS lf WHERE lf.id = i.layanan_id AND lf.form_pendataan IS NOT NULL));
  END IF;

  WITH pilih AS (
    SELECT i.*
    FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
    WHERE (v_s_id IS NULL OR (i.tanggal, i.urut, i.pelayanan_id) > (v_s_tgl, v_s_urut, v_s_id))
      AND (p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'
           OR NOT EXISTS (SELECT 1 FROM public.layanan AS lf WHERE lf.id = i.layanan_id AND lf.form_pendataan IS NOT NULL))
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

REVOKE ALL ON FUNCTION public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean, boolean) TO authenticated;

COMMENT ON FUNCTION public.rekap_data_pelayanan(date, date, text, uuid, integer, integer, jsonb, boolean, boolean) IS
  '202611010005: Data Pelayanan satu halaman + detail; p_tanpa_form TRUE mengecualikan pelayanan unit Layanan berformulir (Helpdesk OSS / Non OSS). Lingkup ketat §6.1 dari rekap_pelayanan_inti.';
