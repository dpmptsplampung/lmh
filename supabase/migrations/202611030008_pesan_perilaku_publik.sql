-- 202611030008_pesan_perilaku_publik.sql
-- PESAN PERILAKU, jalur publik tanpa login dan sapaan (permintaan pemilik 2026-11-03):
--   1. get_survei_context mengembalikan juga `nama` (kunjungan.nama) untuk sapaan "Selamat Pagi/Siang/Sore, <nama>" di wizard.
--      Pemegang token undangan adalah pengunjung itu sendiri; hanya nama (tanpa HP/email) yang ditambahkan, token tetap 244 bit.
--   2. saran.sumber boleh 'publik' + kirim_saran_publik(p_isi, p_nama): saran dari tautan publik /saran, tanpa login dan tanpa
--      harus selesai dilayani. Nama opsional (ketikan pengirim sendiri, tidak terkait kunjungan).
--   3. kirim_pengaduan_publik(...): pengaduan dari /pengaduan. Nomor laporan acak tak tertebak ('P' + 8 karakter, sama dengan
--      Pesan Perilaku) supaya pelapor ANONIM tetap bisa memantau hanya dengan nomor; bila anonim, kontak TIDAK disimpan sama sekali.
--      pengaduan.sumber = 'publik' (petugas layanan tetap boleh membaca jalur 'layanan', bedanya dengan 'wizard').
--   4. lacak_pengaduan_nomor, tanggapan_pengaduan_nomor, lampiran_pengaduan_nomor melayani sumber 'wizard' DAN 'publik'.
-- SYARAT: 202611030003 (saran, pengaduan.sumber, generate_nomor_laporan, lacak_pengaduan_nomor) dan 202611030006 (tanggapan).
-- PENERAPAN (dry-run dulu; konfirmasi pemilik):
--   node scripts/apply-migration.mjs supabase/migrations/202611030008_pesan_perilaku_publik.sql --atomic --dry-run
-- ROLLBACK: docs/rollback-pesan-perilaku-publik-202611030008.sql.

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.saran') IS NULL OR pg_catalog.to_regclass('public.pengaduan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel saran/pengaduan belum ada (202611030003)';
  END IF;
  IF pg_catalog.to_regprocedure('public.generate_nomor_laporan()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: generate_nomor_laporan() belum ada (202611030003)';
  END IF;
  IF pg_catalog.to_regprocedure('public.tanggapan_pengaduan_nomor(text)') IS NULL
     OR pg_catalog.to_regprocedure('public.lampiran_pengaduan_nomor(text, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: fungsi tanggapan pengaduan belum ada (202611030006)';
  END IF;
  IF pg_catalog.to_regprocedure('public.tambah_hari_kerja(date, integer)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tambah_hari_kerja(date, integer) belum ada (202607290007)';
  END IF;
END $$;

-- ============================================================
-- 1. get_survei_context + nama
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_survei_context(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u       public.survei_undangan%ROWTYPE;
  v_layanan text;
  v_nama    text;
  v_status  text;
BEGIN
  SELECT * INTO v_u
  FROM public.survei_undangan AS u
  WHERE u.token = p_token;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'tidak_valid',
      'unit', NULL::text,
      'layanan_nama', NULL::text,
      'kedaluwarsa_pada', NULL::timestamptz,
      'nama', NULL::text
    );
  END IF;

  v_status := CASE
    WHEN v_u.diisi_pada IS NOT NULL THEN 'sudah_diisi'
    WHEN pg_catalog.now() >= v_u.kedaluwarsa_pada THEN 'kedaluwarsa'
    ELSE 'ok'
  END;

  SELECT l.nama INTO v_layanan FROM public.layanan AS l WHERE l.id = v_u.layanan_id;
  -- Nama hanya untuk undangan yang masih bisa diisi (sapaan); status lain tidak membutuhkannya.
  IF v_status = 'ok' THEN
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120) INTO v_nama FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'unit', v_u.unit,
    'layanan_nama', v_layanan,
    'kedaluwarsa_pada', v_u.kedaluwarsa_pada,
    'nama', NULLIF(v_nama, '')
  );
END $$;
REVOKE ALL ON FUNCTION public.get_survei_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_survei_context(text) TO anon, authenticated;

-- ============================================================
-- 2. saran dari tautan publik
-- ============================================================
DO $$
DECLARE
  v_nama text;
BEGIN
  FOR v_nama IN
    SELECT c.conname FROM pg_catalog.pg_constraint AS c
    WHERE c.conrelid = 'public.saran'::regclass AND c.contype = 'c'
      AND pg_catalog.pg_get_constraintdef(c.oid) ILIKE '%sumber%'
  LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.saran DROP CONSTRAINT %I', v_nama);
  END LOOP;
END $$;
ALTER TABLE public.saran
  ADD CONSTRAINT saran_sumber_check CHECK (sumber IN ('wizard', 'impor', 'publik'));

CREATE OR REPLACE FUNCTION public.kirim_saran_publik(p_isi text, p_nama text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_isi  text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama text := NULLIF(pg_catalog.left(pg_catalog.btrim(COALESCE(p_nama, '')), 120), '');
BEGIN
  IF pg_catalog.char_length(v_isi) < 5 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN 'invalid';
  END IF;
  INSERT INTO public.saran (isi, layanan_id, unit, kunjungan_id, undangan_id, pelapor_nama, sumber)
  VALUES (v_isi, NULL, 'tidak_diketahui', NULL, NULL, v_nama, 'publik');
  RETURN 'submitted';
END $$;
REVOKE ALL ON FUNCTION public.kirim_saran_publik(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran_publik(text, text) TO anon, authenticated;

-- ============================================================
-- 3. pengaduan dari tautan publik (anonim sungguhan)
-- ============================================================
CREATE OR REPLACE FUNCTION public.kirim_pengaduan_publik(
  p_jalur      text,
  p_isi        text,
  p_layanan_id uuid DEFAULT NULL,
  p_anonim     boolean DEFAULT false,
  p_kontak     text DEFAULT NULL
)
RETURNS TABLE (id uuid, nomor_tiket text)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_isi    text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_kontak text := NULLIF(pg_catalog.btrim(COALESCE(p_kontak, '')), '');
  v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_id     uuid;
  v_nomor  text;
  v_coba   int := 0;
BEGIN
  IF p_jalur IS NULL OR p_jalur NOT IN ('layanan', 'integritas') THEN
    RAISE EXCEPTION 'jalur tidak valid';
  END IF;
  IF pg_catalog.char_length(v_isi) < 10 OR pg_catalog.char_length(v_isi) > 5000 THEN
    RAISE EXCEPTION 'isi pengaduan harus 10 sampai 5000 karakter';
  END IF;
  p_anonim := COALESCE(p_anonim, false);
  -- Anonim: kontak dibuang di sini juga (pertahanan berlapis; klien yang salah kirim tidak membocorkan identitas).
  IF p_anonim THEN
    v_kontak := NULL;
  ELSIF v_kontak IS NULL THEN
    RAISE EXCEPTION 'kontak diperlukan agar kami dapat menghubungi Anda (atau pilih anonim)';
  END IF;

  LOOP
    v_coba := v_coba + 1;
    v_nomor := public.generate_nomor_laporan();
    BEGIN
      INSERT INTO public.pengaduan (
        nomor_tiket, jalur, layanan_id, isi, kontak, anonim, sumber, batas_verifikasi, batas_penanganan
      ) VALUES (
        v_nomor, p_jalur, CASE WHEN p_jalur = 'layanan' THEN p_layanan_id ELSE NULL END, v_isi, v_kontak, p_anonim, 'publik',
        public.tambah_hari_kerja(v_hari, 3), public.tambah_hari_kerja(v_hari, 14)
      ) RETURNING pengaduan.id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_coba >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  VALUES (v_id, NULL, 'baru', 'pengaduan diterima dari tautan publik');
  RETURN QUERY SELECT v_id, v_nomor;
END $$;
REVOKE ALL ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_publik(text, text, uuid, boolean, text) TO anon, authenticated;

-- ============================================================
-- 4. pelacakan dengan nomor laporan: 'wizard' dan 'publik'
-- ============================================================
CREATE OR REPLACE FUNCTION public.lacak_pengaduan_nomor(p_nomor text)
RETURNS TABLE (nomor_tiket text, status text, created_at timestamptz, updated_at timestamptz)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p.nomor_tiket, p.status, p.created_at, p.updated_at
  FROM public.pengaduan AS p
  WHERE p.sumber IN ('wizard', 'publik')
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.lacak_pengaduan_nomor(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lacak_pengaduan_nomor(text) TO anon, authenticated;

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
  WHERE p.sumber IN ('wizard', 'publik')
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
  WHERE p.sumber IN ('wizard', 'publik') AND l.id = p_lampiran_id
    AND p.nomor_tiket = pg_catalog.upper(pg_catalog.regexp_replace(COALESCE(p_nomor, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
REVOKE ALL ON FUNCTION public.lampiran_pengaduan_nomor(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lampiran_pengaduan_nomor(text, uuid) TO anon, authenticated;
