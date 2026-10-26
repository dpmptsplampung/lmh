-- docs/rollback-survei-rpc-202610270003.sql
-- Rollback manual migrasi 202610270003_survei_rpc.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan CEO, ATOMIK
-- (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-survei-rpc-202610270003.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-survei-rpc-202610270003.sql --atomic
-- PERINGATAN: sesudah rollback ini halaman survei (/survei/<token>) tidak bisa memuat konteks maupun mengirim jawaban (kedua
--   RPC hilang, panggilan anon gagal "function ... does not exist"). Jawaban yang sudah tersimpan TIDAK dihapus (rollback ini
--   tidak menyentuh tabel), dan undangan serta diisi_pada tetap. Menerapkan ulang migrasi memulihkan kedua RPC tanpa mengubah data.
-- URUTAN: jalankan SETELAH rollback 202610270004 (bila ada fungsi di sana yang memakai kedua RPC ini), dan SEBELUM rollback
--   202610270002 dan 202610270001 (keduanya menolak selama kirim_survei/get_survei_context masih ada, karena badan fungsinya
--   menyebut spak_respons, kolom u10/u11, dan survei_undangan).
-- PENJAGA (blok DO di awal; JANGAN dihapus): Postgres menolak DROP tanpa CASCADE hanya untuk ketergantungan yang ia CATAT (view,
--   FK, trigger, policy, constraint, ...). Badan fungsi PL/pgSQL (dan fungsi SQL biasa) terikat lambat: TIDAK ada ketergantungan
--   tercatat ke fungsi yang dipanggilnya, jadi DROP FUNCTION di bawah akan berhasil walau fungsi lain masih memanggilnya, dan fungsi
--   itu baru gagal saat dipanggil. Penjaga menolak seluruh rollback (PRASYARAT ROLLBACK) bila ada fungsi di schema public, selain
--   dua fungsi yang di-DROP di sini, yang teks badannya menyebut kirim_survei atau get_survei_context. Pencocokan teks bersifat
--   konservatif (komentar di badan fungsi ikut dihitung): bila penjaga menolak, rollback migrasi yang memakai kedua RPC itu dulu,
--   atau periksa nama fungsi yang dilaporkan. Penjaga ini tidak melihat pemakai di luar pg_proc (mis. job pg_cron atau kode
--   klien/route /api/survei/*, yang akan gagal pada panggilan RPC).
-- Tanpa CASCADE (supaya ketergantungan yang TERCATAT menggagalkan DROP, bukan menghapus objek lain diam-diam).
-- Urutan DROP di bawah = kebalikan pembuatan. Idempoten (IF EXISTS).

DO $$
DECLARE
  v_fungsi text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT p.oid::pg_catalog.regprocedure::text, ', ') INTO v_fungsi
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('get_survei_context', 'kirim_survei')
    AND p.prosrc ~* '(get_survei_context|kirim_survei)';
  IF v_fungsi IS NOT NULL THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: fungsi lain masih memakai kirim_survei/get_survei_context (rollback migrasi yang memakainya dulu: 202610270004): %', v_fungsi;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.kirim_survei(text, jsonb, jsonb);
DROP FUNCTION IF EXISTS public.get_survei_context(text);
