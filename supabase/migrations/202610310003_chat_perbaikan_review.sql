-- 202610310003_chat_perbaikan_review.sql
-- Fase 5, perbaikan hasil review akhir (rencana docs/superpowers/plans/2026-10-31-fase-5-live-chat.md). Forward-only,
-- ADITIF terhadap data (B1): tidak ada DELETE/TRUNCATE/DROP, tidak ada UPDATE data. Hanya fungsi (CREATE OR REPLACE).
--
-- ISI
--   1. A1 chat_boleh_riwayat(sesi): siapa yang boleh membaca RIWAYAT LINTAS SESI sebuah percakapan: admin, FO Koordinator,
--      atau petugas yang Layanannya = Layanan sesi jangkar DAN (Koordinator atau penangan sesi itu saat ini). Selain itu
--      route hanya memuat sesi yang boleh dibaca RLS (klien berJWT pengguna), bukan service-role. Ini menutup jalur
--      `chat_teruskan` (penangan FO lama tetap lolos boleh_chat_sesi) dan jendela operasional FO atas semua sesi terbuka.
--   2. A2 chat_sesi_jaga_rpc: SALINAN 202610140009 §3 + satu blok: pengunjung_id sesi tidak boleh diganti ke nilai lain di
--      luar RPC chat (flag lmh.chat_rpc). SET NULL (FK/anonimisasi) tetap boleh. (Policy UPDATE chat_sesi menjadi
--      pemilik-saja di 202610310001.)
--   3. A4 gerbang "hari tanpa pelayanan" per Layanan (spec §4.4: jadwal per Layanan = satu sumber kebenaran; menggantikan
--      kalender global Sabtu/Minggu/hari_libur milik 202610140012 §11). SALINAN 202610140012 dengan perbedaan hanya pada
--      gerbang: chat_sesi_eskalasi_kunjungan (per NEW.layanan_id), chat_pesan_eskalasi_kunjungan (per layanan sesi; kolom
--      layanan_id ditambahkan ke SELECT), chat_ambil (dicek sesudah sesi dimuat, dengan Layanan sesi), chat_teruskan
--      (Layanan tujuan). Gerbang = is_layanan_buka_jadwal(Layanan, hari ini WIB, NULL) (buka sedikitnya sebagian hari itu).
--      Fungsi hari_tanpa_layanan(date) dibiarkan (tak lagi dipakai chat).
--   4. B kunjungan_operasional: SALINAN 202610290001 §2 + satu blok: kunjungan asal 'online' yang masih punya penanganan
--      TERBUKA (menunggu/berjalan) selalu operasional, tak peduli tanggal (chat dieskalasi Jumat, menunggu hingga Senin,
--      identitas pengunjung tetap terbaca FO/petugas yang boleh mengambilnya). Tanpa mengubah 202610290001.
--
-- SYARAT / URUTAN: setelah 202610310002 (dan 202610310001, 202610290001, 202610140012, 202610140009, 202610270002);
-- sebelum 202611010001. Penjaga di bagian 0.
-- PENERAPAN (pemilik; WAJIB atomik; dry-run dulu; bersama 202610310001/0002):
--   node scripts/apply-migration.mjs supabase/migrations/202610310003_chat_perbaikan_review.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610310003_chat_perbaikan_review.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi (route: RPC belum ada = aturan lama). Idempoten. Rollback tidak disediakan
-- (aditif): fungsi sumber dapat dipulihkan dari berkas asalnya (lihat daftar di atas).

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.chat_minta_petugas(uuid,boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_chat_sesi(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610310001/202610310002 belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL
     OR pg_catalog.to_regprocedure('public.kunjungan_operasional(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290001_koordinator_akses_data belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.is_layanan_buka_jadwal(uuid,date,time without time zone)') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_ambil(uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_teruskan(uuid,uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_sesi_jaga_rpc()') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_sesi_eskalasi_kunjungan()') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_pesan_eskalasi_kunjungan()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140009/202610140012/202610270002 belum diterapkan (fungsi chat atau jadwal)';
  END IF;
END $$;

-- ============================================================
-- 1. A1: izin riwayat lintas sesi
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_boleh_riwayat(p_sesi uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staf_lingkup() AS me
    JOIN public.chat_sesi AS s ON s.id = p_sesi
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (me.role = 'petugas' AND me.layanan_id IS NOT NULL AND s.layanan_id = me.layanan_id
           AND (me.koordinator OR s.ditangani_oleh = me.id))
  )
$$;

REVOKE ALL ON FUNCTION public.chat_boleh_riwayat(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_boleh_riwayat(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.chat_boleh_riwayat(uuid) IS
  '202610310003: riwayat LINTAS SESI percakapan hanya untuk admin, FO Koordinator, atau petugas Layanan jangkar (Koordinator/penangan kini).';

-- ============================================================
-- 2. A2: pemilik sesi tidak dapat dipindah (salinan 202610140009 §3 + satu blok)
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_sesi_jaga_rpc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('lmh.chat_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.kunjungan_id IS NOT NULL OR NEW.ditangani_oleh IS NOT NULL OR NEW.status NOT IN ('bot', 'eskalasi') THEN
      RAISE EXCEPTION 'CHAT_HARUS_RPC: sesi chat baru harus berstatus bot/eskalasi tanpa penangan' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- SET NULL akibat FK (kunjungan/petugas terhapus) diizinkan.
  IF NEW.kunjungan_id IS DISTINCT FROM OLD.kunjungan_id
     AND NOT (NEW.kunjungan_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = OLD.kunjungan_id)) THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: kunjungan sesi chat hanya diubah RPC chat' USING ERRCODE = '42501';
  END IF;
  IF NEW.ditangani_oleh IS DISTINCT FROM OLD.ditangani_oleh
     AND NOT (NEW.ditangani_oleh IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.petugas AS p WHERE p.id = OLD.ditangani_oleh)) THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: penangan sesi chat hanya diubah lewat chat_ambil/chat_teruskan/chat_selesai'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'bot' AND NEW.status IN ('eskalasi', 'selesai') AND OLD.kunjungan_id IS NULL) THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: status sesi chat % -> % hanya lewat RPC chat', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;
  -- Fase 5 (A2): pemilik sesi tidak boleh dipindah (staf tidak boleh mengarahkan ulang sesi ke pengunjung lain).
  -- SET NULL akibat FK/anonimisasi tetap diizinkan; mengisi/mengganti dengan nilai lain hanya lewat RPC chat (flag).
  IF NEW.pengunjung_id IS DISTINCT FROM OLD.pengunjung_id AND NEW.pengunjung_id IS NOT NULL THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: pemilik sesi chat tidak dapat diubah' USING ERRCODE = '42501';
  END IF;
  IF NEW.layanan_id IS DISTINCT FROM OLD.layanan_id AND OLD.kunjungan_id IS NOT NULL THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: layanan sesi chat tercatat hanya diubah lewat chat_teruskan' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.chat_sesi_jaga_rpc() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 3. A4: gerbang hari tanpa pelayanan per Layanan (salinan 202610140012 §11)
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_sesi_eskalasi_kunjungan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_kid uuid;
BEGIN
  -- Batas spam: hanya sesi yang sudah punya pesan pengunjung (sesi kosong menunggu pesan pertamanya).
  -- 202610140012 #13: hari tanpa pelayanan tidak mencatat kunjungan (live chat dengan petugas tidak tersedia).
  IF NEW.status = 'eskalasi' AND NEW.kunjungan_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'eskalasi')
     AND EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = NEW.id AND m.pengirim = 'pengunjung')
     AND public.is_layanan_buka_jadwal(NEW.layanan_id, (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date, NULL) THEN
    v_kid := public.chat_buat_kunjungan(NEW.id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chat_sesi_eskalasi_kunjungan() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_pesan_eskalasi_kunjungan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s   record;
  v_kid uuid;
BEGIN
  SELECT s.id, s.status, s.kunjungan_id, s.layanan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = NEW.sesi_id FOR NO KEY UPDATE;
  -- 202610140012 #13: hari tanpa pelayanan tidak mencatat kunjungan (dicatat pada pesan berikutnya di hari kerja).
  IF v_s.id IS NOT NULL AND v_s.status = 'eskalasi' AND v_s.kunjungan_id IS NULL
     AND public.is_layanan_buka_jadwal(v_s.layanan_id, (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date, NULL) THEN
    v_kid := public.chat_buat_kunjungan(NEW.sesi_id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.sesi_id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chat_pesan_eskalasi_kunjungan() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.chat_ambil(p_sesi_id uuid, p_alasan text DEFAULT NULL)
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
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_s       record;
  v_kid     uuid;
  v_p       record;
  v_tahap   integer;
  v_pid     uuid;
  v_peran   text;
  v_lyn     uuid;
  v_n       integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin', 'petugas']) AS s;

  SELECT s.id, s.status, s.layanan_id, s.kunjungan_id, s.ditangani_oleh INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  -- Fase 5 (A4): hari tanpa pelayanan = Layanan SESI ini tidak beroperasi hari ini (jadwal per Layanan, spec §4.4).
  IF NOT public.is_layanan_buka_jadwal(v_s.layanan_id, (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date, NULL) THEN
    RAISE EXCEPTION 'HARI_TANPA_LAYANAN: chat tidak dapat diambil karena layanan tidak beroperasi hari ini (di luar jadwal/hari libur)'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_me_role = 'petugas' AND (v_me_lyn IS NULL OR v_s.layanan_id IS DISTINCT FROM v_me_lyn) THEN
    RAISE EXCEPTION 'FORBIDDEN: chat ini bukan untuk layanan Anda' USING ERRCODE = '42501';
  END IF;
  IF v_s.status = 'selesai' THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  -- Sesi bot (belum eskalasi) atau sesi lama tanpa kunjungan: catat sekarang (masuk "kotak masuk" lalu diambil).
  v_kid := v_s.kunjungan_id;
  IF v_kid IS NULL THEN
    v_kid := public.chat_buat_kunjungan(p_sesi_id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', p_sesi_id);
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_kid AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: sesi chat belum selesai tetapi tidak punya tahap terbuka' USING ERRCODE = 'P0001';
  END IF;

  -- Sudah berjalan.
  IF v_p.status = 'berjalan' THEN
    IF v_p.penangan_id = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'ambil_alih', false, 'sesi_id', p_sesi_id, 'kunjungan_id', v_kid,
        'penanganan_id', v_p.id, 'peran_tahap', v_p.peran_tahap, 'mulai_at', v_p.mulai_at);
    END IF;
    IF v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: chat sudah ditangani staf lain' USING ERRCODE = 'P0001';
    END IF;
    -- Admin mengambil alih (alasan wajib, audit), pola admin_ambil_alih.
    IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
      RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih chat wajib 5-500 karakter' USING ERRCODE = '22023';
    END IF;
    UPDATE public.penanganan AS p
       SET status = 'batal', batal_karena = 'diambil_alih', selesai_at = v_now,
           catatan = pg_catalog.left('Diambil alih Admin: ' || v_alasan, CASE WHEN p.peran_tahap = 'fo' THEN 200 ELSE 1000 END)
     WHERE p.id = v_p.id;
    SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status,
                                   mulai_at, chat_sesi_id, dibuat_oleh)
    VALUES (v_kid, v_tahap, v_p.peran_tahap, v_p.layanan_id, 'chat', v_me_id, 'berjalan', v_now, p_sesi_id, v_me_id)
    RETURNING id INTO v_pid;
    PERFORM public.chat_ubah_sesi(p_sesi_id, 'aktif', v_me_id);
    PERFORM public.chat_pesan_sistem(p_sesi_id,
      'Percakapan ini dilanjutkan oleh petugas lain. Pesan Anda akan dibalas langsung oleh petugas.');
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_ambil_alih', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_kid, 'penanganan_lama', v_p.id,
              'penanganan_baru', v_pid, 'pemilik_lama', v_p.penangan_id, 'alasan', v_alasan),
            pg_catalog.jsonb_build_object('penangan_id', v_p.penangan_id),
            pg_catalog.jsonb_build_object('penangan_id', v_me_id));
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'sudah_milik_anda', false, 'ambil_alih', true, 'pemilik_lama', v_p.penangan_id, 'sesi_id', p_sesi_id,
      'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'peran_tahap', v_p.peran_tahap, 'mulai_at', v_now);
  END IF;

  -- Menunggu: tentukan peran tahap setelah diambil.
  IF v_p.peran_tahap = 'fo' THEN
    IF v_me_role = 'petugas' THEN
      -- Petugas mengambil langsung selama BELUM diambil FO: tahap menjadi tahap layanannya (tidak ada tahap FO fiktif).
      v_peran := 'layanan';
      v_lyn   := v_me_lyn;
    ELSE
      v_peran := 'fo';
      v_lyn   := NULL;
    END IF;
  ELSE
    IF v_me_role = 'front_office' THEN
      RAISE EXCEPTION 'FORBIDDEN: chat ini sudah diteruskan dan menunggu petugas layanan' USING ERRCODE = '42501';
    END IF;
    IF v_me_role = 'petugas' AND v_p.layanan_id IS DISTINCT FROM v_me_lyn THEN
      RAISE EXCEPTION 'FORBIDDEN: chat ini menunggu petugas layanan lain' USING ERRCODE = '42501';
    END IF;
    v_peran := 'layanan';
    v_lyn   := v_p.layanan_id;
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now, peran_tahap = v_peran, layanan_id = v_lyn,
         chat_sesi_id = p_sesi_id
   WHERE p.id = v_p.id AND p.status = 'menunggu' AND p.penangan_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'SUDAH_DIAMBIL: chat sudah ditangani staf lain' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now WHERE k.id = v_kid;
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'aktif', v_me_id);
  PERFORM public.chat_pesan_sistem(p_sesi_id,
    'Percakapan ini telah diambil oleh petugas. Pesan Anda akan dibalas langsung oleh petugas.');

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_ambil', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_kid, 'penanganan_id', v_p.id,
              'peran_tahap', v_peran),
            pg_catalog.jsonb_build_object('status_sesi', v_s.status),
            pg_catalog.jsonb_build_object('status_sesi', 'aktif', 'penangan_id', v_me_id));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'ambil_alih', false, 'sesi_id', p_sesi_id, 'kunjungan_id', v_kid,
    'penanganan_id', v_p.id, 'peran_tahap', v_peran, 'mulai_at', v_now);
END $$;

REVOKE ALL ON FUNCTION public.chat_ambil(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ambil(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.chat_teruskan(
  p_sesi_id    uuid,
  p_layanan_id uuid,
  p_topik_id   uuid,
  p_catatan    text
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
  v_s       record;
  v_p       record;
  v_l       record;
  v_topik   text;
  v_catatan text;
  v_tahap   integer;
  v_pl      uuid;
  v_notif   integer := 0;
  r         record;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  -- Fase 5 (A4): petugas Layanan TUJUAN tidak beroperasi hari ini (jadwal per Layanan, spec §4.4).
  IF NOT public.is_layanan_buka_jadwal(p_layanan_id, v_tgl, NULL) THEN
    RAISE EXCEPTION 'HARI_TANPA_LAYANAN: chat tidak dapat diteruskan karena layanan tujuan tidak beroperasi hari ini (di luar jadwal/hari libur)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT s.id, s.status, s.layanan_id, s.kunjungan_id INTO v_s
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
  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'BUKAN_TAHAP_FO: chat ini sedang ditangani petugas layanan' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: chat ini ditangani staf lain' USING ERRCODE = '42501';
  END IF;
  v_topik   := public.fo_validasi_topik(p_topik_id, NULL);
  v_catatan := public.fo_validasi_catatan(p_catatan, 200);

  SELECT l.id, l.nama, l.aktif, l.punya_chat INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_id;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT COALESCE(v_l.punya_chat, false) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tidak melayani chat' USING ERRCODE = '22023';
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'dieskalasi', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = v_p.id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_s.kunjungan_id;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, status, chat_sesi_id, dibuat_oleh)
  VALUES (v_s.kunjungan_id, v_tahap, 'layanan', p_layanan_id, 'chat', 'menunggu', p_sesi_id, v_me_id)
  RETURNING id INTO v_pl;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_s.kunjungan_id;
  -- Sesi pindah ke layanan tujuan (RLS chat yang ada memberi petugas layanan itu akses baca/tulis), penangan dilepas.
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'eskalasi', NULL, p_layanan_id);
  PERFORM public.chat_pesan_sistem(p_sesi_id, pg_catalog.format(
    'Percakapan Anda diteruskan ke petugas layanan %s. Mohon tunggu, petugas akan segera membalas.', v_l.nama));

  -- Notifikasi web push ke petugas aktif layanan tujuan (tanpa PII pengunjung).
  FOR r IN
    SELECT p.auth_user_id FROM public.petugas AS p
    WHERE p.layanan_id = p_layanan_id AND p.role = 'petugas' AND p.aktif = true
  LOOP
    PERFORM public.queue_notifikasi(
      r.auth_user_id, NULL, 'web_push',
      'Chat menunggu',
      pg_catalog.format('Front Office meneruskan satu chat ke layanan %s.', v_l.nama),
      pg_catalog.jsonb_build_object('type', 'chat_diteruskan', 'sesi_id', p_sesi_id, 'layanan_id', p_layanan_id,
                                    'url', '/admin/chat'));
    v_notif := v_notif + 1;
  END LOOP;

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_teruskan', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id,
              'penanganan_fo_id', v_p.id, 'penanganan_layanan_id', v_pl),
            pg_catalog.jsonb_build_object('layanan_id', v_s.layanan_id),
            pg_catalog.jsonb_build_object('layanan_id', p_layanan_id));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'sesi_id', p_sesi_id,
    'kunjungan_id', v_s.kunjungan_id,
    'penanganan_fo_id', v_p.id,
    'penanganan_layanan_id', v_pl,
    'layanan_id', p_layanan_id,
    'layanan_nama', v_l.nama,
    'petugas_hadir', public.antrean_dibuka(p_layanan_id, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

REVOKE ALL ON FUNCTION public.chat_teruskan(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_teruskan(uuid, uuid, uuid, text) TO authenticated;

-- ============================================================
-- 4. B: jendela operasional Fase 3 mencakup chat online yang masih punya tahap terbuka (salinan 202610290001 §2)
-- ============================================================
CREATE OR REPLACE FUNCTION public.kunjungan_operasional(p_kunjungan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.kunjungan AS k
    WHERE k.id = p_kunjungan
      AND (
        (k.status IN ('menunggu', 'dilayani')
         AND k.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1)
        OR (k.status = 'terjadwal'
            AND k.tanggal = (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date)
        -- Fase 5 (B): chat online yang masih punya tahap TERBUKA tetap operasional berapa pun umur tanggalnya
        -- (mis. dieskalasi Jumat sore dan menunggu petugas hingga Senin).
        OR (k.asal = 'online'
            AND EXISTS (SELECT 1 FROM public.penanganan AS pn
                        WHERE pn.kunjungan_id = k.id AND pn.status IN ('menunggu', 'berjalan')))
      )
  )
$$;

REVOKE ALL ON FUNCTION public.kunjungan_operasional(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kunjungan_operasional(uuid) TO authenticated, service_role;
