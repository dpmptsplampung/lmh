-- 202610140004_fo_rpc.sql
-- Tahap B (B-DB1, bagian 2 dari 3): RPC alur Front Office -> eskalasi (spec
-- docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §3, §4.6; model data 202610140003). Kontrak lengkap untuk
-- UI (signature, jsonb balasan, kode galat, transisi): docs/analysis/FO-ESKALASI-KONTRAK-RPC.md.
--
-- RPC KLIEN (SECURITY DEFINER, search_path terkunci, REVOKE PUBLIC/anon, GRANT authenticated):
--   Staf (sesi_valid() di semua; identitas dari staf_saya(), BUKAN parameter):
--     fo_mulai_kunjungan(...)            FO/Admin: walk-in -> kunjungan 'dilayani' + penanganan tahap 1 'berjalan'. TANPA tiket.
--     fo_checkin_reservasi(qr)           FO/Admin: reservasi 'terjadwal' (hari ini) -> 'dilayani' + penanganan (saluran qr).
--     fo_tolak_reservasi(qr, alasan)     FO/Admin: reservasi 'terjadwal' -> 'batal' (pengganti tombol Tolak scan lama).
--     fo_selesai(penanganan, topik, catatan)        FO pemilik tahap: selesai di FO -> kunjungan 'selesai'.
--     fo_eskalasi(penanganan, layanan, topik, catatan) FO pemilik tahap: tutup 'dieskalasi', terbit tiket <KODE>-<nnn>,
--                                         tahap layanan 'menunggu', kunjungan 'menunggu', notifikasi petugas layanan.
--     fo_ambil_dari_kotak_masuk(penanganan)         FO/Admin: atomik WHERE status='menunggu' (peran fo).
--     layanan_kembalikan(tiket, catatan, topik?)    pemilik tiket (dilayani_oleh): tiket 'dikembalikan', tahap FO 'menunggu'.
--     admin_alihkan(tiket, layanan, alasan)         Admin: tiket lama 'dialihkan', tiket baru di layanan tujuan, audit_log.
--   Pengunjung (pengganti INSERT visit 'terjadwal' di me/reservasi):
--     reservasi_buat(...)                kunjungan 'terjadwal' (tanpa visit, tanpa tiket); cek tanggal/jadwal/kuota/ganda.
--     reservasi_batalkan(kunjungan)      reservasi milik sendiri 'terjadwal' -> 'batal'.
-- FUNGSI INTERNAL (tanpa GRANT ke anon/authenticated): staf_wajib_sesi, fo_validasi_topik, fo_validasi_catatan,
--   fo_sinkron_visit, fo_notifikasi_tiket.
--
-- KODE GALAT (awal pesan; klien mencocokkan awalan): FORBIDDEN 42501 · SESI_TIDAK_SAH 42501 · BUKAN_PEMILIK 42501 ·
--   NOT_FOUND P0002 · INVALID_STATUS P0001 · SUDAH_DIAMBIL P0001 · BUKAN_TAHAP_FO P0001 · SALURAN_CHAT P0001 ·
--   TIKET_LAMA P0001 · QR_KEDALUWARSA P0001 · BUKAN_HARI_INI P0001 · LAYANAN_TUTUP P0001 · LAYANAN_TIDAK_BUKA P0001 ·
--   KUOTA_PENUH P0001 · RESERVASI_GANDA P0001 · IDEMPOTENSI_BENTROK P0001 · DIVERGENSI P0001 ·
--   DATA_TIDAK_VALID 22023 · TOPIK_WAJIB 22023 · TOPIK_TIDAK_VALID 22023 · CATATAN_WAJIB 22023 ·
--   CATATAN_TERLALU_PANJANG 22023 · ALASAN_WAJIB 22023 · LAYANAN_TIDAK_VALID 22023 · LAYANAN_SAMA 22023 ·
--   TANGGAL_TIDAK_VALID 22023.
--
-- URUTAN KUNCI (sama dengan A3 dan trigger dual-write, mencegah deadlock): visit (legacy) -> kunjungan -> tiket ->
-- penanganan. Semua aksi atas satu kunjungan terserialkan pada kunci baris kunjungan.
-- WAKTU: semua *_at / waktu_* = now() server (S9); tidak ada parameter waktu dari klien.
-- VISIT (WP-24 belum selesai): alur baru TIDAK menulis visit, KECUALI kunjungan reservasi lama yang punya
--   legacy_visit_id (dibuat sebelum cutover): fo_sinkron_visit menyamakan status visit (dilayani/selesai/batal/
--   tidak_terlayani) dengan flag lmh.antrean_rpc agar SKM/notifikasi lama tetap jalan. Hapus bersama WP-24.
--
-- SYARAT: 202610140003_fo_model_data. PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic
-- Idempoten (CREATE OR REPLACE). Rollback: docs/rollback-fo-rpc-202610140004.sql (setelah rollback 202610140005).

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.penanganan') IS NULL OR pg_catalog.to_regclass('public.topik_penanganan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel penanganan/topik_penanganan belum ada (terapkan 202610140003_fo_model_data.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.queue_notifikasi(uuid,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.queue_notifikasi belum ada';
  END IF;
  IF pg_catalog.to_regprocedure('public.is_layanan_buka_jadwal(uuid,date,time without time zone)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.is_layanan_buka_jadwal belum ada (202607290010)';
  END IF;
  IF pg_catalog.to_regprocedure('public.layanan_sudah_tutup(timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.layanan_sudah_tutup belum ada (202610090001)';
  END IF;
  IF pg_catalog.to_regprocedure('public.guard_visit_transisi_layanan()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: penjaga visit A3 belum ada (202610140002)';
  END IF;
END $$;

-- ============================================================
-- 1. Fungsi internal
-- ============================================================
-- Staf aktif dengan peran yang diizinkan + sesi sah; galat FORBIDDEN / SESI_TIDAK_SAH.
CREATE OR REPLACE FUNCTION public.staf_wajib_sesi(
  p_peran   text[],
  OUT o_id      uuid,
  OUT o_role    text,
  OUT o_layanan uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO o_id, o_role, o_layanan FROM public.staf_saya() AS me;
  IF o_id IS NULL OR NOT (o_role = ANY (p_peran)) THEN
    RAISE EXCEPTION 'FORBIDDEN: peran Anda tidak berwenang untuk aksi ini' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
END $$;

-- Topik aktif milik layanan (NULL = FO). Mengembalikan nama topik (disalin ke penanganan.topik).
CREATE OR REPLACE FUNCTION public.fo_validasi_topik(p_topik_id uuid, p_layanan_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_nama text;
BEGIN
  IF p_topik_id IS NULL THEN
    RAISE EXCEPTION 'TOPIK_WAJIB: pilih topik penanganan' USING ERRCODE = '22023';
  END IF;
  SELECT t.nama INTO v_nama
  FROM public.topik_penanganan AS t
  WHERE t.id = p_topik_id AND t.aktif AND t.layanan_id IS NOT DISTINCT FROM p_layanan_id;
  IF v_nama IS NULL THEN
    RAISE EXCEPTION 'TOPIK_TIDAK_VALID: topik tidak aktif atau bukan milik tahap ini' USING ERRCODE = '22023';
  END IF;
  RETURN v_nama;
END $$;

-- Catatan wajib (trim, 1..p_maks karakter).
CREATE OR REPLACE FUNCTION public.fo_validasi_catatan(p_catatan text, p_maks integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text := pg_catalog.btrim(COALESCE(p_catatan, ''));
BEGIN
  IF v = '' THEN
    RAISE EXCEPTION 'CATATAN_WAJIB: catatan singkat wajib diisi' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v) > p_maks THEN
    RAISE EXCEPTION 'CATATAN_TERLALU_PANJANG: catatan maksimal % karakter', p_maks USING ERRCODE = '22023';
  END IF;
  RETURN v;
END $$;

-- Kunjungan reservasi lama (legacy_visit_id): samakan status visit dengan kunjungan untuk status yang memicu efek
-- lama (dilayani: check-in; selesai: SKM/response-rate; batal; tidak_terlayani). 'menunggu' TIDAK disalin (visit tetap
-- 'dilayani' selama antre di layanan; menghindari notifikasi ganda). Pemanggil WAJIB sudah mengunci baris visit.
-- Trigger dual-write menulis ulang kunjungan dengan nilai yang sama; tiket baru tidak punya legacy_visit_id.
CREATE OR REPLACE FUNCTION public.fo_sinkron_visit(p_kunjungan_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_legacy uuid;
  v_status text;
  v_now    timestamptz := pg_catalog.now();
BEGIN
  SELECT k.legacy_visit_id, k.status INTO v_legacy, v_status FROM public.kunjungan AS k WHERE k.id = p_kunjungan_id;
  IF v_legacy IS NULL OR v_status NOT IN ('dilayani', 'selesai', 'batal', 'tidak_terlayani') THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'on', true);
  UPDATE public.visit AS v
     SET status        = v_status,
         waktu_masuk   = CASE WHEN v_status = 'dilayani' THEN COALESCE(v.waktu_masuk, v_now) ELSE v.waktu_masuk END,
         waktu_scan    = CASE WHEN v_status = 'dilayani' THEN COALESCE(v.waktu_scan, v_now) ELSE v.waktu_scan END,
         diarahkan_ke  = CASE WHEN v_status = 'dilayani' THEN COALESCE(v.diarahkan_ke, 'Front Office') ELSE v.diarahkan_ke END,
         waktu_selesai = CASE WHEN v_status = 'selesai' THEN v_now ELSE v.waktu_selesai END
   WHERE v.id = v_legacy AND v.status IS DISTINCT FROM v_status;
  PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'off', true);
END $$;

-- Notifikasi web push ke petugas AKTIF layanan tiket (tanpa PII pengunjung). Mengembalikan jumlah yang diantrekan.
CREATE OR REPLACE FUNCTION public.fo_notifikasi_tiket(p_tiket_id uuid, p_jenis text)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_t record;
  r   record;
  v_n integer := 0;
BEGIN
  SELECT t.id, t.layanan_id, t.nomor_display, l.nama AS layanan_nama INTO v_t
  FROM public.tiket_antrean AS t JOIN public.layanan AS l ON l.id = t.layanan_id
  WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  FOR r IN
    SELECT p.auth_user_id FROM public.petugas AS p
    WHERE p.layanan_id = v_t.layanan_id AND p.role = 'petugas' AND p.aktif = true
  LOOP
    PERFORM public.queue_notifikasi(
      r.auth_user_id, NULL, 'web_push',
      pg_catalog.format('Tiket %s menunggu', v_t.nomor_display),
      CASE WHEN p_jenis = 'dialihkan'
        THEN pg_catalog.format('Tiket %s dialihkan Admin ke antrean %s.', v_t.nomor_display, v_t.layanan_nama)
        ELSE pg_catalog.format('Tiket %s diteruskan Front Office ke antrean %s.', v_t.nomor_display, v_t.layanan_nama)
      END,
      pg_catalog.jsonb_build_object(
        'type', CASE WHEN p_jenis = 'dialihkan' THEN 'tiket_dialihkan' ELSE 'eskalasi_fo' END,
        'tiket_id', v_t.id, 'layanan_id', v_t.layanan_id, 'nomor_display', v_t.nomor_display,
        'url', '/admin/antrian')
    );
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.staf_wajib_sesi(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staf_wajib_sesi(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.fo_validasi_topik(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_validasi_topik(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fo_validasi_catatan(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_validasi_catatan(text, integer) TO service_role;
REVOKE ALL ON FUNCTION public.fo_sinkron_visit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_sinkron_visit(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.fo_notifikasi_tiket(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_notifikasi_tiket(uuid, text) TO service_role;

-- ============================================================
-- 2. fo_mulai_kunjungan: walk-in dilayani FO (tanpa tiket)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_mulai_kunjungan(
  p_nama              text,
  p_asal_instansi     text,
  p_kontak_hp         text DEFAULT NULL,
  p_kategori          text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_keperluan         text DEFAULT NULL,
  p_layanan_saran_id  uuid DEFAULT NULL,
  p_pengunjung_id     uuid DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id    uuid;
  v_me_role  text;
  v_me_lyn   uuid;
  v_now      timestamptz := pg_catalog.now();
  v_tgl      date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_nama     text := pg_catalog.btrim(COALESCE(p_nama, ''));
  v_instansi text := pg_catalog.btrim(COALESCE(p_asal_instansi, ''));
  v_hp       text := NULLIF(pg_catalog.regexp_replace(COALESCE(p_kontak_hp, ''), '[[:space:]-]', '', 'g'), '');
  v_email    text := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), '');
  v_kep      text := NULLIF(pg_catalog.btrim(COALESCE(p_keperluan, '')), '');
  v_kat      text := NULLIF(pg_catalog.btrim(COALESCE(p_kategori, '')), '');
  v_ada      record;
  v_kid      uuid;
  v_pid      uuid;
  v_qr       text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  -- Idempotensi (klik ganda / replay offline).
  IF p_client_request_id IS NOT NULL THEN
    SELECT k.id, k.dibuat_oleh, k.qr_token INTO v_ada FROM public.kunjungan AS k WHERE k.client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_ada.dibuat_oleh IS DISTINCT FROM v_me_id THEN
        RAISE EXCEPTION 'IDEMPOTENSI_BENTROK: client_request_id sudah dipakai staf lain' USING ERRCODE = 'P0001';
      END IF;
      SELECT p.id INTO v_pid FROM public.penanganan AS p WHERE p.kunjungan_id = v_ada.id AND p.tahap_ke = 1;
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_ada', true, 'kunjungan_id', v_ada.id, 'penanganan_id', v_pid, 'qr_token', v_ada.qr_token);
    END IF;
  END IF;

  IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama wajib 3-120 karakter' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_instansi) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: asal/instansi wajib 2-200 karakter' USING ERRCODE = '22023';
  END IF;
  IF v_hp IS NOT NULL AND v_hp !~ '^(\+?62|0)[0-9]{8,14}$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nomor HP tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_kat IS NOT NULL AND v_kat NOT IN ('UMKM', 'Umum', 'Instansi', 'Investor') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: kategori tidak dikenal' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: email tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_kep IS NOT NULL AND pg_catalog.char_length(v_kep) > 500 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan maksimal 500 karakter' USING ERRCODE = '22023';
  END IF;
  IF p_layanan_saran_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_saran_id AND l.aktif) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan saran tidak ada atau nonaktif' USING ERRCODE = '22023';
  END IF;
  IF p_pengunjung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pengunjung AS pg WHERE pg.id = p_pengunjung_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF public.layanan_sudah_tutup() THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: layanan hari ini sudah tutup pukul % WIB', pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, keperluan, layanan_saran_id, client_request_id, dibuat_oleh, created_at, updated_at
  ) VALUES (
    p_pengunjung_id, v_nama, v_hp, 'walk_in', v_qr, v_tgl, v_now, 'dilayani',
    v_instansi, v_kat, v_email, v_kep, p_layanan_saran_id, p_client_request_id, v_me_id, v_now, v_now
  ) RETURNING id INTO v_kid;

  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, penangan_id, status, mulai_at, dibuat_oleh)
  VALUES (v_kid, 1, 'fo', 'walk_in', v_me_id, 'berjalan', v_now, v_me_id)
  RETURNING id INTO v_pid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_ada', false, 'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'qr_token', v_qr, 'mulai_at', v_now);
END $$;

-- ============================================================
-- 3. fo_checkin_reservasi: scan QR reservasi -> dilayani FO
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_checkin_reservasi(p_qr_token text)
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
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_qr      text := pg_catalog.btrim(COALESCE(p_qr_token, ''));
  v_kid     uuid;
  v_legacy  uuid;
  v_k       record;
  v_v_lyn   uuid;
  v_v_kep   text;
  v_v_tuj   text;
  v_v_temu  text;
  v_pid     uuid;
  v_tahap   integer;
  v_lyn     uuid;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT k.id, k.legacy_visit_id INTO v_kid, v_legacy
  FROM public.kunjungan AS k WHERE v_qr <> '' AND k.qr_token = v_qr AND k.asal = 'reservasi';
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi dengan QR ini tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  SELECT k.* INTO v_k FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;

  IF v_k.status = 'no_show' OR (v_k.status = 'terjadwal' AND v_k.tanggal < v_tgl) THEN
    RAISE EXCEPTION 'QR_KEDALUWARSA: reservasi tanggal % sudah kedaluwarsa', v_k.tanggal USING ERRCODE = 'P0001';
  END IF;
  IF v_k.status <> 'terjadwal' THEN
    RAISE EXCEPTION 'INVALID_STATUS: reservasi tidak berstatus terjadwal (status=%)', v_k.status USING ERRCODE = 'P0001';
  END IF;
  IF v_k.tanggal > v_tgl THEN
    RAISE EXCEPTION 'BUKAN_HARI_INI: reservasi untuk tanggal %', v_k.tanggal USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k
     SET status = 'dilayani', waktu_masuk = v_now, updated_at = v_now
   WHERE k.id = v_kid AND k.status = 'terjadwal';

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, penangan_id, status, mulai_at, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'fo', 'qr', v_me_id, 'berjalan', v_now, v_me_id)
  RETURNING id INTO v_pid;

  PERFORM public.fo_sinkron_visit(v_kid);

  -- Data reservasi lama (dibuat lewat visit) dibaca dari visit.
  IF v_legacy IS NOT NULL THEN
    SELECT v.layanan_id, v.keperluan, v.tujuan, v.nama_yang_ditemui INTO v_v_lyn, v_v_kep, v_v_tuj, v_v_temu
    FROM public.visit AS v WHERE v.id = v_legacy;
  END IF;
  v_lyn := COALESCE(v_k.layanan_saran_id, v_v_lyn);

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'kunjungan_id', v_kid,
    'penanganan_id', v_pid,
    'nama', v_k.nama,
    'tanggal', v_k.tanggal,
    'tujuan', COALESCE(v_k.tujuan, v_v_tuj),
    'layanan_saran_id', v_lyn,
    'layanan_saran_nama', (SELECT l.nama FROM public.layanan AS l WHERE l.id = v_lyn),
    'nama_yang_ditemui', COALESCE(v_k.nama_yang_ditemui, v_v_temu),
    'keperluan', COALESCE(v_k.keperluan, v_v_kep),
    'mulai_at', v_now);
END $$;

-- ============================================================
-- 4. fo_tolak_reservasi: reservasi terjadwal -> batal
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_tolak_reservasi(p_qr_token text, p_alasan text)
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
  v_now     timestamptz := pg_catalog.now();
  v_qr      text := pg_catalog.btrim(COALESCE(p_qr_token, ''));
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_kid     uuid;
  v_legacy  uuid;
  v_status  text;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;
  IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan penolakan wajib 5-500 karakter' USING ERRCODE = '22023';
  END IF;

  SELECT k.id, k.legacy_visit_id INTO v_kid, v_legacy
  FROM public.kunjungan AS k WHERE v_qr <> '' AND k.qr_token = v_qr AND k.asal = 'reservasi';
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi dengan QR ini tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  SELECT k.status INTO v_status FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  IF v_status <> 'terjadwal' THEN
    RAISE EXCEPTION 'INVALID_STATUS: reservasi tidak berstatus terjadwal (status=%)', v_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'batal', updated_at = v_now WHERE k.id = v_kid AND k.status = 'terjadwal';
  PERFORM public.fo_sinkron_visit(v_kid);

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (auth.uid(), v_me_role, 'fo_tolak_reservasi', 'kunjungan', v_kid::text,
          pg_catalog.jsonb_build_object('kunjungan_id', v_kid, 'petugas_id', v_me_id, 'alasan', v_alasan),
          pg_catalog.jsonb_build_object('status', 'terjadwal'),
          pg_catalog.jsonb_build_object('status', 'batal'));

  RETURN pg_catalog.jsonb_build_object('ok', true, 'kunjungan_id', v_kid, 'status', 'batal');
END $$;

-- ============================================================
-- 5. fo_selesai: FO menyelesaikan sendiri
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_selesai(p_penanganan_id uuid, p_topik_id uuid, p_catatan text)
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
  v_now     timestamptz := pg_catalog.now();
  v_kid     uuid;
  v_legacy  uuid;
  v_p       record;
  v_topik   text;
  v_catatan text;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT p.kunjungan_id, k.legacy_visit_id INTO v_kid, v_legacy
  FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p WHERE p.id = p_penanganan_id FOR UPDATE;

  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'BUKAN_TAHAP_FO: penanganan ini milik petugas layanan' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.saluran = 'chat' THEN
    RAISE EXCEPTION 'SALURAN_CHAT: penanganan chat ditutup lewat RPC chat (Tahap C)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: penanganan tidak sedang berjalan (status=%)', v_p.status USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: penanganan ini dilayani staf lain' USING ERRCODE = '42501';
  END IF;
  v_topik   := public.fo_validasi_topik(p_topik_id, NULL);
  v_catatan := public.fo_validasi_catatan(p_catatan, 200);

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = p_penanganan_id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
   WHERE k.id = v_kid
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x WHERE x.kunjungan_id = v_kid AND x.status IN ('menunggu', 'berjalan'));
  PERFORM public.fo_sinkron_visit(v_kid);

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'penanganan_id', p_penanganan_id, 'kunjungan_id', v_kid,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_kid), 'selesai_at', v_now);
END $$;

-- ============================================================
-- 6. fo_eskalasi: tutup tahap FO, terbitkan tiket, tahap layanan menunggu
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_eskalasi(
  p_penanganan_id uuid,
  p_layanan_id    uuid,
  p_topik_id      uuid,
  p_catatan       text
)
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
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_kid     uuid;
  v_legacy  uuid;
  v_p       record;
  v_l       record;
  v_topik   text;
  v_catatan text;
  v_tiket   uuid;
  v_nomor   text;
  v_pl      uuid;
  v_tahap   integer;
  v_notif   integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT p.kunjungan_id, k.legacy_visit_id INTO v_kid, v_legacy
  FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p WHERE p.id = p_penanganan_id FOR UPDATE;

  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'BUKAN_TAHAP_FO: penanganan ini milik petugas layanan' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.saluran = 'chat' THEN
    RAISE EXCEPTION 'SALURAN_CHAT: chat diteruskan tanpa tiket lewat RPC chat (Tahap C)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: penanganan tidak sedang berjalan (status=%)', v_p.status USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: penanganan ini dilayani staf lain' USING ERRCODE = '42501';
  END IF;
  v_topik   := public.fo_validasi_topik(p_topik_id, NULL);
  v_catatan := public.fo_validasi_catatan(p_catatan, 200);

  SELECT l.id, l.nama, l.aktif, l.punya_antrean INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_id;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tanpa antrean' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_layanan_buka_jadwal(p_layanan_id, v_tgl, NULL) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini (libur/di luar jadwal standby)', v_l.nama
      USING ERRCODE = 'P0001';
  END IF;
  IF public.layanan_sudah_tutup() THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: layanan hari ini sudah tutup pukul % WIB', pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'dieskalasi', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = p_penanganan_id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  v_tiket := public.terbit_tiket(v_kid, p_layanan_id);
  UPDATE public.tiket_antrean AS t SET penanganan_asal_id = p_penanganan_id WHERE t.id = v_tiket
  RETURNING t.nomor_display INTO v_nomor;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'layanan', p_layanan_id, v_p.saluran, v_tiket, 'menunggu', v_me_id)
  RETURNING id INTO v_pl;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_kid;

  v_notif := public.fo_notifikasi_tiket(v_tiket, 'eskalasi');

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'kunjungan_id', v_kid,
    'penanganan_fo_id', p_penanganan_id,
    'penanganan_layanan_id', v_pl,
    'tiket_id', v_tiket,
    'nomor_display', v_nomor,
    'layanan_id', p_layanan_id,
    'layanan_nama', v_l.nama,
    'petugas_hadir', public.antrean_dibuka(p_layanan_id, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

-- ============================================================
-- 7. fo_ambil_dari_kotak_masuk: atomik WHERE status = 'menunggu'
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_ambil_dari_kotak_masuk(p_penanganan_id uuid)
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
  v_now     timestamptz := pg_catalog.now();
  v_kid     uuid;
  v_legacy  uuid;
  v_cek     record;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT p.kunjungan_id, k.legacy_visit_id INTO v_kid, v_legacy
  FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;

  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now
   WHERE p.id = p_penanganan_id AND p.status = 'menunggu' AND p.peran_tahap = 'fo' AND p.saluran <> 'chat';

  IF NOT FOUND THEN
    SELECT p.status, p.penangan_id, p.peran_tahap, p.saluran, p.mulai_at INTO v_cek
    FROM public.penanganan AS p WHERE p.id = p_penanganan_id;
    IF v_cek.peran_tahap <> 'fo' THEN
      RAISE EXCEPTION 'BUKAN_TAHAP_FO: penanganan ini milik petugas layanan' USING ERRCODE = 'P0001';
    END IF;
    IF v_cek.saluran = 'chat' THEN
      RAISE EXCEPTION 'SALURAN_CHAT: chat diambil lewat RPC chat (Tahap C)' USING ERRCODE = 'P0001';
    END IF;
    IF v_cek.status = 'berjalan' AND v_cek.penangan_id = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'penanganan_id', p_penanganan_id, 'kunjungan_id', v_kid,
        'mulai_at', v_cek.mulai_at);
    END IF;
    IF v_cek.status IN ('berjalan', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: penanganan sudah diambil staf lain' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS: penanganan tidak menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now WHERE k.id = v_kid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'penanganan_id', p_penanganan_id, 'kunjungan_id', v_kid, 'mulai_at', v_now);
END $$;

-- ============================================================
-- 8. layanan_kembalikan: pemilik tiket mengembalikan ke FO
-- ============================================================
CREATE OR REPLACE FUNCTION public.layanan_kembalikan(
  p_tiket_id uuid,
  p_catatan  text,
  p_topik_id uuid DEFAULT NULL
)
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
  v_now     timestamptz := pg_catalog.now();
  v_kid     uuid;
  v_legacy  uuid;
  v_kleg    uuid;
  v_t       record;
  v_p       record;
  v_topik   text;
  v_catatan text;
  v_tahap   integer;
  v_pf      uuid;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['admin', 'petugas']) AS s;

  SELECT t.kunjungan_id, t.legacy_visit_id, k.legacy_visit_id INTO v_kid, v_legacy, v_kleg
  FROM public.tiket_antrean AS t JOIN public.kunjungan AS k ON k.id = t.kunjungan_id WHERE t.id = p_tiket_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket_id) THEN
    RAISE EXCEPTION 'TIKET_LAMA: hanya tiket hasil eskalasi FO yang dapat dikembalikan' USING ERRCODE = 'P0001';
  END IF;

  IF v_kleg IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_kleg FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT t.id, t.status, t.dilayani_oleh, t.layanan_id INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;

  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya tiket yang sedang dilayani yang dapat dikembalikan (status=%)', v_t.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket ini dilayani petugas lain' USING ERRCODE = '42501';
  END IF;
  v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
  IF p_topik_id IS NOT NULL THEN
    v_topik := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
  END IF;

  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket dilayani tanpa tahap penanganan berjalan' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.tiket_antrean AS t
     SET status = 'dikembalikan', waktu_selesai = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'dikembalikan', catatan = v_catatan, topik_id = p_topik_id, topik = v_topik,
         selesai_at = v_now
   WHERE p.id = v_p.id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'fo', v_p.saluran, 'menunggu', v_me_id)
  RETURNING id INTO v_pf;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_kid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'tiket_id', p_tiket_id, 'kunjungan_id', v_kid, 'penanganan_layanan_id', v_p.id,
    'penanganan_fo_id', v_pf, 'waktu_selesai', v_now);
END $$;

-- ============================================================
-- 9. admin_alihkan: Admin memindahkan tiket ke layanan lain
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_alihkan(
  p_tiket_id       uuid,
  p_layanan_tujuan uuid,
  p_alasan         text
)
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
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_kid     uuid;
  v_legacy  uuid;
  v_kleg    uuid;
  v_t       record;
  v_p       record;
  v_l       record;
  v_baru    uuid;
  v_nomor   text;
  v_tahap   integer;
  v_pb      uuid;
  v_notif   integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['admin']) AS s;
  IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan pengalihan wajib 5-500 karakter' USING ERRCODE = '22023';
  END IF;

  SELECT t.kunjungan_id, t.legacy_visit_id, k.legacy_visit_id INTO v_kid, v_legacy, v_kleg
  FROM public.tiket_antrean AS t JOIN public.kunjungan AS k ON k.id = t.kunjungan_id WHERE t.id = p_tiket_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket_id) THEN
    RAISE EXCEPTION 'TIKET_LAMA: hanya tiket hasil eskalasi FO yang dapat dialihkan' USING ERRCODE = 'P0001';
  END IF;

  IF v_kleg IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_kleg FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT t.* INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;

  IF v_t.status NOT IN ('menunggu', 'dipanggil', 'dilayani') THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dapat dialihkan (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  IF p_layanan_tujuan = v_t.layanan_id THEN
    RAISE EXCEPTION 'LAYANAN_SAMA: layanan tujuan sama dengan layanan tiket' USING ERRCODE = '22023';
  END IF;
  SELECT l.id, l.nama, l.aktif, l.punya_antrean INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_tujuan;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tanpa antrean' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket terbuka tanpa tahap penanganan terbuka' USING ERRCODE = 'P0001';
  END IF;

  v_baru := public.terbit_tiket(v_kid, p_layanan_tujuan);
  UPDATE public.tiket_antrean AS t SET penanganan_asal_id = v_t.penanganan_asal_id WHERE t.id = v_baru
  RETURNING t.nomor_display INTO v_nomor;

  UPDATE public.tiket_antrean AS t
     SET status = 'dialihkan', waktu_selesai = v_now, updated_at = v_now, dialihkan_ke = v_baru
   WHERE t.id = p_tiket_id AND t.status = v_t.status;

  UPDATE public.penanganan AS p
     SET status = 'batal', batal_karena = 'dialihkan', selesai_at = v_now,
         catatan = pg_catalog.left('Dialihkan Admin: ' || v_alasan, 1000)
   WHERE p.id = v_p.id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'layanan', p_layanan_tujuan, v_p.saluran, v_baru, 'menunggu', v_me_id)
  RETURNING id INTO v_pb;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_kid;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'admin_alihkan', 'tiket_antrean', p_tiket_id::text,
    pg_catalog.jsonb_build_object('tiket_lama', p_tiket_id, 'tiket_baru', v_baru, 'kunjungan_id', v_kid,
      'layanan_lama', v_t.layanan_id, 'layanan_baru', p_layanan_tujuan, 'status_lama', v_t.status,
      'pemilik_lama', v_t.dilayani_oleh, 'alasan', v_alasan),
    pg_catalog.jsonb_build_object('layanan_id', v_t.layanan_id, 'status', v_t.status, 'dilayani_oleh', v_t.dilayani_oleh),
    pg_catalog.jsonb_build_object('layanan_id', p_layanan_tujuan, 'status', 'dialihkan', 'tiket_baru', v_baru)
  );

  v_notif := public.fo_notifikasi_tiket(v_baru, 'dialihkan');

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'tiket_lama_id', p_tiket_id,
    'tiket_baru_id', v_baru,
    'nomor_display', v_nomor,
    'layanan_id', p_layanan_tujuan,
    'layanan_nama', v_l.nama,
    'penanganan_id', v_pb,
    'petugas_hadir', public.antrean_dibuka(p_layanan_tujuan, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

-- ============================================================
-- 10. Reservasi oleh pengunjung
-- ============================================================
CREATE OR REPLACE FUNCTION public.reservasi_buat(
  p_tujuan            text,
  p_tanggal           date,
  p_layanan_id        uuid DEFAULT NULL,
  p_nama_yang_ditemui text DEFAULT NULL,
  p_keperluan         text DEFAULT NULL,
  p_jam_rencana       time DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_pg      record;
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_tujuan  text := pg_catalog.btrim(COALESCE(p_tujuan, ''));
  v_ditemui text := NULLIF(pg_catalog.btrim(COALESCE(p_nama_yang_ditemui, '')), '');
  v_kep     text := NULLIF(pg_catalog.btrim(COALESCE(p_keperluan, '')), '');
  v_l       record;
  v_jumlah  integer;
  v_kid     uuid;
  v_qr      text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: masuk terlebih dahulu' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.nama, p.no_hp, p.email, p.asal_instansi, p.kategori INTO v_pg
  FROM public.pengunjung AS p WHERE p.auth_user_id = v_uid;
  IF v_pg.id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: profil pengunjung belum ada' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  IF v_tujuan NOT IN ('loket', 'bertemu_seseorang') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: tujuan harus loket atau bertemu_seseorang' USING ERRCODE = '22023';
  END IF;
  IF p_tanggal IS NULL OR p_tanggal < v_tgl OR p_tanggal > v_tgl + 7 THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: tanggal reservasi hari ini sampai 7 hari ke depan' USING ERRCODE = '22023';
  END IF;
  IF EXTRACT(ISODOW FROM p_tanggal) IN (6, 7) THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: reservasi tidak tersedia pada akhir pekan' USING ERRCODE = '22023';
  END IF;
  IF v_kep IS NOT NULL AND pg_catalog.char_length(v_kep) > 500 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan maksimal 500 karakter' USING ERRCODE = '22023';
  END IF;

  IF v_tujuan = 'loket' THEN
    SELECT l.id, l.nama, l.aktif, l.punya_antrean, l.status_tampilan, l.kuota_harian INTO v_l
    FROM public.layanan AS l WHERE l.id = p_layanan_id;
    IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean OR v_l.status_tampilan = 'nonaktif' THEN
      RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tidak tersedia untuk reservasi' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_layanan_buka_jadwal(p_layanan_id, p_tanggal, NULL) THEN
      RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi pada tanggal tersebut', v_l.nama USING ERRCODE = 'P0001';
    END IF;
    v_ditemui := NULL;
  ELSE
    IF v_ditemui IS NULL OR pg_catalog.char_length(v_ditemui) NOT BETWEEN 3 AND 120 THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: nama yang ditemui wajib 3-120 karakter' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Serialkan reservasi per (layanan/tujuan, tanggal) agar kuota dan cek ganda tidak bocor saat serentak.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('lmh.reservasi:' || COALESCE(p_layanan_id::text, v_tujuan) || ':' || p_tanggal::text));

  IF EXISTS (
    SELECT 1 FROM public.kunjungan AS k
    WHERE k.pengunjung_id = v_pg.id AND k.asal = 'reservasi' AND k.status = 'terjadwal' AND k.tanggal = p_tanggal
      AND k.tujuan = v_tujuan AND k.layanan_saran_id IS NOT DISTINCT FROM (CASE WHEN v_tujuan = 'loket' THEN p_layanan_id END)
  ) THEN
    RAISE EXCEPTION 'RESERVASI_GANDA: Anda sudah punya reservasi yang sama pada tanggal ini' USING ERRCODE = 'P0001';
  END IF;

  IF v_tujuan = 'loket' THEN
    IF v_l.kuota_harian IS NOT NULL THEN
      SELECT pg_catalog.count(*)::integer INTO v_jumlah FROM public.kunjungan AS k
      WHERE k.asal = 'reservasi' AND k.layanan_saran_id = p_layanan_id AND k.tanggal = p_tanggal
        AND k.status IN ('terjadwal', 'menunggu', 'dilayani', 'selesai');
      IF v_jumlah >= v_l.kuota_harian THEN
        RAISE EXCEPTION 'KUOTA_PENUH: kuota reservasi % pada tanggal tersebut sudah penuh', v_l.nama USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, keperluan, tujuan, layanan_saran_id, nama_yang_ditemui, jam_rencana,
    created_at, updated_at
  ) VALUES (
    v_pg.id, v_pg.nama, v_pg.no_hp, 'reservasi', v_qr, p_tanggal, v_now, 'terjadwal',
    v_pg.asal_instansi, v_pg.kategori, v_pg.email, v_kep, v_tujuan,
    CASE WHEN v_tujuan = 'loket' THEN p_layanan_id END, v_ditemui, p_jam_rencana,
    v_now, v_now
  ) RETURNING id INTO v_kid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'kunjungan_id', v_kid, 'qr_token', v_qr, 'tanggal', p_tanggal, 'status', 'terjadwal');
END $$;

CREATE OR REPLACE FUNCTION public.reservasi_batalkan(p_kunjungan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_pgid   uuid;
  v_now    timestamptz := pg_catalog.now();
  v_legacy uuid;
  v_k      record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: masuk terlebih dahulu' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_pgid FROM public.pengunjung AS p WHERE p.auth_user_id = v_uid;

  SELECT k.legacy_visit_id INTO v_legacy FROM public.kunjungan AS k
  WHERE k.id = p_kunjungan_id AND v_pgid IS NOT NULL AND k.pengunjung_id = v_pgid AND k.asal = 'reservasi';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  SELECT k.status INTO v_k FROM public.kunjungan AS k WHERE k.id = p_kunjungan_id FOR UPDATE;
  IF v_k.status <> 'terjadwal' THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya reservasi terjadwal yang dapat dibatalkan (status=%)', v_k.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'batal', updated_at = v_now WHERE k.id = p_kunjungan_id AND k.status = 'terjadwal';
  PERFORM public.fo_sinkron_visit(p_kunjungan_id);

  RETURN pg_catalog.jsonb_build_object('ok', true, 'kunjungan_id', p_kunjungan_id, 'status', 'batal');
END $$;

-- ============================================================
-- 11. Hak eksekusi RPC klien
-- ============================================================
REVOKE ALL ON FUNCTION public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.fo_checkin_reservasi(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_checkin_reservasi(text) TO authenticated;
REVOKE ALL ON FUNCTION public.fo_tolak_reservasi(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_tolak_reservasi(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fo_selesai(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_selesai(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fo_eskalasi(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_eskalasi(uuid, uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.fo_ambil_dari_kotak_masuk(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_ambil_dari_kotak_masuk(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.layanan_kembalikan(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_kembalikan(uuid, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_alihkan(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alihkan(uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.reservasi_buat(text, date, uuid, text, text, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservasi_buat(text, date, uuid, text, text, time) TO authenticated;
REVOKE ALL ON FUNCTION public.reservasi_batalkan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservasi_batalkan(uuid) TO authenticated;
