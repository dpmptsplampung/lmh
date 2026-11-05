-- 202611030013_masukan_pengunjung.sql
-- Poin 5 pemilik (Saran dan Pengaduan di dasbor Admin/FO; keputusan final .tim/produk/MASUKAN.md):
--   1. Penangan pengaduan: satu penangan per pengaduan (pengaduan.penangan_id/penangan_sejak), hanya Admin dan
--      Front Office (FO hanya jalur layanan). RPC tangani_pengaduan (idempoten) dan ambil_alih_pengaduan (alasan
--      wajib). Bila Admin/FO mengubah status saat penangan kosong (PATCH /api/admin/pengaduan atau
--      tanggapi_pengaduan 0006), pemanggil otomatis menjadi penangan. Cron eskalasi (tanpa JWT) tidak mengisi.
--      diteruskan_ke (202607290007) TIDAK dipakai: artinya "diteruskan ke", bukan penangan.
--   2. Riwayat penangan di pengaduan_riwayat yang sudah ada: kolom jenis (status|tangani|ambil_alih|otomatis),
--      penangan_lama, penangan_baru; alasan di catatan. Baris non-status dan perubahan penangan hanya lewat
--      RPC/pemicu (penjaga PENANGAN_LEWAT_RPC; policy INSERT FO/Admin lama tetap untuk baris status).
--      Pada baris non-status, status_lama = status_baru = status saat itu (pengisi; status_lama tidak NULL agar
--      pemicu riwayat awal anonim 0010 tidak menyentuhnya).
--   3. SLA hari kerja di server: hari_kerja_antara() (Senin-Jumat, bukan hari_libur, satu sumber dengan jadwal
--      layanan), pengaduan_sla() (batas aktif: baru = batas_verifikasi, terbuka lain = batas_penanganan,
--      tertutup = tanpa SLA; mendekati = sisa 0..2 hari kerja; hari ini = tanggal WIB).
--   4. v_pengaduan_kerja (security_invoker: RLS tabel tetap satu-satunya aturan baca), ringkasan_pengaduan_kerja,
--      linimasa_pengaduan (status + tanggapan 0006 bila ada + penangan, nama staf; tanpa identitas pelapor).
--      v_pengaduan_petugas (0003) diperluas dengan kolom SLA di AKHIR (definisi lain utuh).
--   5. Saran ditinjau: saran.ditinjau_pada/ditinjau_oleh; RPC tandai_saran_ditinjau, tandai_semua_saran_ditinjau;
--      jumlah_saran_belum_ditinjau (lencana menu, mengikuti RLS saran). Petugas layanan tetap tidak membaca saran.
-- Anonimitas (0010/0011): tidak ada kolom identitas pelapor yang dibaca atau disalin; penangan/riwayat hanya
-- berisi staf. Waktu aksi staf adalah waktu nyata aksi itu (bukan waktu kiriman; sama seperti riwayat status).
-- PRASYARAT: hanya objek yang sudah di produksi (202607290007, rbac 202610080001/202610090001, 202610140001,
-- 202611030003). TIDAK bergantung pada 0006/0008/0010/0011: pelapor_email dan pengaduan_tanggapan dibaca dinamis.
-- RLS tiket_antrean/kunjungan tidak disentuh. Tanpa DELETE/DROP TABLE/DROP COLUMN; tanpa BEGIN/COMMIT.
-- DILARANG diterapkan otomatis. ROLLBACK: docs/rollback-masukan-pengunjung-202611030013.sql.

DO $$
DECLARE
  v_kolom text;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer < 150000 THEN
    RAISE EXCEPTION 'PRASYARAT: Postgres 15+ diperlukan (view security_invoker)';
  END IF;
  IF pg_catalog.to_regclass('public.pengaduan') IS NULL
     OR pg_catalog.to_regclass('public.pengaduan_riwayat') IS NULL
     OR pg_catalog.to_regclass('public.saran') IS NULL
     OR pg_catalog.to_regclass('public.petugas') IS NULL
     OR pg_catalog.to_regclass('public.layanan') IS NULL
     OR pg_catalog.to_regclass('public.hari_libur') IS NULL
     OR pg_catalog.to_regclass('public.audit_log') IS NULL
     OR pg_catalog.to_regclass('public.v_pengaduan_petugas') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel/view % belum ada (202607290007/202611030003)',
      'pengaduan/pengaduan_riwayat/saran/petugas/layanan/hari_libur/audit_log/v_pengaduan_petugas';
  END IF;
  FOREACH v_kolom IN ARRAY ARRAY[
    'pengaduan.id', 'pengaduan.nomor_tiket', 'pengaduan.jalur', 'pengaduan.layanan_id', 'pengaduan.isi',
    'pengaduan.kontak', 'pengaduan.anonim', 'pengaduan.status', 'pengaduan.sumber', 'pengaduan.pelapor_nama',
    'pengaduan.batas_verifikasi', 'pengaduan.batas_penanganan', 'pengaduan.lampiran_path',
    'pengaduan.created_at', 'pengaduan.updated_at',
    'pengaduan_riwayat.pengaduan_id', 'pengaduan_riwayat.status_lama', 'pengaduan_riwayat.status_baru',
    'pengaduan_riwayat.catatan', 'pengaduan_riwayat.diubah_oleh', 'pengaduan_riwayat.created_at',
    'saran.id', 'saran.isi', 'saran.layanan_id', 'saran.unit', 'saran.sumber', 'saran.created_at',
    'petugas.id', 'petugas.nama', 'layanan.nama', 'hari_libur.tanggal',
    'audit_log.actor_id', 'audit_log.actor_role', 'audit_log.aksi', 'audit_log.entitas',
    'audit_log.entitas_id', 'audit_log.detail'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.split_part(v_kolom, '.', 1))
        AND a.attname = pg_catalog.split_part(v_kolom, '.', 2)
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom public.% belum ada', v_kolom;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.staf_saya()') IS NULL
     OR pg_catalog.to_regprocedure('public.peran_saya()') IS NULL
     OR pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_layanan(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: staf_saya/peran_saya/sesi_valid/boleh_layanan belum ada (202610080001/202610090001/202610140001)';
  END IF;
END $$;

-- =====================================================================================
-- 1. Kolom baru
-- =====================================================================================
ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS penangan_id uuid REFERENCES public.petugas(id) ON DELETE SET NULL;
ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS penangan_sejak timestamptz;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'pengaduan_penangan_sejak' AND conrelid = 'public.pengaduan'::regclass) THEN
    ALTER TABLE public.pengaduan ADD CONSTRAINT pengaduan_penangan_sejak
      CHECK (penangan_id IS NULL OR penangan_sejak IS NOT NULL);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS pengaduan_penangan ON public.pengaduan (penangan_id) WHERE penangan_id IS NOT NULL;
COMMENT ON COLUMN public.pengaduan.penangan_id IS
  'Admin/Front Office yang menangani pengaduan. Hanya diubah lewat tangani_pengaduan/ambil_alih_pengaduan atau otomatis saat status diubah (202611030013).';

ALTER TABLE public.pengaduan_riwayat ADD COLUMN IF NOT EXISTS jenis text NOT NULL DEFAULT 'status';
ALTER TABLE public.pengaduan_riwayat ADD COLUMN IF NOT EXISTS penangan_lama uuid REFERENCES public.petugas(id) ON DELETE SET NULL;
ALTER TABLE public.pengaduan_riwayat ADD COLUMN IF NOT EXISTS penangan_baru uuid REFERENCES public.petugas(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'pengaduan_riwayat_jenis_check' AND conrelid = 'public.pengaduan_riwayat'::regclass) THEN
    ALTER TABLE public.pengaduan_riwayat ADD CONSTRAINT pengaduan_riwayat_jenis_check
      CHECK (jenis IN ('status', 'tangani', 'ambil_alih', 'otomatis'));
  END IF;
END $$;

ALTER TABLE public.saran ADD COLUMN IF NOT EXISTS ditinjau_pada timestamptz;
ALTER TABLE public.saran ADD COLUMN IF NOT EXISTS ditinjau_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conname = 'saran_ditinjau_konsisten' AND conrelid = 'public.saran'::regclass) THEN
    ALTER TABLE public.saran ADD CONSTRAINT saran_ditinjau_konsisten
      CHECK (ditinjau_oleh IS NULL OR ditinjau_pada IS NOT NULL);
  END IF;
END $$;
-- Lencana dan filter "Belum ditinjau" (daftar terbaru dulu).
CREATE INDEX IF NOT EXISTS saran_belum_ditinjau ON public.saran (created_at DESC) WHERE ditinjau_pada IS NULL;

-- =====================================================================================
-- 2. Hari kerja dan SLA (satu sumber; STABLE karena membaca hari_libur)
-- =====================================================================================
-- Jumlah hari Senin-Jumat yang bukan hari_libur dalam (p_dari, p_sampai]; negatif bila p_sampai < p_dari.
CREATE OR REPLACE FUNCTION public.hari_kerja_antara(p_dari date, p_sampai date)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN p_dari IS NULL OR p_sampai IS NULL THEN NULL
    ELSE (CASE WHEN p_sampai >= p_dari THEN 1 ELSE -1 END) * (
      SELECT pg_catalog.count(*)::integer
      FROM pg_catalog.generate_series(
             (LEAST(p_dari, p_sampai) + 1)::timestamp, GREATEST(p_dari, p_sampai)::timestamp, interval '1 day'
           ) AS d(hari)
      WHERE EXTRACT(ISODOW FROM d.hari) < 6
        AND NOT EXISTS (SELECT 1 FROM public.hari_libur AS hl WHERE hl.tanggal = d.hari::date)
    )
  END
$$;
REVOKE ALL ON FUNCTION public.hari_kerja_antara(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hari_kerja_antara(date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.pengaduan_sla(p_status text, p_batas_verifikasi date, p_batas_penanganan date)
RETURNS TABLE (terbuka boolean, kelompok text, batas_aktif date, sisa_hari_kerja integer, sla_status text, urutan_kerja integer)
LANGUAGE sql
STABLE
SET search_path = pg_catalog, public
AS $$
  WITH d AS (
    SELECT (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date AS hari_ini,
           p_status IN ('baru', 'diverifikasi', 'diproses', 'eskalasi') AS terbuka,
           CASE
             WHEN p_status = 'baru' THEN p_batas_verifikasi
             WHEN p_status IN ('diverifikasi', 'diproses', 'eskalasi') THEN p_batas_penanganan
           END AS batas
  ), s AS (
    SELECT d.*, public.hari_kerja_antara(d.hari_ini, d.batas) AS sisa FROM d
  )
  SELECT s.terbuka,
         CASE WHEN p_status = 'baru' THEN 'baru' WHEN s.terbuka THEN 'diproses' ELSE 'arsip' END,
         s.batas,
         s.sisa,
         CASE
           WHEN s.batas IS NULL THEN NULL
           WHEN s.batas < s.hari_ini THEN 'terlambat'
           WHEN s.sisa BETWEEN 0 AND 2 THEN 'mendekati'
           ELSE 'aman'
         END,
         CASE WHEN p_status = 'baru' THEN 0 WHEN s.terbuka THEN 1 ELSE 2 END
  FROM s
$$;
REVOKE ALL ON FUNCTION public.pengaduan_sla(text, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pengaduan_sla(text, date, date) TO authenticated, service_role;

-- =====================================================================================
-- 3. View kerja (RLS tabel berlaku) dan view petugas diperluas
-- =====================================================================================
CREATE OR REPLACE VIEW public.v_pengaduan_kerja
WITH (security_invoker = true) AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, l.nama AS layanan_nama, g.isi, g.anonim,
       CASE WHEN g.anonim THEN NULL ELSE g.pelapor_nama END AS pelapor_nama,
       (NOT g.anonim AND (g.kontak IS NOT NULL OR (pg_catalog.to_jsonb(g) ->> 'pelapor_email') IS NOT NULL)) AS bisa_dihubungi,
       g.sumber, g.status, g.lampiran_path,
       s.terbuka, s.kelompok, g.batas_verifikasi, g.batas_penanganan, s.batas_aktif, s.sisa_hari_kerja, s.sla_status,
       s.urutan_kerja, g.penangan_id, pt.nama AS penangan_nama, g.penangan_sejak, g.created_at, g.updated_at
FROM public.pengaduan AS g
LEFT JOIN public.layanan AS l ON l.id = g.layanan_id
LEFT JOIN public.petugas AS pt ON pt.id = g.penangan_id
CROSS JOIN LATERAL public.pengaduan_sla(g.status, g.batas_verifikasi, g.batas_penanganan) AS s;
REVOKE ALL ON public.v_pengaduan_kerja FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pengaduan_kerja TO authenticated;

-- Definisi 202611030003 utuh; kolom SLA ditambahkan di akhir (CREATE OR REPLACE VIEW hanya boleh menambah di akhir).
CREATE OR REPLACE VIEW public.v_pengaduan_petugas AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, g.isi, g.anonim, g.status,
       g.batas_verifikasi, g.batas_penanganan, g.created_at, g.updated_at,
       s.terbuka, s.kelompok, s.batas_aktif, s.sisa_hari_kerja, s.sla_status, s.urutan_kerja
FROM public.pengaduan AS g
CROSS JOIN LATERAL public.pengaduan_sla(g.status, g.batas_verifikasi, g.batas_penanganan) AS s
WHERE g.jalur = 'layanan' AND g.sumber <> 'wizard' AND public.peran_saya() = 'petugas' AND public.boleh_layanan(g.layanan_id);
REVOKE ALL ON public.v_pengaduan_petugas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pengaduan_petugas TO authenticated;

-- =====================================================================================
-- 4. Penjaga penangan + penangan otomatis saat status diubah
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.jaga_penangan_pengaduan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id    uuid;
  v_role  text;
  v_flag  text;
BEGIN
  -- Perubahan penangan dari klien (UPDATE langsung lewat policy pengaduan_update) ditolak.
  -- Lolos: RPC (flag transaksi), koneksi tanpa JWT (service role/cron/pemilik DB), dan FK ON DELETE SET NULL
  -- saat petugas dihapus (baris petugas sudah tidak ada).
  IF (NEW.penangan_id IS DISTINCT FROM OLD.penangan_id OR NEW.penangan_sejak IS DISTINCT FROM OLD.penangan_sejak)
     AND COALESCE(pg_catalog.current_setting('lmh.penangan_rpc', true), '') <> 'on'
     AND auth.uid() IS NOT NULL
     AND NOT (NEW.penangan_id IS NULL AND OLD.penangan_id IS NOT NULL
              AND NOT EXISTS (SELECT 1 FROM public.petugas AS pt WHERE pt.id = OLD.penangan_id)) THEN
    RAISE EXCEPTION 'PENANGAN_LEWAT_RPC: penangan pengaduan hanya diubah lewat tangani_pengaduan/ambil_alih_pengaduan'
      USING ERRCODE = '42501';
  END IF;

  -- Penangan otomatis: Admin/FO aktif yang mengubah status saat penangan kosong.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.penangan_id IS NULL THEN
    SELECT me.id, me.role INTO v_id, v_role FROM public.staf_saya() AS me;
    IF v_id IS NOT NULL AND (v_role = 'admin' OR (v_role = 'front_office' AND NEW.jalur = 'layanan')) THEN
      NEW.penangan_id := v_id;
      NEW.penangan_sejak := pg_catalog.now();
      v_flag := pg_catalog.current_setting('lmh.penangan_rpc', true);
      PERFORM pg_catalog.set_config('lmh.penangan_rpc', 'on', true);
      INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan, diubah_oleh, jenis, penangan_lama, penangan_baru)
      VALUES (NEW.id, OLD.status, NEW.status, NULL, v_id, 'otomatis', NULL, v_id);
      PERFORM pg_catalog.set_config('lmh.penangan_rpc', COALESCE(NULLIF(v_flag, ''), 'off'), true);
      INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
      VALUES (auth.uid(), v_role, 'pengaduan_penangan_otomatis', 'pengaduan', NEW.id::text,
              pg_catalog.jsonb_build_object('penangan_baru', v_id, 'status_lama', OLD.status, 'status_baru', NEW.status));
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_penangan_pengaduan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pengaduan_penangan ON public.pengaduan;
CREATE TRIGGER trg_pengaduan_penangan
  BEFORE UPDATE ON public.pengaduan
  FOR EACH ROW EXECUTE FUNCTION public.jaga_penangan_pengaduan();

CREATE OR REPLACE FUNCTION public.jaga_riwayat_penangan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.jenis <> 'status' OR NEW.penangan_lama IS NOT NULL OR NEW.penangan_baru IS NOT NULL)
     AND COALESCE(pg_catalog.current_setting('lmh.penangan_rpc', true), '') <> 'on'
     AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'PENANGAN_LEWAT_RPC: riwayat penangan hanya dicatat lewat tangani_pengaduan/ambil_alih_pengaduan'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_riwayat_penangan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_riwayat_penangan ON public.pengaduan_riwayat;
CREATE TRIGGER trg_riwayat_penangan
  BEFORE INSERT ON public.pengaduan_riwayat
  FOR EACH ROW EXECUTE FUNCTION public.jaga_riwayat_penangan();

-- =====================================================================================
-- 5. RPC penangan
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.tangani_pengaduan(p_pengaduan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id    uuid;
  v_me_role  text;
  v_me_nama  text;
  v_lain     text;
  v_p        public.pengaduan%ROWTYPE;
  v_sejak    timestamptz := pg_catalog.now();
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office yang boleh menangani pengaduan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.pengaduan AS g WHERE g.id = p_pengaduan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: pengaduan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me_role = 'front_office' AND v_p.jalur <> 'layanan' THEN
    RAISE EXCEPTION 'FORBIDDEN: pengaduan jalur integritas hanya untuk Admin' USING ERRCODE = '42501';
  END IF;
  SELECT pt.nama INTO v_me_nama FROM public.petugas AS pt WHERE pt.id = v_me_id;

  IF v_p.penangan_id = v_me_id THEN
    RETURN pg_catalog.jsonb_build_object('pengaduan_id', v_p.id, 'penangan_id', v_me_id, 'penangan_nama', v_me_nama,
                                         'penangan_sejak', v_p.penangan_sejak, 'berubah', false);
  END IF;
  IF v_p.status IN ('selesai', 'ditolak') THEN
    RAISE EXCEPTION 'PENGADUAN_DITUTUP: pengaduan yang sudah selesai atau ditolak tidak dapat ditangani' USING ERRCODE = '55000';
  END IF;
  IF v_p.penangan_id IS NOT NULL THEN
    SELECT pt.nama INTO v_lain FROM public.petugas AS pt WHERE pt.id = v_p.penangan_id;
    RAISE EXCEPTION 'PENANGAN_SUDAH_ADA: pengaduan ini sudah ditangani %', COALESCE(v_lain, 'petugas lain')
      USING ERRCODE = '55000', DETAIL = COALESCE(v_lain, '');
  END IF;

  PERFORM pg_catalog.set_config('lmh.penangan_rpc', 'on', true);
  UPDATE public.pengaduan SET penangan_id = v_me_id, penangan_sejak = v_sejak WHERE id = v_p.id;
  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan, diubah_oleh, jenis, penangan_lama, penangan_baru)
  VALUES (v_p.id, v_p.status, v_p.status, NULL, v_me_id, 'tangani', NULL, v_me_id);
  PERFORM pg_catalog.set_config('lmh.penangan_rpc', 'off', true);

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (auth.uid(), v_me_role, 'pengaduan_tangani', 'pengaduan', v_p.id::text,
          pg_catalog.jsonb_build_object('penangan_baru', v_me_id));

  RETURN pg_catalog.jsonb_build_object('pengaduan_id', v_p.id, 'penangan_id', v_me_id, 'penangan_nama', v_me_nama,
                                       'penangan_sejak', v_sejak, 'berubah', true);
END $$;
REVOKE ALL ON FUNCTION public.tangani_pengaduan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tangani_pengaduan(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.ambil_alih_pengaduan(p_pengaduan_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id    uuid;
  v_me_role  text;
  v_me_nama  text;
  v_lama     text;
  v_alasan   text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_p        public.pengaduan%ROWTYPE;
  v_sejak    timestamptz := pg_catalog.now();
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office yang boleh mengambil alih pengaduan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.char_length(v_alasan) < 5 OR pg_catalog.char_length(v_alasan) > 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih wajib diisi (5-500 karakter)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.pengaduan AS g WHERE g.id = p_pengaduan_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: pengaduan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me_role = 'front_office' AND v_p.jalur <> 'layanan' THEN
    RAISE EXCEPTION 'FORBIDDEN: pengaduan jalur integritas hanya untuk Admin' USING ERRCODE = '42501';
  END IF;
  SELECT pt.nama INTO v_me_nama FROM public.petugas AS pt WHERE pt.id = v_me_id;
  SELECT pt.nama INTO v_lama FROM public.petugas AS pt WHERE pt.id = v_p.penangan_id;

  IF v_p.penangan_id = v_me_id THEN
    RETURN pg_catalog.jsonb_build_object('pengaduan_id', v_p.id, 'penangan_id', v_me_id, 'penangan_nama', v_me_nama,
                                         'penangan_sejak', v_p.penangan_sejak, 'penangan_lama_nama', NULL, 'berubah', false);
  END IF;
  IF v_p.status IN ('selesai', 'ditolak') THEN
    RAISE EXCEPTION 'PENGADUAN_DITUTUP: pengaduan yang sudah selesai atau ditolak tidak dapat diambil alih' USING ERRCODE = '55000';
  END IF;
  IF v_p.penangan_id IS NULL THEN
    RAISE EXCEPTION 'PENANGAN_KOSONG: pengaduan belum punya penangan; gunakan Tangani' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.set_config('lmh.penangan_rpc', 'on', true);
  UPDATE public.pengaduan SET penangan_id = v_me_id, penangan_sejak = v_sejak WHERE id = v_p.id;
  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan, diubah_oleh, jenis, penangan_lama, penangan_baru)
  VALUES (v_p.id, v_p.status, v_p.status, v_alasan, v_me_id, 'ambil_alih', v_p.penangan_id, v_me_id);
  PERFORM pg_catalog.set_config('lmh.penangan_rpc', 'off', true);

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (auth.uid(), v_me_role, 'pengaduan_ambil_alih', 'pengaduan', v_p.id::text,
          pg_catalog.jsonb_build_object('penangan_lama', v_p.penangan_id, 'penangan_baru', v_me_id, 'alasan', v_alasan));

  RETURN pg_catalog.jsonb_build_object('pengaduan_id', v_p.id, 'penangan_id', v_me_id, 'penangan_nama', v_me_nama,
                                       'penangan_sejak', v_sejak, 'penangan_lama_nama', v_lama, 'berubah', true);
END $$;
REVOKE ALL ON FUNCTION public.ambil_alih_pengaduan(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ambil_alih_pengaduan(uuid, text) TO authenticated;

-- =====================================================================================
-- 6. Linimasa dan ringkasan
-- =====================================================================================
-- Status + tanggapan (tabel 0006, dibaca hanya bila ada) + penangan, urut waktu naik. Hanya nama staf;
-- tidak ada identitas pelapor. Pada pengaduan anonim, riwayat awal sudah dibulatkan oleh pemicu 0010.
CREATE OR REPLACE FUNCTION public.linimasa_pengaduan(p_pengaduan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_jalur   text;
  v_arr     jsonb;
  v_tambah  jsonb := '[]'::jsonb;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office yang boleh membaca riwayat pengaduan' USING ERRCODE = '42501';
  END IF;
  SELECT g.jalur INTO v_jalur FROM public.pengaduan AS g WHERE g.id = p_pengaduan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: pengaduan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me_role = 'front_office' AND v_jalur <> 'layanan' THEN
    RAISE EXCEPTION 'FORBIDDEN: pengaduan jalur integritas hanya untuk Admin' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(pg_catalog.jsonb_agg(
           CASE WHEN r.jenis = 'status' THEN
             pg_catalog.jsonb_build_object('jenis', 'status', 'waktu', r.created_at, 'oleh_nama', po.nama,
               'status_lama', r.status_lama, 'status_baru', r.status_baru, 'catatan', r.catatan)
           ELSE
             pg_catalog.jsonb_build_object('jenis', 'penangan', 'aksi', r.jenis, 'waktu', r.created_at,
               'oleh_nama', po.nama, 'dari_nama', pl.nama, 'ke_nama', pb.nama, 'alasan', r.catatan)
           END), '[]'::jsonb)
  INTO v_arr
  FROM public.pengaduan_riwayat AS r
  LEFT JOIN public.petugas AS po ON po.id = r.diubah_oleh
  LEFT JOIN public.petugas AS pl ON pl.id = r.penangan_lama
  LEFT JOIN public.petugas AS pb ON pb.id = r.penangan_baru
  WHERE r.pengaduan_id = p_pengaduan_id;

  IF pg_catalog.to_regclass('public.pengaduan_tanggapan') IS NOT NULL THEN
    IF pg_catalog.to_regclass('public.pengaduan_lampiran') IS NOT NULL THEN
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'jenis', 'tanggapan', 'waktu', t.created_at, 'oleh_nama', po.nama, 'isi', t.isi,
               'status_baru', t.status_baru, 'kirim_email', t.kirim_email,
               'lampiran', COALESCE((
                 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('nama', a.nama_asli, 'mime', a.mime, 'ukuran', a.ukuran)
                                             ORDER BY a.created_at, a.id)
                 FROM public.pengaduan_lampiran AS a WHERE a.tanggapan_id = t.id), '[]'::jsonb))), '[]'::jsonb)
      INTO v_tambah
      FROM public.pengaduan_tanggapan AS t
      LEFT JOIN public.petugas AS po ON po.id = t.dibuat_oleh
      WHERE t.pengaduan_id = p_pengaduan_id;
    ELSE
      SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
               'jenis', 'tanggapan', 'waktu', t.created_at, 'oleh_nama', po.nama, 'isi', t.isi,
               'status_baru', t.status_baru, 'kirim_email', t.kirim_email, 'lampiran', '[]'::jsonb)), '[]'::jsonb)
      INTO v_tambah
      FROM public.pengaduan_tanggapan AS t
      LEFT JOIN public.petugas AS po ON po.id = t.dibuat_oleh
      WHERE t.pengaduan_id = p_pengaduan_id;
    END IF;
  END IF;

  RETURN (
    SELECT COALESCE(pg_catalog.jsonb_agg(x.e ORDER BY (x.e ->> 'waktu')::timestamptz, x.urut), '[]'::jsonb)
    FROM pg_catalog.jsonb_array_elements(v_arr || v_tambah) WITH ORDINALITY AS x(e, urut)
  );
END $$;
REVOKE ALL ON FUNCTION public.linimasa_pengaduan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.linimasa_pengaduan(uuid) TO authenticated;

-- Hitungan ringkasan dari v_pengaduan_kerja (RLS pemanggil berlaku; peran lain mendapat nol).
CREATE OR REPLACE FUNCTION public.ringkasan_pengaduan_kerja(p_jalur text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_jalur IS NOT NULL AND p_jalur NOT IN ('layanan', 'integritas') THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: jalur harus layanan atau integritas' USING ERRCODE = '22023';
  END IF;
  RETURN (
    SELECT pg_catalog.jsonb_build_object(
      'baru',      pg_catalog.count(*) FILTER (WHERE v.kelompok = 'baru'),
      'diproses',  pg_catalog.count(*) FILTER (WHERE v.kelompok = 'diproses'),
      'mendekati', pg_catalog.count(*) FILTER (WHERE v.sla_status = 'mendekati'),
      'terlambat', pg_catalog.count(*) FILTER (WHERE v.sla_status = 'terlambat'),
      'selesai',   pg_catalog.count(*) FILTER (WHERE v.status = 'selesai'),
      'ditolak',   pg_catalog.count(*) FILTER (WHERE v.status = 'ditolak'),
      'terbuka',   pg_catalog.count(*) FILTER (WHERE v.terbuka))
    FROM public.v_pengaduan_kerja AS v
    WHERE p_jalur IS NULL OR v.jalur = p_jalur
  );
END $$;
REVOKE ALL ON FUNCTION public.ringkasan_pengaduan_kerja(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ringkasan_pengaduan_kerja(text) TO authenticated;

-- =====================================================================================
-- 7. Saran ditinjau (klien hanya SELECT pada saran; tulis lewat RPC ini)
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.tandai_saran_ditinjau(p_ids uuid[], p_ditinjau boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_n       integer := 0;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office yang boleh meninjau saran' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_ids IS NULL OR p_ditinjau IS NULL OR pg_catalog.cardinality(p_ids) < 1 OR pg_catalog.cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: kirim 1-500 ID saran' USING ERRCODE = '22023';
  END IF;

  IF p_ditinjau THEN
    UPDATE public.saran AS s SET ditinjau_pada = pg_catalog.now(), ditinjau_oleh = v_me_id
    WHERE s.id = ANY (p_ids) AND s.ditinjau_pada IS NULL;
  ELSE
    UPDATE public.saran AS s SET ditinjau_pada = NULL, ditinjau_oleh = NULL
    WHERE s.id = ANY (p_ids) AND s.ditinjau_pada IS NOT NULL;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES (auth.uid(), v_me_role, CASE WHEN p_ditinjau THEN 'saran_ditinjau' ELSE 'saran_batal_ditinjau' END, 'saran',
            CASE WHEN pg_catalog.cardinality(p_ids) = 1 THEN p_ids[1]::text END,
            pg_catalog.jsonb_build_object('jumlah', v_n,
              'ids', CASE WHEN pg_catalog.cardinality(p_ids) <= 100 THEN pg_catalog.to_jsonb(p_ids) END));
  END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.tandai_saran_ditinjau(uuid[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tandai_saran_ditinjau(uuid[], boolean) TO authenticated;

-- "Tandai semua": saran BELUM ditinjau yang masuk sebelum daftar dimuat (p_sebelum) dan cocok filter.
CREATE OR REPLACE FUNCTION public.tandai_semua_saran_ditinjau(
  p_sebelum    timestamptz,
  p_layanan_id uuid DEFAULT NULL,
  p_sumber     text DEFAULT NULL,
  p_unit       text DEFAULT NULL,
  p_cari       text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_cari    text := NULLIF(pg_catalog.btrim(COALESCE(p_cari, '')), '');
  v_pola    text;
  v_n       integer := 0;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office yang boleh meninjau saran' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_sebelum IS NULL
     OR (p_sumber IS NOT NULL AND p_sumber NOT IN ('wizard', 'publik', 'impor'))
     OR (p_unit IS NOT NULL AND p_unit NOT IN ('layanan', 'fo', 'tidak_diketahui'))
     OR pg_catalog.char_length(COALESCE(v_cari, '')) > 200 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: filter tandai semua tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_cari IS NOT NULL THEN
    v_pola := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_cari, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  UPDATE public.saran AS s SET ditinjau_pada = pg_catalog.now(), ditinjau_oleh = v_me_id
  WHERE s.ditinjau_pada IS NULL
    AND s.created_at <= LEAST(p_sebelum, pg_catalog.now())
    AND (p_layanan_id IS NULL OR s.layanan_id = p_layanan_id)
    AND (p_sumber IS NULL OR s.sumber = p_sumber)
    AND (p_unit IS NULL OR s.unit = p_unit)
    AND (v_pola IS NULL OR s.isi ILIKE v_pola ESCAPE '\');
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n > 0 THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES (auth.uid(), v_me_role, 'saran_ditinjau_semua', 'saran', NULL,
            pg_catalog.jsonb_build_object('jumlah', v_n, 'sebelum', p_sebelum, 'layanan_id', p_layanan_id,
              'sumber', p_sumber, 'unit', p_unit, 'dengan_cari', v_cari IS NOT NULL));
  END IF;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.tandai_semua_saran_ditinjau(timestamptz, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tandai_semua_saran_ditinjau(timestamptz, uuid, text, text, text) TO authenticated;

-- Lencana menu "Saran": mengikuti RLS saran (Admin/FO); peran lain mendapat 0.
CREATE OR REPLACE FUNCTION public.jumlah_saran_belum_ditinjau()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.count(*)::integer FROM public.saran AS s WHERE s.ditinjau_pada IS NULL
$$;
REVOKE ALL ON FUNCTION public.jumlah_saran_belum_ditinjau() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jumlah_saran_belum_ditinjau() TO authenticated;
