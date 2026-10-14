-- Rollback manual migrasi 202610140007_wp24_akhiri_dual_write.sql (WP-24: kembali ke dual-write visit).
-- Terapkan ATOMIK (dry-run dulu), SETELAH rollback 202610140008 dan SEBELUM rollback 202610140006/0005/0004/0003/0002:
--   node scripts/apply-migration.mjs docs/rollback-wp24-akhiri-dual-write-202610140007.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-wp24-akhiri-dual-write-202610140007.sql --atomic
--
-- JENDELA ROLLBACK (lihat docs/RUNBOOK_FO_ESKALASI.md bagian WP-24): rollback ini hanya aman (a) di luar jam layanan,
-- (b) bersama pengembalian klien yang menulis visit, dan (c) sebaiknya sebelum hari kerja pertama setelah cutover.
-- Sesudah kunjungan/tiket alur baru tercipta, rollback TETAP berfungsi untuk kunjungan baru (mereka tidak punya visit;
-- RPC 0004/0005 yang dipulihkan menangani kunjungan tanpa legacy_visit_id), tetapi SKM untuk kunjungan baru akan
-- kembali mati (get_skm_context membaca visit lagi) sampai migrasi ini diterapkan ulang.
--
-- Yang dikembalikan (salinan PERSIS, dirakit dari berkas sumber; diuji wp24.test.ts):
--   1. fo_sinkron_visit(uuid) + hak                       <- 202610140004_fo_rpc.sql
--   2. fo_checkin_reservasi, fo_tolak_reservasi, fo_selesai, fo_eskalasi, fo_ambil_dari_kotak_masuk,
--      layanan_kembalikan, admin_alihkan, reservasi_batalkan  <- 202610140004_fo_rpc.sql
--      layanan_mulai, layanan_selesai, tandai_tidak_terlayani_akhir_hari, tandai_reservasi_no_show
--                                                         <- 202610140005_fo_selaras_antrean.sql
--   3. get_skm_context, submit_skm_response (visit)       <- 202607140004_security_and_automation.sql;
--      DROP kunjungan_layanan_skm, DROP kolom skm_respons.kunjungan_id (+ indeks unik, FK)
--   4. queue_notifikasi                                   <- 202607140004_security_and_automation.sql;
--      DROP trigger/fungsi notify_kunjungan_status, notify_tiket_antrean, kunjungan_selesai_rr, trigger audit
--      trg_audit_kunjungan_status / trg_audit_tiket_status
--   5. mv_estimasi_layanan (visit) + indeks               <- 202607140005_views_and_jobs.sql;
--      v_antrian_loket + hak                              <- 202607300016_wp22_views_tiket_antrean.sql
--   6. jumlah_terdaftar, metrik_kepatuhan                 <- 202607290012_layanan_kontak_notifikasi.sql
--   7. visit: DROP trg_visit_arsip + visit_arsip_jaga(); GRANT INSERT/UPDATE/DELETE anon+authenticated; policy
--      visit_insert_walk_in / visit_insert_reservasi (202610080001), visit_update_staff (202610090001);
--      guard_visit_transisi_layanan() + trigger (202610140002); ENABLE 8 trigger efek; COMMENT tabel semula.
-- TIDAK dikembalikan (data, sengaja): baris kunjungan 'bertemu_seseorang' yang dibuat dari reservasi visit lama
-- (bagian 2b; tetap valid, dual-write lama mengabaikan tujuan itu untuk kunjungan), kolom kunjungan yang dilengkapi dari
-- visit (2a), nilai skm_respons.kunjungan_id (hilang bersama kolom; respons tetap terhitung lewat layanan_id),
-- notifikasi dan audit_log yang sudah dibuat, status kunjungan/tiket hasil alur baru. visit yang tidak bergerak selama
-- periode WP-24 TIDAK disinkronkan mundur (mis. reservasi lama yang di-check-in FO tetap 'terjadwal' di visit).
-- Idempoten (CREATE OR REPLACE / DROP ... IF EXISTS / ENABLE).

DO $$
BEGIN
  -- Penjaga urutan (review): 0012 dan 0011 menimpa layanan_selesai / layanan_mulai / admin_alihkan / job 0007; rollback
  -- ini akan diam-diam membuang perbaikannya (dan validasi pendataan) bila dijalankan lebih dulu.
  IF pg_catalog.to_regprocedure('public.form_pendataan_dari_nama(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140012 masih terpasang (jalankan docs/rollback-perbaikan-review-202610140012.sql dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.pendataan_validasi_payload(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140011 masih terpasang (jalankan docs/rollback-pendataan-wajib-202610140011.sql dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.tutup_penanganan_tertinggal()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140008 masih terpasang (jalankan docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.fo_checkin_reservasi(text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: RPC 202610140004 tidak ada (keadaan tak terduga)';
  END IF;
END $$;

-- ============================================================
-- 1. Fungsi internal fo_sinkron_visit (dihapus 202610140007)
-- ============================================================
-- fo_sinkron_visit(uuid) <- 202610140004_fo_rpc.sql
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

REVOKE ALL ON FUNCTION public.fo_sinkron_visit(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_sinkron_visit(uuid) TO service_role;

-- ============================================================
-- 2. RPC dipulihkan PERSIS (hak eksekusi tidak berubah oleh CREATE OR REPLACE)
-- ============================================================
-- fo_checkin_reservasi <- 202610140004_fo_rpc.sql
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

-- fo_tolak_reservasi <- 202610140004_fo_rpc.sql
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

-- fo_selesai <- 202610140004_fo_rpc.sql
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

-- fo_eskalasi <- 202610140004_fo_rpc.sql
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

-- fo_ambil_dari_kotak_masuk <- 202610140004_fo_rpc.sql
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

-- layanan_kembalikan <- 202610140004_fo_rpc.sql
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

-- admin_alihkan <- 202610140004_fo_rpc.sql
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

-- reservasi_batalkan <- 202610140004_fo_rpc.sql
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

-- layanan_mulai <- 202610140005_fo_selaras_antrean.sql
CREATE OR REPLACE FUNCTION public.layanan_mulai(p_tiket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id      uuid;
  v_me_role    text;
  v_me_layanan uuid;
  v_t          record;
  v_cek        record;
  v_now        timestamptz := pg_catalog.now();
  v_n          integer;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_me_id, v_me_role, v_me_layanan FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.layanan_id, t.kunjungan_id, t.legacy_visit_id INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_me_role = 'admin'
    OR (v_me_role = 'petugas' AND v_me_layanan IS NOT NULL AND v_me_layanan = v_t.layanan_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau petugas layanan ini yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;

  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_t.legacy_visit_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id FOR UPDATE;

  UPDATE public.tiket_antrean AS t
     SET status = 'dilayani', dilayani_oleh = v_me_id, waktu_mulai_layan = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status IN ('menunggu', 'dipanggil') AND t.dilayani_oleh IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT t.status, t.dilayani_oleh, t.waktu_mulai_layan INTO v_cek
    FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
    IF v_cek.status = 'dilayani' AND v_cek.dilayani_oleh = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_cek.waktu_mulai_layan);
    END IF;
    IF v_cek.status IN ('dilayani', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
  END IF;

  -- Tahap penanganan (tiket hasil eskalasi FO): menunggu -> berjalan oleh pemanggil.
  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now
   WHERE p.tiket_id = p_tiket_id AND p.status = 'menunggu';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now WHERE k.id = v_t.kunjungan_id;
  END IF;

  -- Sinkron visit tiket lama (WP-24 / Tahap B: hapus blok ini). Nilai identik; trigger penjaga diizinkan lewat flag lokal.
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'on', true);
    UPDATE public.visit AS v
       SET status = 'dilayani', waktu_mulai_layan = v_now
     WHERE v.id = v_t.legacy_visit_id AND v.status = 'menunggu';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'off', true);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'DIVERGENSI: visit % tidak berstatus menunggu; tidak ada perubahan disimpan', v_t.legacy_visit_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_now);
END $$;

-- layanan_selesai <- 202610140005_fo_selaras_antrean.sql
CREATE OR REPLACE FUNCTION public.layanan_selesai(
  p_tiket_id  uuid,
  p_form_type text DEFAULT NULL,
  p_payload   jsonb DEFAULT NULL,
  p_topik_id  uuid DEFAULT NULL,
  p_catatan   text DEFAULT NULL
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
  v_legacy   uuid;
  v_kunj     uuid;
  v_t        record;
  v_p        record;
  v_existing record;
  v_topik    text;
  v_catatan  text;
  v_now      timestamptz := pg_catalog.now();
  v_n        integer;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh menyelesaikan layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF v_me_role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: Front Office tidak menyelesaikan tiket layanan' USING ERRCODE = '42501';
  END IF;
  IF p_form_type IS NOT NULL AND p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;

  -- Visit yang dikunci: visit tiket lama, atau visit reservasi lama milik kunjungan (tiket hasil eskalasi).
  SELECT COALESCE(t.legacy_visit_id, k.legacy_visit_id), t.kunjungan_id INTO v_legacy, v_kunj
  FROM public.tiket_antrean AS t JOIN public.kunjungan AS k ON k.id = t.kunjungan_id WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Urutan kunci = jalur lama (visit -> kunjungan -> tiket -> penanganan).
  IF v_legacy IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_legacy FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT t.id, t.legacy_visit_id, t.kunjungan_id, t.layanan_id, t.status, t.dilayani_oleh INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status dilayani (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain' USING ERRCODE = '42501';
  END IF;

  -- Tahap penanganan (hanya tiket hasil eskalasi): topik + catatan wajib, divalidasi sebelum menulis apa pun.
  SELECT p.id INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    v_topik   := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
    v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
  END IF;

  -- Pendataan (logika finalize_pelayanan 202610010001 bagian e, apa adanya; petugas_id = pemilik).
  IF p_form_type = 'oss' THEN
    SELECT * INTO v_existing FROM public.pelayanan_oss WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_oss (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_usaha, tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha,
        skala_usaha, sektor_usaha_kbli, tindak_lanjut, uraian_solusi,
        catatan_internal, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_t.kunjungan_id, v_me_id,
        COALESCE(p_payload->>'nama_pemohon', ''),
        NULLIF(p_payload->>'alamat_pemohon', ''),
        NULLIF(p_payload->>'no_hp', ''),
        NULLIF(p_payload->>'email', ''),
        NULLIF(p_payload->>'keperluan_awal', ''),
        COALESCE(p_payload->>'nama_usaha', ''),
        NULLIF(p_payload->>'tipe_pelaku_usaha', ''),
        NULLIF(p_payload->>'status_penanaman_modal', ''),
        NULLIF(p_payload->>'lokasi_usaha', ''),
        NULLIF(p_payload->>'skala_usaha', ''),
        NULLIF(p_payload->>'sektor_usaha_kbli', ''),
        COALESCE(p_payload->>'tindak_lanjut', ''),
        COALESCE(p_payload->>'uraian_solusi', ''),
        NULLIF(p_payload->>'catatan_internal', ''),
        'selesai', true, v_now, v_now
      );
    ELSE
      UPDATE public.pelayanan_oss SET
        petugas_id             = v_me_id,
        nama_pemohon           = COALESCE(p_payload->>'nama_pemohon', nama_pemohon),
        alamat_pemohon         = COALESCE(NULLIF(p_payload->>'alamat_pemohon', ''), alamat_pemohon),
        no_hp                  = COALESCE(NULLIF(p_payload->>'no_hp', ''), no_hp),
        email                  = COALESCE(NULLIF(p_payload->>'email', ''), email),
        keperluan_awal         = COALESCE(NULLIF(p_payload->>'keperluan_awal', ''), keperluan_awal),
        nama_usaha             = COALESCE(p_payload->>'nama_usaha', nama_usaha),
        tipe_pelaku_usaha      = COALESCE(NULLIF(p_payload->>'tipe_pelaku_usaha', ''), tipe_pelaku_usaha),
        status_penanaman_modal = COALESCE(NULLIF(p_payload->>'status_penanaman_modal', ''), status_penanaman_modal),
        lokasi_usaha           = COALESCE(NULLIF(p_payload->>'lokasi_usaha', ''), lokasi_usaha),
        skala_usaha            = COALESCE(NULLIF(p_payload->>'skala_usaha', ''), skala_usaha),
        sektor_usaha_kbli      = COALESCE(NULLIF(p_payload->>'sektor_usaha_kbli', ''), sektor_usaha_kbli),
        tindak_lanjut          = COALESCE(p_payload->>'tindak_lanjut', tindak_lanjut),
        uraian_solusi          = COALESCE(p_payload->>'uraian_solusi', uraian_solusi),
        catatan_internal       = COALESCE(NULLIF(p_payload->>'catatan_internal', ''), catatan_internal),
        status_draft           = 'selesai',
        is_locked              = true,
        updated_at             = v_now
      WHERE tiket_id = p_tiket_id;
    END IF;

  ELSIF p_form_type = 'perizinan' THEN
    SELECT * INTO v_existing FROM public.pelayanan_perizinan WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_perizinan (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_perusahaan, lokasi_usaha, opd_teknis, uraian_permohonan, tindak_lanjut,
        catatan_petugas, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_t.kunjungan_id, v_me_id,
        COALESCE(p_payload->>'nama_pemohon', ''),
        NULLIF(p_payload->>'alamat_pemohon', ''),
        NULLIF(p_payload->>'no_hp', ''),
        NULLIF(p_payload->>'email', ''),
        NULLIF(p_payload->>'keperluan_awal', ''),
        COALESCE(p_payload->>'nama_perusahaan', ''),
        NULLIF(p_payload->>'lokasi_usaha', ''),
        COALESCE(p_payload->>'opd_teknis', ''),
        COALESCE(p_payload->>'uraian_permohonan', ''),
        COALESCE(p_payload->>'tindak_lanjut', ''),
        NULLIF(p_payload->>'catatan_petugas', ''),
        'selesai', true, v_now, v_now
      );
    ELSE
      UPDATE public.pelayanan_perizinan SET
        petugas_id        = v_me_id,
        nama_pemohon      = COALESCE(p_payload->>'nama_pemohon', nama_pemohon),
        alamat_pemohon    = COALESCE(NULLIF(p_payload->>'alamat_pemohon', ''), alamat_pemohon),
        no_hp             = COALESCE(NULLIF(p_payload->>'no_hp', ''), no_hp),
        email             = COALESCE(NULLIF(p_payload->>'email', ''), email),
        keperluan_awal    = COALESCE(NULLIF(p_payload->>'keperluan_awal', ''), keperluan_awal),
        nama_perusahaan   = COALESCE(p_payload->>'nama_perusahaan', nama_perusahaan),
        lokasi_usaha      = COALESCE(NULLIF(p_payload->>'lokasi_usaha', ''), lokasi_usaha),
        opd_teknis        = COALESCE(p_payload->>'opd_teknis', opd_teknis),
        uraian_permohonan = COALESCE(p_payload->>'uraian_permohonan', uraian_permohonan),
        tindak_lanjut     = COALESCE(p_payload->>'tindak_lanjut', tindak_lanjut),
        catatan_petugas   = COALESCE(NULLIF(p_payload->>'catatan_petugas', ''), catatan_petugas),
        status_draft      = 'selesai',
        is_locked         = true,
        updated_at        = v_now
      WHERE tiket_id = p_tiket_id;
    END IF;
  END IF;

  UPDATE public.tiket_antrean AS t
     SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket % berubah selama penyelesaian', p_tiket_id USING ERRCODE = 'P0001';
  END IF;

  -- Tahap penanganan + kunjungan (tiket hasil eskalasi).
  IF v_p.id IS NOT NULL THEN
    UPDATE public.penanganan AS p
       SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
           selesai_at = v_now
     WHERE p.id = v_p.id;
    UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
     WHERE k.id = v_t.kunjungan_id
       AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                       WHERE x.kunjungan_id = v_t.kunjungan_id AND x.status IN ('menunggu', 'berjalan'));
    IF v_t.legacy_visit_id IS NULL THEN
      PERFORM public.fo_sinkron_visit(v_t.kunjungan_id);
    END IF;
  END IF;

  -- Sinkron visit tiket lama (WP-24 / Tahap B: hapus blok ini). SKM/notifikasi/audit/response-rate lewat trigger visit.
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'on', true);
    UPDATE public.visit AS v
       SET status = 'selesai', waktu_selesai = v_now
     WHERE v.id = v_t.legacy_visit_id AND v.status = 'dilayani';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM pg_catalog.set_config('lmh.antrean_rpc', 'off', true);
    IF v_n <> 1 THEN
      RAISE EXCEPTION 'DIVERGENSI: visit % tidak berstatus dilayani; tidak ada perubahan disimpan', v_t.legacy_visit_id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now,
    'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id));
END $$;

-- tandai_tidak_terlayani_akhir_hari <- 202610140005_fo_selaras_antrean.sql
CREATE OR REPLACE FUNCTION public.tandai_tidak_terlayani_akhir_hari()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  r       record;
BEGIN
  -- (a) Jalur lama (visit -> trigger dual-write), apa adanya.
  UPDATE public.visit AS v
  SET    status     = 'tidak_terlayani',
         updated_at = now()
  FROM   public.tiket_antrean AS t
  WHERE  t.legacy_visit_id = v.id
    AND  t.status   = 'menunggu'
    AND  t.tanggal  = v_today
    AND  v.status   = 'menunggu';

  -- (b) Tiket hasil eskalasi (tanpa visit) dan kotak masuk FO non-chat yang tidak diambil.
  --     Per kunjungan, urutan kunci visit -> kunjungan -> tiket -> penanganan.
  FOR r IN
    SELECT DISTINCT x.kunjungan_id, k.legacy_visit_id
    FROM (
      SELECT t.kunjungan_id FROM public.tiket_antrean AS t
      WHERE t.legacy_visit_id IS NULL AND t.status IN ('menunggu', 'dipanggil') AND t.tanggal <= v_today
      UNION
      SELECT p.kunjungan_id FROM public.penanganan AS p
      WHERE p.status = 'menunggu' AND p.peran_tahap = 'fo' AND p.saluran <> 'chat'
        AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date <= v_today
    ) AS x
    JOIN public.kunjungan AS k ON k.id = x.kunjungan_id
  LOOP
    IF r.legacy_visit_id IS NOT NULL THEN
      PERFORM 1 FROM public.visit AS v WHERE v.id = r.legacy_visit_id FOR UPDATE;
    END IF;
    PERFORM 1 FROM public.kunjungan AS k WHERE k.id = r.kunjungan_id FOR UPDATE;

    UPDATE public.tiket_antrean AS t
       SET status = 'tidak_terlayani', updated_at = now()
     WHERE t.kunjungan_id = r.kunjungan_id AND t.legacy_visit_id IS NULL
       AND t.status IN ('menunggu', 'dipanggil') AND t.tanggal <= v_today;

    UPDATE public.penanganan AS p
       SET status = 'batal', batal_karena = 'tidak_terlayani', selesai_at = now(),
           catatan = COALESCE(p.catatan, 'Tidak terlayani sampai jam tutup')
     WHERE p.kunjungan_id = r.kunjungan_id AND p.status = 'menunggu' AND p.saluran <> 'chat'
       AND (p.peran_tahap = 'layanan' OR (p.created_at AT TIME ZONE 'Asia/Jakarta')::date <= v_today);

    UPDATE public.kunjungan AS k
       SET status = 'tidak_terlayani', updated_at = now()
     WHERE k.id = r.kunjungan_id AND k.status = 'menunggu'
       AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                       WHERE x.kunjungan_id = r.kunjungan_id AND x.status IN ('menunggu', 'berjalan'));

    PERFORM public.fo_sinkron_visit(r.kunjungan_id);
  END LOOP;
END $$;

-- tandai_reservasi_no_show <- 202610140005_fo_selaras_antrean.sql
CREATE OR REPLACE FUNCTION public.tandai_reservasi_no_show()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_count integer := 0;
  v_baru  integer := 0;
BEGIN
  -- (a) Jalur lama (visit -> trigger dual-write), apa adanya.
  UPDATE public.visit
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  asal = 'reservasi'
    AND  status = 'terjadwal'
    AND  tanggal_rencana < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- (b) Reservasi baru (reservasi_buat): kunjungan tanpa visit.
  UPDATE public.kunjungan AS k
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  k.asal = 'reservasi'
    AND  k.status = 'terjadwal'
    AND  k.legacy_visit_id IS NULL
    AND  k.tanggal < v_today;

  GET DIAGNOSTICS v_baru = ROW_COUNT;
  RETURN v_count + v_baru;
END $$;

-- ============================================================
-- 3. SKM kembali ke visit
-- ============================================================
-- get_skm_context(text) <- 202607140004_security_and_automation.sql
CREATE OR REPLACE FUNCTION public.get_skm_context(p_token text)
RETURNS TABLE (eligible boolean, already_submitted boolean, layanan_nama text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    visit.status = 'selesai' AS eligible,
    EXISTS (
      SELECT 1 FROM public.skm_respons AS response
      WHERE response.visit_id = visit.id
    ) AS already_submitted,
    service.nama AS layanan_nama
  FROM public.visit AS visit
  LEFT JOIN public.layanan AS service ON service.id = visit.layanan_id
  WHERE visit.qr_token = p_token
$$;

-- submit_skm_response(...) <- 202607140004_security_and_automation.sql
CREATE OR REPLACE FUNCTION public.submit_skm_response(
  p_token text,
  p_u1 integer,
  p_u2 integer,
  p_u3 integer,
  p_u4 integer,
  p_u5 integer,
  p_u6 integer,
  p_u7 integer,
  p_u8 integer,
  p_u9 integer,
  p_saran text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  trusted_visit_id uuid;
  trusted_layanan_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR
     p_u1 NOT BETWEEN 1 AND 4 OR p_u2 NOT BETWEEN 1 AND 4 OR
     p_u3 NOT BETWEEN 1 AND 4 OR p_u4 NOT BETWEEN 1 AND 4 OR
     p_u5 NOT BETWEEN 1 AND 4 OR p_u6 NOT BETWEEN 1 AND 4 OR
     p_u7 NOT BETWEEN 1 AND 4 OR p_u8 NOT BETWEEN 1 AND 4 OR
     p_u9 NOT BETWEEN 1 AND 4 OR length(COALESCE(p_saran, '')) > 2000 THEN
    RETURN 'invalid';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.visit AS visit WHERE visit.qr_token = p_token) THEN
    RETURN 'not_found';
  END IF;

  SELECT visit.id, visit.layanan_id
  INTO trusted_visit_id, trusted_layanan_id
  FROM public.visit AS visit
  WHERE visit.qr_token = p_token AND visit.status = 'selesai'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_completed';
  END IF;

  BEGIN
    INSERT INTO public.skm_respons (
      visit_id, layanan_id,
      u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk,
      u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan, saran
    ) VALUES (
      trusted_visit_id, trusted_layanan_id,
      p_u1, p_u2, p_u3, p_u4, p_u5, p_u6, p_u7, p_u8, p_u9,
      NULLIF(trim(p_saran), '')
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN 'duplicate';
  END;

  RETURN 'submitted';
END
$$;

DROP FUNCTION IF EXISTS public.kunjungan_layanan_skm(uuid);
ALTER TABLE public.skm_respons DROP COLUMN IF EXISTS kunjungan_id;   -- indeks unik + FK ikut terhapus

-- ============================================================
-- 4. Notifikasi, response rate, audit
-- ============================================================
-- queue_notifikasi(...) <- 202607140004_security_and_automation.sql
CREATE OR REPLACE FUNCTION public.queue_notifikasi(
  p_tujuan_user_id uuid,
  p_tujuan_email text,
  p_kanal text,
  p_subjek text,
  p_body text,
  p_payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  notification_id uuid;
  stable_key text;
BEGIN
  stable_key := CASE
    WHEN p_payload ? 'visit_id' THEN 'visit:' || (p_payload->>'visit_id') || ':' || COALESCE(p_payload->>'type', p_kanal)
    WHEN p_payload ? 'listing_id' THEN 'listing:' || (p_payload->>'listing_id') || ':' || COALESCE(p_payload->>'type', p_kanal)
    ELSE NULL
  END;

  INSERT INTO public.notifikasi (
    tujuan_user_id, tujuan_email, kanal, subjek, body, payload, idempotency_key
  )
  VALUES (
    p_tujuan_user_id, p_tujuan_email, p_kanal, p_subjek, p_body, p_payload, stable_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL AND stable_key IS NOT NULL THEN
    SELECT n.id INTO notification_id
    FROM public.notifikasi AS n
    WHERE n.idempotency_key = stable_key
    LIMIT 1;
  END IF;

  RETURN notification_id;
END
$$;

DROP TRIGGER IF EXISTS trg_notify_kunjungan_status ON public.kunjungan;
DROP TRIGGER IF EXISTS trg_kunjungan_selesai_rr ON public.kunjungan;
DROP TRIGGER IF EXISTS trg_audit_kunjungan_status ON public.kunjungan;
DROP TRIGGER IF EXISTS trg_notify_tiket_antrean ON public.tiket_antrean;
DROP TRIGGER IF EXISTS trg_audit_tiket_status ON public.tiket_antrean;
DROP FUNCTION IF EXISTS public.notify_kunjungan_status();
DROP FUNCTION IF EXISTS public.notify_tiket_antrean();
DROP FUNCTION IF EXISTS public.kunjungan_selesai_rr();

-- ============================================================
-- 5. Estimasi kembali membaca visit
-- ============================================================
DROP VIEW IF EXISTS public.v_antrian_loket;
DROP MATERIALIZED VIEW IF EXISTS public.mv_estimasi_layanan;

-- mv_estimasi_layanan + indeks <- 202607140005_views_and_jobs.sql
CREATE MATERIALIZED VIEW public.mv_estimasi_layanan AS
SELECT
  visit.layanan_id,
  EXTRACT(HOUR FROM visit.waktu_mulai_layan)::integer AS jam_slot,
  avg(EXTRACT(EPOCH FROM (visit.waktu_selesai - visit.waktu_mulai_layan)) / 60)::integer AS avg_durasi_menit,
  count(*)::integer AS sample_count
FROM public.visit AS visit
WHERE visit.status = 'selesai'
  AND visit.waktu_mulai_layan IS NOT NULL
  AND visit.waktu_selesai IS NOT NULL
  AND visit.waktu_mulai_layan > now() - INTERVAL '14 days'
GROUP BY visit.layanan_id, jam_slot;

CREATE UNIQUE INDEX idx_mv_estimasi_layanan_key
  ON public.mv_estimasi_layanan(layanan_id, jam_slot);

-- v_antrian_loket + hak <- 202607300016_wp22_views_tiket_antrean.sql
CREATE OR REPLACE VIEW public.v_antrian_loket AS
SELECT
  service.id    AS layanan_id,
  service.nama  AS layanan_nama,
  service.tipe,
  count(t.id) FILTER (WHERE t.status = 'menunggu')  AS antre_count,
  count(t.id) FILTER (WHERE t.status = 'dilayani')  AS dilayani_count,
  COALESCE((
    SELECT e.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_durasi_menit,
  count(t.id) FILTER (WHERE t.status = 'menunggu') * COALESCE((
    SELECT e.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_tunggu_total_menit,
  COALESCE((
    SELECT e.sample_count
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 0) AS sample_count
FROM public.layanan AS service
LEFT JOIN public.tiket_antrean AS t
  ON  t.layanan_id = service.id
  AND t.status IN ('menunggu', 'dilayani')
  AND t.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE service.tipe = 'konsultatif'
  AND service.aktif = true
GROUP BY service.id, service.nama, service.tipe;

REVOKE ALL  ON public.v_antrian_loket FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_antrian_loket TO anon, authenticated;

-- ============================================================
-- 6. Pengingat petugas & metrik kepatuhan
-- ============================================================
-- jumlah_terdaftar(uuid, date) <- 202607290012_layanan_kontak_notifikasi.sql
CREATE OR REPLACE FUNCTION public.jumlah_terdaftar(p_layanan_id uuid, p_tanggal date)
RETURNS int
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::int FROM public.visit
  WHERE layanan_id = p_layanan_id
    AND status IN ('terjadwal','menunggu','dilayani')
    AND (
      (asal = 'reservasi' AND tanggal_rencana = p_tanggal)
      OR ((waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date = p_tanggal)
    )
$$;

-- metrik_kepatuhan(uuid, date, date) <- 202607290012_layanan_kontak_notifikasi.sql
CREATE OR REPLACE FUNCTION public.metrik_kepatuhan(p_layanan_id uuid, p_awal date, p_akhir date)
RETURNS TABLE (
  hari_dijadwalkan int,
  hari_hadir int,
  hari_alpa int,
  persen_hadir numeric,
  warga_terdampak int,
  rata2_telat_menit numeric
)
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_batas time := COALESCE((SELECT value::time FROM public.site_settings WHERE key='batas_jam_alpa'), time '10:00');
BEGIN
  RETURN QUERY
  WITH hari AS (
    SELECT d::date AS t
    FROM generate_series(p_awal, p_akhir, interval '1 day') d
    WHERE public.is_layanan_buka_jadwal(p_layanan_id, d::date, NULL)
  ),
  kehadiran AS (
    SELECT h.t,
      EXISTS (
        SELECT 1 FROM public.absensi_petugas a JOIN public.petugas p ON p.id=a.petugas_id
        WHERE p.layanan_id=p_layanan_id AND a.tanggal=h.t AND a.status='approved'
      ) AS hadir,
      (SELECT min(a.jam_masuk) FROM public.absensi_petugas a JOIN public.petugas p ON p.id=a.petugas_id
        WHERE p.layanan_id=p_layanan_id AND a.tanggal=h.t AND a.status='approved') AS jam_masuk
    FROM hari h
  )
  SELECT
    count(*)::int,
    count(*) FILTER (WHERE hadir)::int,
    count(*) FILTER (WHERE NOT hadir)::int,
    ROUND(100.0 * count(*) FILTER (WHERE hadir) / NULLIF(count(*),0), 1),
    COALESCE((SELECT count(*) FROM public.visit v
      WHERE v.layanan_id=p_layanan_id AND v.status='tidak_terlayani'
        AND (v.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date BETWEEN p_awal AND p_akhir),0)::int,
    ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (jam_masuk::time - v_batas))/60) FILTER (WHERE hadir AND jam_masuk IS NOT NULL),0)::numeric, 1)
  FROM kehadiran;
END $$;

-- ============================================================
-- 7. visit kembali dapat ditulis
-- ============================================================
DROP TRIGGER IF EXISTS trg_visit_arsip ON public.visit;
DROP FUNCTION IF EXISTS public.visit_arsip_jaga();
GRANT INSERT, UPDATE, DELETE ON TABLE public.visit TO anon, authenticated;

-- policy INSERT <- 202610080001_rbac_tahap0_keamanan.sql
DROP POLICY IF EXISTS visit_insert_walk_in ON public.visit;
CREATE POLICY visit_insert_walk_in ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'walk_in'
    AND status IN ('menunggu', 'terjadwal')
    AND waktu_mulai_layan IS NULL
    AND waktu_selesai IS NULL
    AND waktu_scan IS NULL
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('visit_insert_walk_in', 5, 60))
    AND (pengunjung_id IS NULL OR pengunjung_id IN (
      SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS visit_insert_reservasi ON public.visit;
CREATE POLICY visit_insert_reservasi ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'reservasi'
    AND status = 'terjadwal'
    AND waktu_mulai_layan IS NULL
    AND waktu_selesai IS NULL
    AND waktu_scan IS NULL
    AND pengunjung_id IN (
      SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid()
    )
  );

-- policy UPDATE <- 202610090001_rbac_tahap1.sql
DROP POLICY IF EXISTS visit_update_staff ON public.visit;
CREATE POLICY visit_update_staff ON public.visit FOR UPDATE TO authenticated
  USING (public.boleh_layanan(layanan_id))
  WITH CHECK (public.boleh_layanan(layanan_id));

-- guard_visit_transisi_layanan() + trigger <- 202610140002_tiket_kepemilikan.sql
CREATE OR REPLACE FUNCTION public.guard_visit_transisi_layanan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('lmh.antrean_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.status IS DISTINCT FROM OLD.status
        AND (NEW.status IN ('dilayani', 'selesai') OR OLD.status IN ('dilayani', 'selesai')))
     OR NEW.waktu_mulai_layan IS DISTINCT FROM OLD.waktu_mulai_layan
     OR NEW.waktu_selesai IS DISTINCT FROM OLD.waktu_selesai THEN
    RAISE EXCEPTION 'TRANSISI_LEWAT_RPC: gunakan layanan_mulai / layanan_selesai (muat ulang halaman)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_visit_transisi_layanan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public.visit;
CREATE TRIGGER trg_guard_visit_transisi_layanan
  BEFORE UPDATE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.guard_visit_transisi_layanan();
DO $$
DECLARE
  v_nama text;
BEGIN
  FOREACH v_nama IN ARRAY ARRAY[
    'trg_visit_dual_write', 'trg_notify_visit_selesai', 'trg_notify_reservasi_confirmed', 'trg_visit_selesai_rr',
    'trg_audit_visit_status', 'trg_log_visit_insert', 'trg_guard_visit_layanan_buka', 'trg_visit_qr_hangus'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger AS tg
      WHERE tg.tgrelid = 'public.visit'::regclass AND tg.tgname = v_nama AND NOT tg.tgisinternal
    ) THEN
      EXECUTE pg_catalog.format('ALTER TABLE public.visit ENABLE TRIGGER %I', v_nama);
    END IF;
  END LOOP;
END $$;

COMMENT ON TABLE public.visit IS 'Unified final visit spine for walk-in and reservation flows.';
