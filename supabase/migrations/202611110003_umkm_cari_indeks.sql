-- G2 2.3: indeks pencarian katalog UMKM. Hasil dan urutan umkm_cari_katalog identik dengan 202611100003;
-- hanya predikat q ditulis ulang agar setiap cabang ILIKE dapat memakai indeks trigram (bitmap OR).
-- Indeks nama dan deskripsi sudah ada (202611090002); ditambah spesifik, kategori, dan nama produk.
-- Instalasi lama dapat menempatkan pg_trgm di public atau extensions (pola 202611090002).
DO $$
DECLARE skema text;
BEGIN
  SELECT n.nspname INTO skema FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
  IF skema IS NULL THEN RAISE EXCEPTION 'PRASYARAT: pg_trgm belum tersedia'; END IF;
  EXECUTE format('CREATE INDEX IF NOT EXISTS umkm_katalog_spesifik ON public.umkm_revisi USING gin (spesifik %I.gin_trgm_ops)',skema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS umkm_katalog_kategori ON public.umkm_revisi USING gin (kategori %I.gin_trgm_ops)',skema);
  EXECUTE format('CREATE INDEX IF NOT EXISTS umkm_produk_nama_trgm ON public.umkm_produk USING gin (nama %I.gin_trgm_ops)',skema);
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
        WHEN r.kategori ILIKE q ESCAPE E'\\' OR EXISTS (SELECT 1 FROM public.umkm_produk pr WHERE pr.revisi_id=r.id AND pr.nama ILIKE q ESCAPE E'\\') THEN 1 ELSE 2 END tingkat,
      coalesce(s.skor,0) skor,md5(hari_wib::text || p.id::text) acak
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    LEFT JOIN public.umkm_skor s ON s.profil_id=p.id AND s.snapshot=snap
    WHERE p.status='terbit' AND p.terbit_pada<=batas
      AND (q IS NULL OR r.id IN (
        SELECT x.id FROM public.umkm_revisi x WHERE x.nama ILIKE q ESCAPE E'\\' OR x.deskripsi ILIKE q ESCAPE E'\\'
          OR x.spesifik ILIKE q ESCAPE E'\\' OR x.kategori ILIKE q ESCAPE E'\\'
        UNION SELECT pq.revisi_id FROM public.umkm_produk pq WHERE pq.nama ILIKE q ESCAPE E'\\'))
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
