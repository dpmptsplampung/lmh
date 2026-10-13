-- 202610140002_tiket_kepemilikan.sql
-- Kepemilikan tiket layanan + transisi status atomik (tugas A3; audit T1; spec
-- docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §4.6; investigasi docs/analysis/ANTREAN-ARAH-TULIS.md §5,
-- Opsi 1). ATURAN CEO: satu tiket hanya boleh DISELESAIKAN oleh orang yang MEMULAINYA.
--
-- KEPUTUSAN CEO YANG DITERAPKAN DI SINI (mengubah pseudocode A0 §5.3):
--   7.1 Admin BOLEH memulai dan menjadi pemilik tiket layanan mana pun; petugas hanya layanannya;
--       Front Office DITOLAK untuk layanan_mulai dan layanan_selesai (juga lewat finalize_pelayanan).
--   7.2 Jalur darurat minimal: admin_ambil_alih(tiket, alasan) - hanya Admin (sesi sah), tiket 'dilayani' yang
--       bukan miliknya, alasan wajib (>= 5 karakter); mengganti dilayani_oleh menjadi Admin itu dan mencatat
--       audit_log (pemilik lama, pemilik baru, alasan). Status TIDAK berubah.
--   7.3 Backfill dilayani_oleh HANYA untuk tiket 'dilayani' yang dilayani_oleh-nya NULL: aktor entri audit_log
--       transisi visit ke 'dilayani' yang TERAKHIR dipetakan ke petugas.id; bila entri terakhir tak dapat dipetakan
--       (aktor NULL/system atau bukan staf) dibiarkan NULL (tidak menebak dari entri lain). Tiket selesai tidak disentuh.
--   7.4 Validasi pendataan TIDAK diubah (Tahap C). layanan_selesai memakai logika upsert pelayanan_* dari
--       finalize_pelayanan (202610010001 bagian e) apa adanya, dengan petugas_id = pemilik (pemanggil).
--   7.5 Draf pendataan: tulis draf (INSERT/UPDATE pelayanan_oss / pelayanan_perizinan lewat PostgREST/route) hanya
--       bila tiket 'dilayani' dan pemanggil = dilayani_oleh. Policy oss/perizinan_{insert,update}_staff diperketat
--       dengan helper pemilik_tiket() (bagian 5).
--
-- ARAH TULIS (A0 Opsi 1): tiket_antrean = sumber kebenaran. Guard atomik di baris tiket, lalu baris visit terkait
-- (legacy_visit_id) disinkronkan dalam transaksi yang sama dengan nilai IDENTIK (satu v_now). trg_visit_dual_write
-- (sync_visit_dual_write) dan panggil_tiket TIDAK diubah. Pembaca visit (SKM, notifikasi, audit, estimasi) tetap benar.
--   Urutan kunci = jalur lama: visit -> kunjungan -> tiket (SELECT ... FOR UPDATE sebelum UPDATE tiket) agar tidak
--   deadlock dengan scan/cron/klien lama yang selalu mengunci visit lebih dulu.
--   Trigger dual-write menulis ulang tiket dengan nilai yang sama (status, waktu_*, updated_at = now() transaksi)
--   dan TIDAK menyentuh dilayani_oleh. Akibat samping: dua siaran realtime antrean:publik per aksi (idempoten).
--
-- MENUTUP JALUR PINTAS (tanpa ini T1 belum tertutup):
--   - DROP POLICY tiket_staff_update (tanpa pengganti): UPDATE langsung tiket_antrean lewat PostgREST = 0 baris.
--     RPC/trigger berjalan sebagai pemilik tabel (RLS tidak FORCE) sehingga tidak terpengaruh.
--   - Trigger penjaga trg_guard_visit_transisi_layanan (BEFORE UPDATE ON visit): menolak transisi masuk/keluar
--     'dilayani'/'selesai' dan perubahan waktu_mulai_layan/waktu_selesai, KECUALI flag transaksi-lokal
--     lmh.antrean_rpc = 'on' (pola lmh.koreksi, 202610090001). Galat: TRANSISI_LEWAT_RPC (42501).
--     Tetap lolos: scan check-in (terjadwal->menunggu/batal), cron akhir hari (menunggu->tidak_terlayani),
--     cron no-show (terjadwal->no_show), perubahan kolom lain (catatan, keperluan, dst.).
--   - finalize_pelayanan menjadi PEMBUNGKUS layanan_selesai (signature dan grant sama): klien/route lama otomatis
--     terkena aturan pemilik dan FO tidak lagi bisa menyelesaikan.
--
-- KODE GALAT (awal pesan; klien mencocokkan awalan, bukan SQLSTATE saja):
--   FORBIDDEN (42501)         bukan staf aktif / peran tidak berwenang (FO, petugas layanan lain)
--   SESI_TIDAK_SAH (42501)    sesi_valid() = false (digantikan login lain / idle / tidak terdaftar; 202610140001)
--   NOT_FOUND (P0002)         tiket tidak ada
--   SUDAH_DIAMBIL (P0001)     layanan_mulai kalah balapan: tiket sudah dilayani/selesai oleh orang lain
--   INVALID_STATUS (P0001)    status tiket tidak sesuai aksi
--   BUKAN_PEMILIK (42501)     layanan_selesai oleh selain dilayani_oleh
--   DIVERGENSI (P0001)        visit tidak berstatus seperti tiket; seluruh transaksi di-rollback
--   ALASAN_WAJIB (22023)      admin_ambil_alih tanpa alasan >= 5 karakter
--   INVALID_FORM / LOCKED     (dari logika finalize_pelayanan yang dipertahankan)
--   TRANSISI_LEWAT_RPC (42501) UPDATE langsung visit yang dicegah trigger penjaga
--
-- SYARAT: 202610140001_sesi_staf (sesi_valid), 202610080001 (staf_saya), 202610090001 (trg_enforce_pelayanan_lock,
-- boleh_tiket), 202610090004 (audit_log.nilai_lama/nilai_baru). Penjaga di bagian 0.
-- URUTAN PENERAPAN: 202610140001 dulu -> deploy klien A2 (sesi tunggal) -> deploy klien A3 (halaman antrean memakai
-- RPC) BERSAMAAN dengan migrasi ini. Terapkan DI LUAR JAM LAYANAN dan saat TIDAK ADA tiket 'dilayani' hari itu.
-- Klien lama yang masih terbuka akan menerima TRANSISI_LEWAT_RPC saat menekan Mulai/Selesai dan harus memuat ulang.
-- PENERAPAN: membuat fungsi/policy/trigger, jadi WAJIB mode atomik. Dry-run dulu:
--   node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic
-- Idempoten (CREATE OR REPLACE, DROP ... IF EXISTS, backfill hanya baris NULL). Sentuh produksi hanya setelah
-- konfirmasi CEO (docs/ATURAN_MIGRASI.md). Rollback: docs/rollback-tiket-kepemilikan-202610140002.sql.
-- Uji perilaku (transaksi di-ROLLBACK, butuh konfirmasi CEO): scripts/test-tiket-kepemilikan.mjs.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.sesi_valid() belum ada (terapkan 202610140001_sesi_staf.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.staf_saya()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.staf_saya() belum ada (terapkan 202610080001_rbac_tahap0_keamanan.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.boleh_tiket(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.boleh_tiket(uuid) belum ada (terapkan 202610090001_rbac_tahap1.sql lebih dulu)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.tiket_antrean'::regclass AND a.attname = 'dilayani_oleh' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom tiket_antrean.dilayani_oleh belum ada (202607290013)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.audit_log'::regclass AND a.attname = 'nilai_baru' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom audit_log.nilai_baru belum ada (terapkan 202610090004_kelola_layanan_audit.sql lebih dulu)';
  END IF;
END $$;

-- ============================================================
-- 1. layanan_mulai(tiket): menunggu -> dilayani, dilayani_oleh = pemanggil (atomik)
-- ============================================================
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
  -- Identitas dari sesi (bukan parameter).
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

  -- Peran (keputusan CEO 7.1): admin semua layanan; petugas hanya layanannya; front_office ditolak.
  IF NOT (
    v_me_role = 'admin'
    OR (v_me_role = 'petugas' AND v_me_layanan IS NOT NULL AND v_me_layanan = v_t.layanan_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau petugas layanan ini yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;

  -- Urutan kunci = jalur lama (visit -> kunjungan -> tiket).
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM 1 FROM public.visit AS v WHERE v.id = v_t.legacy_visit_id FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id FOR UPDATE;

  -- Guard atomik: hanya satu pemanggil yang menang (read committed mengevaluasi ulang WHERE pada versi terbaru).
  UPDATE public.tiket_antrean AS t
     SET status = 'dilayani', dilayani_oleh = v_me_id, waktu_mulai_layan = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status IN ('menunggu', 'dipanggil') AND t.dilayani_oleh IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT t.status, t.dilayani_oleh, t.waktu_mulai_layan INTO v_cek
    FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
    -- Idempoten untuk klik ganda oleh pemilik yang sama.
    IF v_cek.status = 'dilayani' AND v_cek.dilayani_oleh = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_cek.waktu_mulai_layan);
    END IF;
    IF v_cek.status IN ('dilayani', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
  END IF;

  -- Sinkron visit (WP-24 / Tahap B: hapus blok ini). Nilai identik; trigger penjaga diizinkan lewat flag lokal.
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

-- ============================================================
-- 2. layanan_selesai(tiket, form, payload): dilayani -> selesai, HANYA oleh pemilik
-- ============================================================
CREATE OR REPLACE FUNCTION public.layanan_selesai(
  p_tiket_id  uuid,
  p_form_type text DEFAULT NULL,
  p_payload   jsonb DEFAULT NULL
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
  v_existing record;
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
  -- Keputusan CEO 7.1: Front Office tidak memulai/menyelesaikan tiket layanan.
  IF v_me_role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: Front Office tidak menyelesaikan tiket layanan' USING ERRCODE = '42501';
  END IF;
  IF p_form_type IS NOT NULL AND p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;

  SELECT t.legacy_visit_id, t.kunjungan_id INTO v_legacy, v_kunj
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Urutan kunci = jalur lama (visit -> kunjungan -> tiket). Pemanggil konkuren kedua menunggu di sini,
  -- lalu melihat status 'selesai' (INVALID_STATUS).
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
  -- Aturan CEO: hanya orang yang memulai yang boleh menyelesaikan (Admin pun lewat admin_ambil_alih dulu).
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain' USING ERRCODE = '42501';
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
      -- petugas_id = pemilik (yang menyelesaikan), bukan penyimpan draf pertama (keputusan CEO 7.4).
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

  -- Guard atomik tiket (baris sudah dikunci di atas; 0 baris = keadaan tak terduga).
  UPDATE public.tiket_antrean AS t
     SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket % berubah selama penyelesaian', p_tiket_id USING ERRCODE = 'P0001';
  END IF;

  -- Sinkron visit (WP-24 / Tahap B: hapus blok ini). SKM/notifikasi/audit/response-rate tetap lewat trigger visit.
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
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now);
END $$;

-- ============================================================
-- 3. finalize_pelayanan: PEMBUNGKUS layanan_selesai (signature dan grant sama dengan 202610010001)
-- ============================================================
-- Kontrak lama dipertahankan: form wajib ('oss'/'perizinan'). Aturan pemilik + penolakan FO berlaku otomatis.
CREATE OR REPLACE FUNCTION public.finalize_pelayanan(
  p_tiket_id  uuid,
  p_form_type text,
  p_payload   jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_form_type IS NULL OR p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;
  RETURN public.layanan_selesai(p_tiket_id, p_form_type, p_payload);
END $$;

-- ============================================================
-- 4. admin_ambil_alih(tiket, alasan): jalur darurat (keputusan CEO 7.2)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_ambil_alih(p_tiket_id uuid, p_alasan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_t       record;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin aktif yang boleh mengambil alih tiket' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF p_alasan IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_alasan)) < 5 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih wajib diisi (minimal 5 karakter)' USING ERRCODE = '22023';
  END IF;

  -- Kunci baris tiket (menserialkan dengan layanan_selesai yang juga mengunci baris ini).
  SELECT t.id, t.status, t.dilayani_oleh INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: hanya tiket yang sedang dilayani yang dapat diambil alih (status=%)', v_t.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh = v_me_id THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id);
  END IF;

  -- Status dan waktu TIDAK berubah; updated_at sengaja tidak disentuh (tetap = visit.updated_at, A0 §1.3).
  UPDATE public.tiket_antrean AS t SET dilayani_oleh = v_me_id WHERE t.id = p_tiket_id AND t.status = 'dilayani';

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'admin_ambil_alih', 'tiket_antrean', p_tiket_id::text,
    pg_catalog.jsonb_build_object(
      'tiket_id', p_tiket_id,
      'pemilik_lama', v_t.dilayani_oleh,
      'pemilik_baru', v_me_id,
      'alasan', pg_catalog.btrim(p_alasan)
    ),
    pg_catalog.jsonb_build_object('dilayani_oleh', v_t.dilayani_oleh),
    pg_catalog.jsonb_build_object('dilayani_oleh', v_me_id)
  );

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'pemilik_lama', v_t.dilayani_oleh, 'dilayani_oleh', v_me_id);
END $$;

-- ============================================================
-- 5. Helper RLS draf pendataan (keputusan CEO 7.5)
-- ============================================================
-- true bila tiket sedang 'dilayani' dan pemiliknya adalah staf aktif pemanggil.
CREATE OR REPLACE FUNCTION public.pemilik_tiket(p_tiket uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tiket_antrean AS t
    JOIN public.staf_saya() AS me ON me.id = t.dilayani_oleh
    WHERE t.id = p_tiket AND t.status = 'dilayani'
  )
$$;

-- ============================================================
-- 6. Hak eksekusi
-- ============================================================
REVOKE ALL ON FUNCTION public.layanan_mulai(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_mulai(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.layanan_selesai(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai(uuid, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_ambil_alih(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ambil_alih(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.pemilik_tiket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pemilik_tiket(uuid) TO authenticated, service_role;
-- Sama dengan 202610010001.
REVOKE ALL ON FUNCTION public.finalize_pelayanan(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_pelayanan(uuid, text, jsonb) TO authenticated;

-- ============================================================
-- 7. Penjaga transisi visit (menutup UPDATE langsung lewat PostgREST)
-- ============================================================
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

-- ============================================================
-- 8. Policy: cabut UPDATE langsung tiket_antrean; draf pendataan hanya pemilik (7.5)
-- ============================================================
DROP POLICY IF EXISTS tiket_staff_update ON public.tiket_antrean;   -- sengaja tanpa policy UPDATE pengganti

DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
    AND public.pemilik_tiket(tiket_id)
  );

DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id));

DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
    AND public.pemilik_tiket(tiket_id)
  );

DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id) AND public.pemilik_tiket(tiket_id));

-- ============================================================
-- 9. Backfill dilayani_oleh (keputusan CEO 7.3): hanya tiket 'dilayani' dengan dilayani_oleh NULL
-- ============================================================
-- Entri audit TERAKHIR transisi visit ke 'dilayani' (trg_audit_visit_status: aksi 'update_status', entitas 'visit',
-- detail->>'status'). Aktornya dipetakan ke petugas.id (auth_user_id UNIQUE). Bila aktor entri terakhir NULL atau
-- bukan staf, hasil subquery NULL dan baris dilewati: tidak menebak dari entri yang lebih lama.
UPDATE public.tiket_antrean AS t
   SET dilayani_oleh = b.petugas_id
  FROM (
    SELECT t2.id AS tiket_id,
           (SELECT p.id
              FROM (SELECT a.actor_id
                      FROM public.audit_log AS a
                     WHERE a.entitas = 'visit'
                       AND a.aksi = 'update_status'
                       AND a.entitas_id = t2.legacy_visit_id::text
                       AND a.detail ->> 'status' = 'dilayani'
                     ORDER BY a.created_at DESC, a.id DESC
                     LIMIT 1) AS terakhir
              JOIN public.petugas AS p ON p.auth_user_id = terakhir.actor_id) AS petugas_id
      FROM public.tiket_antrean AS t2
     WHERE t2.status = 'dilayani' AND t2.dilayani_oleh IS NULL AND t2.legacy_visit_id IS NOT NULL
  ) AS b
 WHERE t.id = b.tiket_id
   AND b.petugas_id IS NOT NULL
   AND t.status = 'dilayani'
   AND t.dilayani_oleh IS NULL;
