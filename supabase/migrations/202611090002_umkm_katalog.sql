-- Katalog tahap A: proyeksi approved, cursor privat, bukti unggah dan antrean hapus copy publik.
CREATE OR REPLACE FUNCTION umkm_private.ada_kontak(p_teks text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE teks text; kelompok text[]; grup text[]; sisa text; i integer;
BEGIN
  teks := translate(normalize(coalesce(p_teks,''), NFKC),
    '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹०१२३४५६७८९', '012345678901234567890123456789');
  FOR i IN 0..9 LOOP teks := replace(teks, '%3' || i::text, i::text); END LOOP;
  IF teks ~* '[[:alnum:]._%+-]+@[[:alnum:].-]+[.][[:alpha:]]{2,}|tel:|mailto:'
    OR teks ~* 'wa[[:space:]]*[.][[:space:]]*(me|link)|whatsapp[[:space:]]*[.][[:space:]]*com'
    OR teks ~* 't[[:space:]]*[.][[:space:]]*me|linktr[[:space:]]*[.][[:space:]]*ee' THEN
    RETURN true;
  END IF;
  teks := regexp_replace(teks, '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}', ' ', 'gi');
  teks := regexp_replace(teks, '\mrp[.]?[[:space:]]*[1-9][0-9.,]*', ' ', 'gi');
  teks := regexp_replace(teks, '[^[:alnum:]]+', ' ', 'g');
  FOR kelompok IN SELECT regexp_matches(teks, '[0-9]+(?:[^[:alnum:]]{1,3}[0-9]+)*', 'g') LOOP
    grup := regexp_split_to_array(kelompok[1], '[^0-9]+');
    sisa := '';
    FOR i IN REVERSE array_length(grup,1)..1 LOOP
      sisa := grup[i] || sisa;
      EXIT WHEN length(sisa) > 15;
      IF length(sisa) >= 9 AND sisa ~ '^(0[1-9]|62|8[1-9])' THEN RETURN true; END IF;
    END LOOP;
  END LOOP;
  RETURN false;
END $$;

ALTER TABLE public.umkm_foto
  ADD COLUMN unggah_etag text,
  ADD COLUMN unggah_ukuran bigint,
  ADD COLUMN unggah_tipe text,
  ADD COLUMN unggah_diperiksa_pada timestamptz,
  ADD COLUMN r2_key_publik text,
  ADD COLUMN url_publik text,
  ADD CONSTRAINT umkm_foto_bukti CHECK (
    (r2_key_publik IS NULL AND url_publik IS NULL) OR
    (r2_key_publik IS NOT NULL AND url_publik IS NOT NULL AND asal='unggahan'
      AND unggah_etag IS NOT NULL AND length(unggah_etag) BETWEEN 1 AND 128
      AND unggah_ukuran IS NOT NULL AND unggah_ukuran BETWEEN 1 AND 2097152
      AND unggah_tipe IS NOT NULL AND unggah_tipe IN ('image/jpeg','image/png','image/webp')
      AND unggah_diperiksa_pada IS NOT NULL
      AND r2_key_publik ~ '^umkm-katalog/[a-f0-9-]{36}\.(jpg|png|webp)$'
      AND umkm_private.url_foto_sah(url_publik) AND NOT umkm_private.ada_kontak(url_publik)));

CREATE TABLE umkm_private.foto_hapus (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  foto_id uuid NOT NULL REFERENCES public.umkm_foto(id),
  r2_key_publik text NOT NULL UNIQUE, rencana boolean NOT NULL DEFAULT false,
  dibuat_pada timestamptz NOT NULL DEFAULT now(), selesai_pada timestamptz
);
ALTER TABLE umkm_private.foto_hapus ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON umkm_private.foto_hapus FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX umkm_foto_hapus_terbuka ON umkm_private.foto_hapus(profil_id,id) WHERE selesai_pada IS NULL;
CREATE INDEX umkm_katalog_terbit ON public.umkm_profil(terbit_pada DESC,id DESC) WHERE status='terbit';
CREATE INDEX umkm_katalog_label ON public.umkm_revisi(jenis,kategori,kabupaten_kota);
-- Instalasi lama dapat menempatkan pg_trgm di public atau extensions.
DO $$
DECLARE skema text;
BEGIN
  SELECT n.nspname INTO skema FROM pg_catalog.pg_extension e
    JOIN pg_catalog.pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm';
  IF skema IS NULL THEN RAISE EXCEPTION 'PRASYARAT: pg_trgm belum tersedia'; END IF;
  EXECUTE format('CREATE INDEX umkm_katalog_nama ON public.umkm_revisi USING gin (nama %I.gin_trgm_ops)',skema);
  EXECUTE format('CREATE INDEX umkm_katalog_deskripsi ON public.umkm_revisi USING gin (deskripsi %I.gin_trgm_ops)',
    skema);
END $$;

CREATE FUNCTION umkm_private.sidik(p_data jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT encode(extensions.hmac(convert_to(p_data::text,'UTF8'),kunci,'sha256'),'hex')
  FROM umkm_private.rahasia WHERE tunggal
$$;
CREATE FUNCTION umkm_private.buat_cursor(p_jenis text,p_data jsonb) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT replace(encode(convert_to(j::text,'UTF8'),'base64'),E'\n','') || '.' || umkm_private.sidik(j)
  FROM (SELECT jsonb_build_object('v',1,'jenis',p_jenis,'data',p_data) j) x
$$;
CREATE FUNCTION umkm_private.baca_cursor(p_cursor text,p_jenis text) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE j jsonb;
BEGIN
  IF p_cursor IS NULL THEN RETURN NULL; END IF;
  IF length(p_cursor)>4096 OR p_cursor !~ '^[A-Za-z0-9+/=]+\.[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  j := convert_from(decode(split_part(p_cursor,'.',1),'base64'),'UTF8')::jsonb;
  IF j->>'v' IS DISTINCT FROM '1' OR j->>'jenis' IS DISTINCT FROM p_jenis
    OR split_part(p_cursor,'.',2) IS DISTINCT FROM umkm_private.sidik(j)
    OR jsonb_typeof(j->'data') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  RETURN j->'data';
EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
END $$;

CREATE FUNCTION umkm_private.foto_publik(p_revisi_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'url',
    CASE WHEN f.asal='unggahan' THEN f.url_publik ELSE f.url END) ORDER BY f.id),'[]'::jsonb)
  FROM public.umkm_foto f WHERE f.revisi_id=p_revisi_id AND NOT f.tersembunyi AND NOT f.perlu_review
    AND (f.asal IN ('satudata','eksternal') OR (f.r2_key_publik IS NOT NULL AND f.unggah_etag IS NOT NULL))
$$;
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
CREATE FUNCTION public.umkm_cari_katalog(p_q text DEFAULT NULL,p_jenis text DEFAULT NULL,
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
CREATE FUNCTION public.umkm_filter_katalog() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH label AS (
    SELECT r.jenis,r.kategori,r.kabupaten_kota FROM public.umkm_profil p
    JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id WHERE p.status='terbit'
  ), j AS (SELECT DISTINCT jenis v FROM label ORDER BY v LIMIT 201),
  k AS (SELECT DISTINCT kategori v FROM label ORDER BY v LIMIT 201),
  w AS (SELECT DISTINCT kabupaten_kota v FROM label ORDER BY v LIMIT 201)
  SELECT jsonb_build_object('jenis',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT v FROM j LIMIT 200) x),
      '[]'::jsonb),'kategori',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT v FROM k LIMIT 200) x),'[]'::jsonb),
    'kabupaten_kota',coalesce((SELECT jsonb_agg(v ORDER BY v) FROM (SELECT v FROM w LIMIT 200) x),'[]'::jsonb),
    'terpotong',(SELECT count(*)>200 FROM j) OR (SELECT count(*)>200 FROM k) OR (SELECT count(*)>200 FROM w))
$$;

CREATE FUNCTION umkm_private.antre_hapus(p_foto public.umkm_foto) RETURNS void
LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO umkm_private.foto_hapus(profil_id,foto_id,r2_key_publik)
  SELECT r.profil_id,p_foto.id,p_foto.r2_key_publik FROM public.umkm_revisi r
  WHERE r.id=p_foto.revisi_id AND p_foto.r2_key_publik IS NOT NULL
  ON CONFLICT (r2_key_publik) DO NOTHING
$$;
CREATE FUNCTION umkm_private.foto_disembunyikan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.r2_key_publik IS NOT NULL AND (NEW.tersembunyi OR NEW.perlu_review
    OR NEW.r2_key IS DISTINCT FROM OLD.r2_key) THEN
    PERFORM umkm_private.antre_hapus(OLD);
    NEW.r2_key_publik := NULL; NEW.url_publik := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER umkm_foto_disembunyikan BEFORE UPDATE ON public.umkm_foto
FOR EACH ROW EXECUTE FUNCTION umkm_private.foto_disembunyikan();
CREATE FUNCTION umkm_private.profil_disembunyikan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE f public.umkm_foto;
BEGIN
  IF OLD.status='terbit' AND (NEW.status<>'terbit'
    OR NEW.revisi_disetujui_id IS DISTINCT FROM OLD.revisi_disetujui_id) THEN
    FOR f IN SELECT * FROM public.umkm_foto WHERE revisi_id=OLD.revisi_disetujui_id
      AND r2_key_publik IS NOT NULL LOOP
      PERFORM umkm_private.antre_hapus(f);
      UPDATE public.umkm_foto SET r2_key_publik=NULL,url_publik=NULL WHERE id=f.id;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER umkm_profil_disembunyikan AFTER UPDATE ON public.umkm_profil
FOR EACH ROW EXECUTE FUNCTION umkm_private.profil_disembunyikan();

CREATE FUNCTION public.umkm_bukti_foto(p_profil_id uuid,p_foto_id uuid,p_etag text,p_ukuran bigint,p_tipe text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; f public.umkm_foto;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT * INTO f FROM public.umkm_foto WHERE id=p_foto_id AND revisi_id=p.revisi_disetujui_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.status<>'terbit' OR f.asal<>'unggahan' OR f.tersembunyi OR f.perlu_review THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  IF p_etag IS NULL OR p_etag !~ '^[a-fA-F0-9"-]{1,128}$'
    OR p_ukuran IS NULL OR p_ukuran NOT BETWEEN 1 AND 2097152
    OR p_tipe IS NULL OR p_tipe NOT IN ('image/jpeg','image/png','image/webp') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF f.r2_key_publik IS NOT NULL AND f.unggah_etag IS DISTINCT FROM p_etag THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  UPDATE public.umkm_foto SET unggah_etag=p_etag,unggah_ukuran=p_ukuran,unggah_tipe=p_tipe,
    unggah_diperiksa_pada=clock_timestamp() WHERE id=f.id;
  RETURN jsonb_build_object('id',f.id);
END $$;
CREATE FUNCTION public.umkm_rencana_foto(p_profil_id uuid,p_foto_id uuid,p_r2_key_publik text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; f public.umkm_foto;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT * INTO f FROM public.umkm_foto WHERE id=p_foto_id AND revisi_id=p.revisi_disetujui_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.status<>'terbit' OR f.asal<>'unggahan' OR f.tersembunyi OR f.perlu_review
    OR f.unggah_etag IS NULL OR f.unggah_diperiksa_pada IS NULL THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  IF p_r2_key_publik IS NULL OR p_r2_key_publik !~ '^umkm-katalog/[a-f0-9-]{36}\.(jpg|png|webp)$' THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  INSERT INTO umkm_private.foto_hapus(profil_id,foto_id,r2_key_publik,rencana)
    VALUES(p.id,f.id,p_r2_key_publik,true) ON CONFLICT DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM umkm_private.foto_hapus h WHERE h.profil_id=p.id AND h.foto_id=f.id
    AND h.r2_key_publik=p_r2_key_publik AND h.rencana AND h.selesai_pada IS NULL) THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('id',f.id);
END $$;
CREATE FUNCTION public.umkm_terbitkan_foto(p_profil_id uuid,p_foto_id uuid,p_etag text,
  p_r2_key_publik text,p_url_publik text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; f public.umkm_foto;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT * INTO f FROM public.umkm_foto WHERE id=p_foto_id AND revisi_id=p.revisi_disetujui_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.status<>'terbit' OR f.asal<>'unggahan' OR f.tersembunyi OR f.perlu_review
    OR f.unggah_etag IS NULL OR f.unggah_etag IS DISTINCT FROM p_etag
    OR (f.r2_key_publik IS NOT NULL AND f.r2_key_publik IS DISTINCT FROM p_r2_key_publik) THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  IF p_r2_key_publik IS NULL OR p_r2_key_publik !~ '^umkm-katalog/[a-f0-9-]{36}\.(jpg|png|webp)$'
    OR NOT coalesce(umkm_private.url_foto_sah(p_url_publik),false)
    OR right(p_url_publik,length(p_r2_key_publik)+1) IS DISTINCT FROM '/' || p_r2_key_publik
    OR umkm_private.ada_kontak(p_url_publik) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF f.r2_key_publik=p_r2_key_publik THEN RETURN jsonb_build_object('id',f.id); END IF;
  IF NOT EXISTS (SELECT 1 FROM umkm_private.foto_hapus h WHERE h.profil_id=p.id AND h.foto_id=f.id
    AND h.r2_key_publik=p_r2_key_publik AND h.rencana AND h.selesai_pada IS NULL) THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  UPDATE public.umkm_foto SET r2_key_publik=p_r2_key_publik,url_publik=p_url_publik WHERE id=f.id;
  DELETE FROM umkm_private.foto_hapus WHERE profil_id=p.id AND foto_id=f.id
    AND r2_key_publik=p_r2_key_publik AND rencana AND selesai_pada IS NULL;
  RETURN jsonb_build_object('id',f.id);
END $$;

CREATE FUNCTION umkm_private.aktor_hapus() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF NOT public.sesi_valid() OR NOT EXISTS (SELECT 1 FROM public.petugas a
    WHERE a.auth_user_id=auth.uid() AND a.aktif AND (a.role IN ('admin','front_office')
      OR (a.role='petugas' AND a.pemeriksa_umkm))) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
END $$;
CREATE FUNCTION umkm_private.foto_hapus_terbuka(p_profil_id uuid)
RETURNS SETOF umkm_private.foto_hapus
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT h.* FROM umkm_private.foto_hapus h WHERE h.profil_id=p_profil_id AND h.selesai_pada IS NULL
    AND (NOT h.rencana OR h.dibuat_pada < now()-interval '5 minutes')
    AND NOT EXISTS (SELECT 1 FROM public.umkm_foto f WHERE f.id=h.foto_id AND f.r2_key_publik=h.r2_key_publik)
$$;
CREATE FUNCTION public.umkm_antrian_hapus_foto(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM umkm_private.aktor_hapus();
  RETURN jsonb_build_object('total',(SELECT count(*) FROM umkm_private.foto_hapus_terbuka(p_profil_id)),
    'items',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,
    'r2_key_publik',r2_key_publik) ORDER BY id) FROM (SELECT id,r2_key_publik
      FROM umkm_private.foto_hapus_terbuka(p_profil_id)
      ORDER BY id LIMIT 20) x),'[]'::jsonb));
END $$;
CREATE FUNCTION public.umkm_selesai_hapus_foto(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM umkm_private.aktor();
  UPDATE umkm_private.foto_hapus SET selesai_pada=coalesce(selesai_pada,clock_timestamp()) WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('id',p_id);
END $$;
CREATE OR REPLACE FUNCTION public.umkm_detail_tugas(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; hasil jsonb;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT umkm_private.tugas(p) || jsonb_build_object('dipegang_saya',p.petugas_id=a.id,'sumber',p.sumber,
    'sumber_ref',p.sumber_ref,'revisi',to_jsonb(r),'foto',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id)
      FROM public.umkm_foto f WHERE revisi_id=r.id),'[]'::jsonb),
    'foto_hapus_tertunda',(SELECT count(*) FROM umkm_private.foto_hapus_terbuka(p.id)),
    'foto_publikasi_tertunda',(SELECT count(*) FROM public.umkm_foto f WHERE
      f.revisi_id=p.revisi_disetujui_id AND f.asal='unggahan' AND NOT f.tersembunyi AND NOT f.perlu_review
      AND f.r2_key_publik IS NULL),
    'foto_disetujui',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.umkm_foto f
      WHERE f.revisi_id=p.revisi_disetujui_id),'[]'::jsonb),
    'izin_status',(SELECT i.status FROM public.umkm_izin i WHERE profil_id=p.id AND
      kontak_versi_id=p.kontak_terakhir_id ORDER BY dibuat_pada DESC,id DESC LIMIT 1))
    INTO hasil FROM public.umkm_revisi r WHERE r.id=p.revisi_terakhir_id;
  RETURN hasil;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.umkm_cari_katalog(text,text,text,text,text,text,text),
  public.umkm_filter_katalog(),public.umkm_profil_publik(uuid),public.umkm_bukti_foto(uuid,uuid,text,bigint,text),
  public.umkm_rencana_foto(uuid,uuid,text),public.umkm_terbitkan_foto(uuid,uuid,text,text,text),
  public.umkm_antrian_hapus_foto(uuid),
  public.umkm_selesai_hapus_foto(uuid),public.umkm_detail_tugas(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.umkm_cari_katalog(text,text,text,text,text,text,text),
  public.umkm_filter_katalog(),public.umkm_profil_publik(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_bukti_foto(uuid,uuid,text,bigint,text),
  public.umkm_rencana_foto(uuid,uuid,text),public.umkm_terbitkan_foto(uuid,uuid,text,text,text),
  public.umkm_antrian_hapus_foto(uuid),
  public.umkm_selesai_hapus_foto(uuid),public.umkm_detail_tugas(uuid) TO authenticated;
