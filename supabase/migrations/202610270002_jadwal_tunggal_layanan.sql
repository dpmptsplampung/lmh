-- 202610270002_jadwal_tunggal_layanan.sql
-- Fase 1 (fondasi Layanan dinamis), langkah 2: satu jadwal per Layanan, hari libur global, arsip, dan
-- saklar antrean menutup gerbang tiket/reservasi. Spesifikasi: docs/superpowers/specs (rancangan layanan
-- dinamis) dan ADR 0001-0003. BELUM diterapkan ke database mana pun; tes kontrak statis di
-- supabase/migrations/jadwal_tunggal_layanan.test.ts.
--
--   1. is_layanan_buka_jadwal: layanan harus ada & aktif (arsip = aktif false), lalu hari_libur global,
--      lalu logika pengecualian/pola mingguan 202607290010 TANPA perubahan. jadwal_berikutnya disalin
--      utuh karena memanggilnya.
--   2. layanan_sudah_tutup_untuk(layanan, waktu): batas tutup global ATAU jadwal layanan itu sudah lewat
--      (pengecualian tanggal menang atas pola mingguan, seperti is_layanan_buka_jadwal).
--   3. fo_eskalasi (dari 202610140007) dan admin_alihkan (dari 202610140012): cek tutup memakai batas
--      per layanan tujuan. Selebihnya identik dengan versi sumber.
--   4. reservasi_buat (dari 202610140012): akhir pekan hanya menolak bertemu_seseorang; hari libur
--      menolak keduanya; loket mengandalkan jadwal layanan.
--   5. v_antrian_loket (dari 202610140007): saklar punya_antrean menggantikan tipe = 'konsultatif'.
--   6. Trigger: layanan baru otomatis mendapat jadwal Senin-Jumat 08:00-15:30; tulisan baru ke
--      jadwal_standby tidak boleh melewati jam_tutup_layanan(). Baris lama tidak disentuh.
--
-- Tidak ada UPDATE/DELETE atas data yang ada. Tabel layanan_jadwal/layanan_libur dibiarkan.

-- ============================================================
-- 1. Gerbang jadwal: layanan aktif + hari libur global + pola mingguan
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_layanan_buka_jadwal(
  p_layanan_id uuid,
  p_tanggal date,
  p_jam time DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_dow smallint := EXTRACT(ISODOW FROM p_tanggal)::smallint;
  v_exc public.jadwal_pengecualian%ROWTYPE;
  v_std public.jadwal_standby%ROWTYPE;
BEGIN
  -- 202610270002 (1): layanan harus ada dan aktif (arsip = aktif false) sebelum aturan jadwal apa pun.
  IF NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_id AND l.aktif = true) THEN
    RETURN false;
  END IF;
  -- 202610270002 (2): hari libur nasional/kantor (global) menutup semua layanan.
  IF EXISTS (SELECT 1 FROM public.hari_libur AS h WHERE h.tanggal = p_tanggal) THEN
    RETURN false;
  END IF;

  -- Pengecualian menang atas pola.
  SELECT * INTO v_exc FROM public.jadwal_pengecualian
   WHERE layanan_id = p_layanan_id AND tanggal = p_tanggal;
  IF FOUND THEN
    IF v_exc.jenis = 'libur' THEN
      RETURN false;
    END IF;
    -- ganti_hari / jam_beda: buka bila ada jam; cek jam bila diberikan.
    IF p_jam IS NULL THEN
      RETURN v_exc.jam_mulai IS NOT NULL;
    END IF;
    RETURN p_jam >= COALESCE(v_exc.jam_mulai, time '08:00')
       AND p_jam <= COALESCE(v_exc.jam_selesai, time '15:30');
  END IF;

  -- Pola mingguan.
  SELECT * INTO v_std FROM public.jadwal_standby
   WHERE layanan_id = p_layanan_id AND hari = v_dow AND aktif = true;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF p_jam IS NULL THEN
    RETURN true;
  END IF;
  RETURN p_jam >= v_std.jam_mulai AND p_jam <= v_std.jam_selesai;
END $$;

-- Disalin utuh dari 202607290010 (memanggil is_layanan_buka_jadwal di atas).
CREATE OR REPLACE FUNCTION public.jadwal_berikutnya(
  p_layanan_id uuid,
  p_dari_tanggal date DEFAULT ((now() AT TIME ZONE 'Asia/Jakarta')::date)
)
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v date := p_dari_tanggal;
  v_limit date := p_dari_tanggal + 60; -- batas pencarian 60 hari
BEGIN
  WHILE v <= v_limit LOOP
    IF public.is_layanan_buka_jadwal(p_layanan_id, v, NULL) THEN
      RETURN v;
    END IF;
    v := v + 1;
  END LOOP;
  RETURN NULL;
END $$;

-- ============================================================
-- 2. Batas tutup per layanan
-- ============================================================
-- SECURITY DEFINER seperti layanan_sudah_tutup/jam_tutup_layanan. Tutup bila: batas global terlewati,
-- ATAU jadwal layanan untuk hari WIB itu sudah lewat. Urutan sama dengan is_layanan_buka_jadwal:
-- jadwal_pengecualian (libur / ganti jam) menang atas pola jadwal_standby; tanpa baris keduanya = tutup.
CREATE OR REPLACE FUNCTION public.layanan_sudah_tutup_untuk(
  p_layanan_id uuid,
  p_waktu timestamptz DEFAULT now()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_wib     timestamp := p_waktu AT TIME ZONE 'Asia/Jakarta';
  v_tgl     date := (p_waktu AT TIME ZONE 'Asia/Jakarta')::date;
  v_jam     time := (p_waktu AT TIME ZONE 'Asia/Jakarta')::time;
  v_exc     public.jadwal_pengecualian%ROWTYPE;
  v_selesai time;
BEGIN
  IF public.layanan_sudah_tutup(p_waktu) THEN
    RETURN true;
  END IF;

  -- Pengecualian menang atas pola mingguan (sama dengan is_layanan_buka_jadwal).
  SELECT * INTO v_exc FROM public.jadwal_pengecualian AS e
   WHERE e.layanan_id = p_layanan_id AND e.tanggal = v_tgl;
  IF FOUND THEN
    IF v_exc.jenis = 'libur' THEN
      RETURN true;
    END IF;
    -- ganti_hari / jam_beda tanpa jam_mulai = tidak buka (is_layanan_buka_jadwal: "buka bila ada jam").
    IF v_exc.jam_mulai IS NULL THEN
      RETURN true;
    END IF;
    RETURN v_jam > COALESCE(v_exc.jam_selesai, time '15:30');
  END IF;

  -- Pola mingguan.
  SELECT s.jam_selesai INTO v_selesai
    FROM public.jadwal_standby AS s
   WHERE s.layanan_id = p_layanan_id
     AND s.hari = EXTRACT(ISODOW FROM v_wib)::smallint
     AND s.aktif = true;
  IF NOT FOUND THEN
    RETURN true;
  END IF;
  RETURN v_jam > v_selesai;
END $$;

REVOKE ALL ON FUNCTION public.layanan_sudah_tutup_untuk(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_sudah_tutup_untuk(uuid, timestamptz) TO authenticated;

-- ============================================================
-- 3. fo_eskalasi: salinan utuh 202610140007 (3.6); hanya blok cek buka/tutup yang berubah
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_eskalasi(
  p_penanganan_id uuid,
  p_layanan_id    uuid,
  p_topik_id      uuid,
  p_catatan       text
)
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
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_kid     uuid;
  v_p       record;
  v_l       record;
  v_topik   text;
  v_catatan text;
  v_tiket   uuid;
  v_nomor   text;
  v_pl      uuid;
  v_tahap   integer;
  v_notif   integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT p.kunjungan_id INTO v_kid FROM public.penanganan AS p WHERE p.id = p_penanganan_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: penanganan tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p WHERE p.id = p_penanganan_id FOR UPDATE;

  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'BUKAN_TAHAP_FO: penanganan ini milik petugas layanan' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.saluran = 'chat' THEN
    RAISE EXCEPTION 'SALURAN_CHAT: chat diteruskan tanpa tiket lewat RPC chat (Tahap C)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: penanganan tidak sedang berjalan (status=%)', v_p.status USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: penanganan ini dilayani staf lain' USING ERRCODE = '42501';
  END IF;
  v_topik   := public.fo_validasi_topik(p_topik_id, NULL);
  v_catatan := public.fo_validasi_catatan(p_catatan, 200);

  SELECT l.id, l.nama, l.aktif, l.punya_antrean INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_id;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tanpa antrean' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_layanan_buka_jadwal(p_layanan_id, v_tgl, NULL) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini (libur/di luar jadwal/diarsipkan)', v_l.nama
      USING ERRCODE = 'P0001';
  END IF;
  IF public.layanan_sudah_tutup_untuk(p_layanan_id) THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: % sudah tutup untuk hari ini', v_l.nama USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'dieskalasi', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = p_penanganan_id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  v_tiket := public.terbit_tiket(v_kid, p_layanan_id);
  UPDATE public.tiket_antrean AS t SET penanganan_asal_id = p_penanganan_id WHERE t.id = v_tiket
  RETURNING t.nomor_display INTO v_nomor;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'layanan', p_layanan_id, v_p.saluran, v_tiket, 'menunggu', v_me_id)
  RETURNING id INTO v_pl;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_kid;

  v_notif := public.fo_notifikasi_tiket(v_tiket, 'eskalasi');

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'kunjungan_id', v_kid,
    'penanganan_fo_id', p_penanganan_id,
    'penanganan_layanan_id', v_pl,
    'tiket_id', v_tiket,
    'nomor_display', v_nomor,
    'layanan_id', p_layanan_id,
    'layanan_nama', v_l.nama,
    'petugas_hadir', public.antrean_dibuka(p_layanan_id, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

REVOKE ALL ON FUNCTION public.fo_eskalasi(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fo_eskalasi(uuid, uuid, uuid, text) TO authenticated;

-- ============================================================
-- 4. admin_alihkan: salinan utuh 202610140012 (#8); hanya blok cek buka/tutup yang berubah
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_alihkan(
  p_tiket_id       uuid,
  p_layanan_tujuan uuid,
  p_alasan         text
)
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
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_kid     uuid;
  v_legacy  uuid;
  v_t       record;
  v_p       record;
  v_l       record;
  v_baru    uuid;
  v_nomor   text;
  v_tahap   integer;
  v_pb      uuid;
  v_notif   integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['admin']) AS s;
  IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'ALASAN_WAJIB: alasan pengalihan wajib 5-500 karakter' USING ERRCODE = '22023';
  END IF;

  SELECT t.kunjungan_id, t.legacy_visit_id INTO v_kid, v_legacy
  FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF v_kid IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: tiket tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_legacy IS NOT NULL OR NOT EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket_id) THEN
    RAISE EXCEPTION 'TIKET_LAMA: hanya tiket hasil eskalasi FO yang dapat dialihkan' USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT t.* INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id FOR UPDATE;
  IF v_t.status NOT IN ('menunggu', 'dipanggil', 'dilayani') THEN
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dapat dialihkan (status=%)', v_t.status USING ERRCODE = 'P0001';
  END IF;
  IF p_layanan_tujuan = v_t.layanan_id THEN
    RAISE EXCEPTION 'LAYANAN_SAMA: layanan tujuan sama dengan layanan tiket' USING ERRCODE = '22023';
  END IF;
  SELECT l.id, l.nama, l.aktif, l.punya_antrean INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_tujuan;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tanpa antrean' USING ERRCODE = '22023';
  END IF;
  -- 202610140012 #8: sama dengan fo_eskalasi (tiket baru tidak boleh terbit di antrean yang tidak beroperasi/tutup).
  IF NOT public.is_layanan_buka_jadwal(p_layanan_tujuan, v_tgl, NULL) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini (libur/di luar jadwal/diarsipkan)', v_l.nama
      USING ERRCODE = 'P0001';
  END IF;
  IF public.layanan_sudah_tutup_untuk(p_layanan_tujuan) THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: % sudah tutup untuk hari ini', v_l.nama USING ERRCODE = 'P0001';
  END IF;

  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: tiket terbuka tanpa tahap penanganan terbuka' USING ERRCODE = 'P0001';
  END IF;

  v_baru := public.terbit_tiket(v_kid, p_layanan_tujuan);
  UPDATE public.tiket_antrean AS t SET penanganan_asal_id = v_t.penanganan_asal_id WHERE t.id = v_baru
  RETURNING t.nomor_display INTO v_nomor;

  UPDATE public.tiket_antrean AS t
     SET status = 'dialihkan', waktu_selesai = v_now, updated_at = v_now, dialihkan_ke = v_baru
   WHERE t.id = p_tiket_id AND t.status = v_t.status;

  UPDATE public.penanganan AS p
     SET status = 'batal', batal_karena = 'dialihkan', selesai_at = v_now,
         catatan = pg_catalog.left('Dialihkan Admin: ' || v_alasan, 1000)
   WHERE p.id = v_p.id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, tiket_id, status, dibuat_oleh)
  VALUES (v_kid, v_tahap, 'layanan', p_layanan_tujuan, v_p.saluran, v_baru, 'menunggu', v_me_id)
  RETURNING id INTO v_pb;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_kid;

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (
    auth.uid(), v_me_role, 'admin_alihkan', 'tiket_antrean', p_tiket_id::text,
    pg_catalog.jsonb_build_object('tiket_lama', p_tiket_id, 'tiket_baru', v_baru, 'kunjungan_id', v_kid,
      'layanan_lama', v_t.layanan_id, 'layanan_baru', p_layanan_tujuan, 'status_lama', v_t.status,
      'pemilik_lama', v_t.dilayani_oleh, 'alasan', v_alasan),
    pg_catalog.jsonb_build_object('layanan_id', v_t.layanan_id, 'status', v_t.status, 'dilayani_oleh', v_t.dilayani_oleh),
    pg_catalog.jsonb_build_object('layanan_id', p_layanan_tujuan, 'status', 'dialihkan', 'tiket_baru', v_baru)
  );

  v_notif := public.fo_notifikasi_tiket(v_baru, 'dialihkan');

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'tiket_lama_id', p_tiket_id,
    'tiket_baru_id', v_baru,
    'nomor_display', v_nomor,
    'layanan_id', p_layanan_tujuan,
    'layanan_nama', v_l.nama,
    'penanganan_id', v_pb,
    'petugas_hadir', public.antrean_dibuka(p_layanan_tujuan, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

REVOKE ALL ON FUNCTION public.admin_alihkan(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_alihkan(uuid, uuid, text) TO authenticated;

-- ============================================================
-- 5. reservasi_buat: salinan utuh 202610140012 (#9); hanya cek akhir pekan/libur yang berubah
-- ============================================================
CREATE OR REPLACE FUNCTION public.reservasi_buat(
  p_tujuan            text,
  p_tanggal           date,
  p_layanan_id        uuid DEFAULT NULL,
  p_nama_yang_ditemui text DEFAULT NULL,
  p_keperluan         text DEFAULT NULL,
  p_jam_rencana       time DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_pg      record;
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_tujuan  text := pg_catalog.btrim(COALESCE(p_tujuan, ''));
  v_ditemui text := NULLIF(pg_catalog.btrim(COALESCE(p_nama_yang_ditemui, '')), '');
  v_kep     text := NULLIF(pg_catalog.btrim(COALESCE(p_keperluan, '')), '');
  v_l       record;
  v_jumlah  integer;
  v_kid     uuid;
  v_qr      text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: masuk terlebih dahulu' USING ERRCODE = '42501';
  END IF;
  SELECT p.id, p.nama, p.no_hp, p.email, p.asal_instansi, p.kategori INTO v_pg
  FROM public.pengunjung AS p WHERE p.auth_user_id = v_uid;
  IF v_pg.id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN: profil pengunjung belum ada' USING ERRCODE = '42501';
  END IF;
  IF NOT public.sesi_valid() THEN
    RAISE EXCEPTION 'SESI_TIDAK_SAH: sesi Anda tidak berlaku lagi; silakan masuk kembali' USING ERRCODE = '42501';
  END IF;

  IF v_tujuan NOT IN ('loket', 'bertemu_seseorang') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: tujuan harus loket atau bertemu_seseorang' USING ERRCODE = '22023';
  END IF;
  IF p_tanggal IS NULL OR p_tanggal < v_tgl OR p_tanggal > v_tgl + 7 THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: tanggal reservasi hari ini sampai 7 hari ke depan' USING ERRCODE = '22023';
  END IF;
  -- 202610270002: akhir pekan hanya menutup tujuan bertemu_seseorang; loket mengikuti jadwal layanan
  -- (is_layanan_buka_jadwal di bawah). Hari libur kantor menutup keduanya.
  IF v_tujuan = 'bertemu_seseorang' AND EXTRACT(ISODOW FROM p_tanggal) IN (6, 7) THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: reservasi tidak tersedia pada akhir pekan' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.hari_libur AS h WHERE h.tanggal = p_tanggal) THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: kantor libur pada tanggal tersebut' USING ERRCODE = '22023';
  END IF;
  IF v_kep IS NOT NULL AND pg_catalog.char_length(v_kep) > 500 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan maksimal 500 karakter' USING ERRCODE = '22023';
  END IF;

  IF v_tujuan = 'loket' THEN
    SELECT l.id, l.nama, l.aktif, l.punya_antrean, l.status_tampilan, l.kuota_harian INTO v_l
    FROM public.layanan AS l WHERE l.id = p_layanan_id;
    IF v_l.id IS NULL OR NOT v_l.aktif OR NOT v_l.punya_antrean OR v_l.status_tampilan = 'nonaktif' THEN
      RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tidak tersedia untuk reservasi' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_layanan_buka_jadwal(p_layanan_id, p_tanggal, NULL) THEN
      RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi pada tanggal tersebut', v_l.nama USING ERRCODE = 'P0001';
    END IF;
    v_ditemui := NULL;
  ELSE
    IF v_ditemui IS NULL OR pg_catalog.char_length(v_ditemui) NOT BETWEEN 3 AND 120 THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: nama yang ditemui wajib 3-120 karakter' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Serialkan reservasi per (layanan/tujuan, tanggal) agar kuota dan cek ganda tidak bocor saat serentak. Kunci memakai
  -- tujuan EFEKTIF (202610140012 #9): p_layanan_id hanya bermakna untuk 'loket' (untuk 'bertemu_seseorang' nilai dari
  -- klien diabaikan, sama seperti saat INSERT), sehingga semua reservasi bertemu_seseorang pada tanggal itu bertemu
  -- pada kunci yang sama.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('lmh.reservasi:'
      || COALESCE(CASE WHEN v_tujuan = 'loket' THEN p_layanan_id::text END, v_tujuan) || ':' || p_tanggal::text));

  IF EXISTS (
    SELECT 1 FROM public.kunjungan AS k
    WHERE k.pengunjung_id = v_pg.id AND k.asal = 'reservasi' AND k.status = 'terjadwal' AND k.tanggal = p_tanggal
      AND k.tujuan = v_tujuan AND k.layanan_saran_id IS NOT DISTINCT FROM (CASE WHEN v_tujuan = 'loket' THEN p_layanan_id END)
  ) THEN
    RAISE EXCEPTION 'RESERVASI_GANDA: Anda sudah punya reservasi yang sama pada tanggal ini' USING ERRCODE = 'P0001';
  END IF;

  IF v_tujuan = 'loket' THEN
    IF v_l.kuota_harian IS NOT NULL THEN
      SELECT pg_catalog.count(*)::integer INTO v_jumlah FROM public.kunjungan AS k
      WHERE k.asal = 'reservasi' AND k.layanan_saran_id = p_layanan_id AND k.tanggal = p_tanggal
        AND k.status IN ('terjadwal', 'menunggu', 'dilayani', 'selesai');
      IF v_jumlah >= v_l.kuota_harian THEN
        RAISE EXCEPTION 'KUOTA_PENUH: kuota reservasi % pada tanggal tersebut sudah penuh', v_l.nama USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, keperluan, tujuan, layanan_saran_id, nama_yang_ditemui, jam_rencana,
    created_at, updated_at
  ) VALUES (
    v_pg.id, v_pg.nama, v_pg.no_hp, 'reservasi', v_qr, p_tanggal, v_now, 'terjadwal',
    v_pg.asal_instansi, v_pg.kategori, v_pg.email, v_kep, v_tujuan,
    CASE WHEN v_tujuan = 'loket' THEN p_layanan_id END, v_ditemui, p_jam_rencana,
    v_now, v_now
  ) RETURNING id INTO v_kid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'kunjungan_id', v_kid, 'qr_token', v_qr, 'tanggal', p_tanggal, 'status', 'terjadwal');
END $$;

REVOKE ALL ON FUNCTION public.reservasi_buat(text, date, uuid, text, text, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservasi_buat(text, date, uuid, text, text, time) TO authenticated;

-- ============================================================
-- 6. v_antrian_loket: kolom identik dengan 202610140007; hanya WHERE yang berubah
-- ============================================================
CREATE OR REPLACE VIEW public.v_antrian_loket AS
SELECT
  service.id    AS layanan_id,
  service.nama  AS layanan_nama,
  service.tipe,
  count(t.id) FILTER (WHERE t.status = 'menunggu')  AS antre_count,
  count(t.id) FILTER (WHERE t.status = 'dilayani')  AS dilayani_count,
  COALESCE((
    SELECT e.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_durasi_menit,
  count(t.id) FILTER (WHERE t.status = 'menunggu') * COALESCE((
    SELECT e.avg_durasi_menit
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 15) AS estimasi_tunggu_total_menit,
  COALESCE((
    SELECT e.sample_count
    FROM public.mv_estimasi_layanan AS e
    WHERE e.layanan_id = service.id
      AND e.jam_slot = EXTRACT(HOUR FROM now())
    LIMIT 1
  ), 0) AS sample_count
FROM public.layanan AS service
LEFT JOIN public.tiket_antrean AS t
  ON  t.layanan_id = service.id
  AND t.status IN ('menunggu', 'dilayani')
  AND t.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE service.punya_antrean = true
  AND service.aktif = true
GROUP BY service.id, service.nama, service.tipe;

REVOKE ALL  ON public.v_antrian_loket FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_antrian_loket TO anon, authenticated;

-- ============================================================
-- 7. Jadwal default untuk layanan baru
-- ============================================================
-- AFTER INSERT: baris jadwal_standby butuh layanan.id yang sudah ada (FK). ON CONFLICT DO NOTHING agar
-- aman bila jadwal sudah disiapkan lebih dulu. SECURITY DEFINER supaya tidak bergantung RLS pemanggil.
CREATE OR REPLACE FUNCTION public.layanan_isi_jadwal_default()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.jadwal_standby (layanan_id, hari, jam_mulai, jam_selesai, aktif)
  SELECT NEW.id, d, time '08:00', time '15:30', true
    FROM pg_catalog.generate_series(1, 5) AS d
  ON CONFLICT (layanan_id, hari) DO NOTHING;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.layanan_isi_jadwal_default() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_layanan_jadwal_default ON public.layanan;
CREATE TRIGGER trg_layanan_jadwal_default
  AFTER INSERT ON public.layanan
  FOR EACH ROW EXECUTE FUNCTION public.layanan_isi_jadwal_default();

-- ============================================================
-- 8. Jam tutup per layanan tidak boleh melewati batas global
-- ============================================================
-- BEFORE INSERT OR UPDATE saja: hanya menilai baris yang sedang ditulis; baris lama tidak disentuh.
CREATE OR REPLACE FUNCTION public.jadwal_standby_batas_tutup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.jam_mulai >= NEW.jam_selesai THEN
    RAISE EXCEPTION 'JADWAL_TIDAK_VALID: jam mulai harus lebih awal dari jam selesai'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.jam_selesai > public.jam_tutup_layanan() THEN
    RAISE EXCEPTION 'JADWAL_TIDAK_VALID: jam selesai melewati batas tutup layanan pukul % WIB',
      pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.jadwal_standby_batas_tutup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_jadwal_standby_batas_tutup ON public.jadwal_standby;
CREATE TRIGGER trg_jadwal_standby_batas_tutup
  BEFORE INSERT OR UPDATE ON public.jadwal_standby
  FOR EACH ROW EXECUTE FUNCTION public.jadwal_standby_batas_tutup();
