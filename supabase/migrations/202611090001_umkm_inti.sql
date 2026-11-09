-- UMKM tahap A G1: data privat, pemeriksaan atomik, isolasi nomor dan riwayat aman.
-- Rantai lokal: scripts/lokal-rantai/harness.mjs. Publikasi foto R2 ditambahkan pada tiket 04.
CREATE SCHEMA umkm_private;
REVOKE ALL ON SCHEMA umkm_private FROM PUBLIC, anon, authenticated;
CREATE TABLE umkm_private.rahasia (
  tunggal boolean PRIMARY KEY DEFAULT true CHECK (tunggal),
  kunci bytea NOT NULL DEFAULT extensions.gen_random_bytes(32)
);
INSERT INTO umkm_private.rahasia(tunggal) VALUES (true);
ALTER TABLE umkm_private.rahasia ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON umkm_private.rahasia FROM PUBLIC, anon, authenticated;

ALTER TABLE public.petugas ADD COLUMN pemeriksa_umkm boolean NOT NULL DEFAULT false;

CREATE TABLE public.umkm_profil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sumber text NOT NULL CHECK (sumber IN ('kurasi', 'satudata', 'loket')),
  sumber_ref text CHECK (length(sumber_ref) <= 200),
  status text NOT NULL DEFAULT 'diajukan' CHECK (status IN ('diajukan', 'terbit', 'disembunyikan', 'ditolak')),
  versi integer NOT NULL DEFAULT 1 CHECK (versi > 0),
  revisi_disetujui_id uuid, revisi_terakhir_id uuid, kontak_terakhir_id uuid,
  petugas_id uuid REFERENCES public.petugas(id),
  mendesak boolean NOT NULL DEFAULT false,
  dibuat_pada timestamptz NOT NULL DEFAULT now(), terbit_pada timestamptz
);
CREATE TABLE public.umkm_revisi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  versi integer NOT NULL CHECK (versi > 0),
  nama text NOT NULL CHECK (length(btrim(nama)) BETWEEN 1 AND 200),
  deskripsi text NOT NULL CHECK (length(deskripsi) <= 4000), alamat text CHECK (length(alamat) <= 500),
  jenis text NOT NULL CHECK (length(btrim(jenis)) BETWEEN 1 AND 100),
  kategori text NOT NULL CHECK (length(btrim(kategori)) BETWEEN 1 AND 100),
  spesifik text CHECK (length(spesifik) <= 100),
  kabupaten_kota text NOT NULL CHECK (length(btrim(kabupaten_kota)) BETWEEN 1 AND 100),
  memiliki_nib boolean, instagram text, tiktok text,
  keputusan text CHECK (keputusan IN ('terbit', 'ditolak')),
  dibuat_oleh uuid NOT NULL REFERENCES public.petugas(id), dibuat_pada timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profil_id, versi), UNIQUE (profil_id, id)
);
CREATE TABLE public.umkm_foto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), revisi_id uuid NOT NULL REFERENCES public.umkm_revisi(id),
  asal text NOT NULL CHECK (asal IN ('satudata', 'eksternal', 'unggahan')),
  url text, r2_key text,
  tersembunyi boolean NOT NULL DEFAULT false, perlu_review boolean NOT NULL DEFAULT true,
  diperiksa_oleh uuid REFERENCES public.petugas(id), diperiksa_pada timestamptz,
  CHECK ((asal = 'unggahan' AND url IS NULL AND r2_key IS NOT NULL)
    OR (asal IN ('satudata', 'eksternal') AND url IS NOT NULL AND r2_key IS NULL))
);
CREATE TABLE public.umkm_kontak_versi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  nomor text NOT NULL CHECK (nomor ~ '^\+?[0-9]{8,20}$'),
  dibuat_oleh uuid NOT NULL REFERENCES public.petugas(id), dibuat_pada timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profil_id, id)
);
CREATE TABLE public.umkm_izin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  kontak_versi_id uuid NOT NULL, tujuan text NOT NULL DEFAULT 'izin_nomor' CHECK (tujuan = 'izin_nomor'),
  status text NOT NULL CHECK (status IN ('diberikan', 'dicabut')),
  sumber text NOT NULL DEFAULT 'petugas', versi_teks text NOT NULL DEFAULT '1', bukti_ref text,
  aktor_id uuid NOT NULL REFERENCES public.petugas(id), dibuat_pada timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (profil_id, kontak_versi_id) REFERENCES public.umkm_kontak_versi(profil_id, id)
);
CREATE TABLE public.umkm_riwayat (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), objek_id uuid NOT NULL, jenis_objek text NOT NULL,
  aksi text NOT NULL, aktor_id uuid NOT NULL REFERENCES public.petugas(id), peran text NOT NULL,
  status_lama text, status_baru text, alasan text CHECK (length(alasan) <= 240),
  operasi_id uuid, payload_hash text, hasil jsonb, referensi jsonb NOT NULL DEFAULT '{}'::jsonb, dibuat_pada
    timestamptz NOT NULL DEFAULT now(),
  CHECK ((operasi_id IS NULL AND payload_hash IS NULL AND hasil IS NULL)
    OR (operasi_id IS NOT NULL AND payload_hash IS NOT NULL AND hasil IS NOT NULL))
);
ALTER TABLE public.umkm_profil ADD CONSTRAINT umkm_revisi_disetujui_fk
  FOREIGN KEY (id, revisi_disetujui_id) REFERENCES public.umkm_revisi(profil_id, id);
ALTER TABLE public.umkm_profil ADD CONSTRAINT umkm_revisi_terakhir_fk
  FOREIGN KEY (id, revisi_terakhir_id) REFERENCES public.umkm_revisi(profil_id, id);
ALTER TABLE public.umkm_profil ADD CONSTRAINT umkm_kontak_terakhir_fk
  FOREIGN KEY (id, kontak_terakhir_id) REFERENCES public.umkm_kontak_versi(profil_id, id);

CREATE INDEX umkm_tugas_urutan ON public.umkm_profil ((NOT mendesak), dibuat_pada, id);
CREATE INDEX umkm_profil_petugas ON public.umkm_profil(petugas_id);
CREATE INDEX umkm_profil_revisi_disetujui ON public.umkm_profil(revisi_disetujui_id);
CREATE INDEX umkm_profil_revisi_terakhir ON public.umkm_profil(revisi_terakhir_id);
CREATE INDEX umkm_profil_kontak_terakhir ON public.umkm_profil(kontak_terakhir_id);
CREATE INDEX umkm_foto_revisi ON public.umkm_foto(revisi_id, id);
CREATE INDEX umkm_foto_pemeriksa ON public.umkm_foto(diperiksa_oleh);
CREATE INDEX umkm_revisi_pembuat ON public.umkm_revisi(dibuat_oleh);
CREATE INDEX umkm_kontak_pembuat ON public.umkm_kontak_versi(dibuat_oleh);
CREATE INDEX umkm_izin_terakhir ON public.umkm_izin(profil_id, kontak_versi_id, dibuat_pada DESC, id DESC);
CREATE INDEX umkm_izin_aktor ON public.umkm_izin(aktor_id);
CREATE INDEX umkm_riwayat_objek ON public.umkm_riwayat(objek_id, dibuat_pada DESC);
CREATE UNIQUE INDEX umkm_operasi_unik ON public.umkm_riwayat(aktor_id, operasi_id) WHERE operasi_id IS NOT NULL;
ALTER TABLE public.umkm_profil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_revisi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_foto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_kontak_versi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_izin ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_riwayat ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_profil FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.umkm_revisi FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.umkm_foto FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.umkm_kontak_versi FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.umkm_izin FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.umkm_riwayat FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION umkm_private.aktor(p_admin boolean DEFAULT false) RETURNS public.petugas
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE = '28000'; END IF;
  SELECT * INTO a FROM public.petugas WHERE auth_user_id = auth.uid() AND aktif;
  IF a.id IS NULL OR NOT public.sesi_valid()
    OR EXISTS (SELECT 1 FROM auth.users WHERE id = auth.uid() AND is_anonymous)
    OR COALESCE(auth.jwt()->>'is_anonymous','false') = 'true'
    OR (p_admin AND a.role <> 'admin')
    OR (NOT p_admin AND (a.role NOT IN ('admin','petugas') OR NOT a.pemeriksa_umkm)) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
  RETURN a;
END $$;

CREATE FUNCTION umkm_private.ada_kontak(p_teks text) RETURNS boolean
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
CREATE FUNCTION umkm_private.url_foto_sah(p_url text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(length(p_url) <= 500 AND p_url ~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[^[:space:]]+'
    AND split_part(split_part(p_url,'/',3),':',1) !~* '(^localhost$|[.]local$|[.]localhost$|^[0-9.]+$)'
    AND position('.' IN split_part(split_part(p_url,'/',3),':',1)) > 0, false)
$$;
CREATE FUNCTION umkm_private.url_sosial_sah(p_url text, p_domain text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT p_url IS NULL OR (length(p_url) <= 500 AND p_url ~ ('^https://(www[.])?' || replace(p_domain,'.','[.]') ||
    '/[^[:space:]]+'))
$$;
CREATE FUNCTION umkm_private.peringatan(p_revisi_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM (
    SELECT k FROM public.umkm_revisi r CROSS JOIN LATERAL
      (VALUES ('nama',r.nama),('deskripsi',r.deskripsi),('jenis',r.jenis),('kategori',r.kategori),('spesifik',
        r.spesifik),('kabupaten_kota',r.kabupaten_kota),('instagram',r.instagram),('tiktok',r.tiktok)) v(k,t)
      WHERE r.id = p_revisi_id AND umkm_private.ada_kontak(t)
    UNION ALL SELECT 'foto' WHERE EXISTS (
      SELECT 1 FROM public.umkm_foto f WHERE f.revisi_id = p_revisi_id AND NOT f.tersembunyi AND
        umkm_private.ada_kontak(f.url))
  ) d
$$;
CREATE FUNCTION umkm_private.validasi(p_data jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE k text; v text; maks integer; f jsonb;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR octet_length(p_data::text) > 65536
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) x WHERE x NOT IN
      ('nama','deskripsi','alamat','jenis','kategori','spesifik','kabupaten_kota','memiliki_nib','instagram','tiktok',
        'sumber','sumber_ref','nomor','foto')) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['nama','deskripsi','jenis','kategori','kabupaten_kota'] LOOP
    IF jsonb_typeof(p_data->k) IS DISTINCT FROM 'string' OR (k <> 'deskripsi' AND length(btrim(p_data->>k)) = 0) THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR k,maks IN SELECT * FROM (VALUES ('nama',200),('deskripsi',4000),('alamat',500),('jenis',100),('kategori',100),
    ('spesifik',100),('kabupaten_kota',100),('sumber_ref',200),('instagram',500),('tiktok',500)) x(k,m) LOOP
    IF (p_data->>k IS NOT NULL AND jsonb_typeof(p_data->k) <> 'string') OR length(p_data->>k) > maks THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF coalesce(p_data->>'sumber','') NOT IN ('kurasi','satudata','loket')
    OR (p_data->>'nomor' IS NOT NULL AND (jsonb_typeof(p_data->'nomor') <> 'string' OR p_data->>'nomor' !~
      '^\+?[0-9]{8,20}$'))
    OR (p_data->>'memiliki_nib' IS NOT NULL AND jsonb_typeof(p_data->'memiliki_nib') <> 'boolean')
    OR NOT umkm_private.url_sosial_sah(nullif(btrim(p_data->>'instagram'),''),'instagram.com')
    OR NOT umkm_private.url_sosial_sah(nullif(btrim(p_data->>'tiktok'),''),'tiktok.com') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF p_data ? 'foto' THEN
    IF jsonb_typeof(p_data->'foto') <> 'array' OR jsonb_array_length(p_data->'foto') > 10 THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    FOR f IN SELECT value FROM jsonb_array_elements(p_data->'foto') LOOP
      IF jsonb_typeof(f) <> 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(f) x WHERE x NOT IN ('asal','url',
        'r2_key'))
        OR coalesce(f->>'asal','') NOT IN ('satudata','eksternal','unggahan')
        OR (f->>'url' IS NOT NULL AND jsonb_typeof(f->'url') <> 'string')
        OR (f->>'r2_key' IS NOT NULL AND jsonb_typeof(f->'r2_key') <> 'string') THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      IF f->>'asal' = 'unggahan' THEN
        v := f->>'r2_key';
        IF v IS NULL OR length(v) > 310 OR v !~ '^umkm-draf/[A-Za-z0-9_./-]+$'
          OR v ~ '(^|/)([.][.]?|)(/|$)' OR f->>'url' IS NOT NULL THEN
          RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      ELSIF f->>'r2_key' IS NOT NULL OR NOT umkm_private.url_foto_sah(f->>'url') THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION umkm_private.tugas(p public.umkm_profil) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'jenis','profil','nama',r.nama,'status',p.status,'versi',p.versi,
    'mendesak',p.mendesak,'dibuat_pada',p.dibuat_pada,'petugas_id',p.petugas_id,'petugas_nama',s.nama,
    'tanpa_nomor',p.kontak_terakhir_id IS NULL,'peringatan_kontak',umkm_private.peringatan(r.id))
  FROM public.umkm_revisi r LEFT JOIN public.petugas s ON s.id=p.petugas_id WHERE r.id=p.revisi_terakhir_id
$$;

CREATE FUNCTION umkm_private.mutasi(p_aksi text,p_params jsonb,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  a public.petugas; p public.umkm_profil; lama public.umkm_riwayat; r public.umkm_revisi;
  d jsonb; f jsonb; hasil jsonb; h text; rid uuid; kid uuid; nomor_lama text; alasan text;
  status_lama text; tujuan_id uuid; target public.petugas; target_foto public.umkm_foto; petugas_lama uuid; sekarang
    timestamptz := clock_timestamp();
BEGIN
  a := umkm_private.aktor(p_aksi='atur_pemeriksa');
  IF p_operasi_id IS NULL OR p_params IS NULL THEN RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text || p_operasi_id::text,0));
  SELECT encode(extensions.hmac(convert_to(jsonb_build_object('aksi',p_aksi,'params',p_params)::text,'UTF8'),kunci,
    'sha256'),'hex')
    INTO h FROM umkm_private.rahasia WHERE tunggal;
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash <> h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  IF p_aksi='atur_pemeriksa' THEN
    IF jsonb_typeof(p_params->'pemeriksa_umkm') IS DISTINCT FROM 'boolean' OR p_params->>'petugas_id' IS NULL THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    SELECT * INTO target FROM public.petugas WHERE id=(p_params->>'petugas_id')::uuid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
    IF (target.role='front_office' OR target.id=a.id) AND (p_params->>'pemeriksa_umkm')::boolean THEN
      RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
    PERFORM set_config('umkm.atur_penanda', target.id::text, true);
    UPDATE public.petugas SET pemeriksa_umkm=(p_params->>'pemeriksa_umkm')::boolean WHERE id=target.id;
    PERFORM set_config('umkm.atur_penanda', '', true);
    hasil := jsonb_build_object('id',target.id,'pemeriksa_umkm',(p_params->>'pemeriksa_umkm')::boolean);
    tujuan_id := target.id;
  ELSE
    IF p_params->>'profil_id' IS NOT NULL THEN
      SELECT * INTO p FROM public.umkm_profil WHERE id=(p_params->>'profil_id')::uuid FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
      IF p.versi IS DISTINCT FROM (p_params->>'expected_version')::integer THEN
        RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
      IF p_aksi <> 'ambil' AND p.petugas_id IS DISTINCT FROM a.id THEN
        RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
      status_lama := p.status; petugas_lama := p.petugas_id;
    ELSIF p_aksi <> 'simpan' OR p_params->>'expected_version' IS NOT NULL THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
    END IF;
    IF p_aksi='simpan' THEN
      d := p_params->'data'; PERFORM umkm_private.validasi(d);
      IF p.id IS NULL THEN
        INSERT INTO public.umkm_profil(sumber,sumber_ref,petugas_id)
          VALUES (d->>'sumber',d->>'sumber_ref',a.id) RETURNING * INTO p;
      ELSE
        UPDATE public.umkm_profil SET versi=versi+1,sumber=d->>'sumber',sumber_ref=d->>'sumber_ref',
          status=CASE WHEN status='terbit' THEN 'terbit' ELSE 'diajukan' END WHERE id=p.id RETURNING * INTO p;
      END IF;
      INSERT INTO public.umkm_revisi(profil_id,versi,nama,deskripsi,alamat,jenis,kategori,spesifik,kabupaten_kota,
        memiliki_nib,instagram,tiktok,dibuat_oleh)
        VALUES(p.id,p.versi,btrim(d->>'nama'),btrim(d->>'deskripsi'),d->>'alamat',btrim(d->>'jenis'),
          btrim(d->>'kategori'),
          d->>'spesifik',btrim(d->>'kabupaten_kota'),(d->>'memiliki_nib')::boolean,
          nullif(btrim(d->>'instagram'),''),nullif(btrim(d->>'tiktok'),''),a.id) RETURNING id INTO rid;
      IF d ? 'foto' THEN
        INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi)
          SELECT rid,value->>'asal',value->>'url',value->>'r2_key',coalesce((
            SELECT bool_or(lama_foto.tersembunyi) FROM public.umkm_foto lama_foto
            WHERE lama_foto.revisi_id=p.revisi_terakhir_id AND lama_foto.asal=value->>'asal'
              AND lama_foto.url IS NOT DISTINCT FROM value->>'url'
              AND lama_foto.r2_key IS NOT DISTINCT FROM value->>'r2_key'),false)
            FROM jsonb_array_elements(d->'foto');
      ELSIF p.revisi_terakhir_id IS NOT NULL THEN
        INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi)
          SELECT rid,asal,url,r2_key,tersembunyi FROM public.umkm_foto WHERE revisi_id=p.revisi_terakhir_id;
      END IF;
      IF d ? 'nomor' THEN
        SELECT nomor INTO nomor_lama FROM public.umkm_kontak_versi WHERE id=p.kontak_terakhir_id;
        IF nomor_lama IS DISTINCT FROM d->>'nomor' THEN
          IF p.kontak_terakhir_id IS NOT NULL THEN
            INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,aktor_id,dibuat_pada)
              VALUES(p.id,p.kontak_terakhir_id,'dicabut',a.id,sekarang);
          END IF;
          kid := NULL;
          IF d->>'nomor' IS NOT NULL THEN
            INSERT INTO public.umkm_kontak_versi(profil_id,nomor,dibuat_oleh) VALUES(p.id,d->>'nomor',a.id) RETURNING
              id INTO kid;
          END IF;
          p.kontak_terakhir_id := kid;
        END IF;
      END IF;
      UPDATE public.umkm_profil SET revisi_terakhir_id=rid,kontak_terakhir_id=p.kontak_terakhir_id WHERE id=p.id
        RETURNING * INTO p;
    ELSIF p_aksi='ambil' THEN
      UPDATE public.umkm_profil SET petugas_id=a.id,versi=versi+1 WHERE id=p.id RETURNING * INTO p;
    ELSIF p_aksi='putusan' THEN
      SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
      alasan := nullif(btrim(p_params->>'alasan'),'');
      IF coalesce(p_params->>'keputusan','') NOT IN ('terbit','ditolak') OR r.keputusan IS NOT NULL
        OR p.status='disembunyikan' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
      IF (p_params->>'keputusan'='ditolak' AND alasan IS NULL) OR length(alasan)>240 OR
        umkm_private.ada_kontak(alasan) THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      IF p_params->>'keputusan'='terbit' THEN
        IF jsonb_array_length(umkm_private.peringatan(r.id))>0 THEN RAISE EXCEPTION 'KONTAK_PUBLIK' USING
          ERRCODE='40001'; END IF;
        UPDATE public.umkm_revisi SET keputusan='terbit' WHERE id=r.id;
        UPDATE public.umkm_foto SET perlu_review=false,diperiksa_oleh=a.id,diperiksa_pada=sekarang WHERE revisi_id=r.id;
        UPDATE public.umkm_profil SET status='terbit',versi=versi+1,revisi_disetujui_id=r.id,
          terbit_pada=coalesce(terbit_pada,sekarang),mendesak=false WHERE id=p.id RETURNING * INTO p;
      ELSE
        UPDATE public.umkm_revisi SET keputusan='ditolak' WHERE id=r.id;
        UPDATE public.umkm_profil SET status=CASE WHEN status='terbit' THEN 'terbit' ELSE 'ditolak' END,versi=versi+1,
          mendesak=false
          WHERE id=p.id RETURNING * INTO p;
      END IF;
    ELSIF p_aksi='visibilitas' THEN
      IF coalesce(p_params->>'aksi','') NOT IN ('sembunyikan','pulihkan') THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      IF p_params->>'foto_id' IS NOT NULL THEN
        SELECT f.* INTO target_foto FROM public.umkm_foto f JOIN public.umkm_revisi rr ON rr.id=f.revisi_id
          WHERE f.id=(p_params->>'foto_id')::uuid AND rr.profil_id=p.id
            AND f.revisi_id IN (p.revisi_terakhir_id,p.revisi_disetujui_id);
        IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
        -- Pemulihan tidak mengubah foto lama menjadi terlihat; salin menjadi revisi privat untuk diperiksa.
        IF p_params->>'aksi'='sembunyikan' THEN
          UPDATE public.umkm_foto SET tersembunyi=true
            WHERE revisi_id IN (p.revisi_terakhir_id,p.revisi_disetujui_id) AND asal=target_foto.asal
              AND url IS NOT DISTINCT FROM target_foto.url AND r2_key IS NOT DISTINCT FROM target_foto.r2_key;
        ELSE
          IF target_foto.revisi_id <> p.revisi_terakhir_id THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING
            ERRCODE='40001'; END IF;
          SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
          rid := gen_random_uuid();
          INSERT INTO public.umkm_revisi(id,profil_id,versi,nama,deskripsi,alamat,jenis,kategori,spesifik,
            kabupaten_kota,memiliki_nib,instagram,tiktok,dibuat_oleh)
            VALUES(rid,p.id,p.versi+1,r.nama,r.deskripsi,r.alamat,r.jenis,r.kategori,r.spesifik,r.kabupaten_kota,
              r.memiliki_nib,r.instagram,r.tiktok,a.id);
          INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi)
            SELECT rid,asal,url,r2_key,CASE WHEN id=(p_params->>'foto_id')::uuid THEN false ELSE tersembunyi END
              FROM public.umkm_foto WHERE revisi_id=r.id;
          UPDATE public.umkm_profil SET revisi_terakhir_id=rid WHERE id=p.id;
        END IF;
        UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
      ELSIF p_params->>'aksi'='sembunyikan' THEN
        UPDATE public.umkm_profil SET status='disembunyikan',versi=versi+1 WHERE id=p.id RETURNING * INTO p;
      ELSE
        IF p.status <> 'disembunyikan' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
        SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
        rid := gen_random_uuid();
        INSERT INTO public.umkm_revisi(id,profil_id,versi,nama,deskripsi,alamat,jenis,kategori,spesifik,
          kabupaten_kota,memiliki_nib,instagram,tiktok,dibuat_oleh)
          VALUES(rid,p.id,p.versi+1,r.nama,r.deskripsi,r.alamat,r.jenis,r.kategori,r.spesifik,r.kabupaten_kota,
            r.memiliki_nib,r.instagram,r.tiktok,a.id);
        INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi)
          SELECT rid,asal,url,r2_key,tersembunyi FROM public.umkm_foto WHERE revisi_id=r.id;
        UPDATE public.umkm_profil SET status='diajukan',versi=versi+1,revisi_terakhir_id=rid WHERE id=p.id RETURNING
          * INTO p;
      END IF;
    ELSIF p_aksi='izin' THEN
      IF p.kontak_terakhir_id IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
      IF coalesce(p_params->>'status','') NOT IN ('diberikan','dicabut') THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,aktor_id,dibuat_pada)
        VALUES(p.id,p.kontak_terakhir_id,p_params->>'status',a.id,sekarang);
      UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
    ELSE RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
    END IF;
    tujuan_id := p.id;
    hasil := jsonb_build_object('id',p.id,'versi',p.versi,'status',p.status,'revisi_id',p.revisi_terakhir_id,
      'peringatan_kontak',umkm_private.peringatan(p.revisi_terakhir_id));
  END IF;
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,alasan,operasi_id,
    payload_hash,hasil,referensi,dibuat_pada)
    VALUES(tujuan_id,CASE WHEN p_aksi='atur_pemeriksa' THEN 'petugas' ELSE 'profil' END,p_aksi,a.id,a.role,
      status_lama,p.status,alasan,p_operasi_id,h,hasil,
      jsonb_strip_nulls(jsonb_build_object('profil_id',p.id,'revisi_id',p.revisi_terakhir_id,
        'kontak_versi_id',p.kontak_terakhir_id,'foto_id',target_foto.id,
        'petugas_sebelum',petugas_lama,'petugas_sesudah',p.petugas_id,
        'aksi_visibilitas',CASE WHEN p_aksi='visibilitas' THEN p_params->>'aksi' END,
        'keputusan',CASE WHEN p_aksi='putusan' THEN p_params->>'keputusan' END,
        'status_izin',CASE WHEN p_aksi='izin' THEN p_params->>'status' END)),sekarang);
  RETURN hasil;
END $$;

CREATE FUNCTION public.umkm_simpan_profil(p_data jsonb,p_operasi_id uuid,p_profil_id uuid DEFAULT NULL,
  p_expected_version integer DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('simpan',jsonb_build_object('data',p_data,'profil_id',p_profil_id,'expected_version',
   p_expected_version),p_operasi_id)
$$;
CREATE FUNCTION public.umkm_ambil_tugas(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('ambil',jsonb_build_object('profil_id',p_profil_id,'expected_version',p_expected_version),
   p_operasi_id)
$$;
CREATE FUNCTION public.umkm_putuskan_profil(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid,p_keputusan
  text,p_alasan text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('putusan',jsonb_build_object('profil_id',p_profil_id,'expected_version',
   p_expected_version,'keputusan',p_keputusan,'alasan',p_alasan),p_operasi_id)
$$;
CREATE FUNCTION public.umkm_ubah_visibilitas(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid,p_aksi
  text,p_foto_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('visibilitas',jsonb_build_object('profil_id',p_profil_id,'expected_version',
   p_expected_version,'aksi',p_aksi,'foto_id',p_foto_id),p_operasi_id)
$$;
CREATE FUNCTION public.umkm_ubah_izin(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid,p_status text)
  RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('izin',jsonb_build_object('profil_id',p_profil_id,'expected_version',p_expected_version,
   'status',p_status),p_operasi_id)
$$;
CREATE FUNCTION public.umkm_atur_pemeriksa(p_petugas_id uuid,p_pemeriksa_umkm boolean,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('atur_pemeriksa',jsonb_build_object('petugas_id',p_petugas_id,'pemeriksa_umkm',
   p_pemeriksa_umkm),p_operasi_id)
$$;

CREATE FUNCTION public.umkm_detail_tugas(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; hasil jsonb;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT umkm_private.tugas(p) || jsonb_build_object('dipegang_saya',p.petugas_id=a.id,'sumber',p.sumber,'sumber_ref',
    p.sumber_ref,
    'revisi',to_jsonb(r),'foto',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id) FROM public.umkm_foto f WHERE
      revisi_id=r.id),'[]'::jsonb),
    'izin_status',(SELECT i.status FROM public.umkm_izin i WHERE profil_id=p.id AND
      kontak_versi_id=p.kontak_terakhir_id ORDER BY dibuat_pada DESC,id DESC LIMIT 1))
    INTO hasil FROM public.umkm_revisi r WHERE r.id=p.revisi_terakhir_id;
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_daftar_tugas(p_cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; c public.umkm_profil; baris jsonb; berikut uuid;
BEGIN
  a := umkm_private.aktor();
  IF p_cursor IS NOT NULL THEN
    SELECT * INTO c FROM public.umkm_profil WHERE id=p_cursor;
    IF NOT FOUND THEN RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END IF;
  WITH halaman AS (
    SELECT p.*,row_number() OVER (ORDER BY NOT p.mendesak,p.dibuat_pada,p.id) AS urut
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_terakhir_id
    WHERE (r.keputusan IS NULL OR p.mendesak)
      AND (p_cursor IS NULL OR (NOT p.mendesak,p.dibuat_pada,p.id) > (NOT c.mendesak,c.dibuat_pada,c.id))
    ORDER BY NOT p.mendesak,p.dibuat_pada,p.id LIMIT 21
  ) SELECT coalesce(jsonb_agg(umkm_private.tugas(p) ORDER BY h.urut) FILTER (WHERE h.urut<=20),'[]'::jsonb),
      CASE WHEN count(*)>20 THEN (array_agg(h.id ORDER BY h.urut))[20] ELSE NULL END
    INTO baris,berikut FROM halaman h JOIN public.umkm_profil p ON p.id=h.id;
  RETURN jsonb_build_object('items',baris,'next_cursor',berikut);
END $$;
CREATE FUNCTION public.umkm_cari_profil(p_q text,p_cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; q text; baris jsonb; berikut uuid;
BEGIN
  a := umkm_private.aktor();
  q := btrim(p_q);
  IF q IS NULL OR length(q) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
  END IF;
  WITH halaman AS (
    SELECT p.*,row_number() OVER (ORDER BY p.id) AS urut
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_terakhir_id
    WHERE strpos(lower(r.nama),lower(q)) > 0 AND (p_cursor IS NULL OR p.id > p_cursor)
    ORDER BY p.id LIMIT 21
  ) SELECT coalesce(jsonb_agg(umkm_private.tugas(p) ORDER BY h.urut) FILTER (WHERE h.urut<=20),'[]'::jsonb),
      CASE WHEN count(*)>20 THEN (array_agg(h.id ORDER BY h.urut))[20] ELSE NULL END
    INTO baris,berikut FROM halaman h JOIN public.umkm_profil p ON p.id=h.id;
  RETURN jsonb_build_object('items',baris,'next_cursor',berikut);
END $$;
CREATE FUNCTION public.umkm_akses_kontak_petugas(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; nomor text;
BEGIN
  a := umkm_private.aktor();
  -- Kunci sama dengan takeover agar akses nomor tidak lolos sesudah tugas pindah.
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.petugas_id IS DISTINCT FROM a.id OR NOT (p.mendesak OR EXISTS (
    SELECT 1 FROM public.umkm_revisi r WHERE r.id=p.revisi_terakhir_id AND r.keputusan IS NULL
  )) THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT k.nomor INTO nomor FROM public.umkm_kontak_versi k WHERE id=p.kontak_terakhir_id;
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,referensi)
    VALUES(p.id,'profil','akses_kontak',a.id,a.role,p.status,p.status,
      jsonb_build_object('profil_id',p.id,'kontak_versi_id',p.kontak_terakhir_id));
  RETURN jsonb_build_object('nomor',nomor);
END $$;
CREATE FUNCTION public.umkm_profil_publik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE hasil jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'nama',r.nama,'deskripsi',r.deskripsi,'jenis',r.jenis,'kategori',r.kategori,
    'spesifik',r.spesifik,'kabupaten_kota',r.kabupaten_kota,'instagram',r.instagram,'tiktok',r.tiktok,
    'foto',coalesce((SELECT jsonb_agg(jsonb_build_object('id',f.id,'url',f.url) ORDER BY f.id)
      FROM public.umkm_foto f WHERE f.revisi_id=r.id AND NOT f.tersembunyi AND NOT f.perlu_review
        AND f.asal IN ('satudata','eksternal')),'[]'::jsonb)) INTO hasil
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    WHERE p.id=p_profil_id AND p.status='terbit';
  IF hasil IS NULL THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN hasil;
END $$;

-- Penanda hanya lewat RPC; perubahan identitas mencabutnya, perubahan Layanan mempertahankannya.
CREATE FUNCTION umkm_private.jaga_penanda() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.pemeriksa_umkm := false;
  ELSIF NEW.role IS DISTINCT FROM OLD.role OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id THEN
    NEW.pemeriksa_umkm := false;
  ELSIF NEW.pemeriksa_umkm IS DISTINCT FROM OLD.pemeriksa_umkm
    AND current_setting('umkm.atur_penanda',true) IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER umkm_jaga_penanda BEFORE INSERT OR UPDATE ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION umkm_private.jaga_penanda();

-- Perluasan audit pada migrasi ini, tanpa mengubah migrasi audit sebelumnya.
-- Perubahan identitas/penanda tetap memiliki nilai lama dan baru saat tidak ada sesi pengguna.
CREATE FUNCTION umkm_private.audit_petugas() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  aktor uuid := auth.uid(); peran text; lama jsonb; baru jsonb; beda_lama jsonb; beda_baru jsonb;
  kolom text[] := ARRAY['id','nama','role','aktif','username','layanan_id','operator_aktif',
    'auth_user_id','pemeriksa_umkm'];
BEGIN
  IF aktor IS NULL AND NEW.auth_user_id IS NOT DISTINCT FROM OLD.auth_user_id
    AND NEW.pemeriksa_umkm IS NOT DISTINCT FROM OLD.pemeriksa_umkm THEN
    RETURN NULL;
  END IF;
  lama := public.audit_saring(to_jsonb(OLD),kolom);
  baru := public.audit_saring(to_jsonb(NEW),kolom);
  SELECT jsonb_object_agg(e.key,e.value) INTO beda_lama
    FROM jsonb_each(lama) e WHERE baru->e.key IS DISTINCT FROM e.value;
  SELECT jsonb_object_agg(e.key,e.value) INTO beda_baru
    FROM jsonb_each(baru) e WHERE lama->e.key IS DISTINCT FROM e.value;
  IF beda_lama IS NULL AND beda_baru IS NULL THEN RETURN NULL; END IF;
  SELECT p.role INTO peran FROM public.petugas p WHERE p.auth_user_id=aktor;
  INSERT INTO public.audit_log(actor_id,actor_role,aksi,entitas,entitas_id,detail,nilai_lama,nilai_baru)
    VALUES(aktor,coalesce(peran,CASE WHEN aktor IS NULL THEN 'system' ELSE 'pengunjung' END),
      'petugas_ubah','petugas',NEW.id::text,jsonb_build_object('op',TG_OP),beda_lama,beda_baru);
  RETURN NULL;
END $$;
DROP TRIGGER trg_audit_petugas_ubah ON public.petugas;
CREATE TRIGGER trg_audit_petugas_ubah AFTER UPDATE OF
  role, aktif, username, layanan_id, nama, operator_aktif, auth_user_id, pemeriksa_umkm ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION umkm_private.audit_petugas();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_simpan_profil(jsonb,uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_ambil_tugas(uuid,integer,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_putuskan_profil(uuid,integer,uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_ubah_visibilitas(uuid,integer,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_ubah_izin(uuid,integer,uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_atur_pemeriksa(uuid,boolean,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_detail_tugas(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_daftar_tugas(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_cari_profil(text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_akses_kontak_petugas(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.umkm_profil_publik(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_simpan_profil(jsonb,uuid,uuid,integer), public.umkm_ambil_tugas(uuid,integer,
  uuid),
  public.umkm_putuskan_profil(uuid,integer,uuid,text,text), public.umkm_ubah_visibilitas(uuid,integer,uuid,text,uuid),
  public.umkm_ubah_izin(uuid,integer,uuid,text), public.umkm_atur_pemeriksa(uuid,boolean,uuid),
    public.umkm_detail_tugas(uuid),
  public.umkm_daftar_tugas(uuid), public.umkm_cari_profil(text,uuid),
  public.umkm_akses_kontak_petugas(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_profil_publik(uuid) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
