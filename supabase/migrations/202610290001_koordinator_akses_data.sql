-- 202610290001_koordinator_akses_data.sql
-- Fase 3 (spec docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md §6.1-§6.2; ADR 0003; rencana
-- docs/superpowers/plans/2026-10-29-fase-3-koordinator-rekap.md Task 1). Forward-only, ADITIF terhadap data (B1):
-- tidak ada DELETE/TRUNCATE/DROP TABLE/DROP COLUMN; tidak ada UPDATE nilai lama di luar RPC operasional baru.
--
-- ISI
--   1. petugas.koordinator boolean NOT NULL DEFAULT false: PENANDA (bukan role, B3) pada akun Front Office atau Petugas
--      Layanan. Diubah Admin lewat /admin/petugas (route service-role; RLS petugas_admin_full tetap satu-satunya tulis).
--      Pemicu trg_petugas_cabut_koordinator mencabutnya otomatis pada setiap perubahan role/layanan_id.
--   2. Helper lingkup (SECURITY DEFINER, hanya akun AKTIF):
--      - staf_lingkup(): id, role, layanan_id, koordinator pemanggil.
--      - boleh_data_pelayanan(peran_tahap, layanan, penangan): lingkup data §6.1 (KETAT): admin semua; FO+Koordinator
--        semua; Petugas+Koordinator tahap 'layanan' di layanannya; selain itu hanya penangan = dirinya.
--      - kunjungan_operasional(kunjungan): JENDELA OPERASIONAL = hanya pekerjaan TERBUKA (review keamanan Fase 3):
--        kunjungan menunggu/dilayani bertanggal >= kemarin (WIB) atau reservasi terjadwal bertanggal HARI INI (FO hanya
--        meng-check-in reservasi pada harinya). Kunjungan yang sudah ditutup (termasuk hari ini) TIDAK masuk jendela:
--        hanya terbaca dalam lingkup data. Operasional antrean tidak berubah (spec §6.1 kolom "Operasional").
--   3. MEMBALIK 202610140013 (keterbukaan data antar FO): boleh_penanganan dan boleh_kunjungan diganti isinya (signature
--      sama). Di luar lingkup data, staf hanya membaca baris dalam jendela operasional (pekerjaan terbuka) dengan aturan
--      operasional lama (FO semua; petugas layanannya + konteks kunjungan/chat). Riwayat (yang sudah ditutup, termasuk
--      hari ini) = lingkup data saja.
--   4. Pendataan Khusus (pelayanan_oss / pelayanan_perizinan; juga view v_rekap_pelayanan_* yang security_invoker):
--      policy baca diganti boleh_baca_pendataan(tiket, petugas). Policy tulis draf diganti boleh_sunting_pendataan
--      (pemilik tiket ATAU pemegang lama yang pendataannya diambil alih Koordinator, selama tiket masih 'dilayani').
--   5. rekap_harian_layanan (agregat lama) dan arsip visit (visit_select_own): staf hanya admin dan Koordinator unitnya
--      (boleh_rekap_lama; visit tidak punya kolom penangan). Pengunjung tetap membaca visit miliknya.
--   6. ambil_alih_pendataan (catatan siapa memegang sebelum/sesudah; dasar pemberitahuan pemegang lama) + RPC
--      koordinator_ambil_alih_tiket, koordinator_ambil_alih_fo, ambil_alih_tandai_dilihat. audit_log + notifikasi.
--
-- KODE GALAT RPC (awal pesan): FORBIDDEN, SESI_TIDAK_SAH, ALASAN_WAJIB, NOT_FOUND, INVALID_STATUS, BUKAN_SATU_UNIT,
--   KANAL_CHAT.
-- SYARAT / URUTAN: setelah 202610270001, 202610270002, 202610280001 (penjaga di bagian 0). Disusul 202610290002.
-- PENERAPAN (pemilik; WAJIB atomik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202610290001_koordinator_akses_data.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610290001_koordinator_akses_data.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi ini (penanda dibaca dengan fallback false; sunting draf = pemilik saja).
-- Penanda: COMMENT ON FUNCTION boleh_penanganan memuat '202610290001' (tanpa penanda 0013). Penjaga rollback 0012 dan 0013
--   menolak selama penanda ini ada. Rollback: docs/rollback-koordinator-akses-data-202610290001.sql (SETELAH
--   docs/rollback-rekap-terpadu-202610290002.sql).
-- Idempoten.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_kunjungan(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.pemilik_tiket(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_ambil_alih(uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: helper RLS/RPC 202610140002-202610140013 belum lengkap';
  END IF;
  IF pg_catalog.to_regclass('public.instansi') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610270001_instansi_layanan_konten belum diterapkan';
  END IF;
  IF pg_catalog.to_regclass('public.homepage_blok') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610280001_homepage_etalase belum diterapkan';
  END IF;
END $$;

-- ============================================================
-- 1. Penanda Koordinator
-- ============================================================
ALTER TABLE public.petugas ADD COLUMN IF NOT EXISTS koordinator boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.petugas.koordinator IS
  'Fase 3: penanda Koordinator (bukan role). FO+Koordinator: semua data semua Layanan; Petugas+Koordinator: semua data Layanannya; keduanya boleh mengambil alih pendataan berjalan di unitnya. Diabaikan untuk admin.';

-- Pencabutan penanda ATOMIK (review keamanan): penanda Koordinator memberi lingkup data UNIT, sehingga setiap perubahan
-- role atau layanan_id pada baris yang sama mencabutnya (dalam UPDATE yang sama, tidak bergantung pada aplikasi). Admin
-- harus menandai ulang secara sadar.
CREATE OR REPLACE FUNCTION public.petugas_cabut_koordinator()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role OR NEW.layanan_id IS DISTINCT FROM OLD.layanan_id THEN
    NEW.koordinator := false;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.petugas_cabut_koordinator() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_petugas_cabut_koordinator ON public.petugas;
CREATE TRIGGER trg_petugas_cabut_koordinator
  BEFORE UPDATE OF role, layanan_id ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.petugas_cabut_koordinator();

-- ============================================================
-- 2. Helper lingkup
-- ============================================================
CREATE OR REPLACE FUNCTION public.staf_lingkup()
RETURNS TABLE (id uuid, role text, layanan_id uuid, koordinator boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT staff.id, staff.role, staff.layanan_id, staff.koordinator
  FROM public.petugas AS staff
  WHERE staff.auth_user_id = auth.uid() AND staff.aktif = true
$$;

-- Lingkup data KETAT (§6.1), tanpa jendela operasional. Dipakai RLS dan (disalin, dengan variabel) RPC rekap 202610290002.
CREATE OR REPLACE FUNCTION public.boleh_data_pelayanan(p_peran_tahap text, p_layanan uuid, p_penangan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staf_lingkup() AS me
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (me.role = 'petugas' AND me.koordinator AND me.layanan_id IS NOT NULL
           AND p_peran_tahap = 'layanan' AND p_layanan = me.layanan_id)
       OR (p_penangan IS NOT NULL AND p_penangan = me.id)
  )
$$;

CREATE OR REPLACE FUNCTION public.kunjungan_operasional(p_kunjungan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kunjungan AS k
    WHERE k.id = p_kunjungan
      AND (
        (k.status IN ('menunggu', 'dilayani')
         AND k.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1)
        OR (k.status = 'terjadwal'
            AND k.tanggal = (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date)
      )
  )
$$;

REVOKE ALL ON FUNCTION public.staf_lingkup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staf_lingkup() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.boleh_data_pelayanan(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_data_pelayanan(text, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.kunjungan_operasional(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kunjungan_operasional(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. RLS baca penanganan dan kunjungan (membalik 202610140013)
-- ============================================================
CREATE OR REPLACE FUNCTION public.boleh_penanganan(
  p_kunjungan   uuid,
  p_peran_tahap text,
  p_layanan     uuid,
  p_penangan    uuid,
  p_status      text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  -- Lingkup data (§6.1): data sendiri / unit Koordinator, semua tanggal.
  IF public.boleh_data_pelayanan(p_peran_tahap, p_layanan, p_penangan) THEN
    RETURN true;
  END IF;
  -- Di luar lingkup data: hanya jendela operasional (tahap terbuka, atau kunjungan yang masih terbuka).
  IF NOT (p_status IN ('menunggu', 'berjalan') OR public.kunjungan_operasional(p_kunjungan)) THEN
    RETURN false;
  END IF;
  IF v_role = 'front_office' THEN
    -- Operasional FO: semua Layanan (memanggil, mengambil dari kotak masuk, mengelola antrean).
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    -- Aturan operasional petugas = 202610140009 (layanannya + konteks kunjungan + chat di layanannya).
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    ) OR EXISTS (
      SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
      WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS
  '202610290001: RLS baca penanganan. Lingkup data per orang/Koordinator (ADR 0003, membalik keterbukaan antar FO) + jendela operasional (pekerjaan terbuka).';

CREATE OR REPLACE FUNCTION public.boleh_kunjungan(p_kunjungan uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
  v_koord   boolean;
  v_unit    boolean;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  -- Data yang ia tangani sendiri (semua tanggal).
  IF EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan AND k.dibuat_oleh = v_id)
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.penangan_id = v_id)
     OR EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.dilayani_oleh = v_id)
     OR EXISTS (SELECT 1 FROM public.pelayanan_oss AS o WHERE o.kunjungan_id = p_kunjungan AND o.petugas_id = v_id)
     OR EXISTS (SELECT 1 FROM public.pelayanan_perizinan AS pz WHERE pz.kunjungan_id = p_kunjungan AND pz.petugas_id = v_id)
  THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    v_unit := EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.layanan_id = v_layanan)
      OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan)
      OR EXISTS (
        SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
        WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
      );
    -- Petugas+Koordinator: semua kunjungan layanannya; petugas biasa: hanya jendela operasional.
    RETURN v_unit AND (v_koord OR public.kunjungan_operasional(p_kunjungan));
  END IF;
  IF v_role = 'front_office' THEN
    RETURN public.kunjungan_operasional(p_kunjungan);
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleh_kunjungan(uuid) IS
  '202610290001: RLS baca kunjungan staf. Admin/FO Koordinator semua; Petugas Koordinator layanannya; milik sendiri; selain itu jendela operasional.';

-- ============================================================
-- 4. Pendataan Khusus: baca per orang, sunting draf pemilik + pemegang lama
-- ============================================================
CREATE TABLE IF NOT EXISTS public.ambil_alih_pendataan (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  peran_tahap        text        NOT NULL CHECK (peran_tahap IN ('fo', 'layanan')),
  kunjungan_id       uuid        NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  tiket_id           uuid        REFERENCES public.tiket_antrean(id) ON DELETE SET NULL,
  layanan_id         uuid        REFERENCES public.layanan(id) ON DELETE SET NULL,
  penanganan_lama_id uuid        REFERENCES public.penanganan(id) ON DELETE SET NULL,
  penanganan_baru_id uuid        REFERENCES public.penanganan(id) ON DELETE SET NULL,
  pemegang_lama      uuid        NOT NULL REFERENCES public.petugas(id) ON DELETE CASCADE,
  pemegang_baru      uuid        NOT NULL REFERENCES public.petugas(id) ON DELETE CASCADE,
  alasan             text        NOT NULL CHECK (char_length(btrim(alasan)) BETWEEN 5 AND 500),
  dilihat_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ambil_alih_beda_orang CHECK (pemegang_lama <> pemegang_baru)
);
CREATE INDEX IF NOT EXISTS idx_ambil_alih_pemegang_lama ON public.ambil_alih_pendataan(pemegang_lama, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ambil_alih_tiket ON public.ambil_alih_pendataan(tiket_id);
COMMENT ON TABLE public.ambil_alih_pendataan IS
  'Fase 3: Koordinator mengambil alih pendataan berjalan. Ditulis HANYA oleh RPC koordinator_ambil_alih_* (SECURITY DEFINER); klien hanya SELECT (admin, pemegang lama, pemegang baru).';

ALTER TABLE public.ambil_alih_pendataan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ambil_alih_pendataan FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ambil_alih_pendataan TO authenticated;
GRANT ALL ON TABLE public.ambil_alih_pendataan TO service_role;

DROP POLICY IF EXISTS ambil_alih_pendataan_select ON public.ambil_alih_pendataan;
CREATE POLICY ambil_alih_pendataan_select ON public.ambil_alih_pendataan FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.staf_lingkup() AS me
    WHERE me.role = 'admin' OR me.id = pemegang_lama OR me.id = pemegang_baru
  ));

CREATE OR REPLACE FUNCTION public.boleh_baca_pendataan(p_tiket uuid, p_petugas uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
  v_koord   boolean;
  v_t       record;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  IF p_petugas = v_id THEN
    RETURN true;
  END IF;
  SELECT t.layanan_id, t.status, t.tanggal, t.dilayani_oleh INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_t.dilayani_oleh = v_id
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket AND p.penangan_id = v_id) THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_koord AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan THEN
    RETURN true;
  END IF;
  -- Jendela operasional: hanya tiket TERBUKA bertanggal >= kemarin (WIB), aturan lama boleh_tiket (FO semua;
  -- petugas layanannya). Tiket yang sudah selesai (termasuk hari ini) hanya dalam lingkup data.
  IF NOT (v_t.status IN ('menunggu', 'dipanggil', 'dilayani')
          AND v_t.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1) THEN
    RETURN false;
  END IF;
  RETURN v_role = 'front_office' OR (v_role = 'petugas' AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan);
END $$;

-- true bila pemanggil pemilik tiket 'dilayani', ATAU pemegang lama yang pendataannya diambil alih Koordinator yang kini
-- memegang tiket itu (spec §6.2: petugas semula tetap bisa menyunting). Menyelesaikan tetap hanya pemilik (layanan_selesai).
CREATE OR REPLACE FUNCTION public.boleh_sunting_pendataan(p_tiket_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.pemilik_tiket(p_tiket_id) OR EXISTS (
    SELECT 1
    FROM public.tiket_antrean AS t
    JOIN public.ambil_alih_pendataan AS a ON a.tiket_id = t.id AND a.pemegang_baru = t.dilayani_oleh
    JOIN public.staf_lingkup() AS me ON me.id = a.pemegang_lama
    WHERE t.id = p_tiket_id AND t.status = 'dilayani'
  )
$$;

CREATE OR REPLACE FUNCTION public.boleh_rekap_lama(p_layanan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staf_lingkup() AS me
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (me.role = 'petugas' AND me.koordinator AND me.layanan_id IS NOT NULL AND me.layanan_id = p_layanan)
  )
$$;

REVOKE ALL ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.boleh_sunting_pendataan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_sunting_pendataan(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.boleh_rekap_lama(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_rekap_lama(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS oss_read_staff ON public.pelayanan_oss;
CREATE POLICY oss_read_staff ON public.pelayanan_oss FOR SELECT TO authenticated
  USING (public.boleh_baca_pendataan(tiket_id, petugas_id));

DROP POLICY IF EXISTS perizinan_read_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_read_staff ON public.pelayanan_perizinan FOR SELECT TO authenticated
  USING (public.boleh_baca_pendataan(tiket_id, petugas_id));

-- Tulis draf: sama dengan 202610140002 kecuali pemilik_tiket -> boleh_sunting_pendataan.
DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
    AND public.boleh_sunting_pendataan(tiket_id)
  );

DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id) AND public.boleh_sunting_pendataan(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id) AND public.boleh_sunting_pendataan(tiket_id));

DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
    AND public.boleh_sunting_pendataan(tiket_id)
  );

DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id) AND public.boleh_sunting_pendataan(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id) AND public.boleh_sunting_pendataan(tiket_id));

-- ============================================================
-- 5. Agregat lama rekap_harian_layanan dan arsip visit
-- ============================================================
DROP POLICY IF EXISTS rekap_harian_staff_read ON public.rekap_harian_layanan;
CREATE POLICY rekap_harian_staff_read ON public.rekap_harian_layanan FOR SELECT TO authenticated
  USING (public.boleh_rekap_lama(layanan_id));

-- Arsip visit (baca saja sejak WP-24): versi 202610090001 memakai boleh_layanan sehingga SEMUA FO membaca semua visit lama.
-- visit tidak punya kolom penangan -> staf: admin dan Koordinator unitnya saja. Pengunjung tetap membaca miliknya.
DROP POLICY IF EXISTS visit_select_own ON public.visit;
CREATE POLICY visit_select_own ON public.visit FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid())
    OR public.boleh_rekap_lama(layanan_id)
  );

-- ============================================================
-- 6. RPC ambil alih pendataan oleh Koordinator
-- ============================================================
CREATE OR REPLACE FUNCTION public.koordinator_ambil_alih_tiket(p_tiket_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_me_kd   boolean;
  v_me_nama text;
  v_kunj    uuid;
  v_t       record;
  v_p       record;
  v_lama    record;
  v_now     timestamptz := pg_catalog.now();
  v_tahap   integer;
  v_baru    uuid;
  v_aa      uuid;
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_me_id, v_me_role, v_me_lyn, v_me_kd
  FROM public.staf_lingkup() AS me;
  IF v_me_id IS NULL OR v_me_role IS DISTINCT FROM 'petugas' OR v_me_kd IS NOT TRUE OR v_me_lyn IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Koordinator Petugas Layanan aktif yang boleh mengambil alih pendataan'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.char_length(v_alasan) < 5 OR pg_catalog.char_length(v_alasan) > 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih wajib diisi (5-500 karakter)' USING ERRCODE = '22023';
  END IF;

  -- Urutan kunci global: kunjungan -> tiket -> penanganan (sama dengan admin_ambil_alih).
  SELECT t.kunjungan_id INTO v_kunj FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT t.id, t.status, t.dilayani_oleh, t.layanan_id, t.kunjungan_id, t.nomor_display INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_t.layanan_id IS DISTINCT FROM v_me_lyn THEN
    RAISE EXCEPTION 'FORBIDDEN: tiket ini bukan milik Layanan Anda' USING ERRCODE = '42501';
  END IF;
  IF v_t.status <> 'dilayani' OR v_t.dilayani_oleh IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya pendataan yang sedang berjalan yang dapat diambil alih (status=%)', v_t.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh = v_me_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id);
  END IF;
  SELECT p.id, p.role, p.layanan_id, p.auth_user_id INTO v_lama FROM public.petugas AS p WHERE p.id = v_t.dilayani_oleh;
  IF v_lama.id IS NULL OR v_lama.role IS DISTINCT FROM 'petugas' OR v_lama.layanan_id IS DISTINCT FROM v_me_lyn THEN
    RAISE EXCEPTION 'BUKAN_SATU_UNIT: pendataan ini dipegang akun di luar unit Anda' USING ERRCODE = '42501';
  END IF;
  -- Sama dengan jalur FO: tahap live chat belum dapat diambil alih Koordinator (Fase 5).
  IF EXISTS (SELECT 1 FROM public.penanganan AS pc
             WHERE pc.tiket_id = p_tiket_id AND pc.status = 'berjalan' AND pc.saluran = 'chat') THEN
    RAISE EXCEPTION 'KANAL_CHAT: penanganan live chat belum dapat diambil alih Koordinator' USING ERRCODE = 'P0001';
  END IF;

  -- Status dan waktu tiket TIDAK berubah; updated_at sengaja tidak disentuh (A3).
  UPDATE public.tiket_antrean AS t SET dilayani_oleh = v_me_id WHERE t.id = p_tiket_id AND t.status = 'dilayani';

  -- Tahap penanganan (tiket hasil eskalasi): tutup tahap pemilik lama, buka tahap Koordinator.
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    UPDATE public.penanganan AS p
       SET status = 'batal', batal_karena = 'diambil_alih', selesai_at = v_now,
           catatan = pg_catalog.left('Diambil alih Koordinator: ' || pg_catalog.btrim(p_alasan), 1000)
     WHERE p.id = v_p.id;
    SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_t.kunjungan_id;
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, penangan_id,
                                   status, mulai_at, dibuat_oleh)
    VALUES (v_t.kunjungan_id, v_tahap, 'layanan', v_t.layanan_id, v_p.saluran, p_tiket_id, v_me_id,
            'berjalan', v_now, v_me_id)
    RETURNING id INTO v_baru;
  END IF;

  INSERT INTO public.ambil_alih_pendataan (peran_tahap, kunjungan_id, tiket_id, layanan_id, penanganan_lama_id,
                                           penanganan_baru_id, pemegang_lama, pemegang_baru, alasan)
  VALUES ('layanan', v_t.kunjungan_id, p_tiket_id, v_t.layanan_id, v_p.id, v_baru, v_lama.id, v_me_id, v_alasan)
  RETURNING id INTO v_aa;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'koordinator_ambil_alih', 'tiket_antrean', p_tiket_id::text,
    pg_catalog.jsonb_build_object(
      'tiket_id', p_tiket_id, 'pemilik_lama', v_lama.id, 'pemilik_baru', v_me_id, 'alasan', v_alasan,
      'ambil_alih_id', v_aa, 'penanganan_lama_id', v_p.id, 'penanganan_baru_id', v_baru
    ),
    pg_catalog.jsonb_build_object('dilayani_oleh', v_lama.id),
    pg_catalog.jsonb_build_object('dilayani_oleh', v_me_id)
  );

  -- Pemberitahuan pemegang lama (tanpa PII pengunjung; tanpa kunjungan_id agar tidak di-dedupe antar ambil alih).
  SELECT p.nama INTO v_me_nama FROM public.petugas AS p WHERE p.id = v_me_id;
  IF v_lama.auth_user_id IS NOT NULL THEN
    PERFORM public.queue_notifikasi(
      v_lama.auth_user_id, NULL, 'web_push',
      pg_catalog.format('Pendataan tiket %s diambil alih', v_t.nomor_display),
      pg_catalog.format('Koordinator %s mengambil alih pendataan tiket %s. Anda masih dapat menyunting drafnya.',
                        COALESCE(v_me_nama, '-'), v_t.nomor_display),
      pg_catalog.jsonb_build_object('type', 'pendataan_diambil_alih', 'ambil_alih_id', v_aa, 'tiket_id', p_tiket_id,
                                    'url', '/admin/antrian')
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'pemilik_lama', v_lama.id, 'dilayani_oleh', v_me_id, 'ambil_alih_id', v_aa);
END $$;

CREATE OR REPLACE FUNCTION public.koordinator_ambil_alih_fo(p_penanganan_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_kd   boolean;
  v_me_nama text;
  v_kunj    uuid;
  v_p       record;
  v_lama    record;
  v_now     timestamptz := pg_catalog.now();
  v_tahap   integer;
  v_baru    uuid;
  v_aa      uuid;
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
BEGIN
  SELECT me.id, me.role, me.koordinator INTO v_me_id, v_me_role, v_me_kd FROM public.staf_lingkup() AS me;
  IF v_me_id IS NULL OR v_me_role IS DISTINCT FROM 'front_office' OR v_me_kd IS NOT TRUE THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Koordinator Front Office aktif yang boleh mengambil alih penanganan FO'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.char_length(v_alasan) < 5 OR pg_catalog.char_length(v_alasan) > 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih wajib diisi (5-500 karakter)' USING ERRCODE = '22023';
  END IF;

  SELECT p.kunjungan_id INTO v_kunj FROM public.penanganan AS p WHERE p.id = p_penanganan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p WHERE p.id = p_penanganan_id FOR UPDATE;
  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya tahap Front Office yang dapat diambil alih Koordinator FO' USING ERRCODE = '42501';
  END IF;
  IF v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya penanganan yang sedang berjalan yang dapat diambil alih (status=%)', v_p.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_p.saluran = 'chat' THEN
    RAISE EXCEPTION 'KANAL_CHAT: penanganan live chat belum dapat diambil alih Koordinator' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id = v_me_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'sudah_milik_anda', true, 'penanganan_id', v_p.id);
  END IF;
  SELECT p.id, p.role, p.auth_user_id INTO v_lama FROM public.petugas AS p WHERE p.id = v_p.penangan_id;
  IF v_lama.id IS NULL OR v_lama.role IS DISTINCT FROM 'front_office' THEN
    RAISE EXCEPTION 'BUKAN_SATU_UNIT: penanganan ini dipegang akun di luar unit Front Office' USING ERRCODE = '42501';
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'batal', batal_karena = 'diambil_alih', selesai_at = v_now,
         catatan = pg_catalog.left('Diambil alih Koordinator: ' || v_alasan, 200)
   WHERE p.id = v_p.id;
  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_p.kunjungan_id;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, penangan_id,
                                 status, mulai_at, dibuat_oleh)
  VALUES (v_p.kunjungan_id, v_tahap, 'fo', NULL, v_p.saluran, NULL, v_me_id, 'berjalan', v_now, v_me_id)
  RETURNING id INTO v_baru;

  INSERT INTO public.ambil_alih_pendataan (peran_tahap, kunjungan_id, tiket_id, layanan_id, penanganan_lama_id,
                                           penanganan_baru_id, pemegang_lama, pemegang_baru, alasan)
  VALUES ('fo', v_p.kunjungan_id, NULL, NULL, v_p.id, v_baru, v_lama.id, v_me_id, v_alasan)
  RETURNING id INTO v_aa;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'koordinator_ambil_alih', 'penanganan', v_p.id::text,
    pg_catalog.jsonb_build_object(
      'penanganan_lama_id', v_p.id, 'penanganan_baru_id', v_baru, 'pemilik_lama', v_lama.id, 'pemilik_baru', v_me_id,
      'alasan', v_alasan, 'ambil_alih_id', v_aa
    ),
    pg_catalog.jsonb_build_object('penangan_id', v_lama.id),
    pg_catalog.jsonb_build_object('penangan_id', v_me_id)
  );

  SELECT p.nama INTO v_me_nama FROM public.petugas AS p WHERE p.id = v_me_id;
  IF v_lama.auth_user_id IS NOT NULL THEN
    PERFORM public.queue_notifikasi(
      v_lama.auth_user_id, NULL, 'web_push',
      'Penanganan Anda diambil alih',
      pg_catalog.format('Koordinator %s mengambil alih penanganan Front Office yang sedang Anda pegang.', COALESCE(v_me_nama, '-')),
      pg_catalog.jsonb_build_object('type', 'pendataan_diambil_alih', 'ambil_alih_id', v_aa, 'url', '/admin/fo/penanganan')
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'pemilik_lama', v_lama.id, 'penanganan_id', v_baru, 'ambil_alih_id', v_aa);
END $$;

-- Pemegang lama menandai pemberitahuan sudah dibaca (hanya kolom dilihat_at baris miliknya).
CREATE OR REPLACE FUNCTION public.ambil_alih_tandai_dilihat(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id uuid;
  v_n     integer;
BEGIN
  SELECT me.id INTO v_me_id FROM public.staf_lingkup() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: akun staf aktif diperlukan' USING ERRCODE = '42501';
  END IF;
  UPDATE public.ambil_alih_pendataan AS a SET dilihat_at = pg_catalog.now()
   WHERE a.id = p_id AND a.pemegang_lama = v_me_id AND a.dilihat_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'diperbarui', v_n);
END $$;

REVOKE ALL ON FUNCTION public.koordinator_ambil_alih_tiket(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.koordinator_ambil_alih_tiket(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.koordinator_ambil_alih_fo(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.koordinator_ambil_alih_fo(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.ambil_alih_tandai_dilihat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ambil_alih_tandai_dilihat(uuid) TO authenticated;

-- ============================================================
-- 7. Status QR reservasi untuk Front Office (tanpa PII)
-- ============================================================
-- Jendela operasional hanya memuat reservasi HARI INI, sehingga QR lain tidak terbaca lewat RLS. Fungsi ini memberi
-- KATEGORI status saja (tanpa nama/kontak) agar FO dapat memberi tahu pengunjung: tanggal_lain (reservasi untuk tanggal
-- lain), tidak_berlaku (no_show / batal / tanggal sudah lewat), sudah_diproses (sudah check-in/selesai), aktif (hari ini),
-- tidak_ditemukan. Hanya Front Office dan Admin aktif.
CREATE OR REPLACE FUNCTION public.fo_status_qr(p_qr_token text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role   text;
  v_status text;
  v_tgl    date;
  v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Front Office atau Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF p_qr_token IS NULL OR pg_catalog.btrim(p_qr_token) = '' THEN
    RETURN 'tidak_ditemukan';
  END IF;
  SELECT k.status, k.tanggal INTO v_status, v_tgl
  FROM public.kunjungan AS k
  WHERE k.qr_token = pg_catalog.btrim(p_qr_token) AND k.asal = 'reservasi';
  IF NOT FOUND THEN
    RETURN 'tidak_ditemukan';
  END IF;
  IF v_status = 'terjadwal' AND v_tgl > v_hari THEN
    RETURN 'tanggal_lain';
  END IF;
  IF v_status = 'terjadwal' AND v_tgl = v_hari THEN
    RETURN 'aktif';
  END IF;
  IF v_status IN ('terjadwal', 'no_show', 'batal') THEN
    RETURN 'tidak_berlaku';
  END IF;
  RETURN 'sudah_diproses';
END $$;

REVOKE ALL ON FUNCTION public.fo_status_qr(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_status_qr(text) TO authenticated;
