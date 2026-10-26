-- 202610270001_survei_undangan.sql
-- SURVEI TERPADU FASE A, langkah 1 (spec: docs/superpowers/specs/2026-10-26-survei-terpadu-design.md §4.1, §5, §6):
-- undangan survei per kunjungan yang SELESAI. Satu kunjungan selesai = satu undangan berisi token acak terpisah dari
-- kunjungan.qr_token, berlaku 32 jam sejak kunjungan.selesai_at, ditampilkan staf HANYA sebagai QR (tidak pernah
-- sebagai teks tautan). Migrasi ini hanya menyiapkan undangan; tabel jawaban, RPC publik (konteks/kirim), dan perubahan
-- notify_kunjungan_status menyusul di 202610270002-202610270004.
--
-- ISI (semua ADITIF; tanpa DML; tanpa mengubah tabel/kolom/policy yang sudah ada):
--   1. Tabel survei_undangan: kunjungan_id UNIK (FK kunjungan, ON DELETE CASCADE), token UNIK (CHECK 64 heksadesimal huruf
--      kecil), layanan_id (FK layanan, ON DELETE SET NULL), unit ('layanan' | 'fo'), dibuat_pada, kedaluwarsa_pada,
--      diisi_pada, saran_dikirim, pengaduan_dikirim. RLS AKTIF TANPA policy dan hak tabel dicabut dari
--      PUBLIC/anon/authenticated: klien tidak pernah menyentuh tabel ini langsung (hanya RPC dan view di bawah, dan RPC
--      publik di 0003). Pemilik fungsi SECURITY DEFINER (postgres) melewati RLS; service_role BYPASSRLS.
--   2. ensure_undangan(p_kunjungan_id) -> uuid: IDEMPOTEN. NULL bila kunjungan tidak ada atau belum 'selesai'. Bila
--      sudah ada undangan, mengembalikan id-nya TANPA mengubah apa pun (ON CONFLICT (kunjungan_id) DO NOTHING, tidak
--      pernah DO UPDATE): token dan kedaluwarsa_pada TIDAK bergeser walau dipanggil lagi (trigger di bawah DAN
--      notify_kunjungan_status di 0004 sama-sama memanggilnya, sehingga urutan trigger tidak berpengaruh) atau walau
--      kunjungan dibuka lalu diselesaikan ulang. Token = dua pg_catalog.gen_random_uuid() (CSPRNG) digabung tanpa tanda
--      hubung (64 heksadesimal, sekitar 244 bit entropi, tanpa ekstensi). kedaluwarsa_pada = COALESCE(selesai_at,
--      now()) + 32 jam (selesai_at diisi trg_kunjungan_selesai_at dari jam server; COALESCE hanya pertahanan).
--      unit/layanan_id dari kunjungan_layanan_skm (layanan tiket 'selesai' terakhir; NULL = selesai di Front Office
--      = unit 'fo'). EXECUTE hanya service_role (dan pemilik lewat trigger).
--   3. Trigger trg_kunjungan_selesai_undangan: AFTER UPDATE OF status ON kunjungan, FOR EACH ROW, hanya bila status BERUBAH
--      menjadi 'selesai' (klausa WHEN), memanggil ensure_undangan(NEW.id) lewat fungsi trigger SECURITY DEFINER
--      kunjungan_selesai_undangan(). Hanya UPDATE: kunjungan yang SUDAH selesai sebelum migrasi ini atau yang dibuat
--      langsung berstatus selesai TIDAK di-backfill (spec §4.1). Asumsi urutan sama dengan trg_kunjungan_selesai_rr
--      (0007): tiket_antrean 'selesai' sudah tertulis sebelum kunjungan 'selesai', kalau tidak unit jatuh ke 'fo'.
--   4. ambil_qr_survei(p_kunjungan_id) -> jsonb {status, token, kedaluwarsa_pada, unit, layanan_nama} untuk dialog QR
--      staf. status: 'tidak_ada' (belum ada undangan), 'sudah_diisi' (diisi_pada terisi; menang atas kedaluwarsa),
--      'kedaluwarsa' (now() >= kedaluwarsa_pada: TEPAT di batas sudah kedaluwarsa), 'belum_diisi'. Token HANYA pada
--      'belum_diisi'. Penjaga: auth.uid() ada DAN boleh_kunjungan(kunjungan) (Admin/FO semua; petugas layanan hanya
--      kunjungan yang punya tiket di layanannya), kalau tidak FORBIDDEN (SQLSTATE 42501) SEBELUM tabel dibaca (tidak
--      membocorkan keberadaan kunjungan). EXECUTE hanya authenticated (anon ditolak oleh hak, juga 42501).
--   5. View v_survei_status(kunjungan_id, status, unit, layanan_id, kedaluwarsa_pada, diisi_pada) untuk lencana status
--      di daftar staf; TANPA kolom token. Pola v_skm_petugas (202610090001): TANPA security_invoker (pemilik membaca
--      tabel), baris disaring boleh_kunjungan() terhadap pemanggil, GRANT SELECT hanya authenticated. Kunjungan tanpa
--      undangan tidak punya baris (UI menampilkan "-"). TAMBAHAN terhadap pola itu: WITH (security_barrier = true),
--      agar predikat dari pemanggil (mis. fungsi buatan di pg_temp) tidak dievaluasi pada baris yang belum
--      disaring boleh_kunjungan; predikat leakproof bawaan (mis. kunjungan_id = ANY(...)) tetap didorong ke bawah.
--
-- SYARAT: tabel kunjungan dengan kolom selesai_at (202610140003), kunjungan_layanan_skm(uuid) (202610140007), dan
--   boleh_kunjungan(uuid) (202610140009); dijaga blok PRASYARAT di bawah. TIDAK ada migrasi lain yang bergantung padanya
--   selain 0002-0004 seri ini.
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO; migrasi ini DITULIS tetapi BELUM DITERAPKAN):
--   node scripts/apply-migration.mjs supabase/migrations/202610270001_survei_undangan.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610270001_survei_undangan.sql --atomic
-- Idempoten (IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS): menerapkan ulang tidak mengubah undangan yang ada.
-- ROLLBACK: docs/rollback-survei-undangan-202610270001.sql (MENGHAPUS semua data undangan; jalankan PALING AKHIR dalam
--   seri, setelah rollback 0004, 0003, 0002).
-- UJI PERILAKU: scripts/lokal/skenario-survei-undangan.mjs (PGlite lokal, tanpa DB nyata). Kontrak statis:
--   supabase/migrations/survei_undangan.test.ts.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.kunjungan') IS NULL OR pg_catalog.to_regclass('public.layanan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel kunjungan/layanan belum ada (202607290013_kunjungan_tiket)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = pg_catalog.to_regclass('public.kunjungan') AND a.attname = 'selesai_at' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom kunjungan.selesai_at belum ada (202610140003_fo_model_data)';
  END IF;
  IF pg_catalog.to_regprocedure('public.kunjungan_layanan_skm(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: kunjungan_layanan_skm(uuid) belum ada (202610140007_wp24_akhiri_dual_write)';
  END IF;
  IF pg_catalog.to_regprocedure('public.boleh_kunjungan(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: boleh_kunjungan(uuid) belum ada (202610090001_rbac_tahap1 / 202610140009_chat_online)';
  END IF;
END $$;

-- ============================================================
-- 1. Tabel survei_undangan (tanpa akses langsung klien)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.survei_undangan (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  kunjungan_id      uuid        NOT NULL UNIQUE REFERENCES public.kunjungan (id) ON DELETE CASCADE,
  token             text        NOT NULL UNIQUE,
  layanan_id        uuid        REFERENCES public.layanan (id) ON DELETE SET NULL,
  unit              text        NOT NULL CHECK (unit IN ('layanan', 'fo')),
  dibuat_pada       timestamptz NOT NULL DEFAULT now(),
  kedaluwarsa_pada  timestamptz NOT NULL,
  diisi_pada        timestamptz,
  saran_dikirim     boolean     NOT NULL DEFAULT false,
  pengaduan_dikirim boolean     NOT NULL DEFAULT false,
  CONSTRAINT survei_undangan_token_format CHECK (token ~ '^[0-9a-f]{64}$')
);

ALTER TABLE public.survei_undangan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.survei_undangan FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. ensure_undangan: idempoten, tidak pernah menggeser batas 32 jam
-- ============================================================
CREATE OR REPLACE FUNCTION public.ensure_undangan(p_kunjungan_id uuid)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status  text;
  v_selesai timestamptz;
  v_layanan uuid;
  v_id      uuid;
BEGIN
  SELECT k.status, k.selesai_at INTO v_status, v_selesai
  FROM public.kunjungan AS k
  WHERE k.id = p_kunjungan_id;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'selesai' THEN
    RETURN NULL;
  END IF;

  v_layanan := public.kunjungan_layanan_skm(p_kunjungan_id);

  INSERT INTO public.survei_undangan (kunjungan_id, token, layanan_id, unit, kedaluwarsa_pada)
  VALUES (
    p_kunjungan_id,
    pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', ''),
    v_layanan,
    CASE WHEN v_layanan IS NULL THEN 'fo' ELSE 'layanan' END,
    COALESCE(v_selesai, pg_catalog.now()) + interval '32 hours'
  )
  ON CONFLICT (kunjungan_id) DO NOTHING
  RETURNING id INTO v_id;

  -- Sudah ada (panggilan kedua, trigger + notify_kunjungan_status, atau selesai ulang): baca id yang lama, jangan ubah.
  IF v_id IS NULL THEN
    SELECT u.id INTO v_id
    FROM public.survei_undangan AS u
    WHERE u.kunjungan_id = p_kunjungan_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.ensure_undangan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_undangan(uuid) TO service_role;

-- ============================================================
-- 3. Trigger: kunjungan -> selesai membuat undangan
-- ============================================================
CREATE OR REPLACE FUNCTION public.kunjungan_selesai_undangan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.ensure_undangan(NEW.id);
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.kunjungan_selesai_undangan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kunjungan_selesai_undangan ON public.kunjungan;
CREATE TRIGGER trg_kunjungan_selesai_undangan
  AFTER UPDATE OF status ON public.kunjungan
  FOR EACH ROW
  WHEN (NEW.status = 'selesai' AND OLD.status IS DISTINCT FROM 'selesai')
  EXECUTE FUNCTION public.kunjungan_selesai_undangan();

-- ============================================================
-- 4. ambil_qr_survei: QR staf (token hanya untuk undangan belum diisi dan belum kedaluwarsa)
-- ============================================================
CREATE OR REPLACE FUNCTION public.ambil_qr_survei(p_kunjungan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u       public.survei_undangan%ROWTYPE;
  v_layanan text;
  v_status  text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.boleh_kunjungan(p_kunjungan_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: tidak berwenang atas kunjungan ini' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_u
  FROM public.survei_undangan AS u
  WHERE u.kunjungan_id = p_kunjungan_id;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'tidak_ada',
      'token', NULL::text,
      'kedaluwarsa_pada', NULL::timestamptz,
      'unit', NULL::text,
      'layanan_nama', NULL::text
    );
  END IF;

  v_status := CASE
    WHEN v_u.diisi_pada IS NOT NULL THEN 'sudah_diisi'
    WHEN pg_catalog.now() >= v_u.kedaluwarsa_pada THEN 'kedaluwarsa'
    ELSE 'belum_diisi'
  END;

  SELECT l.nama INTO v_layanan FROM public.layanan AS l WHERE l.id = v_u.layanan_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', v_status,
    'token', CASE WHEN v_status = 'belum_diisi' THEN v_u.token ELSE NULL END,
    'kedaluwarsa_pada', v_u.kedaluwarsa_pada,
    'unit', v_u.unit,
    'layanan_nama', v_layanan
  );
END $$;

REVOKE ALL ON FUNCTION public.ambil_qr_survei(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ambil_qr_survei(uuid) TO authenticated;

-- ============================================================
-- 5. View v_survei_status (lencana status; tanpa token)
-- ============================================================
CREATE OR REPLACE VIEW public.v_survei_status
WITH (security_barrier = true) AS
SELECT u.kunjungan_id,
       CASE
         WHEN u.diisi_pada IS NOT NULL THEN 'sudah_diisi'
         WHEN pg_catalog.now() >= u.kedaluwarsa_pada THEN 'kedaluwarsa'
         ELSE 'belum_diisi'
       END AS status,
       u.unit,
       u.layanan_id,
       u.kedaluwarsa_pada,
       u.diisi_pada
FROM public.survei_undangan AS u
WHERE public.boleh_kunjungan(u.kunjungan_id);

REVOKE ALL ON public.v_survei_status FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_survei_status TO authenticated;

-- ============================================================
-- 6. Komentar (penanda untuk migrasi dan penjaga rollback berikutnya)
-- ============================================================
COMMENT ON TABLE public.survei_undangan IS
  'Undangan survei terpadu (migrasi 202610270001): satu per kunjungan selesai, token acak berlaku 32 jam sejak selesai_at. Tanpa akses langsung klien; lewat RPC dan view.';
COMMENT ON FUNCTION public.ensure_undangan(uuid) IS
  'Membuat undangan survei untuk kunjungan selesai (idempoten, tidak menggeser kedaluwarsa_pada). Hanya service_role dan trigger.';
COMMENT ON FUNCTION public.ambil_qr_survei(uuid) IS
  'QR staf: status undangan, token hanya bila belum diisi dan belum kedaluwarsa. Penjaga boleh_kunjungan, FORBIDDEN 42501.';
COMMENT ON VIEW public.v_survei_status IS
  'Status survei per kunjungan (tanpa token), disaring boleh_kunjungan terhadap pemanggil.';
