-- G5: Mulai Layanan dua langkah dan draf Pendataan Khusus.
-- LOKAL, belum diterapkan ke produksi. Jalankan atomik sesudah G2 202611160001.
-- Definisi layanan_mulai berasal 202610140012; finalisasi memakai inti layanan_selesai
-- internal (salinan 202610140015) dan identitas 202611010003. Signature klien lama dipertahankan.
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.lingkup_layanan_saya()') IS NULL
     OR pg_catalog.to_regprocedure('public.layanan_selesai_khusus(uuid,uuid,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: G2 202611160001 dan identitas 202611010003 wajib tersedia';
  END IF;
END $$;

ALTER TABLE public.layanan ADD COLUMN IF NOT EXISTS pendataan_khusus_aktif boolean NOT NULL DEFAULT true;
COMMENT ON COLUMN public.layanan.pendataan_khusus_aktif IS
  'G5: nonaktif melewati pengisian baru; definisi dan jawaban historis tetap tersedia untuk rekap/ekspor.';

CREATE TABLE IF NOT EXISTS public.pendataan_khusus_draf (
  tiket_id uuid PRIMARY KEY REFERENCES public.tiket_antrean(id) ON DELETE CASCADE,
  jawaban jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (pg_catalog.jsonb_typeof(jawaban) = 'object' AND pg_catalog.octet_length(jawaban::text) <= 65536),
  diubah_oleh uuid NOT NULL REFERENCES public.petugas(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pendataan_khusus_draf_pengubah ON public.pendataan_khusus_draf(diubah_oleh);
ALTER TABLE public.pendataan_khusus_draf ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pendataan_khusus_draf FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pendataan_khusus_draf TO authenticated;
GRANT ALL ON TABLE public.pendataan_khusus_draf TO service_role;
DROP POLICY IF EXISTS pendataan_khusus_draf_select ON public.pendataan_khusus_draf;
CREATE POLICY pendataan_khusus_draf_select ON public.pendataan_khusus_draf
  FOR SELECT TO authenticated USING (public.boleh_baca_pendataan(tiket_id, NULL));
COMMENT ON TABLE public.pendataan_khusus_draf IS
  'G5: satu draf per tiket; baca sesuai lingkup G2, tulis hanya RPC pemilik, tidak menandai pernah_diisi.';

-- Internal: kunci kunjungan -> tiket -> penanganan, lalu pastikan wadah milik pemilik saat ini.
-- Dipakai Mulai, simpan draf, dan Selesai agar tiket lama yang sudah dilayani tetap aman.
CREATE OR REPLACE FUNCTION public.pendataan_khusus_penanganan_pastikan(p_tiket uuid)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me record;
  v_t record;
  v_p record;
  v_kid uuid;
  v_asal text;
  v_pid uuid;
  v_tahap integer;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_me FROM public.staf_saya() AS me;
  IF v_me.id IS NULL OR v_me.role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya petugas layanan atau Admin aktif' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi' USING ERRCODE = '42501';
  END IF;
  SELECT t.kunjungan_id INTO v_kid FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  SELECT k.asal INTO v_asal FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT t.id, t.kunjungan_id, t.layanan_id, t.dilayani_oleh, t.status, t.waktu_mulai_layan
    INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me.role = 'petugas' AND v_me.layanan_id IS DISTINCT FROM v_t.layanan_id THEN
    RAISE EXCEPTION 'FORBIDDEN: tiket bukan layanan Anda' USING ERRCODE = '42501';
  END IF;
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me.id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: ambil alih tiket dahulu' USING ERRCODE = '42501';
  END IF;
  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket harus sedang dilayani' USING ERRCODE = 'P0001';
  END IF;
  SELECT p.id, p.peran_tahap, p.layanan_id, p.kunjungan_id, p.status, p.penangan_id INTO v_p FROM public.penanganan AS p
    WHERE p.tiket_id = p_tiket AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    IF v_p.peran_tahap <> 'layanan' OR v_p.layanan_id IS DISTINCT FROM v_t.layanan_id
       OR v_p.kunjungan_id IS DISTINCT FROM v_t.kunjungan_id
       OR (v_p.status = 'berjalan' AND v_p.penangan_id IS DISTINCT FROM v_me.id) THEN
      RAISE EXCEPTION 'PENANGANAN_TIDAK_SESUAI: tahap dan pemilik tiket berbeda' USING ERRCODE = 'P0001';
    END IF;
    IF v_p.status = 'menunggu' THEN
      UPDATE public.penanganan SET status = 'berjalan', penangan_id = v_me.id,
        mulai_at = COALESCE(v_t.waktu_mulai_layan, pg_catalog.now()) WHERE id = v_p.id;
    END IF;
    RETURN v_p.id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.penanganan AS p
             WHERE p.kunjungan_id = v_kid AND p.status IN ('menunggu', 'berjalan')) THEN
    RAISE EXCEPTION 'PENANGANAN_AKTIF: kunjungan masih mempunyai tahap lain yang terbuka' USING ERRCODE = 'P0001';
  END IF;
  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap
    FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan(kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran,
                               tiket_id, penangan_id, status, mulai_at, dibuat_oleh)
    VALUES(v_kid, v_tahap, 'layanan', v_t.layanan_id,
           CASE WHEN v_asal = 'online' THEN 'qr' ELSE 'walk_in' END,
           p_tiket, v_me.id, 'berjalan', COALESCE(v_t.waktu_mulai_layan, pg_catalog.now()), v_me.id)
    RETURNING id INTO v_pid;
  RETURN v_pid;
END $$;
REVOKE ALL ON FUNCTION public.pendataan_khusus_penanganan_pastikan(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.layanan_mulai(p_tiket_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id      uuid;
  v_me_role    text;
  v_me_layanan uuid;
  v_t          record;
  v_cek        record;
  v_now        timestamptz := pg_catalog.now();
  v_n          integer;
  v_pid        uuid;
  v_sudah      boolean := false;
  v_tgl        date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_me_id, v_me_role, v_me_layanan FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  SELECT t.id, t.layanan_id, t.kunjungan_id, t.tanggal INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    v_me_role = 'admin'
    OR (v_me_role = 'petugas' AND v_me_layanan IS NOT NULL AND v_me_layanan = v_t.layanan_id)
  ) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya Admin atau petugas layanan ini yang boleh memulai layanan' USING ERRCODE = '42501';
  END IF;

  -- 202610140012 #7: antrean tanggal lain (tertinggal karena job akhir hari gagal / tampilan basi) tidak dimulai.
  IF v_t.tanggal IS DISTINCT FROM v_tgl THEN
    RAISE EXCEPTION 'BUKAN_HARI_INI: tiket untuk tanggal %, bukan antrean hari ini', v_t.tanggal USING ERRCODE = 'P0001';
  END IF;

  -- Urutan kunci global (WP-24): kunjungan -> tiket -> penanganan.
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id FOR UPDATE;

  UPDATE public.tiket_antrean AS t
     SET status = 'dilayani', dilayani_oleh = v_me_id, waktu_mulai_layan = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status IN ('menunggu', 'dipanggil') AND t.dilayani_oleh IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF v_n = 0 THEN
    SELECT t.status, t.dilayani_oleh, t.waktu_mulai_layan INTO v_cek
    FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
    IF v_cek.status = 'dilayani' AND v_cek.dilayani_oleh = v_me_id THEN
      v_sudah := true;
      v_now := v_cek.waktu_mulai_layan;
    ELSIF v_cek.status IN ('dilayani', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain' USING ERRCODE = 'P0001';
    ELSE
      RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_pid := public.pendataan_khusus_penanganan_pastikan(p_tiket_id);

  -- Kunjungan ikut 'dilayani' (tiket hasil eskalasi maupun tiket lama; dulu tiket lama lewat trigger dual-write).
  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id AND k.status IS DISTINCT FROM 'dilayani';

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', v_sudah, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_now, 'penanganan_id', v_pid);
END $$;

REVOKE ALL ON FUNCTION public.layanan_mulai(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_mulai(uuid) TO authenticated;
COMMENT ON FUNCTION public.layanan_mulai(uuid) IS
  '202611160002: klaim tiket atomik + tahap layanan berjalan, idempoten bagi pemilik.';

CREATE OR REPLACE FUNCTION public.pendataan_khusus_draf_simpan(p_tiket uuid, p_jawaban jsonb)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pid uuid;
  v_layanan uuid;
  v_aktif boolean;
  v_form text;
  v_oleh uuid;
  v_updated timestamptz;
  v_obj jsonb := COALESCE(p_jawaban, '{}'::jsonb);
BEGIN
  v_pid := public.pendataan_khusus_penanganan_pastikan(p_tiket);
  SELECT p.layanan_id, p.penangan_id INTO v_layanan, v_oleh FROM public.penanganan AS p WHERE p.id = v_pid;
  SELECT l.pendataan_khusus_aktif, l.form_pendataan INTO v_aktif, v_form
    FROM public.layanan AS l WHERE l.id = v_layanan FOR SHARE;
  IF v_form IS NOT NULL THEN
    RAISE EXCEPTION 'LAYANAN_TETAP: gunakan draf formulir OSS/Non OSS' USING ERRCODE = '22023';
  END IF;
  IF NOT v_aktif THEN
    RAISE EXCEPTION 'KHUSUS_NONAKTIF: Pendataan Khusus layanan dinonaktifkan' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.jsonb_typeof(v_obj) <> 'object' OR pg_catalog.octet_length(v_obj::text) > 65536 THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: draf harus objek, maksimum 65536 byte' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_obj) AS k
             WHERE NOT EXISTS (SELECT 1 FROM public.pendataan_khusus_field AS f
                               WHERE f.id::text = k AND f.layanan_id = v_layanan)) THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: kunci draf bukan isian layanan ini' USING ERRCODE = '22023';
  END IF;
  -- Draf boleh belum lengkap atau belum sesuai tipe. Wajib/tipe hanya diperiksa saat Selesai.
  INSERT INTO public.pendataan_khusus_draf(tiket_id, jawaban, diubah_oleh, updated_at)
    VALUES(p_tiket, v_obj, v_oleh, pg_catalog.now())
    ON CONFLICT (tiket_id) DO UPDATE SET jawaban = EXCLUDED.jawaban,
      diubah_oleh = EXCLUDED.diubah_oleh, updated_at = EXCLUDED.updated_at
    RETURNING updated_at INTO v_updated;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'tiket_id', p_tiket, 'updated_at', v_updated);
END $$;
REVOKE ALL ON FUNCTION public.pendataan_khusus_draf_simpan(uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pendataan_khusus_draf_simpan(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.pendataan_khusus_draf_baca(p_tiket uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lingkup_layanan_saya()) THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS t WHERE t.id = p_tiket) THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.boleh_baca_pendataan(p_tiket, NULL) THEN
    RAISE EXCEPTION 'FORBIDDEN: tiket di luar lingkup layanan' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT pg_catalog.jsonb_build_object('tiket_id', d.tiket_id, 'jawaban', d.jawaban,
             'diubah_oleh', d.diubah_oleh, 'updated_at', d.updated_at)
          FROM public.pendataan_khusus_draf AS d WHERE d.tiket_id = p_tiket);
END $$;
REVOKE ALL ON FUNCTION public.pendataan_khusus_draf_baca(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pendataan_khusus_draf_baca(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.pendataan_khusus_definisi(p_layanan uuid)
RETURNS TABLE(id uuid, layanan_id uuid, label text, jenis text, wajib boolean, opsi jsonb,
              urut integer, tersembunyi boolean, pernah_diisi boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lingkup_layanan_saya() AS s
                 WHERE s.semua OR s.layanan_id = p_layanan) THEN
    RAISE EXCEPTION 'FORBIDDEN: layanan di luar lingkup' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan) THEN
    RAISE EXCEPTION 'NOT_FOUND: layanan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  RETURN QUERY SELECT f.id, f.layanan_id, f.label, f.jenis, f.wajib, f.opsi, f.urut,
                      f.tersembunyi, f.pernah_diisi, f.created_at
    FROM public.pendataan_khusus_field AS f JOIN public.layanan AS l ON l.id = f.layanan_id
    WHERE f.layanan_id = p_layanan AND NOT f.tersembunyi AND l.pendataan_khusus_aktif
      AND l.form_pendataan IS NULL
    ORDER BY f.urut, f.created_at, f.id LIMIT 40;
END $$;
REVOKE ALL ON FUNCTION public.pendataan_khusus_definisi(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pendataan_khusus_definisi(uuid) TO authenticated;

-- Inti finalisasi 202610140015: hanya dipanggil pembungkus berotorisasi di bawah.
CREATE OR REPLACE FUNCTION public.layanan_selesai_inti(
  p_tiket_id  uuid,
  p_form_type text DEFAULT NULL,
  p_payload   jsonb DEFAULT NULL,
  p_topik_id  uuid DEFAULT NULL,
  p_catatan   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id    uuid;
  v_me_role  text;
  v_kunj     uuid;
  v_t        record;
  v_p        record;
  v_existing record;
  v_topik    text;
  v_catatan  text;
  v_now      timestamptz := pg_catalog.now();
  v_n        integer;
  v_form_wajib text;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif yang boleh menyelesaikan layanan' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;
  IF v_me_role NOT IN ('admin', 'petugas') THEN
    RAISE EXCEPTION 'FORBIDDEN: Front Office tidak menyelesaikan tiket layanan' USING ERRCODE = '42501';
  END IF;
  IF p_form_type IS NOT NULL AND p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;

  SELECT t.kunjungan_id INTO v_kunj FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  -- Urutan kunci global (WP-24): kunjungan -> tiket -> penanganan.
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kunj FOR UPDATE;
  SELECT t.id, t.kunjungan_id, t.layanan_id, t.status, t.dilayani_oleh INTO v_t
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;

  IF v_t.status <> 'dilayani' THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status dilayani (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket ini sedang dilayani petugas lain' USING ERRCODE = '42501';
  END IF;

  -- Pendataan wajib per layanan (202610140012 #1): jenis form ditentukan DB (layanan.form_pendataan), bukan klien.
  -- Berlaku untuk SEMUA peran (Admin pengambil alih pun wajib form; keputusan CEO 2026-10-14). Tiket macet tanpa data
  -- ditutup otomatis oleh job tutup_penanganan_tertinggal 23:00 WIB (jalur otomatis, bukan lewat fungsi ini).
  SELECT l.form_pendataan INTO v_form_wajib FROM public.layanan AS l WHERE l.id = v_t.layanan_id;
  IF v_form_wajib IS NOT NULL AND p_form_type IS DISTINCT FROM v_form_wajib THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: layanan ini wajib Formulir Pendataan % (dikirim: %)',
      v_form_wajib, COALESCE(p_form_type, 'tanpa form') USING ERRCODE = '22023';
  END IF;

  -- Tahap penanganan (hanya tiket hasil eskalasi), divalidasi sebelum menulis apa pun.
  -- 202610140015: layanan TANPA Pendataan -> topik + catatan wajib (tidak berubah). Layanan ber-Pendataan -> topik dan
  -- catatan dari klien opsional (divalidasi bila dikirim); catatan kosong diturunkan dari Pendataan di bawah.
  SELECT p.id INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    IF v_form_wajib IS NULL THEN
      v_topik   := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
      v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
    ELSE
      IF p_topik_id IS NOT NULL THEN
        v_topik := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
      END IF;
      IF pg_catalog.btrim(COALESCE(p_catatan, '')) <> '' THEN
        v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
      END IF;
    END IF;
  END IF;

  -- Pendataan (logika finalize_pelayanan 202610010001 bagian e, apa adanya; petugas_id = pemilik).
  IF p_form_type = 'oss' THEN
    SELECT * INTO v_existing FROM public.pelayanan_oss WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    -- Pendataan wajib lengkap (keputusan CEO G.5): semua field terisi; divalidasi sebelum menulis apa pun.
    PERFORM public.pendataan_validasi_payload('oss', p_payload);

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_oss (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_usaha, tipe_pelaku_usaha, status_penanaman_modal, lokasi_usaha,
        skala_usaha, sektor_usaha_kbli, tindak_lanjut, uraian_solusi,
        catatan_internal, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_t.kunjungan_id, v_me_id,
        COALESCE(p_payload->>'nama_pemohon', ''),
        NULLIF(p_payload->>'alamat_pemohon', ''),
        NULLIF(p_payload->>'no_hp', ''),
        NULLIF(p_payload->>'email', ''),
        NULLIF(p_payload->>'keperluan_awal', ''),
        COALESCE(p_payload->>'nama_usaha', ''),
        NULLIF(p_payload->>'tipe_pelaku_usaha', ''),
        NULLIF(p_payload->>'status_penanaman_modal', ''),
        NULLIF(p_payload->>'lokasi_usaha', ''),
        NULLIF(p_payload->>'skala_usaha', ''),
        NULLIF(p_payload->>'sektor_usaha_kbli', ''),
        COALESCE(p_payload->>'tindak_lanjut', ''),
        COALESCE(p_payload->>'uraian_solusi', ''),
        NULLIF(p_payload->>'catatan_internal', ''),
        'selesai', true, v_now, v_now
      );
    ELSE
      UPDATE public.pelayanan_oss SET
        petugas_id             = v_me_id,
        nama_pemohon           = COALESCE(p_payload->>'nama_pemohon', nama_pemohon),
        alamat_pemohon         = COALESCE(NULLIF(p_payload->>'alamat_pemohon', ''), alamat_pemohon),
        no_hp                  = COALESCE(NULLIF(p_payload->>'no_hp', ''), no_hp),
        email                  = COALESCE(NULLIF(p_payload->>'email', ''), email),
        keperluan_awal         = COALESCE(NULLIF(p_payload->>'keperluan_awal', ''), keperluan_awal),
        nama_usaha             = COALESCE(p_payload->>'nama_usaha', nama_usaha),
        tipe_pelaku_usaha      = COALESCE(NULLIF(p_payload->>'tipe_pelaku_usaha', ''), tipe_pelaku_usaha),
        status_penanaman_modal = COALESCE(NULLIF(p_payload->>'status_penanaman_modal', ''), status_penanaman_modal),
        lokasi_usaha           = COALESCE(NULLIF(p_payload->>'lokasi_usaha', ''), lokasi_usaha),
        skala_usaha            = COALESCE(NULLIF(p_payload->>'skala_usaha', ''), skala_usaha),
        sektor_usaha_kbli      = COALESCE(NULLIF(p_payload->>'sektor_usaha_kbli', ''), sektor_usaha_kbli),
        tindak_lanjut          = COALESCE(p_payload->>'tindak_lanjut', tindak_lanjut),
        uraian_solusi          = COALESCE(p_payload->>'uraian_solusi', uraian_solusi),
        catatan_internal       = COALESCE(NULLIF(p_payload->>'catatan_internal', ''), catatan_internal),
        status_draft           = 'selesai',
        is_locked              = true,
        updated_at             = v_now
      WHERE tiket_id = p_tiket_id;
    END IF;

  ELSIF p_form_type = 'perizinan' THEN
    SELECT * INTO v_existing FROM public.pelayanan_perizinan WHERE tiket_id = p_tiket_id;
    IF v_existing.tiket_id IS NOT NULL AND v_existing.is_locked AND v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'LOCKED: data pelayanan sudah terkunci dan tidak dapat diubah';
    END IF;

    -- Pendataan wajib lengkap (keputusan CEO G.5): semua field terisi; divalidasi sebelum menulis apa pun.
    PERFORM public.pendataan_validasi_payload('perizinan', p_payload);

    IF v_existing.tiket_id IS NULL THEN
      INSERT INTO public.pelayanan_perizinan (
        tiket_id, kunjungan_id, petugas_id,
        nama_pemohon, alamat_pemohon, no_hp, email, keperluan_awal,
        nama_perusahaan, lokasi_usaha, opd_teknis, uraian_permohonan, tindak_lanjut,
        catatan_petugas, status_draft, is_locked, created_at, updated_at
      ) VALUES (
        p_tiket_id, v_t.kunjungan_id, v_me_id,
        COALESCE(p_payload->>'nama_pemohon', ''),
        NULLIF(p_payload->>'alamat_pemohon', ''),
        NULLIF(p_payload->>'no_hp', ''),
        NULLIF(p_payload->>'email', ''),
        NULLIF(p_payload->>'keperluan_awal', ''),
        COALESCE(p_payload->>'nama_perusahaan', ''),
        NULLIF(p_payload->>'lokasi_usaha', ''),
        COALESCE(p_payload->>'opd_teknis', ''),
        COALESCE(p_payload->>'uraian_permohonan', ''),
        COALESCE(p_payload->>'tindak_lanjut', ''),
        NULLIF(p_payload->>'catatan_petugas', ''),
        'selesai', true, v_now, v_now
      );
    ELSE
      UPDATE public.pelayanan_perizinan SET
        petugas_id        = v_me_id,
        nama_pemohon      = COALESCE(p_payload->>'nama_pemohon', nama_pemohon),
        alamat_pemohon    = COALESCE(NULLIF(p_payload->>'alamat_pemohon', ''), alamat_pemohon),
        no_hp             = COALESCE(NULLIF(p_payload->>'no_hp', ''), no_hp),
        email             = COALESCE(NULLIF(p_payload->>'email', ''), email),
        keperluan_awal    = COALESCE(NULLIF(p_payload->>'keperluan_awal', ''), keperluan_awal),
        nama_perusahaan   = COALESCE(p_payload->>'nama_perusahaan', nama_perusahaan),
        lokasi_usaha      = COALESCE(NULLIF(p_payload->>'lokasi_usaha', ''), lokasi_usaha),
        opd_teknis        = COALESCE(p_payload->>'opd_teknis', opd_teknis),
        uraian_permohonan = COALESCE(p_payload->>'uraian_permohonan', uraian_permohonan),
        tindak_lanjut     = COALESCE(p_payload->>'tindak_lanjut', tindak_lanjut),
        catatan_petugas   = COALESCE(NULLIF(p_payload->>'catatan_petugas', ''), catatan_petugas),
        status_draft      = 'selesai',
        is_locked         = true,
        updated_at        = v_now
      WHERE tiket_id = p_tiket_id;
    END IF;
  END IF;

  UPDATE public.tiket_antrean AS t
     SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now
   WHERE t.id = p_tiket_id AND t.status = 'dilayani' AND t.dilayani_oleh = v_me_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket % berubah selama penyelesaian', p_tiket_id USING ERRCODE = 'P0001';
  END IF;

  IF v_p.id IS NOT NULL THEN
    -- 202610140015: catatan tahap layanan diturunkan dari Pendataan (payload sudah lolos pendataan_validasi_payload).
    IF v_catatan IS NULL THEN
      v_catatan := COALESCE(NULLIF(pg_catalog.btrim(pg_catalog.left(pg_catalog.concat_ws(E'\n',
          'Tindak lanjut: ' || NULLIF(pg_catalog.btrim(p_payload->>'tindak_lanjut'), ''),
          NULLIF(NULLIF(pg_catalog.btrim(CASE p_form_type WHEN 'oss' THEN p_payload->>'uraian_solusi'
                                                          ELSE p_payload->>'catatan_petugas' END), ''), '-')),
        1000)), ''), '-');
    END IF;
    UPDATE public.penanganan AS p
       SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
           selesai_at = v_now
     WHERE p.id = v_p.id;
  END IF;

  -- Kunjungan 'selesai' bila tidak ada tahap atau tiket lain yang masih terbuka (tiket lama: dulu lewat dual-write).
  -- Trigger kunjungan (202610140007 bagian 5-7) mengantrekan SKM, menambah response rate, dan mencatat audit.
  UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id
     AND k.status IS DISTINCT FROM 'selesai'
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                     WHERE x.kunjungan_id = v_t.kunjungan_id AND x.status IN ('menunggu', 'berjalan'))
     AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS y
                     WHERE y.kunjungan_id = v_t.kunjungan_id AND y.status IN ('menunggu', 'dipanggil', 'dilayani'));

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now,
    'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id));
END $$;
REVOKE ALL ON FUNCTION public.layanan_selesai_inti(uuid,text,jsonb,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.layanan_selesai_khusus(
  p_tiket_id uuid,
  p_topik_id uuid,
  p_catatan text,
  p_khusus jsonb DEFAULT NULL,
  p_identitas jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_pid uuid;
  v_layanan uuid;
  v_me uuid;
  v_kid uuid;
  v_aktif boolean;
  v_ada boolean := false;
  v_form text;
  v_draf jsonb;
  v_obj jsonb;
  v_dari_draf boolean := p_khusus IS NULL OR p_khusus = '{}'::jsonb;
  v_topik uuid := p_topik_id;
  v_catatan text := p_catatan;
  v_hasil jsonb;
  v_ubah text[];
  v_n integer := 0;
BEGIN
  -- Pemilik aktif + sesi + kunci ditegakkan dahulu, termasuk untuk tiket lama tanpa tahap.
  v_pid := public.pendataan_khusus_penanganan_pastikan(p_tiket_id);
  SELECT p.layanan_id, p.penangan_id, p.kunjungan_id INTO v_layanan, v_me, v_kid
    FROM public.penanganan AS p WHERE p.id = v_pid;
  SELECT l.pendataan_khusus_aktif, l.form_pendataan INTO v_aktif, v_form
    FROM public.layanan AS l WHERE l.id = v_layanan FOR SHARE;
  IF v_form IS NOT NULL THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: gunakan layanan_selesai dengan payload formulir OSS/Non OSS'
      USING ERRCODE = '22023';
  END IF;
  SELECT d.jawaban INTO v_draf FROM public.pendataan_khusus_draf AS d
    WHERE d.tiket_id = p_tiket_id FOR UPDATE;
  v_obj := CASE WHEN v_dari_draf THEN COALESCE(v_draf, '{}'::jsonb) ELSE p_khusus END;
  IF pg_catalog.jsonb_typeof(v_obj) <> 'object' OR pg_catalog.octet_length(v_obj::text) > 65536 THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: jawaban harus objek, maksimum 65536 byte' USING ERRCODE = '22023';
  END IF;
  IF v_aktif THEN
    -- Field yang disembunyikan/dihapus setelah autosave tidak lagi wajib atau ikut final.
    -- Payload eksplisit tetap menolak kunci asing; kunci tersembunyi milik layanan dilewati.
    IF NOT v_dari_draf AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_obj) AS k
       WHERE NOT EXISTS (SELECT 1 FROM public.pendataan_khusus_field AS f
                         WHERE f.id::text = k AND f.layanan_id = v_layanan)) THEN
      RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: kunci jawaban bukan isian layanan ini' USING ERRCODE = '22023';
    END IF;
    PERFORM f.id FROM public.pendataan_khusus_field AS f
      WHERE f.layanan_id = v_layanan AND NOT f.tersembunyi
      ORDER BY f.urut, f.created_at, f.id FOR SHARE;
    SELECT EXISTS (SELECT 1 FROM public.pendataan_khusus_field AS f
                   WHERE f.layanan_id = v_layanan AND NOT f.tersembunyi) INTO v_ada;
    SELECT COALESCE(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_obj
      FROM pg_catalog.jsonb_each(v_obj) AS e
      JOIN public.pendataan_khusus_field AS f ON f.id::text = e.key
      WHERE f.layanan_id = v_layanan AND NOT f.tersembunyi;
  END IF;
  IF v_ada THEN
    IF v_topik IS NULL THEN
      -- topik_penanganan tidak memiliki slug/kode: kunci seed mengikuti indeks nama unik.
      SELECT t.id INTO v_topik FROM public.topik_penanganan AS t
        WHERE t.layanan_id = v_layanan AND t.aktif AND pg_catalog.lower(pg_catalog.btrim(t.nama)) = 'lainnya';
      IF v_topik IS NULL THEN
        RAISE EXCEPTION 'TOPIK_SISTEM_TIDAK_ADA: topik seed Lainnya aktif tidak ditemukan; hubungi Admin'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    IF pg_catalog.btrim(COALESCE(v_catatan, '')) = '' THEN
      v_catatan := 'Diisi sistem: Pendataan Khusus telah diisi';
    END IF;
  END IF;
  -- Identitas diterapkan sebelum selesai agar email survei menggunakan nilai terbaru.
  IF p_identitas IS NOT NULL THEN
    v_ubah := public.kunjungan_terapkan_identitas(v_kid,
      public.pendataan_identitas_validasi(p_identitas), 'layanan_selesai_khusus',
      pg_catalog.jsonb_build_object('tiket_id', p_tiket_id));
  END IF;
  v_hasil := public.layanan_selesai_inti(p_tiket_id, NULL::text, NULL::jsonb, v_topik, v_catatan);
  IF (v_hasil ->> 'penanganan_id')::uuid IS DISTINCT FROM v_pid THEN
    RAISE EXCEPTION 'DIVERGENSI: penanganan final berbeda dari wadah Pendataan Khusus' USING ERRCODE = 'P0001';
  END IF;
  IF v_aktif AND v_ada THEN
    -- Validasi wajib/tipe dan label_snapshot memakai definisi terkini, dalam transaksi yang sama.
    v_n := public.pendataan_khusus_simpan(v_pid, v_layanan, v_obj, v_me);
  END IF;
  DELETE FROM public.pendataan_khusus_draf WHERE tiket_id = p_tiket_id;
  RETURN v_hasil || pg_catalog.jsonb_build_object('khusus_tersimpan', v_n,
    'identitas_diubah', pg_catalog.to_jsonb(COALESCE(v_ubah, ARRAY[]::text[])));
END $$;
REVOKE ALL ON FUNCTION public.layanan_selesai_khusus(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai_khusus(uuid,uuid,text,jsonb,jsonb) TO authenticated;
COMMENT ON FUNCTION public.layanan_selesai_khusus(uuid,uuid,text,jsonb,jsonb) IS
  '202611160002: finalisasi seluruh tiket tanpa formulir tetap; p_khusus NULL/{} memakai draf, hapus draf atomik.';

-- Signature lama tetap publik, tetapi tidak lagi menyediakan pintu tanpa validasi Khusus.
CREATE OR REPLACE FUNCTION public.layanan_selesai(
  p_tiket_id uuid,
  p_form_type text DEFAULT NULL,
  p_payload jsonb DEFAULT NULL,
  p_topik_id uuid DEFAULT NULL,
  p_catatan text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_form text;
  v_hasil jsonb;
BEGIN
  -- Memastikan sesi, lingkup, pemilik, dan kunci dengan urutan yang sama untuk semua jalur.
  PERFORM public.pendataan_khusus_penanganan_pastikan(p_tiket_id);
  SELECT l.form_pendataan INTO v_form FROM public.tiket_antrean AS t
    JOIN public.layanan AS l ON l.id = t.layanan_id WHERE t.id = p_tiket_id FOR SHARE OF l;
  IF p_form_type IS NOT NULL AND p_form_type NOT IN ('oss', 'perizinan') THEN
    RAISE EXCEPTION 'INVALID_FORM: tipe form tidak dikenal (%)', p_form_type USING ERRCODE = '22023';
  END IF;
  IF v_form IS NULL THEN
    -- Jenis layanan ditentukan DB, bukan argumen form yang dapat dikirim klien.
    RETURN public.layanan_selesai_khusus(p_tiket_id, p_topik_id, p_catatan, NULL, NULL);
  END IF;
  v_hasil := public.layanan_selesai_inti(p_tiket_id, p_form_type, p_payload, p_topik_id, p_catatan);
  DELETE FROM public.pendataan_khusus_draf WHERE tiket_id = p_tiket_id;
  RETURN v_hasil;
END $$;
REVOKE ALL ON FUNCTION public.layanan_selesai(uuid,text,jsonb,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai(uuid,text,jsonb,uuid,text) TO authenticated;
COMMENT ON FUNCTION public.layanan_selesai(uuid,text,jsonb,uuid,text) IS
  '202611160002: signature lama; tanpa form melalui validasi Khusus/draf, OSS/Non OSS melalui inti internal.';

-- Chat memakai inti internal juga agar signature publik lama tidak melewati wajib/saklar.
CREATE OR REPLACE FUNCTION public.chat_selesai_inti(p_sesi_id uuid, p_topik_id uuid, p_catatan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_s       record;
  v_p       record;
  v_topik   text;
  v_catatan text;
  v_pesan   uuid;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin', 'petugas']) AS s;

  SELECT s.id, s.status, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_s.status = 'selesai' OR v_s.kunjungan_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat belum diambil atau sudah selesai (status=%)', v_s.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_s.kunjungan_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL OR v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: chat tidak sedang ditangani (ambil dulu dengan chat_ambil)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: chat ini ditangani staf lain' USING ERRCODE = '42501';
  END IF;
  -- Topik milik tahap (FO: topik FO; layanan: topik layanan itu). Catatan FO <= 200, layanan <= 1000 (K10).
  v_topik   := public.fo_validasi_topik(p_topik_id, v_p.layanan_id);
  v_catatan := public.fo_validasi_catatan(p_catatan, CASE WHEN v_p.peran_tahap = 'fo' THEN 200 ELSE 1000 END);

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = v_p.id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
   WHERE k.id = v_s.kunjungan_id
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                     WHERE x.kunjungan_id = v_s.kunjungan_id AND x.status IN ('menunggu', 'berjalan'));

  -- ditangani_oleh dipertahankan (riwayat siapa yang menutup).
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'selesai', v_me_id);
  -- Pesan penutup sesi (Q24: kalimat tautan survei dihapus sampai modul survei dirancang; jenis dipertahankan).
  v_pesan := public.chat_pesan_sistem(p_sesi_id,
    'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung.',
    'penutup_survei');

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_selesai', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id, 'penanganan_id', v_p.id,
              'topik', v_topik),
            pg_catalog.jsonb_build_object('status_sesi', v_s.status),
            pg_catalog.jsonb_build_object('status_sesi', 'selesai'));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id, 'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id),
    'selesai_at', v_now, 'pesan_penutup_id', v_pesan);
END $$;
REVOKE ALL ON FUNCTION public.chat_selesai_inti(uuid,uuid,text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_selesai_khusus(
  p_sesi_id    uuid,
  p_topik_id   uuid,
  p_catatan    text,
  p_khusus     jsonb DEFAULT NULL,
  p_identitas  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hasil jsonb;
  v_pid   uuid;
  v_kid   uuid;
  v_me    uuid;
  v_peran text;
  v_lyn   uuid;
  v_ubah  text[];
  v_n     integer := 0;
  v_aktif boolean;
  v_tiket uuid;
  v_draf jsonb;
  v_obj jsonb;
  v_dari_draf boolean := p_khusus IS NULL OR p_khusus = '{}'::jsonb;
BEGIN
  -- Identitas diterapkan SEBELUM chat_selesai (email survei) dan email wajib ada. Otorisasi ditegakkan chat_selesai; bila
  -- ditolak, seluruh transaksi dibatalkan.
  SELECT s.kunjungan_id INTO v_kid FROM public.chat_sesi AS s WHERE s.id = p_sesi_id;
  IF v_kid IS NOT NULL THEN
    IF p_identitas IS NOT NULL THEN
      v_ubah := public.kunjungan_terapkan_identitas(
        v_kid, public.pendataan_identitas_validasi(p_identitas), 'chat_selesai_khusus',
        pg_catalog.jsonb_build_object('sesi_id', p_sesi_id));
    END IF;
    IF public.kunjungan_email_efektif(v_kid) IS NULL THEN
      RAISE EXCEPTION 'EMAIL_WAJIB: pengunjung wajib memiliki email yang valid sebelum chat diselesaikan'
        USING ERRCODE = '22023', DETAIL = 'email';
    END IF;
  END IF;

  v_hasil := public.chat_selesai_inti(p_sesi_id, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  SELECT p.peran_tahap, p.layanan_id, p.tiket_id INTO v_peran, v_lyn, v_tiket FROM public.penanganan AS p WHERE p.id = v_pid;

  IF v_peran = 'layanan' AND v_lyn IS NOT NULL THEN
    SELECT l.pendataan_khusus_aktif INTO v_aktif FROM public.layanan AS l WHERE l.id = v_lyn FOR SHARE;
    SELECT d.jawaban INTO v_draf FROM public.pendataan_khusus_draf AS d WHERE d.tiket_id = v_tiket FOR UPDATE;
    IF v_aktif THEN
      v_obj := CASE WHEN v_dari_draf THEN COALESCE(v_draf, '{}'::jsonb) ELSE p_khusus END;
      IF pg_catalog.jsonb_typeof(v_obj) <> 'object' OR pg_catalog.octet_length(v_obj::text) > 65536 THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: jawaban harus objek, maksimum 65536 byte' USING ERRCODE = '22023';
      END IF;
      IF NOT v_dari_draf AND EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(v_obj) AS k
         WHERE NOT EXISTS (SELECT 1 FROM public.pendataan_khusus_field AS f
                           WHERE f.id::text = k AND f.layanan_id = v_lyn)) THEN
        RAISE EXCEPTION 'KHUSUS_TIDAK_VALID: kunci jawaban bukan isian layanan ini' USING ERRCODE = '22023';
      END IF;
      PERFORM f.id FROM public.pendataan_khusus_field AS f
        WHERE f.layanan_id = v_lyn AND NOT f.tersembunyi ORDER BY f.urut, f.created_at, f.id FOR SHARE;
      SELECT COALESCE(pg_catalog.jsonb_object_agg(e.key,e.value),'{}'::jsonb) INTO v_obj
        FROM pg_catalog.jsonb_each(v_obj) AS e JOIN public.pendataan_khusus_field AS f ON f.id::text = e.key
        WHERE f.layanan_id = v_lyn AND NOT f.tersembunyi;
      v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, v_obj, v_me);
    END IF;
    DELETE FROM public.pendataan_khusus_draf WHERE tiket_id = v_tiket;
  ELSIF p_khusus IS NOT NULL AND pg_catalog.jsonb_typeof(p_khusus) = 'object' AND p_khusus <> '{}'::jsonb THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_BERLAKU: Pendataan Khusus hanya untuk chat yang diselesaikan petugas Layanan'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_hasil || pg_catalog.jsonb_build_object(
    'khusus_tersimpan', v_n, 'identitas_diubah', pg_catalog.to_jsonb(COALESCE(v_ubah, ARRAY[]::text[])));
END $$;
REVOKE ALL ON FUNCTION public.chat_selesai_khusus(uuid,uuid,text,jsonb,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_selesai_khusus(uuid,uuid,text,jsonb,jsonb) TO authenticated;
COMMENT ON FUNCTION public.chat_selesai_khusus(uuid,uuid,text,jsonb,jsonb) IS
  '202611160002: chat melalui inti internal; validasi Khusus/saklar serta hapus draf tiket terkait atomik.';

CREATE OR REPLACE FUNCTION public.chat_selesai(p_sesi_id uuid,p_topik_id uuid,p_catatan text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN public.chat_selesai_khusus(p_sesi_id,p_topik_id,p_catatan,NULL,NULL);
END $$;
REVOKE ALL ON FUNCTION public.chat_selesai(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_selesai(uuid,uuid,text) TO authenticated;
COMMENT ON FUNCTION public.chat_selesai(uuid,uuid,text) IS
  '202611160002: signature lama melalui validasi wajib/saklar dan draf, tanpa delegasi rekursif.';
