-- docs/rollback-survei-notifikasi-202610270004.sql
-- Rollback manual migrasi 202610270004_survei_notifikasi.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan CEO, ATOMIK
-- (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-survei-notifikasi-202610270004.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-survei-notifikasi-202610270004.sql --atomic
-- ISI: memulihkan notify_kunjungan_status() PERSIS ke versi 202610140007_wp24_akhiri_dual_write.sql (salinan karakter demi karakter,
--   dijaga test supabase/migrations/survei_notifikasi.test.ts), lalu mengulang REVOKE yang sama (CREATE OR REPLACE mempertahankan ACL; REVOKE
--   hanya menegaskan). Trigger trg_notify_kunjungan_status tidak disentuh. Fungsi TIDAK di-DROP: trigger menunjuknya (ketergantungan
--   tercatat), jadi DROP akan gagal dan, dengan CASCADE, justru menghapus trigger.
-- PERINGATAN: sesudah rollback ini email dan web push survei kembali memuat tautan lama berbasis kunjungan.qr_token ke halaman SKM lama,
--   BUKAN tautan undangan /survei/<token>. Undangan (survei_undangan) tetap dibuat trigger 0001 tetapi tidak lagi dikirim ke pengunjung;
--   email yang sudah terkirim dengan tautan undangan tetap bisa dipakai selama undangannya ada dan belum kedaluwarsa.
-- URUTAN: jalankan PERTAMA dalam seri rollback survei terpadu Fase A, yaitu SEBELUM rollback 202610270003, 202610270002, dan 202610270001
--   (rollback 202610270001 menolak selama fungsi notifikasi masih memanggil ensure_undangan; rollback ini menghilangkan pemanggilan itu).
-- PENJAGA (blok DO di awal; JANGAN dihapus): CREATE OR REPLACE menimpa isi fungsi APA PUN yang sedang terpasang. Penjaga menolak seluruh
--   rollback (PRASYARAT ROLLBACK) bila (1) fungsinya tidak ada, atau (2) isinya BUKAN versi 202610270004 (memanggil ensure_undangan dan
--   memakai /survei/, tanpa tautan lama) dan BUKAN versi 202610140007 yang sudah pulih (memuat tautan lama, tanpa ensure_undangan;
--   memulihkan lagi aman dan idempoten). Isi lain (mis. fungsi sudah diganti migrasi lanjutan) ditolak supaya perubahan itu tidak
--   tertimpa diam-diam. Pencocokan memakai teks badan fungsi, komentar ikut dihitung (badan fungsi baru sengaja tanpa penanda lama).
--   Keterbatasan: migrasi lanjutan yang menyalin versi 202610270004 lalu mengubah bagian lain akan lolos penjaga; periksa isi fungsi
--   terpasang (pg_get_functiondef) sebelum menjalankan rollback bila ada migrasi lain yang menyentuh fungsi ini. Penjaga tidak melihat
--   pemakai di luar pg_proc.
-- Idempoten.

DO $$
DECLARE
  v_src text;
BEGIN
  SELECT p.prosrc INTO v_src
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = pg_catalog.to_regprocedure('public.notify_kunjungan_status()');
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: public.notify_kunjungan_status() tidak ada (202610140007_wp24_akhiri_dual_write belum terpasang)';
  END IF;
  IF NOT (
    (pg_catalog.strpos(v_src, 'ensure_undangan') > 0
      AND pg_catalog.strpos(v_src, '/survei/') > 0
      AND pg_catalog.strpos(v_src, '/skm?token=') = 0)
    OR
    (pg_catalog.strpos(v_src, '/skm?token=') > 0
      AND pg_catalog.strpos(v_src, 'ensure_undangan') = 0)
  ) THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: isi notify_kunjungan_status() bukan versi 202610270004 maupun 202610140007 (sudah diganti migrasi lain?); periksa dulu supaya perubahan itu tidak tertimpa';
  END IF;
END $$;

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
