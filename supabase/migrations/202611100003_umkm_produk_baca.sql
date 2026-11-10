-- Produk publik memakai revisi terbit dan syarat foto yang sama dengan galeri profil.
CREATE FUNCTION umkm_private.produk_json(p_revisi_id uuid,p_publik boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('urutan',p.urutan,'nama',p.nama,'keterangan',p.keterangan,
    'kapasitas_jumlah',p.kapasitas_jumlah,'kapasitas_satuan',p.kapasitas_satuan,'kapasitas_periode',p.kapasitas_periode)
    || CASE WHEN p_publik THEN jsonb_build_object('foto',(SELECT jsonb_build_object('id',f.id,'url',
      CASE WHEN f.asal='unggahan' THEN f.url_publik ELSE f.url END)
      FROM public.umkm_foto f WHERE f.revisi_id=p.revisi_id AND f.produk_urutan=p.urutan
        AND NOT f.tersembunyi AND NOT f.perlu_review
        AND (f.asal IN ('satudata','eksternal') OR (f.r2_key_publik IS NOT NULL AND f.unggah_etag IS NOT NULL))))
      ELSE '{}'::jsonb END ORDER BY p.urutan),'[]'::jsonb)
  FROM public.umkm_produk p WHERE p.revisi_id=p_revisi_id
$$;

CREATE OR REPLACE FUNCTION umkm_private.foto_publik(p_revisi_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'url',
    CASE WHEN f.asal='unggahan' THEN f.url_publik ELSE f.url END) ORDER BY f.utama DESC, f.id),'[]'::jsonb)
  FROM public.umkm_foto f WHERE f.revisi_id=p_revisi_id AND f.produk_urutan IS NULL AND NOT f.tersembunyi AND NOT f.perlu_review
    AND (f.asal IN ('satudata','eksternal') OR (f.r2_key_publik IS NOT NULL AND f.unggah_etag IS NOT NULL))
$$;

CREATE OR REPLACE FUNCTION umkm_private.kartu(p_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT jsonb_build_object('id',p.id,'nama',r.nama,'jenis',r.jenis,'kategori',r.kategori,
    'kecamatan',r.kecamatan,'spesifik',r.spesifik,'kabupaten_kota',r.kabupaten_kota,'deskripsi',left(r.deskripsi,240),
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
    'kecamatan',r.kecamatan,'bentuk_usaha',nullif(r.bentuk_usaha,'Lainnya'),
    'tahun_mulai',r.tahun_mulai,'skala',CASE WHEN umkm_private.label_omzet(r.omzet_rentang) IS NOT NULL
      THEN umkm_private.skala_dari_omzet(r.omzet_rentang) END,
    'omzet_label',umkm_private.label_omzet(r.omzet_rentang),'tenaga_kerja_rentang',r.tenaga_kerja_rentang,
    'produk',umkm_private.produk_json(r.id, true),'instagram',r.instagram,'tiktok',r.tiktok,'foto',umkm_private.foto_publik(r.id),
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
        WHEN r.kategori ILIKE q ESCAPE E'\\' OR EXISTS (SELECT 1 FROM public.umkm_produk pr WHERE pr.revisi_id=r.id AND pr.nama ILIKE q ESCAPE E'\\') THEN 1 ELSE 2 END tingkat,
      coalesce(s.skor,0) skor,md5(hari_wib::text || p.id::text) acak
    FROM public.umkm_profil p JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    LEFT JOIN public.umkm_skor s ON s.profil_id=p.id AND s.snapshot=snap
    WHERE p.status='terbit' AND p.terbit_pada<=batas
      AND (q IS NULL OR r.spesifik ILIKE q ESCAPE E'\\' OR r.kategori ILIKE q ESCAPE E'\\'
        OR EXISTS (SELECT 1 FROM public.umkm_produk pr WHERE pr.revisi_id=r.id AND pr.nama ILIKE q ESCAPE E'\\') OR r.nama ILIKE q ESCAPE E'\\' OR r.deskripsi ILIKE q ESCAPE E'\\')
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
    'sumber_ref',p.sumber_ref,'produk',umkm_private.produk_json(p.revisi_terakhir_id, false),'revisi',to_jsonb(r),'foto',coalesce((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.id)
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
    'produk',CASE WHEN draf THEN umkm_private.produk_json(p.revisi_terakhir_id, false) ELSE '[]'::jsonb END,
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
REVOKE ALL ON FUNCTION umkm_private.produk_json(uuid,boolean),umkm_private.foto_publik(uuid),
  umkm_private.kartu(uuid) FROM PUBLIC, anon, authenticated, service_role;
