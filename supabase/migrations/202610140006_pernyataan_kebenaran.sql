-- 202610140006_pernyataan_kebenaran.sql
-- Tahap C2 (K12; spec docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §4.9; keputusan CEO Gerbang G.3
-- Opsi A): kunci kolom Nama Lengkap pengunjung setelah profil lengkap tersimpan.
--
-- YANG DITEGAKKAN DI DATABASE (bukan hanya UI):
--   1. pengunjung_profil_lengkap(nama, email, no_hp, asal_instansi, kategori) - definisi tunggal "profil lengkap" di SQL
--      (tanpa NIK; mencerminkan src/lib/profil-pengunjung.ts): nama >= 3 karakter, email berformat, no_hp seluler
--      Indonesia (08xx / 628xx / +628xx, 10+ digit), asal_instansi terisi, kategori terisi.
--   2. Trigger BEFORE UPDATE trg_jaga_nama_pengunjung pada public.pengunjung. Bila baris LAMA sudah lengkap:
--        - nama TIDAK boleh berubah oleh pemiliknya  -> NAMA_TERKUNCI (42501)
--        - profil TIDAK boleh menjadi tidak lengkap  -> PROFIL_WAJIB_LENGKAP (22023)
--          (tanpa ini kunci bisa dilewati: kosongkan asal_instansi dulu, ubah nama pada UPDATE berikutnya)
--      Tidak berlaku untuk: pemanggil tanpa auth.uid() (service_role, pg_cron mis. anonymize_inactive_pengunjung yang
--      menulis nama '[anonim]', SQL administratif) dan transaksi yang menyalakan flag lokal lmh.ubah_nama = 'on'
--      (hanya ubah_nama_pengunjung di bawah; pola flag sama dengan lmh.antrean_rpc / lmh.koreksi).
--      Yang TETAP bebas diubah pemilik: no_hp, email, asal_instansi, kategori (asal tidak menjadikan profil tak lengkap).
--      Kunci OTOMATIS: tidak ada kolom baru; status terkunci = profil lengkap menurut fungsi di atas.
--   3. RPC ubah_nama_pengunjung(p_pengunjung_id, p_nama_baru, p_alasan): satu-satunya jalur resmi mengubah nama yang sudah
--      terkunci. Hanya admin / front_office AKTIF (staf_saya()), sesi sah (sesi_valid()), alasan wajib (>= 5 karakter),
--      nama baru 3..120 karakter; mencatat audit_log (aksi 'ubah_nama_pengunjung', nilai_lama/nilai_baru {nama}, alasan).
--      Kode galat (awal pesan): FORBIDDEN (42501), SESI_TIDAK_SAH (42501), ALASAN_WAJIB (22023),
--      NAMA_TIDAK_VALID (22023), NOT_FOUND (P0002).
--
-- TIDAK DIUBAH: consent_log (kolom tujuan/versi_kebijakan bebas teks; policy consent_log_insert_own mengizinkan
-- subjek_ref = auth.uid()::text, dipakai klien untuk tujuan 'pernyataan_kebenaran'), policy pengunjung_*, anonimisasi 730 hari.
--
-- DAMPAK PADA DATA YANG ADA: tidak ada UPDATE/backfill. Baris pengunjung yang SUDAH lengkap saat migrasi ini diterapkan
-- langsung terkunci (nama hanya bisa diubah lewat RPC). Pratinjau (jalankan sebagai SELECT, bukan bagian migrasi):
--   SELECT count(*) FILTER (WHERE public.pengunjung_profil_lengkap(nama, email, no_hp, asal_instansi, kategori)) AS terkunci,
--          count(*) AS total FROM public.pengunjung;
-- Pengunjung lama TANPA email dianggap belum lengkap: gerbang profil meminta email + pernyataan kebenaran pada kunjungan berikut.
--
-- URUTAN PENERAPAN: terapkan migrasi ini DULU, baru deploy klien C2 (gerbang memilih kolom email dan menyimpan
-- consent_log 'pernyataan_kebenaran'; klien C2 sendiri tidak memerlukan objek baru kecuali penegakan kunci).
-- SYARAT: 202610140001_sesi_staf (sesi_valid), 202610080001 (staf_saya), 202610090004 (audit_log.nilai_lama/nilai_baru),
-- 202607240001 (pengunjung.no_hp). Penjaga di bagian 0.
-- PENERAPAN: membuat fungsi/trigger, jadi WAJIB mode atomik. Dry-run dulu:
--   node scripts/apply-migration.mjs supabase/migrations/202610140006_pernyataan_kebenaran.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140006_pernyataan_kebenaran.sql --atomic
-- Idempoten (CREATE OR REPLACE, DROP TRIGGER IF EXISTS + CREATE). Sentuh produksi hanya setelah konfirmasi CEO
-- (docs/ATURAN_MIGRASI.md). Rollback: docs/rollback-pernyataan-kebenaran-202610140006.sql.

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
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.pengunjung'::pg_catalog.regclass AND a.attname = 'no_hp' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom public.pengunjung.no_hp belum ada (terapkan 202607240001_pengunjung_no_hp.sql lebih dulu)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.audit_log'::pg_catalog.regclass AND a.attname = 'nilai_baru' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom public.audit_log.nilai_baru belum ada (terapkan 202610090004_kelola_layanan_audit.sql lebih dulu)';
  END IF;
END $$;

-- ============================================================
-- 1. Definisi tunggal "profil lengkap" (tanpa NIK)
-- ============================================================
-- NULL pada argumen apa pun = tidak lengkap. Pasangan TS: profilPengunjungSchema (src/lib/profil-pengunjung.ts).
CREATE OR REPLACE FUNCTION public.pengunjung_profil_lengkap(
  p_nama text, p_email text, p_no_hp text, p_asal_instansi text, p_kategori text
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    pg_catalog.char_length(pg_catalog.btrim(p_nama)) >= 3
    AND pg_catalog.btrim(p_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    AND pg_catalog.regexp_replace(p_no_hp, '[[:space:]-]', '', 'g') ~ '^(?:\+?62|0)8[1-9][0-9]{7,12}$'
    AND pg_catalog.char_length(pg_catalog.btrim(p_asal_instansi)) >= 1
    AND pg_catalog.btrim(p_kategori) IN ('UMKM', 'Umum', 'Instansi', 'Investor'),
    false
  )
$$;

-- ============================================================
-- 2. Trigger penjaga: nama terkunci setelah profil lengkap
-- ============================================================
CREATE OR REPLACE FUNCTION public.jaga_nama_pengunjung()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- service_role, pg_cron (anonimisasi 730 hari), SQL administratif: tanpa pengguna login.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  -- Jalur resmi ubah_nama_pengunjung (flag lokal transaksi).
  IF COALESCE(pg_catalog.current_setting('lmh.ubah_nama', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  -- Profil belum lengkap = nama masih bebas disunting (pengisian awal).
  IF NOT public.pengunjung_profil_lengkap(OLD.nama, OLD.email, OLD.no_hp, OLD.asal_instansi, OLD.kategori) THEN
    RETURN NEW;
  END IF;

  IF NEW.nama IS DISTINCT FROM OLD.nama THEN
    RAISE EXCEPTION 'NAMA_TERKUNCI: Nama Lengkap tidak dapat diubah sendiri; hubungi Front Office'
      USING ERRCODE = '42501';
  END IF;
  -- Cegah celah "kosongkan field wajib dulu, ubah nama kemudian".
  IF NOT public.pengunjung_profil_lengkap(NEW.nama, NEW.email, NEW.no_hp, NEW.asal_instansi, NEW.kategori) THEN
    RAISE EXCEPTION 'PROFIL_WAJIB_LENGKAP: seluruh data profil wajib tetap terisi dengan benar'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_jaga_nama_pengunjung ON public.pengunjung;
CREATE TRIGGER trg_jaga_nama_pengunjung
  BEFORE UPDATE ON public.pengunjung
  FOR EACH ROW EXECUTE FUNCTION public.jaga_nama_pengunjung();

-- ============================================================
-- 3. RPC jalur resmi: ubah_nama_pengunjung (admin / front_office)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ubah_nama_pengunjung(
  p_pengunjung_id uuid, p_nama_baru text, p_alasan text
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_alasan  text;
  v_baru    text;
  v_lama    text;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif yang boleh mengubah nama pengunjung'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  v_alasan := pg_catalog.btrim(p_alasan);
  IF v_alasan IS NULL OR pg_catalog.char_length(v_alasan) < 5 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan perubahan nama wajib diisi (minimal 5 karakter)' USING ERRCODE = '22023';
  END IF;
  v_baru := pg_catalog.btrim(p_nama_baru);
  IF v_baru IS NULL OR pg_catalog.char_length(v_baru) < 3 OR pg_catalog.char_length(v_baru) > 120 THEN
    RAISE EXCEPTION 'NAMA_TIDAK_VALID: nama baru harus 3 sampai 120 karakter' USING ERRCODE = '22023';
  END IF;

  SELECT v.nama INTO v_lama FROM public.pengunjung AS v WHERE v.id = p_pengunjung_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_lama = v_baru THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'berubah', false);
  END IF;

  -- Flag lokal-transaksi melewati trg_jaga_nama_pengunjung (hanya fungsi ini yang menyalakannya).
  PERFORM pg_catalog.set_config('lmh.ubah_nama', 'on', true);
  UPDATE public.pengunjung AS v SET nama = v_baru WHERE v.id = p_pengunjung_id;
  PERFORM pg_catalog.set_config('lmh.ubah_nama', 'off', true);

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'ubah_nama_pengunjung', 'pengunjung', p_pengunjung_id::text,
    pg_catalog.jsonb_build_object('pengunjung_id', p_pengunjung_id, 'alasan', v_alasan),
    pg_catalog.jsonb_build_object('nama', v_lama),
    pg_catalog.jsonb_build_object('nama', v_baru)
  );

  RETURN pg_catalog.jsonb_build_object('ok', true, 'berubah', true);
END $$;

-- ============================================================
-- 4. Hak eksekusi
-- ============================================================
REVOKE ALL ON FUNCTION public.pengunjung_profil_lengkap(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.jaga_nama_pengunjung() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ubah_nama_pengunjung(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ubah_nama_pengunjung(uuid, text, text) TO authenticated;
