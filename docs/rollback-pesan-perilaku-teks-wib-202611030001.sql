-- docs/rollback-pesan-perilaku-teks-wib-202611030001.sql
-- Rollback manual 202611030001: memulihkan teks notifikasi lama (202611020004) dan hitung_ikm berbasis zona sesi (202611020002).
-- BUKAN migrasi; jalankan atas keputusan pemilik, atomik.
CREATE OR REPLACE FUNCTION public.notify_kunjungan_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email   text;
  v_user_id uuid;
  v_publik  text;
  v_skm     text;
  v_undangan uuid;
  v_token    text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;
  IF NEW.pengunjung_id IS NOT NULL THEN
    SELECT visitor.email, visitor.auth_user_id INTO v_email, v_user_id
    FROM public.pengunjung AS visitor WHERE visitor.id = NEW.pengunjung_id;
  END IF;

  IF NEW.status = 'selesai' THEN
    -- Tautan survei = token UNDANGAN (survei_undangan), terpisah dari token kunjungan, berlaku 32 jam sejak selesai.
    -- ensure_undangan idempoten (trigger undangan juga memanggilnya): undangan yang ada dipakai apa adanya, batas tidak bergeser.
    v_undangan := public.ensure_undangan(NEW.id);
    SELECT u.token INTO v_token FROM public.survei_undangan AS u WHERE u.id = v_undangan;
    IF v_token IS NULL THEN
      RETURN NULL;
    END IF;
    -- Walk-in FO tanpa akun pengunjung: email yang dicatat FO adalah satu-satunya jalur kontak yang wajar.
    v_email := COALESCE(NULLIF(pg_catalog.btrim(v_email), ''), NULLIF(pg_catalog.btrim(NEW.email), ''));
    SELECT setting.value INTO v_publik FROM public.site_settings AS setting WHERE setting.key = 'public_url';
    v_skm := COALESCE(v_publik, 'https://lmh.lampungprov.go.id') || '/survei/' || v_token;
    IF v_email IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        NULL, v_email, 'email',
        'Survei Kepuasan Masyarakat - DPMPTSP Lampung',
        'Layanan Anda telah selesai. Mohon isi survei: ' || v_skm,
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'skm_survey')
      );
    END IF;
    IF v_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        v_user_id, NULL, 'web_push',
        'Layanan Selesai - Isi Survei SKM',
        'Layanan Anda telah selesai. Mohon isi survei: ' || v_skm,
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'skm_survey_push',
                                      'url', '/survei/' || v_token)
      );
    END IF;
  ELSIF NEW.asal = 'reservasi' AND OLD.status = 'terjadwal' AND NEW.status IN ('dilayani', 'menunggu') THEN
    IF v_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        v_user_id, NULL, 'web_push',
        'Reservasi Dikonfirmasi',
        'Reservasi Anda telah dikonfirmasi oleh Front Office DPMPTSP Lampung.',
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'reservasi_confirmed', 'url', '/me')
      );
    END IF;
    IF v_email IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        NULL, v_email, 'email',
        'Reservasi Dikonfirmasi - DPMPTSP Lampung',
        'Reservasi Anda telah dikonfirmasi oleh Front Office DPMPTSP Lampung.',
        pg_catalog.jsonb_build_object('kunjungan_id', NEW.id, 'type', 'reservasi_confirmed_email')
      );
    END IF;
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.notify_kunjungan_status() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hitung_ikm(p_layanan_id uuid, p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, layanan_nama text, ikm numeric, responden integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_layanan_id, service.nama,
    pg_catalog.avg(
      (response.u1_persyaratan + response.u2_prosedur + response.u3_waktu +
       response.u4_biaya + response.u5_produk + response.u6_kompetensi +
       response.u7_perilaku + response.u8_sarana + response.u9_pengaduan +
       COALESCE(response.u10_transparansi, 0) + COALESCE(response.u11_integritas, 0))
      / (9.0 + (response.u10_transparansi IS NOT NULL)::int + (response.u11_integritas IS NOT NULL)::int)
    ) * 25 AS ikm,
    pg_catalog.count(*)::integer AS responden
  FROM public.skm_respons AS response
  JOIN public.layanan AS service ON service.id = p_layanan_id
  WHERE response.layanan_id = p_layanan_id
    AND response.created_at::date BETWEEN p_start AND p_end
  GROUP BY service.nama
$$;
REVOKE EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated;
