-- docs/rollback-identitas-satu-kesatuan-202611010003.sql
-- Rollback 202611010003_identitas_satu_kesatuan. HANYA pemilik, atomik, dry-run dulu:
--   node scripts/apply-migration.mjs docs/rollback-identitas-satu-kesatuan-202611010003.sql --atomic --dry-run
-- Mencabut trigger dan fungsi baru, mengembalikan layanan_selesai_khusus 4 argumen, chat_selesai_khusus (202610300002), dan
-- helper RLS Fase 3/4 (202610290001, 202610300001). Identitas yang SUDAH ditulis balik ke kunjungan TIDAK dikembalikan
-- (jejaknya ada di audit_log aksi pendataan_identitas_disatukan: nilai_lama / nilai_baru).
DROP TRIGGER IF EXISTS trg_tiket_selesai_wajib_email ON public.tiket_antrean;
DROP TRIGGER IF EXISTS trg_oss_identitas ON public.pelayanan_oss;
DROP TRIGGER IF EXISTS trg_perizinan_identitas ON public.pelayanan_perizinan;
DROP FUNCTION IF EXISTS public.tiket_selesai_wajib_email();
DROP FUNCTION IF EXISTS public.pelayanan_form_identitas();
DROP FUNCTION IF EXISTS public.layanan_selesai_khusus(uuid, uuid, text, jsonb, jsonb);
CREATE OR REPLACE FUNCTION public.layanan_selesai_khusus(
  p_tiket_id uuid,
  p_topik_id uuid,
  p_catatan  text,
  p_khusus   jsonb DEFAULT NULL
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
  v_lyn   uuid;
  v_me    uuid;
  v_n     integer := 0;
BEGIN
  -- Peran, sesi, kepemilikan, topik + catatan wajib ditegakkan layanan_selesai (Layanan ber-formulir ditolak INVALID_PAYLOAD).
  v_hasil := public.layanan_selesai(p_tiket_id, NULL::text, NULL::jsonb, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  IF v_pid IS NOT NULL THEN
    SELECT p.layanan_id INTO v_lyn FROM public.penanganan AS p WHERE p.id = v_pid;
    v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, p_khusus, v_me);
  ELSE
    -- Tiket lama tanpa tahap penanganan: tidak ada tempat menyimpan jawaban. Petugas diberi tahu (bukan diam-diam).
    v_hasil := v_hasil || pg_catalog.jsonb_build_object(
      'peringatan', 'Tiket ini berasal dari alur lama (tanpa tahap penanganan), sehingga Pendataan Khusus tidak disimpan.');
  END IF;
  RETURN v_hasil || pg_catalog.jsonb_build_object('khusus_tersimpan', v_n);
END $$;
REVOKE ALL ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb) TO authenticated;

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
  v_role  text;
  v_peran text;
  v_lyn   uuid;
  v_id    jsonb;
  v_lama  record;
  v_ubah  text[];
  v_lama_j jsonb;
  v_baru_j jsonb;
  v_n     integer := 0;
  v_now   timestamptz := pg_catalog.now();
BEGIN
  -- Peran, sesi, kepemilikan tahap, topik + catatan wajib ditegakkan chat_selesai.
  v_hasil := public.chat_selesai(p_sesi_id, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  v_kid := (v_hasil ->> 'kunjungan_id')::uuid;
  SELECT me.id, me.role INTO v_me, v_role FROM public.staf_saya() AS me;
  SELECT p.peran_tahap, p.layanan_id INTO v_peran, v_lyn FROM public.penanganan AS p WHERE p.id = v_pid;

  -- Pendataan Umum: identitas pengunjung (kosong = tidak diubah).
  v_id := public.pendataan_identitas_validasi(p_identitas);
  IF v_id <> '{}'::jsonb THEN
    SELECT k.nama, k.kontak_hp, k.email, k.asal_instansi, k.kategori, k.keperluan INTO v_lama
    FROM public.kunjungan AS k WHERE k.id = v_kid;
    SELECT pg_catalog.array_agg(e.key ORDER BY e.key) INTO v_ubah
    FROM pg_catalog.jsonb_each_text(v_id) AS e
    WHERE e.value IS DISTINCT FROM (pg_catalog.to_jsonb(v_lama) ->> e.key);
    IF v_ubah IS NOT NULL THEN
      UPDATE public.kunjungan AS k
         SET nama = COALESCE(v_id ->> 'nama', k.nama),
             kontak_hp = COALESCE(v_id ->> 'kontak_hp', k.kontak_hp),
             email = COALESCE(v_id ->> 'email', k.email),
             asal_instansi = COALESCE(v_id ->> 'asal_instansi', k.asal_instansi),
             kategori = COALESCE(v_id ->> 'kategori', k.kategori),
             keperluan = COALESCE(v_id ->> 'keperluan', k.keperluan),
             updated_at = v_now
       WHERE k.id = v_kid;
      -- Nilai lama/baru HANYA kolom yang berubah, agar koreksi dapat dipulihkan. audit_log hanya terbaca Admin
      -- (policy audit_log_admin_select) dan tidak disentuh job anonimisasi retensi: lihat docs/KEBIJAKAN_PDP.md.
      SELECT pg_catalog.jsonb_object_agg(k, pg_catalog.to_jsonb(v_lama) -> k) INTO v_lama_j FROM pg_catalog.unnest(v_ubah) AS k;
      SELECT pg_catalog.jsonb_object_agg(e.key, e.value) INTO v_baru_j
        FROM pg_catalog.jsonb_each_text(v_id) AS e WHERE e.key = ANY (v_ubah);
      INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
      VALUES (auth.uid(), v_role, 'chat_pendataan_identitas', 'kunjungan', v_kid::text,
              pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'penanganan_id', v_pid,
                'identitas_diubah', pg_catalog.to_jsonb(v_ubah)),
              v_lama_j, v_baru_j);
    END IF;
  END IF;

  -- Pendataan Khusus: hanya tahap Layanan (tahap FO tidak punya Layanan).
  IF v_peran = 'layanan' AND v_lyn IS NOT NULL THEN
    v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, p_khusus, v_me);
  ELSIF p_khusus IS NOT NULL AND pg_catalog.jsonb_typeof(p_khusus) = 'object' AND p_khusus <> '{}'::jsonb THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_BERLAKU: Pendataan Khusus hanya untuk chat yang diselesaikan petugas Layanan'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_hasil || pg_catalog.jsonb_build_object(
    'khusus_tersimpan', v_n,
    'identitas_diubah', pg_catalog.to_jsonb(COALESCE(v_ubah, ARRAY[]::text[])));
END $$;

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
  -- Lingkup data (§6.1): data sendiri / unit Koordinator, semua tanggal.
  IF public.boleh_data_pelayanan(p_peran_tahap, p_layanan, p_penangan) THEN
    RETURN true;
  END IF;
  -- Di luar lingkup data: hanya jendela operasional (tahap terbuka, atau kunjungan yang masih terbuka).
  IF NOT (p_status IN ('menunggu', 'berjalan') OR public.kunjungan_operasional(p_kunjungan)) THEN
    RETURN false;
  END IF;
  IF v_role = 'front_office' THEN
    -- Operasional FO: semua Layanan (memanggil, mengambil dari kotak masuk, mengelola antrean).
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    -- Aturan operasional petugas = 202610140009 (layanannya + konteks kunjungan + chat di layanannya).
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
  SELECT t.layanan_id, t.status, t.tanggal, t.dilayani_oleh INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_t.dilayani_oleh = v_id
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket AND p.penangan_id = v_id) THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_koord AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan THEN
    RETURN true;
  END IF;
  -- Jendela operasional: hanya tiket TERBUKA bertanggal >= kemarin (WIB), aturan lama boleh_tiket (FO semua;
  -- petugas layanannya). Tiket yang sudah selesai (termasuk hari ini) hanya dalam lingkup data.
  IF NOT (v_t.status IN ('menunggu', 'dipanggil', 'dilayani')
          AND v_t.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1) THEN
    RETURN false;
  END IF;
  RETURN v_role = 'front_office' OR (v_role = 'petugas' AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan);
END $$;

CREATE OR REPLACE FUNCTION public.boleh_baca_khusus(p_penanganan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT public.boleh_data_pelayanan(p.peran_tahap, p.layanan_id, p.penangan_id)
    FROM public.penanganan AS p
    WHERE p.id = p_penanganan
  ), false)
$$;

DROP FUNCTION IF EXISTS public.kunjungan_terapkan_identitas(uuid, jsonb, text, jsonb);
DROP FUNCTION IF EXISTS public.kunjungan_email_efektif(uuid);
DROP FUNCTION IF EXISTS public.email_nyata(text);
