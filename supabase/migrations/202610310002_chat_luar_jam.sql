-- 202610310002_chat_luar_jam.sql
-- Fase 5 (spec docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md §8, §4.4; rencana
-- docs/superpowers/plans/2026-10-31-fase-5-live-chat.md Task 2). Forward-only, ADITIF terhadap data (B1): tidak ada
-- DELETE/TRUNCATE/DROP; tidak ada UPDATE nilai lama di luar fungsi operasional yang memang mengubah sesi.
--
-- ISI
--   1. chat_layanan_status(layanan): SATU fungsi keputusan "petugas chat tersedia?" = is_layanan_buka_jadwal (jadwal
--      per Layanan + hari_libur + arsip; spec §4.4: jadwal per Layanan adalah satu-satunya sumber kebenaran, Layanan yang
--      buka Sabtu = buka; keputusan lead atas K5). Kunci 'hari_tanpa_layanan' = Layanan tidak beroperasi sama sekali
--      hari itu (per Layanan, bukan lagi kalender global). Juga mengembalikan kapan petugas berikutnya bertugas (<= 30
--      hari). Dibaca anon/authenticated (data publik, tanpa PII).
--   2. chat_minta_petugas(sesi, eksplisit): pengunjung (pemilik sesi) meminta bicara dengan petugas.
--        - Jam kerja (buka): sesi bot -> eskalasi (trigger 202610140012 membuat kunjungan + kotak masuk FO), pesan sistem
--          'minta_petugas'. Tanpa email (alur lama).
--        - Di luar jam: sesi bot -> eskalasi, pesan sistem persis spec (jenis 'minta_petugas_luar_jam' = penanda sesi sudah
--          diberi tahu) dan email diantrekan ke petugas Layanan (aktif, role 'petugas', email_notifikasi terverifikasi;
--          bila tak ada, FO aktif ber-email terverifikasi) lewat notifikasi.idempotency_key (satu email per sesi per
--          penerima per PERCAKAPAN dan hari buka berikutnya: kunci pengunjung:layanan:tanggal-buka:penerima, sehingga
--          sesi baru tidak menggandakan email). Isi email TANPA PII pengunjung (tanpa nama/isi pesan).
--        - Anti-banjir (review Fase 5 A3): menolak JWT anonim (B5: chat hanya login Google; LOGIN_GOOGLE) dan sesi tanpa
--          satu pun pesan pengunjung (PESAN_WAJIB; implisit = noop).
--        - eksplisit = false (dipanggil route saat pesan pengunjung masuk): hanya bertindak untuk sesi 'eskalasi' yang
--          menunggu di luar jam dan belum diberi tahu (mis. Layanan tanpa bot, eskalasi otomatis sebelum jam tutup); tidak
--          pernah menaikkan sesi 'bot'; tanpa pembatas laju.
--        - Sesi dikunci FOR NO KEY UPDATE sebelum membaca penanda: klik ganda/serentak tidak menggandakan pesan/email.
--   3. chat_selesai: SALINAN 202610140009 (§8) kecuali satu blok pesan penutup: kalimat 'Tautan survei kepuasan layanan akan
--      disediakan di sini.' dihapus (Q24). Jenis 'penutup_survei' dipertahankan (penanda penutup sesi; klien lama aman).
--      chat_selesai_khusus (Fase 4) memanggilnya apa adanya.
--   4. tutup_chat_tertinggal: SALINAN 202610140012 (§10) kecuali (a) sesi 'eskalasi' baru ditutup setelah ada hari operasional
--      Layanan (jadwal per Layanan) penuh sejak aktivitas terakhir (chat_ada_hari_kerja_sejak; batas aman 14 hari) dan (b) teks pesan tutup
--      (percakapan kini berlanjut, bukan "mulai chat baru"). Sesi 'aktif' tetap 24 jam.
--
-- KODE GALAT chat_minta_petugas (awal pesan): FORBIDDEN, LOGIN_GOOGLE, NOT_FOUND, INVALID_STATUS, LAYANAN_TIDAK_VALID,
--   PESAN_WAJIB, RATE_LIMIT.
-- SYARAT / URUTAN: setelah 202610310001, 202610290001, 202610270002, 202610140012. Penjaga di bagian 0.
-- PENERAPAN (pemilik; WAJIB atomik; dry-run dulu; bersama 202610310001):
--   node scripts/apply-migration.mjs supabase/migrations/202610310002_chat_luar_jam.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610310002_chat_luar_jam.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi (status -> kalender global lama; minta petugas -> 409 lalu jalur lama).
-- Idempoten. Rollback tidak disediakan (aditif); memulihkan chat_selesai/tutup_chat_tertinggal = CREATE OR REPLACE dari
-- 202610140009 §8 / 202610140012 §10.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.boleh_chat_sesi(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610310001_chat_lingkup_percakapan belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.is_layanan_buka_jadwal(uuid,date,time without time zone)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610270002_jadwal_tunggal_layanan belum diterapkan (is_layanan_buka_jadwal)';
  END IF;
  IF pg_catalog.to_regprocedure('public.tutup_chat_tertinggal()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140012_perbaikan_review belum diterapkan (tutup_chat_tertinggal)';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_pesan_sistem(uuid,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_ubah_sesi(uuid,text,uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_selesai(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140009_chat_online belum diterapkan';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.petugas'::regclass AND a.attname = 'email_notifikasi_verified_at' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: 202610090002_akun_username belum diterapkan (petugas.email_notifikasi_verified_at)';
  END IF;
END $$;

-- ============================================================
-- 1. Status jadwal chat per Layanan
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_layanan_status(p_layanan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tgl    date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_jam    time := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::time;
  v_tanpa  boolean;
  v_buka   boolean;
  v_libur  text;
  v_next   date;
  v_mulai  time;
  d        date;
  i        integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_id AND l.aktif = true) THEN
    RETURN pg_catalog.jsonb_build_object('ada', false, 'buka', false, 'tanggal', v_tgl);
  END IF;

  -- Satu sumber kebenaran: jadwal per Layanan (spec §4.4). v_tanpa = Layanan tidak beroperasi sama sekali hari ini.
  v_tanpa := NOT public.is_layanan_buka_jadwal(p_layanan_id, v_tgl, NULL);
  v_buka  := public.is_layanan_buka_jadwal(p_layanan_id, v_tgl, v_jam);
  SELECT h.keterangan INTO v_libur FROM public.hari_libur AS h WHERE h.tanggal = v_tgl LIMIT 1;

  IF NOT v_buka THEN
    FOR i IN 0..30 LOOP
      d := v_tgl + i;
      IF public.is_layanan_buka_jadwal(p_layanan_id, d, NULL) THEN
        v_mulai := COALESCE(
          (SELECT e.jam_mulai FROM public.jadwal_pengecualian AS e
            WHERE e.layanan_id = p_layanan_id AND e.tanggal = d AND e.jenis <> 'libur'),
          (SELECT s.jam_mulai FROM public.jadwal_standby AS s
            WHERE s.layanan_id = p_layanan_id AND s.hari = EXTRACT(ISODOW FROM d)::smallint AND s.aktif = true),
          time '08:00');
        -- Hari ini hanya bila jam mulai belum lewat (sesudah jam selesai: hari berikutnya).
        IF i = 0 AND v_jam >= v_mulai THEN
          CONTINUE;
        END IF;
        v_next := d;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ada', true,
    'buka', v_buka,
    'tanggal', v_tgl,
    'hari_tanpa_layanan', v_tanpa,
    'libur_keterangan', v_libur,
    'buka_berikutnya_tanggal', v_next,
    'buka_berikutnya_jam', CASE WHEN v_next IS NULL THEN NULL ELSE pg_catalog.to_char(v_mulai, 'HH24:MI') END
  );
END $$;

REVOKE ALL ON FUNCTION public.chat_layanan_status(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_layanan_status(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.chat_layanan_status(uuid) IS
  '202610310002: petugas chat tersedia? = is_layanan_buka_jadwal(WIB, per Layanan); plus kapan buka berikutnya.';

-- Ada hari operasional Layanan (jadwal per Layanan buka) sejak p_sejak (hari-hari SESUDAH tanggal
-- p_sejak sampai hari ini WIB)? Aktivitas yang lebih tua dari 14 hari dianggap sudah melewati hari operasional.
CREATE OR REPLACE FUNCTION public.chat_ada_hari_kerja_sejak(p_layanan uuid, p_sejak timestamptz)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_awal     date := (p_sejak AT TIME ZONE 'Asia/Jakarta')::date;
  v_hari_ini date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  d          date;
BEGIN
  IF v_awal < v_hari_ini - 14 THEN
    RETURN true;
  END IF;
  d := v_awal + 1;
  WHILE d <= v_hari_ini LOOP
    IF public.is_layanan_buka_jadwal(p_layanan, d, NULL) THEN
      RETURN true;
    END IF;
    d := d + 1;
  END LOOP;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.chat_ada_hari_kerja_sejak(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ada_hari_kerja_sejak(uuid, timestamptz) TO service_role;

-- ============================================================
-- 2. Pengunjung meminta petugas (eskalasi + pesan tunggu + email berdedup di luar jam)
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_minta_petugas(p_sesi_id uuid, p_eksplisit boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_s         record;
  v_l         record;
  v_status    jsonb;
  v_buka      boolean;
  v_sudah     boolean;
  v_msg       uuid;
  v_pesan     jsonb;
  v_url       text;
  v_n         integer := 0;
  v_baris     integer;
  r           record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: login diperlukan' USING ERRCODE = '42501';
  END IF;
  -- B5: live chat hanya login Google; JWT anonim tidak boleh memicu email ke petugas (A3).
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RAISE EXCEPTION 'LOGIN_GOOGLE: permintaan petugas hanya untuk pengunjung yang login dengan Google' USING ERRCODE = '42501';
  END IF;

  SELECT s.id, s.status, s.layanan_id, s.pengunjung_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.pengunjung AS p WHERE p.id = v_s.pengunjung_id AND p.auth_user_id = v_uid) THEN
    RAISE EXCEPTION 'FORBIDDEN: sesi chat bukan milik Anda' USING ERRCODE = '42501';
  END IF;
  IF v_s.status = 'selesai' THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.nama, l.aktif, l.punya_chat INTO v_l FROM public.layanan AS l WHERE l.id = v_s.layanan_id;
  IF v_l.nama IS NULL OR NOT v_l.aktif OR NOT COALESCE(v_l.punya_chat, false) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tidak aktif atau tidak melayani chat' USING ERRCODE = '22023';
  END IF;

  -- Anti-banjir (A3): sesi kosong (belum ada satu pun pesan pengunjung) tidak boleh memicu eskalasi/email.
  IF NOT EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = p_sesi_id AND m.pengirim = 'pengunjung') THEN
    IF p_eksplisit THEN
      RAISE EXCEPTION 'PESAN_WAJIB: tulis pertanyaan Anda terlebih dahulu sebelum meminta petugas' USING ERRCODE = 'P0001';
    END IF;
    RETURN pg_catalog.jsonb_build_object('ok', true, 'noop', true, 'buka', NULL, 'status', v_s.status,
      'sudah_diminta', false, 'penerima', 0, 'pesan', NULL);
  END IF;

  IF v_s.status = 'aktif' THEN
    -- Sudah dipegang petugas: tidak ada yang perlu dilakukan.
    RETURN pg_catalog.jsonb_build_object('ok', true, 'noop', true, 'buka', NULL, 'status', v_s.status,
      'sudah_diminta', false, 'penerima', 0, 'pesan', NULL);
  END IF;

  v_status := public.chat_layanan_status(v_s.layanan_id);
  v_buka   := COALESCE((v_status ->> 'buka')::boolean, false);
  v_sudah  := EXISTS (SELECT 1 FROM public.chat_pesan AS m
                      WHERE m.sesi_id = p_sesi_id AND m.jenis_jawaban = 'minta_petugas_luar_jam');

  -- Panggilan implisit (dari pesan pengunjung): hanya sesi 'eskalasi' yang menunggu di luar jam dan belum diberi tahu.
  IF NOT p_eksplisit AND (v_s.status <> 'eskalasi' OR v_buka OR v_sudah) THEN
    RETURN pg_catalog.jsonb_build_object('ok', true, 'noop', true, 'buka', v_buka, 'status', v_s.status,
      'sudah_diminta', v_sudah, 'penerima', 0, 'pesan', NULL);
  END IF;

  IF p_eksplisit THEN
    -- Pembatas laju: 5 permintaan eksplisit per 60 detik per pengguna.
    IF (SELECT pg_catalog.count(*) FROM public.anon_rate_limit AS rl
        WHERE rl.user_id = v_uid AND rl.action = 'chat_minta_petugas'
          AND rl.created_at > pg_catalog.now() - INTERVAL '60 seconds') >= 5 THEN
      RAISE EXCEPTION 'RATE_LIMIT: terlalu banyak permintaan, coba lagi sebentar' USING ERRCODE = 'P0001';
    END IF;
    INSERT INTO public.anon_rate_limit (user_id, action) VALUES (v_uid, 'chat_minta_petugas');
  END IF;

  IF v_buka THEN
    IF v_s.status = 'eskalasi' THEN
      -- Sudah menunggu petugas pada jam kerja: tidak ada pesan ganda.
      RETURN pg_catalog.jsonb_build_object('ok', true, 'noop', true, 'buka', true, 'status', 'eskalasi',
        'sudah_diminta', true, 'penerima', 0, 'pesan', NULL);
    END IF;
    PERFORM public.chat_ubah_sesi(p_sesi_id, 'eskalasi', NULL);
    v_msg := public.chat_pesan_sistem(p_sesi_id, pg_catalog.format(
      'Permintaan Anda diteruskan ke petugas %s. Mohon tunggu, petugas akan segera membalas.', v_l.nama),
      'minta_petugas');
  ELSE
    IF v_sudah THEN
      RETURN pg_catalog.jsonb_build_object('ok', true, 'noop', true, 'buka', false, 'status', v_s.status,
        'sudah_diminta', true, 'penerima', 0, 'pesan', NULL);
    END IF;
    IF v_s.status = 'bot' THEN
      PERFORM public.chat_ubah_sesi(p_sesi_id, 'eskalasi', NULL);
    END IF;
    v_msg := public.chat_pesan_sistem(p_sesi_id,
      'Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja.',
      'minta_petugas_luar_jam');

    -- Email ke petugas Layanan (tanpa PII pengunjung); FO hanya bila Layanan tak punya petugas ber-email terverifikasi.
    v_url := COALESCE((SELECT st.value FROM public.site_settings AS st WHERE st.key = 'public_url'),
                      'https://lmh.lampungprov.go.id');
    FOR r IN
      SELECT p.id, p.email_notifikasi
      FROM public.petugas AS p
      WHERE p.aktif = true
        AND p.email_notifikasi IS NOT NULL
        AND p.email_notifikasi_verified_at IS NOT NULL
        AND (
          (p.role = 'petugas' AND p.layanan_id = v_s.layanan_id)
          OR (p.role = 'front_office'
              AND NOT EXISTS (
                SELECT 1 FROM public.petugas AS q
                WHERE q.role = 'petugas' AND q.layanan_id = v_s.layanan_id AND q.aktif = true
                  AND q.email_notifikasi IS NOT NULL AND q.email_notifikasi_verified_at IS NOT NULL))
        )
    LOOP
      INSERT INTO public.notifikasi (tujuan_user_id, tujuan_email, kanal, subjek, body, payload, idempotency_key)
      VALUES (
        NULL, r.email_notifikasi, 'email',
        pg_catalog.format('Permintaan chat pengunjung - %s', v_l.nama),
        pg_catalog.format(
          E'Seorang pengunjung meminta berbicara dengan petugas %s melalui Live Chat di luar jam operasional.\n\n'
          || E'Mohon buka %s/admin/chat?sesi=%s pada jam kerja untuk membalas.\n\n'
          || 'Email ini dikirim otomatis satu kali untuk setiap percakapan yang menunggu.',
          v_l.nama, v_url, p_sesi_id),
        pg_catalog.jsonb_build_object('type', 'chat_minta_petugas', 'sesi_id', p_sesi_id, 'layanan_id', v_s.layanan_id),
        -- Dedup per PERCAKAPAN (pengunjung + Layanan) dan hari buka berikutnya, bukan per sesi (A3).
        pg_catalog.format('chat_minta_petugas:%s:%s:%s:%s', v_s.pengunjung_id, v_s.layanan_id,
                          COALESCE(v_status ->> 'buka_berikutnya_tanggal', 'tanpa-jadwal'), r.id)
      )
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
      GET DIAGNOSTICS v_baris = ROW_COUNT;
      v_n := v_n + v_baris;
    END LOOP;
  END IF;

  SELECT pg_catalog.jsonb_build_object('id', m.id, 'pengirim', m.pengirim, 'isi', m.isi,
                                       'created_at', m.created_at, 'jenis_jawaban', m.jenis_jawaban)
    INTO v_pesan FROM public.chat_pesan AS m WHERE m.id = v_msg;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'noop', false, 'buka', v_buka, 'status', 'eskalasi',
    'sudah_diminta', false, 'penerima', v_n, 'pesan', v_pesan);
END $$;

REVOKE ALL ON FUNCTION public.chat_minta_petugas(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_minta_petugas(uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.chat_minta_petugas(uuid, boolean) IS
  '202610310002: pengunjung meminta petugas. Di luar jam: pesan tunggu + email berdedup ke petugas Layanan (tanpa PII).';

-- ============================================================
-- 3. chat_selesai: salinan 202610140009 (§8) tanpa kalimat tautan survei (Q24)
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_selesai(p_sesi_id uuid, p_topik_id uuid, p_catatan text)
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


REVOKE ALL ON FUNCTION public.chat_selesai(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_selesai(uuid, uuid, text) TO authenticated;

-- ============================================================
-- 4. tutup_chat_tertinggal: salinan 202610140012 (§10); sesi eskalasi menunggu hari operasional penuh (K10)
-- ============================================================
CREATE OR REPLACE FUNCTION public.tutup_chat_tertinggal()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_now     timestamptz := pg_catalog.now();
  v_batas   timestamptz := pg_catalog.now() - INTERVAL '24 hours';
  v_catatan text := 'Ditutup otomatis oleh sistem: chat tanpa aktivitas lebih dari 24 jam';
  v_jumlah  integer := 0;
  r         record;
  v_s       record;
  p         record;
BEGIN
  FOR r IN
    SELECT s.id FROM public.chat_sesi AS s
    WHERE s.status IN ('eskalasi', 'aktif')
      AND GREATEST(s.created_at,
                   COALESCE((SELECT pg_catalog.max(m.created_at) FROM public.chat_pesan AS m WHERE m.sesi_id = s.id),
                            s.created_at)) < v_batas
      -- Fase 5 (K10): sesi 'eskalasi' (menunggu petugas) baru ditutup setelah ada hari operasional Layanan penuh sejak
      -- aktivitas terakhir, supaya permintaan di luar jam/akhir pekan tidak hangus sebelum petugas bertugas.
      AND (s.status = 'aktif'
           OR public.chat_ada_hari_kerja_sejak(
                s.layanan_id,
                GREATEST(s.created_at,
                         COALESCE((SELECT pg_catalog.max(m.created_at) FROM public.chat_pesan AS m WHERE m.sesi_id = s.id),
                                  s.created_at))))
    ORDER BY s.created_at, s.id
  LOOP
    -- Urutan kunci chat: chat_sesi -> kunjungan -> penanganan. Periksa ulang setelah kunci (pesan/RPC serentak).
    SELECT s.id, s.status, s.kunjungan_id, s.ditangani_oleh INTO v_s
    FROM public.chat_sesi AS s WHERE s.id = r.id FOR NO KEY UPDATE;
    IF v_s.id IS NULL OR v_s.status NOT IN ('eskalasi', 'aktif')
       OR EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = r.id AND m.created_at >= v_batas) THEN
      CONTINUE;
    END IF;

    IF v_s.kunjungan_id IS NOT NULL THEN
      PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id FOR UPDATE;

      FOR p IN
        UPDATE public.penanganan AS q
           SET status = 'batal',
               batal_karena = CASE WHEN q.status = 'berjalan' THEN 'tidak_ditutup' ELSE 'tidak_terlayani' END,
               selesai_at = v_now,
               catatan = COALESCE(q.catatan, v_catatan)
         WHERE q.kunjungan_id = v_s.kunjungan_id AND q.status IN ('menunggu', 'berjalan')
        RETURNING q.id, q.peran_tahap, q.layanan_id, q.penangan_id, q.mulai_at, q.batal_karena
      LOOP
        INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
        VALUES (
          NULL, 'system', 'tutup_otomatis_penanganan', 'penanganan', p.id::text,
          pg_catalog.jsonb_build_object('kunjungan_id', v_s.kunjungan_id, 'chat_sesi_id', r.id,
            'peran_tahap', p.peran_tahap, 'layanan_id', p.layanan_id, 'penangan_id', p.penangan_id, 'mulai_at', p.mulai_at),
          pg_catalog.jsonb_build_object('status', CASE WHEN p.batal_karena = 'tidak_ditutup' THEN 'berjalan' ELSE 'menunggu' END),
          pg_catalog.jsonb_build_object('status', 'batal', 'batal_karena', p.batal_karena)
        );
      END LOOP;

      -- Sudah dilayani staf -> 'selesai' (keputusan 202610140008; memicu SKM); belum pernah diambil -> tidak_terlayani.
      UPDATE public.kunjungan AS k
         SET status = CASE WHEN k.status = 'dilayani' THEN 'selesai' ELSE 'tidak_terlayani' END, updated_at = v_now
       WHERE k.id = v_s.kunjungan_id AND k.status IN ('menunggu', 'dilayani')
         AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                         WHERE x.kunjungan_id = v_s.kunjungan_id AND x.status IN ('menunggu', 'berjalan'))
         AND NOT EXISTS (SELECT 1 FROM public.tiket_antrean AS y
                         WHERE y.kunjungan_id = v_s.kunjungan_id AND y.status IN ('menunggu', 'dipanggil', 'dilayani'));
    END IF;

    -- ditangani_oleh dipertahankan (riwayat).
    PERFORM public.chat_ubah_sesi(r.id, 'selesai', v_s.ditangani_oleh);
    PERFORM public.chat_pesan_sistem(r.id,
      'Sesi chat ini ditutup otomatis karena tidak ada aktivitas lebih dari 24 jam. '
      || 'Anda dapat melanjutkan percakapan kapan saja dengan mengirim pesan baru.');
    v_jumlah := v_jumlah + 1;
  END LOOP;

  RETURN v_jumlah;
END $$;

REVOKE ALL ON FUNCTION public.tutup_chat_tertinggal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tutup_chat_tertinggal() TO service_role;
