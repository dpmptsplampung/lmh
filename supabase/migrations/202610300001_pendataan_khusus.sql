-- 202610300001_pendataan_khusus.sql
-- Fase 4 (spec docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md §7; rencana
-- docs/superpowers/plans/2026-10-30-fase-4-pendataan.md Task 1). Forward-only, ADITIF terhadap data (B1): hanya tabel,
-- fungsi, trigger, policy baru dan satu INSERT baris baru (topik awal "Lainnya"). Tidak ada DELETE/TRUNCATE/DROP.
--
-- ISI
--   1. pendataan_khusus_field: definisi isian Pendataan Khusus per Layanan (Admin). Jenis: teks_singkat, teks_panjang,
--      angka, tanggal, pilihan_tunggal, pilihan_ganda, ya_tidak. Tanpa unggah berkas. Isian yang PERNAH DIISI
--      (pernah_diisi) tidak dapat dihapus (hanya disembunyikan: tersembunyi) dan jenisnya tidak dapat diubah; label,
--      urutan, wajib, opsi boleh. Ditegakkan trigger DB (bukan hanya UI). Layanan ber-formulir tetap (OSS/Non OSS,
--      layanan.form_pendataan terisi) tidak boleh punya isian (ADR 0002). Maksimal 40 isian per Layanan.
--   2. pendataan_khusus_jawaban: jawaban per TAHAP PENANGANAN (= satu pelayanan), kunci field_id stabil + salinan
--      label/jenis (rekap/ekspor tetap benar setelah label diubah). Klien hanya boleh MEMBACA: tulis lewat
--      fungsi definer (202610300002). Baca = lingkup data Fase 3 (boleh_data_pelayanan; tanpa jendela operasional).
--   3. Fungsi internal pendataan_khusus_validasi / pendataan_khusus_simpan (tanpa GRANT ke klien).
--   4. Topik awal "Lainnya" bagi Layanan yang belum punya topik sama sekali (backfill + trigger Layanan baru), supaya
--      Layanan baru (Fase 1) tidak buntu di TOPIK_WAJIB saat petugas menyelesaikan tiket/chat.
--
-- KODE GALAT (awal pesan): ISIAN_TIDAK_DITEMUKAN (P0002), LAYANAN_FORMULIR_TETAP, OPSI_TIDAK_VALID, ISIAN_TERLALU_BANYAK, JENIS_TERKUNCI (23514),
--   SUDAH_DIISI (23503), LAYANAN_TETAP, KHUSUS_WAJIB, KHUSUS_TIDAK_VALID (DETAIL = id isian).
-- SYARAT / URUTAN: setelah 202610290001 dan 202610290002; disusul 202610300002. KEDUANYA (0001 + 0002) diterapkan BERSAMA
--   dalam satu jendela deploy.
-- PENERAPAN (pemilik; atomik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202610300001_pendataan_khusus.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610300001_pendataan_khusus.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi ini (fitur Pendataan Khusus tersembunyi; alur selesai lama tetap).
-- Idempoten.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.boleh_data_pelayanan(text,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290001_koordinator_akses_data belum diterapkan';
  END IF;
  IF pg_catalog.to_regclass('public.penanganan') IS NULL OR pg_catalog.to_regclass('public.topik_penanganan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel penanganan/topik_penanganan (202610140003) belum ada';
  END IF;
  IF pg_catalog.to_regprocedure('public.peran_saya()') IS NULL
     OR pg_catalog.to_regprocedure('public.update_updated_at_column()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: helper peran_saya/update_updated_at_column tidak ada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
                 WHERE attrelid = 'public.layanan'::regclass AND attname = 'form_pendataan' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'PRASYARAT: layanan.form_pendataan (202610140012) belum ada';
  END IF;
END $$;

-- ============================================================
-- 1. Definisi isian
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pendataan_khusus_field (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id   uuid        NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  label        text        NOT NULL CHECK (char_length(btrim(label)) BETWEEN 2 AND 100),
  jenis        text        NOT NULL CHECK (jenis IN ('teks_singkat', 'teks_panjang', 'angka', 'tanggal', 'pilihan_tunggal', 'pilihan_ganda', 'ya_tidak')),
  wajib        boolean     NOT NULL DEFAULT false,
  opsi         jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opsi) = 'array'),
  urut         integer     NOT NULL DEFAULT 0,
  tersembunyi  boolean     NOT NULL DEFAULT false,
  pernah_diisi boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pendataan_khusus_field_layanan
  ON public.pendataan_khusus_field (layanan_id, tersembunyi, urut);

COMMENT ON TABLE public.pendataan_khusus_field IS
  'Definisi Pendataan Khusus per Layanan (Admin). Isian yang pernah diisi: jenis terkunci, tidak dapat dihapus (sembunyikan saja).';

DROP TRIGGER IF EXISTS trg_pendataan_khusus_field_updated ON public.pendataan_khusus_field;
CREATE TRIGGER trg_pendataan_khusus_field_updated
  BEFORE UPDATE ON public.pendataan_khusus_field
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- 2. Jawaban (per tahap penanganan)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pendataan_khusus_jawaban (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  penanganan_id  uuid        NOT NULL REFERENCES public.penanganan(id) ON DELETE RESTRICT,
  field_id       uuid        NOT NULL REFERENCES public.pendataan_khusus_field(id) ON DELETE RESTRICT,
  nilai          jsonb       NOT NULL,
  label_snapshot text        NOT NULL,
  jenis_snapshot text        NOT NULL,
  diisi_oleh     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (penanganan_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_pendataan_khusus_jawaban_field ON public.pendataan_khusus_jawaban (field_id);

COMMENT ON TABLE public.pendataan_khusus_jawaban IS
  'Jawaban Pendataan Khusus per tahap penanganan (satu pelayanan). Kunci field_id stabil; label/jenis disalin saat disimpan. Hanya ditulis fungsi definer.';

-- ============================================================
-- 3. Trigger penegak aturan "pernah diisi"
-- ============================================================
CREATE OR REPLACE FUNCTION public.pendataan_khusus_field_jaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tetap boolean;
  v_n     integer;
  v_urut  integer;
  v_opsi  jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT (l.form_pendataan IS NOT NULL) INTO v_tetap FROM public.layanan AS l WHERE l.id = NEW.layanan_id;
    IF v_tetap THEN
      RAISE EXCEPTION 'LAYANAN_FORMULIR_TETAP: Layanan ini memakai formulir tetap (OSS / Non OSS); Pendataan Khusus tidak berlaku'
        USING ERRCODE = '22023';
    END IF;
    -- Kunci per Layanan: penyisipan serentak diserialkan agar batas 40 dan urutan tidak balapan (dijaga DB, bukan aplikasi).
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('pendataan_khusus_field:' || NEW.layanan_id::text));
    SELECT pg_catalog.count(*) INTO v_n FROM public.pendataan_khusus_field AS f WHERE f.layanan_id = NEW.layanan_id;
    IF v_n >= 40 THEN
      RAISE EXCEPTION 'ISIAN_TERLALU_BANYAK: maksimal 40 isian per Layanan' USING ERRCODE = '22023';
    END IF;
    -- Isian baru selalu di akhir daftar (urut diberikan DB).
    SELECT COALESCE(pg_catalog.max(f.urut), -1) + 1 INTO v_urut FROM public.pendataan_khusus_field AS f WHERE f.layanan_id = NEW.layanan_id;
    NEW.urut := v_urut;
    NEW.pernah_diisi := false;
  ELSE
    IF NEW.layanan_id IS DISTINCT FROM OLD.layanan_id THEN
      RAISE EXCEPTION 'LAYANAN_TETAP: isian tidak dapat dipindahkan ke Layanan lain' USING ERRCODE = '22023';
    END IF;
    IF NEW.jenis IS DISTINCT FROM OLD.jenis
       AND (OLD.pernah_diisi OR EXISTS (SELECT 1 FROM public.pendataan_khusus_jawaban AS j WHERE j.field_id = OLD.id)) THEN
      RAISE EXCEPTION 'JENIS_TERKUNCI: jenis isian yang pernah diisi tidak dapat diubah' USING ERRCODE = '23514';
    END IF;
    -- Penanda monoton: sekali pernah diisi, tetap pernah diisi.
    NEW.pernah_diisi := OLD.pernah_diisi OR NEW.pernah_diisi;
  END IF;

  IF NEW.jenis IN ('pilihan_tunggal', 'pilihan_ganda') THEN
    IF pg_catalog.jsonb_array_length(NEW.opsi) NOT BETWEEN 2 AND 20
       OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(NEW.opsi) AS e
                  WHERE pg_catalog.jsonb_typeof(e) <> 'string'
                     OR pg_catalog.char_length(pg_catalog.btrim(e #>> '{}')) NOT BETWEEN 1 AND 100) THEN
      RAISE EXCEPTION 'OPSI_TIDAK_VALID: pilihan wajib 2-20 butir teks (maksimal 100 karakter)' USING ERRCODE = '22023';
    END IF;
    SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pg_catalog.btrim(t.e)) ORDER BY t.n) INTO v_opsi
    FROM pg_catalog.jsonb_array_elements_text(NEW.opsi) WITH ORDINALITY AS t(e, n);
    IF (SELECT pg_catalog.count(DISTINCT pg_catalog.lower(x #>> '{}')) FROM pg_catalog.jsonb_array_elements(v_opsi) AS x)
         <> pg_catalog.jsonb_array_length(v_opsi) THEN
      RAISE EXCEPTION 'OPSI_TIDAK_VALID: butir pilihan tidak boleh kembar' USING ERRCODE = '22023';
    END IF;
    NEW.opsi := v_opsi;
  ELSE
    NEW.opsi := '[]'::jsonb;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_pendataan_khusus_field_jaga ON public.pendataan_khusus_field;
CREATE TRIGGER trg_pendataan_khusus_field_jaga
  BEFORE INSERT OR UPDATE ON public.pendataan_khusus_field
  FOR EACH ROW EXECUTE FUNCTION public.pendataan_khusus_field_jaga();

CREATE OR REPLACE FUNCTION public.pendataan_khusus_field_jaga_hapus()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.pernah_diisi OR EXISTS (SELECT 1 FROM public.pendataan_khusus_jawaban AS j WHERE j.field_id = OLD.id) THEN
    RAISE EXCEPTION 'SUDAH_DIISI: isian yang pernah diisi tidak dapat dihapus; sembunyikan saja' USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_pendataan_khusus_field_jaga_hapus ON public.pendataan_khusus_field;
CREATE TRIGGER trg_pendataan_khusus_field_jaga_hapus
  BEFORE DELETE ON public.pendataan_khusus_field
  FOR EACH ROW EXECUTE FUNCTION public.pendataan_khusus_field_jaga_hapus();

CREATE OR REPLACE FUNCTION public.pendataan_khusus_tandai_terisi()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.pendataan_khusus_field SET pernah_diisi = true WHERE id = NEW.field_id AND NOT pernah_diisi;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pendataan_khusus_tandai_terisi ON public.pendataan_khusus_jawaban;
CREATE TRIGGER trg_pendataan_khusus_tandai_terisi
  AFTER INSERT ON public.pendataan_khusus_jawaban
  FOR EACH ROW EXECUTE FUNCTION public.pendataan_khusus_tandai_terisi();

REVOKE ALL ON FUNCTION public.pendataan_khusus_field_jaga() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pendataan_khusus_field_jaga_hapus() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pendataan_khusus_tandai_terisi() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. Lingkup baca jawaban (= lingkup data Fase 3, tanpa jendela operasional) + RLS
-- ============================================================
CREATE OR REPLACE FUNCTION public.boleh_baca_khusus(p_penanganan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT public.boleh_data_pelayanan(p.peran_tahap, p.layanan_id, p.penangan_id)
    FROM public.penanganan AS p
    WHERE p.id = p_penanganan
  ), false)
$$;

REVOKE ALL ON FUNCTION public.boleh_baca_khusus(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_khusus(uuid) TO authenticated, service_role;

ALTER TABLE public.pendataan_khusus_field ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pendataan_khusus_field FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pendataan_khusus_field TO authenticated;
GRANT ALL ON TABLE public.pendataan_khusus_field TO service_role;

DROP POLICY IF EXISTS pendataan_khusus_field_select ON public.pendataan_khusus_field;
CREATE POLICY pendataan_khusus_field_select ON public.pendataan_khusus_field FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'petugas', 'front_office'));
DROP POLICY IF EXISTS pendataan_khusus_field_admin_insert ON public.pendataan_khusus_field;
CREATE POLICY pendataan_khusus_field_admin_insert ON public.pendataan_khusus_field FOR INSERT TO authenticated
  WITH CHECK (public.peran_saya() = 'admin');
DROP POLICY IF EXISTS pendataan_khusus_field_admin_update ON public.pendataan_khusus_field;
CREATE POLICY pendataan_khusus_field_admin_update ON public.pendataan_khusus_field FOR UPDATE TO authenticated
  USING (public.peran_saya() = 'admin')
  WITH CHECK (public.peran_saya() = 'admin');
DROP POLICY IF EXISTS pendataan_khusus_field_admin_delete ON public.pendataan_khusus_field;
CREATE POLICY pendataan_khusus_field_admin_delete ON public.pendataan_khusus_field FOR DELETE TO authenticated
  USING (public.peran_saya() = 'admin');

ALTER TABLE public.pendataan_khusus_jawaban ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pendataan_khusus_jawaban FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pendataan_khusus_jawaban TO authenticated;
GRANT ALL ON TABLE public.pendataan_khusus_jawaban TO service_role;

DROP POLICY IF EXISTS pendataan_khusus_jawaban_select ON public.pendataan_khusus_jawaban;
CREATE POLICY pendataan_khusus_jawaban_select ON public.pendataan_khusus_jawaban FOR SELECT TO authenticated
  USING (public.boleh_baca_khusus(penanganan_id));

-- ============================================================
-- 5. Validasi dan simpan jawaban (internal)
-- ============================================================
-- Memvalidasi p_jawaban {"<id isian>": nilai} terhadap isian TERLIHAT (tidak tersembunyi) milik Layanan. Mengunci baris
-- isian FOR SHARE agar Admin tidak mengubah jenis di tengah penyimpanan. Mengembalikan jsonb array
-- [{field_id,label,jenis,nilai}] hanya untuk isian yang terisi (nilai sudah dinormalkan). Semua-atau-tidak-sama-sekali.
CREATE OR REPLACE FUNCTION public.pendataan_khusus_validasi(p_layanan uuid, p_jawaban jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_obj    jsonb := COALESCE(p_jawaban, '{}'::jsonb);
  v_asing  text;
  f        record;
  v_raw    jsonb;
  v_txt    text;
  v_num    numeric;
  v_tgl    date;
  v_nilai  jsonb;
  v_hasil  jsonb := '[]'::jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(v_obj) <> 'object' THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: jawaban Pendataan Khusus harus berupa objek' USING ERRCODE = '22023';
  END IF;

  SELECT k INTO v_asing FROM pg_catalog.jsonb_object_keys(v_obj) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM public.pendataan_khusus_field AS x
    WHERE x.id::text = k AND x.layanan_id = p_layanan AND NOT x.tersembunyi
  )
  LIMIT 1;
  IF v_asing IS NOT NULL THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian tidak dikenal atau sudah disembunyikan; muat ulang formulir'
      USING ERRCODE = '22023', DETAIL = v_asing;
  END IF;

  FOR f IN
    SELECT x.id, x.label, x.jenis, x.wajib, x.opsi
    FROM public.pendataan_khusus_field AS x
    WHERE x.layanan_id = p_layanan AND NOT x.tersembunyi
    ORDER BY x.urut, x.created_at, x.id
    FOR SHARE
  LOOP
    v_raw := v_obj -> (f.id::text);
    IF v_raw IS NULL OR pg_catalog.jsonb_typeof(v_raw) = 'null'
       OR (pg_catalog.jsonb_typeof(v_raw) = 'string' AND pg_catalog.btrim(v_raw #>> '{}') = '')
       OR (pg_catalog.jsonb_typeof(v_raw) = 'array' AND pg_catalog.jsonb_array_length(v_raw) = 0) THEN
      IF f.wajib THEN
        RAISE EXCEPTION 'KHUSUS_WAJIB: isian "%" wajib diisi', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      CONTINUE;
    END IF;

    v_nilai := NULL;
    IF f.jenis IN ('teks_singkat', 'teks_panjang', 'tanggal', 'pilihan_tunggal') THEN
      IF pg_catalog.jsonb_typeof(v_raw) <> 'string' THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" harus berupa teks', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      v_txt := pg_catalog.btrim(v_raw #>> '{}');
      IF f.jenis = 'teks_singkat' AND pg_catalog.char_length(v_txt) > 200 THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" maksimal 200 karakter', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      ELSIF f.jenis = 'teks_panjang' AND pg_catalog.char_length(v_txt) > 2000 THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" maksimal 2000 karakter', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      ELSIF f.jenis = 'tanggal' THEN
        IF v_txt !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
          RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" harus tanggal YYYY-MM-DD', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
        END IF;
        BEGIN
          v_tgl := v_txt::date;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" bukan tanggal yang sah', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
        END;
        IF pg_catalog.to_char(v_tgl, 'YYYY-MM-DD') <> v_txt THEN
          RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" bukan tanggal yang sah', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
        END IF;
      ELSIF f.jenis = 'pilihan_tunggal' AND NOT EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements_text(f.opsi) AS o WHERE o = v_txt) THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" berisi pilihan di luar daftar', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      v_nilai := pg_catalog.to_jsonb(v_txt);
    ELSIF f.jenis = 'angka' THEN
      IF pg_catalog.jsonb_typeof(v_raw) <> 'number' THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" harus berupa angka', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      v_num := (v_raw #>> '{}')::numeric;
      IF pg_catalog.abs(v_num) > 1000000000000 THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" di luar batas angka', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      v_nilai := v_raw;
    ELSIF f.jenis = 'ya_tidak' THEN
      IF NOT (pg_catalog.jsonb_typeof(v_raw) = 'boolean') THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" harus ya/tidak', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      v_nilai := v_raw;
    ELSIF f.jenis = 'pilihan_ganda' THEN
      IF pg_catalog.jsonb_typeof(v_raw) <> 'array'
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_raw) AS e
                    WHERE pg_catalog.jsonb_typeof(e) <> 'string'
                       OR NOT EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements_text(f.opsi) AS o WHERE o = (e #>> '{}')))
         OR (SELECT pg_catalog.count(DISTINCT e) FROM pg_catalog.jsonb_array_elements_text(v_raw) AS e)
              <> pg_catalog.jsonb_array_length(v_raw) THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: isian "%" berisi pilihan di luar daftar atau berulang', f.label
          USING ERRCODE = '22023', DETAIL = f.id::text;
      END IF;
      v_nilai := v_raw;
    ELSE
      RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: jenis isian "%" tidak dikenal', f.label USING ERRCODE = '22023', DETAIL = f.id::text;
    END IF;

    v_hasil := v_hasil || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('field_id', f.id, 'label', f.label, 'jenis', f.jenis, 'nilai', v_nilai));
  END LOOP;
  RETURN v_hasil;
END $$;

CREATE OR REPLACE FUNCTION public.pendataan_khusus_simpan(
  p_penanganan uuid,
  p_layanan    uuid,
  p_jawaban    jsonb,
  p_oleh       uuid
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_valid jsonb;
  v_n     integer;
BEGIN
  v_valid := public.pendataan_khusus_validasi(p_layanan, p_jawaban);
  INSERT INTO public.pendataan_khusus_jawaban (penanganan_id, field_id, nilai, label_snapshot, jenis_snapshot, diisi_oleh)
  SELECT p_penanganan, (e ->> 'field_id')::uuid, e -> 'nilai', e ->> 'label', e ->> 'jenis', p_oleh
  FROM pg_catalog.jsonb_array_elements(v_valid) AS e;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.pendataan_khusus_validasi(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pendataan_khusus_simpan(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5b. Urutan atomik dan peta jawaban untuk rekap (SECURITY INVOKER: RLS tetap berlaku)
-- ============================================================
-- Satu pernyataan UPDATE: seluruh urutan berhasil atau tidak sama sekali. RLS admin menolak non-admin (0 baris) -> galat.
CREATE OR REPLACE FUNCTION public.pendataan_khusus_urutkan(p_layanan uuid, p_urutan uuid[])
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.pendataan_khusus_field AS f
     SET urut = (t.n - 1)::integer
    FROM pg_catalog.unnest(p_urutan) WITH ORDINALITY AS t(id, n)
   WHERE f.id = t.id AND f.layanan_id = p_layanan;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> COALESCE(pg_catalog.cardinality(p_urutan), 0) THEN
    RAISE EXCEPTION 'ISIAN_TIDAK_DITEMUKAN: ada isian di luar Layanan ini atau Anda tidak berwenang' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_n;
END $$;

-- {penanganan_id: {field_id: nilai}} untuk id yang diberikan; hanya baris yang lolos RLS (boleh_baca_khusus = lingkup data
-- ketat Fase 3) yang ikut. Satu nilai jsonb: tidak terkena batas baris PostgREST, dan id lewat badan permintaan (bukan URL).
CREATE OR REPLACE FUNCTION public.pendataan_khusus_peta(p_penanganan uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(pg_catalog.jsonb_object_agg(x.penanganan_id::text, x.isian), '{}'::jsonb)
  FROM (
    SELECT j.penanganan_id, pg_catalog.jsonb_object_agg(j.field_id::text, j.nilai) AS isian
    FROM public.pendataan_khusus_jawaban AS j
    WHERE j.penanganan_id = ANY(p_penanganan)
    GROUP BY j.penanganan_id
  ) AS x
$$;

REVOKE ALL ON FUNCTION public.pendataan_khusus_urutkan(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pendataan_khusus_urutkan(uuid, uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.pendataan_khusus_peta(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pendataan_khusus_peta(uuid[]) TO authenticated;

-- ============================================================
-- 6. Topik awal "Lainnya" bagi Layanan AKTIF tanpa topik (arsip = aktif false di proyek ini: dilewati)
-- ============================================================
INSERT INTO public.topik_penanganan (layanan_id, nama, urut)
SELECT l.id, 'Lainnya', 999
FROM public.layanan AS l
WHERE l.aktif
  AND NOT EXISTS (SELECT 1 FROM public.topik_penanganan AS t WHERE t.layanan_id = l.id)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.layanan_topik_awal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.topik_penanganan (layanan_id, nama, urut) VALUES (NEW.id, 'Lainnya', 999)
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.layanan_topik_awal() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_layanan_topik_awal ON public.layanan;
CREATE TRIGGER trg_layanan_topik_awal
  AFTER INSERT ON public.layanan
  FOR EACH ROW EXECUTE FUNCTION public.layanan_topik_awal();

COMMENT ON FUNCTION public.boleh_baca_khusus(uuid) IS
  '202610300001: RLS baca jawaban Pendataan Khusus = boleh_data_pelayanan (lingkup data Fase 3, ketat).';
