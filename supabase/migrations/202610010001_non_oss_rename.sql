-- 202610010001_non_oss_rename.sql
-- Rebranding layanan Non OSS dan penambahan lokasi usaha perizinan.
-- ADITIF: tidak ada DELETE, TRUNCATE, atau penghapusan data.

BEGIN;

UPDATE public.layanan
SET nama = 'Non OSS (SiCantik Lampung)'
WHERE nama = 'Layanan Perizinan DPMPTSP Provinsi Lampung';

-- Hanya mengubah satu akun login. GoTrue v2.194 memiliki state perubahan-email
-- tertunda; reset minimal ini mencegah token lama menerapkan alamat email yang sudah
-- tidak berlaku. email_confirmed_at tetap valid; raw_user_meta_data tidak dipakai
-- untuk autentikasi dan tidak diubah.
UPDATE auth.users
SET email = 'nonoss@dpmptsp.web.id',
    email_change = '',
    email_change_token_new = '',
    email_change_token_current = '',
    email_change_confirm_status = 0,
    email_change_sent_at = NULL
WHERE email = 'perizinan@dpmptsp.web.id';

ALTER TABLE public.pelayanan_perizinan
  ADD COLUMN IF NOT EXISTS lokasi_usaha text;

-- DROP + CREATE: PostgreSQL tidak mengizinkan CREATE OR REPLACE VIEW menyisipkan
-- kolom baru di tengah urutan (lokasi_usaha disisipkan setelah nama_perusahaan).
-- Data aman — view hanya lapisan baca di atas tabel pelayanan_perizinan.
DROP VIEW IF EXISTS public.v_rekap_pelayanan_perizinan;
CREATE VIEW public.v_rekap_pelayanan_perizinan
WITH (security_invoker = true)
AS
SELECT
  pz.id,
  pz.tiket_id,
  t.nomor_display,
  t.tanggal,
  pz.nama_pemohon,
  pz.alamat_pemohon,
  pz.no_hp,
  pz.email,
  pz.keperluan_awal,
  pz.nama_perusahaan,
  pz.lokasi_usaha,
  pz.opd_teknis,
  pz.uraian_permohonan,
  pz.tindak_lanjut,
  pz.catatan_petugas,
  p.nama AS nama_petugas,
  pz.status_draft,
  pz.is_locked,
  pz.created_at,
  pz.updated_at
FROM public.pelayanan_perizinan pz
JOIN public.tiket_antrean t ON t.id = pz.tiket_id
JOIN public.petugas p ON p.id = pz.petugas_id;

REVOKE ALL ON public.v_rekap_pelayanan_perizinan FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rekap_pelayanan_perizinan TO authenticated;

-- Replaces unsafe name-based read scope after Non OSS gains the substring "oss".
-- A petugas can read only rows whose ticket belongs to their assigned layanan.
DROP POLICY IF EXISTS oss_read_staff ON public.pelayanan_oss;
CREATE POLICY oss_read_staff ON public.pelayanan_oss
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'front_office')
    OR (
      public.get_my_role() = 'petugas'
      AND EXISTS (
        SELECT 1 FROM public.petugas p
        JOIN public.layanan l ON l.id = p.layanan_id
        WHERE p.auth_user_id = auth.uid()
          AND l.id = (
            SELECT layanan_id FROM public.tiket_antrean
            WHERE id = pelayanan_oss.tiket_id
          )
      )
    )
  );

DROP POLICY IF EXISTS perizinan_read_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_read_staff ON public.pelayanan_perizinan
  FOR SELECT TO authenticated
  USING (
    public.get_my_role() IN ('admin', 'front_office')
    OR (
      public.get_my_role() = 'petugas'
      AND EXISTS (
        SELECT 1 FROM public.petugas p
        JOIN public.layanan l ON l.id = p.layanan_id
        WHERE p.auth_user_id = auth.uid()
          AND l.id = (
            SELECT layanan_id FROM public.tiket_antrean
            WHERE id = pelayanan_perizinan.tiket_id
          )
      )
    )
  );

-- Route handlers use the caller-scoped Supabase client. Permit audit writes
-- only for the authenticated actor and their database-derived staff role.
GRANT INSERT ON TABLE public.audit_log TO authenticated;
DROP POLICY IF EXISTS audit_log_insert_own ON public.audit_log;
CREATE POLICY audit_log_insert_own ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND actor_role = public.get_my_role()
  );

-- Replaces 202608310001_finalize_pelayanan_rpc so final perizinan payloads
-- persist lokasi_usaha. Apart from the two lokasi_usaha INSERT/UPDATE entries,
-- this definition preserves the original signature, authorization, transaction,
-- SECURITY DEFINER search_path, and execute grants.
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

COMMIT;
