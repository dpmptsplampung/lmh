-- Semua jalur penyimpanan dan penyalinan revisi menyertakan produk dan foto.
CREATE FUNCTION umkm_private.tulis_revisi(p_profil public.umkm_profil,p_data jsonb,
  p_dibuat_oleh uuid,p_aktor_uid uuid) RETURNS uuid
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE rid uuid; item record; foto jsonb; foto_input jsonb := '[]'::jsonb;
BEGIN
  INSERT INTO public.umkm_revisi(profil_id,versi,nama,deskripsi,alamat,jenis,kategori,spesifik,kabupaten_kota,
    memiliki_nib,instagram,tiktok,dibuat_oleh,aktor_uid,kecamatan,nama_pemilik,bentuk_usaha,tahun_mulai,
    omzet_rentang,tenaga_kerja_rentang)
    VALUES(p_profil.id,p_profil.versi,btrim(p_data->>'nama'),btrim(p_data->>'deskripsi'),p_data->>'alamat',
      btrim(p_data->>'jenis'),btrim(p_data->>'kategori'),p_data->>'spesifik',btrim(p_data->>'kabupaten_kota'),
      (p_data->>'memiliki_nib')::boolean,nullif(btrim(p_data->>'instagram'),''),nullif(btrim(p_data->>'tiktok'),''),
      p_dibuat_oleh,p_aktor_uid,nullif(btrim(p_data->>'kecamatan'),''),nullif(btrim(p_data->>'nama_pemilik'),''),
      nullif(btrim(p_data->>'bentuk_usaha'),''),(p_data->>'tahun_mulai')::numeric::smallint,
      nullif(btrim(p_data->>'omzet_rentang'),''),nullif(btrim(p_data->>'tenaga_kerja_rentang'),'')) RETURNING id INTO rid;
  IF p_data ? 'produk' THEN
    FOR item IN SELECT value,ordinality FROM jsonb_array_elements(p_data->'produk') WITH ORDINALITY LOOP
      INSERT INTO public.umkm_produk(revisi_id,urutan,nama,keterangan,kapasitas_jumlah,kapasitas_satuan,kapasitas_periode)
        VALUES(rid,item.ordinality,btrim(item.value->>'nama'),nullif(btrim(item.value->>'keterangan'),''),
          (item.value->>'kapasitas_jumlah')::numeric,nullif(btrim(item.value->>'kapasitas_satuan'),''),
          item.value->>'kapasitas_periode');
      IF item.value->>'foto' IS NOT NULL THEN
        foto_input := foto_input || jsonb_build_array((item.value->'foto')||jsonb_build_object('produk_urutan',item.ordinality));
      END IF;
    END LOOP;
  ELSE
    INSERT INTO public.umkm_produk(revisi_id,urutan,nama,keterangan,kapasitas_jumlah,kapasitas_satuan,kapasitas_periode)
      SELECT rid,urutan,nama,keterangan,kapasitas_jumlah,kapasitas_satuan,kapasitas_periode
      FROM public.umkm_produk WHERE revisi_id=p_profil.revisi_terakhir_id;
    INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi,utama,produk_urutan)
      SELECT rid,asal,url,r2_key,tersembunyi,utama,produk_urutan FROM public.umkm_foto
      WHERE revisi_id=p_profil.revisi_terakhir_id AND produk_urutan IS NOT NULL;
  END IF;
  IF p_data ? 'foto' THEN
    foto_input := foto_input || (p_data->'foto');
  ELSE
    INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi,utama,produk_urutan)
      SELECT rid,asal,url,r2_key,tersembunyi,utama,produk_urutan FROM public.umkm_foto
      WHERE revisi_id=p_profil.revisi_terakhir_id AND produk_urutan IS NULL;
  END IF;
  FOR foto IN SELECT value FROM jsonb_array_elements(foto_input) LOOP
    INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi,utama,produk_urutan)
      SELECT rid,foto->>'asal',foto->>'url',foto->>'r2_key',coalesce((SELECT bool_or(lf.tersembunyi)
        FROM public.umkm_foto lf WHERE lf.revisi_id IN (p_profil.revisi_terakhir_id,p_profil.revisi_disetujui_id)
          AND lf.asal=foto->>'asal' AND lf.url IS NOT DISTINCT FROM foto->>'url'
          AND lf.r2_key IS NOT DISTINCT FROM foto->>'r2_key'),false),
        coalesce((foto->>'utama')::boolean,false),(foto->>'produk_urutan')::smallint;
  END LOOP;
  RETURN rid;
END $$;

CREATE FUNCTION umkm_private.salin_revisi(p_revisi_lama uuid,p_versi integer,p_dibuat_oleh uuid,
  p_foto_tampil uuid DEFAULT NULL) RETURNS uuid
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE rid uuid;
BEGIN
  INSERT INTO public.umkm_revisi(profil_id,versi,nama,deskripsi,alamat,jenis,kategori,spesifik,kabupaten_kota,
    memiliki_nib,instagram,tiktok,dibuat_oleh,kecamatan,nama_pemilik,bentuk_usaha,tahun_mulai,omzet_rentang,tenaga_kerja_rentang)
    SELECT profil_id,p_versi,nama,deskripsi,alamat,jenis,kategori,spesifik,kabupaten_kota,memiliki_nib,instagram,tiktok,
      p_dibuat_oleh,kecamatan,nama_pemilik,bentuk_usaha,tahun_mulai,omzet_rentang,tenaga_kerja_rentang
    FROM public.umkm_revisi WHERE id=p_revisi_lama RETURNING id INTO rid;
  INSERT INTO public.umkm_produk(revisi_id,urutan,nama,keterangan,kapasitas_jumlah,kapasitas_satuan,kapasitas_periode)
    SELECT rid,urutan,nama,keterangan,kapasitas_jumlah,kapasitas_satuan,kapasitas_periode
    FROM public.umkm_produk WHERE revisi_id=p_revisi_lama;
  INSERT INTO public.umkm_foto(revisi_id,asal,url,r2_key,tersembunyi,utama,produk_urutan)
    SELECT rid,asal,url,r2_key,CASE WHEN id=p_foto_tampil THEN false ELSE tersembunyi END,utama,produk_urutan
    FROM public.umkm_foto WHERE revisi_id=p_revisi_lama;
  RETURN rid;
END $$;

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
      rid := umkm_private.tulis_revisi(p, d, a.id, NULL);
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
          rid := umkm_private.salin_revisi(r.id, p.versi+1, a.id, (p_params->>'foto_id')::uuid);
          UPDATE public.umkm_profil SET revisi_terakhir_id=rid WHERE id=p.id;
        END IF;
        UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
      ELSIF p_params->>'aksi'='sembunyikan' THEN
        UPDATE public.umkm_profil SET status='disembunyikan',versi=versi+1 WHERE id=p.id RETURNING * INTO p;
      ELSE
        IF p.status <> 'disembunyikan' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
        SELECT * INTO r FROM public.umkm_revisi WHERE id=p.revisi_terakhir_id;
        rid := umkm_private.salin_revisi(r.id, p.versi+1, a.id, NULL);
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
    FOR f IN SELECT value FROM jsonb_array_elements(coalesce(d->'foto','[]'::jsonb))
      UNION ALL SELECT value->'foto' FROM jsonb_array_elements(coalesce(d->'produk','[]'::jsonb))
        WHERE value->>'foto' IS NOT NULL LOOP
      IF f->>'asal'='unggahan' AND (f->>'r2_key' NOT LIKE 'umkm-draf/'||p.id::text||'/%'
        AND left(f->>'r2_key',length('umkm-draf/'||u::text||'/')) <> 'umkm-draf/'||u::text||'/'
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
    rid := umkm_private.tulis_revisi(p, d, NULL, u);
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
REVOKE ALL ON FUNCTION umkm_private.tulis_revisi(public.umkm_profil,jsonb,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.salin_revisi(uuid,integer,uuid,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.mutasi(text,jsonb,uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION umkm_private.mutasi_pemilik(text,uuid,jsonb,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
