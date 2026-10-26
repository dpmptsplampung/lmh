-- docs/rollback-survei-undangan-202610270001.sql
-- Rollback manual migrasi 202610270001_survei_undangan.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan
-- CEO, ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-survei-undangan-202610270001.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-survei-undangan-202610270001.sql --atomic
-- PERINGATAN: rollback ini menghapus SEMUA data undangan (tabel survei_undangan: token, batas kedaluwarsa, penanda sudah
--   diisi). Undangan tidak bisa dipulihkan dari migrasi; kunjungan yang sudah selesai TIDAK otomatis mendapat undangan lagi
--   setelah migrasi diterapkan ulang (trigger hanya untuk perubahan status berikutnya, tanpa backfill). QR yang sudah
--   ditampilkan/dipindai berhenti berlaku.
-- URUTAN: jalankan PALING AKHIR dalam seri survei terpadu Fase A, yaitu SETELAH rollback 202610270004, 202610270003, dan
--   202610270002 (objek di migrasi itu memakai survei_undangan dan ensure_undangan).
-- PENJAGA (blok DO di awal; JANGAN dihapus): Postgres menolak DROP tanpa CASCADE hanya untuk ketergantungan yang ia
--   CATAT (view, FK, trigger, policy, constraint, ...). Badan fungsi PL/pgSQL (dan fungsi SQL biasa) terikat lambat:
--   TIDAK ada ketergantungan tercatat ke fungsi/tabel yang dipanggilnya, jadi DROP FUNCTION/TABLE di bawah akan berhasil
--   walau fungsi lain masih memakainya, dan fungsi itu baru gagal saat dipanggil ("function ... does not exist"; mis.
--   notify_kunjungan_status yang memanggil ensure_undangan, sehingga SETIAP UPDATE kunjungan ke 'selesai' gagal). Penjaga
--   menolak seluruh rollback (PRASYARAT ROLLBACK) bila ada fungsi di schema public, selain tiga fungsi yang di-DROP di
--   sini, yang teks badannya menyebut ensure_undangan atau survei_undangan. Pencocokan teks bersifat konservatif (komentar
--   di badan fungsi ikut dihitung): bila penjaga menolak, rollback migrasi yang memakai objek itu dulu, atau periksa nama
--   fungsi yang dilaporkan. Penjaga ini tidak melihat pemakai di luar pg_proc (mis. job pg_cron atau kode klien).
-- Tanpa CASCADE (supaya ketergantungan yang TERCATAT menggagalkan DROP, bukan menghapus objek lain diam-diam).
-- Urutan DROP di bawah = kebalikan pembuatan: view, ambil_qr_survei, trigger, fungsi trigger, ensure_undangan, tabel.
-- Idempoten (semua IF EXISTS).

DO $$
DECLARE
  v_fungsi text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT p.oid::pg_catalog.regprocedure::text, ', ') INTO v_fungsi
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('ambil_qr_survei', 'kunjungan_selesai_undangan', 'ensure_undangan')
    AND p.prosrc ~* '(ensure_undangan|survei_undangan)';
  IF v_fungsi IS NOT NULL THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: fungsi lain masih memakai ensure_undangan/survei_undangan (rollback migrasi yang memakainya dulu: 202610270004, 202610270003, 202610270002): %', v_fungsi;
  END IF;
END $$;

DROP VIEW IF EXISTS public.v_survei_status;
DROP FUNCTION IF EXISTS public.ambil_qr_survei(uuid);
DROP TRIGGER IF EXISTS trg_kunjungan_selesai_undangan ON public.kunjungan;
DROP FUNCTION IF EXISTS public.kunjungan_selesai_undangan();
DROP FUNCTION IF EXISTS public.ensure_undangan(uuid);
DROP TABLE IF EXISTS public.survei_undangan;
