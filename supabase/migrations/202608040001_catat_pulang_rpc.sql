-- 20260804001_catat_pulang_rpc.sql
-- T-7: Server-side jam_pulang via RPC (I-09: waktu dari server, bukan klien)
-- ADITIF — tidak mengubah tabel atau kolom yang ada

CREATE OR REPLACE FUNCTION public.catat_pulang(p_petugas_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_jam_pulang timestamptz := now();
  v_tanggal    date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  UPDATE public.absensi_petugas
  SET jam_pulang = v_jam_pulang
  WHERE petugas_id = p_petugas_id
    AND tanggal = v_tanggal
    AND jam_pulang IS NULL; -- Idempoten: jangan timpa pulang yang sudah dicatat

  RETURN v_jam_pulang;
END $$;

REVOKE ALL ON FUNCTION public.catat_pulang(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.catat_pulang(uuid) TO authenticated;
