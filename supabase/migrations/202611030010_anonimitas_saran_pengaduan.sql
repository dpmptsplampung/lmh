-- 202611030010_anonimitas_saran_pengaduan.sql (HOTFIX)
-- Memutus tautan identitas pada saran/pengaduan anonim; SKM/SPAK tetap tertaut.
-- DILARANG diterapkan otomatis. Tinjau blok PEMBERSIHAN PERMANEN sebelum penerapan.
-- ROLLBACK: docs/rollback-anonimitas-saran-pengaduan-202611030010.sql.
--
-- Dipisah dari 202611030011 (lanjutan) agar bisa diterapkan SEKARANG: berkas ini hanya
-- memakai objek yang sudah ada di produksi (202607290007 pengaduan, 202611020001
-- survei_undangan, 202611030003 saran + RPC). Tidak memakai pelapor_email (0006),
-- kirim_saran_publik/kirim_pengaduan_publik (0008), atau email_nyata (202611010003).
-- Gerbang deploy: teks UI "Laporkan dengan anonim. DPMPTSP tidak akan tahu..." hanya
-- boleh tayang setelah berkas ini diterapkan.
--
-- Isi:
--   1. saran.anonim (penanda eksplisit, DEFAULT false).
--   2. PEMBERSIHAN PERMANEN (blok terpisah, diagnostik sebelum/sesudah):
--      a. saran anonim lama dari 0003: sumber='wizard', undangan_id NOT NULL, kunjungan_id NULL.
--         Di 0003 jalur tidak-anonim SELALU mengisi kunjungan_id dari undangan (NOT NULL);
--         bila kunjungan dihapus, undangan ikut terhapus (CASCADE) sehingga undangan_id juga
--         NULL. Jadi pola ini hanya mungkin berasal dari kiriman anonim.
--      b. pengaduan anonim=true: identitas dikosongkan.
--      c. waktu semua baris anonim dibulatkan ke 00:00 WIB (created_at; updated_at bila
--         belum pernah diubah staf; riwayat awal pengaduan).
--   3. Trigger BEFORE INSERT OR UPDATE pada saran dan pengaduan (semua writer, termasuk
--      buat_pengaduan lama dan RPC 0006/0008 bila diterapkan setelah berkas ini):
--      - baris anonim: kolom identitas dikosongkan lewat jsonb_populate_record (tidak
--        mengikat nama kolom, sehingga pelapor_email ikut kosong begitu 0006 menambahkannya);
--      - INSERT anonim: created_at dibulatkan ke 00:00 WIB (dan updated_at pengaduan) supaya
--        tidak bisa dicocokkan dengan waktu mengisi survei (spak/skm_respons.created_at);
--      - UPDATE: penanda anonim tidak boleh berubah (staf tidak bisa menghapus kontak
--        pelapor non-anonim dengan menyetel anonim=true), waktu anonim tetap dibulatkan.
--      Trigger BEFORE INSERT pada pengaduan_riwayat: riwayat awal (status_lama NULL) untuk
--      pengaduan anonim memakai waktu pengaduan yang sudah dibulatkan.
--   4. CHECK identitas anonim (NOT VALID lalu VALIDATE setelah pembersihan).
--   5. kirim_saran dan kirim_pengaduan_survei versi 0003 tanpa undangan_id untuk anonim.
--   6. buat_pengaduan dicabut dari anon/authenticated (pemanggil satu-satunya
--      /api/pengaduan memakai service role).
--
-- Jawaban baris TIDAK anonim tidak berubah (identitas maupun waktunya). SLA tidak
-- terpengaruh: batas_verifikasi/batas_penanganan dihitung dari tanggal WIB, bukan created_at.
-- Risiko sisa (lihat .tim/produk/REVIEW-KEAMANAN.md P1-3): flag survei_undangan.pengaduan_dikirim
-- / saran_dikirim + layanan + tanggal masih bisa mempersempit kandidat bagi pemegang akses DB
-- langsung (staf tidak bisa membaca flag ini: survei_undangan tanpa policy, v_survei_status
-- tidak memuatnya). Isi bebas dan log akses infrastruktur juga di luar jangkauan migrasi.
-- Biaya: trigger hanya mengubah NEW (+ satu lookup PK pada riwayat awal); pembersihan dan
-- VALIDATE memindai saran/pengaduan sekali, perlu jendela penerapan singkat.

DO $$
DECLARE
  v_kolom text;
BEGIN
  IF pg_catalog.to_regclass('public.saran') IS NULL
     OR pg_catalog.to_regclass('public.pengaduan') IS NULL
     OR pg_catalog.to_regclass('public.pengaduan_riwayat') IS NULL
     OR pg_catalog.to_regclass('public.survei_undangan') IS NULL
     OR pg_catalog.to_regclass('public.kunjungan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel % belum ada (202607290007/202611020001/202611030003)',
      'saran/pengaduan/pengaduan_riwayat/survei_undangan/kunjungan';
  END IF;
  -- Tabel tercantum agar mudah ditinjau: 'saran', 'pengaduan', 'pengaduan_riwayat', 'survei_undangan', 'kunjungan'.
  FOREACH v_kolom IN ARRAY ARRAY[
    'saran.isi', 'saran.layanan_id', 'saran.unit',
    'saran.undangan_id', 'saran.kunjungan_id', 'saran.pelapor_nama', 'saran.sumber', 'saran.created_at',
    'pengaduan.undangan_id', 'pengaduan.kunjungan_id', 'pengaduan.sesi_chat_id', 'pengaduan.kontak',
    'pengaduan.pelapor_nama', 'pengaduan.anonim', 'pengaduan.sumber', 'pengaduan.created_at', 'pengaduan.updated_at',
    'pengaduan_riwayat.pengaduan_id', 'pengaduan_riwayat.status_lama', 'pengaduan_riwayat.created_at',
    'survei_undangan.token', 'survei_undangan.kunjungan_id', 'survei_undangan.layanan_id', 'survei_undangan.unit',
    'survei_undangan.diisi_pada', 'survei_undangan.kedaluwarsa_pada',
    'survei_undangan.saran_dikirim', 'survei_undangan.pengaduan_dikirim',
    'kunjungan.nama'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute AS a
      WHERE a.attrelid = pg_catalog.to_regclass('public.' || pg_catalog.split_part(v_kolom, '.', 1))
        AND a.attname = pg_catalog.split_part(v_kolom, '.', 2)
        AND a.attnum > 0 AND NOT a.attisdropped
    ) THEN
      RAISE EXCEPTION 'PRASYARAT: kolom public.% belum ada', v_kolom;
    END IF;
  END LOOP;
  IF pg_catalog.to_regprocedure('public.kirim_saran(text, text, boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.kirim_pengaduan_survei(text, text, boolean)') IS NULL
     OR pg_catalog.to_regprocedure('public.generate_nomor_laporan()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: RPC saran/pengaduan survei belum ada (202611030003)';
  END IF;
  IF pg_catalog.to_regprocedure('public.tambah_hari_kerja(date, integer)') IS NULL
     OR pg_catalog.to_regprocedure('public.buat_pengaduan(text, text, text, uuid, boolean, uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tambah_hari_kerja / buat_pengaduan belum ada (202607290007)';
  END IF;
END $$;

-- Penanda eksplisit. DEFAULT false: baris non-anonim lama tetap non-anonim.
ALTER TABLE public.saran ADD COLUMN IF NOT EXISTS anonim boolean NOT NULL DEFAULT false;

-- =====================================================================================
-- PERINGATAN: PEMBERSIHAN PERMANEN. TIDAK BISA DIBATALKAN oleh rollback.
-- Mengosongkan tautan identitas kiriman anonim dan membulatkan waktunya ke 00:00 WIB.
-- Tidak menghapus baris, isi, status, riwayat, atau flag dedup di survei_undangan.
-- Tidak membuat salinan identitas ke audit/log.
--
-- DIAGNOSTIK SEBELUM (jalankan manual saat dry-run, catat angkanya):
-- SELECT count(*) AS saran_anonim_lama FROM public.saran
--  WHERE sumber = 'wizard' AND undangan_id IS NOT NULL AND kunjungan_id IS NULL;
-- SELECT count(*) AS pengaduan_anonim_bertautan FROM public.pengaduan
--  WHERE anonim AND (undangan_id IS NOT NULL OR kunjungan_id IS NOT NULL OR sesi_chat_id IS NOT NULL
--                    OR kontak IS NOT NULL OR pelapor_nama IS NOT NULL);
-- SELECT count(*) AS pengaduan_anonim_jam_presisi FROM public.pengaduan
--  WHERE anonim AND created_at <> pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
--
-- DIAGNOSTIK SESUDAH (harus 0 semua; saran_anonim_lama SEBELUM = saran ber-anonim baru):
-- SELECT count(*) FROM public.saran WHERE sumber = 'wizard' AND undangan_id IS NOT NULL AND kunjungan_id IS NULL;
-- SELECT count(*) FROM public.saran WHERE anonim
--  AND created_at <> pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
-- SELECT count(*) FROM public.pengaduan WHERE anonim
--  AND (undangan_id IS NOT NULL OR kunjungan_id IS NOT NULL OR sesi_chat_id IS NOT NULL OR kontak IS NOT NULL OR pelapor_nama IS NOT NULL
--       OR created_at <> pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta');
-- SELECT count(*) FROM public.pengaduan_riwayat AS r JOIN public.pengaduan AS p ON p.id = r.pengaduan_id
--  WHERE p.anonim AND r.status_lama IS NULL AND r.created_at <> p.created_at;
-- =====================================================================================

-- 2a. Saran anonim lama (pola 0003, lihat kepala berkas).
UPDATE public.saran
SET anonim = true, undangan_id = NULL, kunjungan_id = NULL, pelapor_nama = NULL,
    created_at = pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
WHERE sumber = 'wizard' AND anonim = false AND undangan_id IS NOT NULL AND kunjungan_id IS NULL;

-- 2b + 2c. Pengaduan anonim: identitas dikosongkan; waktu dibulatkan. updated_at hanya
-- dibulatkan bila sama dengan created_at (belum pernah diubah staf).
UPDATE public.pengaduan
SET undangan_id = NULL, kunjungan_id = NULL, sesi_chat_id = NULL, kontak = NULL, pelapor_nama = NULL,
    updated_at = CASE WHEN updated_at = created_at
                      THEN pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
                      ELSE updated_at END,
    created_at = pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
WHERE anonim = true
  AND (undangan_id IS NOT NULL OR kunjungan_id IS NOT NULL OR sesi_chat_id IS NOT NULL
       OR kontak IS NOT NULL OR pelapor_nama IS NOT NULL
       OR created_at <> pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta');

-- 2c. Saran anonim lain yang sudah bertanda (aman diulang).
UPDATE public.saran
SET created_at = pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'
WHERE anonim = true
  AND created_at <> pg_catalog.date_trunc('day', created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';

-- 2c. Riwayat awal pengaduan anonim mengikuti waktu pengaduan yang sudah dibulatkan.
UPDATE public.pengaduan_riwayat AS r
SET created_at = p.created_at
FROM public.pengaduan AS p
WHERE p.id = r.pengaduan_id AND p.anonim AND r.status_lama IS NULL AND r.created_at <> p.created_at;
-- ============================ AKHIR PEMBERSIHAN PERMANEN ============================

CREATE OR REPLACE FUNCTION public.jaga_saran_anonim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.anonim IS DISTINCT FROM OLD.anonim THEN
      RAISE EXCEPTION 'Penanda anonim saran tidak dapat diubah setelah dikirim' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.anonim THEN
      NEW.created_at := OLD.created_at;
    END IF;
  ELSIF NEW.anonim THEN
    NEW.created_at := pg_catalog.date_trunc('day', NEW.created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
  END IF;
  IF NEW.anonim THEN
    NEW := pg_catalog.jsonb_populate_record(NEW, '{"undangan_id":null,"kunjungan_id":null,"pelapor_nama":null}'::jsonb);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_saran_anonim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_saran_anonim ON public.saran;
CREATE TRIGGER trg_saran_anonim
  BEFORE INSERT OR UPDATE ON public.saran
  FOR EACH ROW EXECUTE FUNCTION public.jaga_saran_anonim();

-- Juga menutup RPC buat_pengaduan lama dan versi 0006/0008 bila diterapkan sesudah berkas
-- ini: p_kontak, p_sesi_chat_id, undangan_id, dan pelapor_email dibuang bila anonim.
CREATE OR REPLACE FUNCTION public.jaga_pengaduan_anonim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.anonim IS DISTINCT FROM OLD.anonim THEN
      RAISE EXCEPTION 'Penanda anonim pengaduan tidak dapat diubah setelah dikirim' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.anonim THEN
      NEW.created_at := OLD.created_at;
    END IF;
  ELSIF NEW.anonim THEN
    NEW.created_at := pg_catalog.date_trunc('day', NEW.created_at AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta';
    NEW.updated_at := NEW.created_at;
  END IF;
  IF NEW.anonim THEN
    NEW := pg_catalog.jsonb_populate_record(NEW,
      '{"undangan_id":null,"kunjungan_id":null,"sesi_chat_id":null,"kontak":null,"pelapor_nama":null,"pelapor_email":null}'::jsonb);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_pengaduan_anonim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_pengaduan_anonim ON public.pengaduan;
CREATE TRIGGER trg_pengaduan_anonim
  BEFORE INSERT OR UPDATE ON public.pengaduan
  FOR EACH ROW EXECUTE FUNCTION public.jaga_pengaduan_anonim();

-- Riwayat awal ditulis RPC SECURITY DEFINER pada transaksi yang sama dengan INSERT
-- pengaduan, sehingga baris pengaduan (waktu sudah dibulatkan) terlihat di sini.
CREATE OR REPLACE FUNCTION public.jaga_riwayat_pengaduan_anonim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_waktu timestamptz;
BEGIN
  IF NEW.status_lama IS NULL THEN
    SELECT p.created_at INTO v_waktu FROM public.pengaduan AS p WHERE p.id = NEW.pengaduan_id AND p.anonim;
    IF FOUND THEN
      NEW.created_at := v_waktu;
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.jaga_riwayat_pengaduan_anonim() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_riwayat_pengaduan_anonim ON public.pengaduan_riwayat;
CREATE TRIGGER trg_riwayat_pengaduan_anonim
  BEFORE INSERT ON public.pengaduan_riwayat
  FOR EACH ROW EXECUTE FUNCTION public.jaga_riwayat_pengaduan_anonim();

-- CHECK menolak regresi bila trigger diubah migrasi berikutnya. pelapor_email (0006)
-- ditambahkan ke CHECK oleh 202611030011.
ALTER TABLE public.saran DROP CONSTRAINT IF EXISTS saran_anonim_tanpa_identitas;
ALTER TABLE public.saran ADD CONSTRAINT saran_anonim_tanpa_identitas CHECK (
  NOT anonim OR (undangan_id IS NULL AND kunjungan_id IS NULL AND pelapor_nama IS NULL)
) NOT VALID;
ALTER TABLE public.saran VALIDATE CONSTRAINT saran_anonim_tanpa_identitas;
ALTER TABLE public.pengaduan DROP CONSTRAINT IF EXISTS pengaduan_anonim_tanpa_identitas;
ALTER TABLE public.pengaduan ADD CONSTRAINT pengaduan_anonim_tanpa_identitas CHECK (
  NOT anonim OR (undangan_id IS NULL AND kunjungan_id IS NULL AND sesi_chat_id IS NULL
                AND kontak IS NULL AND pelapor_nama IS NULL)
) NOT VALID;
ALTER TABLE public.pengaduan VALIDATE CONSTRAINT pengaduan_anonim_tanpa_identitas;

-- Versi 0003 + penanda anonim: kiriman anonim tidak menyimpan undangan_id.
CREATE OR REPLACE FUNCTION public.kirim_saran(p_token text, p_isi text, p_anonim boolean)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u    public.survei_undangan%ROWTYPE;
  v_isi  text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama text;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(p_token) < 16 OR p_anonim IS NULL
     OR pg_catalog.char_length(v_isi) < 1 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN 'invalid';
  END IF;
  SELECT * INTO v_u FROM public.survei_undangan AS u WHERE u.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_u.diisi_pada IS NULL THEN RETURN 'belum_survei'; END IF;
  IF v_u.saran_dikirim THEN RETURN 'duplicate'; END IF;
  IF pg_catalog.now() >= GREATEST(v_u.kedaluwarsa_pada, v_u.diisi_pada + interval '30 minutes') THEN RETURN 'expired'; END IF;

  IF NOT p_anonim THEN
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120) INTO v_nama FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  INSERT INTO public.saran (isi, layanan_id, unit, kunjungan_id, undangan_id, pelapor_nama, sumber, anonim)
  VALUES (v_isi, v_u.layanan_id, v_u.unit, CASE WHEN p_anonim THEN NULL ELSE v_u.kunjungan_id END,
          CASE WHEN p_anonim THEN NULL ELSE v_u.id END,
          CASE WHEN p_anonim THEN NULL ELSE NULLIF(v_nama, '') END, 'wizard', p_anonim);
  UPDATE public.survei_undangan SET saran_dikirim = true WHERE id = v_u.id;
  RETURN 'submitted';
END $$;
REVOKE ALL ON FUNCTION public.kirim_saran(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_saran(text, text, boolean) TO anon, authenticated;

-- Versi 0003 tanpa undangan_id untuk anonim. Dedup cukup lewat flag di bawah kunci baris
-- undangan; bentrok unik hanya nomor laporan (dicoba ulang). Email "diterima" menyusul di 0011.
CREATE OR REPLACE FUNCTION public.kirim_pengaduan_survei(p_token text, p_isi text, p_anonim boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_u      public.survei_undangan%ROWTYPE;
  v_isi    text := pg_catalog.btrim(COALESCE(p_isi, ''));
  v_nama   text;
  v_nomor  text;
  v_id     uuid;
  v_hari   date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_coba   int := 0;
BEGIN
  IF p_token IS NULL OR pg_catalog.length(p_token) < 16 OR p_anonim IS NULL
     OR pg_catalog.char_length(v_isi) < 1 OR pg_catalog.char_length(v_isi) > 2000 THEN
    RETURN pg_catalog.jsonb_build_object('hasil', 'invalid');
  END IF;
  SELECT * INTO v_u FROM public.survei_undangan AS u WHERE u.token = p_token FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('hasil', 'not_found'); END IF;
  IF v_u.diisi_pada IS NULL THEN RETURN pg_catalog.jsonb_build_object('hasil', 'belum_survei'); END IF;
  IF v_u.pengaduan_dikirim THEN RETURN pg_catalog.jsonb_build_object('hasil', 'duplicate'); END IF;
  IF pg_catalog.now() >= GREATEST(v_u.kedaluwarsa_pada, v_u.diisi_pada + interval '30 minutes') THEN
    RETURN pg_catalog.jsonb_build_object('hasil', 'expired');
  END IF;

  IF NOT p_anonim THEN
    SELECT pg_catalog.left(pg_catalog.btrim(k.nama), 120) INTO v_nama FROM public.kunjungan AS k WHERE k.id = v_u.kunjungan_id;
  END IF;

  LOOP
    v_coba := v_coba + 1;
    v_nomor := public.generate_nomor_laporan();
    BEGIN
      INSERT INTO public.pengaduan (
        nomor_tiket, jalur, layanan_id, isi, kontak, anonim, sumber, kunjungan_id, pelapor_nama, undangan_id,
        batas_verifikasi, batas_penanganan
      ) VALUES (
        v_nomor, 'layanan', v_u.layanan_id, v_isi, NULL, p_anonim, 'wizard',
        CASE WHEN p_anonim THEN NULL ELSE v_u.kunjungan_id END,
        CASE WHEN p_anonim THEN NULL ELSE NULLIF(v_nama, '') END,
        CASE WHEN p_anonim THEN NULL ELSE v_u.id END,
        public.tambah_hari_kerja(v_hari, 3), public.tambah_hari_kerja(v_hari, 14)
      ) RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_coba >= 5 THEN RAISE; END IF;
    END;
  END LOOP;

  INSERT INTO public.pengaduan_riwayat (pengaduan_id, status_lama, status_baru, catatan)
  VALUES (v_id, NULL, 'baru', 'pengaduan diterima dari Pesan Perilaku');
  UPDATE public.survei_undangan SET pengaduan_dikirim = true WHERE id = v_u.id;
  RETURN pg_catalog.jsonb_build_object('hasil', 'submitted', 'nomor', v_nomor);
END $$;
REVOKE ALL ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kirim_pengaduan_survei(text, text, boolean) TO anon, authenticated;

-- P2-3: buat_pengaduan hanya dipanggil /api/pengaduan lewat service role (src/app/api/pengaduan/route.ts)
-- dan skrip verifikasi service role. Panggilan langsung anon bisa memalsukan p_sesi_chat_id
-- orang lain dan melewati rate limit route.
REVOKE ALL ON FUNCTION public.buat_pengaduan(text, text, text, uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buat_pengaduan(text, text, text, uuid, boolean, uuid) TO service_role;
