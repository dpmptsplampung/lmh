-- 202610140012_perbaikan_review.sql
-- Perbaikan temuan review independen atas 202610140002..0011 (belum diterapkan ke produksi). Forward-only: setiap fungsi
-- di-CREATE OR REPLACE PENUH dari versi terakhirnya (signature, hak, dan kode galat lama dipertahankan; kode baru hanya
-- kode yang sudah dikenal kontrak). Rincian per temuan: docs/analysis/_fragmen-R12.md.
--
-- ISI (nomor = nomor temuan review)
--   #1  Pendataan wajib ditentukan DB, bukan klien:
--       - kolom layanan.form_pendataan ('oss' | 'perizinan' | NULL), nilai awal dari nama layanan lewat
--         form_pendataan_dari_nama(text) = salinan determineFormType (src/lib/pelayanan.ts): "non oss"/"perizinan" ->
--         perizinan; "oss" -> oss; lainnya NULL. Layanan BARU tanpa nilai eksplisit diisi dari nama (trigger BEFORE
--         INSERT trg_layanan_isi_form_pendataan). Admin menyetel lewat Kelola Layanan (PATCH /api/admin/layanan/[id]
--         field form_pendataan; tercatat audit_perubahan) atau SQL: UPDATE public.layanan SET form_pendataan = ...
--       - layanan_selesai = versi 202610140011 + penolakan INVALID_PAYLOAD (22023) bila layanan wajib form dan
--         p_form_type NULL / tidak cocok. PENGECUALIAN tercatat: Admin yang MENGAMBIL ALIH tiket itu (audit_log
--         admin_ambil_alih, pemilik_baru = Admin) boleh menutup TANPA form (keadaan darurat; audit_log
--         'layanan_selesai_tanpa_pendataan'). Job tutup_penanganan_tertinggal (0008, 23:00 WIB) tetap menutup tiket
--         'dilayani' tanpa form (tidak lewat layanan_selesai). Layanan tanpa kewajiban: perilaku 0011 apa adanya.
--   #2  get_queue_position: qr_token kunjungan baru disimpan TANPA tanda hubung (32 hex), sedangkan p_qr_token uuid
--       ber-cast ke teks bertanda hubung -> tak pernah cocok. Kini cocok untuk kedua bentuk. Signature uuid TETAP
--       (GRANT anon/authenticated tidak berubah).
--   #4  fo_mulai_kunjungan: idempotensi tahan balapan (INSERT ... ON CONFLICT (client_request_id) DO NOTHING lalu baca
--       ulang -> sudah_ada / IDEMPOTENSI_BENTROK).
--   #12 fo_mulai_kunjungan: p_pengunjung_id hanya diterima bila pengunjung ada (NOT_FOUND) DAN punya kunjungan
--       bertanggal hari ini WIB (reservasi/QR/kunjungan lain hari itu); selain itu DATA_TIDAK_VALID (22023). Klien saat
--       ini tidak pernah mengirim parameter ini (pertanyaan CEO di fragmen).
--   #5  Kunjungan walk-in lama 'terjadwal' (alur visit pra WP-24, tidak punya jalur check-in lagi) -> 'batal' sekali
--       saat migrasi (gerbang) + klausa tambahan di job tandai_reservasi_no_show (tanggal lewat), dengan audit_log
--       'tutup_walkin_terjadwal' (aktor system, alasan).
--   #7  layanan_mulai: tiket bukan tanggal hari ini WIB ditolak BUKAN_HARI_INI (P0001; kode yang sudah dipakai
--       fo_checkin_reservasi).
--   #8  admin_alihkan: layanan tujuan wajib beroperasi hari ini (LAYANAN_TIDAK_BUKA) dan belum lewat jam tutup
--       (LAYANAN_TUTUP), sama dengan fo_eskalasi.
--   #9  reservasi_buat: kunci advisory memakai tujuan efektif (layanan hanya untuk 'loket'; p_layanan_id dari klien
--       diabaikan untuk 'bertemu_seseorang', sama seperti saat INSERT).
--   #10 rollup_rekap_harian: total_hadir = jumlah KUNJUNGAN berbeda per layanan (tiket 'dikembalikan' + eskalasi
--       ulang ke layanan sama tidak terhitung ganda; 'dialihkan' tetap tidak dihitung); rata_durasi_menit hanya dari
--       tiket 'selesai' (tiket dikembalikan/dialihkan tidak lagi mencemari rata-rata).
--   #11 tutup_chat_tertinggal() + job pg_cron 'chat_tutup_otomatis' (23:30 WIB = 16:30 UTC) + dijalankan SEKALI di
--       migrasi ini: sesi 'eskalasi'/'aktif' tanpa aktivitas > 24 jam -> tahap terbuka 'batal' (berjalan:
--       tidak_ditutup; menunggu: tidak_terlayani) + audit, kunjungan dilayani -> selesai / menunggu -> tidak_terlayani,
--       sesi 'selesai' + pesan sistem. Batas pembuatan kunjungan (spam) dan backfill 24 jam ada di 202610140009.
--   #3 / #6 hanya dokumen + penjaga rollback (docs/RUNBOOK_FO_ESKALASI.md, docs/rollback-*.sql).
--
-- SYARAT: 202610140011 (pendataan_validasi_payload) dan 202610140009 (chat_buat_kunjungan). URUTAN penerapan:
--   0002 -> ... -> 0009 -> 0011 -> 0012. PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic
-- KLIEN: route /api/admin/pelayanan dan halaman admin/antrian membaca layanan.form_pendataan -> deploy SETELAH migrasi.
-- Idempoten. Rollback: docs/rollback-perbaikan-review-202610140012.sql. Uji perilaku: scripts/test-perbaikan-review.mjs.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pendataan_validasi_payload(text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140011_pendataan_wajib belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_buat_kunjungan(uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140009_chat_online belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.visit_arsip_jaga()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140007_wp24_akhiri_dual_write belum diterapkan';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron') THEN
    RAISE EXCEPTION 'PRASYARAT: ekstensi pg_cron (skema cron) tidak ada';
  END IF;
END $$;

-- ============================================================
-- 1. #1 layanan.form_pendataan
-- ============================================================
-- Salinan determineFormType (src/lib/pelayanan.ts): "non oss" diperiksa lebih dulu karena memuat "oss".
CREATE OR REPLACE FUNCTION public.form_pendataan_dari_nama(p_nama text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
    WHEN pg_catalog.strpos(pg_catalog.lower(COALESCE(p_nama, '')), 'non oss') > 0
      OR pg_catalog.strpos(pg_catalog.lower(COALESCE(p_nama, '')), 'perizinan') > 0 THEN 'perizinan'
    WHEN pg_catalog.strpos(pg_catalog.lower(COALESCE(p_nama, '')), 'oss') > 0 THEN 'oss'
    ELSE NULL
  END
$$;

REVOKE ALL ON FUNCTION public.form_pendataan_dari_nama(text) FROM PUBLIC, anon, authenticated;

ALTER TABLE public.layanan ADD COLUMN IF NOT EXISTS form_pendataan text;
ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_form_pendataan_check;
ALTER TABLE public.layanan ADD CONSTRAINT layanan_form_pendataan_check
  CHECK (form_pendataan IS NULL OR form_pendataan IN ('oss', 'perizinan'));
COMMENT ON COLUMN public.layanan.form_pendataan IS
  'Formulir Pendataan WAJIB saat layanan_selesai (oss/perizinan); NULL = tanpa pendataan. Nilai awal dari nama (202610140012); diubah Admin.';

-- Nilai awal hanya untuk baris yang belum pernah disetel (idempoten; tidak menimpa pilihan Admin saat diterapkan ulang).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.layanan AS l WHERE l.form_pendataan IS NOT NULL) THEN
    UPDATE public.layanan AS l SET form_pendataan = public.form_pendataan_dari_nama(l.nama)
     WHERE public.form_pendataan_dari_nama(l.nama) IS NOT NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.layanan_isi_form_pendataan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.form_pendataan IS NULL THEN
    NEW.form_pendataan := public.form_pendataan_dari_nama(NEW.nama);
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.layanan_isi_form_pendataan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_layanan_isi_form_pendataan ON public.layanan;
CREATE TRIGGER trg_layanan_isi_form_pendataan
  BEFORE INSERT ON public.layanan
  FOR EACH ROW EXECUTE FUNCTION public.layanan_isi_form_pendataan();

-- ============================================================
-- 2. #1 layanan_selesai: versi 202610140011 + kewajiban form per layanan
-- ============================================================
CREATE OR REPLACE FUNCTION public.layanan_selesai(
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
  v_form_wajib      text;
  v_tanpa_pendataan boolean := false;
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
  -- Pengecualian darurat: Admin yang mengambil alih tiket ini (admin_ambil_alih) boleh menutup tanpa form (diaudit).
  SELECT l.form_pendataan INTO v_form_wajib FROM public.layanan AS l WHERE l.id = v_t.layanan_id;
  IF v_form_wajib IS NOT NULL AND p_form_type IS DISTINCT FROM v_form_wajib THEN
    IF p_form_type IS NULL AND v_me_role = 'admin' AND EXISTS (
         SELECT 1 FROM public.audit_log AS a
         WHERE a.aksi = 'admin_ambil_alih' AND a.entitas = 'tiket_antrean' AND a.entitas_id = p_tiket_id::text
           AND a.detail ->> 'pemilik_baru' = v_me_id::text) THEN
      v_tanpa_pendataan := true;
    ELSE
      RAISE EXCEPTION 'INVALID_PAYLOAD: layanan ini wajib Formulir Pendataan % (dikirim: %)',
        v_form_wajib, COALESCE(p_form_type, 'tanpa form') USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Tahap penanganan (hanya tiket hasil eskalasi): topik + catatan wajib, divalidasi sebelum menulis apa pun.
  SELECT p.id INTO v_p FROM public.penanganan AS p
  WHERE p.tiket_id = p_tiket_id AND p.status = 'berjalan' FOR UPDATE;
  IF v_p.id IS NOT NULL THEN
    v_topik   := public.fo_validasi_topik(p_topik_id, v_t.layanan_id);
    v_catatan := public.fo_validasi_catatan(p_catatan, 1000);
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

  IF v_tanpa_pendataan THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (
      auth.uid(), v_me_role, 'layanan_selesai_tanpa_pendataan', 'tiket_antrean', p_tiket_id::text,
      pg_catalog.jsonb_build_object('tiket_id', p_tiket_id, 'layanan_id', v_t.layanan_id, 'form_wajib', v_form_wajib,
        'alasan', 'Admin mengambil alih tiket (admin_ambil_alih) lalu menutup tanpa Formulir Pendataan'),
      pg_catalog.jsonb_build_object('status', 'dilayani'),
      pg_catalog.jsonb_build_object('status', 'selesai', 'pendataan', false)
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now,
    'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id));
END $$;

-- ============================================================
-- 3. #2 get_queue_position: qr_token dengan / tanpa tanda hubung
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_queue_position(p_qr_token uuid)
RETURNS TABLE (posisi int, total_menunggu int)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_layanan_id  uuid;
  v_tanggal     date;
  v_nomor       int;
  v_status      text;
BEGIN
  -- Kunjungan baru (fo_mulai_kunjungan/reservasi_buat/chat) menyimpan qr_token 32 hex TANPA tanda hubung; kunjungan
  -- lama (dual-write dari visit) menyimpan bentuk uuid bertanda hubung. Keduanya dicocokkan.
  SELECT t.layanan_id, t.tanggal, t.nomor, t.status
    INTO v_layanan_id, v_tanggal, v_nomor, v_status
  FROM public.kunjungan AS k
  JOIN public.tiket_antrean AS t ON t.kunjungan_id = k.id
  WHERE k.qr_token IN (p_qr_token::text, pg_catalog.replace(p_qr_token::text, '-', ''))
  ORDER BY (t.status = 'menunggu') DESC, t.waktu_terbit DESC, t.id
  LIMIT 1;

  IF NOT FOUND OR v_status <> 'menunggu' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (pg_catalog.count(*) FILTER (WHERE t2.nomor <= v_nomor))::integer AS posisi,
    pg_catalog.count(*)::integer AS total_menunggu
  FROM public.tiket_antrean AS t2
  WHERE t2.layanan_id = v_layanan_id
    AND t2.status      = 'menunggu'
    AND t2.tanggal     = v_tanggal;
END
$$;

REVOKE EXECUTE ON FUNCTION public.get_queue_position(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_queue_position(uuid) TO anon, authenticated;

-- ============================================================
-- 4. #4 + #12 fo_mulai_kunjungan
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
  v_nama     text := pg_catalog.btrim(COALESCE(p_nama, ''));
  v_instansi text := pg_catalog.btrim(COALESCE(p_asal_instansi, ''));
  v_hp       text := NULLIF(pg_catalog.regexp_replace(COALESCE(p_kontak_hp, ''), '[[:space:]-]', '', 'g'), '');
  v_email    text := NULLIF(pg_catalog.lower(pg_catalog.btrim(COALESCE(p_email, ''))), '');
  v_kep      text := NULLIF(pg_catalog.btrim(COALESCE(p_keperluan, '')), '');
  v_kat      text := NULLIF(pg_catalog.btrim(COALESCE(p_kategori, '')), '');
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

  IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 120 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nama wajib 3-120 karakter' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.char_length(v_instansi) NOT BETWEEN 2 AND 200 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: asal/instansi wajib 2-200 karakter' USING ERRCODE = '22023';
  END IF;
  IF v_hp IS NOT NULL AND v_hp !~ '^(\+?62|0)[0-9]{8,14}$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: nomor HP tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_kat IS NOT NULL AND v_kat NOT IN ('UMKM', 'Umum', 'Instansi', 'Investor') THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: kategori tidak dikenal' USING ERRCODE = '22023';
  END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: email tidak valid' USING ERRCODE = '22023';
  END IF;
  IF v_kep IS NOT NULL AND pg_catalog.char_length(v_kep) > 500 THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan maksimal 500 karakter' USING ERRCODE = '22023';
  END IF;
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

-- ============================================================
-- 5. #7 layanan_mulai: hanya tiket hari ini (WIB)
-- ============================================================
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
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_cek.waktu_mulai_layan);
    END IF;
    IF v_cek.status IN ('dilayani', 'selesai') THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain' USING ERRCODE = 'P0001';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS: tiket tidak dalam status menunggu (status=%)', v_cek.status USING ERRCODE = 'P0001';
  END IF;

  -- Tahap penanganan (tiket hasil eskalasi FO): menunggu -> berjalan oleh pemanggil.
  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now
   WHERE p.tiket_id = p_tiket_id AND p.status = 'menunggu';

  -- Kunjungan ikut 'dilayani' (tiket hasil eskalasi maupun tiket lama; dulu tiket lama lewat trigger dual-write).
  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now
   WHERE k.id = v_t.kunjungan_id AND k.status IS DISTINCT FROM 'dilayani';

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'dilayani_oleh', v_me_id, 'waktu_mulai_layan', v_now);
END $$;

-- ============================================================
-- 6. #8 admin_alihkan: layanan tujuan buka hari ini & belum tutup
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
    RAISE EXCEPTION 'LAYANAN_TIDAK_BUKA: % tidak beroperasi hari ini (libur/di luar jadwal standby)', v_l.nama
      USING ERRCODE = 'P0001';
  END IF;
  IF public.layanan_sudah_tutup() THEN
    RAISE EXCEPTION 'LAYANAN_TUTUP: layanan hari ini sudah tutup pukul % WIB', pg_catalog.to_char(public.jam_tutup_layanan(), 'HH24:MI')
      USING ERRCODE = 'P0001';
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

-- ============================================================
-- 7. #9 reservasi_buat: kunci advisory memakai tujuan efektif
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
  IF EXTRACT(ISODOW FROM p_tanggal) IN (6, 7) THEN
    RAISE EXCEPTION 'TANGGAL_TIDAK_VALID: reservasi tidak tersedia pada akhir pekan' USING ERRCODE = '22023';
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

-- ============================================================
-- 8. #10 rollup_rekap_harian: hadir per kunjungan, durasi hanya tiket selesai
-- ============================================================
CREATE OR REPLACE FUNCTION public.rollup_rekap_harian(p_tanggal date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.rekap_harian_layanan (
    layanan_id, tanggal,
    total_hadir, total_selesai, total_tidak_terlayani, total_batal,
    rata_durasi_menit, petugas_hadir, petugas_alpa, updated_at
  )
  SELECT
    t.layanan_id,
    p_tanggal,
    -- Pengunjung (kunjungan) berbeda: tiket 'dikembalikan' lalu dieskalasi ulang ke layanan yang sama = 1 hadir.
    count(DISTINCT t.kunjungan_id)  FILTER (WHERE t.status NOT IN ('terjadwal', 'dialihkan')) AS total_hadir,
    count(*)                        FILTER (WHERE t.status = 'selesai')             AS total_selesai,
    count(*)                        FILTER (WHERE t.status = 'tidak_terlayani')     AS total_tidak_terlayani,
    count(*)                        FILTER (WHERE t.status = 'batal')               AS total_batal,
    -- Durasi layanan hanya dari tiket yang benar-benar diselesaikan (bukan dikembalikan/dialihkan).
    AVG(EXTRACT(EPOCH FROM (t.waktu_selesai - t.waktu_mulai_layan)) / 60.0)
                                    FILTER (WHERE t.status = 'selesai'
                                               AND t.waktu_selesai IS NOT NULL
                                               AND t.waktu_mulai_layan IS NOT NULL) AS rata_durasi_menit,
    EXISTS(
      SELECT 1 FROM public.absensi_petugas ap
      JOIN public.petugas p ON p.id = ap.petugas_id
      WHERE ap.tanggal = p_tanggal
        AND p.layanan_id = t.layanan_id
        AND ap.status = 'approved'
    ) AS petugas_hadir,
    EXISTS(
      SELECT 1 FROM public.absensi_petugas ap
      JOIN public.petugas p ON p.id = ap.petugas_id
      WHERE ap.tanggal = p_tanggal
        AND p.layanan_id = t.layanan_id
        AND ap.status = 'alpa'
    ) AS petugas_alpa,
    now()
  FROM public.tiket_antrean t
  WHERE t.tanggal = p_tanggal
  GROUP BY t.layanan_id
  ON CONFLICT (layanan_id, tanggal) DO UPDATE SET
    total_hadir           = EXCLUDED.total_hadir,
    total_selesai         = EXCLUDED.total_selesai,
    total_tidak_terlayani = EXCLUDED.total_tidak_terlayani,
    total_batal           = EXCLUDED.total_batal,
    rata_durasi_menit     = EXCLUDED.rata_durasi_menit,
    petugas_hadir         = EXCLUDED.petugas_hadir,
    petugas_alpa          = EXCLUDED.petugas_alpa,
    updated_at            = EXCLUDED.updated_at;
END $$;

REVOKE ALL ON FUNCTION public.rollup_rekap_harian(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollup_rekap_harian(date) TO service_role;

-- ============================================================
-- 9. #5 Walk-in lama 'terjadwal': gerbang (sekali) + job harian
-- ============================================================
-- Gerbang: SEMUA walk-in 'terjadwal' (tidak ada RPC yang bisa memprosesnya sejak WP-24; fo_checkin_reservasi hanya
-- menerima asal 'reservasi').
WITH ditutup AS (
  UPDATE public.kunjungan AS k
     SET status = 'batal', updated_at = pg_catalog.now()
   WHERE k.asal = 'walk_in' AND k.status = 'terjadwal'
  RETURNING k.id, k.tanggal, k.legacy_visit_id
)
INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
SELECT NULL, 'system', 'tutup_walkin_terjadwal', 'kunjungan', d.id::text,
       pg_catalog.jsonb_build_object('tanggal', d.tanggal, 'legacy_visit_id', d.legacy_visit_id, 'sumber', '202610140012',
         'alasan', 'Walk-in alur lama (visit) berstatus terjadwal tidak dapat di-check-in sejak WP-24; ditutup otomatis'),
       pg_catalog.jsonb_build_object('status', 'terjadwal'),
       pg_catalog.jsonb_build_object('status', 'batal')
  FROM ditutup AS d;

-- Job no-show harian = versi 202610140007 + klausa walk-in 'terjadwal' bertanggal lewat (pertahanan; normalnya 0 baris).
-- Nilai balik = no_show reservasi + walk-in yang dibatalkan.
CREATE OR REPLACE FUNCTION public.tandai_reservasi_no_show()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_today  date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_count  integer := 0;
  v_walkin integer := 0;
BEGIN
  UPDATE public.kunjungan AS k
  SET    status     = 'no_show',
         updated_at = now()
  WHERE  k.asal = 'reservasi'
    AND  k.status = 'terjadwal'
    AND  k.tanggal < v_today;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  WITH ditutup AS (
    UPDATE public.kunjungan AS k
       SET status = 'batal', updated_at = now()
     WHERE k.asal = 'walk_in' AND k.status = 'terjadwal' AND k.tanggal < v_today
    RETURNING k.id, k.tanggal, k.legacy_visit_id
  )
  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  SELECT NULL, 'system', 'tutup_walkin_terjadwal', 'kunjungan', d.id::text,
         pg_catalog.jsonb_build_object('tanggal', d.tanggal, 'legacy_visit_id', d.legacy_visit_id,
           'alasan', 'Walk-in berstatus terjadwal melewati tanggalnya (tidak ada jalur check-in walk-in terjadwal)'),
         pg_catalog.jsonb_build_object('status', 'terjadwal'),
         pg_catalog.jsonb_build_object('status', 'batal')
    FROM ditutup AS d;

  GET DIAGNOSTICS v_walkin = ROW_COUNT;
  RETURN v_count + v_walkin;
END $$;

REVOKE ALL ON FUNCTION public.tandai_reservasi_no_show()
  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 10. #11 Penutupan otomatis sesi chat tertinggal
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
      || 'Silakan mulai chat baru bila masih memerlukan bantuan.');
    v_jumlah := v_jumlah + 1;
  END LOOP;

  RETURN v_jumlah;
END $$;

REVOKE ALL ON FUNCTION public.tutup_chat_tertinggal() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tutup_chat_tertinggal() TO service_role;

-- Jadwal: 23:30 WIB setiap hari (dijadwal ulang berdasarkan nama; idempoten), lalu bersihkan tunggakan sekarang.
DO $$
DECLARE
  v_n integer;
BEGIN
  PERFORM cron.unschedule(job.jobid) FROM cron.job AS job WHERE job.jobname = 'chat_tutup_otomatis';
  PERFORM cron.schedule('chat_tutup_otomatis', '30 16 * * *', 'SELECT public.tutup_chat_tertinggal()');
  v_n := public.tutup_chat_tertinggal();
  RAISE NOTICE '202610140012: % sesi chat tertinggal ditutup', v_n;
END $$;
