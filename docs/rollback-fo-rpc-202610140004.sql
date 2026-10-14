-- Rollback manual migrasi 202610140004_fo_rpc.sql (hapus RPC alur Front Office).
-- Terapkan ATOMIK (dry-run dulu), SETELAH rollback 202610140005 dan SEBELUM rollback 202610140003:
--   node scripts/apply-migration.mjs docs/rollback-fo-rpc-202610140004.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-fo-rpc-202610140004.sql --atomic
--
-- Yang dikembalikan: 10 RPC klien dan 5 fungsi internal milik 202610140004 di-DROP (IF EXISTS, tanpa CASCADE).
-- Migrasi ini tidak mengubah objek lama, jadi tidak ada yang perlu dipulihkan.
-- Penjaga di awal menolak rollback bila fungsi LAIN masih memanggil fungsi milik migrasi ini (mis. 202610140005
-- belum di-rollback: layanan_selesai/tandai_tidak_terlayani_akhir_hari memanggil fo_sinkron_visit). Badan plpgsql
-- terikat lambat; tanpa penjaga, pemanggil itu baru gagal saat dipakai.
-- TIDAK dikembalikan (data): kunjungan/penanganan/tiket/audit_log/notifikasi yang ditulis RPC ini.
-- Klien Tahap B (halaman FO, me/reservasi baru) akan gagal setelah rollback: kembalikan kode klien bersamaan.
-- Idempoten.

DO $$
DECLARE
  v_fungsi text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT p.proname, ', ') INTO v_fungsi
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('fo_mulai_kunjungan', 'fo_checkin_reservasi', 'fo_tolak_reservasi', 'fo_selesai',
                          'fo_eskalasi', 'fo_ambil_dari_kotak_masuk', 'layanan_kembalikan', 'admin_alihkan',
                          'reservasi_buat', 'reservasi_batalkan', 'staf_wajib_sesi', 'fo_validasi_topik',
                          'fo_validasi_catatan', 'fo_sinkron_visit', 'fo_notifikasi_tiket')
    AND p.prosrc ~* '(staf_wajib_sesi|fo_validasi_topik|fo_validasi_catatan|fo_sinkron_visit|fo_notifikasi_tiket|fo_mulai_kunjungan|fo_checkin_reservasi|fo_tolak_reservasi|fo_selesai|fo_eskalasi|fo_ambil_dari_kotak_masuk|layanan_kembalikan|admin_alihkan|reservasi_buat|reservasi_batalkan)[[:space:]]*\(';
  IF v_fungsi IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: fungsi ini masih memanggil fungsi 202610140004 (rollback 202610140005 dulu): %', v_fungsi;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.reservasi_batalkan(uuid);
DROP FUNCTION IF EXISTS public.reservasi_buat(text, date, uuid, text, text, time);
DROP FUNCTION IF EXISTS public.admin_alihkan(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.layanan_kembalikan(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.fo_ambil_dari_kotak_masuk(uuid);
DROP FUNCTION IF EXISTS public.fo_eskalasi(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fo_selesai(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.fo_tolak_reservasi(text, text);
DROP FUNCTION IF EXISTS public.fo_checkin_reservasi(text);
DROP FUNCTION IF EXISTS public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.fo_notifikasi_tiket(uuid, text);
DROP FUNCTION IF EXISTS public.fo_sinkron_visit(uuid);
DROP FUNCTION IF EXISTS public.fo_validasi_catatan(text, integer);
DROP FUNCTION IF EXISTS public.fo_validasi_topik(uuid, uuid);
DROP FUNCTION IF EXISTS public.staf_wajib_sesi(text[]);
