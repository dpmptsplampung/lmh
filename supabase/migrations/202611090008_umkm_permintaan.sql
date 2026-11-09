-- Tahap B: perusahaan per individu, kebutuhan dan pembukaan nomor melalui keputusan petugas.
CREATE TABLE public.umkm_perusahaan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pemohon_uid uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  nama text NOT NULL CHECK (length(btrim(nama)) BETWEEN 1 AND 200),
  jabatan text NOT NULL CHECK (length(btrim(jabatan)) BETWEEN 1 AND 200),
  consent_id uuid REFERENCES public.consent_log(id), diperiksa_oleh uuid REFERENCES public.petugas(id),
  diperiksa_pada timestamptz, dibuat_pada timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE public.umkm_kebutuhan (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), perusahaan_id uuid NOT NULL REFERENCES public.umkm_perusahaan(id),
  teks text NOT NULL CHECK (length(teks)<=200), kategori text NOT NULL,
  kabupaten_kota text, status text NOT NULL DEFAULT 'aktif' CHECK (status IN ('aktif','ditutup')),
  dibuat_pada timestamptz NOT NULL DEFAULT clock_timestamp(), ditutup_pada timestamptz
);
CREATE TABLE public.umkm_permintaan_kontak (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kebutuhan_id uuid NOT NULL REFERENCES public.umkm_kebutuhan(id),
  profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  pemohon_uid uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kode text NOT NULL UNIQUE DEFAULT ('UM-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
  status text NOT NULL DEFAULT 'diajukan'
    CHECK (status IN ('diajukan','menunggu_izin','nomor_dibuka','ditolak','dibatalkan')),
  versi integer NOT NULL DEFAULT 1 CHECK (versi>0), petugas_id uuid REFERENCES public.petugas(id),
  tahan_darurat boolean NOT NULL DEFAULT false, alasan_tolak text CHECK (length(alasan_tolak)<=240),
  sumber text NOT NULL DEFAULT 'pemohon' CHECK (sumber IN ('pemohon','petugas')),
  nama_bantuan text, kontak_bantuan text, tautan_hash text UNIQUE,
  dibuat_pada timestamptz NOT NULL DEFAULT clock_timestamp(),
  aktivitas_pada timestamptz NOT NULL DEFAULT clock_timestamp(), ditutup_pada timestamptz
);
CREATE TABLE public.umkm_pembukaan_nomor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  permintaan_id uuid NOT NULL UNIQUE REFERENCES public.umkm_permintaan_kontak(id),
  pemohon_uid uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kontak_versi_id uuid NOT NULL REFERENCES public.umkm_kontak_versi(id),
  izin_id uuid NOT NULL REFERENCES public.umkm_izin(id), petugas_id uuid NOT NULL REFERENCES public.petugas(id),
  dibuat_pada timestamptz NOT NULL DEFAULT clock_timestamp(),
  hasil text NOT NULL DEFAULT 'belum_diketahui' CHECK (hasil IN ('belum_diketahui','kerja_sama','tidak_berlanjut'))
);
ALTER TABLE public.umkm_perusahaan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_kebutuhan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_permintaan_kontak ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_pembukaan_nomor ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_perusahaan,public.umkm_kebutuhan,public.umkm_permintaan_kontak,
  public.umkm_pembukaan_nomor FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.umkm_riwayat ALTER COLUMN aktor_id DROP NOT NULL;
ALTER TABLE public.umkm_riwayat ADD COLUMN aktor_uid uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX umkm_perusahaan_pemeriksa ON public.umkm_perusahaan(diperiksa_oleh);
CREATE INDEX umkm_perusahaan_consent ON public.umkm_perusahaan(consent_id);
CREATE INDEX umkm_kebutuhan_pemilik ON public.umkm_kebutuhan(perusahaan_id,dibuat_pada DESC,id DESC);
CREATE INDEX umkm_permintaan_saya ON public.umkm_permintaan_kontak(pemohon_uid,dibuat_pada DESC,id DESC);
CREATE INDEX umkm_permintaan_pasangan ON public.umkm_permintaan_kontak(kebutuhan_id,profil_id,dibuat_pada DESC);
CREATE INDEX umkm_permintaan_antrean ON public.umkm_permintaan_kontak
  ((NOT tahan_darurat),dibuat_pada,id) WHERE status IN ('diajukan','menunggu_izin') OR tahan_darurat;
CREATE INDEX umkm_permintaan_profil ON public.umkm_permintaan_kontak(profil_id,petugas_id,status);
CREATE INDEX umkm_permintaan_petugas ON public.umkm_permintaan_kontak(petugas_id);
CREATE INDEX umkm_permintaan_retensi ON public.umkm_permintaan_kontak(ditutup_pada,id);
CREATE INDEX umkm_pembukaan_pemohon ON public.umkm_pembukaan_nomor(pemohon_uid);
CREATE INDEX umkm_pembukaan_izin ON public.umkm_pembukaan_nomor(izin_id);
CREATE INDEX umkm_pembukaan_kontak ON public.umkm_pembukaan_nomor(kontak_versi_id);
CREATE INDEX umkm_pembukaan_petugas ON public.umkm_pembukaan_nomor(petugas_id);
CREATE INDEX umkm_riwayat_pemohon ON public.umkm_riwayat(aktor_uid) WHERE aktor_uid IS NOT NULL;

CREATE FUNCTION umkm_private.tutup_perusahaan_akun_terhapus() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  UPDATE public.umkm_kebutuhan SET status='ditutup',ditutup_pada=clock_timestamp()
    WHERE perusahaan_id=NEW.id AND status='aktif';
  UPDATE public.umkm_permintaan_kontak r SET status='dibatalkan',versi=versi+1,tahan_darurat=false,
    aktivitas_pada=clock_timestamp(),ditutup_pada=coalesce(r.ditutup_pada,clock_timestamp())
    FROM public.umkm_kebutuhan k WHERE k.id=r.kebutuhan_id AND k.perusahaan_id=NEW.id
      AND r.status IN ('diajukan','menunggu_izin');
  UPDATE public.umkm_permintaan_kontak r SET ditutup_pada=coalesce(r.ditutup_pada,clock_timestamp()),
    tahan_darurat=false,versi=versi+CASE WHEN r.tahan_darurat THEN 1 ELSE 0 END,
    aktivitas_pada=clock_timestamp()
    WHERE (r.ditutup_pada IS NULL OR r.tahan_darurat) AND (r.pemohon_uid=OLD.pemohon_uid OR EXISTS (
      SELECT 1 FROM public.umkm_kebutuhan k WHERE k.id=r.kebutuhan_id AND k.perusahaan_id=NEW.id));
  RETURN NEW;
END $$;
CREATE TRIGGER umkm_perusahaan_akun_terhapus AFTER UPDATE OF pemohon_uid ON public.umkm_perusahaan
  FOR EACH ROW WHEN (OLD.pemohon_uid IS NOT NULL AND NEW.pemohon_uid IS NULL)
  EXECUTE FUNCTION umkm_private.tutup_perusahaan_akun_terhapus();

CREATE OR REPLACE FUNCTION umkm_private.jaga_laju(p_aksi text) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
DECLARE singkat integer := CASE WHEN p_aksi='umkm_permintaan' THEN 60 ELSE 10 END;
  harian integer := CASE WHEN p_aksi='umkm_permintaan' THEN 1000 ELSE 30 END;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  IF p_aksi IS NULL OR p_aksi NOT IN ('umkm_pesan','umkm_laporan','umkm_suka','umkm_permintaan','umkm_tautkan') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('umkm.laju.'||p_aksi,0));
  IF NOT public.check_anon_rate(p_aksi,singkat,600) OR NOT public.check_anon_rate(p_aksi,harian,86400)
    OR (SELECT count(*) FROM public.anon_rate_limit WHERE action=p_aksi
      AND created_at>now()-interval '600 seconds')>=200 THEN
    RAISE EXCEPTION 'TERLALU_BANYAK' USING ERRCODE='P0001'; END IF;
  INSERT INTO public.anon_rate_limit(user_id,action) VALUES(auth.uid(),p_aksi);
END $$;
CREATE FUNCTION public.umkm_tahap_b() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT '{"aktif":true}'::jsonb $$;
CREATE FUNCTION umkm_private.perusahaan_json(p public.umkm_perusahaan) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'nama',p.nama,'jabatan',p.jabatan,'diperiksa',p.diperiksa_pada IS NOT NULL)
$$;
CREATE FUNCTION public.umkm_perusahaan_saya() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; p public.umkm_perusahaan;
BEGIN
  u := umkm_private.akun_suka();
  SELECT * INTO p FROM public.umkm_perusahaan WHERE pemohon_uid=u;
  RETURN jsonb_build_object('perusahaan',CASE WHEN p.id IS NOT NULL THEN umkm_private.perusahaan_json(p) END);
END $$;
CREATE FUNCTION public.umkm_simpan_perusahaan(p_nama text,p_jabatan text,p_setuju boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; p public.umkm_perusahaan; c uuid;
BEGIN
  u := umkm_private.akun_suka();
  IF p_setuju IS DISTINCT FROM true OR p_nama IS NULL OR p_jabatan IS NULL
    OR length(btrim(p_nama)) NOT BETWEEN 1 AND 200 OR length(btrim(p_jabatan)) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('umkm.perusahaan.'||u::text,0));
  SELECT * INTO p FROM public.umkm_perusahaan WHERE pemohon_uid=u FOR UPDATE;
  IF p.diperiksa_pada IS NOT NULL THEN
    IF p.nama=btrim(p_nama) AND p.jabatan=btrim(p_jabatan) THEN RETURN umkm_private.perusahaan_json(p); END IF;
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  INSERT INTO public.consent_log(subjek_ref,tujuan,disetujui,versi_kebijakan)
    VALUES(u::text,'umkm_perusahaan',true,'1.0') RETURNING id INTO c;
  INSERT INTO public.umkm_perusahaan(pemohon_uid,nama,jabatan,consent_id)
    VALUES(u,btrim(p_nama),btrim(p_jabatan),c)
    ON CONFLICT(pemohon_uid) DO UPDATE SET nama=excluded.nama,jabatan=excluded.jabatan,consent_id=excluded.consent_id
    RETURNING * INTO p;
  RETURN umkm_private.perusahaan_json(p);
END $$;
CREATE FUNCTION umkm_private.kebutuhan_json(k public.umkm_kebutuhan) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',k.id,'teks',k.teks,'kategori',k.kategori,'kabupaten_kota',k.kabupaten_kota,
    'status',k.status,'dibuat_pada',k.dibuat_pada)
$$;
CREATE FUNCTION umkm_private.validasi_kebutuhan(p_teks text,p_kategori text,p_kota text) RETURNS void
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF p_teks IS NULL OR length(btrim(p_teks)) NOT BETWEEN 1 AND 200 OR p_kategori IS NULL
    OR length(p_kota)>100 OR NOT EXISTS (
      SELECT 1 FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
      WHERE p.status='terbit' AND r.kategori=p_kategori) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
END $$;
CREATE FUNCTION public.umkm_simpan_kebutuhan(p_teks text,p_kategori text,p_kabupaten_kota text DEFAULT NULL,
  p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; p uuid; k public.umkm_kebutuhan;
BEGIN
  u := umkm_private.akun_suka();
  PERFORM umkm_private.validasi_kebutuhan(p_teks,p_kategori,p_kabupaten_kota);
  SELECT id INTO p FROM public.umkm_perusahaan WHERE pemohon_uid=u;
  IF p IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  IF p_id IS NULL THEN
    INSERT INTO public.umkm_kebutuhan(perusahaan_id,teks,kategori,kabupaten_kota)
      VALUES(p,btrim(p_teks),p_kategori,nullif(btrim(p_kabupaten_kota),'')) RETURNING * INTO k;
  ELSE
    SELECT * INTO k FROM public.umkm_kebutuhan WHERE id=p_id AND perusahaan_id=p FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
    IF k.status<>'aktif' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    UPDATE public.umkm_kebutuhan SET teks=btrim(p_teks),kategori=p_kategori,
      kabupaten_kota=nullif(btrim(p_kabupaten_kota),'') WHERE id=k.id RETURNING * INTO k;
  END IF;
  RETURN umkm_private.kebutuhan_json(k);
END $$;
CREATE FUNCTION public.umkm_kebutuhan_saya(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; c jsonb; hasil jsonb; berikut text;
BEGIN
  u := umkm_private.akun_suka(); c := umkm_private.baca_cursor(p_cursor,'kebutuhan-'||u::text);
  WITH halaman AS MATERIALIZED (
    SELECT k.* FROM public.umkm_kebutuhan k JOIN public.umkm_perusahaan p ON p.id=k.perusahaan_id
    WHERE p.pemohon_uid=u AND (c IS NULL OR (k.dibuat_pada,k.id)<
      ((c->>'waktu')::timestamptz,(c->>'id')::uuid)) ORDER BY k.dibuat_pada DESC,k.id DESC LIMIT 21
  ), n AS (SELECT k.*,row_number() OVER (ORDER BY dibuat_pada DESC,id DESC) urut FROM halaman k)
  SELECT coalesce(jsonb_agg(umkm_private.kebutuhan_json((SELECT k FROM public.umkm_kebutuhan k WHERE k.id=n.id))
      ORDER BY urut) FILTER(WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('kebutuhan-'||u::text,jsonb_build_object(
      'waktu',max(dibuat_pada) FILTER(WHERE urut=20),'id',max(id::text) FILTER(WHERE urut=20))) END
    INTO hasil,berikut FROM n;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE FUNCTION umkm_private.jejak_pemohon(p_id uuid,p_aksi text,p_lama text,p_baru text,p_profil uuid)
RETURNS void LANGUAGE sql SET search_path = pg_catalog, pg_temp AS $$
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_uid,peran,status_lama,status_baru,referensi)
  VALUES(p_id,'permintaan',p_aksi,auth.uid(),'pemohon',p_lama,p_baru,jsonb_build_object('profil_id',p_profil))
$$;
CREATE FUNCTION public.umkm_tutup_kebutuhan(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; k public.umkm_kebutuhan; r public.umkm_permintaan_kontak;
BEGIN
  u := umkm_private.akun_suka();
  SELECT t.* INTO k FROM public.umkm_kebutuhan t JOIN public.umkm_perusahaan p ON p.id=t.perusahaan_id
    WHERE t.id=p_id AND p.pemohon_uid=u FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  UPDATE public.umkm_kebutuhan SET status='ditutup',ditutup_pada=coalesce(ditutup_pada,clock_timestamp())
    WHERE id=k.id;
  FOR r IN SELECT * FROM public.umkm_permintaan_kontak WHERE kebutuhan_id=k.id
    AND status IN ('diajukan','menunggu_izin') ORDER BY id FOR UPDATE LOOP
    UPDATE public.umkm_permintaan_kontak SET status='dibatalkan',versi=versi+1,
      aktivitas_pada=clock_timestamp(),ditutup_pada=clock_timestamp() WHERE id=r.id;
    PERFORM umkm_private.jejak_pemohon(r.id,'batal',r.status,'dibatalkan',r.profil_id);
  END LOOP;
  RETURN jsonb_build_object('id',k.id,'status','ditutup');
END $$;
CREATE FUNCTION umkm_private.pembukaan_sah(p_id uuid,p_cek_tampilan boolean DEFAULT true) RETURNS boolean
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.umkm_pembukaan_nomor b
    JOIN public.umkm_permintaan_kontak r ON r.id=b.permintaan_id
    JOIN public.umkm_profil p ON p.id=r.profil_id
    JOIN LATERAL (SELECT i.id,i.status FROM public.umkm_izin i WHERE i.profil_id=p.id
      AND i.kontak_versi_id=p.kontak_terakhir_id ORDER BY i.dibuat_pada DESC,i.id DESC LIMIT 1) i ON true
    WHERE r.id=p_id AND (NOT p_cek_tampilan OR (r.status='nomor_dibuka'
      AND NOT r.tahan_darurat AND p.status='terbit'))
      AND b.kontak_versi_id=p.kontak_terakhir_id AND b.izin_id=i.id AND i.status='diberikan')
$$;
CREATE FUNCTION public.umkm_ajukan_kontak(p_kebutuhan_id uuid,p_profil_ids uuid[],p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; k public.umkm_kebutuhan; r public.umkm_permintaan_kontak;
  lama umkm_private.operasi_publik; h text; pid uuid; daftar jsonb := '[]'; hasil jsonb;
BEGIN
  u := umkm_private.akun_suka();
  IF p_operasi_id IS NULL OR p_profil_ids IS NULL OR cardinality(p_profil_ids) NOT BETWEEN 1 AND 50
    OR array_position(p_profil_ids,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(u::text||p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('permintaan',p_kebutuhan_id,p_profil_ids));
  SELECT * INTO lama FROM umkm_private.operasi_publik WHERE aktor_uid=u AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash<>h THEN RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  SELECT t.* INTO k FROM public.umkm_kebutuhan t JOIN public.umkm_perusahaan p ON p.id=t.perusahaan_id
    WHERE t.id=p_kebutuhan_id AND p.pemohon_uid=u FOR UPDATE OF t;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF k.status<>'aktif' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  PERFORM umkm_private.jaga_laju('umkm_permintaan');
  FOR pid IN SELECT DISTINCT x FROM unnest(p_profil_ids) x ORDER BY x LOOP
    PERFORM 1 FROM public.umkm_profil WHERE id=pid AND status='terbit' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
    SELECT t.* INTO r FROM public.umkm_permintaan_kontak t WHERE t.kebutuhan_id=k.id AND t.profil_id=pid
      AND t.pemohon_uid=u AND (t.status IN ('diajukan','menunggu_izin')
        OR (t.status='nomor_dibuka' AND umkm_private.pembukaan_sah(t.id,false)))
      ORDER BY t.dibuat_pada DESC,t.id DESC LIMIT 1;
    IF NOT FOUND THEN
      INSERT INTO public.umkm_permintaan_kontak(kebutuhan_id,profil_id,pemohon_uid)
        VALUES(k.id,pid,u) RETURNING * INTO r;
      PERFORM umkm_private.jejak_pemohon(r.id,'ajukan',NULL,r.status,pid);
    END IF;
    daftar := daftar||jsonb_build_array(jsonb_build_object('id',r.id,'profil_id',pid,'kode',r.kode,
      'status',r.status,'versi',r.versi));
  END LOOP;
  hasil := jsonb_build_object('items',daftar);
  INSERT INTO umkm_private.operasi_publik(aktor_uid,operasi_id,aksi,payload_hash,hasil)
    VALUES(u,p_operasi_id,'umkm_permintaan',h,hasil);
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_permintaan_saya(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; c jsonb; hasil jsonb; berikut text;
BEGIN
  u := umkm_private.akun_suka(); c := umkm_private.baca_cursor(p_cursor,'permintaan-'||u::text);
  WITH halaman AS MATERIALIZED (
    SELECT r.* FROM public.umkm_permintaan_kontak r WHERE r.pemohon_uid=u AND (c IS NULL OR
      (r.dibuat_pada,r.id)<((c->>'waktu')::timestamptz,(c->>'id')::uuid))
    ORDER BY r.dibuat_pada DESC,r.id DESC LIMIT 21
  ), n AS (SELECT h.*,row_number() OVER (ORDER BY dibuat_pada DESC,id DESC) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kebutuhan_id',n.kebutuhan_id,'profil_id',n.profil_id,
      'kode',n.kode,'status',n.status,'versi',n.versi,'dibuat_pada',n.dibuat_pada,'alasan_tolak',n.alasan_tolak,
      'profil_nama',umkm_private.teks_pengawasan(r.nama,'Profil UMKM'),'petugas_nama',
      umkm_private.teks_pengawasan(s.nama,NULL),'petugas_hp_akhir',
      CASE WHEN length(regexp_replace(s.no_hp,'[^0-9]','','g'))>=4
        THEN right(regexp_replace(s.no_hp,'[^0-9]','','g'),4) END,'tahan_darurat',n.tahan_darurat)
      ORDER BY n.urut) FILTER(WHERE n.urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('permintaan-'||u::text,jsonb_build_object(
      'waktu',max(n.dibuat_pada) FILTER(WHERE urut=20),'id',max(n.id::text) FILTER(WHERE urut=20))) END
    INTO hasil,berikut FROM n JOIN public.umkm_profil p ON p.id=n.profil_id
    LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id LEFT JOIN public.petugas s ON s.id=n.petugas_id;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE FUNCTION public.umkm_batalkan_permintaan(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; r public.umkm_permintaan_kontak;
BEGIN
  u := umkm_private.akun_suka();
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE id=p_id AND pemohon_uid=u FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF r.status='dibatalkan' THEN RETURN jsonb_build_object('id',r.id,'status',r.status); END IF;
  IF r.status NOT IN ('diajukan','menunggu_izin') THEN
    RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  UPDATE public.umkm_permintaan_kontak SET status='dibatalkan',versi=versi+1,
    ditutup_pada=clock_timestamp(),aktivitas_pada=clock_timestamp() WHERE id=r.id;
  PERFORM umkm_private.jejak_pemohon(r.id,'batal',r.status,'dibatalkan',r.profil_id);
  RETURN jsonb_build_object('id',r.id,'status','dibatalkan');
END $$;
CREATE FUNCTION public.umkm_baca_nomor(p_permintaan_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; r public.umkm_permintaan_kontak; hasil jsonb;
BEGIN
  u := umkm_private.akun_suka();
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE id=p_permintaan_id AND pemohon_uid=u FOR SHARE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOMOR_TIDAK_TERSEDIA' USING ERRCODE='40001'; END IF;
  PERFORM 1 FROM public.umkm_profil WHERE id=r.profil_id FOR SHARE;
  IF NOT umkm_private.pembukaan_sah(r.id) THEN
    RAISE EXCEPTION 'NOMOR_TIDAK_TERSEDIA' USING ERRCODE='40001'; END IF;
  SELECT jsonb_build_object('nomor',k.nomor,'petugas_nama',umkm_private.teks_pengawasan(s.nama,'Petugas'),
    'dibuka_pada',b.dibuat_pada,'kode',r.kode) INTO hasil FROM public.umkm_pembukaan_nomor b
    JOIN public.umkm_kontak_versi k ON k.id=b.kontak_versi_id JOIN public.petugas s ON s.id=b.petugas_id
    WHERE b.permintaan_id=r.id AND b.pemohon_uid=u;
  IF hasil IS NULL THEN RAISE EXCEPTION 'NOMOR_TIDAK_TERSEDIA' USING ERRCODE='40001'; END IF;
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_tautkan_akun(p_kode text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; perusahaan uuid; kebutuhan uuid; r public.umkm_permintaan_kontak; kode_bersih text;
BEGIN
  u := umkm_private.akun_suka();
  SELECT id INTO perusahaan FROM public.umkm_perusahaan WHERE pemohon_uid=u;
  IF perusahaan IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
  PERFORM umkm_private.jaga_laju('umkm_tautkan');
  kode_bersih := upper(regexp_replace(coalesce(p_kode,''),'[[:space:]-]','','g'));
  IF kode_bersih !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$' THEN RETURN '{"tertaut":false}'::jsonb; END IF;
  SELECT kebutuhan_id INTO kebutuhan FROM public.umkm_permintaan_kontak WHERE tautan_hash=
    encode(extensions.digest(kode_bersih,'sha256'),'hex') AND pemohon_uid IS NULL;
  IF NOT FOUND THEN RETURN '{"tertaut":false}'::jsonb; END IF;
  -- Urutan kunci sama dengan penutupan kebutuhan dan keputusan petugas.
  PERFORM 1 FROM public.umkm_kebutuhan WHERE id=kebutuhan FOR UPDATE;
  SELECT * INTO r FROM public.umkm_permintaan_kontak WHERE tautan_hash=
    encode(extensions.digest(kode_bersih,'sha256'),'hex') AND pemohon_uid IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN '{"tertaut":false}'::jsonb; END IF;
  UPDATE public.umkm_kebutuhan SET perusahaan_id=perusahaan WHERE id=r.kebutuhan_id;
  UPDATE public.umkm_permintaan_kontak SET pemohon_uid=u,tautan_hash=NULL,versi=versi+1,
    aktivitas_pada=clock_timestamp() WHERE id=r.id;
  PERFORM umkm_private.jejak_pemohon(r.id,'tautkan',r.status,r.status,r.profil_id);
  RETURN jsonb_build_object('id',r.id,'kebutuhan_id',r.kebutuhan_id,'status',r.status);
END $$;
CREATE FUNCTION public.umkm_cari_rekomendasi(p_kebutuhan_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; k public.umkm_kebutuhan; hasil jsonb;
BEGIN
  u := umkm_private.akun_suka();
  SELECT t.* INTO k FROM public.umkm_kebutuhan t JOIN public.umkm_perusahaan c ON c.id=t.perusahaan_id
    WHERE t.id=p_kebutuhan_id AND c.pemohon_uid=u;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  SELECT coalesce(jsonb_agg(umkm_private.kartu(q.id) ORDER BY q.dekat DESC,q.skor DESC,q.id),'[]'::jsonb)
    INTO hasil FROM (SELECT p.id,r.kabupaten_kota=k.kabupaten_kota dekat,coalesce(s.skor,0) skor
      FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
      LEFT JOIN public.umkm_skor s ON s.profil_id=p.id WHERE p.status='terbit' AND r.kategori=k.kategori
      AND NOT EXISTS (SELECT 1 FROM public.umkm_permintaan_kontak t
        WHERE t.kebutuhan_id=k.id AND t.profil_id=p.id)
      ORDER BY (r.kabupaten_kota=k.kabupaten_kota) DESC NULLS LAST,coalesce(s.skor,0) DESC,p.id LIMIT 10) q;
  RETURN jsonb_build_object('items',hasil);
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.umkm_tahap_b(),public.umkm_perusahaan_saya(),
  public.umkm_simpan_perusahaan(text,text,boolean),public.umkm_kebutuhan_saya(text),
  public.umkm_simpan_kebutuhan(text,text,text,uuid),public.umkm_tutup_kebutuhan(uuid),
  public.umkm_ajukan_kontak(uuid,uuid[],uuid),public.umkm_permintaan_saya(text),
  public.umkm_batalkan_permintaan(uuid),public.umkm_baca_nomor(uuid),public.umkm_tautkan_akun(text),
  public.umkm_cari_rekomendasi(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_tahap_b() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_perusahaan_saya(),public.umkm_simpan_perusahaan(text,text,boolean),
  public.umkm_kebutuhan_saya(text),public.umkm_simpan_kebutuhan(text,text,text,uuid),
  public.umkm_tutup_kebutuhan(uuid),public.umkm_ajukan_kontak(uuid,uuid[],uuid),public.umkm_permintaan_saya(text),
  public.umkm_batalkan_permintaan(uuid),public.umkm_baca_nomor(uuid),public.umkm_tautkan_akun(text),
  public.umkm_cari_rekomendasi(uuid) TO authenticated;
