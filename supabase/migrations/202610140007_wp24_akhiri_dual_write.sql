-- 202610140007_wp24_akhiri_dual_write.sql
-- WP-24 / Tahap B9 (B-DB2): MENGAKHIRI dual-write `visit`. Keputusan CEO 2026-10-13 (Gerbang G.1 Opsi A): tulis `visit`
-- dihentikan, trg_visit_dual_write dinonaktifkan, data lama `visit` tetap sebagai ARSIP (baca saja). Checklist:
-- docs/analysis/ANTREAN-ARAH-TULIS.md §6.2, kontrak docs/analysis/FO-ESKALASI-KONTRAK-RPC.md §7 (peringatan 1-2) dan §10.
-- Bagian lanjutan (penutupan otomatis tahap 'berjalan' + retensi PII) ada di 202610140008.
--
-- ISI
--   0. Penjaga: prasyarat 202610140005 + ANTREAN KOSONG (tidak ada tiket 'menunggu'/'dipanggil' hari ini WIB).
--   1. `visit` menjadi ARSIP:
--      - trigger efek DINONAKTIFKAN (ALTER TABLE ... DISABLE TRIGGER; rollback = ENABLE): trg_visit_dual_write,
--        trg_notify_visit_selesai, trg_notify_reservasi_confirmed, trg_visit_selesai_rr, trg_audit_visit_status,
--        trg_log_visit_insert, trg_guard_visit_layanan_buka, trg_visit_qr_hangus. Fungsinya TIDAK dihapus.
--      - trigger penjaga A3 trg_guard_visit_transisi_layanan + fungsi guard_visit_transisi_layanan() DIHAPUS
--        (flag lmh.antrean_rpc tidak dipakai lagi).
--      - penjaga baru trg_visit_arsip (BEFORE INSERT/UPDATE/DELETE): menolak SEMUA tulis (juga service_role dan fungsi
--        definer) dengan VISIT_ARSIP (42501), kecuali (a) flag transaksi-lokal lmh.visit_arsip = 'on' (hanya job
--        anonimisasi 202610140008) dan (b) aksi FK pengunjung ON DELETE SET NULL (hanya pengunjung_id -> NULL).
--      - policy visit_insert_walk_in / visit_insert_reservasi / visit_update_staff DICABUT dan hak INSERT/UPDATE/DELETE
--        anon+authenticated di-REVOKE: klien lama yang masih menulis visit mendapat galat 42501 yang terlihat (bukan
--        0 baris diam-diam). visit_select_own (baca arsip) TETAP.
--   2. Reservasi lama yang masih terjadwal (dibuat lewat visit sebelum cutover):
--      - tujuan 'loket' (sudah punya baris kunjungan dari dual-write): kolom tujuan/layanan_saran_id/keperluan/
--        nama_yang_ditemui/jam_rencana/asal_instansi disalin dari visit (hanya yang masih NULL), sehingga
--        fo_checkin_reservasi tidak perlu membaca visit.
--      - tujuan 'bertemu_seseorang' bertanggal >= hari ini (TIDAK punya kunjungan; dual-write lama hanya menulis
--        buku_tamu saat scan): DIBUATKAN baris kunjungan 'terjadwal' (legacy_visit_id, qr_token sama) agar bisa
--        di-check-in FO (menjawab kontrak §9.7). Yang tanggalnya sudah lewat dibiarkan di arsip.
--   3. RPC tanpa visit (logika lain IDENTIK dengan 202610140004/0005): layanan_mulai, layanan_selesai,
--      fo_checkin_reservasi, fo_tolak_reservasi, fo_selesai, fo_eskalasi, fo_ambil_dari_kotak_masuk,
--      layanan_kembalikan, admin_alihkan, reservasi_batalkan. Kunci visit dan sinkron visit dihapus; urutan kunci kini
--      kunjungan -> tiket -> penanganan. Tiket lama (legacy_visit_id) kini menggerakkan kunjungan langsung
--      (dulu lewat trigger dual-write): mulai -> 'dilayani', selesai -> 'selesai' bila tak ada tahap/tiket terbuka.
--      fo_sinkron_visit(uuid) DIHAPUS. admin_ambil_alih (0005) tidak menyentuh visit, tidak diubah.
--      Job tandai_tidak_terlayani_akhir_hari() dan tandai_reservasi_no_show() hanya menulis kunjungan/tiket/penanganan
--      (termasuk kunjungan lama ber-legacy_visit_id; visit arsip tidak disentuh).
--   4. SKM pindah ke kunjungan: skm_respons.kunjungan_id (FK, unik parsial, backfill dari visit_id), helper
--      kunjungan_layanan_skm(uuid) (layanan tiket 'selesai' terakhir; NULL bila selesai di FO), get_skm_context dan
--      submit_skm_response (signature + nilai balik SAMA; kunjungan.qr_token = visit.qr_token untuk data lama) dengan
--      cadangan arsip visit untuk token lama tanpa kunjungan.
--   5. Notifikasi pindah: queue_notifikasi (+ kunci idempotensi 'kunjungan:<id>:<tiket|->:<type>'),
--      notify_kunjungan_status (selesai -> SKM email/push; reservasi terjadwal -> dilayani/menunggu -> dikonfirmasi),
--      notify_tiket_antrean (tiket terbit 'menunggu' -> "Anda masuk antrean"; 'dilayani' -> "Giliran Anda dimulai").
--      Walk-in FO tanpa pengunjung_id: hanya email SKM ke kunjungan.email yang dicatat FO (bila ada); tanpa email = tanpa
--      notifikasi (sama dengan walk-in visit tanpa akun dulu).
--   6. Response rate SKM: trg_kunjungan_selesai_rr (kunjungan -> selesai: +dilayani pada layanan kunjungan_layanan_skm).
--   7. Audit status: trg_audit_kunjungan_status dan trg_audit_tiket_status (audit_change('update_status'), hanya bila
--      status benar-benar berubah). Pelaku = auth.uid() pemanggil RPC; job = 'system'.
--   8. mv_estimasi_layanan dibuat ulang dari tiket_antrean (kolom dan indeks unik SAMA); v_antrian_loket dibuat ulang
--      PERSIS seperti 202607300016 (dependen MV). refresh_estimasi_layanan() dan job refresh tidak berubah.
--   9. jumlah_terdaftar (pengingat H-1/H-0) membaca kunjungan reservasi + tiket; metrik_kepatuhan (warga terdampak)
--      membaca tiket_antrean 'tidak_terlayani'.
-- DIKONFIRMASI TIDAK PERLU PENGGANTI: guard_visit_layanan_buka (jam tutup/jadwal) sudah ditegakkan fo_mulai_kunjungan
-- (LAYANAN_TUTUP), fo_eskalasi (LAYANAN_TIDAK_BUKA/LAYANAN_TUTUP), reservasi_buat (LAYANAN_TIDAK_BUKA);
-- trg_visit_qr_hangus sudah ditegakkan fo_checkin_reservasi (QR_KEDALUWARSA) + job no-show.
--
-- KLIEN: semua penulis visit di src/ (api/checkin, checkin, WalkinWizard, admin/scan, me/reservasi) HARUS sudah diganti
-- RPC FO/reservasi pada deploy yang sama; sesudah migrasi ini mereka mendapat 42501. Pembaca visit di src/ (me/page,
-- admin/scan lookup, api/admin/pelayanan, realtime admin/kunjungan) membaca arsip yang tidak bergerak lagi.
-- SYARAT: 202610140002..202610140006 (penjaga bagian 0). URUTAN: 0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0008
-- dalam SATU jendela cutover (setelah 16:00 WIB, antrean kosong; runbook docs/RUNBOOK_FO_ESKALASI.md bagian WP-24).
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic
-- Idempoten. Rollback: docs/rollback-wp24-akhiri-dual-write-202610140007.sql (SETELAH rollback 202610140008).
-- Uji perilaku (transaksi SELALU di-ROLLBACK): scripts/test-wp24.mjs.

-- ============================================================
-- 0. Penjaga prasyarat + antrean kosong
-- ============================================================
DO $$
DECLARE
  v_hari_ini date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_n        integer;
BEGIN
  IF pg_catalog.to_regclass('public.penanganan') IS NULL
     OR pg_catalog.to_regprocedure('public.fo_checkin_reservasi(text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: model/RPC FO belum ada (terapkan 202610140003 dan 202610140004 lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.layanan_selesai(uuid,text,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: layanan_selesai 5-argumen belum ada (terapkan 202610140005_fo_selaras_antrean.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.ubah_nama_pengunjung(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140006_pernyataan_kebenaran belum diterapkan (urutan cutover 0002..0006 -> 0007)';
  END IF;

  -- Gerbang G.6: cutover hanya saat antrean kosong. Tiket 'dilayani' lama boleh tersisa (diselesaikan pemiliknya
  -- lewat layanan_selesai tanpa visit, atau ditutup job 202610140008) tetapi dilaporkan.
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.tiket_antrean AS t
  WHERE t.status IN ('menunggu', 'dipanggil') AND t.tanggal = v_hari_ini;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'CUTOVER_DITOLAK: masih ada % tiket menunggu/dipanggil hari ini; terapkan setelah antrean kosong (job akhir hari)', v_n;
  END IF;
  SELECT pg_catalog.count(*)::integer INTO v_n FROM public.tiket_antrean AS t WHERE t.status = 'dilayani';
  IF v_n > 0 THEN
    RAISE NOTICE 'WP-24: % tiket masih dilayani (lama); tetap dapat diselesaikan pemiliknya tanpa visit', v_n;
  END IF;
END $$;

-- ============================================================
-- 1. visit = ARSIP
-- ============================================================
-- 1a. Nonaktifkan trigger efek (definisi dipertahankan agar rollback cukup ENABLE).
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
      EXECUTE pg_catalog.format('ALTER TABLE public.visit DISABLE TRIGGER %I', v_nama);
    ELSE
      RAISE NOTICE 'WP-24: trigger visit % tidak ditemukan (dilewati)', v_nama;
    END IF;
  END LOOP;
END $$;

-- 1b. Penjaga transisi A3 tidak relevan lagi (visit tidak ditulis siapa pun).
DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public.visit;
DROP FUNCTION IF EXISTS public.guard_visit_transisi_layanan();

-- 1c. Penjaga arsip: tolak semua tulis kecuali flag anonimisasi dan aksi FK pengunjung ON DELETE SET NULL.
CREATE OR REPLACE FUNCTION public.visit_arsip_jaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('lmh.visit_arsip', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  -- FK visit.pengunjung_id ON DELETE SET NULL (penghapusan akun pengunjung): hanya kolom itu yang berubah.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.pengunjung_id IS NOT NULL AND NEW.pengunjung_id IS NULL
       AND (pg_catalog.to_jsonb(NEW) - 'pengunjung_id' - 'updated_at')
           = (pg_catalog.to_jsonb(OLD) - 'pengunjung_id' - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'VISIT_ARSIP: tabel visit adalah arsip sejak WP-24 (% ditolak); gunakan RPC kunjungan (fo_*, reservasi_*)', TG_OP
    USING ERRCODE = '42501';
END $$;

REVOKE ALL ON FUNCTION public.visit_arsip_jaga() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_visit_arsip ON public.visit;
CREATE TRIGGER trg_visit_arsip
  BEFORE INSERT OR UPDATE OR DELETE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.visit_arsip_jaga();

-- 1d. Klien: cabut jalur tulis (galat terlihat, bukan 0 baris).
DROP POLICY IF EXISTS visit_insert_walk_in ON public.visit;
DROP POLICY IF EXISTS visit_insert_reservasi ON public.visit;
DROP POLICY IF EXISTS visit_update_staff ON public.visit;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.visit FROM anon, authenticated;

COMMENT ON TABLE public.visit IS
  'ARSIP sejak WP-24 (202610140007): baca saja. Kunjungan baru di kunjungan/tiket_antrean/penanganan. Tulis ditolak trg_visit_arsip (VISIT_ARSIP).';

-- ============================================================
-- 2. Reservasi lama yang masih terjadwal
-- ============================================================
-- 2a. Reservasi 'loket' (kunjungan dari dual-write): lengkapi kolom yang dulu hanya ada di visit.
UPDATE public.kunjungan AS k
   SET tujuan            = COALESCE(k.tujuan, v.tujuan),
       layanan_saran_id  = COALESCE(k.layanan_saran_id, v.layanan_id),
       keperluan         = COALESCE(k.keperluan, v.keperluan),
       nama_yang_ditemui = COALESCE(k.nama_yang_ditemui, v.nama_yang_ditemui),
       jam_rencana       = COALESCE(k.jam_rencana, v.jam_rencana),
       asal_instansi     = COALESCE(k.asal_instansi, v.asal_instansi)
  FROM public.visit AS v
 WHERE k.legacy_visit_id = v.id
   AND k.asal = 'reservasi'
   AND k.status = 'terjadwal'
   AND k.tujuan IS NULL
   AND v.tujuan IS NOT NULL;

-- 2b. Reservasi 'bertemu_seseorang' (tanpa kunjungan) yang tanggalnya hari ini atau nanti.
INSERT INTO public.kunjungan (
  legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
  tujuan, nama_yang_ditemui, keperluan, asal_instansi, jam_rencana, created_at, updated_at
)
SELECT v.id, v.pengunjung_id, v.nama, v.kontak_hp, 'reservasi', v.qr_token, v.tanggal_rencana,
       COALESCE(v.waktu_masuk, v.created_at), 'terjadwal',
       v.tujuan, v.nama_yang_ditemui, v.keperluan, v.asal_instansi, v.jam_rencana, v.created_at, v.updated_at
  FROM public.visit AS v
 WHERE v.asal = 'reservasi'
   AND v.status = 'terjadwal'
   AND v.tujuan = 'bertemu_seseorang'
   AND v.tanggal_rencana >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
   AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS x WHERE x.legacy_visit_id = v.id)
ON CONFLICT DO NOTHING;

-- ============================================================
-- 3. RPC tanpa visit
-- ============================================================
DROP FUNCTION IF EXISTS public.fo_sinkron_visit(uuid);

-- 3.1 layanan_mulai
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

  SELECT t.id, t.layanan_id, t.kunjungan_id INTO v_t
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

  -- Urutan kunci global (WP-24): kunjungan -> tiket -> penanganan.
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

  -- Kunjungan ikut 'dilayani' (tiket hasil eskalasi maupun tiket lama; dulu tiket lama lewat trigger dual-write).
  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id AND k.status IS DISTINCT FROM 'dilayani';

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_now);
END $$;

-- 3.2 layanan_selesai (signature 202610140005 tetap)
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

  SELECT t.kunjungan_id INTO v_kunj FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Urutan kunci global (WP-24): kunjungan -> tiket -> penanganan.
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT t.id, t.kunjungan_id, t.layanan_id, t.status, t.dilayani_oleh INTO v_t
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

  IF v_p.id IS NOT NULL THEN
    UPDATE public.penanganan AS p
       SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
           selesai_at = v_now
     WHERE p.id = v_p.id;
  END IF;

  -- Kunjungan 'selesai' bila tidak ada tahap atau tiket lain yang masih terbuka (tiket lama: dulu lewat dual-write).
  -- Trigger kunjungan (202610140007 bagian 5-7) mengantrekan SKM, menambah response rate, dan mencatat audit.
  UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id
     AND k.status IS DISTINCT FROM 'selesai'
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                     WHERE x.kunjungan_id = v_t.kunjungan_id AND x.status IN ('menunggu', 'berjalan'))
     AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS y
                     WHERE y.kunjungan_id = v_t.kunjungan_id AND y.status IN ('menunggu', 'dipanggil', 'dilayani'));

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now,
    'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id));
END $$;

-- 3.3 fo_checkin_reservasi (data reservasi lama sudah disalin ke kunjungan, bagian 2)
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
  v_k       record;
  v_pid     uuid;
  v_tahap   integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT k.id INTO v_kid
  FROM public.kunjungan AS k WHERE v_qr <> '' AND k.qr_token = v_qr AND k.asal = 'reservasi';
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi dengan QR ini tidak ditemukan' USING ERRCODE = 'P0002';
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

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'kunjungan_id', v_kid,
    'penanganan_id', v_pid,
    'nama', v_k.nama,
    'tanggal', v_k.tanggal,
    'tujuan', v_k.tujuan,
    'layanan_saran_id', v_k.layanan_saran_id,
    'layanan_saran_nama', (SELECT l.nama FROM public.layanan AS l WHERE l.id = v_k.layanan_saran_id),
    'nama_yang_ditemui', v_k.nama_yang_ditemui,
    'keperluan', v_k.keperluan,
    'mulai_at', v_now);
END $$;

-- 3.4 fo_tolak_reservasi
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
  v_status  text;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;
  IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan penolakan wajib 5-500 karakter' USING ERRCODE = '22023';
  END IF;

  SELECT k.id INTO v_kid
  FROM public.kunjungan AS k WHERE v_qr <> '' AND k.qr_token = v_qr AND k.asal = 'reservasi';
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi dengan QR ini tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  SELECT k.status INTO v_status FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  IF v_status <> 'terjadwal' THEN
    RAISE EXCEPTION 'INVALID_STATUS: reservasi tidak berstatus terjadwal (status=%)', v_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'batal', updated_at = v_now WHERE k.id = v_kid AND k.status = 'terjadwal';

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (auth.uid(), v_me_role, 'fo_tolak_reservasi', 'kunjungan', v_kid::text,
          pg_catalog.jsonb_build_object('kunjungan_id', v_kid, 'petugas_id', v_me_id, 'alasan', v_alasan),
          pg_catalog.jsonb_build_object('status', 'terjadwal'),
          pg_catalog.jsonb_build_object('status', 'batal'));

  RETURN pg_catalog.jsonb_build_object('ok', true, 'kunjungan_id', v_kid, 'status', 'batal');
END $$;

-- 3.5 fo_selesai
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
  v_p       record;
  v_topik   text;
  v_catatan text;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT p.kunjungan_id INTO v_kid FROM public.penanganan AS p WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
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

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'penanganan_id', p_penanganan_id, 'kunjungan_id', v_kid,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_kid), 'selesai_at', v_now);
END $$;

-- 3.6 fo_eskalasi
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

  SELECT p.kunjungan_id INTO v_kid FROM public.penanganan AS p WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
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

-- 3.7 fo_ambil_dari_kotak_masuk
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
  v_cek     record;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT p.kunjungan_id INTO v_kid FROM public.penanganan AS p WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
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

-- 3.8 layanan_kembalikan
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
  v_t       record;
  v_p       record;
  v_topik   text;
  v_catatan text;
  v_tahap   integer;
  v_pf      uuid;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['admin', 'petugas']) AS s;

  SELECT t.kunjungan_id, t.legacy_visit_id INTO v_kid, v_legacy
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket_id) THEN
    RAISE EXCEPTION 'TIKET_LAMA: hanya tiket hasil eskalasi FO yang dapat dikembalikan' USING ERRCODE = 'P0001';
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

-- 3.9 admin_alihkan
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

  SELECT t.kunjungan_id, t.legacy_visit_id INTO v_kid, v_legacy
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket_id) THEN
    RAISE EXCEPTION 'TIKET_LAMA: hanya tiket hasil eskalasi FO yang dapat dialihkan' USING ERRCODE = 'P0001';
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

-- 3.10 reservasi_batalkan
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
  v_k      record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: masuk terlebih dahulu' USING ERRCODE = '42501';
  END IF;
  SELECT p.id INTO v_pgid FROM public.pengunjung AS p WHERE p.auth_user_id = v_uid;

  PERFORM 1 FROM public.kunjungan AS k
  WHERE k.id = p_kunjungan_id AND v_pgid IS NOT NULL AND k.pengunjung_id = v_pgid AND k.asal = 'reservasi';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: reservasi tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  SELECT k.status INTO v_k FROM public.kunjungan AS k WHERE k.id = p_kunjungan_id FOR UPDATE;
  IF v_k.status <> 'terjadwal' THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya reservasi terjadwal yang dapat dibatalkan (status=%)', v_k.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'batal', updated_at = v_now WHERE k.id = p_kunjungan_id AND k.status = 'terjadwal';

  RETURN pg_catalog.jsonb_build_object('ok', true, 'kunjungan_id', p_kunjungan_id, 'status', 'batal');
END $$;

-- 3.11 Job akhir hari (16:00 WIB): hanya kunjungan/tiket/penanganan (tiket lama ikut; visit arsip tidak disentuh).
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
  -- Per kunjungan, urutan kunci kunjungan -> tiket -> penanganan.
  FOR r IN
    SELECT DISTINCT x.kunjungan_id
    FROM (
      SELECT t.kunjungan_id FROM public.tiket_antrean AS t
      WHERE t.status IN ('menunggu', 'dipanggil') AND t.tanggal <= v_today
      UNION
      SELECT p.kunjungan_id FROM public.penanganan AS p
      WHERE p.status = 'menunggu' AND p.peran_tahap = 'fo' AND p.saluran <> 'chat'
        AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date <= v_today
    ) AS x
  LOOP
    PERFORM 1 FROM public.kunjungan AS k WHERE k.id = r.kunjungan_id FOR UPDATE;

    UPDATE public.tiket_antrean AS t
       SET status = 'tidak_terlayani', updated_at = now()
     WHERE t.kunjungan_id = r.kunjungan_id
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
                       WHERE x.kunjungan_id = r.kunjungan_id AND x.status IN ('menunggu', 'berjalan'))
       AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS y
                       WHERE y.kunjungan_id = r.kunjungan_id AND y.status IN ('menunggu', 'dipanggil', 'dilayani'));
  END LOOP;
END $$;

REVOKE ALL  ON FUNCTION public.tandai_tidak_terlayani_akhir_hari() FROM PUBLIC, anon, authenticated;

-- 3.12 Job no-show harian: semua reservasi kunjungan (baru maupun lama ber-legacy_visit_id).
CREATE OR REPLACE FUNCTION public.tandai_reservasi_no_show()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_count integer := 0;
BEGIN
  UPDATE public.kunjungan AS k
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  k.asal = 'reservasi'
    AND  k.status = 'terjadwal'
    AND  k.tanggal < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.tandai_reservasi_no_show()
  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 4. SKM via kunjungan
-- ============================================================
ALTER TABLE public.skm_respons
  ADD COLUMN IF NOT EXISTS kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS skm_respons_kunjungan_id_uniq
  ON public.skm_respons (kunjungan_id) WHERE kunjungan_id IS NOT NULL;
COMMENT ON COLUMN public.skm_respons.kunjungan_id IS
  'Kunjungan yang dinilai (sejak WP-24). Respons lama: diisi dari visit_id lewat kunjungan.legacy_visit_id.';

UPDATE public.skm_respons AS s
   SET kunjungan_id = k.id
  FROM public.kunjungan AS k
 WHERE k.legacy_visit_id = s.visit_id
   AND s.visit_id IS NOT NULL
   AND s.kunjungan_id IS NULL;

-- Layanan yang dinilai = layanan tiket 'selesai' terakhir milik kunjungan; NULL bila diselesaikan di FO.
CREATE OR REPLACE FUNCTION public.kunjungan_layanan_skm(p_kunjungan_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.layanan_id
  FROM public.tiket_antrean AS t
  WHERE t.kunjungan_id = p_kunjungan_id AND t.status = 'selesai'
  ORDER BY t.waktu_selesai DESC NULLS LAST, t.waktu_terbit DESC, t.id
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.kunjungan_layanan_skm(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kunjungan_layanan_skm(uuid) TO service_role;

-- Token = kunjungan.qr_token (data lama: sama dengan visit.qr_token). Cadangan arsip visit untuk token lama yang tidak
-- punya kunjungan (mis. bertemu_seseorang sebelum cutover). Kolom balikan dan GRANT tetap.
CREATE OR REPLACE FUNCTION public.get_skm_context(p_token text)
RETURNS TABLE (eligible boolean, already_submitted boolean, layanan_nama text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    k.status = 'selesai' AS eligible,
    EXISTS (
      SELECT 1 FROM public.skm_respons AS response
      WHERE response.kunjungan_id = k.id
         OR (k.legacy_visit_id IS NOT NULL AND response.visit_id = k.legacy_visit_id)
    ) AS already_submitted,
    (SELECT service.nama FROM public.layanan AS service
      WHERE service.id = COALESCE(public.kunjungan_layanan_skm(k.id), k.layanan_saran_id)) AS layanan_nama
  FROM public.kunjungan AS k
  WHERE k.qr_token = p_token
  UNION ALL
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
    AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS k2 WHERE k2.qr_token = p_token)
$$;

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
  v_kid     uuid;
  v_status  text;
  v_legacy  uuid;
  v_visit   uuid;
  v_layanan uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR
     p_u1 NOT BETWEEN 1 AND 4 OR p_u2 NOT BETWEEN 1 AND 4 OR
     p_u3 NOT BETWEEN 1 AND 4 OR p_u4 NOT BETWEEN 1 AND 4 OR
     p_u5 NOT BETWEEN 1 AND 4 OR p_u6 NOT BETWEEN 1 AND 4 OR
     p_u7 NOT BETWEEN 1 AND 4 OR p_u8 NOT BETWEEN 1 AND 4 OR
     p_u9 NOT BETWEEN 1 AND 4 OR length(COALESCE(p_saran, '')) > 2000 THEN
    RETURN 'invalid';
  END IF;

  -- (a) Kunjungan (alur baru dan data lama hasil dual-write). Kunci baris = serialisasi pengisian ganda.
  SELECT k.id, k.status, k.legacy_visit_id INTO v_kid, v_status, v_legacy
  FROM public.kunjungan AS k WHERE k.qr_token = p_token
  FOR UPDATE;

  IF FOUND THEN
    IF v_status <> 'selesai' THEN
      RETURN 'not_completed';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.skm_respons AS response
      WHERE response.kunjungan_id = v_kid OR (v_legacy IS NOT NULL AND response.visit_id = v_legacy)
    ) THEN
      RETURN 'duplicate';
    END IF;
    v_layanan := public.kunjungan_layanan_skm(v_kid);
    BEGIN
      INSERT INTO public.skm_respons (
        visit_id, kunjungan_id, layanan_id,
        u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk,
        u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan, saran
      ) VALUES (
        v_legacy, v_kid, v_layanan,
        p_u1, p_u2, p_u3, p_u4, p_u5, p_u6, p_u7, p_u8, p_u9,
        NULLIF(trim(p_saran), '')
      );
    EXCEPTION WHEN unique_violation THEN
      RETURN 'duplicate';
    END;
    RETURN 'submitted';
  END IF;

  -- (b) Arsip visit tanpa kunjungan (token lama): logika sebelum WP-24, tanpa kunci baris arsip.
  IF NOT EXISTS (SELECT 1 FROM public.visit AS visit WHERE visit.qr_token = p_token) THEN
    RETURN 'not_found';
  END IF;

  SELECT visit.id, visit.layanan_id
  INTO v_visit, v_layanan
  FROM public.visit AS visit
  WHERE visit.qr_token = p_token AND visit.status = 'selesai';

  IF NOT FOUND THEN
    RETURN 'not_completed';
  END IF;

  BEGIN
    INSERT INTO public.skm_respons (
      visit_id, layanan_id,
      u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk,
      u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan, saran
    ) VALUES (
      v_visit, v_layanan,
      p_u1, p_u2, p_u3, p_u4, p_u5, p_u6, p_u7, p_u8, p_u9,
      NULLIF(trim(p_saran), '')
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN 'duplicate';
  END;

  RETURN 'submitted';
END
$$;

-- ============================================================
-- 5. Notifikasi pengunjung (pindah dari trigger visit)
-- ============================================================
-- queue_notifikasi: + kunci idempotensi per kunjungan (payload kunjungan_id). Cabang visit_id/listing_id tetap.
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
    WHEN p_payload ? 'kunjungan_id' THEN 'kunjungan:' || (p_payload->>'kunjungan_id') || ':'
      || COALESCE(p_payload->>'tiket_id', '-') || ':' || COALESCE(p_payload->>'type', p_kanal)
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

-- Kunjungan: selesai -> SKM (email + push); reservasi terjadwal -> dilayani/menunggu -> dikonfirmasi.
CREATE OR REPLACE FUNCTION public.notify_kunjungan_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email   text;
  v_user_id uuid;
  v_publik  text;
  v_skm     text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.pengunjung_id IS NOT NULL THEN
    SELECT visitor.email, visitor.auth_user_id INTO v_email, v_user_id
    FROM public.pengunjung AS visitor WHERE visitor.id = NEW.pengunjung_id;
  END IF;

  IF NEW.status = 'selesai' THEN
    IF NEW.qr_token IS NULL THEN
      RETURN NULL;
    END IF;
    -- Walk-in FO tanpa akun pengunjung: email yang dicatat FO adalah satu-satunya jalur kontak yang wajar.
    v_email := COALESCE(NULLIF(pg_catalog.btrim(v_email), ''), NULLIF(pg_catalog.btrim(NEW.email), ''));
    SELECT setting.value INTO v_publik FROM public.site_settings AS setting WHERE setting.key = 'public_url';
    v_skm := COALESCE(v_publik, 'https://lmh.lampungprov.go.id') || '/skm?token=' || NEW.qr_token;
    IF v_email IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        NULL, v_email, 'email',
        'Survei Kepuasan Masyarakat - DPMPTSP Lampung',
        'Layanan Anda telah selesai. Mohon isi survei: ' || v_skm,
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'skm_survey')
      );
    END IF;
    IF v_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        v_user_id, NULL, 'web_push',
        'Layanan Selesai - Isi Survei SKM',
        'Layanan Anda telah selesai. Mohon isi survei: ' || v_skm,
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'skm_survey_push',
                                      'url', '/skm?token=' || NEW.qr_token)
      );
    END IF;
  ELSIF NEW.asal = 'reservasi' AND OLD.status = 'terjadwal' AND NEW.status IN ('dilayani', 'menunggu') THEN
    IF v_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        v_user_id, NULL, 'web_push',
        'Reservasi Dikonfirmasi',
        'Reservasi Anda telah dikonfirmasi oleh Front Office DPMPTSP Lampung.',
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'reservasi_confirmed', 'url', '/me')
      );
    END IF;
    IF v_email IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        NULL, v_email, 'email',
        'Reservasi Dikonfirmasi - DPMPTSP Lampung',
        'Reservasi Anda telah dikonfirmasi oleh Front Office DPMPTSP Lampung.',
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'reservasi_confirmed_email')
      );
    END IF;
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_kunjungan_status() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_kunjungan_status ON public.kunjungan;
CREATE TRIGGER trg_notify_kunjungan_status
  AFTER UPDATE OF status ON public.kunjungan
  FOR EACH ROW EXECUTE FUNCTION public.notify_kunjungan_status();

-- Tiket: terbit 'menunggu' -> masuk antrean; 'dilayani' -> giliran dimulai. Hanya pengunjung beraku (web push).
CREATE OR REPLACE FUNCTION public.notify_tiket_antrean()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id uuid;
  v_layanan text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
      RETURN NULL;
    END IF;
  END IF;
  IF NEW.status NOT IN ('menunggu', 'dilayani') THEN
    RETURN NULL;
  END IF;
  SELECT visitor.auth_user_id INTO v_user_id
  FROM public.kunjungan AS k JOIN public.pengunjung AS visitor ON visitor.id = k.pengunjung_id
  WHERE k.id = NEW.kunjungan_id;
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT l.nama INTO v_layanan FROM public.layanan AS l WHERE l.id = NEW.layanan_id;

  IF NEW.status = 'menunggu' THEN
    PERFORM public.queue_notifikasi(
      v_user_id, NULL, 'web_push',
      'Anda masuk antrean',
      pg_catalog.format('Nomor antrean Anda %s (%s). Mohon menunggu giliran di DPMPTSP Lampung.', NEW.nomor_display, v_layanan),
      pg_catalog.jsonb_build_object('kunjungan_id', NEW.kunjungan_id, 'tiket_id', NEW.id, 'type', 'tiket_menunggu', 'url', '/me')
    );
  ELSE
    PERFORM public.queue_notifikasi(
      v_user_id, NULL, 'web_push',
      'Giliran Anda dimulai',
      pg_catalog.format('Nomor %s: giliran Anda dimulai. Silakan menuju loket %s.', NEW.nomor_display, v_layanan),
      pg_catalog.jsonb_build_object('kunjungan_id', NEW.kunjungan_id, 'tiket_id', NEW.id, 'type', 'tiket_dilayani', 'url', '/me')
    );
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_tiket_antrean() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notify_tiket_antrean ON public.tiket_antrean;
CREATE TRIGGER trg_notify_tiket_antrean
  AFTER INSERT OR UPDATE OF status ON public.tiket_antrean
  FOR EACH ROW EXECUTE FUNCTION public.notify_tiket_antrean();

-- ============================================================
-- 6. Response rate SKM: kunjungan selesai -> +dilayani
-- ============================================================
CREATE OR REPLACE FUNCTION public.kunjungan_selesai_rr()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.status = 'selesai' AND OLD.status IS DISTINCT FROM 'selesai' THEN
    -- Layanan yang sama dengan skm_respons.layanan_id (NULL = selesai di FO; skm_rr_tambah mengabaikan NULL).
    PERFORM public.skm_rr_tambah(public.kunjungan_layanan_skm(NEW.id), 'dilayani');
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.kunjungan_selesai_rr() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kunjungan_selesai_rr ON public.kunjungan;
CREATE TRIGGER trg_kunjungan_selesai_rr
  AFTER UPDATE OF status ON public.kunjungan
  FOR EACH ROW EXECUTE FUNCTION public.kunjungan_selesai_rr();

-- ============================================================
-- 7. Audit status kunjungan dan tiket (pengganti trg_audit_visit_status)
-- ============================================================
DROP TRIGGER IF EXISTS trg_audit_kunjungan_status ON public.kunjungan;
CREATE TRIGGER trg_audit_kunjungan_status
  AFTER UPDATE OF status ON public.kunjungan
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.audit_change('update_status');

DROP TRIGGER IF EXISTS trg_audit_tiket_status ON public.tiket_antrean;
CREATE TRIGGER trg_audit_tiket_status
  AFTER UPDATE OF status ON public.tiket_antrean
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.audit_change('update_status');

-- ============================================================
-- 8. Estimasi waktu tunggu dari tiket_antrean (bentuk view tetap)
-- ============================================================
DROP VIEW IF EXISTS public.v_antrian_loket;
DROP MATERIALIZED VIEW IF EXISTS public.mv_estimasi_layanan;

CREATE MATERIALIZED VIEW public.mv_estimasi_layanan AS
SELECT
  t.layanan_id,
  EXTRACT(HOUR FROM t.waktu_mulai_layan)::integer AS jam_slot,
  avg(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60)::integer AS avg_durasi_menit,
  count(*)::integer AS sample_count
FROM public.tiket_antrean AS t
WHERE t.status = 'selesai'
  AND t.waktu_mulai_layan IS NOT NULL
  AND t.waktu_selesai IS NOT NULL
  AND t.waktu_mulai_layan > now() - INTERVAL '14 days'
GROUP BY t.layanan_id, jam_slot;

CREATE UNIQUE INDEX idx_mv_estimasi_layanan_key
  ON public.mv_estimasi_layanan(layanan_id, jam_slot);

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
-- 9. Pengingat petugas & metrik kepatuhan (tanpa visit)
-- ============================================================
CREATE OR REPLACE FUNCTION public.jumlah_terdaftar(p_layanan_id uuid, p_tanggal date)
RETURNS int
LANGUAGE sql STABLE
SET search_path = pg_catalog, public
AS $$
  SELECT count(*)::int FROM (
    SELECT k.id FROM public.kunjungan AS k
    WHERE k.asal = 'reservasi'
      AND k.layanan_saran_id = p_layanan_id
      AND k.tanggal = p_tanggal
      AND k.status IN ('terjadwal','menunggu','dilayani')
    UNION
    SELECT t.kunjungan_id FROM public.tiket_antrean AS t
    WHERE t.layanan_id = p_layanan_id
      AND t.tanggal = p_tanggal
      AND t.status IN ('menunggu','dipanggil','dilayani')
  ) AS terdaftar
$$;

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
    COALESCE((SELECT count(*) FROM public.tiket_antrean tk
      WHERE tk.layanan_id=p_layanan_id AND tk.status='tidak_terlayani'
        AND tk.tanggal BETWEEN p_awal AND p_akhir),0)::int,
    ROUND(COALESCE(AVG(EXTRACT(EPOCH FROM (jam_masuk::time - v_batas))/60) FILTER (WHERE hadir AND jam_masuk IS NOT NULL),0)::numeric, 1)
  FROM kehadiran;
END $$;
