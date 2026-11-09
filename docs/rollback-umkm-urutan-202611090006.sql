-- Pulihkan aplikasi G2 bersama rollback ini; data statistik dan suka dipertahankan.
-- Cursor G3 tidak dapat digunakan pada urutan G2.
CREATE OR REPLACE FUNCTION public.umkm_profil_publik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE hasil jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'nama',r.nama,'deskripsi',r.deskripsi,'jenis',r.jenis,
    'kategori',r.kategori,'spesifik',r.spesifik,'kabupaten_kota',r.kabupaten_kota,
    'instagram',r.instagram,'tiktok',r.tiktok,'foto',umkm_private.foto_publik(r.id)) INTO hasil
  FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
  WHERE p.id=p_profil_id AND p.status='terbit';
  IF hasil IS NULL THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN hasil;
END $$;
CREATE OR REPLACE FUNCTION public.umkm_cari_katalog(p_q text DEFAULT NULL,p_jenis text DEFAULT NULL,
  p_kategori text DEFAULT NULL,p_spesifik text DEFAULT NULL,p_kabupaten_kota text DEFAULT NULL,
  p_sort text DEFAULT 'terbaru',p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text := nullif(btrim(p_q),''); c jsonb; sidik text; snapshot timestamptz; hasil jsonb; berikut text;
BEGIN
  IF length(q)>100 OR coalesce(p_sort,'')<>'terbaru' OR length(p_jenis)>100 OR length(p_kategori)>100
    OR length(p_spesifik)>100 OR length(p_kabupaten_kota)>100 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF length(q)<2 THEN q := NULL; END IF;
  sidik := umkm_private.sidik(jsonb_build_array(q,p_jenis,p_kategori,p_spesifik,p_kabupaten_kota,p_sort));
  c := umkm_private.baca_cursor(p_cursor,'katalog');
  IF c IS NOT NULL AND c->>'filter' IS DISTINCT FROM sidik THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  snapshot := coalesce((c->>'snapshot')::timestamptz,statement_timestamp());
  IF q IS NOT NULL THEN
    q := '%' || replace(replace(replace(q,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_') || '%';
  END IF;
  WITH halaman AS MATERIALIZED (
    SELECT p.id,p.terbit_pada,r.id rid,r.nama,r.jenis,r.kategori,r.spesifik,r.kabupaten_kota,r.deskripsi
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    WHERE p.status='terbit' AND p.terbit_pada<=snapshot
      AND (q IS NULL OR r.nama ILIKE q ESCAPE E'\\' OR r.deskripsi ILIKE q ESCAPE E'\\')
      AND (p_jenis IS NULL OR r.jenis=p_jenis) AND (p_kategori IS NULL OR r.kategori=p_kategori)
      AND (p_spesifik IS NULL OR r.spesifik=p_spesifik)
      AND (p_kabupaten_kota IS NULL OR r.kabupaten_kota=p_kabupaten_kota)
      AND (c IS NULL OR (p.terbit_pada,p.id)<((c->>'waktu')::timestamptz,(c->>'id')::uuid))
    ORDER BY p.terbit_pada DESC,p.id DESC LIMIT 21
  ), nomor AS (
    SELECT h.*,row_number() OVER (ORDER BY terbit_pada DESC,id DESC) urut FROM halaman h
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nama',nama,'jenis',jenis,'kategori',kategori,
      'spesifik',spesifik,'kabupaten_kota',kabupaten_kota,'deskripsi',left(deskripsi,240),
      'foto',umkm_private.foto_publik(rid)->0) ORDER BY urut) FILTER (WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('katalog',jsonb_build_object(
      'snapshot',snapshot,'filter',sidik,'waktu',max(terbit_pada) FILTER (WHERE urut=20),
      'id',max(id::text) FILTER (WHERE urut=20))) ELSE NULL END
    INTO hasil,berikut FROM nomor;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
REVOKE ALL ON FUNCTION public.umkm_serupa(uuid) FROM PUBLIC,anon,authenticated,service_role;
