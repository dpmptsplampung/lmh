-- G6: Buku Tamu tetap terpisah dari kunjungan/antrean. Terapkan sebagai satu transaksi oleh runner.
ALTER TABLE public.buku_tamu
  ADD COLUMN IF NOT EXISTS waktu_keluar timestamptz,
  ADD COLUMN IF NOT EXISTS menemui_petugas_id uuid REFERENCES public.petugas(id) ON DELETE SET NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                 WHERE conrelid = 'public.buku_tamu'::regclass AND conname = 'buku_tamu_urutan_waktu') THEN
    ALTER TABLE public.buku_tamu ADD CONSTRAINT buku_tamu_urutan_waktu
      CHECK (waktu_keluar IS NULL OR waktu_keluar >= waktu_masuk);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_buku_tamu_menemui_petugas
  ON public.buku_tamu(menemui_petugas_id) WHERE menemui_petugas_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_buku_tamu_waktu_id
  ON public.buku_tamu(waktu_masuk DESC, id DESC);

-- Jangan membuka UPDATE umum untuk FO. Checkout hanya melalui RPC terkunci di bawah.
DROP POLICY IF EXISTS buku_tamu_staff_select ON public.buku_tamu;
CREATE POLICY buku_tamu_staff_select ON public.buku_tamu FOR SELECT TO authenticated
  USING (public.sesi_valid() AND public.peran_saya() IN ('admin', 'front_office'));
DROP POLICY IF EXISTS buku_tamu_staff_insert ON public.buku_tamu;
CREATE POLICY buku_tamu_staff_insert ON public.buku_tamu FOR INSERT TO authenticated
  WITH CHECK (
    public.sesi_valid() AND public.peran_saya() IN ('admin', 'front_office')
    AND dicatat_oleh IN (SELECT me.id FROM public.staf_saya() AS me)
    AND legacy_visit_id IS NULL AND waktu_keluar IS NULL
  );
DROP POLICY IF EXISTS buku_tamu_admin_update ON public.buku_tamu;
CREATE POLICY buku_tamu_admin_update ON public.buku_tamu FOR UPDATE TO authenticated
  USING (public.sesi_valid() AND public.peran_saya() = 'admin')
  WITH CHECK (public.sesi_valid() AND public.peran_saya() = 'admin');
DROP POLICY IF EXISTS buku_tamu_admin_delete ON public.buku_tamu;
CREATE POLICY buku_tamu_admin_delete ON public.buku_tamu FOR DELETE TO authenticated
  USING (public.sesi_valid() AND public.peran_saya() = 'admin');

CREATE OR REPLACE FUNCTION public.buku_tamu_catat_keluar(p_id uuid, p_waktu_keluar timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_tamu public.buku_tamu%ROWTYPE;
  v_keluar timestamptz := coalesce(p_waktu_keluar, now());
BEGIN
  IF auth.uid() IS NULL OR NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin dan Front Office' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_tamu FROM public.buku_tamu WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TAMU_TIDAK_ADA: tamu tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  -- Ulangan tidak mengubah waktu pertama dan tidak menulis audit kedua.
  IF v_tamu.waktu_keluar IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_tamu.id, 'waktu_keluar', v_tamu.waktu_keluar);
  END IF;
  IF NOT isfinite(v_keluar) OR v_keluar < v_tamu.waktu_masuk OR v_keluar > now() THEN
    RAISE EXCEPTION 'WAKTU_TIDAK_VALID: waktu keluar harus sesudah masuk dan tidak di masa depan' USING ERRCODE = '22023';
  END IF;
  UPDATE public.buku_tamu SET waktu_keluar = v_keluar WHERE id = p_id;
  INSERT INTO public.audit_log(actor_id, actor_role, aksi, entitas, entitas_id, detail)
    VALUES(auth.uid(), v_role, 'catat_keluar', 'buku_tamu', p_id,
           jsonb_build_object('waktu_keluar', v_keluar));
  RETURN jsonb_build_object('id', p_id, 'waktu_keluar', v_keluar);
END $$;
REVOKE ALL ON FUNCTION public.buku_tamu_catat_keluar(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buku_tamu_catat_keluar(uuid, timestamptz) TO authenticated, service_role;
COMMENT ON FUNCTION public.buku_tamu_catat_keluar(uuid, timestamptz)
  IS '202611160003: checkout admin/FO atomik dan idempoten; audit gagal membatalkan checkout.';
