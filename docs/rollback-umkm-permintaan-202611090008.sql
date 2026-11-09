-- Jalankan sesudah rollback 0009 dan pemulihan aplikasi tahap A G3.
-- Tutup tahap B tanpa menghapus tabel, pembukaan, consent atau riwayat yang sudah ada.
-- Retensi rincian yang sudah dibersihkan tidak dapat dipulihkan oleh rollback.
CREATE OR REPLACE FUNCTION public.umkm_tahap_b() RETURNS jsonb
LANGUAGE sql STABLE SET search_path = pg_catalog, pg_temp AS $$ SELECT '{"aktif":false}'::jsonb $$;
REVOKE ALL ON FUNCTION public.umkm_perusahaan_saya(),
  public.umkm_simpan_perusahaan(text,text,boolean),public.umkm_kebutuhan_saya(text),
  public.umkm_simpan_kebutuhan(text,text,text,uuid),public.umkm_tutup_kebutuhan(uuid),
  public.umkm_ajukan_kontak(uuid,uuid[],uuid),public.umkm_permintaan_saya(text),
  public.umkm_batalkan_permintaan(uuid),public.umkm_baca_nomor(uuid),public.umkm_tautkan_akun(text),
  public.umkm_cari_rekomendasi(uuid) FROM PUBLIC,anon,authenticated,service_role;
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
