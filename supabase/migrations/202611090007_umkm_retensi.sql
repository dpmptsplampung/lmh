-- Retensi berbatas dan perlindungan foto draf tanpa menyimpan status objek baru.
CREATE INDEX umkm_pesan_retensi ON public.umkm_pesan_kontak((coalesce(dibalas_pada,aktivitas_pada)),id);
CREATE INDEX umkm_laporan_retensi ON public.umkm_laporan((coalesce(selesai_pada,aktivitas_pada)),id);
CREATE INDEX umkm_foto_key_draf ON public.umkm_foto(r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX umkm_riwayat_revisi_waktu ON public.umkm_riwayat((referensi->>'revisi_id'),dibuat_pada DESC);

CREATE FUNCTION umkm_private.bersihkan_retensi() RETURNS jsonb
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
CREATE FUNCTION public.umkm_draf_dilindungi(p_keys text[]) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE hasil jsonb;
BEGIN
  IF p_keys IS NULL OR cardinality(p_keys)>1000 OR EXISTS (
    SELECT 1 FROM unnest(p_keys) k WHERE k IS NULL OR length(k)>300 OR k NOT LIKE 'umkm-draf/%') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE='22023'; END IF;
  SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) INTO hasil FROM (
    SELECT DISTINCT f.r2_key k FROM public.umkm_foto f
    JOIN public.umkm_revisi r ON r.id=f.revisi_id JOIN public.umkm_profil p ON p.id=r.profil_id
    WHERE f.r2_key=ANY(p_keys) AND (
      p.revisi_disetujui_id=r.id
      OR (r.keputusan IS NULL AND p.revisi_terakhir_id=r.id AND greatest(r.dibuat_pada,coalesce(
        (SELECT max(h.dibuat_pada) FROM public.umkm_riwayat h WHERE h.referensi->>'revisi_id'=r.id::text),
        r.dibuat_pada))>now()-interval '90 days')
      OR (r.keputusan='ditolak' AND coalesce((SELECT max(h.dibuat_pada) FROM public.umkm_riwayat h
        WHERE h.aksi='putusan' AND h.referensi->>'revisi_id'=r.id::text),r.dibuat_pada)>now()-interval '30 days'))
  ) x;
  RETURN jsonb_build_object('dilindungi',hasil);
END $$;
REVOKE ALL ON FUNCTION umkm_private.bersihkan_retensi(),public.umkm_draf_dilindungi(text[])
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.umkm_draf_dilindungi(text[]) TO service_role;
SELECT cron.schedule('umkm_retensi_harian','15 19 * * *','SELECT umkm_private.bersihkan_retensi()');
