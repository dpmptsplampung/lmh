-- 202611030012_layar_tv.sql
-- Layar TV antrean (kontrak .tim/layar-tv/KONTRAK.md, bagian "Data dan API tersedia (DB)").
-- DILARANG diterapkan otomatis. Hanya bergantung pada migrasi yang SUDAH di produksi
-- (202610080001 staf_saya/boleh_layanan/panggil_tiket, 202610090004 tampil_di_layar/v_layar_antrian,
-- 202607290013 + 202610140003 tiket_antrean.nomor_display), jadi dapat diterapkan lepas dari
-- rantai Fase 1-6 yang belum diterapkan.
-- ROLLBACK: docs/rollback-layar-tv-202611030012.sql
-- PENERAPAN ATOMIK: node scripts/apply-migration.mjs supabase/migrations/202611030012_layar_tv.sql --atomic
--
-- Isi:
--   1. layanan.nama_layar (nama tampil di layar dan pita; NULL = layanan.nama) dan
--      layanan.urutan_layar (urutan khusus layar; NULL = di akhir menurut nama). Ditulis Admin
--      langsung lewat RLS layanan_admin_all yang ada; tercatat audit trg_audit_layanan.
--   2. v_layar_antrian: kolom lama tetap; nama_layar, urutan_layar, nama_tampil ditambah di akhir.
--   3. Tabel kejadian panggilan_layar (tanpa identitas pengunjung): baca publik hanya hari ini (WIB),
--      hanya lima kolom (tanpa tiket_id); masuk publikasi supabase_realtime; tanpa tulis klien.
--   4. panggil_tiket: perilaku lama tetap; setiap panggilan sukses (termasuk panggilan ulang pada
--      tiket 'menunggu' yang sama) menambah satu baris panggilan_layar. Penjaga 1 detik per tiket
--      menahan dua perangkat yang menekan hampir bersamaan; panggilan yang ditahan tetap
--      mengembalikan nomor (bukan NULL) agar petugas tidak mengira tombol gagal.
--   5. Token layar pendek (keputusan pemilik): route admin membangkitkan token 8 angka sendiri;
--      DEFAULT kolom = layar_token_baru() (8 angka acak kriptografis) sebagai cadangan untuk insert
--      langsung. CHECK format 8 angka ATAU 32 hex lama (NOT VALID: token lama tetap sah).
--      validate_layar_token memangkas spasi. Tanpa pembatas tebakan di DB (risiko diterima PM:
--      layar hanya menampilkan nomor antrean dan nama layanan).
--   6. Retensi: job pg_cron layar_bersihkan (00:05 WIB) menghapus kejadian panggilan > 1 hari.

DO $$
DECLARE
  v_kolom text;
BEGIN
  IF pg_catalog.to_regprocedure('public.staf_saya()') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_layanan(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.get_my_role()') IS NULL
     OR pg_catalog.to_regprocedure('public.panggil_tiket(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: staf_saya / boleh_layanan / get_my_role / panggil_tiket belum ada (202610080001)';
  END IF;
  IF pg_catalog.to_regprocedure('public.validate_layar_token(text)') IS NULL
     OR pg_catalog.to_regclass('public.layar_token') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: layar_token / validate_layar_token belum ada (202607300022)';
  END IF;
  IF pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: pgcrypto (schema extensions) belum ada';
  END IF;
  IF pg_catalog.to_regclass('public.v_layar_antrian') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: view v_layar_antrian belum ada (202607300022/202610090004)';
  END IF;
  FOREACH v_kolom IN ARRAY ARRAY[
    'layanan.tampil_di_layar', 'layanan.nama', 'tiket_antrean.nomor_display', 'tiket_antrean.status',
    'layar_token.token', 'layar_token.aktif'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.split_part(v_kolom, '.', 1))
        AND a.attname = pg_catalog.split_part(v_kolom, '.', 2)
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom public.% belum ada (202610090004/202607290013)', v_kolom;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 1. Kolom layanan khusus layar TV
-- ============================================================
ALTER TABLE public.layanan
  ADD COLUMN IF NOT EXISTS nama_layar text,
  ADD COLUMN IF NOT EXISTS urutan_layar smallint;

ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_nama_layar_check;
ALTER TABLE public.layanan ADD CONSTRAINT layanan_nama_layar_check CHECK (
  nama_layar IS NULL OR (
    nama_layar = pg_catalog.btrim(nama_layar)
    AND pg_catalog.char_length(nama_layar) BETWEEN 1 AND 40
  )
);
ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_urutan_layar_check;
ALTER TABLE public.layanan ADD CONSTRAINT layanan_urutan_layar_check CHECK (
  urutan_layar IS NULL OR urutan_layar BETWEEN 1 AND 9999
);

COMMENT ON COLUMN public.layanan.nama_layar IS
  'Admin: nama tampil di layar TV dan pita panggilan (NULL = nama). Sudah di-trim, 1-40 karakter; isian kosong dikirim NULL.';
COMMENT ON COLUMN public.layanan.urutan_layar IS
  'Admin: urutan kartu di layar TV (1..9999, tidak unik). NULL = di akhir menurut nama tampil. Terpisah dari urutan beranda.';

-- ============================================================
-- 2. v_layar_antrian: kolom lama identik, kolom baru di akhir (CREATE OR REPLACE aman)
--    Pemilik view = pemilik tabel (bukan security_invoker), sama seperti sebelumnya:
--    anon membaca agregat tanpa identitas pengunjung.
-- ============================================================
CREATE OR REPLACE VIEW public.v_layar_antrian AS
SELECT
  l.id          AS layanan_id,
  l.nama        AS layanan_nama,
  l.tipe,
  count(t.id) FILTER (WHERE t.status = 'menunggu')   AS antre_count,
  count(t.id) FILTER (WHERE t.status = 'dilayani')   AS dilayani_count,
  max(t.nomor)  FILTER (WHERE t.status = 'dilayani') AS nomor_sedang_dilayani,
  max(t.nomor_display) FILTER (WHERE t.status = 'dilayani') AS nomor_display_dilayani,
  COALESCE((
    SELECT avg(EXTRACT(EPOCH FROM (t2.waktu_selesai - t2.waktu_mulai_layan)) / 60.0)
    FROM public.tiket_antrean t2
    WHERE t2.layanan_id = l.id
      AND t2.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND t2.waktu_selesai    IS NOT NULL
      AND t2.waktu_mulai_layan IS NOT NULL
  ), 15) AS estimasi_durasi_menit,
  count(t.id) FILTER (WHERE t.status = 'menunggu') * COALESCE((
    SELECT avg(EXTRACT(EPOCH FROM (t3.waktu_selesai - t3.waktu_mulai_layan)) / 60.0)
    FROM public.tiket_antrean t3
    WHERE t3.layanan_id = l.id
      AND t3.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
      AND t3.waktu_selesai    IS NOT NULL
      AND t3.waktu_mulai_layan IS NOT NULL
  ), 15) AS estimasi_tunggu_total_menit,
  l.nama_layar,
  l.urutan_layar,
  COALESCE(l.nama_layar, l.nama) AS nama_tampil
FROM public.layanan l
LEFT JOIN public.tiket_antrean t
  ON  t.layanan_id = l.id
  AND t.status IN ('menunggu', 'dilayani')
  AND t.tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date
WHERE l.aktif = true AND l.tampil_di_layar = true
GROUP BY l.id, l.nama, l.tipe, l.nama_layar, l.urutan_layar;

REVOKE ALL  ON public.v_layar_antrian FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_layar_antrian TO anon, authenticated;

-- ============================================================
-- 3. Tabel kejadian panggilan_layar
--    Isi = nomor antrean + nama tampil layanan saat dipanggil. TIDAK memuat identitas pengunjung.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.panggilan_layar (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid        NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tiket_id      uuid        NOT NULL REFERENCES public.tiket_antrean(id) ON DELETE CASCADE,
  nomor_display text        NOT NULL,
  label         text        NOT NULL,
  dibuat_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.panggilan_layar IS
  'Kejadian panggilan antrean untuk pita layar TV. Diisi hanya oleh panggil_tiket. Baca publik hari ini (WIB), tanpa tiket_id. Dibuang harian (layar_bersihkan).';

CREATE INDEX IF NOT EXISTS idx_panggilan_layar_dibuat_at ON public.panggilan_layar (dibuat_at);
CREATE INDEX IF NOT EXISTS idx_panggilan_layar_tiket ON public.panggilan_layar (tiket_id, dibuat_at DESC);
CREATE INDEX IF NOT EXISTS idx_panggilan_layar_layanan ON public.panggilan_layar (layanan_id);

ALTER TABLE public.panggilan_layar ENABLE ROW LEVEL SECURITY;

-- Hak kolom: tiket_id tidak dibuka ke klien (select('*') ditolak; klien menyebut kolom eksplisit).
REVOKE ALL ON TABLE public.panggilan_layar FROM PUBLIC, anon, authenticated;
GRANT SELECT (id, layanan_id, nomor_display, label, dibuat_at) ON public.panggilan_layar TO anon, authenticated;
GRANT ALL ON TABLE public.panggilan_layar TO service_role;

DROP POLICY IF EXISTS panggilan_layar_baca_hari_ini ON public.panggilan_layar;
CREATE POLICY panggilan_layar_baca_hari_ini ON public.panggilan_layar
  FOR SELECT TO anon, authenticated
  USING (
    dibuat_at >= (pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta')
  );
-- Tidak ada policy INSERT/UPDATE/DELETE: klien tidak dapat menulis. Penulis sah = panggil_tiket
-- (SECURITY DEFINER, pemilik tabel) dan job retensi.

-- Realtime: postgres_changes INSERT (menghormati RLS dan hak kolom di atas). Idempoten.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
                     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'panggilan_layar') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.panggilan_layar;
  END IF;
END $$;

-- ============================================================
-- 4. panggil_tiket: salinan 202610080001 + catat kejadian panggilan
-- ============================================================
CREATE OR REPLACE FUNCTION public.panggil_tiket(p_tiket_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_nomor_display text;
  v_layanan_id    uuid;
  v_label         text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    IF NOT EXISTS (SELECT 1 FROM public.staf_saya()) THEN
      RAISE EXCEPTION 'akses ditolak: hanya staf aktif' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Kunci baris tiket: panggilan bersamaan pada tiket yang sama berurutan, sehingga
  -- penjaga 1 detik di bawah melihat baris yang baru saja ditulis panggilan lain.
  SELECT t.nomor_display, t.layanan_id, COALESCE(l.nama_layar, l.nama)
    INTO v_nomor_display, v_layanan_id, v_label
  FROM public.tiket_antrean AS t
  JOIN public.layanan AS l ON l.id = t.layanan_id
  WHERE t.id = p_tiket_id
    AND t.status = 'menunggu'
  FOR UPDATE OF t;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role' AND NOT public.boleh_layanan(v_layanan_id) THEN
    RAISE EXCEPTION 'tiket bukan milik layanan Anda' USING ERRCODE = '42501';
  END IF;

  -- Setiap panggilan = satu kejadian baru (panggil ulang memunculkan pita + bunyi lagi),
  -- kecuali tiket yang sama baru dipanggil kurang dari 1 detik lalu (dua perangkat bersamaan).
  IF NOT EXISTS (
    SELECT 1 FROM public.panggilan_layar AS p
    WHERE p.tiket_id = p_tiket_id
      AND p.dibuat_at > pg_catalog.now() - interval '1 second'
  ) THEN
    INSERT INTO public.panggilan_layar (layanan_id, tiket_id, nomor_display, label)
    VALUES (v_layanan_id, p_tiket_id, v_nomor_display, v_label);
  END IF;

  PERFORM pg_notify(
    'nomor_dipanggil',
    json_build_object(
      'tiket_id',      p_tiket_id,
      'nomor_display', v_nomor_display,
      'layanan_id',    v_layanan_id
    )::text
  );

  RETURN v_nomor_display;
END $$;

REVOKE ALL ON FUNCTION public.panggil_tiket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.panggil_tiket(uuid) TO authenticated, service_role;

-- ============================================================
-- 5. Token layar pendek: 8 angka
-- ============================================================
-- 6 byte acak (2^48) mod 10^8: bias modulo < 4e-7, dapat diabaikan. Nol di depan dipertahankan.
CREATE OR REPLACE FUNCTION public.layar_token_baru()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_angka bigint;
BEGIN
  v_angka := (('x' || pg_catalog.encode(extensions.gen_random_bytes(6), 'hex'))::bit(48))::bigint;
  RETURN pg_catalog.lpad((v_angka % 100000000)::text, 8, '0');
END $$;

-- DEFAULT dievaluasi dengan hak penyisip (Admin lewat RLS layar_token_admin_all), jadi authenticated
-- butuh EXECUTE. Bentrok unik (peluang kecil) = 23505.
REVOKE ALL ON FUNCTION public.layar_token_baru() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layar_token_baru() TO authenticated, service_role;

ALTER TABLE public.layar_token ALTER COLUMN token SET DEFAULT public.layar_token_baru();
ALTER TABLE public.layar_token DROP CONSTRAINT IF EXISTS layar_token_format_check;
ALTER TABLE public.layar_token ADD CONSTRAINT layar_token_format_check
  CHECK (token ~ '^[0-9]{8}$' OR token ~ '^[0-9a-f]{32}$') NOT VALID;

-- Salinan 202607300022 + btrim (spasi saat mengetik/menyalin alamat tetap cocok).
CREATE OR REPLACE FUNCTION public.validate_layar_token(p_token text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.layar_token
    WHERE token = pg_catalog.btrim(p_token) AND aktif = true
  );
END $$;

REVOKE ALL   ON FUNCTION public.validate_layar_token(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_layar_token(text) TO anon, authenticated;

-- ============================================================
-- 6. Retensi: 00:05 WIB (17:05 UTC) buang kejadian panggilan > 1 hari.
--    RLS sudah membatasi baca panggilan ke hari ini; job ini menjaga tabel tetap kecil.
--    Dijadwal ulang berdasarkan nama (idempoten).
-- ============================================================
CREATE OR REPLACE FUNCTION public.layar_bersihkan()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  DELETE FROM public.panggilan_layar WHERE dibuat_at < pg_catalog.now() - interval '1 day';
END $$;

REVOKE ALL ON FUNCTION public.layar_bersihkan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layar_bersihkan() TO service_role;

DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid) FROM cron.job AS job WHERE job.jobname = 'layar_bersihkan';
  PERFORM cron.schedule('layar_bersihkan', '5 17 * * *', 'SELECT public.layar_bersihkan()');
END $$;
