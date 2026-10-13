-- 202610140003_fo_model_data.sql
-- Tahap B (B-DB1, bagian 1 dari 3): MODEL DATA alur Front Office -> eskalasi (spec
-- docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §3-§4; rencana
-- docs/superpowers/plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md Tahap B1; kode/topik dari
-- docs/superpowers/specs/2026-10-13-topik-penanganan-draf.md). RPC ada di 202610140004, penyelarasan antrean di
-- 202610140005. Kontrak untuk UI: docs/analysis/FO-ESKALASI-KONTRAK-RPC.md.
--
-- ISI
--   1. layanan.prefiks_antrean = 2 huruf unik (M3, §4.4):
--      - prefiks_antrean_usul(nama, kecuali): kandidat dari nama (inisial 2 kata, 2 huruf awal, huruf awal + huruf
--        berikutnya), lalu AA..ZZ; yang pertama belum dipakai layanan lain. Internal (tanpa GRANT ke klien).
--      - backfill: prefiks yang tidak berbentuk ^[A-Z]{2}$ dikosongkan, lalu (lintasan 1) tabel kode dokumen topik
--        (OS NO BM BL BP IG JI MU SH SM, dicocokkan pola nama, hanya bila kode belum dipakai), (lintasan 2) sisanya
--        auto-generate. Layanan yang SUDAH punya kode 2 huruf valid tidak diubah.
--      - trigger trg_layanan_isi_prefiks (BEFORE INSERT OR UPDATE OF prefiks_antrean): huruf besar + trim; kosong/NULL
--        = auto-generate (dikunci advisory lock transaksi agar dua insert serentak tidak memilih kode sama).
--      - NOT NULL, CHECK ^[A-Z]{2}$ (layanan_prefiks_antrean_format), UNIQUE penuh uq_layanan_prefiks_antrean
--        (menggantikan indeks unik parsial lama uq_layanan_prefiks).
--   2. terbit_tiket(kunjungan, layanan): tanggal tiket = HARI INI WIB (bukan kunjungan.tanggal) sehingga nomor reset
--      harian WIB per layanan; nomor_display = '<KODE>-<nomor 3 digit>' (mis. OS-014; >= 1000 tidak dipotong lagi).
--      Nomor tetap atomik lewat terbit_nomor_antrean (antrean_counter, tidak diubah). Hak tetap service_role saja.
--   3. kunjungan: asal += 'online'; kolom baru chat_sesi_id (FK chat_sesi), selesai_at (diisi trigger dari jam server),
--      data pengunjung walk-in FO (asal_instansi, kategori, email, keperluan; pola visit/WalkinWizard: walk-in TIDAK
--      punya baris pengunjung karena pengunjung.auth_user_id NOT NULL), data reservasi (tujuan, layanan_saran_id,
--      nama_yang_ditemui, jam_rencana), client_request_id (idempotensi), dibuat_oleh (petugas FO).
--      Policy kunjungan_staff_update DICABUT (status kunjungan hanya lewat RPC/trigger definer; src/ tidak menulis
--      kunjungan). kunjungan_insert_public / tiket_insert_public sudah dicabut 202610080001 (di sini DROP IF EXISTS
--      lagi + penjaga: migrasi GAGAL bila masih ada policy INSERT/ALL/UPDATE klien pada kunjungan/tiket_antrean).
--      Trigger dual-write sync_visit_dual_write (SECURITY DEFINER, pemilik tabel) TIDAK terpengaruh RLS dan tidak diubah.
--   4. topik_penanganan (layanan_id NULL = Front Office) + seed FO dan 10 layanan (draf; idempoten WHERE NOT EXISTS).
--   5. penanganan (satu baris per tahap; §4.2) + CHECK konsistensi status, UNIQUE (kunjungan_id, tahap_ke), satu tahap
--      terbuka (menunggu/berjalan) per kunjungan, satu tahap terbuka per tiket, RLS SELECT saja (tulis = RPC).
--   6. tiket_antrean: penanganan_asal_id (FK penanganan), dialihkan_ke (FK tiket), status += dikembalikan, dialihkan.
--
-- DEVIASI DARI SPEC (dicatat di kontrak): penanganan.status punya nilai ke-4 'batal' (+ batal_karena dialihkan |
-- diambil_alih | tidak_terlayani) untuk tahap yang ditutup sistem/Admin tanpa hasil; topik disimpan sebagai topik_id
-- (FK) + topik (teks salinan, tahan rename); kolom created_at/updated_at; kunjungan mendapat kolom data pengunjung.
--
-- SYARAT: 202610140002_tiket_kepemilikan (layanan_mulai), 202610140001 (sesi_valid), 202607300015 (legacy_visit_id),
-- 202610090001 (peran_saya). Penjaga di bagian 0.
-- URUTAN: 202610140003 -> 202610140004 -> 202610140005, ketiganya bersamaan dengan deploy klien Tahap B (cutover di
-- luar jam layanan, antrean kosong; Gerbang G.6). Berkas ini sendiri aman bagi klien lama KECUALI: (a) form Kelola
-- Layanan lama mengizinkan prefiks 1-3 huruf -> kini ditolak CHECK (23514) bila bukan 2 huruf; (b) tidak ada klien
-- yang memakai UPDATE langsung kunjungan (diperiksa: src/ tidak menulis kunjungan).
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic
-- Idempoten. Rollback: docs/rollback-fo-model-data-202610140003.sql (setelah rollback 202610140005 dan 202610140004).
-- Uji perilaku (transaksi di-ROLLBACK, butuh konfirmasi CEO): scripts/test-fo-eskalasi.mjs.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.layanan_mulai(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.layanan_mulai(uuid) belum ada (terapkan 202610140002_tiket_kepemilikan.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.sesi_valid() belum ada (terapkan 202610140001_sesi_staf.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.peran_saya()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.peran_saya() belum ada (terapkan 202610090001_rbac_tahap1.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.terbit_nomor_antrean(uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.terbit_nomor_antrean(uuid,date) belum ada (202607290003)';
  END IF;
  IF pg_catalog.to_regclass('public.chat_sesi') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel public.chat_sesi belum ada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.kunjungan'::regclass AND a.attname = 'legacy_visit_id' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom kunjungan.legacy_visit_id belum ada (202607300015)';
  END IF;
END $$;

-- ============================================================
-- 1. Prefiks antrean 2 huruf
-- ============================================================
CREATE OR REPLACE FUNCTION public.prefiks_antrean_usul(p_nama text, p_kecuali uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_bersih   text;
  v_kata     text[];
  v_huruf    text;
  v_kandidat text[] := ARRAY[]::text[];
  v_k        text;
  i          integer;
  j          integer;
BEGIN
  v_bersih := pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.upper(COALESCE(p_nama, '')), '[^A-Z]+', ' ', 'g'));
  IF v_bersih <> '' THEN
    v_kata  := pg_catalog.regexp_split_to_array(v_bersih, ' ');
    v_huruf := pg_catalog.replace(v_bersih, ' ', '');
    IF pg_catalog.array_length(v_kata, 1) >= 2 THEN
      v_kandidat := pg_catalog.array_append(v_kandidat, pg_catalog.left(v_kata[1], 1) || pg_catalog.left(v_kata[2], 1));
    END IF;
    v_kandidat := pg_catalog.array_append(v_kandidat, pg_catalog.left(v_kata[1], 2));
    FOR j IN 2..pg_catalog.length(v_huruf) LOOP
      v_kandidat := pg_catalog.array_append(v_kandidat, pg_catalog.left(v_huruf, 1) || pg_catalog.substr(v_huruf, j, 1));
    END LOOP;
  END IF;

  FOREACH v_k IN ARRAY v_kandidat LOOP
    IF v_k ~ '^[A-Z]{2}$' AND NOT EXISTS (
      SELECT 1 FROM public.layanan AS l WHERE l.prefiks_antrean = v_k AND l.id IS DISTINCT FROM p_kecuali
    ) THEN
      RETURN v_k;
    END IF;
  END LOOP;

  FOR i IN 65..90 LOOP
    FOR j IN 65..90 LOOP
      v_k := pg_catalog.chr(i) || pg_catalog.chr(j);
      IF NOT EXISTS (
        SELECT 1 FROM public.layanan AS l WHERE l.prefiks_antrean = v_k AND l.id IS DISTINCT FROM p_kecuali
      ) THEN
        RETURN v_k;
      END IF;
    END LOOP;
  END LOOP;

  RAISE EXCEPTION 'PREFIKS_HABIS: semua kode 2 huruf sudah dipakai' USING ERRCODE = 'P0001';
END $$;

REVOKE ALL ON FUNCTION public.prefiks_antrean_usul(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prefiks_antrean_usul(text, uuid) TO service_role;

-- Backfill (sebelum trigger dibuat agar UPDATE di bawah tidak memicu auto-generate).
DROP TRIGGER IF EXISTS trg_layanan_isi_prefiks ON public.layanan;

UPDATE public.layanan AS l
   SET prefiks_antrean = NULL
 WHERE l.prefiks_antrean IS NOT NULL AND l.prefiks_antrean !~ '^[A-Z]{2}$';

DO $$
DECLARE
  r      record;
  v_kode text;
BEGIN
  -- Lintasan 1: tabel kode dokumen topik (hanya bila kode belum dipakai layanan lain).
  FOR r IN
    SELECT l.id, l.nama FROM public.layanan AS l WHERE l.prefiks_antrean IS NULL ORDER BY l.created_at, l.id
  LOOP
    v_kode := CASE
      WHEN r.nama ~* '^\s*helpdesk\s+oss'          THEN 'OS'
      WHEN r.nama ~* '^\s*non[\s-]*oss'            THEN 'NO'
      WHEN r.nama ~* '^\s*balmon'                  THEN 'BM'
      WHEN r.nama ~* '^\s*bank\s+lampung'          THEN 'BL'
      WHEN r.nama ~* '^\s*bpjs'                    THEN 'BP'
      WHEN r.nama ~* '^\s*investment\s+gallery'    THEN 'IG'
      WHEN r.nama ~* 'jasa\s+industri'             THEN 'JI'
      WHEN r.nama ~* '^\s*matchmaking'             THEN 'MU'
      WHEN r.nama ~* '^\s*sertifikasi\s+halal'     THEN 'SH'
      WHEN r.nama ~* '^\s*sertifikasi\s+mutu'      THEN 'SM'
      ELSE NULL
    END;
    IF v_kode IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.layanan AS x WHERE x.prefiks_antrean = v_kode) THEN
      UPDATE public.layanan SET prefiks_antrean = v_kode WHERE id = r.id;
    END IF;
  END LOOP;

  -- Lintasan 2: sisanya auto-generate.
  FOR r IN
    SELECT l.id, l.nama FROM public.layanan AS l WHERE l.prefiks_antrean IS NULL ORDER BY l.created_at, l.id
  LOOP
    UPDATE public.layanan SET prefiks_antrean = public.prefiks_antrean_usul(r.nama, r.id) WHERE id = r.id;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.layanan_isi_prefiks()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  NEW.prefiks_antrean := NULLIF(pg_catalog.upper(pg_catalog.btrim(COALESCE(NEW.prefiks_antrean, ''))), '');
  IF NEW.prefiks_antrean IS NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('lmh.layanan.prefiks_antrean'));
    NEW.prefiks_antrean := public.prefiks_antrean_usul(NEW.nama, NEW.id);
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.layanan_isi_prefiks() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_layanan_isi_prefiks
  BEFORE INSERT OR UPDATE OF prefiks_antrean ON public.layanan
  FOR EACH ROW EXECUTE FUNCTION public.layanan_isi_prefiks();

ALTER TABLE public.layanan ALTER COLUMN prefiks_antrean SET NOT NULL;
ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_prefiks_antrean_format;
ALTER TABLE public.layanan ADD CONSTRAINT layanan_prefiks_antrean_format CHECK (prefiks_antrean ~ '^[A-Z]{2}$');
DROP INDEX IF EXISTS public.uq_layanan_prefiks;
CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_prefiks_antrean ON public.layanan (prefiks_antrean);
COMMENT ON COLUMN public.layanan.prefiks_antrean IS
  'Kode antrean 2 huruf unik (OS, BM, ...). Kosong/NULL saat simpan = dibuat otomatis (trg_layanan_isi_prefiks). Nomor tiket = <KODE>-<nnn>, reset harian WIB per layanan.';

-- ============================================================
-- 2. terbit_tiket: tanggal = hari ini WIB, format <KODE>-<nnn>
-- ============================================================
CREATE OR REPLACE FUNCTION public.terbit_tiket(
  p_kunjungan_id uuid,
  p_layanan_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tiket_id uuid;
  v_tanggal  date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_nomor    integer;
  v_prefiks  text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan_id) THEN
    RAISE EXCEPTION 'kunjungan tidak ditemukan';
  END IF;

  SELECT COALESCE(l.prefiks_antrean, pg_catalog.upper(pg_catalog.substr(l.nama, 1, 2))) INTO v_prefiks
  FROM public.layanan AS l WHERE l.id = p_layanan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'layanan tidak ditemukan';
  END IF;

  -- Nomor atomik per (layanan, tanggal WIB) — QUE-06.
  v_nomor := public.terbit_nomor_antrean(p_layanan_id, v_tanggal);

  INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, waktu_terbit)
  VALUES (
    p_kunjungan_id, p_layanan_id, v_tanggal, v_nomor,
    v_prefiks || '-' || CASE WHEN v_nomor < 1000 THEN pg_catalog.lpad(v_nomor::text, 3, '0') ELSE v_nomor::text END,
    'menunggu', pg_catalog.now()
  )
  RETURNING id INTO v_tiket_id;

  RETURN v_tiket_id;
END $$;

-- Sama dengan 202610080001: hanya trigger/RPC definer (pemilik) dan service_role.
REVOKE ALL ON FUNCTION public.terbit_tiket(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_tiket(uuid, uuid) TO service_role;

-- ============================================================
-- 3. kunjungan: asal online, kolom baru, selesai_at dari jam server, policy
-- ============================================================
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.kunjungan'::regclass AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) ~ '\masal\M' AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'walk_in'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.kunjungan DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.kunjungan ADD CONSTRAINT kunjungan_asal_check CHECK (asal IN ('walk_in', 'reservasi', 'online'));

ALTER TABLE public.kunjungan
  ADD COLUMN IF NOT EXISTS chat_sesi_id      uuid REFERENCES public.chat_sesi(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS selesai_at        timestamptz,
  ADD COLUMN IF NOT EXISTS asal_instansi     text,
  ADD COLUMN IF NOT EXISTS kategori          text,
  ADD COLUMN IF NOT EXISTS email             text,
  ADD COLUMN IF NOT EXISTS keperluan         text,
  ADD COLUMN IF NOT EXISTS tujuan            text,
  ADD COLUMN IF NOT EXISTS layanan_saran_id  uuid REFERENCES public.layanan(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nama_yang_ditemui text,
  ADD COLUMN IF NOT EXISTS jam_rencana       time,
  ADD COLUMN IF NOT EXISTS client_request_id uuid,
  ADD COLUMN IF NOT EXISTS dibuat_oleh       uuid REFERENCES public.petugas(id) ON DELETE SET NULL;

ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_kategori_check;
ALTER TABLE public.kunjungan ADD CONSTRAINT kunjungan_kategori_check
  CHECK (kategori IS NULL OR kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor'));
ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_tujuan_check;
ALTER TABLE public.kunjungan ADD CONSTRAINT kunjungan_tujuan_check
  CHECK (tujuan IS NULL OR tujuan IN ('loket', 'bertemu_seseorang'));
ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_online_chat_check;
ALTER TABLE public.kunjungan ADD CONSTRAINT kunjungan_online_chat_check
  CHECK (asal <> 'online' OR chat_sesi_id IS NOT NULL) NOT VALID;
ALTER TABLE public.kunjungan VALIDATE CONSTRAINT kunjungan_online_chat_check;

CREATE UNIQUE INDEX IF NOT EXISTS uq_kunjungan_client_request_id
  ON public.kunjungan (client_request_id) WHERE client_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kunjungan_chat_sesi ON public.kunjungan (chat_sesi_id) WHERE chat_sesi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kunjungan_status_tanggal ON public.kunjungan (status, tanggal);

COMMENT ON COLUMN public.kunjungan.selesai_at IS 'Waktu SERVER kunjungan masuk status akhir (selesai/batal/no_show/tidak_terlayani); diisi trg_kunjungan_selesai_at.';
COMMENT ON COLUMN public.kunjungan.layanan_saran_id IS 'Layanan yang dipilih saat reservasi (saran tujuan eskalasi FO), bukan tiket.';
COMMENT ON COLUMN public.kunjungan.client_request_id IS 'Idempotensi fo_mulai_kunjungan (klik ganda / replay offline).';

CREATE OR REPLACE FUNCTION public.kunjungan_isi_selesai_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status IN ('selesai', 'batal', 'no_show', 'tidak_terlayani') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.selesai_at := COALESCE(NEW.selesai_at, pg_catalog.now());
    ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
      NEW.selesai_at := pg_catalog.now();
    ELSE
      NEW.selesai_at := OLD.selesai_at;
    END IF;
  ELSE
    NEW.selesai_at := NULL;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.kunjungan_isi_selesai_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kunjungan_selesai_at ON public.kunjungan;
CREATE TRIGGER trg_kunjungan_selesai_at
  BEFORE INSERT OR UPDATE ON public.kunjungan
  FOR EACH ROW EXECUTE FUNCTION public.kunjungan_isi_selesai_at();

-- Tulis kunjungan/tiket hanya lewat RPC/trigger definer.
DROP POLICY IF EXISTS kunjungan_insert_public ON public.kunjungan;
DROP POLICY IF EXISTS tiket_insert_public ON public.tiket_antrean;
DROP POLICY IF EXISTS kunjungan_staff_update ON public.kunjungan;

DO $$
DECLARE
  v text;
BEGIN
  SELECT pg_catalog.string_agg(pol.tablename || '.' || pol.policyname || ' (' || pol.cmd || ')', ', ') INTO v
  FROM pg_catalog.pg_policies AS pol
  WHERE pol.schemaname = 'public' AND pol.tablename IN ('kunjungan', 'tiket_antrean')
    AND pol.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  IF v IS NOT NULL THEN
    RAISE EXCEPTION 'PENJAGA: masih ada policy tulis klien pada kunjungan/tiket_antrean: % (tulis harus lewat RPC)', v;
  END IF;
END $$;

-- ============================================================
-- 4. topik_penanganan (layanan_id NULL = Front Office)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.topik_penanganan (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id uuid        REFERENCES public.layanan(id) ON DELETE CASCADE,
  nama       text        NOT NULL CHECK (char_length(btrim(nama)) BETWEEN 2 AND 100),
  aktif      boolean     NOT NULL DEFAULT true,
  urut       integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_topik_penanganan_nama
  ON public.topik_penanganan (COALESCE(layanan_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(nama)));
CREATE INDEX IF NOT EXISTS idx_topik_penanganan_layanan ON public.topik_penanganan (layanan_id, aktif, urut);

COMMENT ON TABLE public.topik_penanganan IS
  'Daftar topik penanganan. layanan_id NULL = topik Front Office; terisi = topik petugas layanan itu. Admin mengelola; nonaktifkan (aktif=false) alih-alih menghapus topik yang sudah dipakai.';

DROP TRIGGER IF EXISTS trg_topik_penanganan_updated ON public.topik_penanganan;
CREATE TRIGGER trg_topik_penanganan_updated
  BEFORE UPDATE ON public.topik_penanganan
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.topik_penanganan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.topik_penanganan FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.topik_penanganan TO authenticated;
GRANT ALL ON TABLE public.topik_penanganan TO service_role;

DROP POLICY IF EXISTS topik_penanganan_staf_select ON public.topik_penanganan;
CREATE POLICY topik_penanganan_staf_select ON public.topik_penanganan FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'petugas', 'front_office'));
DROP POLICY IF EXISTS topik_penanganan_admin_tulis ON public.topik_penanganan;
CREATE POLICY topik_penanganan_admin_tulis ON public.topik_penanganan FOR ALL TO authenticated
  USING (public.peran_saya() = 'admin')
  WITH CHECK (public.peran_saya() = 'admin');

-- Seed FO (draf dokumen topik §1).
INSERT INTO public.topik_penanganan (layanan_id, nama, urut)
SELECT NULL, s.nama, s.urut
FROM (VALUES
  ('Informasi perizinan/syarat', 1),
  ('Status permohonan', 2),
  ('Pendaftaran atau kendala akun OSS', 3),
  ('Konsultasi investasi', 4),
  ('Kendala teknis (perlu eskalasi)', 5),
  ('Pengaduan atau saran', 6),
  ('Lainnya', 99)
) AS s (nama, urut)
WHERE NOT EXISTS (
  SELECT 1 FROM public.topik_penanganan AS t WHERE t.layanan_id IS NULL AND lower(btrim(t.nama)) = lower(s.nama)
);

-- Seed per layanan (draf dokumen topik §3; dicocokkan pola nama; layanan yang tidak ada dilewati).
INSERT INTO public.topik_penanganan (layanan_id, nama, urut)
SELECT l.id, s.nama, s.urut
FROM (VALUES
  ('^\s*helpdesk\s+oss', 'Pendaftaran/aktivasi akun OSS', 1),
  ('^\s*helpdesk\s+oss', 'Lupa kata sandi / verifikasi akun', 2),
  ('^\s*helpdesk\s+oss', 'Penerbitan NIB', 3),
  ('^\s*helpdesk\s+oss', 'Perubahan data NIB/usaha', 4),
  ('^\s*helpdesk\s+oss', 'Pemilihan KBLI', 5),
  ('^\s*helpdesk\s+oss', 'Perizinan berusaha berbasis risiko', 6),
  ('^\s*helpdesk\s+oss', 'Kendala sistem OSS', 7),
  ('^\s*helpdesk\s+oss', 'Lainnya', 99),
  ('^\s*non[\s-]*oss', 'Pendaftaran akun SiCantik', 1),
  ('^\s*non[\s-]*oss', 'Pengajuan permohonan izin non-OSS', 2),
  ('^\s*non[\s-]*oss', 'Status/pelacakan permohonan', 3),
  ('^\s*non[\s-]*oss', 'Persyaratan dokumen', 4),
  ('^\s*non[\s-]*oss', 'Revisi atau penolakan permohonan', 5),
  ('^\s*non[\s-]*oss', 'Kendala sistem', 6),
  ('^\s*non[\s-]*oss', 'Lainnya', 99),
  ('^\s*balmon', 'Informasi perizinan/regulasi', 1),
  ('^\s*balmon', 'Persyaratan dan prosedur', 2),
  ('^\s*balmon', 'Status permohonan', 3),
  ('^\s*balmon', 'Pengaduan atau gangguan', 4),
  ('^\s*balmon', 'Konsultasi teknis', 5),
  ('^\s*balmon', 'Lainnya', 99),
  ('^\s*bank\s+lampung', 'Informasi produk pembiayaan usaha', 1),
  ('^\s*bank\s+lampung', 'Pembiayaan/kredit UMKM', 2),
  ('^\s*bank\s+lampung', 'Pembukaan rekening', 3),
  ('^\s*bank\s+lampung', 'Persyaratan dan prosedur', 4),
  ('^\s*bank\s+lampung', 'Status pengajuan', 5),
  ('^\s*bank\s+lampung', 'Lainnya', 99),
  ('^\s*bpjs', 'Pendaftaran peserta', 1),
  ('^\s*bpjs', 'Perubahan data peserta', 2),
  ('^\s*bpjs', 'Status kepesertaan', 3),
  ('^\s*bpjs', 'Iuran/tunggakan', 4),
  ('^\s*bpjs', 'Keluhan layanan', 5),
  ('^\s*bpjs', 'Lainnya', 99),
  ('^\s*investment\s+gallery', 'Informasi peluang investasi', 1),
  ('^\s*investment\s+gallery', 'Dokumen/profil investasi', 2),
  ('^\s*investment\s+gallery', 'Konsultasi investor', 3),
  ('^\s*investment\s+gallery', 'Permintaan data/peta potensi', 4),
  ('^\s*investment\s+gallery', 'Kunjungan atau pertemuan investor', 5),
  ('^\s*investment\s+gallery', 'Lainnya', 99),
  ('jasa\s+industri', 'Informasi layanan', 1),
  ('jasa\s+industri', 'Pengajuan layanan', 2),
  ('jasa\s+industri', 'Status permohonan', 3),
  ('jasa\s+industri', 'Persyaratan dan prosedur', 4),
  ('jasa\s+industri', 'Konsultasi teknis', 5),
  ('jasa\s+industri', 'Lainnya', 99),
  ('^\s*matchmaking', 'Pendaftaran UMKM', 1),
  ('^\s*matchmaking', 'Pembaruan profil UMKM', 2),
  ('^\s*matchmaking', 'Permintaan pemasok dari perusahaan', 3),
  ('^\s*matchmaking', 'Pencocokan UMKM-perusahaan', 4),
  ('^\s*matchmaking', 'Kendala katalog/sistem', 5),
  ('^\s*matchmaking', 'Lainnya', 99),
  ('^\s*sertifikasi\s+halal', 'Pengajuan sertifikasi halal', 1),
  ('^\s*sertifikasi\s+halal', 'Pendampingan pengajuan', 2),
  ('^\s*sertifikasi\s+halal', 'Persyaratan dokumen', 3),
  ('^\s*sertifikasi\s+halal', 'Status permohonan', 4),
  ('^\s*sertifikasi\s+halal', 'Perpanjangan/perubahan', 5),
  ('^\s*sertifikasi\s+halal', 'Kendala sistem', 6),
  ('^\s*sertifikasi\s+halal', 'Lainnya', 99),
  ('^\s*sertifikasi\s+mutu', 'Pengajuan sertifikat', 1),
  ('^\s*sertifikasi\s+mutu', 'Persyaratan dan prosedur', 2),
  ('^\s*sertifikasi\s+mutu', 'Status permohonan', 3),
  ('^\s*sertifikasi\s+mutu', 'Inspeksi/audit', 4),
  ('^\s*sertifikasi\s+mutu', 'Perpanjangan', 5),
  ('^\s*sertifikasi\s+mutu', 'Lainnya', 99)
) AS s (pola, nama, urut)
JOIN public.layanan AS l ON l.nama ~* s.pola
WHERE NOT EXISTS (
  SELECT 1 FROM public.topik_penanganan AS t WHERE t.layanan_id = l.id AND lower(btrim(t.nama)) = lower(s.nama)
);

-- ============================================================
-- 5. penanganan (satu baris per tahap)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.penanganan (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kunjungan_id uuid        NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  tahap_ke     integer     NOT NULL CHECK (tahap_ke >= 1),
  peran_tahap  text        NOT NULL CHECK (peran_tahap IN ('fo', 'layanan')),
  layanan_id   uuid        REFERENCES public.layanan(id),
  saluran      text        NOT NULL CHECK (saluran IN ('walk_in', 'qr', 'chat')),
  penangan_id  uuid        REFERENCES public.petugas(id),
  tiket_id     uuid        REFERENCES public.tiket_antrean(id),
  topik_id     uuid        REFERENCES public.topik_penanganan(id) ON DELETE SET NULL,
  topik        text,
  hasil        text        CHECK (hasil IN ('selesai', 'dieskalasi', 'dikembalikan')),
  catatan      text,
  status       text        NOT NULL DEFAULT 'menunggu' CHECK (status IN ('menunggu', 'berjalan', 'selesai', 'batal')),
  batal_karena text        CHECK (batal_karena IN ('dialihkan', 'diambil_alih', 'tidak_terlayani')),
  mulai_at     timestamptz,
  selesai_at   timestamptz,
  chat_sesi_id uuid        REFERENCES public.chat_sesi(id) ON DELETE SET NULL,
  dibuat_oleh  uuid        REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT penanganan_tahap_unik UNIQUE (kunjungan_id, tahap_ke),
  CONSTRAINT penanganan_peran_layanan CHECK (
    (peran_tahap = 'fo' AND layanan_id IS NULL) OR (peran_tahap = 'layanan' AND layanan_id IS NOT NULL)
  ),
  CONSTRAINT penanganan_tiket_peran CHECK (
    (peran_tahap = 'fo' AND tiket_id IS NULL)
    OR (peran_tahap = 'layanan' AND (tiket_id IS NOT NULL OR saluran = 'chat'))
  ),
  CONSTRAINT penanganan_chat CHECK (chat_sesi_id IS NULL OR saluran = 'chat'),
  CONSTRAINT penanganan_status_konsisten CHECK (
    (status = 'menunggu' AND penangan_id IS NULL AND mulai_at IS NULL AND selesai_at IS NULL
       AND hasil IS NULL AND batal_karena IS NULL)
    OR (status = 'berjalan' AND penangan_id IS NOT NULL AND mulai_at IS NOT NULL AND selesai_at IS NULL
       AND hasil IS NULL AND batal_karena IS NULL)
    OR (status = 'selesai' AND penangan_id IS NOT NULL AND mulai_at IS NOT NULL AND selesai_at IS NOT NULL
       AND hasil IS NOT NULL AND batal_karena IS NULL
       AND catatan IS NOT NULL AND btrim(catatan) <> ''
       AND (hasil = 'dikembalikan' OR (topik IS NOT NULL AND btrim(topik) <> '')))
    OR (status = 'batal' AND selesai_at IS NOT NULL AND hasil IS NULL AND batal_karena IS NOT NULL)
  ),
  CONSTRAINT penanganan_waktu CHECK (selesai_at IS NULL OR mulai_at IS NULL OR selesai_at >= mulai_at),
  CONSTRAINT penanganan_catatan_panjang CHECK (
    catatan IS NULL OR char_length(catatan) <= CASE WHEN peran_tahap = 'fo' THEN 200 ELSE 1000 END
  )
);

COMMENT ON TABLE public.penanganan IS
  'Satu baris per tahap penanganan kunjungan (FO atau petugas layanan). Ditulis HANYA oleh RPC SECURITY DEFINER (fo_*, layanan_*, admin_*); klien hanya SELECT (RLS). mulai_at/selesai_at = jam server.';
COMMENT ON COLUMN public.penanganan.status IS
  'menunggu (kotak masuk FO / antrean layanan) | berjalan (penangan_id sedang melayani) | selesai (hasil terisi) | batal (ditutup sistem/Admin, lihat batal_karena).';
COMMENT ON COLUMN public.penanganan.topik IS 'Salinan nama topik saat ditutup (tahan rename topik_penanganan).';

-- Satu tahap terbuka per kunjungan; satu tahap terbuka per tiket.
CREATE UNIQUE INDEX IF NOT EXISTS uq_penanganan_terbuka_per_kunjungan
  ON public.penanganan (kunjungan_id) WHERE status IN ('menunggu', 'berjalan');
CREATE UNIQUE INDEX IF NOT EXISTS uq_penanganan_terbuka_per_tiket
  ON public.penanganan (tiket_id) WHERE tiket_id IS NOT NULL AND status IN ('menunggu', 'berjalan');
CREATE INDEX IF NOT EXISTS idx_penanganan_kotak_masuk_fo
  ON public.penanganan (created_at) WHERE status = 'menunggu' AND peran_tahap = 'fo';
CREATE INDEX IF NOT EXISTS idx_penanganan_penangan ON public.penanganan (penangan_id, mulai_at DESC);
CREATE INDEX IF NOT EXISTS idx_penanganan_layanan_status ON public.penanganan (layanan_id, status);
CREATE INDEX IF NOT EXISTS idx_penanganan_tiket ON public.penanganan (tiket_id) WHERE tiket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_penanganan_peran_mulai ON public.penanganan (peran_tahap, mulai_at);

DROP TRIGGER IF EXISTS trg_penanganan_updated ON public.penanganan;
CREATE TRIGGER trg_penanganan_updated
  BEFORE UPDATE ON public.penanganan
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper RLS: siapa boleh membaca baris penanganan (dipanggil per baris; definer agar tidak rekursif).
--   admin: semua. front_office: miliknya, kotak masuk FO (menunggu, peran fo), dan tahap lain dari kunjungan yang
--   sama (konteks). petugas: tahap layanannya dan tahap lain dari kunjungan yang punya tahap di layanannya (konteks,
--   mis. catatan eskalasi FO). Pengunjung/anon: tidak.
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
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_saya() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  IF v_role = 'front_office' THEN
    IF p_penangan = v_id OR (p_peran_tahap = 'fo' AND p_status = 'menunggu') THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p
      WHERE p.kunjungan_id = p_kunjungan
        AND (p.penangan_id = v_id OR (p.peran_tahap = 'fo' AND p.status = 'menunggu'))
    );
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;

ALTER TABLE public.penanganan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.penanganan FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.penanganan TO authenticated;
GRANT ALL ON TABLE public.penanganan TO service_role;

-- Sengaja TANPA policy INSERT/UPDATE/DELETE: tulis hanya lewat RPC SECURITY DEFINER.
DROP POLICY IF EXISTS penanganan_staf_select ON public.penanganan;
CREATE POLICY penanganan_staf_select ON public.penanganan FOR SELECT TO authenticated
  USING (public.boleh_penanganan(kunjungan_id, peran_tahap, layanan_id, penangan_id, status));

-- Realtime (postgres_changes menghormati RLS) untuk kotak masuk FO / antrean petugas.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'penanganan') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.penanganan;
  END IF;
END $$;
ALTER TABLE public.penanganan REPLICA IDENTITY FULL;

-- ============================================================
-- 6. tiket_antrean: penanganan_asal_id, dialihkan_ke, status dikembalikan/dialihkan
-- ============================================================
ALTER TABLE public.tiket_antrean
  ADD COLUMN IF NOT EXISTS penanganan_asal_id uuid REFERENCES public.penanganan(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dialihkan_ke       uuid REFERENCES public.tiket_antrean(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.tiket_antrean.penanganan_asal_id IS 'Tahap FO yang melahirkan tiket ini (fo_eskalasi). NULL = tiket lama (visit/dual-write).';
COMMENT ON COLUMN public.tiket_antrean.dialihkan_ke IS 'Tiket pengganti bila status dialihkan (admin_alihkan).';

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.tiket_antrean'::regclass AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) ~ '\mstatus\M' AND pg_catalog.pg_get_constraintdef(c.oid) ~ 'menunggu'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.tiket_antrean DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;
ALTER TABLE public.tiket_antrean ADD CONSTRAINT tiket_antrean_status_check
  CHECK (status IN ('menunggu', 'dipanggil', 'dilayani', 'selesai', 'batal', 'no_show', 'tidak_terlayani',
                    'dikembalikan', 'dialihkan'));
CREATE INDEX IF NOT EXISTS idx_tiket_penanganan_asal ON public.tiket_antrean (penanganan_asal_id)
  WHERE penanganan_asal_id IS NOT NULL;
