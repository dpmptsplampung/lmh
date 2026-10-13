-- Rollback manual migrasi 202610140003_fo_model_data.sql (hapus model penanganan; kembalikan skema lama).
-- Terapkan ATOMIK (dry-run dulu), PALING AKHIR (setelah rollback 202610140005 lalu 202610140004):
--   node scripts/apply-migration.mjs docs/rollback-fo-model-data-202610140003.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-fo-model-data-202610140003.sql --atomic
--
-- PERINGATAN DATA: rollback ini MENGHAPUS tabel penanganan dan topik_penanganan beserta isinya, kolom baru kunjungan
-- (chat_sesi_id, selesai_at, asal_instansi, kategori, email, keperluan, tujuan, layanan_saran_id, nama_yang_ditemui,
-- jam_rencana, client_request_id, dibuat_oleh) dan kolom baru tiket_antrean (penanganan_asal_id, dialihkan_ke).
-- Karena itu penjaga di awal MENOLAK bila:
--   - fungsi 202610140004 masih ada (rollback 202610140004 dulu), atau
--   - tabel penanganan berisi baris, atau ada kunjungan asal 'online', atau tiket berstatus dikembalikan/dialihkan
--     (CHECK lama tidak bisa dipasang ulang), KECUALI flag transaksi lmh.rollback_paksa = 'on' dinyalakan sadar
--     (SELECT set_config('lmh.rollback_paksa','on',true) di transaksi yang sama, setelah data diekspor/diarsipkan).
--     Dengan flag: kunjungan 'online' dan tiket dikembalikan/dialihkan TETAP menggagalkan CHECK (perlu keputusan data).
--
-- Yang dikembalikan:
--   1. tiket_antrean: DROP kolom penanganan_asal_id, dialihkan_ke; CHECK status persis 202607290013.
--   2. DROP penanganan (+ publikasi realtime, policy, indeks, trigger ikut terhapus bersama tabel), boleh_penanganan().
--   3. DROP topik_penanganan.
--   4. kunjungan: DROP trigger/fungsi selesai_at, kolom baru, constraint baru; CHECK asal (walk_in, reservasi);
--      policy kunjungan_staff_update dibuat ulang PERSIS dari 202610090001. (kunjungan_insert_public dan
--      tiket_insert_public TIDAK dibuat ulang: keduanya dicabut 202610080001, bukan oleh migrasi ini.)
--   5. terbit_tiket dipulihkan PERSIS dari 202607290013 dengan hak dari 202610080001 (service_role saja).
--   6. layanan: DROP trigger trg_layanan_isi_prefiks + fungsi layanan_isi_prefiks/prefiks_antrean_usul; DROP NOT NULL,
--      CHECK format, indeks unik penuh; indeks unik parsial lama uq_layanan_prefiks dibuat ulang PERSIS (202607290003).
--      NILAI prefiks 2 huruf hasil backfill DIBIARKAN (data; tetap valid untuk skema lama).
-- Idempoten (IF EXISTS / DROP POLICY IF EXISTS sebelum CREATE).

DO $$
DECLARE
  v_paksa boolean := COALESCE(pg_catalog.current_setting('lmh.rollback_paksa', true), '') = 'on';
BEGIN
  IF pg_catalog.to_regprocedure('public.fo_sinkron_visit(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.fo_eskalasi(uuid,uuid,uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: fungsi 202610140004 masih ada (rollback 202610140005 lalu 202610140004 dulu)';
  END IF;
  IF NOT v_paksa AND pg_catalog.to_regclass('public.penanganan') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.penanganan) THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: tabel penanganan berisi data (ekspor dulu; lalu nyalakan lmh.rollback_paksa)';
  END IF;
  IF NOT v_paksa AND EXISTS (SELECT 1 FROM public.kunjungan WHERE asal = 'online') THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: ada kunjungan asal online (CHECK lama tidak bisa dipasang)';
  END IF;
  IF NOT v_paksa AND EXISTS (SELECT 1 FROM public.tiket_antrean WHERE status IN ('dikembalikan', 'dialihkan')) THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: ada tiket dikembalikan/dialihkan (CHECK lama tidak bisa dipasang)';
  END IF;
END $$;

-- 1. tiket_antrean
DROP INDEX IF EXISTS public.idx_tiket_penanganan_asal;
ALTER TABLE public.tiket_antrean DROP COLUMN IF EXISTS penanganan_asal_id;
ALTER TABLE public.tiket_antrean DROP COLUMN IF EXISTS dialihkan_ke;
ALTER TABLE public.tiket_antrean DROP CONSTRAINT IF EXISTS tiket_antrean_status_check;
ALTER TABLE public.tiket_antrean ADD CONSTRAINT tiket_antrean_status_check
  CHECK (status IN ('menunggu','dipanggil','dilayani','selesai','batal','no_show','tidak_terlayani'));

-- 2. penanganan
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication_tables
             WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'penanganan') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.penanganan;
  END IF;
END $$;
DROP TABLE IF EXISTS public.penanganan;
DROP FUNCTION IF EXISTS public.boleh_penanganan(uuid, text, uuid, uuid, text);

-- 3. topik_penanganan
DROP TABLE IF EXISTS public.topik_penanganan;

-- 4. kunjungan
DROP TRIGGER IF EXISTS trg_kunjungan_selesai_at ON public.kunjungan;
DROP FUNCTION IF EXISTS public.kunjungan_isi_selesai_at();
DROP INDEX IF EXISTS public.uq_kunjungan_client_request_id;
DROP INDEX IF EXISTS public.idx_kunjungan_chat_sesi;
DROP INDEX IF EXISTS public.idx_kunjungan_status_tanggal;
ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_online_chat_check;
ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_kategori_check;
ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_tujuan_check;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS chat_sesi_id;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS selesai_at;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS asal_instansi;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS kategori;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS email;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS keperluan;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS tujuan;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS layanan_saran_id;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS nama_yang_ditemui;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS jam_rencana;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS client_request_id;
ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS dibuat_oleh;
ALTER TABLE public.kunjungan DROP CONSTRAINT IF EXISTS kunjungan_asal_check;
ALTER TABLE public.kunjungan ADD CONSTRAINT kunjungan_asal_check CHECK (asal IN ('walk_in','reservasi'));

DROP POLICY IF EXISTS kunjungan_staff_update ON public.kunjungan;
CREATE POLICY kunjungan_staff_update ON public.kunjungan FOR UPDATE TO authenticated
  USING (public.boleh_kunjungan(id))
  WITH CHECK (public.boleh_kunjungan(id));

-- 5. terbit_tiket (salinan persis 202607290013; hak dari 202610080001)
CREATE OR REPLACE FUNCTION public.terbit_tiket(
  p_kunjungan_id uuid,
  p_layanan_id   uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_tiket_id uuid;
  v_tanggal date;
  v_nomor int;
  v_prefiks text;
  v_kunjungan_tanggal date;
BEGIN
  -- Ambil tanggal kunjungan (Asia/Jakarta) sebagai tanggal tiket.
  SELECT tanggal INTO v_kunjungan_tanggal FROM public.kunjungan WHERE id = p_kunjungan_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'kunjungan tidak ditemukan';
  END IF;
  v_tanggal := v_kunjungan_tanggal;

  -- Nomor atomik per (layanan, tanggal) — QUE-06.
  v_nomor := public.terbit_nomor_antrean(p_layanan_id, v_tanggal);

  -- Prefiks display dari layanan (SVC-05); fallback huruf pertama nama.
  SELECT COALESCE(prefiks_antrean, upper(substr(nama, 1, 1))) INTO v_prefiks
  FROM public.layanan WHERE id = p_layanan_id;

  INSERT INTO public.tiket_antrean (kunjungan_id, layanan_id, tanggal, nomor, nomor_display, status, waktu_terbit)
  VALUES (p_kunjungan_id, p_layanan_id, v_tanggal, v_nomor,
          v_prefiks || '-' || lpad(v_nomor::text, 3, '0'), 'menunggu', now())
  RETURNING id INTO v_tiket_id;

  RETURN v_tiket_id;
END $$;

REVOKE ALL ON FUNCTION public.terbit_tiket(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_tiket(uuid, uuid) TO service_role;

-- 6. layanan.prefiks_antrean
DROP TRIGGER IF EXISTS trg_layanan_isi_prefiks ON public.layanan;
DROP FUNCTION IF EXISTS public.layanan_isi_prefiks();
DROP FUNCTION IF EXISTS public.prefiks_antrean_usul(text, uuid);
ALTER TABLE public.layanan DROP CONSTRAINT IF EXISTS layanan_prefiks_antrean_format;
ALTER TABLE public.layanan ALTER COLUMN prefiks_antrean DROP NOT NULL;
DROP INDEX IF EXISTS public.uq_layanan_prefiks_antrean;
CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_prefiks
  ON public.layanan(prefiks_antrean)
  WHERE prefiks_antrean IS NOT NULL;
COMMENT ON COLUMN public.layanan.prefiks_antrean IS NULL;
