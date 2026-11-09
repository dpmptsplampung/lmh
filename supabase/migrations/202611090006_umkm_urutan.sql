-- Katalog memakai snapshot skor, urutan harian WIB dan dua slot profil baru.
CREATE FUNCTION umkm_private.statistik_publik(p public.umkm_profil) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('suka',coalesce(t.suka,0),
    'dilihat',CASE WHEN s.telemetri_opsional_aktif THEN coalesce(t.dilihat,0) ELSE NULL END,
    'baru',p.terbit_pada>now()-interval '30 days')
  FROM umkm_private.statistik s LEFT JOIN public.umkm_stat_total t ON t.profil_id=p.id WHERE s.tunggal
$$;
CREATE FUNCTION umkm_private.kartu(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'nama',r.nama,'jenis',r.jenis,'kategori',r.kategori,
    'spesifik',r.spesifik,'kabupaten_kota',r.kabupaten_kota,'deskripsi',left(r.deskripsi,240),
    'foto',umkm_private.foto_publik(r.id)->0) || umkm_private.statistik_publik(p)
  FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
  WHERE p.id=p_id AND p.status='terbit'
$$;
CREATE OR REPLACE FUNCTION public.umkm_profil_publik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE hasil jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'nama',r.nama,'deskripsi',r.deskripsi,'jenis',r.jenis,
    'kategori',r.kategori,'spesifik',r.spesifik,'kabupaten_kota',r.kabupaten_kota,
    'instagram',r.instagram,'tiktok',r.tiktok,'foto',umkm_private.foto_publik(r.id),
    'telemetri_opsional_aktif',s.telemetri_opsional_aktif,'statistik_mulai_pada',t.mulai_pada)
    || umkm_private.statistik_publik(p) INTO hasil
  FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
  CROSS JOIN umkm_private.statistik s LEFT JOIN public.umkm_stat_total t ON t.profil_id=p.id
  WHERE p.id=p_profil_id AND p.status='terbit' AND s.tunggal;
  IF hasil IS NULL THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN hasil;
END $$;
CREATE OR REPLACE FUNCTION public.umkm_cari_katalog(p_q text DEFAULT NULL,p_jenis text DEFAULT NULL,
  p_kategori text DEFAULT NULL,p_spesifik text DEFAULT NULL,p_kabupaten_kota text DEFAULT NULL,
  p_sort text DEFAULT 'paling_sesuai',p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text := nullif(btrim(p_q),''); c jsonb; sidik text; snap uuid; hari_wib date;
  batas timestamptz; hasil jsonb; berikut text;
BEGIN
  IF length(q)>100 OR coalesce(p_sort,'')<>'paling_sesuai' OR length(p_jenis)>100
    OR length(p_kategori)>100 OR length(p_spesifik)>100 OR length(p_kabupaten_kota)>100 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF length(q)<2 THEN q := NULL; END IF;
  sidik := umkm_private.sidik(jsonb_build_array(q,p_jenis,p_kategori,p_spesifik,p_kabupaten_kota,p_sort));
  c := umkm_private.baca_cursor(p_cursor,'katalog-g3');
  SELECT coalesce(snapshot_aktif,'00000000-0000-0000-0000-000000000000'::uuid)
    INTO snap FROM umkm_private.statistik WHERE tunggal;
  hari_wib := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  IF c IS NOT NULL AND c->>'filter' IS DISTINCT FROM sidik THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF c IS NOT NULL AND ((c->>'snapshot')::uuid IS DISTINCT FROM snap
    OR (c->>'hari')::date IS DISTINCT FROM hari_wib) THEN
    RAISE EXCEPTION 'SNAPSHOT_BERUBAH' USING ERRCODE='40001'; END IF;
  batas := coalesce((c->>'batas')::timestamptz,statement_timestamp());
  IF q IS NOT NULL THEN
    q := '%' || replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_') || '%';
  END IF;
  WITH cocok AS MATERIALIZED (
    SELECT p.id,p.terbit_pada,
      CASE WHEN q IS NULL THEN 0 WHEN r.spesifik ILIKE q ESCAPE E'\\' THEN 0
        WHEN r.kategori ILIKE q ESCAPE E'\\' THEN 1 ELSE 2 END tingkat,
      coalesce(s.skor,0) skor,md5(hari_wib::text || p.id::text) acak
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    LEFT JOIN public.umkm_skor s ON s.profil_id=p.id AND s.snapshot=snap
    WHERE p.status='terbit' AND p.terbit_pada<=batas
      AND (q IS NULL OR r.spesifik ILIKE q ESCAPE E'\\' OR r.kategori ILIKE q ESCAPE E'\\'
        OR r.nama ILIKE q ESCAPE E'\\' OR r.deskripsi ILIKE q ESCAPE E'\\')
      AND (p_jenis IS NULL OR r.jenis=p_jenis) AND (p_kategori IS NULL OR r.kategori=p_kategori)
      AND (p_spesifik IS NULL OR r.spesifik=p_spesifik)
      AND (p_kabupaten_kota IS NULL OR r.kabupaten_kota=p_kabupaten_kota)
  ), baru AS MATERIALIZED (
    SELECT id,row_number() OVER (ORDER BY acak,id) n FROM cocok
    WHERE terbit_pada>now()-interval '30 days' ORDER BY acak,id LIMIT 2
  ), slot_baru AS MATERIALIZED (
    SELECT id,CASE WHEN n=1 THEN 5 ELSE 15 END posisi FROM baru
    WHERE c IS NULL AND (SELECT count(*) FROM cocok)>=CASE WHEN n=1 THEN 5 ELSE 15 END
  ), slot_ids AS MATERIALIZED (
    SELECT CASE WHEN c IS NULL THEN coalesce((SELECT jsonb_agg(id ORDER BY posisi) FROM slot_baru),'[]'::jsonb)
      ELSE c->'slot' END ids
  ), halaman AS MATERIALIZED (
    SELECT k.* FROM cocok k WHERE NOT EXISTS (
      SELECT 1 FROM slot_ids s,jsonb_array_elements_text(s.ids) v WHERE k.id=v::uuid)
      AND (c IS NULL OR (k.tingkat,-k.skor,k.acak,k.id)>
        ((c->>'tingkat')::integer,-(c->>'skor')::bigint,c->>'acak',(c->>'id')::uuid))
    ORDER BY tingkat,skor DESC,acak,id LIMIT 21
  ), nomor AS MATERIALIZED (
    SELECT h.*,row_number() OVER (ORDER BY tingkat,skor DESC,acak,id) n FROM halaman h
  ), gabung AS MATERIALIZED (
    SELECT id,n+CASE WHEN c IS NULL AND n>=5 AND EXISTS (SELECT 1 FROM slot_baru WHERE posisi=5)
      THEN 1 ELSE 0 END+CASE WHEN c IS NULL AND n>=14 AND EXISTS (SELECT 1 FROM slot_baru WHERE posisi=15)
      THEN 1 ELSE 0 END posisi FROM nomor
    UNION ALL SELECT id,posisi FROM slot_baru
  ), terakhir AS (
    SELECT n.* FROM nomor n JOIN gabung g USING(id) WHERE g.posisi<=20 ORDER BY n.n DESC LIMIT 1
  ) SELECT coalesce((SELECT jsonb_agg(umkm_private.kartu(id) ORDER BY posisi) FROM gabung
      WHERE posisi<=20),'[]'::jsonb),
    CASE WHEN EXISTS (SELECT 1 FROM gabung WHERE posisi>20) THEN
      (SELECT umkm_private.buat_cursor('katalog-g3',jsonb_build_object('filter',sidik,'snapshot',snap,
        'hari',hari_wib,'batas',batas,'slot',(SELECT ids FROM slot_ids),
        'tingkat',tingkat,'skor',skor,'acak',acak,'id',id)) FROM terakhir) ELSE NULL END
    INTO hasil,berikut;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE FUNCTION public.umkm_serupa(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE sumber public.umkm_revisi; hasil jsonb;
BEGIN
  SELECT r.* INTO sumber FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    WHERE p.id=p_profil_id AND p.status='terbit';
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(umkm_private.kartu(id) ORDER BY kota,skor DESC,acak,id),'[]'::jsonb) INTO hasil FROM (
    SELECT p.id,(r.kabupaten_kota<>sumber.kabupaten_kota) kota,coalesce(s.skor,0) skor,
      md5((now() AT TIME ZONE 'Asia/Jakarta')::date::text || p.id::text) acak
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    CROSS JOIN umkm_private.statistik m LEFT JOIN public.umkm_skor s ON s.profil_id=p.id
      AND s.snapshot=m.snapshot_aktif WHERE p.status='terbit' AND p.id<>p_profil_id
      AND r.kategori=sumber.kategori AND m.tunggal ORDER BY kota,skor DESC,acak,p.id LIMIT 10
  ) x;
  RETURN jsonb_build_object('items',hasil);
END $$;
REVOKE ALL ON FUNCTION umkm_private.statistik_publik(public.umkm_profil),umkm_private.kartu(uuid),
  public.umkm_serupa(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_serupa(uuid) TO anon,authenticated;
