-- 202608290001_pendataan_pelayanan.sql
-- Fitur Pendataan Pelayanan: Helpdesk OSS (dengan tipe pelaku usaha, status penanaman modal, lokasi usaha) & Layanan Perizinan DPMPTSP.
-- ADITIF murni (OPS-01): tidak merusak skema live atau flow registrasi yang ada.

BEGIN;

-- ============================================================
-- 1. TABEL: public.pelayanan_oss
--    Mencatat data substantif konsultasi & layanan OSS RBA.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pelayanan_oss (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiket_id                uuid NOT NULL UNIQUE REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
  kunjungan_id            uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  petugas_id              uuid NOT NULL REFERENCES public.petugas(id) ON DELETE RESTRICT,
  
  -- Identitas Pemohon (Prapopulasi - Opsional selain nama)
  nama_pemohon            text NOT NULL,
  alamat_pemohon          text,
  no_hp                   text,
  email                   text,
  keperluan_awal          text,
  
  -- Data Usaha & OSS (Field baru opsional mirip format Excel OSS)
  nama_usaha              text NOT NULL,
  tipe_pelaku_usaha       text CHECK (tipe_pelaku_usaha IS NULL OR tipe_pelaku_usaha IN ('perseorangan', 'non_perseorangan')),
  status_penanaman_modal  text CHECK (status_penanaman_modal IS NULL OR status_penanaman_modal IN ('PMDN', 'PMA', 'tidak_ada')),
  lokasi_usaha            text,
  skala_usaha             text CHECK (skala_usaha IS NULL OR skala_usaha IN ('Mikro', 'Kecil', 'Menengah', 'Besar')),
  sektor_usaha_kbli       text,
  tindak_lanjut           text NOT NULL,
  uraian_solusi           text NOT NULL,
  catatan_internal        text,
  
  -- Kontrol Siklus Hidup & Kunci Data
  status_draft            text NOT NULL DEFAULT 'draft' CHECK (status_draft IN ('draft', 'selesai')),
  is_locked               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pelayanan_oss_tiket     ON public.pelayanan_oss(tiket_id);
CREATE INDEX IF NOT EXISTS idx_pelayanan_oss_kunjungan ON public.pelayanan_oss(kunjungan_id);
CREATE INDEX IF NOT EXISTS idx_pelayanan_oss_petugas   ON public.pelayanan_oss(petugas_id);
CREATE INDEX IF NOT EXISTS idx_pelayanan_oss_created   ON public.pelayanan_oss(created_at DESC);


-- ============================================================
-- 2. TABEL: public.pelayanan_perizinan
--    Mencatat data perizinan & non-perizinan DPMPTSP.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pelayanan_perizinan (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiket_id                uuid NOT NULL UNIQUE REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
  kunjungan_id            uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  petugas_id              uuid NOT NULL REFERENCES public.petugas(id) ON DELETE RESTRICT,
  
  -- Identitas Pemohon (Prapopulasi - Opsional selain nama)
  nama_pemohon            text NOT NULL,
  alamat_pemohon          text,
  no_hp                   text,
  email                   text,
  keperluan_awal          text,
  
  -- Substansi Perizinan DPMPTSP
  nama_perusahaan         text NOT NULL,
  opd_teknis              text NOT NULL,
  uraian_permohonan       text NOT NULL,
  tindak_lanjut           text NOT NULL,
  catatan_petugas         text,
  
  -- Kontrol Siklus Hidup & Kunci Data
  status_draft            text NOT NULL DEFAULT 'draft' CHECK (status_draft IN ('draft', 'selesai')),
  is_locked               boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pelayanan_perizinan_tiket     ON public.pelayanan_perizinan(tiket_id);
CREATE INDEX IF NOT EXISTS idx_pelayanan_perizinan_kunjungan ON public.pelayanan_perizinan(kunjungan_id);
CREATE INDEX IF NOT EXISTS idx_pelayanan_perizinan_petugas   ON public.pelayanan_perizinan(petugas_id);
CREATE INDEX IF NOT EXISTS idx_pelayanan_perizinan_created   ON public.pelayanan_perizinan(created_at DESC);


-- ============================================================
-- 3. TRIGGER: IMMUTABILITY PENGUNCIAN DATA
--    Menolak update jika is_locked = true (kecuali admin).
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_enforce_pelayanan_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.is_locked = true AND (public.get_my_role() <> 'admin') THEN
    RAISE EXCEPTION 'Data pelayanan sudah terkunci dan tidak dapat diubah (is_locked=true)';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_oss_lock ON public.pelayanan_oss;
CREATE TRIGGER trg_oss_lock
  BEFORE UPDATE ON public.pelayanan_oss
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_pelayanan_lock();

DROP TRIGGER IF EXISTS trg_perizinan_lock ON public.pelayanan_perizinan;
CREATE TRIGGER trg_perizinan_lock
  BEFORE UPDATE ON public.pelayanan_perizinan
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_pelayanan_lock();


-- ============================================================
-- 4. VIEWS: REKAPITULASI DATA PELAYANAN
-- ============================================================
CREATE OR REPLACE VIEW public.v_rekap_pelayanan_oss
WITH (security_invoker = true)
AS
SELECT
  o.id,
  o.tiket_id,
  t.nomor_display,
  t.tanggal,
  o.nama_pemohon,
  o.alamat_pemohon,
  o.no_hp,
  o.email,
  o.keperluan_awal,
  o.nama_usaha,
  o.tipe_pelaku_usaha,
  o.status_penanaman_modal,
  o.lokasi_usaha,
  o.skala_usaha,
  o.sektor_usaha_kbli,
  o.tindak_lanjut,
  o.uraian_solusi,
  o.catatan_internal,
  p.nama AS nama_petugas,
  o.status_draft,
  o.is_locked,
  o.created_at,
  o.updated_at
FROM public.pelayanan_oss o
JOIN public.tiket_antrean t ON t.id = o.tiket_id
JOIN public.petugas p ON p.id = o.petugas_id;

CREATE OR REPLACE VIEW public.v_rekap_pelayanan_perizinan
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

REVOKE ALL ON public.v_rekap_pelayanan_oss FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rekap_pelayanan_oss TO authenticated;

REVOKE ALL ON public.v_rekap_pelayanan_perizinan FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_rekap_pelayanan_perizinan TO authenticated;


-- ============================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================
ALTER TABLE public.pelayanan_oss ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pelayanan_perizinan ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.pelayanan_oss TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.pelayanan_perizinan TO authenticated;

-- Policies untuk pelayanan_oss
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
          AND (l.nama ILIKE '%oss%' OR l.id = (SELECT layanan_id FROM public.tiket_antrean WHERE id = pelayanan_oss.tiket_id))
      )
    )
  );

DROP POLICY IF EXISTS oss_insert_staff ON public.pelayanan_oss;
CREATE POLICY oss_insert_staff ON public.pelayanan_oss
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS oss_update_staff ON public.pelayanan_oss;
CREATE POLICY oss_update_staff ON public.pelayanan_oss
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND is_locked = false
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );

-- Policies untuk pelayanan_perizinan
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
          AND (l.nama ILIKE '%perizinan%' OR l.id = (SELECT layanan_id FROM public.tiket_antrean WHERE id = pelayanan_perizinan.tiket_id))
      )
    )
  );

DROP POLICY IF EXISTS perizinan_insert_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_insert_staff ON public.pelayanan_perizinan
  FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS perizinan_update_staff ON public.pelayanan_perizinan;
CREATE POLICY perizinan_update_staff ON public.pelayanan_perizinan
  FOR UPDATE TO authenticated
  USING (
    public.get_my_role() = 'admin'
    OR (
      public.get_my_role() = 'petugas'
      AND is_locked = false
      AND petugas_id = (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid())
    )
  );

COMMIT;
