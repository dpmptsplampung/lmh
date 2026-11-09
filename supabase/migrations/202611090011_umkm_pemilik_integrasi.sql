-- Klaim, statistik privat dan integrasi antrean pemeriksaan.
CREATE FUNCTION umkm_private.tugas_klaim(m public.umkm_pemilik) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',m.id,'jenis','klaim','nama','Klaim profil','profil_id',m.profil_id,
    'profil_nama',r.nama,'status',m.status,'versi',m.versi,'mendesak',false,'petugas_id',m.petugas_id,
    'petugas_nama',s.nama,'dibuat_pada',m.dibuat_pada)
  FROM public.umkm_profil p LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
  LEFT JOIN public.petugas s ON s.id=m.petugas_id WHERE p.id=m.profil_id
$$;

CREATE FUNCTION public.umkm_klaim_profil(p_profil_id uuid,p_alasan text,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; m public.umkm_pemilik; lama umkm_private.operasi_publik; h text; hasil jsonb;
BEGIN
  u := umkm_private.akun_suka();
  IF p_operasi_id IS NULL OR p_profil_id IS NULL OR p_alasan IS NULL OR
    length(btrim(p_alasan)) NOT BETWEEN 1 AND 240 OR umkm_private.ada_kontak(p_alasan) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(u::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('klaim',p_profil_id,p_alasan));
  SELECT * INTO lama FROM umkm_private.operasi_publik WHERE aktor_uid=u AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  PERFORM 1 FROM public.umkm_profil WHERE id=p_profil_id AND status='terbit' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT * INTO m FROM public.umkm_pemilik WHERE profil_id=p_profil_id AND akun_uid=u FOR UPDATE;
  IF m.id IS NULL OR m.status='ditolak' THEN
    PERFORM umkm_private.jaga_laju('umkm_permintaan');
    INSERT INTO public.umkm_pemilik(profil_id,akun_uid,alasan) VALUES(p_profil_id,u,btrim(p_alasan))
    ON CONFLICT (profil_id,akun_uid) DO UPDATE SET status='diajukan',alasan=excluded.alasan,
      alasan_tolak=NULL,petugas_id=NULL,diperiksa_oleh=NULL,diperiksa_pada=NULL,
      dibuat_pada=clock_timestamp(),versi=umkm_pemilik.versi+1 RETURNING * INTO m;
    INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_uid,peran,status_baru,referensi)
      VALUES(m.id,'klaim','ajukan',u,'pemilik','diajukan',jsonb_build_object('profil_id',p_profil_id));
  END IF;
  hasil := jsonb_build_object('id',m.id,'jenis','klaim','profil_id',m.profil_id,'status',m.status,'versi',m.versi);
  INSERT INTO umkm_private.operasi_publik(aktor_uid,operasi_id,aksi,payload_hash,hasil)
    VALUES(u,p_operasi_id,'klaim',h,hasil);
  RETURN hasil;
END $$;

CREATE FUNCTION public.umkm_detail_klaim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; m public.umkm_pemilik; hasil jsonb;
BEGIN
  a := umkm_private.aktor(); SELECT * INTO m FROM public.umkm_pemilik WHERE id=p_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT umkm_private.tugas_klaim(m)||jsonb_build_object('pemilik',jsonb_build_object(
    'nama',coalesce(g.nama,'Akun tidak tersedia'),'hp',g.no_hp,'email',g.email),
    'alasan',m.alasan,'alasan_tolak',m.alasan_tolak,'dipegang_saya',coalesce(m.petugas_id=a.id,false))
    INTO hasil FROM (SELECT 1) x LEFT JOIN public.pengunjung g ON g.auth_user_id=m.akun_uid;
  RETURN hasil;
END $$;

CREATE FUNCTION umkm_private.mutasi_klaim(p_id uuid,p_expected_version integer,p_operasi_id uuid,
  p_keputusan text,p_alasan text,p_ambil boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; m public.umkm_pemilik; lama public.umkm_riwayat; h text; hasil jsonb; sebelumnya text;
BEGIN
  a := umkm_private.aktor();
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_operasi_id IS NULL THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('klaim',p_id,p_expected_version,p_keputusan,p_alasan,p_ambil));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  -- Urutan kunci profil lalu kepemilikan sama dengan pengajuan dan pengesahan pendaftar.
  PERFORM 1 FROM public.umkm_profil WHERE id=(SELECT profil_id FROM public.umkm_pemilik WHERE id=p_id)
    FOR UPDATE;
  SELECT * INTO m FROM public.umkm_pemilik WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF m.versi<>p_expected_version THEN RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
  IF m.status<>'diajukan' OR m.alasan IS NULL OR m.akun_uid IS NULL THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  sebelumnya := m.status;
  IF p_ambil THEN
    UPDATE public.umkm_pemilik SET petugas_id=a.id,versi=versi+1 WHERE id=m.id RETURNING * INTO m;
  ELSE
    IF m.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
    IF p_keputusan IS NULL OR p_keputusan NOT IN ('disetujui','ditolak') OR
      (p_keputusan='ditolak' AND coalesce(length(btrim(p_alasan)),0)=0) OR length(p_alasan)>240
      OR umkm_private.ada_kontak(p_alasan) THEN
      RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
    UPDATE public.umkm_pemilik SET status=p_keputusan,versi=versi+1,diperiksa_oleh=a.id,
      diperiksa_pada=clock_timestamp(),alasan_tolak=CASE WHEN p_keputusan='ditolak' THEN btrim(p_alasan) END
      WHERE id=m.id RETURNING * INTO m;
  END IF;
  hasil := jsonb_build_object('id',m.id,'jenis','klaim','profil_id',m.profil_id,'status',m.status,'versi',m.versi);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,
    operasi_id,payload_hash,hasil,referensi)
    VALUES(m.id,'klaim',CASE WHEN p_ambil THEN 'ambil' ELSE 'putusan' END,a.id,a.role,sebelumnya,m.status,
      p_operasi_id,h,hasil,jsonb_build_object('profil_id',m.profil_id));
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_ambil_klaim(p_id uuid,p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_klaim(p_id,p_expected_version,p_operasi_id,NULL,NULL,true) $$;
CREATE FUNCTION public.umkm_putuskan_klaim(p_id uuid,p_expected_version integer,p_operasi_id uuid,
  p_keputusan text,p_alasan text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_klaim(p_id,p_expected_version,p_operasi_id,p_keputusan,p_alasan,false) $$;

-- Pemeriksa mencabut kepemilikan yang sudah disetujui; riwayat tanpa data akun.
CREATE FUNCTION public.umkm_cabut_kepemilikan(p_id uuid,p_expected_version integer,p_operasi_id uuid,
  p_alasan text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; m public.umkm_pemilik; lama public.umkm_riwayat; h text; hasil jsonb;
BEGIN
  a := umkm_private.aktor();
  IF p_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1 OR p_operasi_id IS NULL
    OR p_alasan IS NULL OR length(btrim(p_alasan)) NOT BETWEEN 1 AND 240 OR umkm_private.ada_kontak(p_alasan) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('cabut_kepemilikan',p_id,p_expected_version,p_alasan));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  PERFORM 1 FROM public.umkm_profil WHERE id=(SELECT profil_id FROM public.umkm_pemilik WHERE id=p_id)
    FOR UPDATE;
  SELECT * INTO m FROM public.umkm_pemilik WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF m.versi<>p_expected_version THEN RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
  IF m.status<>'disetujui' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  UPDATE public.umkm_pemilik SET status='ditolak',alasan_tolak=btrim(p_alasan),diperiksa_oleh=a.id,
    diperiksa_pada=clock_timestamp(),versi=versi+1 WHERE id=m.id RETURNING * INTO m;
  hasil := jsonb_build_object('id',m.id,'jenis','klaim','profil_id',m.profil_id,'status',m.status,'versi',m.versi);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,
    operasi_id,payload_hash,hasil,referensi)
    VALUES(m.id,'klaim','cabut_kepemilikan',a.id,a.role,'disetujui',m.status,p_operasi_id,h,hasil,
      jsonb_build_object('profil_id',m.profil_id));
  RETURN hasil;
END $$;

CREATE FUNCTION umkm_private.suka_pemilik() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.status='disetujui' THEN
    UPDATE public.umkm_stat_suka SET aktif=false,diubah_pada=clock_timestamp()
      WHERE profil_id=NEW.profil_id AND aktor_uid=NEW.akun_uid AND aktif;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER umkm_suka_pemilik AFTER INSERT OR UPDATE OF status ON public.umkm_pemilik
FOR EACH ROW EXECUTE FUNCTION umkm_private.suka_pemilik();
CREATE OR REPLACE FUNCTION public.umkm_suka(p_profil_id uuid,p_aktif boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE aktor uuid; lama boolean;
BEGIN
  aktor := umkm_private.akun_suka();
  IF p_profil_id IS NULL OR p_aktif IS NULL THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.umkm_profil WHERE id=p_profil_id AND status='terbit' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p_aktif AND EXISTS (SELECT 1 FROM public.umkm_pemilik
    WHERE profil_id=p_profil_id AND akun_uid=aktor AND status='disetujui') THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(aktor::text||p_profil_id::text,0));
  SELECT aktif INTO lama FROM public.umkm_stat_suka WHERE aktor_uid=aktor AND profil_id=p_profil_id;
  IF p_aktif AND NOT coalesce(lama,false) THEN PERFORM umkm_private.jaga_laju('umkm_suka'); END IF;
  IF p_aktif OR lama IS NOT NULL THEN
    INSERT INTO public.umkm_stat_suka(aktor_uid,profil_id,aktif) VALUES(aktor,p_profil_id,p_aktif)
    ON CONFLICT (aktor_uid,profil_id) DO UPDATE SET aktif=excluded.aktif,diubah_pada=now()
      WHERE umkm_stat_suka.aktif IS DISTINCT FROM excluded.aktif;
  END IF;
  RETURN jsonb_build_object('profil_id',p_profil_id,'suka_saya',p_aktif,'suka',coalesce(
    (SELECT suka FROM public.umkm_stat_total WHERE profil_id=p_profil_id),0));
END $$;

CREATE INDEX umkm_permintaan_profil_waktu ON public.umkm_permintaan_kontak(profil_id,dibuat_pada);
CREATE INDEX umkm_pembukaan_waktu ON public.umkm_pembukaan_nomor(dibuat_pada DESC,id DESC);
CREATE FUNCTION public.umkm_statistik_pemilik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE aktif boolean; hari date; tren jsonb;
BEGIN
  PERFORM umkm_private.hak_pemilik(p_profil_id);
  SELECT telemetri_opsional_aktif INTO aktif FROM umkm_private.statistik WHERE tunggal;
  aktif := coalesce(aktif,false); hari := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  WITH hari_tren AS (SELECT generate_series(hari-29,hari,interval '1 day')::date h),
  suka AS (SELECT (pertama_pada AT TIME ZONE 'Asia/Jakarta')::date h,count(*) n
    FROM public.umkm_stat_suka st WHERE st.profil_id=p_profil_id AND st.aktif=true
      AND pertama_pada>=((hari-29)::timestamp AT TIME ZONE 'Asia/Jakarta') GROUP BY 1),
  permintaan AS (SELECT (dibuat_pada AT TIME ZONE 'Asia/Jakarta')::date h,count(*) n
    FROM public.umkm_permintaan_kontak WHERE profil_id=p_profil_id
      AND dibuat_pada>=((hari-29)::timestamp AT TIME ZONE 'Asia/Jakarta') GROUP BY 1),
  pembukaan AS (SELECT (b.dibuat_pada AT TIME ZONE 'Asia/Jakarta')::date h,count(*) n
    FROM public.umkm_pembukaan_nomor b JOIN public.umkm_permintaan_kontak r ON r.id=b.permintaan_id
    WHERE r.profil_id=p_profil_id AND b.dibuat_pada>=((hari-29)::timestamp AT TIME ZONE 'Asia/Jakarta') GROUP BY 1)
  SELECT jsonb_agg(jsonb_build_object('hari',t.h,'dilihat',CASE WHEN aktif THEN coalesce(v.dilihat,0) END,
    'suka',coalesce(s.n,0),'permintaan',coalesce(r.n,0),'nomor_dibuka',coalesce(b.n,0)) ORDER BY t.h)
    INTO tren FROM hari_tren t LEFT JOIN public.umkm_stat_harian v ON v.hari=t.h AND v.profil_id=p_profil_id
    LEFT JOIN suka s ON s.h=t.h LEFT JOIN permintaan r ON r.h=t.h LEFT JOIN pembukaan b ON b.h=t.h;
  RETURN jsonb_build_object('telemetri_opsional_aktif',aktif,'tren',tren,
    'dilihat',CASE WHEN aktif THEN coalesce((SELECT dilihat FROM public.umkm_stat_total
      WHERE profil_id=p_profil_id),0) END,
    'suka',coalesce((SELECT suka FROM public.umkm_stat_total WHERE profil_id=p_profil_id),0),
    'permintaan',(SELECT count(*) FROM public.umkm_permintaan_kontak WHERE profil_id=p_profil_id),
    'nomor_dibuka',(SELECT count(*) FROM public.umkm_pembukaan_nomor b
      JOIN public.umkm_permintaan_kontak r ON r.id=b.permintaan_id WHERE r.profil_id=p_profil_id));
END $$;

CREATE FUNCTION public.umkm_perusahaan_penerima(p_profil_id uuid,p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c jsonb; hasil jsonb; berikut text;
BEGIN
  PERFORM umkm_private.hak_pemilik(p_profil_id);
  c := umkm_private.baca_cursor(p_cursor,'penerima.'||p_profil_id::text);
  WITH halaman AS MATERIALIZED (
    SELECT b.id,b.dibuat_pada,k.perusahaan_id FROM public.umkm_pembukaan_nomor b
    JOIN public.umkm_permintaan_kontak r ON r.id=b.permintaan_id
    JOIN public.umkm_kebutuhan k ON k.id=r.kebutuhan_id
    WHERE r.profil_id=p_profil_id AND (c IS NULL OR
      (b.dibuat_pada,b.id)<((c->>'waktu')::timestamptz,(c->>'id')::uuid))
    ORDER BY b.dibuat_pada DESC,b.id DESC LIMIT 21
  ), nomor AS (SELECT h.*,row_number() OVER (ORDER BY dibuat_pada DESC,id DESC) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(jsonb_build_object('nama',p.nama,'dibuka_pada',n.dibuat_pada) ORDER BY urut)
      FILTER (WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('penerima.'||p_profil_id::text,jsonb_build_object(
      'waktu',max(n.dibuat_pada) FILTER (WHERE urut=20),'id',max(n.id::text) FILTER (WHERE urut=20))) END
    INTO hasil,berikut FROM nomor n JOIN public.umkm_perusahaan p ON p.id=n.perusahaan_id;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.umkm_klaim_profil(uuid,text,uuid),public.umkm_detail_klaim(uuid),
  public.umkm_ambil_klaim(uuid,integer,uuid),public.umkm_putuskan_klaim(uuid,integer,uuid,text,text),
  public.umkm_statistik_pemilik(uuid),public.umkm_perusahaan_penerima(uuid,text),
  public.umkm_cabut_kepemilikan(uuid,integer,uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_klaim_profil(uuid,text,uuid),public.umkm_detail_klaim(uuid),
  public.umkm_ambil_klaim(uuid,integer,uuid),public.umkm_putuskan_klaim(uuid,integer,uuid,text,text),
  public.umkm_statistik_pemilik(uuid),public.umkm_perusahaan_penerima(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_cabut_kepemilikan(uuid,integer,uuid,text) TO authenticated;

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
  ), klaim AS MATERIALIZED (
    SELECT m.id,'klaim'::text jenis,true biasa,m.dibuat_pada waktu FROM public.umkm_pemilik m
    WHERE m.status='diajukan' AND m.alasan IS NOT NULL AND m.akun_uid IS NOT NULL AND (c IS NULL OR
      (true,m.dibuat_pada,'klaim',m.id)>
      ((c->>'biasa')::boolean,(c->>'waktu')::timestamptz,c->>'jenis',(c->>'id')::uuid))
    ORDER BY m.dibuat_pada,m.id LIMIT 21
  ), gabung AS (
    SELECT * FROM profil UNION ALL SELECT * FROM pesan UNION ALL SELECT * FROM laporan
    UNION ALL SELECT * FROM permintaan UNION ALL SELECT * FROM klaim
  ), halaman AS MATERIALIZED (SELECT * FROM gabung ORDER BY biasa,waktu,jenis,id LIMIT 21),
  nomor AS (SELECT h.*,row_number() OVER (ORDER BY biasa,waktu,jenis,id) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(CASE WHEN jenis='profil' THEN
      (SELECT umkm_private.tugas(p) FROM public.umkm_profil p WHERE p.id=n.id)
      WHEN jenis='permintaan' THEN (SELECT umkm_private.tugas_permintaan(p)
        FROM public.umkm_permintaan_kontak p WHERE p.id=n.id)
      WHEN jenis='klaim' THEN (SELECT umkm_private.tugas_klaim(m) FROM public.umkm_pemilik m WHERE m.id=n.id)
      ELSE umkm_private.pekerjaan(jenis,id) END ORDER BY urut) FILTER (WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('tugas',jsonb_build_object(
      'biasa',bool_or(biasa) FILTER (WHERE urut=20),'waktu',max(waktu) FILTER (WHERE urut=20),
      'jenis',max(jenis) FILTER (WHERE urut=20),'id',max(id::text) FILTER (WHERE urut=20))) ELSE NULL END
    INTO hasil,berikut FROM nomor n;
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
  hasil := hasil||jsonb_build_object('tugas_terbuka',(hasil->>'tugas_terbuka')::bigint+
    (SELECT count(*) FROM public.umkm_pemilik WHERE status='diajukan' AND alasan IS NOT NULL
      AND akun_uid IS NOT NULL));
  RETURN hasil;
END $$;

-- Tindakan pemilik di jejak FO berlabel umum, tanpa nama, UID, atau kontak akun.
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
      CASE WHEN h.peran IN ('admin','petugas','front_office','pemilik') THEN h.peran ELSE 'system' END,
    'aktor_nama',CASE WHEN h.peran='pemilik' THEN 'Pemilik usaha' WHEN h.aktor_uid IS NOT NULL THEN 'Pemohon'
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
