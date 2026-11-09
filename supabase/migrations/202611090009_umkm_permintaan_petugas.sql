-- Petugas memutuskan, FO mengawasi tanpa nomor, bantuan tertaut sekali dan retensi menjaga hitungan.
CREATE FUNCTION umkm_private.tugas_permintaan(p public.umkm_permintaan_kontak) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'jenis','permintaan','nama','Permintaan kontak','profil_id',p.profil_id,
    'profil_nama',umkm_private.teks_pengawasan(r.nama,'Profil UMKM'),'status',p.status,'versi',p.versi,
    'mendesak',p.tahan_darurat,'petugas_id',p.petugas_id,'petugas_nama',s.nama,
    'dibuat_pada',p.dibuat_pada,'kode',p.kode)
    FROM public.umkm_profil u LEFT JOIN public.umkm_revisi r ON r.id=u.revisi_disetujui_id
    LEFT JOIN public.petugas s ON s.id=p.petugas_id WHERE u.id=p.profil_id
$$;
CREATE FUNCTION public.umkm_detail_permintaan(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; r public.umkm_permintaan_kontak; hasil jsonb;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT umkm_private.tugas_permintaan(r)||jsonb_build_object('kebutuhan',umkm_private.kebutuhan_json(k),
    'perusahaan',umkm_private.perusahaan_json(c),'pemohon',jsonb_build_object(
      'nama',CASE WHEN r.pemohon_uid IS NULL THEN coalesce(r.nama_bantuan,'Pemohon') ELSE g.nama END,
      'hp',CASE WHEN r.pemohon_uid IS NULL THEN r.kontak_bantuan ELSE g.no_hp END,
      'email',CASE WHEN r.pemohon_uid IS NOT NULL THEN g.email END),
    'bantuan',CASE WHEN r.sumber='petugas' AND r.nama_bantuan IS NOT NULL AND r.kontak_bantuan IS NOT NULL
      THEN jsonb_build_object('nama',r.nama_bantuan,'kontak',r.kontak_bantuan) END,
    'tertaut',r.pemohon_uid IS NOT NULL,'dipegang_saya',coalesce(r.petugas_id=a.id,false),
    'pemeriksa_nama',a.nama,'profil_versi',p.versi,'kontak_ada',p.kontak_terakhir_id IS NOT NULL,
    'izin_ada',coalesce((SELECT i.status='diberikan' FROM public.umkm_izin i
      WHERE i.profil_id=p.id AND i.kontak_versi_id=p.kontak_terakhir_id
      ORDER BY i.dibuat_pada DESC,i.id DESC LIMIT 1),false),
    'alasan_tolak',r.alasan_tolak,'pembukaan',CASE WHEN b.id IS NOT NULL THEN jsonb_build_object(
      'id',b.id,'dibuat_pada',b.dibuat_pada,'hasil',b.hasil,'petugas_nama',s.nama) END)
    INTO hasil FROM public.umkm_kebutuhan k JOIN public.umkm_perusahaan c ON c.id=k.perusahaan_id
    JOIN public.umkm_profil p ON p.id=r.profil_id
    LEFT JOIN public.pengunjung g ON g.auth_user_id=r.pemohon_uid
    LEFT JOIN public.umkm_pembukaan_nomor b ON b.permintaan_id=r.id
    LEFT JOIN public.petugas s ON s.id=b.petugas_id WHERE k.id=r.kebutuhan_id;
  RETURN hasil;
END $$;
CREATE FUNCTION umkm_private.mutasi_permintaan(p_id uuid,p_expected_version integer,p_operasi_id uuid,
  p_aksi text,p_alasan text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; r public.umkm_permintaan_kontak; p public.umkm_profil; i public.umkm_izin;
  k public.umkm_kebutuhan; lama public.umkm_riwayat; h text; hasil jsonb; status_lama text; buka uuid;
BEGIN
  IF p_aksi='tahan' THEN
    SELECT * INTO a FROM public.petugas WHERE auth_user_id=auth.uid();
    IF a.role IN ('admin','front_office') THEN a := umkm_private.aktor_pengawasan();
    ELSE a := umkm_private.aktor(); END IF;
  ELSE a := umkm_private.aktor(); END IF;
  IF p_id IS NULL OR p_operasi_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
    OR p_aksi IS NULL OR p_aksi NOT IN ('ambil','setujui','tolak','tahan','lepas_tahan') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF p_aksi IN ('tolak','tahan') AND (p_alasan IS NULL OR length(btrim(p_alasan)) NOT BETWEEN 1 AND 240
    OR umkm_private.ada_kontak(p_alasan)) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('permintaan',p_id,p_expected_version,p_aksi,p_alasan));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  SELECT t.* INTO k FROM public.umkm_kebutuhan t JOIN public.umkm_permintaan_kontak q ON q.kebutuhan_id=t.id
    WHERE q.id=p_id FOR SHARE OF t;
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF r.versi<>p_expected_version THEN RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
  IF p_aksi NOT IN ('ambil','tahan') AND r.petugas_id IS DISTINCT FROM a.id THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  status_lama := r.status;
  IF p_aksi='ambil' THEN
    IF r.status NOT IN ('diajukan','menunggu_izin','nomor_dibuka') AND NOT r.tahan_darurat THEN
      RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    r.petugas_id := a.id;
  ELSIF p_aksi='tahan' THEN
    IF r.status NOT IN ('diajukan','menunggu_izin','nomor_dibuka') THEN
      RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    r.tahan_darurat := true;
  ELSIF p_aksi='lepas_tahan' THEN r.tahan_darurat := false;
  ELSE
    IF r.status NOT IN ('diajukan','menunggu_izin') OR k.status<>'aktif' THEN
      RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    IF p_aksi='tolak' THEN r.status := 'ditolak'; r.alasan_tolak := btrim(p_alasan);
      r.ditutup_pada := clock_timestamp();
    ELSE
      IF r.pemohon_uid IS NULL OR NOT EXISTS (
        SELECT 1 FROM auth.users WHERE id=r.pemohon_uid AND NOT coalesce(is_anonymous,false)) THEN
        RAISE EXCEPTION 'BELUM_TERTAUT' USING ERRCODE='40001'; END IF;
      SELECT * INTO p FROM public.umkm_profil WHERE id=r.profil_id FOR UPDATE;
      IF p.status<>'terbit' OR r.tahan_darurat THEN
        RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
      SELECT * INTO i FROM public.umkm_izin WHERE profil_id=p.id AND kontak_versi_id=p.kontak_terakhir_id
        ORDER BY dibuat_pada DESC,id DESC LIMIT 1;
      IF p.kontak_terakhir_id IS NULL OR i.id IS NULL OR i.status<>'diberikan' THEN
        r.status := 'menunggu_izin';
      ELSE
        r.status := 'nomor_dibuka';
        INSERT INTO public.umkm_pembukaan_nomor(permintaan_id,pemohon_uid,kontak_versi_id,izin_id,petugas_id)
          VALUES(r.id,r.pemohon_uid,p.kontak_terakhir_id,i.id,a.id) RETURNING id INTO buka;
        UPDATE public.umkm_perusahaan SET diperiksa_oleh=a.id,diperiksa_pada=clock_timestamp()
          WHERE id=k.perusahaan_id AND diperiksa_pada IS NULL;
      END IF;
    END IF;
  END IF;
  UPDATE public.umkm_permintaan_kontak SET status=r.status,petugas_id=r.petugas_id,tahan_darurat=r.tahan_darurat,
    alasan_tolak=r.alasan_tolak,ditutup_pada=r.ditutup_pada,versi=versi+1,aktivitas_pada=clock_timestamp()
    WHERE id=r.id RETURNING * INTO r;
  SELECT id INTO buka FROM public.umkm_pembukaan_nomor WHERE permintaan_id=r.id;
  hasil := jsonb_build_object('id',r.id,'jenis','permintaan','status',r.status,'versi',r.versi,
    'tahan_darurat',r.tahan_darurat,'pembukaan_id',buka);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,
    alasan,operasi_id,payload_hash,hasil,referensi)
    VALUES(r.id,'permintaan',p_aksi,a.id,a.role,status_lama,r.status,btrim(p_alasan),p_operasi_id,h,hasil,
      jsonb_build_object('profil_id',r.profil_id,'pembukaan_id',buka));
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_setujui_dan_buka(p_id uuid,p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_permintaan(p_id,p_expected_version,p_operasi_id,'setujui')
$$;
CREATE FUNCTION public.umkm_tolak_permintaan(p_id uuid,p_expected_version integer,p_operasi_id uuid,p_alasan text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_permintaan(p_id,p_expected_version,p_operasi_id,'tolak',p_alasan)
$$;
CREATE FUNCTION public.umkm_tahan_permintaan(p_id uuid,p_alasan text,p_expected_version integer,p_operasi_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_permintaan(p_id,p_expected_version,p_operasi_id,'tahan',p_alasan)
$$;
CREATE FUNCTION public.umkm_lepas_tahan(p_id uuid,p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_permintaan(p_id,p_expected_version,p_operasi_id,'lepas_tahan')
$$;
CREATE OR REPLACE FUNCTION public.umkm_ambil_pekerjaan(p_jenis text,p_id uuid,p_expected_version integer,
  p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_jenis='permintaan' THEN
    RETURN umkm_private.mutasi_permintaan(p_id,p_expected_version,p_operasi_id,'ambil'); END IF;
  RETURN umkm_private.mutasi_pekerjaan(p_jenis,p_id,p_expected_version,p_operasi_id,'ambil');
END $$;
CREATE FUNCTION public.umkm_bantu_permintaan(p_nama_perusahaan text,p_jabatan text,p_nama_pemohon text,
  p_kontak text,p_teks text,p_kategori text,p_kabupaten_kota text,p_profil_id uuid,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; lama public.umkm_riwayat; h text; hasil jsonb; c uuid; k uuid;
  r public.umkm_permintaan_kontak; kode text := ''; alfabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  acak bytea; n integer;
BEGIN
  a := umkm_private.aktor();
  IF p_operasi_id IS NULL OR p_profil_id IS NULL OR p_nama_perusahaan IS NULL OR p_jabatan IS NULL
    OR p_nama_pemohon IS NULL OR p_kontak IS NULL OR p_kontak !~ '^\+?[0-9]{8,20}$'
    OR length(btrim(p_nama_perusahaan)) NOT BETWEEN 1 AND 200
    OR length(btrim(p_jabatan)) NOT BETWEEN 1 AND 200 OR length(btrim(p_nama_pemohon)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('bantu',p_nama_perusahaan,p_jabatan,p_nama_pemohon,p_kontak,
    p_teks,p_kategori,p_kabupaten_kota,p_profil_id));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil||jsonb_build_object('kode_tautan',NULL);
  END IF;
  PERFORM umkm_private.validasi_kebutuhan(p_teks,p_kategori,p_kabupaten_kota);
  PERFORM 1 FROM public.umkm_profil WHERE id=p_profil_id AND status='terbit' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  acak := extensions.gen_random_bytes(12);
  FOR n IN 0..11 LOOP kode := kode||substr(alfabet,1+get_byte(acak,n)%length(alfabet),1); END LOOP;
  INSERT INTO public.umkm_perusahaan(nama,jabatan) VALUES(btrim(p_nama_perusahaan),btrim(p_jabatan))
    RETURNING id INTO c;
  INSERT INTO public.umkm_kebutuhan(perusahaan_id,teks,kategori,kabupaten_kota)
    VALUES(c,btrim(p_teks),p_kategori,nullif(btrim(p_kabupaten_kota),'')) RETURNING id INTO k;
  INSERT INTO public.umkm_permintaan_kontak(kebutuhan_id,profil_id,petugas_id,sumber,nama_bantuan,
    kontak_bantuan,tautan_hash) VALUES(k,p_profil_id,a.id,'petugas',btrim(p_nama_pemohon),p_kontak,
      encode(extensions.digest(kode,'sha256'),'hex')) RETURNING * INTO r;
  hasil := jsonb_build_object('id',r.id,'kebutuhan_id',k,'kode',r.kode,'status',r.status,'versi',r.versi);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_baru,operasi_id,payload_hash,
    hasil,referensi) VALUES(r.id,'permintaan','bantu',a.id,a.role,r.status,p_operasi_id,h,hasil,
      jsonb_build_object('profil_id',p_profil_id));
  RETURN hasil||jsonb_build_object('kode_tautan',substr(kode,1,4)||'-'||substr(kode,5,4)||'-'||substr(kode,9,4));
END $$;
CREATE FUNCTION public.umkm_catat_pemberitahuan(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; r public.umkm_permintaan_kontak;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF r.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,referensi)
    VALUES(r.id,'permintaan','pemberitahuan',a.id,a.role,r.status,r.status,
      jsonb_build_object('profil_id',r.profil_id));
  RETURN '{"dicatat":true}'::jsonb;
END $$;
CREATE FUNCTION public.umkm_catat_hasil(p_id uuid,p_hasil text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; r public.umkm_permintaan_kontak; b public.umkm_pembukaan_nomor;
BEGIN
  a := umkm_private.aktor();
  IF p_hasil IS NULL OR p_hasil NOT IN ('belum_diketahui','kerja_sama','tidak_berlanjut') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF r.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT * INTO b FROM public.umkm_pembukaan_nomor WHERE permintaan_id=r.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  IF b.hasil<>p_hasil THEN
    UPDATE public.umkm_pembukaan_nomor SET hasil=p_hasil WHERE id=b.id;
    INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,referensi)
      VALUES(r.id,'permintaan','hasil',a.id,a.role,r.status,r.status,
        jsonb_build_object('profil_id',r.profil_id,'hasil',p_hasil));
  END IF;
  RETURN jsonb_build_object('id',r.id,'hasil',p_hasil);
END $$;

CREATE OR REPLACE FUNCTION public.umkm_akses_kontak_petugas(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; permintaan uuid; nomor text;
BEGIN
  a := umkm_private.aktor();
  SELECT id INTO permintaan FROM public.umkm_permintaan_kontak WHERE profil_id=p_profil_id
    AND petugas_id=a.id AND status IN ('diajukan','menunggu_izin') ORDER BY id LIMIT 1 FOR SHARE;
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF permintaan IS NULL AND (p.petugas_id IS DISTINCT FROM a.id OR NOT (p.mendesak OR EXISTS (
    SELECT 1 FROM public.umkm_revisi r WHERE r.id=p.revisi_terakhir_id AND r.keputusan IS NULL))) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT k.nomor INTO nomor FROM public.umkm_kontak_versi k WHERE k.id=p.kontak_terakhir_id;
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,referensi)
    VALUES(p.id,'profil','akses_kontak',a.id,a.role,p.status,p.status,
      jsonb_build_object('profil_id',p.id,'kontak_versi_id',p.kontak_terakhir_id,'permintaan_id',permintaan));
  RETURN jsonb_build_object('nomor',nomor);
END $$;
CREATE OR REPLACE FUNCTION public.umkm_ubah_izin(p_profil_id uuid,p_expected_version integer,
  p_operasi_id uuid,p_status text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; permintaan uuid; lama public.umkm_riwayat; h text; hasil jsonb;
BEGIN
  a := umkm_private.aktor();
  IF p_operasi_id IS NULL OR p_profil_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
    OR p_status IS NULL OR p_status NOT IN ('diberikan','dicabut') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_object('aksi','izin','params',jsonb_build_object(
    'profil_id',p_profil_id,'expected_version',p_expected_version,'status',p_status)));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  SELECT id INTO permintaan FROM public.umkm_permintaan_kontak WHERE profil_id=p_profil_id
    AND petugas_id=a.id AND status IN ('diajukan','menunggu_izin') ORDER BY id LIMIT 1 FOR SHARE;
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.versi<>p_expected_version THEN RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
  IF p.petugas_id IS DISTINCT FROM a.id AND permintaan IS NULL THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  IF p.kontak_terakhir_id IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,aktor_id,dibuat_pada)
    VALUES(p.id,p.kontak_terakhir_id,p_status,a.id,clock_timestamp());
  UPDATE public.umkm_profil SET versi=versi+1 WHERE id=p.id RETURNING * INTO p;
  hasil := jsonb_build_object('id',p.id,'versi',p.versi,'status',p.status,'revisi_id',p.revisi_terakhir_id,
    'peringatan_kontak',umkm_private.peringatan(p.revisi_terakhir_id));
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,
    operasi_id,payload_hash,hasil,referensi) VALUES(p.id,'profil','izin',a.id,a.role,p.status,p.status,
      p_operasi_id,h,hasil,jsonb_build_object('profil_id',p.id,'revisi_id',p.revisi_terakhir_id,
        'kontak_versi_id',p.kontak_terakhir_id,'status_izin',p_status,'permintaan_id',permintaan));
  RETURN hasil;
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.umkm_detail_permintaan(uuid),public.umkm_setujui_dan_buka(uuid,integer,uuid),
  public.umkm_tolak_permintaan(uuid,integer,uuid,text),public.umkm_tahan_permintaan(uuid,text,integer,uuid),
  public.umkm_lepas_tahan(uuid,integer,uuid),
  public.umkm_bantu_permintaan(text,text,text,text,text,text,text,uuid,uuid),
  public.umkm_catat_pemberitahuan(uuid),public.umkm_catat_hasil(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_detail_permintaan(uuid),public.umkm_setujui_dan_buka(uuid,integer,uuid),
  public.umkm_tolak_permintaan(uuid,integer,uuid,text),public.umkm_tahan_permintaan(uuid,text,integer,uuid),
  public.umkm_lepas_tahan(uuid,integer,uuid),
  public.umkm_bantu_permintaan(text,text,text,text,text,text,text,uuid,uuid),
  public.umkm_catat_pemberitahuan(uuid),public.umkm_catat_hasil(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.umkm_daftar_tugas(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c jsonb; hasil jsonb; berikut text;
BEGIN
  PERFORM umkm_private.aktor();
  c := umkm_private.baca_cursor(p_cursor,'tugas');
  WITH profil AS MATERIALIZED (
    SELECT p.id,'profil'::text jenis,NOT p.mendesak biasa,p.dibuat_pada waktu
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_terakhir_id
    WHERE (r.keputusan IS NULL OR p.mendesak) AND (c IS NULL OR
      (NOT p.mendesak,p.dibuat_pada,'profil',p.id)>
      ((c->>'biasa')::boolean,(c->>'waktu')::timestamptz,c->>'jenis',(c->>'id')::uuid))
    ORDER BY NOT p.mendesak,p.dibuat_pada,p.id LIMIT 21
  ), pesan AS MATERIALIZED (
    SELECT p.id,'pesan'::text jenis,true biasa,p.dibuat_pada waktu FROM public.umkm_pesan_kontak p
    WHERE p.status='baru' AND (c IS NULL OR (true,p.dibuat_pada,'pesan',p.id)>
      ((c->>'biasa')::boolean,(c->>'waktu')::timestamptz,c->>'jenis',(c->>'id')::uuid))
    ORDER BY p.dibuat_pada,p.id LIMIT 21
  ), laporan AS MATERIALIZED (
    SELECT p.id,'laporan'::text jenis,NOT (p.alasan IN ('penipuan','nomor_tampil')) biasa,p.dibuat_pada waktu
    FROM public.umkm_laporan p WHERE p.status='baru' AND (c IS NULL OR
      (NOT (p.alasan IN ('penipuan','nomor_tampil')),p.dibuat_pada,'laporan',p.id)>
      ((c->>'biasa')::boolean,(c->>'waktu')::timestamptz,c->>'jenis',(c->>'id')::uuid))
    ORDER BY NOT (p.alasan IN ('penipuan','nomor_tampil')),p.dibuat_pada,p.id LIMIT 21
  ), permintaan AS MATERIALIZED (
    SELECT p.id,'permintaan'::text jenis,NOT p.tahan_darurat biasa,p.dibuat_pada waktu
    FROM public.umkm_permintaan_kontak p
    WHERE (p.status IN ('diajukan','menunggu_izin') OR p.tahan_darurat) AND (c IS NULL OR
      (NOT p.tahan_darurat,p.dibuat_pada,'permintaan',p.id)>
      ((c->>'biasa')::boolean,(c->>'waktu')::timestamptz,c->>'jenis',(c->>'id')::uuid))
    ORDER BY NOT p.tahan_darurat,p.dibuat_pada,p.id LIMIT 21
  ), gabung AS (
    SELECT * FROM profil UNION ALL SELECT * FROM pesan UNION ALL SELECT * FROM laporan
    UNION ALL SELECT * FROM permintaan
  ), halaman AS MATERIALIZED (SELECT * FROM gabung ORDER BY biasa,waktu,jenis,id LIMIT 21),
  nomor AS (SELECT h.*,row_number() OVER (ORDER BY biasa,waktu,jenis,id) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(CASE WHEN jenis='profil' THEN
      (SELECT umkm_private.tugas(p) FROM public.umkm_profil p WHERE p.id=n.id)
      WHEN jenis='permintaan' THEN (SELECT umkm_private.tugas_permintaan(p)
        FROM public.umkm_permintaan_kontak p WHERE p.id=n.id)
      ELSE umkm_private.pekerjaan(jenis,id) END ORDER BY urut) FILTER (WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('tugas',jsonb_build_object(
      'biasa',bool_or(biasa) FILTER (WHERE urut=20),'waktu',max(waktu) FILTER (WHERE urut=20),
      'jenis',max(jenis) FILTER (WHERE urut=20),'id',max(id::text) FILTER (WHERE urut=20))) ELSE NULL END
    INTO hasil,berikut FROM nomor n;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE OR REPLACE FUNCTION public.umkm_cari_profil(p_q text,p_cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; q text; baris jsonb; berikut uuid;
BEGIN
  a := umkm_private.aktor();
  q := btrim(p_q);
  IF q IS NULL OR length(q) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.umkm_permintaan_kontak WHERE kode=upper(q)) THEN
    SELECT coalesce(jsonb_agg(umkm_private.tugas_permintaan(r)),'[]'::jsonb) INTO baris
      FROM public.umkm_permintaan_kontak r WHERE r.kode=upper(q);
    RETURN jsonb_build_object('items',baris,'next_cursor',NULL);
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
CREATE OR REPLACE FUNCTION public.umkm_jejak_pengawasan(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c jsonb; hasil jsonb; berikut text;
BEGIN
  PERFORM umkm_private.aktor_pengawasan();
  c := umkm_private.baca_cursor(p_cursor,'pengawasan');
  WITH halaman AS MATERIALIZED (
    SELECT h.* FROM public.umkm_riwayat h WHERE h.jenis_objek IN ('profil','pesan','laporan','petugas','permintaan')
      AND h.aksi IN ('simpan','ambil','putusan','visibilitas','izin','akses_kontak','atur_pemeriksa',
        'ajukan','setujui','tolak','batal','tautkan','tahan','lepas_tahan','pemberitahuan','hasil','bantu',
        'selesai','darurat_sembunyikan','darurat_catat_pencabutan','selesai_mendesak')
      AND (c IS NULL OR (h.dibuat_pada,h.id)<((c->>'waktu')::timestamptz,(c->>'id')::uuid))
    ORDER BY h.dibuat_pada DESC,h.id DESC LIMIT 21
  ), nomor AS (SELECT h.*,row_number() OVER (ORDER BY h.dibuat_pada DESC,h.id DESC) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'aksi',h.aksi,'peran',
      CASE WHEN h.peran IN ('admin','petugas','front_office') THEN h.peran ELSE 'system' END,
    'aktor_nama',CASE WHEN h.aktor_uid IS NOT NULL THEN 'Pemohon'
      ELSE umkm_private.teks_pengawasan(s.nama,'Petugas') END,'dibuat_pada',h.dibuat_pada,
    'status_lama',CASE WHEN h.status_lama IN ('diajukan','terbit','disembunyikan','ditolak','baru','ditangani',
      'menunggu_izin','nomor_dibuka','dibatalkan')
      THEN h.status_lama ELSE NULL END,
    'status_baru',CASE WHEN h.status_baru IN ('diajukan','terbit','disembunyikan','ditolak','baru','ditangani',
      'menunggu_izin','nomor_dibuka','dibatalkan')
      THEN h.status_baru ELSE NULL END,
    'alasan',CASE WHEN h.jenis_objek<>'permintaan' THEN umkm_private.teks_pengawasan(h.alasan,NULL) END,
    'profil_id',p.id,
    'profil_nama',umkm_private.teks_pengawasan(r.nama,'Profil belum terbit'),
    'permintaan_id',t.id,'permintaan_versi',t.versi,'permintaan_kode',t.kode,'permintaan_status',t.status)
    ORDER BY h.urut) FILTER (WHERE h.urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('pengawasan',jsonb_build_object(
      'waktu',max(h.dibuat_pada) FILTER (WHERE h.urut=20),'id',max(h.id::text) FILTER (WHERE h.urut=20))) ELSE NULL END
    INTO hasil,berikut FROM nomor h LEFT JOIN public.petugas s ON s.id=h.aktor_id
    LEFT JOIN public.umkm_permintaan_kontak t ON h.jenis_objek='permintaan' AND t.id=h.objek_id
    LEFT JOIN public.umkm_profil p ON p.id=CASE WHEN h.jenis_objek='profil' THEN h.objek_id ELSE t.profil_id END
    LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE OR REPLACE FUNCTION public.umkm_ringkasan_pengawasan() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE hasil jsonb;
BEGIN
  PERFORM umkm_private.aktor_pengawasan();
  WITH profil AS (
    SELECT count(*) FILTER (WHERE p.status='diajukan') diajukan,count(*) FILTER (WHERE p.status='terbit') terbit,
      count(*) FILTER (WHERE p.status='disembunyikan') disembunyikan,count(*) FILTER (WHERE p.status='ditolak') ditolak,
      count(*) FILTER (WHERE r.keputusan IS NULL OR p.mendesak) terbuka,
      count(*) FILTER (WHERE p.mendesak) mendesak
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_terakhir_id
  ), pesan AS (
    SELECT count(*) FILTER (WHERE status='baru') baru,count(*) FILTER (WHERE status='ditangani') ditangani,
      avg(extract(epoch FROM dibalas_pada-dibuat_pada)) FILTER (WHERE dibalas_pada>=dibuat_pada) rata
    FROM public.umkm_pesan_kontak
  ), laporan AS (
    SELECT count(*) FILTER (WHERE status='baru') terbuka,
      count(*) FILTER (WHERE status='baru' AND alasan IN ('penipuan','nomor_tampil')) mendesak FROM public.umkm_laporan
  ), durasi AS (
    SELECT avg(extract(epoch FROM h.dibuat_pada-r.dibuat_pada)) rata FROM public.umkm_riwayat h
    JOIN public.umkm_revisi r ON r.id=(h.referensi->>'revisi_id')::uuid
    WHERE h.jenis_objek='profil' AND h.aksi='putusan' AND h.dibuat_pada>=r.dibuat_pada
  ) SELECT jsonb_build_object('profil',jsonb_build_object('diajukan',p.diajukan,'terbit',p.terbit,
    'disembunyikan',p.disembunyikan,'ditolak',p.ditolak),'tugas_terbuka',p.terbuka+m.baru+l.terbuka,
    'mendesak',p.mendesak+l.mendesak,'pesan',jsonb_build_object('baru',m.baru,'ditangani',m.ditangani),
    'laporan_terbuka',l.terbuka,'rata_pemeriksaan_detik',d.rata,'rata_balasan_pertama_detik',m.rata)
    INTO hasil FROM profil p CROSS JOIN pesan m CROSS JOIN laporan l CROSS JOIN durasi d;
  hasil := hasil||umkm_private.ringkasan_permintaan();
  hasil := hasil||jsonb_build_object('tugas_terbuka',(hasil->>'tugas_terbuka')::bigint+
    (SELECT count(*) FROM public.umkm_permintaan_kontak
      WHERE status IN ('diajukan','menunggu_izin') OR tahan_darurat),
    'mendesak',(hasil->>'mendesak')::bigint+
      (SELECT count(*) FROM public.umkm_permintaan_kontak WHERE tahan_darurat));
  RETURN hasil;
END $$;
CREATE OR REPLACE FUNCTION umkm_private.laporan_statistik(p_cursor text,p_ekspor boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; aktif boolean; c jsonb; hasil jsonb; berikut text; daftar jsonb;
  batas integer := CASE WHEN p_ekspor THEN 10000 ELSE 20 END;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  SELECT p.* INTO a FROM public.petugas p WHERE p.auth_user_id=auth.uid() AND p.aktif;
  IF a.id IS NULL OR NOT public.sesi_valid() OR coalesce(auth.jwt()->>'is_anonymous','false')='true'
    OR EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND is_anonymous)
    OR NOT (a.role='admin' OR (a.role='petugas' AND a.pemeriksa_umkm)) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT telemetri_opsional_aktif INTO aktif FROM umkm_private.statistik WHERE tunggal;
  c := umkm_private.baca_cursor(p_cursor,'laporan-statistik');
  IF c IS NOT NULL AND (c->>'aktif')::boolean IS DISTINCT FROM aktif THEN
    RAISE EXCEPTION 'SNAPSHOT_BERUBAH' USING ERRCODE='40001'; END IF;
  WITH halaman AS MATERIALIZED (
    SELECT p.id,umkm_private.teks_pengawasan(r.nama,'Profil belum terbit') nama,
      coalesce(t.suka,0) suka,CASE WHEN aktif THEN coalesce(t.dilihat,0) ELSE NULL END dilihat,
      CASE WHEN aktif THEN coalesce(t.klik_formulir,0) ELSE NULL END klik_formulir,
      CASE WHEN aktif THEN coalesce(t.dilihat,0) ELSE coalesce(t.suka,0) END nilai
    FROM public.umkm_profil p LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    LEFT JOIN public.umkm_stat_total t ON t.profil_id=p.id
    WHERE c IS NULL OR (-(CASE WHEN aktif THEN coalesce(t.dilihat,0) ELSE coalesce(t.suka,0) END),p.id)>
      (-(c->>'nilai')::bigint,(c->>'id')::uuid)
    ORDER BY nilai DESC,p.id LIMIT batas+1
  ), nomor AS (
    SELECT h.*,row_number() OVER (ORDER BY nilai DESC,id) n FROM halaman h
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nama',nama,'suka',suka,
      'dilihat',dilihat,'klik_formulir',klik_formulir,'permintaan',
      (SELECT count(*) FROM public.umkm_permintaan_kontak p WHERE p.profil_id=nomor.id))
      ORDER BY n) FILTER(WHERE n<=batas),'[]'::jsonb),
    CASE WHEN count(*)>batas AND NOT p_ekspor THEN umkm_private.buat_cursor('laporan-statistik',
      jsonb_build_object('aktif',aktif,'nilai',max(nilai) FILTER(WHERE n=batas),
        'id',max(id::text) FILTER(WHERE n=batas))) ELSE NULL END INTO daftar,berikut FROM nomor;
  WITH profil AS (
    SELECT count(*) FILTER(WHERE status='diajukan') diajukan,count(*) FILTER(WHERE status='terbit') terbit,
      count(*) FILTER(WHERE status='disembunyikan') disembunyikan,count(*) FILTER(WHERE status='ditolak') ditolak
    FROM public.umkm_profil
  ), pesan AS (
    SELECT count(*) FILTER(WHERE status='baru') baru,count(*) FILTER(WHERE status='ditangani') ditangani
    FROM public.umkm_pesan_kontak
  ), laporan AS (
    SELECT count(*) FILTER(WHERE status='baru') baru,count(*) FILTER(WHERE status='ditangani') ditangani
    FROM public.umkm_laporan
  ), total AS (
    SELECT coalesce(sum(suka),0) suka,coalesce(sum(dilihat),0) dilihat FROM public.umkm_stat_total
  ), kelompok AS (
    SELECT hari,kategori,kabupaten_kota,jumlah FROM public.umkm_stat_tanpa_hasil
    WHERE aktif ORDER BY hari DESC,kategori,kabupaten_kota LIMIT CASE WHEN p_ekspor THEN 5000 ELSE 20 END
  ) SELECT public.umkm_statistik_status() || jsonb_build_object(
    'profil',to_jsonb(p),'suka',t.suka,'dilihat',CASE WHEN aktif THEN t.dilihat ELSE NULL END,
    'tanpa_hasil',CASE WHEN aktif THEN coalesce((SELECT sum(jumlah) FROM public.umkm_stat_tanpa_hasil),0)
      +coalesce((SELECT sum(tanpa_hasil) FROM public.umkm_stat_bulanan),0) ELSE NULL END,
    'pesan',to_jsonb(m),'laporan',to_jsonb(l),'profil_statistik',daftar,'next_cursor',berikut,
    'kelompok_tanpa_hasil',coalesce((SELECT jsonb_agg(to_jsonb(k)
      ORDER BY hari DESC,kategori,kabupaten_kota) FROM kelompok k),'[]'::jsonb))
    INTO hasil FROM profil p CROSS JOIN pesan m CROSS JOIN laporan l CROSS JOIN total t;
  RETURN hasil||umkm_private.ringkasan_permintaan()||jsonb_build_object('hasil',
    (SELECT jsonb_build_object('belum_diketahui',count(*) FILTER(WHERE b.hasil='belum_diketahui'),
      'kerja_sama',count(*) FILTER(WHERE b.hasil='kerja_sama'),
      'tidak_berlanjut',count(*) FILTER(WHERE b.hasil='tidak_berlanjut')) FROM public.umkm_pembukaan_nomor b));
END $$;


CREATE FUNCTION umkm_private.ringkasan_permintaan() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('permintaan',jsonb_build_object(
    'diajukan',count(*) FILTER(WHERE r.status='diajukan'),
    'menunggu_izin',count(*) FILTER(WHERE r.status='menunggu_izin'),
    'nomor_dibuka',count(*) FILTER(WHERE r.status='nomor_dibuka'),
    'ditolak',count(*) FILTER(WHERE r.status='ditolak'),
    'dibatalkan',count(*) FILTER(WHERE r.status='dibatalkan')),
    'rata_keputusan_detik',avg(extract(epoch FROM h.waktu-r.dibuat_pada))
      FILTER(WHERE h.waktu>=r.dibuat_pada))
  FROM public.umkm_permintaan_kontak r LEFT JOIN LATERAL (
    SELECT min(dibuat_pada) waktu FROM public.umkm_riwayat WHERE objek_id=r.id AND jenis_objek='permintaan'
      AND aksi IN ('setujui','tolak') AND status_baru IN ('nomor_dibuka','ditolak')
  ) h ON true
$$;
CREATE FUNCTION umkm_private.tanggal_retensi_permintaan(r public.umkm_permintaan_kontak) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT least(r.ditutup_pada,(SELECT min(i.dibuat_pada) FROM public.umkm_pembukaan_nomor b
    JOIN public.umkm_izin i ON i.kontak_versi_id=b.kontak_versi_id AND i.status='dicabut'
      AND i.dibuat_pada>=b.dibuat_pada WHERE b.permintaan_id=r.id))
$$;

CREATE OR REPLACE FUNCTION umkm_private.bersihkan_retensi() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE permintaan integer; pesan integer; laporan integer; operasi integer; kejadian integer; harian integer;
  kelompok integer; bulanan integer; hari_wib date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('umkm.retensi',0)) THEN
    RETURN jsonb_build_object('berjalan',true); END IF;
  DELETE FROM public.umkm_pesan_kontak WHERE id IN (
    SELECT id FROM public.umkm_pesan_kontak WHERE coalesce(dibalas_pada,aktivitas_pada)<now()-interval '180 days'
    ORDER BY coalesce(dibalas_pada,aktivitas_pada),id LIMIT 500 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS pesan=ROW_COUNT;
  DELETE FROM public.umkm_laporan WHERE id IN (
    SELECT id FROM public.umkm_laporan WHERE coalesce(selesai_pada,aktivitas_pada)<now()-interval '180 days'
    ORDER BY coalesce(selesai_pada,aktivitas_pada),id LIMIT 500 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS laporan=ROW_COUNT;
  DELETE FROM umkm_private.operasi_publik WHERE (aktor_uid,operasi_id) IN (
    SELECT aktor_uid,operasi_id FROM umkm_private.operasi_publik WHERE dibuat_pada<now()-interval '180 days'
    ORDER BY dibuat_pada,aktor_uid,operasi_id LIMIT 500 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS operasi=ROW_COUNT;
  DELETE FROM public.umkm_stat_kejadian WHERE ctid IN (
    SELECT ctid FROM public.umkm_stat_kejadian WHERE hari<hari_wib-6 ORDER BY hari LIMIT 20000);
  GET DIAGNOSTICS kejadian=ROW_COUNT;
  DELETE FROM public.umkm_stat_harian WHERE (hari,profil_id) IN (
    SELECT hari,profil_id FROM public.umkm_stat_harian WHERE hari<hari_wib-94
    ORDER BY hari,profil_id LIMIT 20000);
  GET DIAGNOSTICS harian=ROW_COUNT;
  -- Hanya baris yang benar-benar dihapus ditambahkan, sehingga retry tidak menggandakan ringkasan.
  WITH hapus AS (
    DELETE FROM public.umkm_stat_tanpa_hasil WHERE (hari,kategori,kabupaten_kota) IN (
      SELECT hari,kategori,kabupaten_kota FROM public.umkm_stat_tanpa_hasil WHERE hari<hari_wib-94
      ORDER BY hari,kategori,kabupaten_kota LIMIT 20000)
    RETURNING hari,kategori,kabupaten_kota,jumlah
  ), ringkas AS (
    INSERT INTO public.umkm_stat_bulanan(bulan,kategori,kabupaten_kota,tanpa_hasil)
    SELECT date_trunc('month',hari)::date,kategori,kabupaten_kota,sum(jumlah)::bigint FROM hapus
    GROUP BY date_trunc('month',hari)::date,kategori,kabupaten_kota
    ON CONFLICT(bulan,kategori,kabupaten_kota) DO UPDATE SET
      tanpa_hasil=umkm_stat_bulanan.tanpa_hasil+excluded.tanpa_hasil RETURNING bulan
  ) SELECT count(*)::integer INTO kelompok FROM hapus;
  DELETE FROM public.umkm_stat_bulanan WHERE ctid IN (
    SELECT ctid FROM public.umkm_stat_bulanan WHERE bulan<date_trunc('month',hari_wib)-interval '23 months'
    ORDER BY bulan LIMIT 20000);
  GET DIAGNOSTICS bulanan=ROW_COUNT;
  WITH calon AS MATERIALIZED (
    SELECT r.id FROM public.umkm_permintaan_kontak r
    WHERE umkm_private.tanggal_retensi_permintaan(r)<now()-interval '730 days'
      AND (r.nama_bantuan IS NOT NULL OR r.kontak_bantuan IS NOT NULL OR r.tautan_hash IS NOT NULL)
    ORDER BY r.ditutup_pada,r.id LIMIT 500 FOR UPDATE OF r SKIP LOCKED
  ), bersih AS (
    UPDATE public.umkm_permintaan_kontak r SET nama_bantuan=NULL,kontak_bantuan=NULL,tautan_hash=NULL
      FROM calon c WHERE r.id=c.id RETURNING r.kebutuhan_id
  ) SELECT count(*) INTO permintaan FROM bersih;
  UPDATE public.umkm_kebutuhan SET teks='' WHERE id IN (
    SELECT k.id FROM public.umkm_kebutuhan k WHERE k.status='ditutup' AND k.teks<>''
      AND k.ditutup_pada<now()-interval '730 days'
      AND NOT EXISTS (SELECT 1 FROM public.umkm_permintaan_kontak r WHERE r.kebutuhan_id=k.id
        AND (umkm_private.tanggal_retensi_permintaan(r) IS NULL
          OR umkm_private.tanggal_retensi_permintaan(r)>=now()-interval '730 days'))
    ORDER BY k.ditutup_pada,k.id LIMIT 500 FOR UPDATE OF k SKIP LOCKED);
  UPDATE public.umkm_perusahaan SET nama='Perusahaan dihapus',jabatan='Dihapus' WHERE id IN (
    SELECT c.id FROM public.umkm_perusahaan c WHERE c.pemohon_uid IS NULL
      AND (c.nama<>'Perusahaan dihapus' OR c.jabatan<>'Dihapus')
      AND NOT EXISTS (SELECT 1 FROM public.umkm_kebutuhan k WHERE k.perusahaan_id=c.id AND k.teks<>'')
      AND greatest(c.dibuat_pada,c.diperiksa_pada,(SELECT max(greatest(
        k.dibuat_pada,k.ditutup_pada,r.aktivitas_pada,r.ditutup_pada))
        FROM public.umkm_kebutuhan k LEFT JOIN public.umkm_permintaan_kontak r ON r.kebutuhan_id=k.id
        WHERE k.perusahaan_id=c.id))<now()-interval '730 days'
    ORDER BY c.dibuat_pada,c.id LIMIT 500 FOR UPDATE OF c SKIP LOCKED);
  RETURN jsonb_build_object('permintaan',permintaan,'pesan',pesan,'laporan',laporan,
    'operasi_publik',operasi,'dedup',kejadian,
    'harian',harian,'tanpa_hasil',kelompok,'bulanan',bulanan);
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC,anon,authenticated,service_role;
