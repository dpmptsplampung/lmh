-- Jalankan sebelum rollback 0008 dan pulihkan aplikasi tahap A G3 pada jendela yang sama.
-- Tutup baca nomor segera; tabel dan bukti tetap disimpan. Tidak ada penghapusan catatan.
CREATE OR REPLACE FUNCTION public.umkm_tahap_b() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT '{"aktif":false}'::jsonb $$;
REVOKE ALL ON FUNCTION public.umkm_baca_nomor(uuid) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.umkm_detail_permintaan(uuid),public.umkm_setujui_dan_buka(uuid,integer,uuid),
  public.umkm_tolak_permintaan(uuid,integer,uuid,text),public.umkm_tahan_permintaan(uuid,text,integer,uuid),
  public.umkm_lepas_tahan(uuid,integer,uuid),
  public.umkm_bantu_permintaan(text,text,text,text,text,text,text,uuid,uuid),
  public.umkm_catat_pemberitahuan(uuid),public.umkm_catat_hasil(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.umkm_ubah_izin(p_profil_id uuid,p_expected_version integer,p_operasi_id uuid,p_status text)
  RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
 SELECT umkm_private.mutasi('izin',jsonb_build_object('profil_id',p_profil_id,'expected_version',p_expected_version,
   'status',p_status),p_operasi_id)
$$;
CREATE OR REPLACE FUNCTION public.umkm_akses_kontak_petugas(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE a public.petugas; p public.umkm_profil; nomor text;
BEGIN
  a := umkm_private.aktor();
  -- Kunci sama dengan takeover agar akses nomor tidak lolos sesudah tugas pindah.
  SELECT * INTO p FROM public.umkm_profil WHERE id=p_profil_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE='P0002'; END IF;
  IF p.petugas_id IS DISTINCT FROM a.id OR NOT (p.mendesak OR EXISTS (
    SELECT 1 FROM public.umkm_revisi r WHERE r.id=p.revisi_terakhir_id AND r.keputusan IS NULL
  )) THEN RAISE EXCEPTION 'DILARANG' USING ERRCODE='42501'; END IF;
  SELECT k.nomor INTO nomor FROM public.umkm_kontak_versi k WHERE id=p.kontak_terakhir_id;
  INSERT INTO public.umkm_riwayat(objek_id,jenis_objek,aksi,aktor_id,peran,status_lama,status_baru,referensi)
    VALUES(p.id,'profil','akses_kontak',a.id,a.role,p.status,p.status,
      jsonb_build_object('profil_id',p.id,'kontak_versi_id',p.kontak_terakhir_id));
  RETURN jsonb_build_object('nomor',nomor);
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
CREATE OR REPLACE FUNCTION public.umkm_ambil_pekerjaan(p_jenis text,p_id uuid,p_expected_version integer,p_operasi_id uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT umkm_private.mutasi_pekerjaan(p_jenis,p_id,p_expected_version,p_operasi_id,'ambil')
$$;
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
  RETURN hasil;
END $$;
CREATE OR REPLACE FUNCTION public.umkm_jejak_pengawasan(p_cursor text DEFAULT NULL) RETURNS jsonb
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
CREATE OR REPLACE FUNCTION umkm_private.bersihkan_retensi() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE pesan integer; laporan integer; operasi integer; kejadian integer; harian integer;
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
  RETURN jsonb_build_object('pesan',pesan,'laporan',laporan,'operasi_publik',operasi,'dedup',kejadian,
    'harian',harian,'tanpa_hasil',kelompok,'bulanan',bulanan);
END $$;

-- Retensi tahap B tetap berjalan sesudah rollback, tanpa mengaktifkan kembali akses.
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
