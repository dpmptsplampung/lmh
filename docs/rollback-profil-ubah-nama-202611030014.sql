-- Rollback manual 202611030014, TANPA BEGIN/COMMIT agar kompatibel --atomic.
-- Kembalikan kode aplikasi dahulu. Tinjau host dan lakukan staging sebelum produksi.
-- Nama yang sudah diperbaiki, audit, operator_default, dan kolom/flag operator_aktif
-- sengaja dipertahankan; rollback tidak menghapus data. Flag tidak dibaca kode lama.
DROP FUNCTION IF EXISTS public.admin_atur_operator(uuid, boolean);

-- Kembalikan antarmuka sebelum 0014 (nama tidak dapat diubah lewat RPC ini).
CREATE OR REPLACE FUNCTION public.petugas_ubah_profil(p_patch jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me uuid;
BEGIN
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  IF p_patch IS NULL OR pg_catalog.jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'patch profil tidak valid';
  END IF;
  UPDATE public.petugas AS p
    SET no_hp = CASE WHEN p_patch ? 'no_hp'
      THEN NULLIF(pg_catalog.btrim(p_patch->>'no_hp'), '') ELSE p.no_hp END,
      email_notifikasi = CASE WHEN p_patch ? 'email_notifikasi'
        THEN NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch->>'email_notifikasi')), '') ELSE p.email_notifikasi END,
      email_notifikasi_verified_at = CASE WHEN p_patch ? 'email_notifikasi'
        AND NULLIF(pg_catalog.lower(pg_catalog.btrim(p_patch->>'email_notifikasi')), '') IS DISTINCT FROM p.email_notifikasi
        THEN NULL ELSE p.email_notifikasi_verified_at END,
      operator_default = CASE WHEN p_patch ? 'operator_default'
        THEN NULLIF(pg_catalog.btrim(p_patch->>'operator_default'), '') ELSE p.operator_default END
    WHERE p.id = v_me;
END $$;
REVOKE ALL ON FUNCTION public.petugas_ubah_profil(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.petugas_ubah_profil(jsonb) TO authenticated;
