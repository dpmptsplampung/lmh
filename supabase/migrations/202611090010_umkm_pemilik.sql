-- Pemilik terverifikasi dan revisi mandiri memakai alur pemeriksaan profil yang sudah ada.
CREATE TABLE public.umkm_pemilik (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profil_id uuid NOT NULL REFERENCES public.umkm_profil(id),
  akun_uid uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'diajukan' CHECK (status IN ('diajukan','disetujui','ditolak')),
  alasan text CHECK (length(alasan)<=240), alasan_tolak text CHECK (length(alasan_tolak)<=240),
  petugas_id uuid REFERENCES public.petugas(id), diperiksa_oleh uuid REFERENCES public.petugas(id),
  dibuat_pada timestamptz NOT NULL DEFAULT clock_timestamp(), diperiksa_pada timestamptz,
  versi integer NOT NULL DEFAULT 1 CHECK (versi>0), UNIQUE (profil_id,akun_uid)
);
ALTER TABLE public.umkm_pemilik ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.umkm_pemilik FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX umkm_pemilik_akun ON public.umkm_pemilik(akun_uid,dibuat_pada DESC,id DESC);
CREATE INDEX umkm_pemilik_antrean ON public.umkm_pemilik(status,dibuat_pada,id);
CREATE INDEX umkm_pemilik_petugas ON public.umkm_pemilik(petugas_id);
CREATE INDEX umkm_pemilik_pemeriksa ON public.umkm_pemilik(diperiksa_oleh);
ALTER TABLE public.umkm_profil DROP CONSTRAINT umkm_profil_sumber_check;
ALTER TABLE public.umkm_profil ADD CONSTRAINT umkm_profil_sumber_check
  CHECK (sumber IN ('kurasi','satudata','loket','mandiri'));
ALTER TABLE public.umkm_revisi ALTER COLUMN dibuat_oleh DROP NOT NULL;
ALTER TABLE public.umkm_revisi ADD COLUMN aktor_uid uuid;
ALTER TABLE public.umkm_revisi ADD CONSTRAINT umkm_revisi_pelaku
  CHECK (num_nonnulls(dibuat_oleh,aktor_uid)=1);
ALTER TABLE public.umkm_kontak_versi ALTER COLUMN dibuat_oleh DROP NOT NULL;
ALTER TABLE public.umkm_kontak_versi ADD COLUMN aktor_uid uuid;
ALTER TABLE public.umkm_kontak_versi ADD CONSTRAINT umkm_kontak_pelaku
  CHECK (num_nonnulls(dibuat_oleh,aktor_uid)=1);
ALTER TABLE public.umkm_izin ALTER COLUMN aktor_id DROP NOT NULL;
ALTER TABLE public.umkm_izin ADD COLUMN aktor_uid uuid;
ALTER TABLE public.umkm_izin ADD CONSTRAINT umkm_izin_pelaku CHECK (num_nonnulls(aktor_id,aktor_uid)=1);

CREATE FUNCTION public.umkm_tahap_c() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT '{"aktif":true}'::jsonb $$;

CREATE FUNCTION umkm_private.hak_pemilik(p_profil uuid,p_draf boolean DEFAULT false)
RETURNS public.umkm_pemilik
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; m public.umkm_pemilik;
BEGIN
  u := umkm_private.akun_suka();
  SELECT o.* INTO m FROM public.umkm_pemilik o JOIN public.umkm_profil p ON p.id=o.profil_id
  WHERE o.profil_id=p_profil AND o.akun_uid=u AND (o.status='disetujui' OR
    (p_draf AND o.status='diajukan' AND p.sumber='mandiri' AND p.terbit_pada IS NULL
      AND EXISTS (SELECT 1 FROM public.umkm_revisi r
        WHERE r.profil_id=p.id AND r.versi=1 AND r.aktor_uid=u)));
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  RETURN m;
END $$;

-- Catatan petugas hanya dari penolakan revisi terakhir yang dibuat akun ini sendiri.
CREATE FUNCTION umkm_private.usaha_json(m public.umkm_pemilik) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'profil_nama',r.nama,'status',p.status,'versi',p.versi,
    'pemilik_id',m.id,'pemilik_status',m.status,'dibuat_pada',m.dibuat_pada,'alasan_tolak',m.alasan_tolak,
    'catatan_petugas',CASE WHEN akhir.keputusan='ditolak' AND akhir.aktor_uid=m.akun_uid THEN
      (SELECT h.alasan FROM public.umkm_riwayat h WHERE h.objek_id=p.id AND h.aksi='putusan'
        AND h.referensi->>'revisi_id'=akhir.id::text AND h.referensi->>'keputusan'='ditolak'
        ORDER BY h.dibuat_pada DESC,h.id DESC LIMIT 1) END,
    'memiliki_nib',r.memiliki_nib,
    'perubahan',CASE WHEN m.status='disetujui' AND p.terbit_pada IS NOT NULL
      AND p.revisi_terakhir_id IS DISTINCT FROM p.revisi_disetujui_id THEN
      CASE WHEN akhir.keputusan IS NULL THEN 'menunggu' WHEN akhir.keputusan='ditolak' THEN 'ditolak' END END)
  FROM public.umkm_profil p LEFT JOIN public.umkm_revisi akhir ON akhir.id=p.revisi_terakhir_id
  LEFT JOIN public.umkm_revisi r ON r.id=CASE WHEN m.status='disetujui'
    OR (p.sumber='mandiri' AND p.terbit_pada IS NULL AND EXISTS (SELECT 1 FROM public.umkm_revisi awal
      WHERE awal.profil_id=p.id AND awal.versi=1 AND awal.aktor_uid=m.akun_uid))
    THEN p.revisi_terakhir_id ELSE p.revisi_disetujui_id END WHERE p.id=m.profil_id
$$;

CREATE FUNCTION public.umkm_usaha_saya(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE u uuid; c jsonb; hasil jsonb; berikut text;
BEGIN
  u := umkm_private.akun_suka(); c := umkm_private.baca_cursor(p_cursor,'usaha.'||u::text);
  WITH halaman AS MATERIALIZED (
    SELECT m.* FROM public.umkm_pemilik m WHERE m.akun_uid=u AND (c IS NULL OR
      (m.dibuat_pada,m.id)<((c->>'waktu')::timestamptz,(c->>'id')::uuid))
    ORDER BY m.dibuat_pada DESC,m.id DESC LIMIT 21
  ), nomor AS (SELECT m.*,row_number() OVER (ORDER BY dibuat_pada DESC,id DESC) urut FROM halaman m)
  SELECT coalesce(jsonb_agg(umkm_private.usaha_json(m) ORDER BY n.urut)
      FILTER (WHERE n.urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('usaha.'||u::text,jsonb_build_object(
      'waktu',max(n.dibuat_pada) FILTER (WHERE urut=20),'id',max(n.id::text) FILTER (WHERE urut=20))) END
    INTO hasil,berikut FROM nomor n JOIN public.umkm_pemilik m ON m.id=n.id;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;

CREATE FUNCTION public.umkm_detail_usaha(p_profil_id uuid) RETURNS jsonb
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

CREATE FUNCTION public.umkm_akses_draf_pemilik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  PERFORM umkm_private.hak_pemilik(p_profil_id,true);
  RETURN jsonb_build_object('diizinkan',true);
END $$;

CREATE FUNCTION umkm_private.mutasi_pemilik(p_aksi text,p_profil_id uuid,p_data jsonb,
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

CREATE FUNCTION public.umkm_daftar_usaha(p_data jsonb,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_pemilik('daftar',NULL,p_data,NULL,p_operasi_id) $$;
CREATE FUNCTION public.umkm_simpan_draf(p_profil_id uuid,p_data jsonb,p_expected_version integer,
  p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_pemilik('draf',p_profil_id,p_data,p_expected_version,p_operasi_id) $$;
CREATE FUNCTION public.umkm_cabut_izin_pemilik(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_pemilik('cabut',p_profil_id,NULL,p_expected_version,p_operasi_id) $$;

CREATE FUNCTION umkm_private.sahkan_pendaftar() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.terbit_pada IS NULL AND NEW.terbit_pada IS NOT NULL AND NEW.sumber='mandiri' THEN
    UPDATE public.umkm_pemilik SET status='disetujui',diperiksa_oleh=NEW.petugas_id,
      diperiksa_pada=clock_timestamp(),versi=versi+1 WHERE profil_id=NEW.id AND status='diajukan';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER umkm_sahkan_pendaftar AFTER UPDATE OF terbit_pada ON public.umkm_profil
FOR EACH ROW EXECUTE FUNCTION umkm_private.sahkan_pendaftar();

-- Simpanan petugas pada profil mandiri tidak mengganti asal profil.
CREATE FUNCTION umkm_private.jaga_sumber_mandiri() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF OLD.sumber='mandiri' THEN
    NEW.sumber := OLD.sumber;
    NEW.sumber_ref := OLD.sumber_ref;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER umkm_jaga_sumber_mandiri BEFORE UPDATE OF sumber,sumber_ref ON public.umkm_profil
FOR EACH ROW EXECUTE FUNCTION umkm_private.jaga_sumber_mandiri();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.umkm_tahap_c(),public.umkm_usaha_saya(text),public.umkm_detail_usaha(uuid),
  public.umkm_daftar_usaha(jsonb,uuid),public.umkm_simpan_draf(uuid,jsonb,integer,uuid),
  public.umkm_cabut_izin_pemilik(uuid,integer,uuid),public.umkm_akses_draf_pemilik(uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_tahap_c() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.umkm_usaha_saya(text),public.umkm_detail_usaha(uuid),
  public.umkm_daftar_usaha(jsonb,uuid),public.umkm_simpan_draf(uuid,jsonb,integer,uuid),
  public.umkm_cabut_izin_pemilik(uuid,integer,uuid),public.umkm_akses_draf_pemilik(uuid) TO authenticated;
