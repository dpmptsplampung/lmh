-- Suka fungsional dan pencatatan opsional tahap A.
CREATE TABLE public.umkm_stat_suka (
  aktor_uid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  profil_id uuid NOT NULL REFERENCES public.umkm_profil(id), aktif boolean NOT NULL DEFAULT true,
  pertama_pada timestamptz NOT NULL DEFAULT now(), diubah_pada timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (aktor_uid,profil_id)
);
CREATE TABLE public.umkm_stat_total (
  profil_id uuid PRIMARY KEY REFERENCES public.umkm_profil(id),
  suka bigint NOT NULL DEFAULT 0 CHECK (suka>=0), dilihat bigint NOT NULL DEFAULT 0 CHECK (dilihat>=0),
  klik_formulir bigint NOT NULL DEFAULT 0 CHECK (klik_formulir>=0),
  mulai_pada timestamptz, diubah_pada timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX umkm_suka_profil ON public.umkm_stat_suka(profil_id,pertama_pada) WHERE aktif;
ALTER TABLE public.umkm_stat_suka ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_stat_total ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_stat_suka,public.umkm_stat_total FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION umkm_private.jaga_laju(p_aksi text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF p_aksi IS NULL OR p_aksi NOT IN ('umkm_pesan','umkm_laporan','umkm_suka') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('umkm.laju.' || p_aksi,0));
  IF NOT public.check_anon_rate(p_aksi,10,600) OR NOT public.check_anon_rate(p_aksi,30,86400)
    OR (SELECT count(*) FROM public.anon_rate_limit WHERE action=p_aksi
      AND created_at>now()-interval '600 seconds')>=200 THEN
    RAISE EXCEPTION 'TERLALU_BANYAK' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.anon_rate_limit(user_id,action) VALUES(auth.uid(),p_aksi);
END $$;
CREATE FUNCTION umkm_private.akun_suka() RETURNS uuid
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR coalesce(auth.jwt()->>'is_anonymous','false')='true'
    OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=auth.uid() AND NOT coalesce(is_anonymous,false)) THEN
    RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF NOT public.sesi_valid() OR EXISTS (SELECT 1 FROM public.petugas WHERE auth_user_id=auth.uid()) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  RETURN auth.uid();
END $$;
CREATE FUNCTION umkm_private.total_suka() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE selisih integer; profil uuid;
BEGIN
  IF TG_OP='INSERT' THEN selisih := NEW.aktif::integer; profil := NEW.profil_id;
  ELSIF TG_OP='DELETE' THEN selisih := -OLD.aktif::integer; profil := OLD.profil_id;
  ELSE selisih := NEW.aktif::integer-OLD.aktif::integer; profil := NEW.profil_id; END IF;
  IF selisih<>0 THEN
    INSERT INTO public.umkm_stat_total(profil_id) VALUES (profil) ON CONFLICT DO NOTHING;
    UPDATE public.umkm_stat_total SET suka=suka+selisih,diubah_pada=now() WHERE profil_id=profil;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER umkm_total_suka AFTER INSERT OR UPDATE OR DELETE ON public.umkm_stat_suka
FOR EACH ROW EXECUTE FUNCTION umkm_private.total_suka();
CREATE FUNCTION public.umkm_suka(p_profil_id uuid,p_aktif boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE aktor uuid; lama boolean;
BEGIN
  aktor := umkm_private.akun_suka();
  IF p_profil_id IS NULL OR p_aktif IS NULL THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.umkm_profil WHERE id=p_profil_id AND status='terbit' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(aktor::text || p_profil_id::text,0));
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
CREATE FUNCTION public.umkm_status_suka(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE aktor uuid;
BEGIN
  aktor := umkm_private.akun_suka();
  IF NOT EXISTS (SELECT 1 FROM public.umkm_profil WHERE id=p_profil_id AND status='terbit') THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('suka_saya',coalesce((SELECT aktif FROM public.umkm_stat_suka
    WHERE aktor_uid=aktor AND profil_id=p_profil_id),false));
END $$;
REVOKE ALL ON FUNCTION umkm_private.akun_suka(),umkm_private.total_suka(),
  public.umkm_suka(uuid,boolean),public.umkm_status_suka(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_suka(uuid,boolean),public.umkm_status_suka(uuid) TO authenticated;

CREATE TABLE public.umkm_stat_kejadian (
  hari date NOT NULL, profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  jenis text NOT NULL CHECK (jenis IN ('dilihat','klik_formulir')), identitas_hash text NOT NULL,
  dibuat_pada timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(hari,profil_id,jenis,identitas_hash)
);
CREATE TABLE public.umkm_stat_harian (
  hari date NOT NULL, profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  dilihat bigint NOT NULL DEFAULT 0, klik_formulir bigint NOT NULL DEFAULT 0, PRIMARY KEY(hari,profil_id)
);
CREATE TABLE public.umkm_stat_tanpa_hasil (
  hari date NOT NULL, kategori text NOT NULL DEFAULT '', kabupaten_kota text NOT NULL DEFAULT '',
  jumlah bigint NOT NULL DEFAULT 1, PRIMARY KEY(hari,kategori,kabupaten_kota)
);
CREATE TABLE public.umkm_stat_bulanan (
  bulan date NOT NULL, kategori text NOT NULL DEFAULT '', kabupaten_kota text NOT NULL DEFAULT '',
  tanpa_hasil bigint NOT NULL, PRIMARY KEY(bulan,kategori,kabupaten_kota)
);
CREATE TABLE public.umkm_skor (
  snapshot uuid NOT NULL, profil_id uuid NOT NULL REFERENCES public.umkm_profil(id), hari date NOT NULL,
  l90 bigint NOT NULL, v90 bigint NOT NULL, skor bigint NOT NULL,
  mode text NOT NULL CHECK (mode IN ('suka','telemetri')), PRIMARY KEY(snapshot,profil_id)
);
CREATE TABLE umkm_private.statistik (
  tunggal boolean PRIMARY KEY DEFAULT true CHECK (tunggal),
  telemetri_opsional_aktif boolean NOT NULL DEFAULT false, versi_naskah text, aktif_pada timestamptz,
  snapshot_aktif uuid
);
INSERT INTO umkm_private.statistik(tunggal) VALUES(true);
ALTER TABLE public.umkm_stat_kejadian ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_stat_harian ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_stat_tanpa_hasil ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_stat_bulanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_skor ENABLE ROW LEVEL SECURITY;
ALTER TABLE umkm_private.statistik ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_stat_kejadian,public.umkm_stat_harian,public.umkm_stat_tanpa_hasil,
  public.umkm_stat_bulanan,public.umkm_skor,umkm_private.statistik FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX umkm_kejadian_profil ON public.umkm_stat_kejadian(profil_id);
CREATE INDEX umkm_kejadian_waktu ON public.umkm_stat_kejadian(dibuat_pada);
CREATE INDEX umkm_harian_profil ON public.umkm_stat_harian(profil_id,hari);
CREATE INDEX umkm_skor_profil ON public.umkm_skor(profil_id);

CREATE FUNCTION umkm_private.perbarui_skor() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  WITH kunci AS MATERIALIZED (
    SELECT pg_advisory_xact_lock(hashtextextended('umkm.skor',0))
  ), metadata AS MATERIALIZED (
    SELECT gen_random_uuid() snapshot,(now() AT TIME ZONE 'Asia/Jakarta')::date hari,
      s.telemetri_opsional_aktif aktif FROM umkm_private.statistik s CROSS JOIN kunci WHERE s.tunggal
  ), suka AS (
    SELECT s.profil_id,count(*) l90 FROM public.umkm_stat_suka s CROSS JOIN metadata m
    WHERE s.aktif AND (s.pertama_pada AT TIME ZONE 'Asia/Jakarta')::date BETWEEN m.hari-89 AND m.hari
      AND NOT EXISTS (SELECT 1 FROM public.petugas p WHERE p.auth_user_id=s.aktor_uid)
    GROUP BY s.profil_id
  ), lihat AS (
    SELECT h.profil_id,sum(h.dilihat)::bigint v90 FROM public.umkm_stat_harian h CROSS JOIN metadata m
    WHERE h.hari BETWEEN m.hari-89 AND m.hari GROUP BY h.profil_id
  ), simpan AS (
    INSERT INTO public.umkm_skor(snapshot,profil_id,hari,l90,v90,skor,mode)
    SELECT m.snapshot,p.id,m.hari,coalesce(s.l90,0),coalesce(v.v90,0),
      CASE WHEN m.aktif THEN 5*coalesce(s.l90,0)+coalesce(v.v90,0) ELSE coalesce(s.l90,0) END,
      CASE WHEN m.aktif THEN 'telemetri' ELSE 'suka' END
    FROM public.umkm_profil p CROSS JOIN metadata m LEFT JOIN suka s ON s.profil_id=p.id
    LEFT JOIN lihat v ON v.profil_id=p.id WHERE p.status='terbit' RETURNING snapshot
  ), hapus AS (
    DELETE FROM public.umkm_skor WHERE snapshot<>(SELECT snapshot FROM metadata) RETURNING snapshot
  ) UPDATE umkm_private.statistik SET snapshot_aktif=(SELECT snapshot FROM metadata)
    WHERE tunggal AND (SELECT count(*) FROM simpan)>=0 AND (SELECT count(*) FROM hapus)>=0
$$;
CREATE FUNCTION public.umkm_statistik_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('telemetri_opsional_aktif',telemetri_opsional_aktif,
    'versi_naskah',versi_naskah,'aktif_pada',aktif_pada) FROM umkm_private.statistik WHERE tunggal
$$;
CREATE FUNCTION public.umkm_atur_telemetri(p_aktif boolean,p_versi_naskah text,p_kebijakan_terbit boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; lama boolean;
BEGIN
  a := umkm_private.aktor(true);
  IF p_aktif IS NULL OR (p_aktif AND (p_kebijakan_terbit IS DISTINCT FROM true
    OR p_versi_naskah IS NULL OR length(btrim(p_versi_naskah)) NOT BETWEEN 1 AND 100)) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('umkm.skor',0));
  SELECT telemetri_opsional_aktif INTO lama FROM umkm_private.statistik WHERE tunggal FOR UPDATE;
  IF lama IS DISTINCT FROM p_aktif THEN
    UPDATE umkm_private.statistik SET telemetri_opsional_aktif=p_aktif,
      versi_naskah=CASE WHEN p_aktif THEN btrim(p_versi_naskah) ELSE versi_naskah END,
      aktif_pada=CASE WHEN p_aktif THEN now() ELSE aktif_pada END WHERE tunggal;
    INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,referensi)
      VALUES(a.id,'statistik','atur_telemetri',a.id,a.role,jsonb_build_object('aktif',p_aktif,
        'versi_naskah',CASE WHEN p_aktif THEN btrim(p_versi_naskah) ELSE NULL END));
    PERFORM umkm_private.perbarui_skor();
  END IF;
  RETURN public.umkm_statistik_status();
END $$;
CREATE FUNCTION public.umkm_catat_statistik(p_jenis text,p_profil_id uuid,p_identitas text,
  p_aktor_uid uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE aktif boolean; hari_wib date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  sidik text; ditulis integer; lihat integer; klik integer;
BEGIN
  SELECT telemetri_opsional_aktif INTO aktif FROM umkm_private.statistik WHERE tunggal FOR SHARE;
  IF aktif IS NOT TRUE OR EXISTS (SELECT 1 FROM public.petugas WHERE auth_user_id=p_aktor_uid) THEN
    RETURN jsonb_build_object('dicatat',false); END IF;
  IF p_jenis IS NULL OR p_jenis NOT IN ('dilihat','klik_formulir') OR p_profil_id IS NULL
    OR p_identitas IS NULL OR length(p_identitas) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM 1 FROM public.umkm_profil WHERE id=p_profil_id AND status='terbit' FOR SHARE;
  IF NOT FOUND THEN RETURN jsonb_build_object('dicatat',false); END IF;
  sidik := umkm_private.sidik(jsonb_build_array(hari_wib,
    CASE WHEN p_aktor_uid IS NULL THEN 'cookie' ELSE 'akun' END,coalesce(p_aktor_uid::text,p_identitas)));
  PERFORM pg_advisory_xact_lock(hashtextextended('umkm.statistik.global',0));
  IF (SELECT count(*) FROM public.umkm_stat_kejadian WHERE dibuat_pada>=now()-interval '600 seconds')>=1000 THEN
    RETURN jsonb_build_object('dicatat',false); END IF;
  INSERT INTO public.umkm_stat_kejadian(hari,profil_id,jenis,identitas_hash)
    VALUES(hari_wib,p_profil_id,p_jenis,sidik) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS ditulis=ROW_COUNT;
  IF ditulis=0 THEN RETURN jsonb_build_object('dicatat',false); END IF;
  lihat := (p_jenis='dilihat')::integer; klik := (p_jenis='klik_formulir')::integer;
  INSERT INTO public.umkm_stat_harian(hari,profil_id,dilihat,klik_formulir)
    VALUES(hari_wib,p_profil_id,lihat,klik) ON CONFLICT(hari,profil_id) DO UPDATE SET
    dilihat=umkm_stat_harian.dilihat+excluded.dilihat,
    klik_formulir=umkm_stat_harian.klik_formulir+excluded.klik_formulir;
  INSERT INTO public.umkm_stat_total(profil_id,dilihat,klik_formulir,mulai_pada)
    VALUES(p_profil_id,lihat,klik,now()) ON CONFLICT(profil_id) DO UPDATE SET
    dilihat=umkm_stat_total.dilihat+excluded.dilihat,
    klik_formulir=umkm_stat_total.klik_formulir+excluded.klik_formulir,
    mulai_pada=coalesce(umkm_stat_total.mulai_pada,now()),diubah_pada=now();
  RETURN jsonb_build_object('dicatat',true);
END $$;
CREATE FUNCTION public.umkm_catat_tanpa_hasil(p_kategori text,p_kabupaten_kota text,
  p_aktor_uid uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE aktif boolean; kategori_sah text := ''; kota_sah text := '';
BEGIN
  SELECT telemetri_opsional_aktif INTO aktif FROM umkm_private.statistik WHERE tunggal FOR SHARE;
  IF aktif IS NOT TRUE OR EXISTS (SELECT 1 FROM public.petugas WHERE auth_user_id=p_aktor_uid) THEN
    RETURN jsonb_build_object('dicatat',false); END IF;
  IF EXISTS (SELECT 1 FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    WHERE p.status='terbit' AND r.kategori=p_kategori) THEN kategori_sah := p_kategori; END IF;
  IF EXISTS (SELECT 1 FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    WHERE p.status='terbit' AND r.kabupaten_kota=p_kabupaten_kota) THEN kota_sah := p_kabupaten_kota; END IF;
  INSERT INTO public.umkm_stat_tanpa_hasil(hari,kategori,kabupaten_kota)
    VALUES((now() AT TIME ZONE 'Asia/Jakarta')::date,kategori_sah,kota_sah)
    ON CONFLICT(hari,kategori,kabupaten_kota) DO UPDATE SET jumlah=umkm_stat_tanpa_hasil.jumlah+1;
  RETURN jsonb_build_object('dicatat',true);
END $$;
REVOKE ALL ON FUNCTION umkm_private.perbarui_skor(),public.umkm_statistik_status(),
  public.umkm_atur_telemetri(boolean,text,boolean),public.umkm_catat_statistik(text,uuid,text,uuid),
  public.umkm_catat_tanpa_hasil(text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_statistik_status() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_atur_telemetri(boolean,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_catat_statistik(text,uuid,text,uuid),
  public.umkm_catat_tanpa_hasil(text,text,uuid) TO service_role;
SELECT cron.schedule('umkm_skor_harian','0 19 * * *','SELECT umkm_private.perbarui_skor()');

CREATE FUNCTION umkm_private.laporan_statistik(p_cursor text,p_ekspor boolean) RETURNS jsonb
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
      'dilihat',dilihat,'klik_formulir',klik_formulir) ORDER BY n) FILTER(WHERE n<=batas),'[]'::jsonb),
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
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_laporan_statistik(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.laporan_statistik(p_cursor,false)
$$;
CREATE FUNCTION public.umkm_ekspor_statistik() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.laporan_statistik(NULL,true)
$$;
REVOKE ALL ON FUNCTION umkm_private.laporan_statistik(text,boolean),public.umkm_laporan_statistik(text),
  public.umkm_ekspor_statistik() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_laporan_statistik(text),public.umkm_ekspor_statistik() TO authenticated;
