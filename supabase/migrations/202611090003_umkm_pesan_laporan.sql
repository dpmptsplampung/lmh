-- Pesan dan laporan tahap A: isi privat, receipt tanpa echo, satu penjaga laju dan antrean campuran.
CREATE TABLE public.umkm_pesan_kontak (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profil_id uuid REFERENCES public.umkm_profil(id),
  kata_kunci text CHECK (length(kata_kunci)<=100), nama text NOT NULL CHECK (length(btrim(nama)) BETWEEN 1 AND 200),
  perusahaan text NOT NULL CHECK (length(btrim(perusahaan)) BETWEEN 1 AND 200),
  nomor text NOT NULL CHECK (nomor ~ '^\+?[0-9]{8,20}$'),
  pesan text NOT NULL CHECK (length(btrim(pesan)) BETWEEN 1 AND 1000), aktor_uid uuid NOT NULL,
  status text NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','ditangani')),
  petugas_id uuid REFERENCES public.petugas(id), versi integer NOT NULL DEFAULT 1 CHECK (versi>0),
  dibuat_pada timestamptz NOT NULL DEFAULT now(), aktivitas_pada timestamptz NOT NULL DEFAULT now(),
  dibalas_pada timestamptz
);
CREATE TABLE public.umkm_laporan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  foto_id uuid REFERENCES public.umkm_foto(id),
  alasan text NOT NULL CHECK (alasan IN ('penipuan','nomor_tampil','data_salah','foto_tidak_pantas','lainnya')),
  catatan text CHECK (length(catatan)<=500), aktor_uid uuid NOT NULL,
  status text NOT NULL DEFAULT 'baru' CHECK (status IN ('baru','ditangani')),
  petugas_id uuid REFERENCES public.petugas(id), versi integer NOT NULL DEFAULT 1 CHECK (versi>0),
  dibuat_pada timestamptz NOT NULL DEFAULT now(), aktivitas_pada timestamptz NOT NULL DEFAULT now(),
  selesai_pada timestamptz
);
CREATE TABLE umkm_private.operasi_publik (
  aktor_uid uuid NOT NULL, operasi_id uuid NOT NULL, aksi text NOT NULL, payload_hash text NOT NULL,
  hasil jsonb NOT NULL, dibuat_pada timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (aktor_uid,operasi_id)
);
ALTER TABLE public.umkm_pesan_kontak ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_laporan ENABLE ROW LEVEL SECURITY;
ALTER TABLE umkm_private.operasi_publik ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_pesan_kontak FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON public.umkm_laporan FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON umkm_private.operasi_publik FROM PUBLIC, anon, authenticated, service_role;
CREATE INDEX umkm_pesan_antrean ON public.umkm_pesan_kontak(status,dibuat_pada,id);
CREATE INDEX umkm_pesan_profil ON public.umkm_pesan_kontak(profil_id);
CREATE INDEX umkm_pesan_petugas ON public.umkm_pesan_kontak(petugas_id);
CREATE INDEX umkm_pesan_dibalas ON public.umkm_pesan_kontak(dibalas_pada) WHERE dibalas_pada IS NOT NULL;
CREATE INDEX umkm_laporan_antrean ON public.umkm_laporan
  ((NOT (alasan IN ('penipuan','nomor_tampil'))),dibuat_pada,id) WHERE status='baru';
CREATE UNIQUE INDEX umkm_laporan_kembar ON public.umkm_laporan
  (profil_id,coalesce(foto_id,'00000000-0000-0000-0000-000000000000'::uuid),alasan) WHERE status='baru';
CREATE INDEX umkm_laporan_profil ON public.umkm_laporan(profil_id);
CREATE INDEX umkm_laporan_foto ON public.umkm_laporan(foto_id);
CREATE INDEX umkm_laporan_petugas ON public.umkm_laporan(petugas_id);
CREATE INDEX umkm_operasi_publik_waktu ON umkm_private.operasi_publik(dibuat_pada);
CREATE INDEX umkm_laju_global ON public.anon_rate_limit(action,created_at);

CREATE FUNCTION umkm_private.jaga_laju(p_aksi text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF p_aksi IS NULL OR p_aksi NOT IN ('umkm_pesan','umkm_laporan') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  -- Kunci global menutup perlombaan lintas UID; semua pemanggil memakai urutan yang sama.
  PERFORM pg_advisory_xact_lock(hashtextextended('umkm.laju.' || p_aksi,0));
  IF NOT public.check_anon_rate(p_aksi,10,600)
    OR NOT public.check_anon_rate(p_aksi,30,86400) OR
    (SELECT count(*) FROM public.anon_rate_limit WHERE action=p_aksi
      AND created_at>now()-interval '600 seconds')>=200 THEN
    RAISE EXCEPTION 'TERLALU_BANYAK' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.anon_rate_limit(user_id,action) VALUES(auth.uid(),p_aksi);
END $$;
CREATE FUNCTION umkm_private.kirim_publik(p_aksi text,p_data jsonb,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE h text; lama umkm_private.operasi_publik; hasil jsonb; id_baru uuid; profil uuid; foto uuid;
  nama text; perusahaan text; nomor text; pesan text; alasan text; catatan text; keyword text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF NOT public.sesi_valid() THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  IF p_operasi_id IS NULL OR p_data IS NULL OR p_aksi IS NULL OR p_aksi NOT IN ('umkm_pesan','umkm_laporan') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_object('aksi',p_aksi,'data',p_data));
  SELECT * INTO lama FROM umkm_private.operasi_publik WHERE aktor_uid=auth.uid() AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash IS DISTINCT FROM h THEN
      RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  profil := (p_data->>'profil_id')::uuid;
  IF p_aksi='umkm_pesan' THEN
    nama := btrim(p_data->>'nama'); perusahaan := btrim(p_data->>'perusahaan');
    nomor := regexp_replace(p_data->>'nomor','[[:space:].()\-]','','g');
    pesan := btrim(p_data->>'pesan'); keyword := nullif(btrim(p_data->>'kata_kunci'),'');
    IF nama IS NULL OR length(nama) NOT BETWEEN 1 AND 200 OR perusahaan IS NULL
      OR length(perusahaan) NOT BETWEEN 1 AND 200 OR nomor IS NULL OR nomor !~ '^\+?[0-9]{8,20}$'
      OR pesan IS NULL OR length(pesan) NOT BETWEEN 1 AND 1000 OR length(keyword)>100 THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    -- Konteks yang tidak publik dibuang tanpa membedakan ada atau tidaknya profil.
    SELECT p.id INTO profil FROM public.umkm_profil p WHERE p.id=profil AND p.status='terbit';
    PERFORM umkm_private.jaga_laju(p_aksi);
    INSERT INTO public.umkm_pesan_kontak(profil_id,kata_kunci,nama,perusahaan,nomor,pesan,aktor_uid)
      VALUES(profil,keyword,nama,perusahaan,nomor,pesan,auth.uid()) RETURNING id INTO id_baru;
  ELSE
    alasan := p_data->>'alasan'; catatan := nullif(btrim(p_data->>'catatan'),'');
    foto := (p_data->>'foto_id')::uuid;
    IF profil IS NULL OR alasan IS NULL
      OR alasan NOT IN ('penipuan','nomor_tampil','data_salah','foto_tidak_pantas','lainnya')
      OR length(catatan)>500 THEN RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.umkm_profil p WHERE p.id=profil AND p.status='terbit'
      AND (foto IS NULL OR EXISTS (SELECT 1 FROM public.umkm_foto f WHERE f.id=foto
        AND f.revisi_id=p.revisi_disetujui_id AND NOT f.tersembunyi AND NOT f.perlu_review))) THEN
      RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
    PERFORM umkm_private.jaga_laju(p_aksi);
    INSERT INTO public.umkm_laporan(profil_id,foto_id,alasan,catatan,aktor_uid)
      VALUES(profil,foto,alasan,catatan,auth.uid()) ON CONFLICT DO NOTHING RETURNING id INTO id_baru;
    IF id_baru IS NULL THEN
      SELECT l.id INTO id_baru FROM public.umkm_laporan l WHERE l.profil_id=profil
        AND l.foto_id IS NOT DISTINCT FROM foto AND l.alasan=(p_data->>'alasan') AND l.status='baru';
    END IF;
  END IF;
  hasil := jsonb_build_object('id',id_baru);
  INSERT INTO umkm_private.operasi_publik(aktor_uid,operasi_id,aksi,payload_hash,hasil)
    VALUES(auth.uid(),p_operasi_id,p_aksi,h,hasil);
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_kirim_pesan_kontak(p_nama text,p_perusahaan text,p_nomor text,p_pesan text,
  p_operasi_id uuid,p_profil_id uuid DEFAULT NULL,p_kata_kunci text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.kirim_publik('umkm_pesan',jsonb_build_object('nama',p_nama,'perusahaan',p_perusahaan,
    'nomor',p_nomor,'pesan',p_pesan,'profil_id',p_profil_id,'kata_kunci',p_kata_kunci),p_operasi_id)
$$;
CREATE FUNCTION public.umkm_laporkan(p_profil_id uuid,p_alasan text,p_operasi_id uuid,
  p_foto_id uuid DEFAULT NULL,p_catatan text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.kirim_publik('umkm_laporan',jsonb_build_object('profil_id',p_profil_id,
    'alasan',p_alasan,'foto_id',p_foto_id,'catatan',p_catatan),p_operasi_id)
$$;

CREATE FUNCTION umkm_private.pekerjaan(p_jenis text,p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',x.id,'jenis',p_jenis,'nama',CASE WHEN p_jenis='pesan'
      THEN 'Pesan masuk' ELSE 'Laporan profil' END,'status',x.status,'versi',x.versi,
    'mendesak',p_jenis='laporan' AND x.status='baru' AND x.alasan IN ('penipuan','nomor_tampil'),
    'dibuat_pada',x.dibuat_pada,'petugas_id',x.petugas_id,'petugas_nama',s.nama,
    'profil_id',x.profil_id,'profil_nama',r.nama,'alasan',x.alasan)
  FROM (
    SELECT id,status,versi,dibuat_pada,petugas_id,profil_id,NULL::text alasan
    FROM public.umkm_pesan_kontak WHERE p_jenis='pesan' AND id=p_id
    UNION ALL
    SELECT id,status,versi,dibuat_pada,petugas_id,profil_id,alasan
    FROM public.umkm_laporan WHERE p_jenis='laporan' AND id=p_id
  ) x LEFT JOIN public.petugas s ON s.id=x.petugas_id
  LEFT JOIN public.umkm_profil p ON p.id=x.profil_id
  LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
$$;
CREATE FUNCTION public.umkm_detail_pesan(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_pesan_kontak;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_pesan_kontak WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN umkm_private.pekerjaan('pesan',p.id) || jsonb_build_object('nama_pengirim',p.nama,
    'perusahaan',p.perusahaan,'nomor',p.nomor,'pesan',p.pesan,'kata_kunci',p.kata_kunci,
    'dipegang_saya',p.petugas_id=a.id,'pemeriksa_nama',a.nama,'dibalas_pada',p.dibalas_pada);
END $$;
CREATE FUNCTION public.umkm_detail_laporan(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_laporan;
BEGIN
  a := umkm_private.aktor();
  SELECT * INTO p FROM public.umkm_laporan WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN umkm_private.pekerjaan('laporan',p.id) || jsonb_build_object('foto_id',p.foto_id,'catatan',p.catatan,
    'dipegang_saya',p.petugas_id=a.id,'pemeriksa_nama',a.nama,'selesai_pada',p.selesai_pada);
END $$;
CREATE FUNCTION umkm_private.mutasi_pekerjaan(p_jenis text,p_id uuid,p_expected_version integer,
  p_operasi_id uuid,p_aksi text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; lama public.umkm_riwayat; h text; versi integer; penangan uuid;
  status text; hasil jsonb;
BEGIN
  a := umkm_private.aktor();
  IF p_jenis IS NULL OR p_jenis NOT IN ('pesan','laporan') OR p_id IS NULL OR p_operasi_id IS NULL
    OR p_expected_version IS NULL OR p_expected_version<1 OR p_aksi NOT IN ('ambil','selesai') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text || p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('pekerjaan',p_jenis,p_id,p_expected_version,p_aksi));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash IS DISTINCT FROM h THEN
      RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  IF p_jenis='pesan' THEN
    SELECT p.versi,p.petugas_id,p.status INTO versi,penangan,status
      FROM public.umkm_pesan_kontak p WHERE p.id=p_id FOR UPDATE;
  ELSE
    SELECT p.versi,p.petugas_id,p.status INTO versi,penangan,status
      FROM public.umkm_laporan p WHERE p.id=p_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF versi<>p_expected_version THEN RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
  IF status<>'baru' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  IF p_aksi='selesai' AND penangan IS DISTINCT FROM a.id THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  IF p_jenis='pesan' THEN
    UPDATE public.umkm_pesan_kontak AS t SET versi=t.versi+1,petugas_id=a.id,aktivitas_pada=clock_timestamp(),
      status=CASE WHEN p_aksi='selesai' THEN 'ditangani' ELSE 'baru' END,
      dibalas_pada=CASE WHEN p_aksi='selesai' THEN coalesce(dibalas_pada,clock_timestamp()) ELSE dibalas_pada END
      WHERE id=p_id;
  ELSE
    UPDATE public.umkm_laporan AS t SET versi=t.versi+1,petugas_id=a.id,aktivitas_pada=clock_timestamp(),
      status=CASE WHEN p_aksi='selesai' THEN 'ditangani' ELSE 'baru' END,
      selesai_pada=CASE WHEN p_aksi='selesai' THEN coalesce(selesai_pada,clock_timestamp()) ELSE selesai_pada END
      WHERE id=p_id;
  END IF;
  hasil := jsonb_build_object('id',p_id,'jenis',p_jenis,'versi',versi+1,
    'status',CASE WHEN p_aksi='selesai' THEN 'ditangani' ELSE status END);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,
    operasi_id,payload_hash,hasil) VALUES(p_id,p_jenis,p_aksi,a.id,a.role,status,hasil->>'status',p_operasi_id,h,hasil);
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_ambil_pekerjaan(p_jenis text,p_id uuid,p_expected_version integer,p_operasi_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_pekerjaan(p_jenis,p_id,p_expected_version,p_operasi_id,'ambil')
$$;
CREATE FUNCTION public.umkm_selesaikan_pekerjaan(p_jenis text,p_id uuid,p_expected_version integer,p_operasi_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_pekerjaan(p_jenis,p_id,p_expected_version,p_operasi_id,'selesai')
$$;

DROP FUNCTION public.umkm_daftar_tugas(uuid);
CREATE FUNCTION public.umkm_daftar_tugas(p_cursor text DEFAULT NULL) RETURNS jsonb
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
  ), gabung AS (
    SELECT * FROM profil UNION ALL SELECT * FROM pesan UNION ALL SELECT * FROM laporan
  ), halaman AS MATERIALIZED (SELECT * FROM gabung ORDER BY biasa,waktu,jenis,id LIMIT 21),
  nomor AS (SELECT h.*,row_number() OVER (ORDER BY biasa,waktu,jenis,id) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(CASE WHEN jenis='profil' THEN
      (SELECT umkm_private.tugas(p) FROM public.umkm_profil p WHERE p.id=n.id)
      ELSE umkm_private.pekerjaan(jenis,id) END ORDER BY urut) FILTER (WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('tugas',jsonb_build_object(
      'biasa',bool_or(biasa) FILTER (WHERE urut=20),'waktu',max(waktu) FILTER (WHERE urut=20),
      'jenis',max(jenis) FILTER (WHERE urut=20),'id',max(id::text) FILTER (WHERE urut=20))) ELSE NULL END
    INTO hasil,berikut FROM nomor n;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.umkm_kirim_pesan_kontak(text,text,text,text,uuid,uuid,text),
  public.umkm_laporkan(uuid,text,uuid,uuid,text),public.umkm_detail_pesan(uuid),public.umkm_detail_laporan(uuid),
  public.umkm_ambil_pekerjaan(text,uuid,integer,uuid),public.umkm_selesaikan_pekerjaan(text,uuid,integer,uuid),
  public.umkm_daftar_tugas(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.umkm_kirim_pesan_kontak(text,text,text,text,uuid,uuid,text),
  public.umkm_laporkan(uuid,text,uuid,uuid,text),public.umkm_detail_pesan(uuid),public.umkm_detail_laporan(uuid),
  public.umkm_ambil_pekerjaan(text,uuid,integer,uuid),public.umkm_selesaikan_pekerjaan(text,uuid,integer,uuid),
  public.umkm_daftar_tugas(text) TO authenticated;
