-- Pertukaran memakai urutan katalog yang sama dengan tampilan: urutan_tampil, lalu id.
CREATE FUNCTION public.investasi_tukar_urutan_dokumen(
  p_id uuid, p_tetangga_id uuid, p_urutan_lama integer, p_urutan_tetangga integer
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
SET lock_timeout = '2s'
AS $$
DECLARE
  v_posisi bigint;
  v_posisi_tetangga bigint;
  v_bentrok boolean;
  v_diubah integer;
  v_target integer;
BEGIN
  IF NOT COALESCE(public.boleh_kelola_investasi(), false) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL OR p_tetangga_id IS NULL OR p_id = p_tetangga_id
      OR p_urutan_lama IS NULL OR p_urutan_tetangga IS NULL THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;

  -- Stabilkan tetangga terhadap pertukaran, penambahan, penghapusan, dan edit urutan serentak.
  LOCK TABLE public.investment_documents IN SHARE ROW EXCLUSIVE MODE;
  WITH urutan AS (
    SELECT id, urutan_tampil, row_number() OVER (ORDER BY urutan_tampil, id) AS posisi,
      count(*) OVER (PARTITION BY urutan_tampil) AS jumlah_serupa
    FROM public.investment_documents
  )
  SELECT
    max(posisi) FILTER (WHERE id = p_id AND urutan_tampil = p_urutan_lama),
    max(posisi) FILTER (WHERE id = p_tetangga_id AND urutan_tampil = p_urutan_tetangga),
    bool_or(jumlah_serupa > 1)
  INTO v_posisi, v_posisi_tetangga, v_bentrok
  FROM urutan WHERE id IN (p_id, p_tetangga_id);

  IF v_posisi IS NULL OR v_posisi_tetangga IS NULL OR abs(v_posisi - v_posisi_tetangga) <> 1 THEN
    RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE = '40001';
  END IF;

  IF v_bentrok THEN
    -- Posisi lama yang seri dinomori ulang agar pertukaran persis satu langkah.
    WITH urutan AS (
      SELECT id, urutan_tampil, row_number() OVER (ORDER BY urutan_tampil, id) AS posisi
      FROM public.investment_documents
    ), baru AS (
      SELECT id, urutan_tampil,
        CASE id WHEN p_id THEN v_posisi_tetangga WHEN p_tetangga_id THEN v_posisi ELSE posisi END::integer AS posisi
      FROM urutan
    ), target AS (
      SELECT id, posisi FROM baru WHERE urutan_tampil IS DISTINCT FROM posisi
    ), simpan AS (
      UPDATE public.investment_documents AS d SET urutan_tampil = target.posisi
      FROM target WHERE d.id = target.id RETURNING d.id
    )
    SELECT (SELECT count(*) FROM target), (SELECT count(*) FROM simpan) INTO v_target, v_diubah;
    IF v_target <> v_diubah THEN
      RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE = '40001';
    END IF;
  ELSE
    UPDATE public.investment_documents
    SET urutan_tampil = CASE id WHEN p_id THEN p_urutan_tetangga ELSE p_urutan_lama END
    WHERE id IN (p_id, p_tetangga_id);
    GET DIAGNOSTICS v_diubah = ROW_COUNT;
    IF v_diubah <> 2 THEN
      RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE = '40001';
    END IF;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.investasi_tukar_urutan_dokumen(uuid, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.investasi_tukar_urutan_dokumen(uuid, uuid, integer, integer) TO authenticated;

CREATE FUNCTION public.investasi_angka_publik()
RETURNS TABLE(jumlah_proyek integer, jumlah_dokumen integer, jumlah_sektor integer, jumlah_wilayah integer)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$
  SELECT count(*)::integer,
    (SELECT count(*)::integer FROM public.investment_documents WHERE status = 'aktif'),
    count(DISTINCT nullif(btrim(p.sektor), ''))::integer,
    count(DISTINCT nullif(btrim(p.kab_kota), ''))::integer
  FROM public.ipro_proyek AS p WHERE p.status = 'terbit' AND p.sumber = 'ptsp';
$$;

REVOKE ALL ON FUNCTION public.investasi_angka_publik() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.investasi_angka_publik() TO anon, authenticated;
