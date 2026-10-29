-- Rollback 202611030008: kembalikan sapaan, saran publik, dan pengaduan publik. SETELAH kode aplikasi dikembalikan
-- (route /api/saran dan /api/pengaduan memanggil fungsi ini). Data publik yang sudah masuk TIDAK dihapus otomatis:
-- bila masih ada baris sumber 'publik', rollback berhenti agar tidak ada data yang kehilangan arti.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.saran WHERE sumber = 'publik')
     OR EXISTS (SELECT 1 FROM public.pengaduan WHERE sumber = 'publik') THEN
    RAISE EXCEPTION 'PRASYARAT ROLLBACK: masih ada saran/pengaduan sumber ''publik''; pindahkan atau hapus dulu secara sadar';
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.kirim_saran_publik(text, text);
DROP FUNCTION IF EXISTS public.kirim_pengaduan_publik(text, text, uuid, boolean, text);

ALTER TABLE public.saran DROP CONSTRAINT IF EXISTS saran_sumber_check;
ALTER TABLE public.saran ADD CONSTRAINT saran_sumber_check CHECK (sumber IN ('wizard', 'impor'));

CREATE OR REPLACE FUNCTION public.get_survei_context(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u       public.survei_undangan%ROWTYPE;
  v_layanan text;
  v_status  text;
BEGIN
  SELECT * INTO v_u FROM public.survei_undangan AS u WHERE u.token = p_token;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'tidak_valid', 'unit', NULL::text, 'layanan_nama', NULL::text, 'kedaluwarsa_pada', NULL::timestamptz
    );
  END IF;
  v_status := CASE
    WHEN v_u.diisi_pada IS NOT NULL THEN 'sudah_diisi'
    WHEN pg_catalog.now() >= v_u.kedaluwarsa_pada THEN 'kedaluwarsa'
    ELSE 'ok'
  END;
  SELECT l.nama INTO v_layanan FROM public.layanan AS l WHERE l.id = v_u.layanan_id;
  RETURN pg_catalog.jsonb_build_object(
    'status', v_status, 'unit', v_u.unit, 'layanan_nama', v_layanan, 'kedaluwarsa_pada', v_u.kedaluwarsa_pada
  );
END $$;
REVOKE ALL ON FUNCTION public.get_survei_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_survei_context(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lacak_pengaduan_nomor(p_nomor text)
RETURNS TABLE (nomor_tiket text, status text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT p.nomor_tiket, p.status, p.created_at, p.updated_at
  FROM public.pengaduan AS p
  WHERE p.sumber = 'wizard'
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.lacak_pengaduan_nomor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lacak_pengaduan_nomor(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.tanggapan_pengaduan_nomor(p_nomor text)
RETURNS TABLE (id uuid, isi text, status_baru text, created_at timestamptz, lampiran jsonb)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.isi, t.status_baru, t.created_at,
         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', l.id, 'nama', l.nama_asli, 'mime', l.mime, 'ukuran', l.ukuran) ORDER BY l.created_at)
                   FROM public.pengaduan_lampiran AS l WHERE l.tanggapan_id = t.id), '[]'::jsonb)
  FROM public.pengaduan AS p
  JOIN public.pengaduan_tanggapan AS t ON t.pengaduan_id = p.id
  WHERE p.sumber = 'wizard'
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
  ORDER BY t.created_at
$$;
REVOKE ALL ON FUNCTION public.tanggapan_pengaduan_nomor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tanggapan_pengaduan_nomor(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lampiran_pengaduan_nomor(p_nomor text, p_lampiran_id uuid)
RETURNS TABLE (kunci text, nama_asli text, mime text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public
AS $$
  SELECT l.kunci, l.nama_asli, l.mime
  FROM public.pengaduan AS p
  JOIN public.pengaduan_tanggapan AS t ON t.pengaduan_id = p.id
  JOIN public.pengaduan_lampiran AS l ON l.tanggapan_id = t.id
  WHERE p.sumber = 'wizard' AND l.id = p_lampiran_id
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
REVOKE ALL ON FUNCTION public.lampiran_pengaduan_nomor(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lampiran_pengaduan_nomor(text, uuid) TO anon, authenticated;
