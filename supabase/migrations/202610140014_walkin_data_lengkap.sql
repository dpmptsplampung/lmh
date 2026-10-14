-- 202610140014_walkin_data_lengkap.sql
-- DATA WALK-IN LENGKAP (permintaan CEO 2026-10-14): pendaftaran walk-in Front Office wajib memuat SEMUA field dan
-- tervalidasi (nomor HP dan email diperiksa) supaya data kunjungan tidak kurang. Klien (/admin/fo/daftar,
-- src/lib/fo/walkin.ts) memvalidasi dengan aturan yang SAMA; server menegakkannya di fo_mulai_kunjungan.
--
-- ISI: fo_mulai_kunjungan di-CREATE OR REPLACE PENUH dari versi 202610140012. Yang berubah HANYA normalisasi input
-- (DECLARE) dan blok validasi. Signature, RETURNS, atribut (VOLATILE, SECURITY DEFINER, search_path), hak EXECUTE
-- (tidak ada GRANT/REVOKE di sini: CREATE OR REPLACE mempertahankan ACL 0004 = authenticated saja), penjaga sesi
-- (staf_wajib_sesi front_office/admin), idempotensi client_request_id (jalur cepat SEBELUM validasi + ON CONFLICT),
-- aturan p_pengunjung_id (#12), jam tutup (LAYANAN_TUTUP), isi INSERT, dan bentuk balasan TIDAK berubah.
--
-- ATURAN (semua galat: 'DATA_TIDAK_VALID: ...' SQLSTATE 22023, DETAIL = nama field klien yang salah):
--   nama          : spasi apa pun dirapatkan jadi satu lalu di-trim; 3-100 karakter; ~ '^[[:alpha:]][[:alpha:] .,''’-]*$'
--                   (diawali huruf; hanya huruf, spasi, titik, koma, apostrof ' atau ’, tanda hubung; tanpa digit);
--                   minimal 3 huruf. Disimpan dalam bentuk yang sudah dirapatkan.            DETAIL 'nama'
--   asal_instansi : trim; 3-120 karakter; minimal 3 karakter selain spasi.                    DETAIL 'asal_instansi'
--   kontak_hp     : WAJIB. Semua non-digit dibuang; awalan 62 (termasuk +62) -> 0; valid hanya ^08[1-9][0-9]{7,10}$
--                   (10-13 digit). Disimpan KANONIK 08xxxxxxxxxx. Data lama tidak diubah.    DETAIL 'kontak_hp'
--   kategori      : WAJIB, trim, persis salah satu Umum | UMKM | Investor | Instansi (= CHECK kunjungan_kategori_check
--                   202610140003, peka huruf besar).                                          DETAIL 'kategori'
--   email         : WAJIB; trim + huruf kecil; <= 254; ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$'
--                   (tepat satu '@'). Disimpan dalam huruf kecil.                             DETAIL 'email'
--   keperluan     : WAJIB; trim; 10-500 karakter; minimal 10 karakter selain spasi.         DETAIL 'keperluan'
--   layanan saran : TETAP opsional di DB: NULL = "Belum tahu" (klien memilih layanan aktif ATAU "Belum tahu" -> NULL).
--                   Bila diisi, wajib layanan aktif (LAYANAN_TIDAK_VALID, tidak berubah). Alasan: signature tidak
--                   boleh berubah dan RPC tidak dapat membedakan "tidak dikirim" dari "Belum tahu"; mewajibkan
--                   non-NULL akan memaksa FO menebak layanan (data saran palsu lebih buruk daripada NULL).
--   "trim" = buang [[:space:]] di awal/akhir (setara String.prototype.trim untuk spasi/tab/baris baru).
--
-- OFFLINE: replay antrean walk-in (src/lib/offline/replay.ts) memanggil RPC yang sama. Item lama yang tak lolos aturan
--   baru ditolak DATA_TIDAK_VALID (permanen menurut galatFoMulaiPermanen -> dibuang, tidak diulang). Item yang SUDAH
--   tercatat (client_request_id sama) tetap dibalas sudah_ada karena jalur idempotensi berjalan sebelum validasi.
--
-- SYARAT: 202610140013 (penanda komentar boleh_penanganan) dan 202610140012 (versi fo_mulai_kunjungan yang diganti).
--   URUTAN: ... -> 0012 -> 0013 -> 0014. PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140014_walkin_data_lengkap.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140014_walkin_data_lengkap.sql --atomic
-- KLIEN: deploy halaman /admin/fo/daftar (semua field wajib) SEBELUM atau BERSAMAAN dengan migrasi ini; klien lama yang
--   mengosongkan HP/email/kategori/keperluan akan ditolak DATA_TIDAK_VALID.
-- Penanda: COMMENT ON FUNCTION fo_mulai_kunjungan memuat '202610140014' (versi 0012 tidak berkomentar).
-- Idempoten. Rollback: docs/rollback-walkin-data-lengkap-202610140014.sql. Uji perilaku: scripts/test-walkin-data.mjs.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.fo_mulai_kunjungan(text,text,text,text,text,text,uuid,uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: fo_mulai_kunjungan belum ada (202610140004_fo_rpc)';
  END IF;
  IF pg_catalog.to_regprocedure('public.hari_tanpa_layanan(date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140012_perbaikan_review belum diterapkan';
  END IF;
  IF COALESCE(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)'), 'pg_proc'), '') NOT LIKE '%202610140013%' THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140013_fo_keterbukaan_data belum diterapkan';
  END IF;
END $$;

-- ============================================================
-- 1. fo_mulai_kunjungan: semua field wajib + validasi (versi 0012 + aturan di header)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fo_mulai_kunjungan(
  p_nama              text,
  p_asal_instansi     text,
  p_kontak_hp         text DEFAULT NULL,
  p_kategori          text DEFAULT NULL,
  p_email             text DEFAULT NULL,
  p_keperluan         text DEFAULT NULL,
  p_layanan_saran_id  uuid DEFAULT NULL,
  p_pengunjung_id     uuid DEFAULT NULL,
  p_client_request_id uuid DEFAULT NULL
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
  v_me_lyn   uuid;
  v_now      timestamptz := pg_catalog.now();
  v_tgl      date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_nama     text := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(p_nama, ''), '[[:space:]]+', ' ', 'g'));
  v_instansi text := pg_catalog.regexp_replace(COALESCE(p_asal_instansi, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_hp       text := pg_catalog.regexp_replace(COALESCE(p_kontak_hp, ''), '[^0-9]', '', 'g');
  v_email    text := pg_catalog.lower(pg_catalog.regexp_replace(COALESCE(p_email, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'));
  v_kep      text := pg_catalog.regexp_replace(COALESCE(p_keperluan, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_kat      text := pg_catalog.regexp_replace(COALESCE(p_kategori, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_ada      record;
  v_kid      uuid;
  v_pid      uuid;
  v_qr       text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  -- Idempotensi (klik ganda / replay offline), jalur cepat. Balapan serentak ditangani ON CONFLICT di INSERT.
  IF p_client_request_id IS NOT NULL THEN
    SELECT k.id, k.dibuat_oleh, k.qr_token INTO v_ada FROM public.kunjungan AS k WHERE k.client_request_id = p_client_request_id;
    IF FOUND THEN
      IF v_ada.dibuat_oleh IS DISTINCT FROM v_me_id THEN
        RAISE EXCEPTION 'IDEMPOTENSI_BENTROK: client_request_id sudah dipakai staf lain' USING ERRCODE = 'P0001';
      END IF;
      SELECT p.id INTO v_pid FROM public.penanganan AS p WHERE p.kunjungan_id = v_ada.id AND p.tahap_ke = 1;
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_ada', true, 'kunjungan_id', v_ada.id, 'penanganan_id', v_pid, 'qr_token', v_ada.qr_token);
    END IF;
  END IF;

  -- 202610140014: semua field wajib. Urutan pemeriksaan = urutan form (nama, asal, HP, kategori, email, keperluan).
  IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 100 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama wajib 3-100 karakter' USING ERRCODE = '22023', DETAIL = 'nama';
  END IF;
  IF v_nama !~ '^[[:alpha:]][[:alpha:] .,''’-]*$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama hanya boleh huruf, spasi, titik, koma, apostrof, dan tanda hubung (diawali huruf, tanpa angka)'
      USING ERRCODE = '22023', DETAIL = 'nama';
  END IF;
  IF pg_catalog.char_length(pg_catalog.regexp_replace(v_nama, '[^[:alpha:]]', '', 'g')) < 3 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama minimal 3 huruf' USING ERRCODE = '22023', DETAIL = 'nama';
  END IF;
  IF pg_catalog.char_length(v_instansi) NOT BETWEEN 3 AND 120
     OR pg_catalog.char_length(pg_catalog.regexp_replace(v_instansi, '[[:space:]]', '', 'g')) < 3 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: asal/instansi wajib 3-120 karakter (minimal 3 karakter selain spasi)'
      USING ERRCODE = '22023', DETAIL = 'asal_instansi';
  END IF;
  -- HP kanonik: non-digit sudah dibuang (DECLARE); awalan 62 (dari 62 / +62) -> 0.
  IF pg_catalog.left(v_hp, 2) = '62' THEN
    v_hp := '0' || pg_catalog.substr(v_hp, 3);
  END IF;
  IF v_hp !~ '^08[1-9][0-9]{7,10}$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nomor HP wajib, format 08xxxxxxxxxx (10-13 digit; +62/62 diterima)'
      USING ERRCODE = '22023', DETAIL = 'kontak_hp';
  END IF;
  IF v_kat NOT IN ('Umum', 'UMKM', 'Investor', 'Instansi') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: kategori wajib salah satu Umum, UMKM, Investor, Instansi'
      USING ERRCODE = '22023', DETAIL = 'kategori';
  END IF;
  IF pg_catalog.char_length(v_email) > 254
     OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: email wajib dengan format valid (maksimal 254 karakter)'
      USING ERRCODE = '22023', DETAIL = 'email';
  END IF;
  IF pg_catalog.char_length(v_kep) NOT BETWEEN 10 AND 500
     OR pg_catalog.char_length(pg_catalog.regexp_replace(v_kep, '[[:space:]]', '', 'g')) < 10 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan wajib 10-500 karakter (minimal 10 karakter selain spasi)'
      USING ERRCODE = '22023', DETAIL = 'keperluan';
  END IF;
  -- Layanan saran: NULL = "Belum tahu" (tetap diizinkan); bila diisi wajib layanan aktif.
  IF p_layanan_saran_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.id = p_layanan_saran_id AND l.aktif) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan saran tidak ada atau nonaktif' USING ERRCODE = '22023';
  END IF;
  IF p_pengunjung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pengunjung AS pg WHERE pg.id = p_pengunjung_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: pengunjung tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  -- #12: tautan ke akun pengunjung hanya bila relevan hari ini (punya kunjungan/reservasi/QR bertanggal hari ini WIB);
  -- UUID sembarang dari klien tidak bisa menempelkan kunjungan ke akun orang lain.
  IF p_pengunjung_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS kx WHERE kx.pengunjung_id = p_pengunjung_id AND kx.tanggal = v_tgl) THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: pengunjung hanya dapat ditautkan bila punya kunjungan/reservasi hari ini'
      USING ERRCODE = '22023';
  END IF;
  IF public.layanan_sudah_tutup() THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: layanan hari ini sudah tutup pukul % WIB', pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, keperluan, layanan_saran_id, client_request_id, dibuat_oleh, created_at, updated_at
  ) VALUES (
    p_pengunjung_id, v_nama, v_hp, 'walk_in', v_qr, v_tgl, v_now, 'dilayani',
    v_instansi, v_kat, v_email, v_kep, p_layanan_saran_id, p_client_request_id, v_me_id, v_now, v_now
  )
  ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_kid;

  IF v_kid IS NULL THEN
    -- Kalah balapan: permintaan serentak dengan client_request_id yang sama sudah tercatat (sudah COMMIT).
    SELECT k.id, k.dibuat_oleh, k.qr_token INTO v_ada FROM public.kunjungan AS k WHERE k.client_request_id = p_client_request_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DIVERGENSI: client_request_id bentrok tetapi kunjungan tidak terbaca' USING ERRCODE = 'P0001';
    END IF;
    IF v_ada.dibuat_oleh IS DISTINCT FROM v_me_id THEN
      RAISE EXCEPTION 'IDEMPOTENSI_BENTROK: client_request_id sudah dipakai staf lain' USING ERRCODE = 'P0001';
    END IF;
    SELECT p.id INTO v_pid FROM public.penanganan AS p WHERE p.kunjungan_id = v_ada.id AND p.tahap_ke = 1;
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'sudah_ada', true, 'kunjungan_id', v_ada.id, 'penanganan_id', v_pid, 'qr_token', v_ada.qr_token);
  END IF;

  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, penangan_id, status, mulai_at, dibuat_oleh)
  VALUES (v_kid, 1, 'fo', 'walk_in', v_me_id, 'berjalan', v_now, v_me_id)
  RETURNING id INTO v_pid;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_ada', false, 'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'qr_token', v_qr, 'mulai_at', v_now);
END $$;

COMMENT ON FUNCTION public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid) IS
  '202610140014: walk-in FO, semua field wajib (nama, asal/instansi, HP kanonik 08xxxxxxxxxx, kategori, email, keperluan); layanan saran NULL = belum tahu.';
