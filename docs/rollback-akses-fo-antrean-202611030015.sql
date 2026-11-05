-- Rollback manual 0015. Pulihkan klien dalam jendela yang sama.
-- Mengembalikan keterbukaan operasional FO pra-0015; tidak mengubah data.
-- Jalankan sebelum rollback Fase 3/identitas/tiket/rekap. Tanpa BEGIN/COMMIT untuk --atomic.

CREATE OR REPLACE FUNCTION public.boleh_penanganan(
  p_kunjungan   uuid,
  p_peran_tahap text,
  p_layanan     uuid,
  p_penangan    uuid,
  p_status      text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  IF public.boleh_data_pelayanan(p_peran_tahap, p_layanan, p_penangan) THEN
    RETURN true;
  END IF;
  -- 202611010003: FO pencatat membaca seluruh tahap kunjungan yang ia daftarkan (hasil eskalasi dilengkapi layanan).
  IF v_role = 'front_office'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan AND k.dibuat_oleh = v_id) THEN
    RETURN true;
  END IF;
  IF NOT (p_status IN ('menunggu', 'berjalan') OR public.kunjungan_operasional(p_kunjungan)) THEN
    RETURN false;
  END IF;
  IF v_role = 'front_office' THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    ) OR EXISTS (
      SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
      WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS
  '202611010003: lingkup baca penanganan = 202610290001 + FO pencatat kunjungan (read-only).';

CREATE OR REPLACE FUNCTION public.boleh_kunjungan(p_kunjungan uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
  v_koord   boolean;
  v_unit    boolean;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  -- Data yang ia tangani sendiri (semua tanggal).
  IF EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan AND k.dibuat_oleh = v_id)
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.penangan_id = v_id)
     OR EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.dilayani_oleh = v_id)
     OR EXISTS (SELECT 1 FROM public.pelayanan_oss AS o WHERE o.kunjungan_id = p_kunjungan AND o.petugas_id = v_id)
     OR EXISTS (SELECT 1 FROM public.pelayanan_perizinan AS pz WHERE pz.kunjungan_id = p_kunjungan AND pz.petugas_id = v_id)
  THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    v_unit := EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.kunjungan_id = p_kunjungan AND t.layanan_id = v_layanan)
      OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan)
      OR EXISTS (
        SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
        WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
      );
    -- Petugas+Koordinator: semua kunjungan layanannya; petugas biasa: hanya jendela operasional.
    RETURN v_unit AND (v_koord OR public.kunjungan_operasional(p_kunjungan));
  END IF;
  IF v_role = 'front_office' THEN
    RETURN public.kunjungan_operasional(p_kunjungan);
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_kunjungan(uuid) IS
  '202610290001: RLS baca kunjungan staf. Admin/FO Koordinator semua; Petugas Koordinator layanannya; milik sendiri; selain itu jendela operasional.';


CREATE OR REPLACE FUNCTION public.boleh_baca_pendataan(p_tiket uuid, p_petugas uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
  v_koord   boolean;
  v_t       record;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  IF p_petugas = v_id THEN
    RETURN true;
  END IF;
  SELECT t.layanan_id, t.status, t.tanggal, t.dilayani_oleh, t.kunjungan_id INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_t.dilayani_oleh = v_id
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket AND p.penangan_id = v_id) THEN
    RETURN true;
  END IF;
  -- 202611010003: FO pencatat kunjungan membaca formulir pendataan hasil eskalasi (read-only).
  IF v_role = 'front_office'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id AND k.dibuat_oleh = v_id) THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_koord AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan THEN
    RETURN true;
  END IF;
  IF NOT (v_t.status IN ('menunggu', 'dipanggil', 'dilayani')
          AND v_t.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1) THEN
    RETURN false;
  END IF;
  RETURN v_role = 'front_office' OR (v_role = 'petugas' AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan);
END $$;
REVOKE ALL ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) IS
  '202611010003: lingkup baca formulir pendataan = 202610290001 + FO pencatat kunjungan (read-only).';

CREATE OR REPLACE FUNCTION public.boleh_tiket_baca(p_kunjungan uuid, p_layanan uuid, p_tanggal date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staf_lingkup() AS me
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (p_tanggal = (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date
           AND (me.role = 'front_office'
                OR (me.role = 'petugas' AND me.layanan_id IS NOT NULL AND me.layanan_id = p_layanan)))
  ) OR public.boleh_kunjungan(p_kunjungan)
$$;
REVOKE ALL ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_tiket_baca(uuid, uuid, date) IS
  '202611010002: lingkup baca tiket_antrean staf. Admin/FO Koordinator semua; boleh_kunjungan(); hari ini (WIB): FO semua, petugas layanannya.';


DROP FUNCTION IF EXISTS public.fo_antrean_daftar(date, uuid, integer, integer);
DROP FUNCTION IF EXISTS public.fo_kunjungan_daftar(date, integer, integer);
DROP FUNCTION IF EXISTS public.fo_pratinjau_reservasi(text);
DROP FUNCTION IF EXISTS public.rekap_ringkasan_dilayani(date, date, text, uuid, boolean);
DROP INDEX IF EXISTS public.idx_tiket_fo_tanggal_nomor;
