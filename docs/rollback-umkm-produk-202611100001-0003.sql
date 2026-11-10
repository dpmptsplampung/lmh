-- Pulihkan definisi fungsi sebelum produk. Data dan kolom tambahan tetap disimpan.
CREATE OR REPLACE FUNCTION umkm_private.validasi(p_data jsonb) RETURNS void
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

CREATE OR REPLACE FUNCTION umkm_private.peringatan(p_revisi_id uuid) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION umkm_private.mutasi(p_aksi text,p_params jsonb,p_operasi_id uuid) RETURNS jsonb
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

CREATE OR REPLACE FUNCTION umkm_private.mutasi_pemilik(p_aksi text,p_profil_id uuid,p_data jsonb,
  p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; p public.umkm_profil; m public.umkm_pemilik; lama umkm_private.operasi_publik;
  h text; d jsonb; f jsonb; rid uuid; kid uuid; nomor_lama text; hasil jsonb; status_lama text;
BEGIN
  u := umkm_private.akun_suka();
  IF p_operasi_id IS NULL OR p_aksi NOT IN ('daftar','draf','cabut') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  -- Periksa hak terkini sebelum replay supaya hasil lama tidak menghidupkan hak akun.
  IF p_aksi<>'daftar' THEN m := umkm_private.hak_pemilik(p_profil_id,p_aksi='draf'); END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(u::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array(p_aksi,p_profil_id,p_data,p_expected_version));
  SELECT * INTO lama FROM umkm_private.operasi_publik WHERE aktor_uid=u AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  IF p_aksi='daftar' THEN
    INSERT INTO public.umkm_profil(sumber) VALUES('mandiri') RETURNING * INTO p;
    INSERT INTO public.umkm_pemilik(profil_id,akun_uid) VALUES(p.id,u) RETURNING * INTO m;
  ELSE
    SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
    -- Profil yang disembunyikan petugas tidak menerima draf sampai dipulihkan.
    IF p_aksi='draf' AND p.status='disembunyikan' THEN
      RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    IF p_expected_version IS NULL OR p.versi<>p_expected_version THEN
      RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
    status_lama := p.status;
  END IF;
  IF p_aksi IN ('daftar','draf') THEN
    IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR p_data ? 'sumber' OR p_data ? 'sumber_ref' THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    d := p_data||jsonb_build_object('sumber','kurasi');
    PERFORM umkm_private.validasi(d);
    FOR f IN SELECT value FROM jsonb_array_elements(coalesce(d->'foto','[]'::jsonb)) LOOP
      IF f->>'asal'='unggahan' AND (f->>'r2_key' NOT LIKE 'umkm-draf/'||p.id::text||'/%'
        AND NOT EXISTS (SELECT 1 FROM public.umkm_foto foto JOIN public.umkm_revisi r ON r.id=foto.revisi_id
          WHERE r.profil_id=p.id AND foto.r2_key=f->>'r2_key')) THEN
        RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
    END LOOP;
    PERFORM umkm_private.jaga_laju('umkm_permintaan');
    IF p_aksi='draf' THEN
      UPDATE public.umkm_profil SET versi=versi+1,
        status=CASE WHEN status='terbit' THEN 'terbit' ELSE 'diajukan' END
        WHERE id=p.id RETURNING * INTO p;
    END IF;
    INSERT INTO public.umkm_revisi(profil_id,versi,nama,deskripsi,alamat,jenis,kategori,spesifik,
      kabupaten_kota,memiliki_nib,instagram,tiktok,aktor_uid)
      VALUES(p.id,p.versi,btrim(d->>'nama'),btrim(d->>'deskripsi'),d->>'alamat',btrim(d->>'jenis'),
        btrim(d->>'kategori'),d->>'spesifik',btrim(d->>'kabupaten_kota'),(d->>'memiliki_nib')::boolean,
        nullif(btrim(d->>'instagram'),''),nullif(btrim(d->>'tiktok'),''),u) RETURNING id INTO rid;
    IF d ? 'foto' THEN
      INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi)
        SELECT rid,value->>'asal',value->>'url',value->>'r2_key',coalesce((SELECT bool_or(lf.tersembunyi)
          FROM public.umkm_foto lf WHERE lf.revisi_id IN (p.revisi_terakhir_id,p.revisi_disetujui_id)
          AND lf.asal=value->>'asal' AND lf.url IS NOT DISTINCT FROM value->>'url'
          AND lf.r2_key IS NOT DISTINCT FROM value->>'r2_key'),false) FROM jsonb_array_elements(d->'foto');
    ELSIF p.revisi_terakhir_id IS NOT NULL THEN
      INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi)
        SELECT rid,asal,url,r2_key,tersembunyi FROM public.umkm_foto WHERE revisi_id=p.revisi_terakhir_id;
    END IF;
    IF d ? 'nomor' THEN
      SELECT nomor INTO nomor_lama FROM public.umkm_kontak_versi WHERE id=p.kontak_terakhir_id;
      IF nomor_lama IS DISTINCT FROM d->>'nomor' THEN
        IF p.kontak_terakhir_id IS NOT NULL THEN
          INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,sumber,aktor_uid)
            VALUES(p.id,p.kontak_terakhir_id,'dicabut','pemilik',u);
        END IF;
        kid := NULL;
        IF d->>'nomor' IS NOT NULL THEN
          INSERT INTO public.umkm_kontak_versi(profil_id,nomor,aktor_uid)
            VALUES(p.id,d->>'nomor',u) RETURNING id INTO kid;
        END IF;
        p.kontak_terakhir_id := kid;
      END IF;
    END IF;
    UPDATE public.umkm_profil SET revisi_terakhir_id=rid,kontak_terakhir_id=p.kontak_terakhir_id
      WHERE id=p.id RETURNING * INTO p;
  ELSE
    IF p.kontak_terakhir_id IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,sumber,aktor_uid)
      VALUES(p.id,p.kontak_terakhir_id,'dicabut','pemilik',u);
    UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
  END IF;
  hasil := jsonb_build_object('id',p.id,'versi',p.versi,'status',p.status,'revisi_id',p.revisi_terakhir_id,
    'pemilik_id',m.id,'pemilik_status',m.status);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_uid,peran,status_lama,status_baru,referensi)
    VALUES(p.id,'profil',CASE WHEN p_aksi='cabut' THEN 'izin' ELSE 'simpan' END,u,'pemilik',status_lama,p.status,
      jsonb_build_object('revisi_id',p.revisi_terakhir_id,'kontak_versi_id',p.kontak_terakhir_id,
        'status_izin',CASE WHEN p_aksi='cabut' THEN 'dicabut' END));
  INSERT INTO umkm_private.operasi_publik(aktor_uid,operasi_id,aksi,payload_hash,hasil)
    VALUES(u,p_operasi_id,p_aksi,h,hasil);
  RETURN hasil;
END $$;

CREATE OR REPLACE FUNCTION umkm_private.foto_publik(p_revisi_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'url',
    CASE WHEN f.asal='unggahan' THEN f.url_publik ELSE f.url END) ORDER BY f.id),'[]'::jsonb)
  FROM public.umkm_foto f WHERE f.revisi_id=p_revisi_id AND NOT f.tersembunyi AND NOT f.perlu_review
    AND (f.asal IN ('satudata','eksternal') OR (f.r2_key_publik IS NOT NULL AND f.unggah_etag IS NOT NULL))
$$;

CREATE OR REPLACE FUNCTION umkm_private.kartu(p_id uuid) RETURNS jsonb
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
  hasil := hasil||jsonb_build_object('pemilik',(SELECT jsonb_build_object(
    'nama',coalesce(g.nama,'Akun tidak tersedia'),'hp',g.no_hp,'email',g.email)
    FROM public.umkm_revisi r LEFT JOIN public.pengunjung g ON g.auth_user_id=r.aktor_uid
    WHERE r.id=p.revisi_terakhir_id AND r.aktor_uid IS NOT NULL),
    'pemilik_terdaftar',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',o.id,
      'nama',coalesce(g.nama,'Akun tidak tersedia'),'versi',o.versi) ORDER BY o.dibuat_pada,o.id),'[]'::jsonb)
      FROM (SELECT * FROM public.umkm_pemilik WHERE profil_id=p.id AND status='disetujui'
        ORDER BY dibuat_pada,id LIMIT 20) o LEFT JOIN public.pengunjung g ON g.auth_user_id=o.akun_uid));
  RETURN hasil;
END $$;

CREATE OR REPLACE FUNCTION public.umkm_detail_usaha(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; m public.umkm_pemilik; p public.umkm_profil; draf boolean; hasil jsonb;
BEGIN
  u := umkm_private.akun_suka();
  SELECT * INTO m FROM public.umkm_pemilik WHERE profil_id=p_profil_id AND akun_uid=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT * INTO p FROM public.umkm_profil WHERE id=m.profil_id;
  draf := m.status='disetujui' OR (m.status='diajukan' AND p.sumber='mandiri' AND p.terbit_pada IS NULL
    AND EXISTS (SELECT 1 FROM public.umkm_revisi r WHERE r.profil_id=p.id AND r.versi=1 AND r.aktor_uid=u));
  hasil := umkm_private.usaha_json(m)||jsonb_build_object(
    'revisi',CASE WHEN draf THEN (SELECT to_jsonb(r)-'dibuat_oleh'-'aktor_uid' FROM public.umkm_revisi r
      WHERE id=p.revisi_terakhir_id) END,
    'foto',CASE WHEN draf THEN coalesce((SELECT jsonb_agg(to_jsonb(f)-'diperiksa_oleh' ORDER BY id)
      FROM public.umkm_foto f WHERE revisi_id=p.revisi_terakhir_id),'[]'::jsonb) ELSE '[]'::jsonb END,
    'nomor',CASE WHEN m.status='disetujui' THEN (SELECT nomor FROM public.umkm_kontak_versi
      WHERE id=p.kontak_terakhir_id) END,
    'izin_status',CASE WHEN m.status='disetujui' THEN (SELECT i.status FROM public.umkm_izin i
      WHERE i.profil_id=p.id AND i.kontak_versi_id=p.kontak_terakhir_id
      ORDER BY i.dibuat_pada DESC,i.id DESC LIMIT 1) END);
  RETURN hasil;
END $$;
