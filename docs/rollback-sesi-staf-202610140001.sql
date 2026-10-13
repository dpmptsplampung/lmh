-- Rollback manual migrasi 202610140001_sesi_staf.sql (kembali ke keadaan sebelum sesi tunggal staf).
-- Terapkan ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-sesi-staf-202610140001.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-sesi-staf-202610140001.sql --atomic
--
-- Yang dikembalikan:
--   1. (penjaga) menolak seluruh rollback bila fungsi/policy LAIN masih memanggil sesi_valid(), sesi_status(),
--      daftarkan_sesi(), ping_sesi() atau akhiri_sesi() (mis. RPC mutasi migrasi A3 atau policy). Bila dilanjutkan,
--      RPC itu akan gagal saat dipanggil (badan plpgsql terikat lambat, tidak ada galat saat DROP). Kembalikan migrasi
--      yang bergantung lebih dulu (urutan: A3 -> A1), atau tulis ulang fungsi itu tanpa sesi_valid().
--   2. DROP kedelapan fungsi: akhiri_sesi, ping_sesi(boolean), daftarkan_sesi, sesi_valid, sesi_status,
--      sesi_tunggal_aktif, sesi_idle_menit, sesi_klaim_id.
--   3. DROP tabel public.sesi_staf (isinya hanya sesi sementara; tidak ada data bisnis).
--   4. Hapus dua baris site_settings milik migrasi ini (sesi_idle_menit, sesi_tunggal_aktif). Nilai yang sudah
--      diubah Admin ikut hilang (dicatat trg_audit_site_settings di audit_log).
-- Tidak menyentuh objek lain. Idempoten (IF EXISTS). Klien A2 yang masih terpasang akan gagal memanggil RPC ini:
-- nonaktifkan/rollback kode A2 bersamaan.

DO $$
DECLARE
  v_fungsi text;
  v_policy text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT p.proname, ', ') INTO v_fungsi
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('sesi_klaim_id', 'sesi_idle_menit', 'sesi_tunggal_aktif', 'sesi_status', 'sesi_valid',
                          'daftarkan_sesi', 'ping_sesi', 'akhiri_sesi')
    AND p.prosrc ~* '(sesi_valid|sesi_status|daftarkan_sesi|ping_sesi|akhiri_sesi)[[:space:]]*\(';
  IF v_fungsi IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: fungsi ini masih memanggil fungsi sesi tunggal: %', v_fungsi;
  END IF;

  SELECT pg_catalog.string_agg(DISTINCT pol.policyname || ' ON ' || pol.tablename, ', ') INTO v_policy
  FROM pg_catalog.pg_policies AS pol
  WHERE pol.qual ~* 'sesi_valid|sesi_status' OR pol.with_check ~* 'sesi_valid|sesi_status';
  IF v_policy IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: policy ini masih memanggil sesi_valid()/sesi_status(): %', v_policy;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.akhiri_sesi();
DROP FUNCTION IF EXISTS public.ping_sesi(boolean);
DROP FUNCTION IF EXISTS public.daftarkan_sesi();
DROP FUNCTION IF EXISTS public.sesi_valid();
DROP FUNCTION IF EXISTS public.sesi_status();
DROP FUNCTION IF EXISTS public.sesi_tunggal_aktif();
DROP FUNCTION IF EXISTS public.sesi_idle_menit();
DROP FUNCTION IF EXISTS public.sesi_klaim_id();

DROP TABLE IF EXISTS public.sesi_staf;

DELETE FROM public.site_settings WHERE key IN ('sesi_idle_menit', 'sesi_tunggal_aktif');
