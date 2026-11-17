-- G8, keputusan pemilik 2026-11-17: Front Office non-Koordinator membuka semua tanggal.
-- Definisi hidup 202611040001 dipertahankan kecuali penjaga jendela tanggal daftar.
-- Migrasi 202611160001 sampai 202611160003 tidak mengganti kedua RPC ini.

CREATE OR REPLACE FUNCTION public.fo_antrean_daftar(
  p_tanggal date, p_layanan_id uuid DEFAULT NULL,
  p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_total bigint;
  v_selesai bigint;
  v_rata numeric;
  v_rows jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_tanggal IS NULL OR p_batas IS NULL OR p_batas NOT BETWEEN 1 AND 200
     OR p_lewati IS NULL OR p_lewati NOT BETWEEN 0 AND 2000000 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: tanggal, batas, atau halaman tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE t.status = 'selesai'),
         pg_catalog.round(pg_catalog.avg(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60)
           FILTER (WHERE t.status = 'selesai' AND t.waktu_selesai >= t.waktu_mulai_layan))
  INTO v_total, v_selesai, v_rata
  FROM public.tiket_antrean AS t
  WHERE t.tanggal = p_tanggal AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id);

  WITH halaman AS (
    SELECT t.id, t.kunjungan_id, t.layanan_id, t.dilayani_oleh, t.penanganan_asal_id, t.nomor,
           t.nomor_display, t.status, t.waktu_terbit, t.waktu_mulai_layan, t.waktu_selesai
    FROM public.tiket_antrean AS t
    WHERE t.tanggal = p_tanggal AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
    ORDER BY t.nomor, t.id LIMIT p_batas OFFSET p_lewati
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', h.id, 'kunjungan_id', h.kunjungan_id, 'layanan_id', h.layanan_id,
    'dilayani_oleh', h.dilayani_oleh, 'penanganan_asal_id', h.penanganan_asal_id,
    'nomor', h.nomor, 'nomor_display', h.nomor_display, 'status', h.status,
    'waktu_terbit', h.waktu_terbit, 'waktu_mulai_layan', h.waktu_mulai_layan, 'waktu_selesai', h.waktu_selesai,
    'layanan', pg_catalog.jsonb_build_object('nama', l.nama, 'form_pendataan', l.form_pendataan),
    'pelayan', CASE WHEN pg.id IS NOT NULL THEN pg_catalog.jsonb_build_object('nama', pg.nama) END,
    'kunjungan', CASE WHEN k.id IS NOT NULL THEN pg_catalog.jsonb_build_object('nama', k.nama, 'asal', k.asal, 'waktu_masuk', k.waktu_masuk) END,
    'fo_nama', COALESCE(fo.nama, CASE WHEN pembuat.role IN ('front_office', 'admin') THEN pembuat.nama END)
  ) ORDER BY h.nomor, h.id), '[]'::jsonb) INTO v_rows
  FROM halaman AS h
  LEFT JOIN public.kunjungan AS k ON k.id = h.kunjungan_id
  LEFT JOIN public.layanan AS l ON l.id = h.layanan_id
  LEFT JOIN public.petugas AS pg ON pg.id = h.dilayani_oleh
  LEFT JOIN public.petugas AS pembuat ON pembuat.id = k.dibuat_oleh
  LEFT JOIN LATERAL (
    SELECT pf.nama FROM public.penanganan AS p
    JOIN public.petugas AS pf ON pf.id = p.penangan_id
    WHERE p.kunjungan_id = h.kunjungan_id AND p.peran_tahap = 'fo'
    ORDER BY p.tahap_ke DESC LIMIT 1
  ) AS fo ON true;
  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total,
    'statistik', pg_catalog.jsonb_build_object('totalSelesai', v_selesai, 'rataWaktuMenit', COALESCE(v_rata, 0)));
END $$;
REVOKE ALL ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) TO authenticated;
COMMENT ON FUNCTION public.fo_antrean_daftar(date, uuid, integer, integer) IS
  '202611160004: Daftar antrean kolom aman untuk Admin/FO aktif pada semua tanggal; filter layanan, statistik, dan paginasi tetap.';

CREATE OR REPLACE FUNCTION public.fo_kunjungan_daftar(
  p_tanggal date, p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0,
  p_cari text DEFAULT NULL, p_status text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_cari text := NULLIF(pg_catalog.btrim(p_cari), '');
  v_status text := NULLIF(pg_catalog.btrim(p_status), '');
  v_pola text;
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_tanggal IS NULL OR p_batas IS NULL OR p_batas NOT BETWEEN 1 AND 200
     OR p_lewati IS NULL OR p_lewati NOT BETWEEN 0 AND 2000000 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: tanggal, batas, atau halaman tidak valid' USING ERRCODE = '22023';
  END IF;
  IF (v_cari IS NOT NULL AND pg_catalog.char_length(v_cari) > 100)
     OR (v_status IS NOT NULL AND v_status NOT IN ('terjadwal', 'menunggu', 'dilayani', 'selesai', 'batal', 'no_show', 'tidak_terlayani')) THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: pencarian maksimal 100 karakter dan status harus status kunjungan yang sah'
      USING ERRCODE = '22023';
  END IF;
  IF v_cari IS NOT NULL THEN
    v_pola := '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_cari, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  -- Saringan yang sama untuk total dan halaman (total = setelah saring, sebelum paginasi).
  SELECT pg_catalog.count(*) INTO v_total
  FROM public.kunjungan AS k
  WHERE k.tanggal = p_tanggal
    AND (v_status IS NULL OR k.status = v_status)
    AND (v_pola IS NULL OR k.nama ILIKE v_pola OR EXISTS (
      SELECT 1 FROM public.tiket_antrean AS t JOIN public.layanan AS l ON l.id = t.layanan_id
      WHERE t.kunjungan_id = k.id AND l.nama ILIKE v_pola));

  WITH halaman AS (
    SELECT k.id, k.nama, k.asal, k.status, k.waktu_masuk, k.tanggal, k.dibuat_oleh
    FROM public.kunjungan AS k
    WHERE k.tanggal = p_tanggal
      AND (v_status IS NULL OR k.status = v_status)
      AND (v_pola IS NULL OR k.nama ILIKE v_pola OR EXISTS (
        SELECT 1 FROM public.tiket_antrean AS t JOIN public.layanan AS l ON l.id = t.layanan_id
        WHERE t.kunjungan_id = k.id AND l.nama ILIKE v_pola))
    ORDER BY k.waktu_masuk DESC NULLS LAST, k.id LIMIT p_batas OFFSET p_lewati
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', h.id, 'nama', h.nama, 'asal', h.asal, 'status', h.status,
    'waktu_masuk', h.waktu_masuk, 'tanggal', h.tanggal,
    'fo_nama', COALESCE(fo.nama, CASE WHEN pembuat.role IN ('front_office', 'admin') THEN pembuat.nama END),
    'tiket_antrean', COALESCE(tiket.baris, '[]'::jsonb)
  ) ORDER BY h.waktu_masuk DESC NULLS LAST, h.id), '[]'::jsonb) INTO v_rows
  FROM halaman AS h
  LEFT JOIN public.petugas AS pembuat ON pembuat.id = h.dibuat_oleh
  LEFT JOIN LATERAL (
    SELECT pf.nama FROM public.penanganan AS p JOIN public.petugas AS pf ON pf.id = p.penangan_id
    WHERE p.kunjungan_id = h.id AND p.peran_tahap = 'fo'
    ORDER BY p.tahap_ke DESC LIMIT 1
  ) AS fo ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'nomor_display', t.nomor_display, 'waktu_selesai', t.waktu_selesai,
      'layanan', pg_catalog.jsonb_build_object('nama', l.nama)
    ) ORDER BY t.waktu_terbit, t.id) AS baris
    FROM public.tiket_antrean AS t LEFT JOIN public.layanan AS l ON l.id = t.layanan_id
    WHERE t.kunjungan_id = h.id
  ) AS tiket ON true;
  RETURN pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total);
END $$;
REVOKE ALL ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer, text, text) TO authenticated;
COMMENT ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer, text, text) IS
  '202611160004: Daftar kunjungan kolom aman untuk Admin/FO aktif pada semua tanggal; pencarian dan status sebelum paginasi tetap.';
