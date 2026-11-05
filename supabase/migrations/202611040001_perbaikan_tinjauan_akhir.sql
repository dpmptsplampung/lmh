-- 202611040001_perbaikan_tinjauan_akhir.sql
-- Perbaikan hasil tinjauan akhir 2026-11-04 (.tim/tinjauan-akhir/KEAMANAN.md, QA-AKSES-FO.md, UI.md UI-04).
-- BELUM diterapkan. Terapkan hanya setelah staging lolos. WAJIB --atomic (pemicu baru dan penggantian fungsi harus
-- berlaku bersama; separuh terap meninggalkan daftar FO tanpa batas tanggal atau pengaduan tanpa penjaga).
-- PRASYARAT (diperiksa blok DO di bawah, berhenti bila kurang): 202611030011 (kirim_saran_publik anonim),
--   202611030013 (penangan pengaduan, linimasa, v_pengaduan_kerja), 202611030014 (operator_aktif, admin_atur_operator),
--   202611030015 (fo_antrean_daftar/fo_kunjungan_daftar/rekap_ringkasan_dilayani) beserta seluruh prasyarat 0015
--   (Fase 3 202610290001/0002, Fase 4, 202611010001/0002/0003/0005).
-- Aplikasi: route /api/saran memakai service client sejak berkas ini; klien Kunjungan memanggil fo_kunjungan_daftar
--   5 argumen (fallback 3 argumen bila PGRST202). Aktivasi dalam satu jendela dengan rilis aplikasi.
-- Rollback manual: docs/rollback-perbaikan-tinjauan-akhir-202611040001.sql (tanpa BEGIN/COMMIT; jalankan --atomic,
--   SEBELUM rollback 0015/0014/0013).
-- Isi:
--   1. P1-1  fo_ambil_pengunjung: FO non-Koordinator ditolak untuk kunjungan dalam jendela daftar (tanggal >= hari ini
--            WIB - 7) yang bukan miliknya (bukan pencatat, tanpa tahap/tiket yang ia tangani). Admin/Koordinator bebas.
--   2. P1-2  kirim_saran_publik hanya service_role (route menegakkan laju per IP + jebakan bot); catat_laju_publik =
--            penghitung laju bersama di anon_rate_limit (hanya service_role) agar batas berlaku lintas instance.
--   3. P2-1  pemicu trg_pengaduan_kolom_kerja (kolom kerja dan identitas pelapor terkunci untuk pengguna login; status
--            hanya penangan/Admin)
--            dan trg_riwayat_status (riwayat klien wajib sama dengan status pengaduan; FO bukan penangan ditolak).
--   4. P2-2 + UI-04  linimasa_pengaduan memeriksa sesi_valid(); lampiran tanggapan membawa id (UUID) stabil.
--            v_pengaduan_kerja menambah ada_bukti (boolean) di akhir, tanpa membuka path.
--   5. P2-3 + QA P2  fo_antrean_daftar/fo_kunjungan_daftar: FO non-Koordinator hanya tanggal [hari ini-7, +1] WIB.
--            fo_kunjungan_daftar menerima p_cari/p_status, disaring sebelum paginasi; overload 3 argumen dibuang.
--   6. QA P1  rekap_pelayanan_inti memaksa unit fo untuk FO non-Koordinator (unit layanan -> kosong).
--   7. QA P2  rekap_ringkasan_dilayani mengecualikan penangan NULL (populasi sama dengan Kinerja Petugas; keputusan PM).
--   8. P2-7  trg_audit_petugas_ubah memuat operator_aktif; admin_atur_operator mengosongkan operator_default saat izin mati.

DO $$
DECLARE
  v_fn text;
  v_kolom text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.fo_ambil_pengunjung(uuid)', 'public.kirim_saran_publik(text,text)', 'public.linimasa_pengaduan(uuid)',
    'public.tangani_pengaduan(uuid)', 'public.ambil_alih_pengaduan(uuid,text)', 'public.jaga_penangan_pengaduan()',
    'public.admin_atur_operator(uuid,boolean)', 'public.fo_antrean_daftar(date,uuid,integer,integer)',
    'public.rekap_ringkasan_dilayani(date,date,text,uuid,boolean)', 'public.rekap_pelayanan_inti(date,date,text,uuid)',
    'public.audit_perubahan()', 'public.staf_lingkup()', 'public.staf_saya()', 'public.sesi_valid()',
    'public.pengaduan_sla(text,date,date)'
  ] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'PRASYARAT: fungsi % belum ada (0011/0013/0014/0015 wajib diterapkan dahulu)', v_fn;
    END IF;
  END LOOP;
  -- Pemeriksaan eksplisit per nama (dibaca tes kontrak):
  IF pg_catalog.to_regprocedure('public.fo_ambil_pengunjung(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.kirim_saran_publik(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.linimasa_pengaduan(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.tangani_pengaduan(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_atur_operator(uuid,boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.fo_antrean_daftar(date,uuid,integer,integer)') IS NULL
     OR pg_catalog.to_regprocedure('public.rekap_ringkasan_dilayani(date,date,text,uuid,boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.rekap_pelayanan_inti(date,date,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.audit_perubahan()') IS NULL
     OR pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL
     OR pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: rantai 0011/0013/0014/0015 belum lengkap';
  END IF;
  FOREACH v_kolom IN ARRAY ARRAY[
    'petugas.operator_aktif', 'petugas.operator_default', 'petugas.koordinator',
    'pengaduan.penangan_id', 'pengaduan.lampiran_path', 'pengaduan.batas_verifikasi', 'pengaduan.batas_penanganan',
    'pengaduan.sumber', 'pengaduan.pelapor_nama', 'pengaduan.pelapor_email', 'pengaduan.kontak',
    'pengaduan_riwayat.jenis', 'pengaduan_riwayat.status_baru', 'anon_rate_limit.user_id', 'anon_rate_limit.action',
    'kunjungan.dibuat_oleh', 'kunjungan.tanggal', 'penanganan.penangan_id', 'tiket_antrean.dilayani_oleh'
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns AS c WHERE c.table_schema = 'public'
      AND c.table_name = pg_catalog.split_part(v_kolom, '.', 1)
      AND c.column_name = pg_catalog.split_part(v_kolom, '.', 2)) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom public.% belum ada', v_kolom;
    END IF;
  END LOOP;
END $$;

-- =====================================================================================
-- 1. P1-1: fo_ambil_pengunjung tidak membuka identitas kunjungan FO lain dalam jendela daftar
-- =====================================================================================
-- Daftar FO (0015) memberi ID kunjungan lintas FO untuk [hari ini-7, +1]; tanpa penjaga ini ID itu bisa ditukar
-- dengan HP/email lewat RPC ini. Pendaftaran ulang pengunjung lama (kunjungan di luar jendela) tetap jalan.
CREATE OR REPLACE FUNCTION public.fo_ambil_pengunjung(p_id uuid)
RETURNS TABLE (nama text, asal_instansi text, kategori text, email text, kontak_hp text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id     uuid;
  v_role   text;
  v_koord  boolean;
  v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_batas  date := v_hari - 730;
  v_jumlah int;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.id, me.role, me.koordinator INTO v_id, v_role, v_koord FROM public.staf_lingkup() AS me;
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

  IF v_role = 'front_office' AND NOT COALESCE(v_koord, false)
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_id AND k.tanggal >= v_hari - 7)
     AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_id AND k.dibuat_oleh = v_id)
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_id AND p.penangan_id = v_id)
     AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_id AND t.dilayani_oleh = v_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: identitas kunjungan Front Office lain dalam 7 hari terakhir tidak dapat diambil; ambil alih dahulu'
      USING ERRCODE = '42501';
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
COMMENT ON FUNCTION public.fo_ambil_pengunjung(uuid) IS
  '202611040001: identitas penuh satu kunjungan untuk pendaftaran ulang; FO/admin; diaudit, 60/10 menit; FO non-Koordinator ditolak untuk kunjungan FO lain dalam 7 hari terakhir.';

-- =====================================================================================
-- 2. P1-2: saran publik hanya lewat route (service role)
-- =====================================================================================
REVOKE ALL ON FUNCTION public.kirim_saran_publik(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran_publik(text, text) TO service_role;

-- Penghitung laju bersama (menggantikan Map per instance di route): satu baris anon_rate_limit per kiriman yang
-- DITERIMA, user_id NULL, action = '<aksi>:<sha256 hex IP>' (IP mentah tidak pernah disimpan). Kunci advisory per
-- action membuat hitung + catat atomik lintas instance/proses. Baris dibersihkan prune_anon_rate_limit (7 hari).
-- check_anon_rate tidak dipakai: ia berkunci auth.uid() (NULL untuk service role) dan hanya membaca, tidak mencatat.
CREATE OR REPLACE FUNCTION public.catat_laju_publik(p_aksi text, p_kunci text, p_maks integer, p_jendela_detik integer)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_action text;
  v_jumlah int;
BEGIN
  IF p_aksi IS NULL OR p_aksi !~ '^[a-z][a-z_.]{2,39}$' OR p_kunci IS NULL OR p_kunci !~ '^[0-9a-f]{64}$'
     OR p_maks IS NULL OR p_maks NOT BETWEEN 1 AND 1000
     OR p_jendela_detik IS NULL OR p_jendela_detik NOT BETWEEN 1 AND 86400 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: aksi, kunci, batas, atau jendela laju tidak valid' USING ERRCODE = '22023';
  END IF;
  v_action := p_aksi || ':' || p_kunci;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_action, 0));
  SELECT pg_catalog.count(*) INTO v_jumlah
  FROM public.anon_rate_limit AS r
  WHERE r.user_id IS NULL AND r.action = v_action
    AND r.created_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_jendela_detik);
  IF v_jumlah >= p_maks THEN
    RETURN false;
  END IF;
  INSERT INTO public.anon_rate_limit (user_id, action) VALUES (NULL, v_action);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.catat_laju_publik(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_laju_publik(text, text, integer, integer) TO service_role;
COMMENT ON FUNCTION public.catat_laju_publik(text, text, integer, integer) IS
  '202611040001: penghitung laju publik bersama (route /api/saran: 5 per IP per 10 menit); true = diterima dan dicatat. Hanya service_role.';

-- =====================================================================================
-- 3. P2-1: satu penangan pengaduan ditegakkan untuk kolom kerja, status, dan riwayat
-- =====================================================================================
-- Nama trigger sengaja diurutkan SETELAH trg_pengaduan_anonim dan SEBELUM trg_pengaduan_penangan (Postgres menjalankan
-- trigger BEFORE berurutan nama): status ditolak sebelum penangan otomatis sempat diisi.
-- Lolos: koneksi tanpa JWT (service role, cron eskalasi, pemilik DB). RPC tangani/ambil_alih hanya mengubah penangan;
-- tanggapi_pengaduan hanya mengubah status/updated_at. Tidak ada jalur ber-JWT sah yang mengubah identitas pelapor.
CREATE OR REPLACE FUNCTION public.jaga_kolom_pengaduan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id    uuid;
  v_role  text;
  v_kolom text;
  v_lama  jsonb;
  v_baru  jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  v_lama := pg_catalog.to_jsonb(OLD);
  v_baru := pg_catalog.to_jsonb(NEW);
  -- Identitas dan rute balasan pelapor (pelapor_nama, pelapor_email, kontak) ikut terkunci: FO bukan penangan tidak
  -- boleh mengalihkan tanggapan resmi ke alamat lain. Pembersihan anonim (trg_pengaduan_anonim, berjalan lebih dulu)
  -- tidak tersentuh karena baris anonim sudah tanpa identitas sejak INSERT.
  FOREACH v_kolom IN ARRAY ARRAY['batas_verifikasi', 'batas_penanganan', 'isi', 'layanan_id', 'jalur', 'sumber',
                                 'nomor_tiket', 'lampiran_path', 'pelapor_nama', 'pelapor_email', 'kontak'] LOOP
    IF (v_baru -> v_kolom) IS DISTINCT FROM (v_lama -> v_kolom) THEN
      -- FK ON DELETE SET NULL saat layanan dihapus (baris layanan sudah tidak ada) bukan perubahan oleh pengguna.
      IF v_kolom = 'layanan_id' AND NEW.layanan_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = OLD.layanan_id) THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION 'KOLOM_TERKUNCI: kolom % pengaduan tidak dapat diubah dari aplikasi', v_kolom
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  IF NEW.status IS DISTINCT FROM OLD.status AND OLD.penangan_id IS NOT NULL THEN
    SELECT me.id, me.role INTO v_id, v_role FROM public.staf_saya() AS me;
    IF v_role IS DISTINCT FROM 'admin' AND OLD.penangan_id IS DISTINCT FROM v_id THEN
      RAISE EXCEPTION 'BUKAN_PENANGAN: status pengaduan hanya diubah penangannya; ambil alih dahulu'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_kolom_pengaduan() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pengaduan_kolom_kerja ON public.pengaduan;
CREATE TRIGGER trg_pengaduan_kolom_kerja
  BEFORE UPDATE ON public.pengaduan
  FOR EACH ROW EXECUTE FUNCTION public.jaga_kolom_pengaduan();

-- Riwayat status yang disisipkan klien (policy pengaduan_riwayat_write) harus mencerminkan status saat itu dan
-- ditulis penangan/Admin. Baris RPC/pemicu (flag lmh.penangan_rpc, mis. jenis otomatis di pemicu BEFORE UPDATE
-- yang melihat status lama) dan koneksi tanpa JWT lolos.
CREATE OR REPLACE FUNCTION public.jaga_riwayat_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status   text;
  v_penangan uuid;
  v_id       uuid;
  v_role     text;
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.jenis = 'status'
     AND COALESCE(pg_catalog.current_setting('lmh.penangan_rpc', true), '') <> 'on' THEN
    SELECT g.status, g.penangan_id INTO v_status, v_penangan FROM public.pengaduan AS g WHERE g.id = NEW.pengaduan_id;
    IF NOT FOUND OR NEW.status_baru IS DISTINCT FROM v_status THEN
      RAISE EXCEPTION 'RIWAYAT_TIDAK_SESUAI: status_baru riwayat harus sama dengan status pengaduan saat ini'
        USING ERRCODE = '42501';
    END IF;
    IF v_penangan IS NOT NULL THEN
      SELECT me.id, me.role INTO v_id, v_role FROM public.staf_saya() AS me;
      IF v_role IS DISTINCT FROM 'admin' AND v_penangan IS DISTINCT FROM v_id THEN
        RAISE EXCEPTION 'BUKAN_PENANGAN: riwayat pengaduan hanya dicatat penangannya; ambil alih dahulu'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_riwayat_status() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_riwayat_status ON public.pengaduan_riwayat;
CREATE TRIGGER trg_riwayat_status
  BEFORE INSERT ON public.pengaduan_riwayat
  FOR EACH ROW EXECUTE FUNCTION public.jaga_riwayat_status();

-- =====================================================================================
-- 4. P2-2 + UI-04: linimasa bersesi sah, lampiran ber-id; daftar kerja tahu ada bukti
-- =====================================================================================
-- Definisi 0013 utuh kecuali: cek sesi_valid() dan 'id' pada tiap lampiran (dipakai
-- GET /api/admin/pengaduan/:id/lampiran?lampiran_id=UUID). Kunci/path tidak pernah dikembalikan.
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
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
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
                 SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', a.id, 'nama', a.nama_asli, 'mime', a.mime, 'ukuran', a.ukuran)
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

-- Definisi 0013 utuh; ada_bukti ditambahkan di AKHIR (CREATE OR REPLACE VIEW hanya boleh menambah kolom di akhir).
CREATE OR REPLACE VIEW public.v_pengaduan_kerja
WITH (security_invoker = true) AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, l.nama AS layanan_nama, g.isi, g.anonim,
       CASE WHEN g.anonim THEN NULL ELSE g.pelapor_nama END AS pelapor_nama,
       (NOT g.anonim AND (g.kontak IS NOT NULL OR (pg_catalog.to_jsonb(g) ->> 'pelapor_email') IS NOT NULL)) AS bisa_dihubungi,
       g.sumber, g.status, g.lampiran_path,
       s.terbuka, s.kelompok, g.batas_verifikasi, g.batas_penanganan, s.batas_aktif, s.sisa_hari_kerja, s.sla_status,
       s.urutan_kerja, g.penangan_id, pt.nama AS penangan_nama, g.penangan_sejak, g.created_at, g.updated_at,
       (g.lampiran_path IS NOT NULL) AS ada_bukti
FROM public.pengaduan AS g
LEFT JOIN public.layanan AS l ON l.id = g.layanan_id
LEFT JOIN public.petugas AS pt ON pt.id = g.penangan_id
CROSS JOIN LATERAL public.pengaduan_sla(g.status, g.batas_verifikasi, g.batas_penanganan) AS s;
REVOKE ALL ON public.v_pengaduan_kerja FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pengaduan_kerja TO authenticated;
COMMENT ON COLUMN public.v_pengaduan_kerja.ada_bukti IS
  '202611040001: true bila pelapor melampirkan bukti; path tidak perlu diproyeksikan ke klien (buka lewat endpoint lampiran berotorisasi).';

-- =====================================================================================
-- 5. P2-3 + QA P2: daftar FO berjendela tanggal; kunjungan disaring sebelum paginasi
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.fo_antrean_daftar(
  p_tanggal date, p_layanan_id uuid DEFAULT NULL,
  p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_koord boolean;
  v_hari date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_total bigint;
  v_selesai bigint;
  v_rata numeric;
  v_rows jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role, me.koordinator INTO v_role, v_koord FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_tanggal IS NULL OR p_batas IS NULL OR p_batas NOT BETWEEN 1 AND 200
     OR p_lewati IS NULL OR p_lewati NOT BETWEEN 0 AND 2000000 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: tanggal, batas, atau halaman tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_role = 'front_office' AND NOT COALESCE(v_koord, false)
     AND (p_tanggal < v_hari - 7 OR p_tanggal > v_hari + 1) THEN
    RAISE EXCEPTION 'TANGGAL_DILUAR_BATAS: Front Office hanya dapat membuka daftar 7 hari terakhir sampai besok'
      USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE t.status = 'selesai'),
         pg_catalog.round(pg_catalog.avg(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60)
           FILTER (WHERE t.status = 'selesai' AND t.waktu_selesai >= t.waktu_mulai_layan))
  INTO v_total, v_selesai, v_rata
  FROM public.tiket_antrean AS t
  WHERE t.tanggal = p_tanggal AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id);

  WITH halaman AS (
    SELECT t.id, t.kunjungan_id, t.layanan_id, t.dilayani_oleh, t.penanganan_asal_id, t.nomor,
           t.nomor_display, t.status, t.waktu_terbit, t.waktu_mulai_layan, t.waktu_selesai
    FROM public.tiket_antrean AS t
    WHERE t.tanggal = p_tanggal AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
    ORDER BY t.nomor, t.id LIMIT p_batas OFFSET p_lewati
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', h.id, 'kunjungan_id', h.kunjungan_id, 'layanan_id', h.layanan_id,
    'dilayani_oleh', h.dilayani_oleh, 'penanganan_asal_id', h.penanganan_asal_id,
    'nomor', h.nomor, 'nomor_display', h.nomor_display, 'status', h.status,
    'waktu_terbit', h.waktu_terbit, 'waktu_mulai_layan', h.waktu_mulai_layan, 'waktu_selesai', h.waktu_selesai,
    'layanan', pg_catalog.jsonb_build_object('nama', l.nama, 'form_pendataan', l.form_pendataan),
    'pelayan', CASE WHEN pg.id IS NOT NULL THEN pg_catalog.jsonb_build_object('nama', pg.nama) END,
    'kunjungan', CASE WHEN k.id IS NOT NULL THEN pg_catalog.jsonb_build_object('nama', k.nama, 'asal', k.asal, 'waktu_masuk', k.waktu_masuk) END,
    'fo_nama', COALESCE(fo.nama, CASE WHEN pembuat.role IN ('front_office', 'admin') THEN pembuat.nama END)
  ) ORDER BY h.nomor, h.id), '[]'::jsonb) INTO v_rows
  FROM halaman AS h
  LEFT JOIN public.kunjungan AS k ON k.id = h.kunjungan_id
  LEFT JOIN public.layanan AS l ON l.id = h.layanan_id
  LEFT JOIN public.petugas AS pg ON pg.id = h.dilayani_oleh
  LEFT JOIN public.petugas AS pembuat ON pembuat.id = k.dibuat_oleh
  LEFT JOIN LATERAL (
    SELECT pf.nama FROM public.penanganan AS p
    JOIN public.petugas AS pf ON pf.id = p.penangan_id
    WHERE p.kunjungan_id = h.kunjungan_id AND p.peran_tahap = 'fo'
    ORDER BY p.tahap_ke DESC LIMIT 1
  ) AS fo ON true;
  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total,
    'statistik', pg_catalog.jsonb_build_object('totalSelesai', v_selesai, 'rataWaktuMenit', COALESCE(v_rata, 0)));
END $$;
REVOKE ALL ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) IS
  '202611040001: daftar antrean kolom aman (0015); FO non-Koordinator hanya tanggal [hari ini-7, +1] WIB (TANGGAL_DILUAR_BATAS).';

-- Overload 3 argumen dibuang agar panggilan PostgREST tidak ambigu; klien lama mendapat PGRST202 lalu memakai fallback.
DROP FUNCTION IF EXISTS public.fo_kunjungan_daftar(date, integer, integer);

CREATE OR REPLACE FUNCTION public.fo_kunjungan_daftar(
  p_tanggal date, p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0,
  p_cari text DEFAULT NULL, p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_koord boolean;
  v_hari date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_cari text := NULLIF(pg_catalog.btrim(p_cari), '');
  v_status text := NULLIF(pg_catalog.btrim(p_status), '');
  v_pola text;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role, me.koordinator INTO v_role, v_koord FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_tanggal IS NULL OR p_batas IS NULL OR p_batas NOT BETWEEN 1 AND 200
     OR p_lewati IS NULL OR p_lewati NOT BETWEEN 0 AND 2000000 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: tanggal, batas, atau halaman tidak valid' USING ERRCODE = '22023';
  END IF;
  IF (v_cari IS NOT NULL AND pg_catalog.char_length(v_cari) > 100)
     OR (v_status IS NOT NULL AND v_status NOT IN ('terjadwal', 'menunggu', 'dilayani', 'selesai', 'batal', 'no_show', 'tidak_terlayani')) THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: pencarian maksimal 100 karakter dan status harus status kunjungan yang sah'
      USING ERRCODE = '22023';
  END IF;
  IF v_role = 'front_office' AND NOT COALESCE(v_koord, false)
     AND (p_tanggal < v_hari - 7 OR p_tanggal > v_hari + 1) THEN
    RAISE EXCEPTION 'TANGGAL_DILUAR_BATAS: Front Office hanya dapat membuka daftar 7 hari terakhir sampai besok'
      USING ERRCODE = '22023';
  END IF;
  IF v_cari IS NOT NULL THEN
    v_pola := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_cari, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  -- Saringan yang sama untuk total dan halaman (total = setelah saring, sebelum paginasi).
  SELECT pg_catalog.count(*) INTO v_total
  FROM public.kunjungan AS k
  WHERE k.tanggal = p_tanggal
    AND (v_status IS NULL OR k.status = v_status)
    AND (v_pola IS NULL OR k.nama ILIKE v_pola OR EXISTS (
      SELECT 1 FROM public.tiket_antrean AS t JOIN public.layanan AS l ON l.id = t.layanan_id
      WHERE t.kunjungan_id = k.id AND l.nama ILIKE v_pola));

  WITH halaman AS (
    SELECT k.id, k.nama, k.asal, k.status, k.waktu_masuk, k.tanggal, k.dibuat_oleh
    FROM public.kunjungan AS k
    WHERE k.tanggal = p_tanggal
      AND (v_status IS NULL OR k.status = v_status)
      AND (v_pola IS NULL OR k.nama ILIKE v_pola OR EXISTS (
        SELECT 1 FROM public.tiket_antrean AS t JOIN public.layanan AS l ON l.id = t.layanan_id
        WHERE t.kunjungan_id = k.id AND l.nama ILIKE v_pola))
    ORDER BY k.waktu_masuk DESC NULLS LAST, k.id LIMIT p_batas OFFSET p_lewati
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', h.id, 'nama', h.nama, 'asal', h.asal, 'status', h.status,
    'waktu_masuk', h.waktu_masuk, 'tanggal', h.tanggal,
    'fo_nama', COALESCE(fo.nama, CASE WHEN pembuat.role IN ('front_office', 'admin') THEN pembuat.nama END),
    'tiket_antrean', COALESCE(tiket.baris, '[]'::jsonb)
  ) ORDER BY h.waktu_masuk DESC NULLS LAST, h.id), '[]'::jsonb) INTO v_rows
  FROM halaman AS h
  LEFT JOIN public.petugas AS pembuat ON pembuat.id = h.dibuat_oleh
  LEFT JOIN LATERAL (
    SELECT pf.nama FROM public.penanganan AS p JOIN public.petugas AS pf ON pf.id = p.penangan_id
    WHERE p.kunjungan_id = h.id AND p.peran_tahap = 'fo'
    ORDER BY p.tahap_ke DESC LIMIT 1
  ) AS fo ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'nomor_display', t.nomor_display, 'waktu_selesai', t.waktu_selesai,
      'layanan', pg_catalog.jsonb_build_object('nama', l.nama)
    ) ORDER BY t.waktu_terbit, t.id) AS baris
    FROM public.tiket_antrean AS t LEFT JOIN public.layanan AS l ON l.id = t.layanan_id
    WHERE t.kunjungan_id = h.id
  ) AS tiket ON true;
  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;
REVOKE ALL ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer, text, text) TO authenticated;
COMMENT ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer, text, text) IS
  '202611040001: daftar kunjungan kolom aman (0015) + p_cari (nama kunjungan/layanan, maks 100) + p_status, disaring sebelum paginasi; FO non-Koordinator hanya [hari ini-7, +1] WIB.';

-- =====================================================================================
-- 6. QA P1: inti rekap memaksa unit fo untuk FO non-Koordinator
-- =====================================================================================
-- Definisi 202610290002 utuh kecuali blok FO di bawah. Mendasari rekap_data_pelayanan, rekap_harian_terpadu,
-- rekap_kinerja_petugas, dan pembilang rekap_ringkasan_dilayani: keempatnya kini satu lingkup.
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
  -- 202611040001: FO biasa hanya pekerjaan FO-nya, juga bila unit tidak dipilih atau unit layanan diminta langsung
  -- (tahap/tiket layanan lama atas namanya, mis. setelah perubahan peran, tidak ikut).
  IF v_role = 'front_office' AND NOT COALESCE(v_koord, false) THEN
    IF p_unit = 'layanan' THEN
      RETURN;
    END IF;
    p_unit := 'fo';
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
REVOKE ALL ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.rekap_pelayanan_inti(date, date, text, uuid) IS
  '202611040001: dasar rekap terpadu (202610290002), lingkup ketat §6.1; FO non-Koordinator dipaksa unit fo (unit layanan -> kosong). Internal.';

-- =====================================================================================
-- 7. QA P2: ringkasan memakai populasi Kinerja Petugas (penangan wajib ada)
-- =====================================================================================
-- Keputusan PM 2026-11-04: pelayanan tanpa penangan (tiket lama tanpa pelayan/pendataan) tidak dihitung pada
-- pembilang maupun penyebut, sama dengan rekap_kinerja_petugas. Selain itu definisi 0015 utuh.
CREATE OR REPLACE FUNCTION public.rekap_ringkasan_dilayani(
  p_dari date, p_sampai date, p_unit text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL, p_tanpa_form boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_layanan uuid;
  v_koord boolean;
  v_saya bigint;
  v_total bigint;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role, me.layanan_id, me.koordinator INTO v_role, v_layanan, v_koord FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  -- FO biasa membandingkan pelayanan FO, bukan kerja Petugas yang menerima eskalasinya.
  IF v_role = 'front_office' AND NOT v_koord AND p_unit IS NULL THEN
    p_unit := 'fo';
  END IF;
  -- Inti juga memvalidasi tanggal <= 366 hari dan unit sebelum kueri total.
  SELECT pg_catalog.count(*) INTO v_saya
  FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
  WHERE i.penangan_id IS NOT NULL
    AND (p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = i.layanan_id AND l.form_pendataan IS NOT NULL))
    AND (v_role <> 'front_office' OR v_koord OR i.unit = 'fo');

  WITH selesai AS (
    SELECT p.peran_tahap AS unit, p.layanan_id, p.penangan_id
    FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
    WHERE p.status = 'selesai'
      AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
      AND k.tanggal BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p.peran_tahap = p_unit)
      AND (p_layanan_id IS NULL OR p.layanan_id = p_layanan_id)
    UNION ALL
    SELECT 'layanan'::text, t.layanan_id, COALESCE(o.petugas_id, pz.petugas_id, t.dilayani_oleh)
    FROM public.tiket_antrean AS t
    LEFT JOIN public.kunjungan AS k ON k.id = t.kunjungan_id
    LEFT JOIN public.pelayanan_oss AS o ON o.tiket_id = t.id
    LEFT JOIN public.pelayanan_perizinan AS pz ON pz.tiket_id = t.id
    WHERE t.status = 'selesai' AND t.waktu_selesai IS NOT NULL
      AND COALESCE(k.tanggal, t.tanggal) BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p_unit = 'layanan')
      AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
      AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)
      AND COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai'
  )
  SELECT pg_catalog.count(*) INTO v_total FROM selesai AS s
  WHERE s.penangan_id IS NOT NULL
    AND (v_role <> 'petugas' OR (s.unit = 'layanan' AND s.layanan_id = v_layanan))
    AND (v_role <> 'front_office' OR v_koord OR s.unit = 'fo')
    AND (p_tanpa_form IS NOT TRUE OR s.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = s.layanan_id AND l.form_pendataan IS NOT NULL));

  RETURN pg_catalog.jsonb_build_object('saya', v_saya, 'total', v_total, 'persen',
    CASE WHEN v_total = 0 THEN 0 ELSE pg_catalog.round(v_saya * 100.0 / v_total, 2) END);
END $$;
REVOKE ALL ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) TO authenticated;
COMMENT ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) IS
  '202611040001: tiga angka saya/total/persen; populasi = pelayanan berpenangan (sama dengan Kinerja Petugas).';

-- =====================================================================================
-- 8. P2-7: operator teraudit; izin mati mengosongkan operator_default
-- =====================================================================================
CREATE OR REPLACE FUNCTION public.admin_atur_operator(p_petugas_id uuid, p_aktif boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_admin uuid;
  v_lama boolean;
  v_default text;
BEGIN
  SELECT me.id INTO v_admin FROM public.staf_saya() AS me WHERE me.role = 'admin';
  IF auth.uid() IS NULL OR v_admin IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_petugas_id IS NULL OR p_aktif IS NULL THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: akun dan penanda operator wajib diisi' USING ERRCODE = '22023';
  END IF;
  SELECT p.operator_aktif, p.operator_default INTO v_lama, v_default
  FROM public.petugas AS p WHERE p.id = p_petugas_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN: akun tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_lama IS DISTINCT FROM p_aktif OR (NOT p_aktif AND v_default IS NOT NULL) THEN
    UPDATE public.petugas
    SET operator_aktif = p_aktif,
        operator_default = CASE WHEN p_aktif THEN operator_default END
    WHERE id = p_petugas_id;
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES (auth.uid(), 'admin', 'akun_operator', 'petugas', p_petugas_id::text,
      pg_catalog.jsonb_build_object('dari', v_lama, 'ke', p_aktif, 'admin_id', v_admin,
        'operator_default_dikosongkan', NOT p_aktif AND v_default IS NOT NULL));
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'operator_aktif', p_aktif);
END $$;
REVOKE ALL ON FUNCTION public.admin_atur_operator(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_atur_operator(uuid, boolean) TO authenticated;

-- Perubahan operator_aktif lewat UPDATE langsung Admin (policy petugas_admin_full) kini juga tercatat.
DROP TRIGGER IF EXISTS trg_audit_petugas_ubah ON public.petugas;
CREATE TRIGGER trg_audit_petugas_ubah AFTER UPDATE OF role, aktif, username, layanan_id, nama, operator_aktif ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_perubahan('id', 'nama', 'role', 'aktif', 'username', 'layanan_id', 'operator_aktif');
