-- Profil lengkap, produk per revisi dan foto profil utama.
ALTER TABLE public.umkm_revisi
  ADD COLUMN kecamatan text CONSTRAINT umkm_revisi_kecamatan_panjang CHECK (length(kecamatan)<=100),
  ADD COLUMN nama_pemilik text CONSTRAINT umkm_revisi_nama_pemilik_panjang CHECK (length(nama_pemilik)<=200),
  ADD COLUMN bentuk_usaha text CONSTRAINT umkm_revisi_bentuk_usaha_sah CHECK (bentuk_usaha IN ('Perorangan','CV','PT','Firma','Yayasan','NV','Lainnya')),
  ADD COLUMN tahun_mulai smallint CONSTRAINT umkm_revisi_tahun_mulai_sah CHECK (tahun_mulai BETWEEN 1900 AND 2100),
  ADD COLUMN omzet_rentang text CONSTRAINT umkm_revisi_omzet_rentang_sah CHECK (omzet_rentang IN ('sd_10jt','10_50jt','50_300jt','300jt_2m','2_15m','15_50m')),
  ADD COLUMN tenaga_kerja_rentang text CONSTRAINT umkm_revisi_tenaga_kerja_sah CHECK (tenaga_kerja_rentang IN ('1-4','5-19','20-99','100+'));

CREATE TABLE public.umkm_produk (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revisi_id uuid NOT NULL REFERENCES public.umkm_revisi(id) ON DELETE CASCADE,
  urutan smallint NOT NULL CHECK (urutan BETWEEN 1 AND 20),
  nama text NOT NULL CHECK (length(nama) BETWEEN 1 AND 100),
  keterangan text CHECK (length(keterangan)<=500),
  kapasitas_jumlah numeric(14,2) CHECK (kapasitas_jumlah>0),
  kapasitas_satuan text CHECK (length(kapasitas_satuan) BETWEEN 1 AND 20),
  kapasitas_periode text CHECK (kapasitas_periode IN ('hari','minggu','bulan','tahun')),
  CHECK ((kapasitas_jumlah IS NULL AND kapasitas_satuan IS NULL AND kapasitas_periode IS NULL)
    OR (kapasitas_jumlah IS NOT NULL AND kapasitas_satuan IS NOT NULL AND kapasitas_periode IS NOT NULL)),
  UNIQUE (revisi_id,urutan)
);
ALTER TABLE public.umkm_produk ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_produk FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.umkm_foto
  ADD COLUMN utama boolean NOT NULL DEFAULT false,
  ADD COLUMN produk_urutan smallint,
  ADD CONSTRAINT umkm_foto_produk_fk FOREIGN KEY (revisi_id,produk_urutan)
    REFERENCES public.umkm_produk(revisi_id,urutan) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT umkm_foto_utama_profil CHECK (NOT (utama AND produk_urutan IS NOT NULL));
CREATE UNIQUE INDEX umkm_foto_satu_utama ON public.umkm_foto(revisi_id) WHERE utama;
CREATE UNIQUE INDEX umkm_foto_satu_produk ON public.umkm_foto(revisi_id,produk_urutan) WHERE produk_urutan IS NOT NULL;

CREATE FUNCTION umkm_private.kategori_sah(p_jenis text,p_kategori text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(CASE p_jenis
    WHEN 'Produk' THEN p_kategori IN ('Makanan Olahan','Minuman Olahan','Pakaian & Tekstil','Kerajinan & Suvenir','Mebel & Produk Kayu','Bahan Bangunan Olahan','Produk Logam & Alat','Kosmetik, Herbal & Kebersihan','Kemasan','Tanaman & Hewan Hias','Grosir Barang Konsumsi')
    WHEN 'Bahan Baku' THEN p_kategori IN ('Hasil Perkebunan','Tanaman Pangan','Sayur & Buah Segar','Peternakan','Perikanan','Kayu, Bambu & Rotan','Pangan Setengah Jadi','Galian & Bahan Alam Bangunan','Barang Bekas & Daur Ulang','Pupuk, Bibit & Pakan')
    WHEN 'Jasa' THEN p_kategori IN ('Katering & Nasi Kotak','Penjahitan Pesanan','Angkutan & Logistik','Kebersihan, Laundry & Pertamanan','Percetakan, Sablon & Desain','Bengkel, Las & Perbaikan','Konstruksi & Pertukangan','Acara & Dokumentasi','Jasa Pertanian & Perikanan','Pelatihan & Jasa Profesional')
    ELSE false END,false)
$$;
CREATE FUNCTION umkm_private.kabupaten_sah(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(p IN ('Kab. Lampung Barat','Kab. Lampung Selatan','Kab. Lampung Tengah','Kab. Lampung Timur','Kab. Lampung Utara','Kab. Mesuji','Kab. Pesawaran','Kab. Pesisir Barat','Kab. Pringsewu','Kab. Tanggamus','Kab. Tulang Bawang','Kab. Tulang Bawang Barat','Kab. Way Kanan','Kota Bandar Lampung','Kota Metro'),false)
$$;
CREATE FUNCTION umkm_private.label_omzet(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE p WHEN '50_300jt' THEN 'Omzet lebih dari Rp50 juta per tahun'
    WHEN '300jt_2m' THEN 'Omzet lebih dari Rp300 juta per tahun'
    WHEN '2_15m' THEN 'Omzet lebih dari Rp2 miliar per tahun'
    WHEN '15_50m' THEN 'Omzet lebih dari Rp15 miliar per tahun' END
$$;
CREATE FUNCTION umkm_private.skala_dari_omzet(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p IN ('sd_10jt','10_50jt','50_300jt','300jt_2m') THEN 'Mikro'
    WHEN p='2_15m' THEN 'Kecil' WHEN p='15_50m' THEN 'Menengah' END
$$;
CREATE OR REPLACE FUNCTION umkm_private.validasi(p_data jsonb) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE k text; v text; maks integer; f jsonb; pr jsonb; fotos jsonb;
BEGIN
  IF p_data IS NULL OR jsonb_typeof(p_data) <> 'object' OR octet_length(p_data::text) > 65536
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(p_data) x WHERE x NOT IN
      ('nama','deskripsi','alamat','jenis','kategori','spesifik','kabupaten_kota','memiliki_nib','instagram','tiktok',
        'sumber','sumber_ref','nomor','foto','kecamatan','nama_pemilik','bentuk_usaha','tahun_mulai','omzet_rentang','tenaga_kerja_rentang','produk')) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
  END IF;
  FOREACH k IN ARRAY ARRAY['nama','deskripsi','jenis','kategori','kabupaten_kota'] LOOP
    IF jsonb_typeof(p_data->k) IS DISTINCT FROM 'string' OR (k <> 'deskripsi' AND length(btrim(p_data->>k)) = 0) THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  FOR k,maks IN SELECT * FROM (VALUES ('nama',200),('deskripsi',4000),('alamat',500),('jenis',100),('kategori',100),
    ('kecamatan',100),('nama_pemilik',200),('spesifik',100),('kabupaten_kota',100),('sumber_ref',200),('instagram',500),('tiktok',500)) x(k,m) LOOP
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
  IF NOT umkm_private.kategori_sah(p_data->>'jenis',p_data->>'kategori')
    OR NOT umkm_private.kabupaten_sah(p_data->>'kabupaten_kota') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  FOR k IN SELECT unnest(ARRAY['bentuk_usaha','omzet_rentang','tenaga_kerja_rentang']) LOOP
    IF p_data->>k IS NOT NULL AND (jsonb_typeof(p_data->k)<>'string' OR NOT CASE k
      WHEN 'bentuk_usaha' THEN p_data->>k IN ('Perorangan','CV','PT','Firma','Yayasan','NV','Lainnya')
      WHEN 'omzet_rentang' THEN p_data->>k IN ('sd_10jt','10_50jt','50_300jt','300jt_2m','2_15m','15_50m')
      ELSE p_data->>k IN ('1-4','5-19','20-99','100+') END) THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF p_data->>'tahun_mulai' IS NOT NULL THEN
    IF jsonb_typeof(p_data->'tahun_mulai')<>'number' THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF (p_data->>'tahun_mulai')::numeric<>trunc((p_data->>'tahun_mulai')::numeric)
      OR (p_data->>'tahun_mulai')::numeric NOT BETWEEN 1900 AND extract(year FROM (now() AT TIME ZONE 'Asia/Jakarta')) THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END IF;
  fotos := '[]'::jsonb;
  IF p_data ? 'foto' THEN
    IF jsonb_typeof(p_data->'foto') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_data->'foto')>10 THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    fotos := p_data->'foto';
    IF (SELECT count(*) FROM jsonb_array_elements(fotos) x WHERE x->'utama'='true'::jsonb)>1 THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END IF;
  IF p_data ? 'produk' THEN
    IF jsonb_typeof(p_data->'produk') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF jsonb_array_length(p_data->'produk')>20 THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    FOR pr IN SELECT value FROM jsonb_array_elements(p_data->'produk') LOOP
      IF jsonb_typeof(pr) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(pr) x WHERE x NOT IN
        ('nama','keterangan','kapasitas_jumlah','kapasitas_satuan','kapasitas_periode','foto'))
        OR jsonb_typeof(pr->'nama') IS DISTINCT FROM 'string' OR length(btrim(pr->>'nama')) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      FOR k,maks IN SELECT * FROM (VALUES ('keterangan',500),('kapasitas_satuan',20),('kapasitas_periode',10)) x(k,m) LOOP
        IF pr->>k IS NOT NULL AND (jsonb_typeof(pr->k)<>'string' OR length(pr->>k)>maks) THEN
          RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      END LOOP;
      IF pr->>'kapasitas_jumlah' IS NOT NULL OR nullif(btrim(pr->>'kapasitas_satuan'),'') IS NOT NULL
        OR pr->>'kapasitas_periode' IS NOT NULL THEN
        IF jsonb_typeof(pr->'kapasitas_jumlah') IS DISTINCT FROM 'number'
          OR coalesce(length(btrim(pr->>'kapasitas_satuan')),0) NOT BETWEEN 1 AND 20
          OR coalesce(pr->>'kapasitas_periode','') NOT IN ('hari','minggu','bulan','tahun') THEN
          RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
        IF (pr->>'kapasitas_jumlah')::numeric NOT BETWEEN 0.01 AND 1e9
          OR (pr->>'kapasitas_jumlah')::numeric<>round((pr->>'kapasitas_jumlah')::numeric,2) THEN
          RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
      END IF;
      IF pr->>'foto' IS NOT NULL THEN
        IF jsonb_typeof(pr->'foto') IS DISTINCT FROM 'object' OR (pr->'foto') ? 'utama' THEN
          RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
        fotos := fotos || jsonb_build_array(pr->'foto');
      END IF;
    END LOOP;
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(fotos) LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(f) x WHERE x NOT IN ('asal','url','r2_key','utama'))
      OR coalesce(f->>'asal','') NOT IN ('satudata','eksternal','unggahan')
      OR (f->>'url' IS NOT NULL AND jsonb_typeof(f->'url')<>'string')
      OR (f->>'r2_key' IS NOT NULL AND jsonb_typeof(f->'r2_key')<>'string')
      OR (f ? 'utama' AND jsonb_typeof(f->'utama') IS DISTINCT FROM 'boolean') THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF f->>'asal'='unggahan' THEN
      v := f->>'r2_key';
      IF v IS NULL OR length(v)>310 OR v !~ '^umkm-draf/[A-Za-z0-9_./-]+$'
        OR v ~ '(^|/)([.][.]?|)(/|$)' OR f->>'url' IS NOT NULL THEN
        RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    ELSIF f->>'r2_key' IS NOT NULL OR NOT umkm_private.url_foto_sah(f->>'url') THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION umkm_private.peringatan(p_revisi_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(k), '[]'::jsonb) FROM (
    SELECT k FROM public.umkm_revisi r CROSS JOIN LATERAL
      (VALUES ('nama',r.nama),('deskripsi',r.deskripsi),('jenis',r.jenis),('kategori',r.kategori),('spesifik',
        r.spesifik),('kabupaten_kota',r.kabupaten_kota),('kecamatan',r.kecamatan),('instagram',r.instagram),('tiktok',r.tiktok)) v(k,t)
      WHERE r.id = p_revisi_id AND umkm_private.ada_kontak(t)
    UNION ALL SELECT 'produk' WHERE EXISTS (SELECT 1 FROM public.umkm_produk p WHERE p.revisi_id=p_revisi_id
      AND (umkm_private.ada_kontak(p.nama) OR umkm_private.ada_kontak(p.keterangan)
        OR umkm_private.ada_kontak(p.kapasitas_satuan) OR umkm_private.ada_kontak(p.kapasitas_jumlah::text)))
    UNION ALL SELECT 'foto' WHERE EXISTS (
      SELECT 1 FROM public.umkm_foto f WHERE f.revisi_id = p_revisi_id AND NOT f.tersembunyi AND
        umkm_private.ada_kontak(f.url))
  ) d
$$;
REVOKE ALL ON FUNCTION umkm_private.kategori_sah(text,text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.kabupaten_sah(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.label_omzet(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.skala_dari_omzet(text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.validasi(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.peringatan(uuid) FROM PUBLIC, anon, authenticated, service_role;
