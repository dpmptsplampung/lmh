-- Rollback manual migrasi 202610140002_tiket_kepemilikan.sql (kembali ke keadaan sebelum kepemilikan tiket A3).
-- Terapkan ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-tiket-kepemilikan-202610140002.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-tiket-kepemilikan-202610140002.sql --atomic
--
-- Yang dikembalikan:
--   1. (penjaga) menolak seluruh rollback bila fungsi/policy LAIN (di luar milik migrasi ini) masih memanggil
--      layanan_mulai(), layanan_selesai(), admin_ambil_alih() atau pemilik_tiket(). Badan plpgsql terikat lambat:
--      tanpa penjaga, pemanggil itu baru gagal saat dipakai.
--   2. DROP trigger trg_guard_visit_transisi_layanan + fungsi guard_visit_transisi_layanan(): UPDATE langsung visit
--      (klien lama) kembali diizinkan.
--   3. finalize_pelayanan dipulihkan PERSIS dari 202610010001 (admin/front_office/petugas layanannya, tanpa aturan
--      pemilik, tanpa FOR UPDATE), dengan REVOKE/GRANT yang sama.
--   4. Policy oss/perizinan_{insert,update}_staff dipulihkan dari 202610090001 (tanpa pemilik_tiket).
--   5. Policy tiket_staff_update dibuat ulang PERSIS seperti 202607290013 (roles public, tanpa WITH CHECK).
--   6. DROP fungsi admin_ambil_alih, layanan_selesai, layanan_mulai, pemilik_tiket.
-- TIDAK dikembalikan (data, sengaja): nilai tiket_antrean.dilayani_oleh yang terisi (backfill 7.3, layanan_mulai,
-- admin_ambil_alih) dan baris audit_log 'admin_ambil_alih'. Kolom itu sudah ada sebelum migrasi dan tidak dibaca
-- jalur lama selain rekap (nama petugas), jadi aman dibiarkan. pelayanan_*.petugas_id yang diisi pemilik saat
-- penyelesaian juga dibiarkan.
-- Klien A3 (halaman antrean memakai rpc layanan_mulai/layanan_selesai) akan gagal setelah rollback: kembalikan kode
-- klien bersamaan. Rollback migrasi sesi (202610140001) hanya boleh SETELAH rollback ini (penjaganya menolak bila
-- fungsi di sini masih memanggil sesi_valid()).
-- Idempoten (IF EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS sebelum CREATE).

DO $$
DECLARE
  v_fungsi text;
  v_policy text;
BEGIN
  SELECT pg_catalog.string_agg(DISTINCT p.proname, ', ') INTO v_fungsi
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname NOT IN ('layanan_mulai', 'layanan_selesai', 'admin_ambil_alih', 'pemilik_tiket',
                          'finalize_pelayanan', 'guard_visit_transisi_layanan')
    AND p.prosrc ~* '(layanan_mulai|layanan_selesai|admin_ambil_alih|pemilik_tiket)[[:space:]]*\(';
  IF v_fungsi IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: fungsi ini masih memanggil fungsi kepemilikan tiket: %', v_fungsi;
  END IF;

  SELECT pg_catalog.string_agg(DISTINCT pol.policyname || ' ON ' || pol.tablename, ', ') INTO v_policy
  FROM pg_catalog.pg_policies AS pol
  WHERE (pol.qual ~* 'pemilik_tiket' OR pol.with_check ~* 'pemilik_tiket')
    AND NOT (pol.schemaname = 'public'
             AND (pol.tablename, pol.policyname) IN (('pelayanan_oss', 'oss_insert_staff'),
                                                     ('pelayanan_oss', 'oss_update_staff'),
                                                     ('pelayanan_perizinan', 'perizinan_insert_staff'),
                                                     ('pelayanan_perizinan', 'perizinan_update_staff')));
  IF v_policy IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: policy ini masih memanggil pemilik_tiket(): %', v_policy;
  END IF;
END $$;

-- 2. Penjaga transisi visit
DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public.visit;
DROP FUNCTION IF EXISTS public.guard_visit_transisi_layanan();

-- 3. finalize_pelayanan (salinan persis 202610010001_non_oss_rename.sql)
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
DECLARE
  v_staff    public.petugas%ROWTYPE;
  v_role     text;
  v_tiket    record;
  v_existing record;
  v_now      timestamptz := now();
BEGIN
  -- (a) Identitas petugas pemanggil
  SELECT * INTO v_staff FROM public.petugas WHERE auth_user_id = auth.uid();
  IF v_staff.id IS NULL OR v_staff.aktif = false THEN
    RAISE EXCEPTION 'FORBIDDEN: petugas tidak ditemukan atau tidak aktif';
  END IF;
  v_role := public.get_my_role();

  -- (b) Tiket + nama layanan
  SELECT t.id, t.legacy_visit_id, t.kunjungan_id, t.layanan_id, t.status,
         l.nama AS layanan_nama
    INTO v_tiket
    FROM public.tiket_antrean t
    JOIN public.layanan l ON l.id = t.layanan_id
   WHERE t.id = p_tiket_id;
  IF v_tiket.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan';
  END IF;

  -- (c) Otorisasi: admin/front_office semua; petugas hanya layanannya sendiri
  IF NOT (
    v_role = 'admin'
    OR v_role = 'front_office'
    OR (v_role = 'petugas' AND v_staff.layanan_id = v_tiket.layanan_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: petugas tidak berwenang atas layanan tiket ini';
  END IF;

  -- (d) Status tiket harus 'dilayani'
  IF v_tiket.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket belum dalam status dilayani (status=%)', v_tiket.status;
  END IF;

  -- (e) Upsert data pelayanan sesuai form type
  IF p_form_type = 'oss' THEN
    SELECT * INTO v_existing FROM public.pelayanan_oss WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_role <> 'admin' THEN
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
        p_tiket_id, v_tiket.kunjungan_id, v_staff.id,
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
      -- UPDATE tanpa menyentuh petugas_id: kepemilikan draft tetap milik petugas asli
      UPDATE public.pelayanan_oss SET
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
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_perizinan (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_perusahaan, lokasi_usaha, opd_teknis, uraian_permohonan, tindak_lanjut,
        catatan_petugas, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_tiket.kunjungan_id, v_staff.id,
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
      -- UPDATE tanpa menyentuh petugas_id: kepemilikan draft tetap milik petugas asli
      UPDATE public.pelayanan_perizinan SET
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

  ELSE
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type;
  END IF;

  -- (f) Selesaikan visit / tiket dalam transaksi yang sama
  IF v_tiket.legacy_visit_id IS NOT NULL THEN
    UPDATE public.visit
       SET status = 'selesai', waktu_selesai = v_now
     WHERE id = v_tiket.legacy_visit_id;
  ELSE
    UPDATE public.tiket_antrean
       SET status = 'selesai', waktu_selesai = v_now
     WHERE id = p_tiket_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'is_locked', true,
    'waktu_selesai', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_pelayanan(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_pelayanan(uuid, text, jsonb) TO authenticated;

-- 4. Policy draf pendataan (salinan 202610090001_rbac_tahap1.sql)
DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
  );

DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id));

DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan FOR INSERT TO authenticated
  WITH CHECK (
    is_locked = false
    AND status_draft = 'draft'
    AND petugas_id IN (SELECT me.id FROM public.staf_saya() AS me)
    AND public.boleh_tiket(tiket_id)
  );

DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan FOR UPDATE TO authenticated
  USING (is_locked = false AND public.boleh_tiket(tiket_id))
  WITH CHECK (is_locked = false AND status_draft = 'draft' AND public.boleh_tiket(tiket_id));

-- 5. tiket_staff_update (salinan persis 202607290013_kunjungan_tiket.sql)
DROP POLICY IF EXISTS tiket_staff_update ON public.tiket_antrean;
CREATE POLICY tiket_staff_update ON public.tiket_antrean FOR UPDATE
  USING (public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id());

-- 6. Fungsi milik migrasi (yang bergantung lebih dulu)
DROP FUNCTION IF EXISTS public.admin_ambil_alih(uuid, text);
DROP FUNCTION IF EXISTS public.layanan_selesai(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.layanan_mulai(uuid);
DROP FUNCTION IF EXISTS public.pemilik_tiket(uuid);
