-- 202610270004_survei_notifikasi.sql
-- SURVEI TERPADU FASE A, langkah 4 dari 4 (spec: docs/superpowers/specs/2026-10-26-survei-terpadu-design.md §8, §13): email dan
-- web push survei yang diantrekan saat kunjungan SELESAI memakai tautan UNDANGAN (/survei/<token>, token dari survei_undangan,
-- migrasi 0001), bukan lagi tautan berbasis kunjungan.qr_token ke halaman SKM lama.
--
-- MASALAH: notify_kunjungan_status() (202610140007) mengantrekan email dan push survei dengan tautan lama berbasis qr_token.
--   Wizard baru (Pesan Perilaku: SPAK + SKM 11 unsur) hanya bisa dibuka lewat token undangan, jadi email/push harus membawa
--   tautan itu. Tautan lama TETAP berfungsi untuk email yang sudah terkirim (halaman lama tidak disentuh seri ini).
--
-- ISI (satu fungsi diganti; tanpa tabel/kolom/policy/trigger baru dan tanpa DML):
--   notify_kunjungan_status() di-CREATE OR REPLACE PENUH dari versi 202610140007. HANYA cabang status = 'selesai' yang berubah:
--     1. cek "kunjungan tidak punya qr_token -> keluar" diganti: v_undangan := ensure_undangan(NEW.id); token dibaca dari
--        survei_undangan lewat id itu; tanpa token (undangan tidak terbit) -> RETURN NULL tanpa notifikasi apa pun. ensure_undangan
--        IDEMPOTEN (spec §4.1): trigger trg_kunjungan_selesai_undangan (0001) juga memanggilnya, jadi urutan kedua trigger tidak
--        berpengaruh dan batas 32 jam tidak bergeser walau dipanggil dua kali.
--     2. tautan di isi email dan isi push (v_skm) menjadi <public_url>/survei/<token>.
--     3. payload.url push menjadi /survei/<token> (jalur relatif).
--   Semuanya yang lain TIDAK berubah dan diuji identik dengan 0007 (supabase/migrations/survei_notifikasi.test.ts, perbandingan teks
--   setelah spasi dinormalkan): signature, RETURNS trigger, LANGUAGE plpgsql, SECURITY DEFINER, SET search_path = pg_catalog, public,
--   REVOKE ALL ... FROM PUBLIC, anon, authenticated (tanpa GRANT; ACL yang ada dipertahankan), seluruh DECLARE (hanya v_undangan dan
--   v_token ditambahkan di akhir), bagian sebelum cabang selesai (cek status berubah, baca pengunjung), email walk-in FO tanpa
--   akun, judul/isi/jenis notifikasi (skm_survey, skm_survey_push; kunci idempotensi queue_notifikasi per kunjungan+jenis tetap),
--   dan cabang reservasi dikonfirmasi. Trigger trg_notify_kunjungan_status (AFTER UPDATE OF status ON kunjungan) TIDAK dibuat ulang:
--   CREATE OR REPLACE mempertahankan trigger yang menunjuk fungsi ini. ensure_undangan hanya EXECUTE service_role dan pemilik; fungsi
--   ini SECURITY DEFINER (berjalan sebagai pemilik), jadi pemanggilan itu sah tanpa mengubah hak apa pun.
--
-- PERILAKU YANG PERLU DIKETAHUI:
--   (a) Kunjungan yang selesai SEBELUM migrasi 0001 tidak punya undangan (tanpa backfill): bila status kunjungan itu berubah ke
--       'selesai' lagi (dibuka lalu diselesaikan ulang), ensure_undangan membuatnya SAAT ITU dengan batas 32 jam dari selesai_at
--       yang baru; bila undangan sudah ada, undangan lama dipakai apa adanya (token dan batas tidak bergeser), jadi tautan di email
--       bisa sudah kedaluwarsa atau sudah diisi; halaman survei menampilkannya sebagai kedaluwarsa/sudah diisi.
--   (b) Judul dan teks notifikasi tidak diubah (masih "Survei Kepuasan Masyarakat ..." dan "Isi Survei SKM"): hanya tautan yang
--       diganti; perubahan teks ke nama "Pesan Perilaku" adalah keputusan terpisah.
--   (c) Cek lama "tanpa qr_token tidak ada notifikasi" dibuang karena tautan baru tidak memakai qr_token; digantikan cek token
--       undangan. Semua kunjungan yang dibuat oleh alur yang ada memang punya qr_token, jadi tidak ada perubahan perilaku nyata.
--   (d) Fungsi ini TIDAK bisa dijalankan di stub PGlite (scripts/lokal): perilakunya diverifikasi statis lewat test kontrak
--       (perbandingan teks dengan 0007) dan dry-run oleh pemilik di DB nyata. Tidak ada skenario PGlite untuk migrasi ini.
--
-- SYARAT: notify_kunjungan_status() (202610140007) dan ensure_undangan(uuid) (202610270001); dijaga blok PRASYARAT di bawah.
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO; migrasi ini DITULIS tetapi BELUM DITERAPKAN):
--   node scripts/apply-migration.mjs supabase/migrations/202610270004_survei_notifikasi.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610270004_survei_notifikasi.sql --atomic
-- Idempoten (CREATE OR REPLACE dan REVOKE ulang): menerapkan ulang tidak mengubah data.
-- ROLLBACK: docs/rollback-survei-notifikasi-202610270004.sql (memulihkan fungsi 0007 PERSIS; jalankan PERTAMA dalam seri
--   rollback, sebelum rollback 0003, 0002, dan 0001; rollback 0001 menolak selama fungsi ini masih memanggil ensure_undangan).
-- UJI: kontrak statis supabase/migrations/survei_notifikasi.test.ts (tanpa skenario PGlite, lihat (d)).

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.notify_kunjungan_status()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.notify_kunjungan_status() belum ada (202610140007_wp24_akhiri_dual_write)';
  END IF;
  IF pg_catalog.to_regprocedure('public.ensure_undangan(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.ensure_undangan(uuid) belum ada (202610270001_survei_undangan)';
  END IF;
END $$;

-- ============================================================
-- 1. notify_kunjungan_status: hanya cabang selesai yang berubah
-- ============================================================
-- Kunjungan: selesai -> survei (email + push, tautan undangan); reservasi terjadwal -> dilayani/menunggu -> dikonfirmasi.
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
  v_undangan uuid;
  v_token    text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.pengunjung_id IS NOT NULL THEN
    SELECT visitor.email, visitor.auth_user_id INTO v_email, v_user_id
    FROM public.pengunjung AS visitor WHERE visitor.id = NEW.pengunjung_id;
  END IF;

  IF NEW.status = 'selesai' THEN
    -- Tautan survei = token UNDANGAN (survei_undangan), terpisah dari token kunjungan, berlaku 32 jam sejak selesai.
    -- ensure_undangan idempoten (trigger undangan juga memanggilnya): undangan yang ada dipakai apa adanya, batas tidak bergeser.
    v_undangan := public.ensure_undangan(NEW.id);
    SELECT u.token INTO v_token FROM public.survei_undangan AS u WHERE u.id = v_undangan;
    IF v_token IS NULL THEN
      RETURN NULL;
    END IF;
    -- Walk-in FO tanpa akun pengunjung: email yang dicatat FO adalah satu-satunya jalur kontak yang wajar.
    v_email := COALESCE(NULLIF(pg_catalog.btrim(v_email), ''), NULLIF(pg_catalog.btrim(NEW.email), ''));
    SELECT setting.value INTO v_publik FROM public.site_settings AS setting WHERE setting.key = 'public_url';
    v_skm := COALESCE(v_publik, 'https://lmh.lampungprov.go.id') || '/survei/' || v_token;
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
                                      'url', '/survei/' || v_token)
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
