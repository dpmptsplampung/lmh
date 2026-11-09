-- Jalankan sesudah rollback 0007 dan 0006 serta pemulihan aplikasi G2.
-- Tabel suka, total dan agregat statistik tetap disimpan tanpa akses langsung.
-- Penanda harian sampai hari ini dihapus karena dedup tidak diperlukan saat sakelar mati.
-- Suka tidak bisa dibatalkan selama rollback karena RPC suka ditutup.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname='umkm_skor_harian';
UPDATE umkm_private.statistik SET telemetri_opsional_aktif=false WHERE tunggal;
DELETE FROM public.umkm_stat_kejadian WHERE hari <= (now() AT TIME ZONE 'Asia/Jakarta')::date;
CREATE OR REPLACE FUNCTION umkm_private.jaga_laju(p_aksi text) RETURNS void
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
REVOKE ALL ON FUNCTION public.umkm_suka(uuid,boolean),public.umkm_status_suka(uuid),
  public.umkm_statistik_status(),public.umkm_atur_telemetri(boolean,text,boolean),
  public.umkm_catat_statistik(text,uuid,text,uuid),public.umkm_catat_tanpa_hasil(text,text,uuid),
  public.umkm_laporan_statistik(text),public.umkm_ekspor_statistik()
  FROM PUBLIC,anon,authenticated,service_role;
