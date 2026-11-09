-- Jalankan hanya sesudah pemulihan aplikasi tahap B, urutan 0011 lalu 0010.

-- Tabel, revisi, kontak, kepemilikan dan bukti dipertahankan; tidak ada data yang dihapus.

CREATE OR REPLACE FUNCTION public.umkm_klaim_profil(p_profil_id uuid,p_alasan text,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_detail_klaim(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_ambil_klaim(p_id uuid,p_expected_version integer,p_operasi_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_putuskan_klaim(p_id uuid,p_expected_version integer,p_operasi_id uuid,
  p_keputusan text,p_alasan text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_statistik_pemilik(p_profil_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_perusahaan_penerima(p_profil_id uuid,p_cursor text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

CREATE OR REPLACE FUNCTION public.umkm_cabut_kepemilikan(p_id uuid,p_expected_version integer,p_operasi_id uuid,
  p_alasan text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN RAISE EXCEPTION 'MODUL_BELUM_TERSEDIA' USING ERRCODE='55000'; END $$;

DROP TRIGGER IF EXISTS umkm_suka_pemilik ON public.umkm_pemilik;

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
  RETURN hasil;
END $$;

CREATE OR REPLACE FUNCTION public.umkm_suka(p_profil_id uuid,p_aktif boolean) RETURNS jsonb
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

-- Jejak pengawasan kembali ke versi 0009.
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
