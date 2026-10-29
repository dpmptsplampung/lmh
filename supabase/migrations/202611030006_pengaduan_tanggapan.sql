-- 202611030006_pengaduan_tanggapan.sql
-- TANGGAPAN FO atas pengaduan (spec survei terpadu §4.5, §5, §7.5, §7.6, §8), keputusan pemilik 2026-10-28:
--   1. pengaduan.pelapor_email (disalin dari email nyata kunjungan bila pelapor tidak anonim); kirim_pengaduan_survei diganti:
--      menyimpan email dan mengantrekan email "laporan diterima" (hanya tidak-anonim + email nyata).
--   2. pengaduan_tanggapan dan pengaduan_lampiran (berkas di R2, area pengaduan-bukti). RLS: hanya admin/front_office membaca
--      (front_office hanya jalur 'layanan'); tulis HANYA lewat tanggapi_pengaduan.
--   3. tanggapi_pengaduan(p_pengaduan_id, p_isi, p_status, p_kirim_email, p_lampiran jsonb) -> uuid: admin semua jalur, front_office jalur layanan;
--      atomik: tanggapan + lampiran + perubahan status (+ riwayat) + email ke pelapor (bila dicentang, ada email, tidak anonim, bukan impor).
--      Email memuat teks tanggapan dan tautan /pengaduan/lacak; lampiran TIDAK dilampirkan langsung.
--   4. tanggapan_pengaduan_nomor(p_nomor) dan lampiran_pengaduan_nomor(p_nomor, p_lampiran_id): anon, hanya pengaduan sumber 'wizard' (nomor laporan = kunci).
-- ROLLBACK: docs/rollback-pengaduan-tanggapan-202611030006.sql.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.kirim_pengaduan_survei(text, text, boolean)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: kirim_pengaduan_survei belum ada (202611030003)';
  END IF;
  IF pg_catalog.to_regprocedure('public.email_nyata(text)') IS NULL OR pg_catalog.to_regprocedure('public.queue_notifikasi(uuid, text, text, text, text, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: email_nyata / queue_notifikasi belum ada';
  END IF;
END $$;

ALTER TABLE public.pengaduan ADD COLUMN IF NOT EXISTS pelapor_email text;

CREATE OR REPLACE FUNCTION public.kirim_pengaduan_survei(p_token text, p_isi text, p_anonim boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u      public.survei_undangan%ROWTYPE;
  v_isi    text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama   text;
  v_email  text;
  v_publik text;
  v_nomor  text;
  v_id     uuid;
  v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_coba   int := 0;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(p_token) < 16 OR p_anonim IS NULL
     OR pg_catalog.char_length(v_isi) < 1 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN pg_catalog.jsonb_build_object('hasil', 'invalid');
  END IF;
  SELECT * INTO v_u FROM public.survei_undangan AS u WHERE u.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('hasil', 'not_found'); END IF;
  IF v_u.diisi_pada IS NULL THEN RETURN pg_catalog.jsonb_build_object('hasil', 'belum_survei'); END IF;
  IF v_u.pengaduan_dikirim THEN RETURN pg_catalog.jsonb_build_object('hasil', 'duplicate'); END IF;
  IF pg_catalog.now() >= GREATEST(v_u.kedaluwarsa_pada, v_u.diisi_pada + interval '30 minutes') THEN
    RETURN pg_catalog.jsonb_build_object('hasil', 'expired');
  END IF;

  IF NOT p_anonim THEN
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120), public.email_nyata(k.email) INTO v_nama, v_email FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  LOOP
    v_coba := v_coba + 1;
    v_nomor := public.generate_nomor_laporan();
    BEGIN
      INSERT INTO public.pengaduan (
        nomor_tiket, jalur, layanan_id, isi, kontak, anonim, sumber, kunjungan_id, pelapor_nama, pelapor_email, undangan_id,
        batas_verifikasi, batas_penanganan
      ) VALUES (
        v_nomor, 'layanan', v_u.layanan_id, v_isi, NULL, p_anonim, 'wizard',
        CASE WHEN p_anonim THEN NULL ELSE v_u.kunjungan_id END,
        CASE WHEN p_anonim THEN NULL ELSE NULLIF(v_nama, '') END,
        CASE WHEN p_anonim THEN NULL ELSE v_email END,
        v_u.id,
        public.tambah_hari_kerja(v_hari, 3), public.tambah_hari_kerja(v_hari, 14)
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Bentrok nomor: coba lagi. Bentrok undangan_id (kiriman bersamaan yang lolos kunci) = duplikat.
      IF EXISTS (SELECT 1 FROM public.pengaduan AS p WHERE p.undangan_id = v_u.id) THEN
        RETURN pg_catalog.jsonb_build_object('hasil', 'duplicate');
      END IF;
      IF v_coba >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  VALUES (v_id, NULL, 'baru', 'pengaduan diterima dari Pesan Perilaku');
  UPDATE public.survei_undangan SET pengaduan_dikirim = true WHERE id = v_u.id;
  -- Email "diterima" hanya bila tidak anonim dan ada email nyata.
  IF NOT p_anonim AND v_email IS NOT NULL THEN
    SELECT s.value INTO v_publik FROM public.site_settings AS s WHERE s.key = 'public_url';
    PERFORM public.queue_notifikasi(
      NULL, v_email, 'email',
      'Laporan Anda diterima - DPMPTSP Lampung',
      'Laporan Anda sudah kami terima dengan nomor ' || v_nomor || '. Pantau statusnya di '
        || COALESCE(v_publik, 'https://lmh.lampungprov.go.id') || '/pengaduan/lacak (masukkan nomor laporan).',
      pg_catalog.jsonb_build_object('type', 'pengaduan_diterima', 'pengaduan_id', v_id)
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('hasil', 'submitted', 'nomor', v_nomor);
END $$;

REVOKE ALL ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) TO anon, authenticated;

-- ============================================================
-- Tabel
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pengaduan_tanggapan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengaduan_id  uuid NOT NULL REFERENCES public.pengaduan(id) ON DELETE CASCADE,
  isi           text NOT NULL CHECK (pg_catalog.char_length(isi) BETWEEN 1 AND 2000),
  status_baru   text CHECK (status_baru IS NULL OR status_baru IN ('diverifikasi','diproses','eskalasi','selesai','ditolak')),
  kirim_email   boolean NOT NULL DEFAULT false,
  dibuat_oleh   uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pengaduan_tanggapan_pengaduan ON public.pengaduan_tanggapan (pengaduan_id, created_at);

CREATE TABLE IF NOT EXISTS public.pengaduan_lampiran (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tanggapan_id  uuid NOT NULL REFERENCES public.pengaduan_tanggapan(id) ON DELETE CASCADE,
  kunci         text NOT NULL UNIQUE CHECK (pg_catalog.char_length(kunci) <= 300),
  nama_asli     text NOT NULL CHECK (pg_catalog.char_length(nama_asli) <= 200),
  mime          text NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  ukuran        integer NOT NULL CHECK (ukuran BETWEEN 1 AND 5242880),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pengaduan_tanggapan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengaduan_lampiran ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.pengaduan_tanggapan, public.pengaduan_lampiran FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.pengaduan_tanggapan, public.pengaduan_lampiran TO authenticated;

DROP POLICY IF EXISTS pengaduan_tanggapan_select ON public.pengaduan_tanggapan;
CREATE POLICY pengaduan_tanggapan_select ON public.pengaduan_tanggapan FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office') AND pengaduan_id IN (SELECT p.id FROM public.pengaduan AS p));
DROP POLICY IF EXISTS pengaduan_lampiran_select ON public.pengaduan_lampiran;
CREATE POLICY pengaduan_lampiran_select ON public.pengaduan_lampiran FOR SELECT TO authenticated
  USING (public.peran_saya() IN ('admin', 'front_office') AND tanggapan_id IN (SELECT t.id FROM public.pengaduan_tanggapan AS t));

-- ============================================================
-- tanggapi_pengaduan
-- ============================================================
CREATE OR REPLACE FUNCTION public.tanggapi_pengaduan(
  p_pengaduan_id uuid, p_isi text, p_status text, p_kirim_email boolean, p_lampiran jsonb
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_p       public.pengaduan%ROWTYPE;
  v_isi     text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_tid     uuid;
  v_item    jsonb;
  v_n       int := 0;
  v_publik  text;
BEGIN
  SELECT me.id, me.role INTO v_me_id, v_me_role FROM public.staf_saya() AS me;
  IF v_me_id IS NULL OR v_me_role NOT IN ('admin', 'front_office') THEN
    RAISE EXCEPTION 'hanya Admin/Front Office yang boleh menanggapi pengaduan' USING ERRCODE = '42501';
  END IF;
  IF pg_catalog.char_length(v_isi) < 1 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RAISE EXCEPTION 'tanggapan harus 1-2000 karakter' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('diverifikasi','diproses','eskalasi','selesai','ditolak') THEN
    RAISE EXCEPTION 'status tidak valid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_p FROM public.pengaduan AS g WHERE g.id = p_pengaduan_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pengaduan tidak ditemukan' USING ERRCODE = 'P0002'; END IF;
  IF v_me_role = 'front_office' AND v_p.jalur <> 'layanan' THEN
    RAISE EXCEPTION 'jalur integritas hanya untuk Admin' USING ERRCODE = '42501';
  END IF;
  IF p_lampiran IS NOT NULL AND (pg_catalog.jsonb_typeof(p_lampiran) <> 'array' OR pg_catalog.jsonb_array_length(p_lampiran) > 3) THEN
    RAISE EXCEPTION 'lampiran maksimal 3 berkas' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.pengaduan_tanggapan (pengaduan_id, isi, status_baru, kirim_email, dibuat_oleh)
  VALUES (p_pengaduan_id, v_isi, p_status, COALESCE(p_kirim_email, false), v_me_id)
  RETURNING id INTO v_tid;

  FOR v_item IN SELECT * FROM pg_catalog.jsonb_array_elements(COALESCE(p_lampiran, '[]'::jsonb)) LOOP
    IF (v_item ->> 'kunci') !~ ('^pengaduan-bukti/' || p_pengaduan_id::text || '/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$') THEN
      RAISE EXCEPTION 'kunci lampiran tidak valid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.pengaduan_lampiran (tanggapan_id, kunci, nama_asli, mime, ukuran)
    VALUES (v_tid, v_item ->> 'kunci', pg_catalog.left(pg_catalog.btrim(v_item ->> 'nama'), 200),
            v_item ->> 'mime', (v_item ->> 'ukuran')::integer);
    v_n := v_n + 1;
  END LOOP;

  IF p_status IS NOT NULL AND p_status IS DISTINCT FROM v_p.status THEN
    UPDATE public.pengaduan SET status = p_status, updated_at = now() WHERE id = p_pengaduan_id;
    INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan, diubah_oleh)
    VALUES (p_pengaduan_id, v_p.status, p_status, 'status diubah bersama tanggapan', v_me_id);
  END IF;

  IF COALESCE(p_kirim_email, false) AND v_p.pelapor_email IS NOT NULL AND NOT v_p.anonim AND v_p.sumber <> 'impor' THEN
    SELECT s.value INTO v_publik FROM public.site_settings AS s WHERE s.key = 'public_url';
    PERFORM public.queue_notifikasi(
      NULL, v_p.pelapor_email, 'email',
      'Tanggapan atas laporan ' || v_p.nomor_tiket || ' - DPMPTSP Lampung',
      v_isi || E'\n\nPantau laporan Anda (nomor ' || v_p.nomor_tiket || ') di '
        || COALESCE(v_publik, 'https://lmh.lampungprov.go.id') || '/pengaduan/lacak'
        || CASE WHEN v_n > 0 THEN E'\nTanggapan ini memuat ' || v_n || ' lampiran; unduh dari halaman pantau.' ELSE '' END,
      pg_catalog.jsonb_build_object('type', 'pengaduan_tanggapan', 'pengaduan_id', p_pengaduan_id, 'tanggapan_id', v_tid)
    );
  END IF;
  RETURN v_tid;
END $$;
REVOKE ALL ON FUNCTION public.tanggapi_pengaduan(uuid, text, text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tanggapi_pengaduan(uuid, text, text, boolean, jsonb) TO authenticated;

-- ============================================================
-- Pantau publik (nomor laporan): tanggapan dan lampiran
-- ============================================================
CREATE OR REPLACE FUNCTION public.tanggapan_pengaduan_nomor(p_nomor text)
RETURNS TABLE (id uuid, isi text, status_baru text, created_at timestamptz, lampiran jsonb)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT t.id, t.isi, t.status_baru, t.created_at,
         COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', l.id, 'nama', l.nama_asli, 'mime', l.mime, 'ukuran', l.ukuran) ORDER BY l.created_at)
                   FROM public.pengaduan_lampiran AS l WHERE l.tanggapan_id = t.id), '[]'::jsonb)
  FROM public.pengaduan AS p
  JOIN public.pengaduan_tanggapan AS t ON t.pengaduan_id = p.id
  WHERE p.sumber = 'wizard'
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
  ORDER BY t.created_at
$$;
REVOKE ALL ON FUNCTION public.tanggapan_pengaduan_nomor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tanggapan_pengaduan_nomor(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.lampiran_pengaduan_nomor(p_nomor text, p_lampiran_id uuid)
RETURNS TABLE (kunci text, nama_asli text, mime text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT l.kunci, l.nama_asli, l.mime
  FROM public.pengaduan AS p
  JOIN public.pengaduan_tanggapan AS t ON t.pengaduan_id = p.id
  JOIN public.pengaduan_lampiran AS l ON l.tanggapan_id = t.id
  WHERE p.sumber = 'wizard' AND l.id = p_lampiran_id
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
REVOKE ALL ON FUNCTION public.lampiran_pengaduan_nomor(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lampiran_pengaduan_nomor(text, uuid) TO anon, authenticated;
