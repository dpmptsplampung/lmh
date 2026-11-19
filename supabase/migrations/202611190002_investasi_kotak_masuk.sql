-- Kotak Masuk Investasi: perluasan aditif, RPC atomik dan retensi terminal 365 hari.
-- Prasyarat: 202611160001_lingkup_layanan_staf dan 202611190001_ipro_inti.
ALTER TABLE public.investasi_lead
  ADD COLUMN kanal text NOT NULL DEFAULT 'dokumen' CHECK (kanal IN ('dokumen', 'ipro')),
  ADD COLUMN ipro_id uuid REFERENCES public.ipro_proyek(id) ON DELETE SET NULL,
  ADD COLUMN no_hp text CHECK (no_hp ~ '^\+?[0-9]{8,20}$'),
  ADD COLUMN aktor_uid uuid,
  ADD COLUMN operasi_id uuid,
  ADD COLUMN sidik text,
  ADD COLUMN consent_id uuid REFERENCES public.consent_log(id) ON DELETE SET NULL,
  ADD COLUMN petugas_id uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  ADD COLUMN versi integer NOT NULL DEFAULT 1 CHECK (versi > 0),
  ADD COLUMN aktivitas_pada timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT investasi_lead_konteks_kanal CHECK (
    (kanal = 'ipro' AND doc_id IS NULL) OR (kanal = 'dokumen' AND ipro_id IS NULL));
-- Baris lama tidak dianggap baru karena waktu penerapan migrasi.
-- Trigger baseline memperbarui updated_at pada setiap UPDATE, termasuk backfill.
-- Nonaktifkan hanya selama backfill agar waktu lama tidak berubah; pelaksana wajib satu transaksi.
ALTER TABLE public.investasi_lead DISABLE TRIGGER trg_investasi_lead_updated;
UPDATE public.investasi_lead SET aktivitas_pada = updated_at;
ALTER TABLE public.investasi_lead ENABLE TRIGGER trg_investasi_lead_updated;
CREATE UNIQUE INDEX investasi_lead_operasi ON public.investasi_lead(aktor_uid, operasi_id)
  WHERE operasi_id IS NOT NULL;
CREATE INDEX investasi_lead_kotak_masuk ON public.investasi_lead(kanal, status, created_at DESC);
CREATE INDEX investasi_lead_ipro ON public.investasi_lead(ipro_id);
CREATE INDEX investasi_lead_petugas ON public.investasi_lead(petugas_id);
CREATE INDEX investasi_lead_consent ON public.investasi_lead(consent_id);
CREATE INDEX investasi_lead_aktivitas ON public.investasi_lead(aktivitas_pada);

DROP POLICY IF EXISTS investasi_lead_insert ON public.investasi_lead;
DROP POLICY IF EXISTS investasi_lead_select_staff ON public.investasi_lead;
DROP POLICY IF EXISTS investasi_lead_update_admin ON public.investasi_lead;
REVOKE ALL ON TABLE public.investasi_lead FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.investasi_lead FROM authenticated;
GRANT SELECT ON TABLE public.investasi_lead TO authenticated;
CREATE POLICY investasi_lead_select_staff ON public.investasi_lead FOR SELECT TO authenticated
  USING ((SELECT public.boleh_kelola_investasi()));

CREATE FUNCTION public.investasi_kirim_minat(
  p_kanal text, p_ref_id uuid, p_nama text, p_email text, p_no_hp text,
  p_instansi text, p_pesan text, p_setuju_pdp boolean, p_versi_kebijakan text, p_operasi_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nama text := btrim(p_nama);
  v_email text := btrim(p_email);
  v_nomor text := nullif(regexp_replace(p_no_hp, '[[:space:].()\-]', '', 'g'), '');
  v_instansi text := nullif(btrim(p_instansi), '');
  v_pesan text := nullif(btrim(p_pesan), '');
  v_kebijakan text := btrim(p_versi_kebijakan);
  v_sidik text;
  v_lama public.investasi_lead;
  v_id uuid;
  v_consent uuid;
  v_judul text;
  v_url text;
  v_penerima record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'LOGIN_DIPERLUKAN' USING ERRCODE = '28000';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
  IF p_kanal IS NULL OR p_kanal NOT IN ('ipro', 'dokumen')
    OR p_operasi_id IS NULL OR p_ref_id IS NULL
    OR v_nama IS NULL OR char_length(v_nama) NOT BETWEEN 1 AND 200
    OR v_email IS NULL OR char_length(v_email) > 254
    OR v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
    OR (v_nomor IS NOT NULL AND v_nomor !~ '^\+?[0-9]{8,20}$')
    OR char_length(v_instansi) > 200
    OR char_length(v_pesan) > 2000
    OR (p_kanal = 'ipro' AND (v_pesan IS NULL OR char_length(v_pesan) < 10))
    OR p_setuju_pdp IS NOT TRUE
    OR v_kebijakan IS NULL OR char_length(v_kebijakan) NOT BETWEEN 1 AND 20 THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;

  -- Sidik hanya dari isian yang sudah dinormalkan, termasuk versi persetujuan.
  v_sidik := md5(jsonb_build_object('kanal', p_kanal, 'ref_id', p_ref_id, 'nama', v_nama,
    'email', v_email, 'no_hp', v_nomor, 'instansi', v_instansi, 'pesan', v_pesan,
    'setuju_pdp', p_setuju_pdp, 'versi_kebijakan', v_kebijakan)::text);
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text || p_operasi_id::text, 0));
  SELECT l.* INTO v_lama FROM public.investasi_lead AS l
    WHERE l.aktor_uid = v_uid AND l.operasi_id = p_operasi_id;
  IF FOUND THEN
    IF v_lama.sidik IS DISTINCT FROM v_sidik THEN
      RAISE EXCEPTION 'KONFLIK_OPERASI' USING ERRCODE = '40001';
    END IF;
    RETURN jsonb_build_object('id', v_lama.id);
  END IF;

  -- Hanya operasi baru memerlukan konteks yang masih tersedia.
  -- Retry mengembalikan tanda terima lama meski IPRO diarsipkan/dokumen dinonaktifkan,
  -- tanpa menyentuh kuota laju, consent, lead atau notifikasi.
  IF p_kanal = 'ipro' THEN
    SELECT p.judul INTO v_judul FROM public.ipro_proyek AS p
      WHERE p.id = p_ref_id AND p.status = 'terbit' AND p.sumber = 'ptsp';
  ELSE
    SELECT d.judul INTO v_judul FROM public.investment_documents AS d
      WHERE d.id = p_ref_id AND d.status = 'aktif';
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002';
  END IF;

  -- Satu kunci untuk batas global dan per UID; pencatatan tetap oleh trigger yang sudah ada.
  PERFORM pg_advisory_xact_lock(hashtextextended('investasi.laju', 0));
  IF NOT public.check_anon_rate('investasi_lead_insert', 5, 3600)
    OR NOT public.check_anon_rate('investasi_lead_insert', 20, 86400)
    OR (SELECT count(*) FROM public.anon_rate_limit
      WHERE action = 'investasi_lead_insert' AND created_at > now() - interval '600 seconds') >= 100 THEN
    RAISE EXCEPTION 'TERLALU_BANYAK' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.consent_log (subjek_ref, tujuan, disetujui, versi_kebijakan)
    VALUES (v_uid::text, 'investasi_minat', true, v_kebijakan) RETURNING id INTO v_consent;
  INSERT INTO public.investasi_lead (
    kanal, ipro_id, doc_id, nama, email, no_hp, instansi, catatan,
    status, aktor_uid, operasi_id, sidik, consent_id
  ) VALUES (
    p_kanal, CASE WHEN p_kanal = 'ipro' THEN p_ref_id END,
    CASE WHEN p_kanal = 'dokumen' THEN p_ref_id END,
    v_nama, v_email, v_nomor, v_instansi, v_pesan, 'baru', v_uid, p_operasi_id, v_sidik, v_consent
  ) RETURNING id INTO v_id;

  -- Email hanya membawa konteks publik dan tautan kotak masuk; tanpa isian pengirim.
  v_url := coalesce(nullif((SELECT s.value FROM public.site_settings AS s WHERE s.key = 'public_url'), ''),
    'https://lmh.lampungprov.go.id');
  FOR v_penerima IN
    SELECT p.id, p.role, p.email_notifikasi FROM public.petugas AS p
    WHERE p.aktif AND p.email_notifikasi IS NOT NULL AND p.email_notifikasi_verified_at IS NOT NULL
      AND (
        (p.role = 'petugas' AND EXISTS (
          SELECT 1 FROM public.layanan AS l WHERE l.id = p.layanan_id AND l.modul = 'investasi'))
        OR (p.role = 'admin' AND NOT EXISTS (
          SELECT 1 FROM public.petugas AS q JOIN public.layanan AS l ON l.id = q.layanan_id
          WHERE q.role = 'petugas' AND q.aktif AND l.modul = 'investasi'
            AND q.email_notifikasi IS NOT NULL AND q.email_notifikasi_verified_at IS NOT NULL))
      )
  LOOP
    INSERT INTO public.notifikasi (tujuan_email, kanal, subjek, body, payload, idempotency_key)
      VALUES (v_penerima.email_notifikasi, 'email', 'Pesan baru di Kotak Masuk Investasi',
        format(E'Ada pesan baru untuk %s: %s.\n\nBuka %s%s?id=%s untuk menindaklanjuti.',
          CASE WHEN p_kanal = 'ipro' THEN 'IPRO' ELSE 'Dokumen' END, v_judul, rtrim(v_url, '/'),
          CASE WHEN v_penerima.role = 'petugas' THEN '/petugas/investasi/kotak-masuk'
            ELSE '/admin/investasi-leads' END, v_id),
        jsonb_build_object('type', 'investasi_minat', 'lead_id', v_id, 'kanal', p_kanal),
        format('investasi_minat:%s:%s', v_id, v_penerima.id))
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
  END LOOP;
  RETURN jsonb_build_object('id', v_id);
END $$;
REVOKE ALL ON FUNCTION public.investasi_kirim_minat(text, uuid, text, text, text, text, text, boolean, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.investasi_kirim_minat(text, uuid, text, text, text, text, text, boolean, text, uuid)
  TO authenticated;

CREATE FUNCTION public.investasi_ubah_status_minat(p_id uuid, p_status text, p_versi integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_lama public.investasi_lead; v_petugas uuid;
BEGIN
  IF NOT public.boleh_kelola_investasi() THEN
    RAISE EXCEPTION 'DILARANG' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai') THEN
    RAISE EXCEPTION 'INPUT_TIDAK_VALID' USING ERRCODE = '22023';
  END IF;
  SELECT l.* INTO v_lama FROM public.investasi_lead AS l WHERE l.id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TIDAK_DITEMUKAN' USING ERRCODE = 'P0002';
  END IF;
  IF p_versi IS DISTINCT FROM v_lama.versi THEN
    RAISE EXCEPTION 'KONFLIK_VERSI' USING ERRCODE = '40001';
  END IF;
  SELECT p.id INTO v_petugas FROM public.petugas AS p WHERE p.auth_user_id = auth.uid() AND p.aktif;
  UPDATE public.investasi_lead SET status = p_status, versi = versi + 1,
    aktivitas_pada = clock_timestamp(), petugas_id = coalesce(petugas_id, v_petugas)
    WHERE id = p_id RETURNING * INTO v_lama;
  RETURN jsonb_build_object('id', v_lama.id, 'status', v_lama.status, 'versi', v_lama.versi);
END $$;
REVOKE ALL ON FUNCTION public.investasi_ubah_status_minat(uuid, text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.investasi_ubah_status_minat(uuid, text, integer) TO authenticated;

CREATE FUNCTION public.investasi_bersihkan_retensi() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE v_jumlah integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('investasi.retensi', 0)) THEN
    RETURN jsonb_build_object('berjalan', true);
  END IF;
  DELETE FROM public.investasi_lead WHERE id IN (
    SELECT id FROM public.investasi_lead
    WHERE status IN ('selesai', 'ditolak') AND aktivitas_pada < now() - interval '365 days'
    ORDER BY aktivitas_pada, id LIMIT 500 FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_jumlah = ROW_COUNT;
  -- consent_log tetap disimpan sebagai bukti persetujuan.
  RETURN jsonb_build_object('dihapus', v_jumlah);
END $$;
REVOKE ALL ON FUNCTION public.investasi_bersihkan_retensi() FROM PUBLIC, anon, authenticated, service_role;
-- pg_cron memakai UTC: 19:25 UTC = 02:25 WIB hari berikutnya.
SELECT cron.schedule('investasi_retensi_harian', '25 19 * * *', 'SELECT public.investasi_bersihkan_retensi()');
