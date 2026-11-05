-- ROLLBACK 202611030013_masukan_pengunjung.sql
-- Tanpa BEGIN/COMMIT: jalankan lewat penerap atomik (--atomic) atau di dalam satu transaksi manual.
-- Urutan: fungsi klien -> view -> pemicu -> fungsi internal -> kolom.
-- MENOLAK berjalan bila sudah ada data baru (penangan terisi, riwayat penangan, atau saran ditinjau), KECUALI
-- flag transaksi lmh.rollback_paksa = 'on' dinyalakan sadar setelah data diekspor/diarsipkan:
--   SELECT set_config('lmh.rollback_paksa', 'on', true);
-- Dengan paksa: riwayat penangan (jenis <> 'status') DIHAPUS, kolom penangan dan ditinjau DIBUANG (tidak bisa dipulihkan).
-- Baris riwayat status, saran, dan pengaduan lain tidak berubah. v_pengaduan_petugas dipulihkan ke definisi 202611030003.

DO $$
DECLARE
  v_paksa boolean := COALESCE(pg_catalog.current_setting('lmh.rollback_paksa', true), '') = 'on';
  v_penangan bigint := 0;
  v_riwayat  bigint := 0;
  v_saran    bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.pengaduan'::regclass AND attname = 'penangan_id' AND NOT attisdropped) THEN
    EXECUTE 'SELECT pg_catalog.count(*) FROM public.pengaduan WHERE penangan_id IS NOT NULL' INTO v_penangan;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.pengaduan_riwayat'::regclass AND attname = 'jenis' AND NOT attisdropped) THEN
    EXECUTE 'SELECT pg_catalog.count(*) FROM public.pengaduan_riwayat WHERE jenis <> ''status''' INTO v_riwayat;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.saran'::regclass AND attname = 'ditinjau_pada' AND NOT attisdropped) THEN
    EXECUTE 'SELECT pg_catalog.count(*) FROM public.saran WHERE ditinjau_pada IS NOT NULL' INTO v_saran;
  END IF;
  IF (v_penangan + v_riwayat + v_saran) > 0 AND NOT v_paksa THEN
    RAISE EXCEPTION 'ROLLBACK_DITOLAK: ada data baru (penangan %, riwayat penangan %, saran ditinjau %). Ekspor dulu, lalu nyalakan lmh.rollback_paksa.',
      v_penangan, v_riwayat, v_saran;
  END IF;
END $$;

-- Fungsi klien.
DROP FUNCTION IF EXISTS public.tangani_pengaduan(uuid);
DROP FUNCTION IF EXISTS public.ambil_alih_pengaduan(uuid, text);
DROP FUNCTION IF EXISTS public.linimasa_pengaduan(uuid);
DROP FUNCTION IF EXISTS public.ringkasan_pengaduan_kerja(text);
DROP FUNCTION IF EXISTS public.tandai_saran_ditinjau(uuid[], boolean);
DROP FUNCTION IF EXISTS public.tandai_semua_saran_ditinjau(timestamptz, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.jumlah_saran_belum_ditinjau();

-- View kerja dan view petugas (kolom SLA tidak bisa dibuang dengan CREATE OR REPLACE, jadi dibuat ulang).
DROP VIEW IF EXISTS public.v_pengaduan_kerja;
DROP VIEW IF EXISTS public.v_pengaduan_petugas;
CREATE VIEW public.v_pengaduan_petugas AS
SELECT g.id, g.nomor_tiket, g.jalur, g.layanan_id, g.isi, g.anonim, g.status,
       g.batas_verifikasi, g.batas_penanganan, g.created_at, g.updated_at
FROM public.pengaduan AS g
WHERE g.jalur = 'layanan' AND g.sumber <> 'wizard' AND public.peran_saya() = 'petugas' AND public.boleh_layanan(g.layanan_id);
REVOKE ALL ON public.v_pengaduan_petugas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_pengaduan_petugas TO authenticated;

-- Pemicu dan fungsi internal.
DROP TRIGGER IF EXISTS trg_pengaduan_penangan ON public.pengaduan;
DROP TRIGGER IF EXISTS trg_riwayat_penangan ON public.pengaduan_riwayat;
DROP FUNCTION IF EXISTS public.jaga_penangan_pengaduan();
DROP FUNCTION IF EXISTS public.jaga_riwayat_penangan();
DROP FUNCTION IF EXISTS public.pengaduan_sla(text, date, date);
DROP FUNCTION IF EXISTS public.hari_kerja_antara(date, date);

-- Data dan kolom (hanya sampai sini bila tidak ada data baru atau paksa menyala).
DELETE FROM public.pengaduan_riwayat WHERE jenis <> 'status';
ALTER TABLE public.pengaduan_riwayat DROP CONSTRAINT IF EXISTS pengaduan_riwayat_jenis_check;
ALTER TABLE public.pengaduan_riwayat DROP COLUMN IF EXISTS penangan_baru;
ALTER TABLE public.pengaduan_riwayat DROP COLUMN IF EXISTS penangan_lama;
ALTER TABLE public.pengaduan_riwayat DROP COLUMN IF EXISTS jenis;

DROP INDEX IF EXISTS public.pengaduan_penangan;
ALTER TABLE public.pengaduan DROP CONSTRAINT IF EXISTS pengaduan_penangan_sejak;
ALTER TABLE public.pengaduan DROP COLUMN IF EXISTS penangan_sejak;
ALTER TABLE public.pengaduan DROP COLUMN IF EXISTS penangan_id;

DROP INDEX IF EXISTS public.saran_belum_ditinjau;
ALTER TABLE public.saran DROP CONSTRAINT IF EXISTS saran_ditinjau_konsisten;
ALTER TABLE public.saran DROP COLUMN IF EXISTS ditinjau_oleh;
ALTER TABLE public.saran DROP COLUMN IF EXISTS ditinjau_pada;
