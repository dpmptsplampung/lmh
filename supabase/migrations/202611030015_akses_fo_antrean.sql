-- 0015: antrean bersama lewat kolom aman, data kerja FO tetap per orang.
-- Tidak diterapkan oleh worker. Staging dahulu; aktivasi bersama klien RPC dalam satu jendela.
-- Urutan: 202610270001/0002 -> 202610280001 -> 202610290001/0002 -> Fase 4
-- 202610300001/0002 -> 202611010001/0002/0003/0005 -> 202611030015.
-- 202611010004 (backfill) tidak diperlukan. 0013/0014 tidak menjadi prasyarat.
-- Rollback manual: docs/rollback-akses-fo-antrean-202611030015.sql (tanpa BEGIN/COMMIT).

DO $$
DECLARE
  v_obj text;
  v_kolom text;
BEGIN
  IF pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL
     OR pg_catalog.to_regprocedure('public.sesi_valid()') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_data_pelayanan(text,uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.kunjungan_operasional(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_tiket_baca(uuid,uuid,date)') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_baca_khusus(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.rekap_pelayanan_inti(date,date,text,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.rekap_data_pelayanan(date,date,text,uuid,integer,integer,jsonb,boolean,boolean)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: Fase 3, Fase 4, 202611010002/0003/0005 wajib diterapkan sebelum 0015';
  END IF;
  IF COALESCE(pg_catalog.obj_description(pg_catalog.to_regprocedure('public.boleh_baca_khusus(uuid)'), 'pg_proc'), '')
       NOT LIKE '202611010003:%' THEN
    RAISE EXCEPTION 'PRASYARAT: identitas 202611010003 wajib agar akses FO pencatat tetap berlaku';
  END IF;
  -- Seluruh tabel/kolom yang dibaca fungsi baru maupun helper yang diganti.
  FOR v_obj, v_kolom IN
    SELECT o.nama, pg_catalog.unnest(o.kolom) FROM (VALUES
      ('petugas', ARRAY['id','nama','role','koordinator','aktif','auth_user_id','layanan_id']),
      ('kunjungan', ARRAY['id','nama','asal','status','tanggal','waktu_masuk','dibuat_oleh','qr_token','jam_rencana','layanan_saran_id','chat_sesi_id']),
      ('tiket_antrean', ARRAY['id','kunjungan_id','layanan_id','dilayani_oleh','penanganan_asal_id','nomor','nomor_display','status','tanggal','waktu_terbit','waktu_mulai_layan','waktu_selesai']),
      ('penanganan', ARRAY['id','kunjungan_id','tiket_id','tahap_ke','peran_tahap','layanan_id','penangan_id','status','hasil','saluran','mulai_at','selesai_at','catatan','topik']),
      ('layanan', ARRAY['id','nama','form_pendataan']),
      ('pelayanan_oss', ARRAY['tiket_id','kunjungan_id','petugas_id','status_draft']),
      ('pelayanan_perizinan', ARRAY['tiket_id','kunjungan_id','petugas_id','status_draft']),
      ('chat_sesi', ARRAY['id','layanan_id'])
    ) AS o(nama, kolom)
  LOOP
    IF pg_catalog.to_regclass('public.' || v_obj) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || v_obj)
        AND a.attname = v_kolom AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom public.%.% belum tersedia', v_obj, v_kolom;
    END IF;
  END LOOP;
END $$;

-- Daftar lintas layanan selalu dibatasi satu tanggal; indeks lama diawali layanan_id.
CREATE INDEX IF NOT EXISTS idx_tiket_fo_tanggal_nomor
  ON public.tiket_antrean (tanggal, nomor, id);

-- Cabang Petugas dipertahankan. Hanya jendela FO yang ditutup.

CREATE OR REPLACE FUNCTION public.boleh_penanganan(
  p_kunjungan   uuid,
  p_peran_tahap text,
  p_layanan     uuid,
  p_penangan    uuid,
  p_status      text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  IF public.boleh_data_pelayanan(p_peran_tahap, p_layanan, p_penangan) THEN
    RETURN true;
  END IF;
  
  IF v_role = 'front_office'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan AND k.dibuat_oleh = v_id) THEN
    RETURN true;
  END IF;
  IF NOT (p_status IN ('menunggu', 'berjalan') OR public.kunjungan_operasional(p_kunjungan)) THEN
    RETURN false;
  END IF;
  IF v_role = 'front_office' THEN
    RETURN false;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    ) OR EXISTS (
      SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
      WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS '202611030015: data FO milik sendiri/pencatat atau Koordinator; antrean bersama hanya lewat RPC kolom aman; akses Petugas mengikuti rantai sebelumnya.';

CREATE OR REPLACE FUNCTION public.boleh_kunjungan(p_kunjungan uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
  v_koord   boolean;
  v_unit    boolean;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  
  IF EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan AND k.dibuat_oleh = v_id)
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.penangan_id = v_id)
     OR EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.dilayani_oleh = v_id)
     OR EXISTS (SELECT 1 FROM public.pelayanan_oss AS o WHERE o.kunjungan_id = p_kunjungan AND o.petugas_id = v_id)
     OR EXISTS (SELECT 1 FROM public.pelayanan_perizinan AS pz WHERE pz.kunjungan_id = p_kunjungan AND pz.petugas_id = v_id)
  THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    v_unit := EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.layanan_id = v_layanan)
      OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan)
      OR EXISTS (
        SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
        WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
      );
    
    RETURN v_unit AND (v_koord OR public.kunjungan_operasional(p_kunjungan));
  END IF;
  IF v_role = 'front_office' THEN
    RETURN false;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_kunjungan(uuid) IS '202611030015: data FO milik sendiri/pencatat atau Koordinator; antrean bersama hanya lewat RPC kolom aman; akses Petugas mengikuti rantai sebelumnya.';

CREATE OR REPLACE FUNCTION public.boleh_baca_pendataan(p_tiket uuid, p_petugas uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
  v_koord   boolean;
  v_t       record;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  IF p_petugas = v_id THEN
    RETURN true;
  END IF;
  SELECT t.layanan_id, t.status, t.tanggal, t.dilayani_oleh, t.kunjungan_id INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_t.dilayani_oleh = v_id
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket AND p.penangan_id = v_id) THEN
    RETURN true;
  END IF;
  
  IF v_role = 'front_office'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id AND k.dibuat_oleh = v_id) THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_koord AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan THEN
    RETURN true;
  END IF;
  IF v_role = 'front_office' THEN
    RETURN false;
  END IF;
  IF NOT (v_t.status IN ('menunggu', 'dipanggil', 'dilayani')
          AND v_t.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1) THEN
    RETURN false;
  END IF;
  RETURN v_role = 'front_office' OR (v_role = 'petugas' AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan);
END $$;
REVOKE ALL ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) IS '202611030015: data FO milik sendiri/pencatat atau Koordinator; antrean bersama hanya lewat RPC kolom aman; akses Petugas mengikuti rantai sebelumnya.';

CREATE OR REPLACE FUNCTION public.boleh_tiket_baca(p_kunjungan uuid, p_layanan uuid, p_tanggal date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staf_lingkup() AS me
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (p_tanggal = (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
           AND (me.role = 'petugas' AND me.layanan_id IS NOT NULL AND me.layanan_id = p_layanan))
  ) OR public.boleh_kunjungan(p_kunjungan)
$$;
REVOKE ALL ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) IS '202611030015: data FO milik sendiri/pencatat atau Koordinator; antrean bersama hanya lewat RPC kolom aman; akses Petugas mengikuti rantai sebelumnya.';

-- RPC sengaja SECURITY DEFINER: akses lintas FO hanya proyeksi kolom di bawah.
-- Bukan view SELECT * dan tidak mengembalikan rowtype tabel berisi kontak/pendataan.
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

CREATE OR REPLACE FUNCTION public.fo_kunjungan_daftar(
  p_tanggal date, p_batas integer DEFAULT 50, p_lewati integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
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
  SELECT pg_catalog.count(*) INTO v_total FROM public.kunjungan AS k WHERE k.tanggal = p_tanggal;
  WITH halaman AS (
    SELECT k.id, k.nama, k.asal, k.status, k.waktu_masuk, k.tanggal, k.dibuat_oleh
    FROM public.kunjungan AS k WHERE k.tanggal = p_tanggal
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
REVOKE ALL ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_kunjungan_daftar(date, integer, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.fo_pratinjau_reservasi(p_qr_token text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_hasil jsonb;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau Front Office aktif' USING ERRCODE = '42501';
  END IF;
  IF p_qr_token IS NULL OR pg_catalog.length(pg_catalog.btrim(p_qr_token)) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'MASUKAN_TIDAK_VALID: kode reservasi tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'id', k.id, 'nama', k.nama, 'tanggal', k.tanggal, 'status', k.status,
    'jam_rencana', k.jam_rencana, 'layanan_saran_id', k.layanan_saran_id, 'layanan_nama', l.nama
  ) INTO v_hasil
  FROM public.kunjungan AS k LEFT JOIN public.layanan AS l ON l.id = k.layanan_saran_id
  WHERE k.qr_token = pg_catalog.btrim(p_qr_token) AND k.asal = 'reservasi';
  RETURN v_hasil;
END $$;
REVOKE ALL ON FUNCTION public.fo_pratinjau_reservasi(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_pratinjau_reservasi(text) TO authenticated;

-- Total lintas orang tidak pernah menjadi sumber baris detail. Hanya tiga angka dikembalikan.
CREATE OR REPLACE FUNCTION public.rekap_ringkasan_dilayani(
  p_dari date, p_sampai date, p_unit text DEFAULT NULL,
  p_layanan_id uuid DEFAULT NULL, p_tanpa_form boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_layanan uuid;
  v_koord boolean;
  v_saya bigint;
  v_total bigint;
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  SELECT me.role, me.layanan_id, me.koordinator INTO v_role, v_layanan, v_koord FROM public.staf_lingkup() AS me;
  IF v_role IS NULL OR v_role NOT IN ('admin', 'front_office', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  -- FO biasa membandingkan pelayanan FO, bukan kerja Petugas yang menerima eskalasinya.
  IF v_role = 'front_office' AND NOT v_koord AND p_unit IS NULL THEN
    p_unit := 'fo';
  END IF;
  -- Inti juga memvalidasi tanggal <= 366 hari dan unit sebelum kueri total.
  SELECT pg_catalog.count(*) INTO v_saya
  FROM public.rekap_pelayanan_inti(p_dari, p_sampai, p_unit, p_layanan_id) AS i
  WHERE (p_tanpa_form IS NOT TRUE OR i.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = i.layanan_id AND l.form_pendataan IS NOT NULL))
    AND (v_role <> 'front_office' OR v_koord OR i.unit = 'fo');

  WITH selesai AS (
    SELECT p.peran_tahap AS unit, p.layanan_id
    FROM public.penanganan AS p JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
    WHERE p.status = 'selesai'
      AND NOT (p.peran_tahap = 'layanan' AND p.hasil = 'dikembalikan')
      AND k.tanggal BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p.peran_tahap = p_unit)
      AND (p_layanan_id IS NULL OR p.layanan_id = p_layanan_id)
    UNION ALL
    SELECT 'layanan'::text, t.layanan_id
    FROM public.tiket_antrean AS t
    LEFT JOIN public.kunjungan AS k ON k.id = t.kunjungan_id
    LEFT JOIN public.pelayanan_oss AS o ON o.tiket_id = t.id
    LEFT JOIN public.pelayanan_perizinan AS pz ON pz.tiket_id = t.id
    WHERE t.status = 'selesai' AND t.waktu_selesai IS NOT NULL
      AND COALESCE(k.tanggal, t.tanggal) BETWEEN p_dari AND p_sampai
      AND (p_unit IS NULL OR p_unit = 'layanan')
      AND (p_layanan_id IS NULL OR t.layanan_id = p_layanan_id)
      AND NOT EXISTS (SELECT 1 FROM public.penanganan AS p2 WHERE p2.tiket_id = t.id)
      AND COALESCE(o.status_draft, pz.status_draft, 'selesai') = 'selesai'
  )
  SELECT pg_catalog.count(*) INTO v_total FROM selesai AS s
  WHERE (v_role <> 'petugas' OR (s.unit = 'layanan' AND s.layanan_id = v_layanan))
    AND (v_role <> 'front_office' OR v_koord OR s.unit = 'fo')
    AND (p_tanpa_form IS NOT TRUE OR s.unit <> 'layanan'
         OR NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = s.layanan_id AND l.form_pendataan IS NOT NULL));

  RETURN pg_catalog.jsonb_build_object('saya', v_saya, 'total', v_total, 'persen',
    CASE WHEN v_total = 0 THEN 0 ELSE pg_catalog.round(v_saya * 100.0 / v_total, 2) END);
END $$;
REVOKE ALL ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean) TO authenticated;
