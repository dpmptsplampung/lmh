-- Pengawasan fase A hanya agregat dan jejak aman; darurat tidak membuka isi privat atau nomor.
CREATE INDEX umkm_jejak_urutan ON public.umkm_riwayat(dibuat_pada DESC,id DESC);
CREATE FUNCTION umkm_private.aktor_pengawasan() RETURNS public.petugas
LANGUAGE plpgsql STABLE SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE='28000'; END IF;
  SELECT * INTO a FROM public.petugas WHERE auth_user_id=auth.uid();
  IF a.id IS NULL OR NOT a.aktif OR NOT public.sesi_valid() OR NOT (a.role IN ('admin','front_office')) THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  RETURN a;
END $$;
CREATE FUNCTION umkm_private.teks_pengawasan(p_teks text,p_default text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, pg_temp AS $$
  SELECT CASE WHEN p_teks IS NULL OR umkm_private.ada_kontak(p_teks) THEN p_default ELSE p_teks END
$$;
CREATE FUNCTION public.umkm_ringkasan_pengawasan() RETURNS jsonb
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
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_jejak_pengawasan(p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE c jsonb; hasil jsonb; berikut text;
BEGIN
  PERFORM umkm_private.aktor_pengawasan();
  c := umkm_private.baca_cursor(p_cursor,'pengawasan');
  WITH halaman AS MATERIALIZED (
    SELECT h.* FROM public.umkm_riwayat h WHERE h.jenis_objek IN ('profil','pesan','laporan','petugas')
      AND h.aksi IN ('simpan','ambil','putusan','visibilitas','izin','akses_kontak','atur_pemeriksa',
        'selesai','darurat_sembunyikan','darurat_catat_pencabutan','selesai_mendesak')
      AND (c IS NULL OR (h.dibuat_pada,h.id)<((c->>'waktu')::timestamptz,(c->>'id')::uuid))
    ORDER BY h.dibuat_pada DESC,h.id DESC LIMIT 21
  ), nomor AS (SELECT h.*,row_number() OVER (ORDER BY h.dibuat_pada DESC,h.id DESC) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'aksi',h.aksi,'peran',
      CASE WHEN h.peran IN ('admin','petugas','front_office') THEN h.peran ELSE 'system' END,
    'aktor_nama',umkm_private.teks_pengawasan(s.nama,'Petugas'),'dibuat_pada',h.dibuat_pada,
    'status_lama',CASE WHEN h.status_lama IN ('diajukan','terbit','disembunyikan','ditolak','baru','ditangani')
      THEN h.status_lama ELSE NULL END,
    'status_baru',CASE WHEN h.status_baru IN ('diajukan','terbit','disembunyikan','ditolak','baru','ditangani')
      THEN h.status_baru ELSE NULL END,
    'alasan',umkm_private.teks_pengawasan(h.alasan,NULL),'profil_id',p.id,
    'profil_nama',umkm_private.teks_pengawasan(r.nama,'Profil belum terbit'))
    ORDER BY h.urut) FILTER (WHERE h.urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN umkm_private.buat_cursor('pengawasan',jsonb_build_object(
      'waktu',max(h.dibuat_pada) FILTER (WHERE h.urut=20),'id',max(h.id::text) FILTER (WHERE h.urut=20))) ELSE NULL END
    INTO hasil,berikut FROM nomor h LEFT JOIN public.petugas s ON s.id=h.aktor_id
    LEFT JOIN public.umkm_profil p ON h.jenis_objek='profil' AND p.id=h.objek_id
    LEFT JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE FUNCTION public.umkm_cari_pengawasan(p_q text,p_cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE q text := btrim(p_q); hasil jsonb; berikut text;
BEGIN
  PERFORM umkm_private.aktor_pengawasan();
  IF q IS NULL OR length(q) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  WITH halaman AS MATERIALIZED (
    SELECT p.id,r.nama,p.status,p.versi FROM public.umkm_profil p
    JOIN public.umkm_revisi r ON r.id=p.revisi_disetujui_id
    WHERE strpos(lower(r.nama),lower(q))>0 AND NOT umkm_private.ada_kontak(r.nama)
      AND (p_cursor IS NULL OR p.id>p_cursor) ORDER BY p.id LIMIT 21
  ), nomor AS (SELECT h.*,row_number() OVER (ORDER BY id) urut FROM halaman h)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'nama',nama,'status',status,'versi',versi)
    ORDER BY urut) FILTER (WHERE urut<=20),'[]'::jsonb),
    CASE WHEN count(*)>20 THEN max(id::text) FILTER (WHERE urut=20) ELSE NULL END INTO hasil,berikut FROM nomor;
  RETURN jsonb_build_object('items',hasil,'next_cursor',berikut);
END $$;
CREATE FUNCTION umkm_private.mutasi_darurat(p_profil_id uuid,p_aksi text,p_alasan text,
  p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; lama public.umkm_riwayat; h text; hasil jsonb; status_awal text;
BEGIN
  IF p_aksi='selesai_mendesak' THEN a := umkm_private.aktor();
  ELSE a := umkm_private.aktor_pengawasan(); END IF;
  IF p_profil_id IS NULL OR p_operasi_id IS NULL OR p_expected_version IS NULL OR p_expected_version<1
    OR p_aksi IS NULL OR p_aksi NOT IN ('sembunyikan','catat_pencabutan','selesai_mendesak') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  IF p_aksi<>'selesai_mendesak' AND (p_alasan IS NULL OR length(btrim(p_alasan)) NOT BETWEEN 1 AND 240
    OR umkm_private.ada_kontak(p_alasan)) THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(a.id::text || p_operasi_id::text,0));
  h := umkm_private.sidik(jsonb_build_array('darurat',p_profil_id,p_aksi,p_alasan,p_expected_version));
  SELECT * INTO lama FROM public.umkm_riwayat WHERE aktor_id=a.id AND operasi_id=p_operasi_id;
  IF FOUND THEN
    IF lama.payload_hash IS DISTINCT FROM h THEN
      RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE='40001'; END IF;
    RETURN lama.hasil;
  END IF;
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.versi<>p_expected_version THEN RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE='40001'; END IF;
  status_awal := p.status;
  IF p_aksi='selesai_mendesak' THEN
    IF p.petugas_id IS DISTINCT FROM a.id THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
    IF NOT p.mendesak THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
    UPDATE public.umkm_profil SET mendesak=false,versi=versi+1 WHERE id=p.id RETURNING * INTO p;
  ELSE
    IF p_aksi='sembunyikan' THEN
      IF p.status<>'terbit' THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
      UPDATE public.umkm_profil SET status='disembunyikan',mendesak=true,versi=versi+1 WHERE id=p.id
        RETURNING * INTO p;
    ELSE
      IF p.kontak_terakhir_id IS NULL THEN RAISE EXCEPTION 'KONFLIK_STATUS' USING ERRCODE='40001'; END IF;
      INSERT INTO public.umkm_izin(profil_id,kontak_versi_id,status,aktor_id)
        VALUES(p.id,p.kontak_terakhir_id,'dicabut',a.id);
      UPDATE public.umkm_profil SET mendesak=true,versi=versi+1 WHERE id=p.id RETURNING * INTO p;
    END IF;
  END IF;
  hasil := jsonb_build_object('id',p.id,'versi',p.versi,'status',p.status,'mendesak',p.mendesak);
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,
    alasan,operasi_id,payload_hash,hasil,referensi) VALUES(p.id,'profil',
    CASE WHEN p_aksi='selesai_mendesak' THEN p_aksi ELSE 'darurat_' || p_aksi END,a.id,a.role,status_awal,p.status,
    CASE WHEN p_aksi='selesai_mendesak' THEN NULL ELSE btrim(p_alasan) END,p_operasi_id,h,hasil,
    jsonb_build_object('profil_id',p.id));
  RETURN hasil;
END $$;
CREATE FUNCTION public.umkm_tindakan_darurat(p_profil_id uuid,p_aksi text,p_alasan text,
  p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_darurat(p_profil_id,p_aksi,p_alasan,p_expected_version,p_operasi_id)
$$;
CREATE FUNCTION public.umkm_selesaikan_mendesak(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_darurat(p_profil_id,'selesai_mendesak',NULL,p_expected_version,p_operasi_id)
$$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA umkm_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.umkm_ringkasan_pengawasan(),public.umkm_jejak_pengawasan(text),
  public.umkm_cari_pengawasan(text,uuid),public.umkm_tindakan_darurat(uuid,text,text,integer,uuid),
  public.umkm_selesaikan_mendesak(uuid,integer,uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.umkm_ringkasan_pengawasan(),public.umkm_jejak_pengawasan(text),
  public.umkm_cari_pengawasan(text,uuid),public.umkm_tindakan_darurat(uuid,text,text,integer,uuid),
  public.umkm_selesaikan_mendesak(uuid,integer,uuid) TO authenticated;
