-- 202607290013_kunjungan_tiket.sql
-- WP-20 / QUE-01 / GST-01 / OPS-01 Langkah 1 (TAMBAH): struktur kunjungan + tiket_antrean.
--
-- PALING BERISIKO (OPS-02). Langkah 1 hanya MEMBUAT struktur KOSONG — tidak mengubah
-- perilaku `visit` yang sudah live. Backfill & dual-write di WP-21 (Langkah 2).
-- ADITIF murni; `visit` TIDAK dihapus/diubah.

-- ============================================================
-- 1. Kolom struktur layanan (SVC-02/03, QUE-10, QUE-16) — aditif.
-- ============================================================
ALTER TABLE public.layanan
  ADD COLUMN IF NOT EXISTS penyerta               text CHECK (penyerta IN ('dpmptsp','p4')),
  ADD COLUMN IF NOT EXISTS status_tampilan        text NOT NULL DEFAULT 'aktif'
        CHECK (status_tampilan IN ('aktif','coming_soon','nonaktif')),
  ADD COLUMN IF NOT EXISTS punya_antrean          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS punya_chat             boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS punya_jadwal_standby   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS punya_dokumen_peraturan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS batas_ambil_nomor_menit int NOT NULL DEFAULT 30
        CHECK (batas_ambil_nomor_menit >= 0),
  ADD COLUMN IF NOT EXISTS kuota_harian           int NULL;  -- QUE-16 disiapkan, tidak dipakai

-- ============================================================
-- 2. Tabel kunjungan: SATU kedatangan fisik satu orang satu hari (QUE-01).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.kunjungan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengunjung_id   uuid REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  nama            text NOT NULL,
  kontak_hp       text,
  asal            text NOT NULL CHECK (asal IN ('walk_in','reservasi')),
  qr_token        text UNIQUE,
  tanggal         date NOT NULL,                     -- Asia/Jakarta (RPT-07)
  waktu_masuk     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'menunggu'
        CHECK (status IN ('terjadwal','menunggu','dilayani','selesai','batal','no_show','tidak_terlayani')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_kunjungan_tanggal    ON public.kunjungan(tanggal DESC);
CREATE INDEX IF NOT EXISTS idx_kunjungan_pengunjung ON public.kunjungan(pengunjung_id);
CREATE INDEX IF NOT EXISTS idx_kunjungan_qr         ON public.kunjungan(qr_token);

-- ============================================================
-- 3. Tabel tiket_antrean: SATU nomor untuk satu layanan (FK kunjungan). QUE-01..08.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.tiket_antrean (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunjungan_id      uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  layanan_id        uuid NOT NULL REFERENCES public.layanan(id) ON DELETE RESTRICT,
  tanggal           date NOT NULL,                     -- Asia/Jakarta
  nomor             int  NOT NULL,
  nomor_display     text NOT NULL,                     -- '<PREFIKS>-<URUT>' misal 'A-001'
  status            text NOT NULL DEFAULT 'menunggu'
        CHECK (status IN ('menunggu','dipanggil','dilayani','selesai','batal','no_show','tidak_terlayani')),
  dilayani_oleh     uuid REFERENCES public.petugas(id) ON DELETE SET NULL,  -- QUE-07
  waktu_terbit      timestamptz NOT NULL DEFAULT now(), -- saat check-in (QUE-04)
  waktu_mulai_layan timestamptz,
  waktu_selesai     timestamptz,
  panggilan_count   int NOT NULL DEFAULT 0,             -- QUE-17 panggil ulang
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal, nomor)                   -- I-01 jaring pengaman terakhir
);
CREATE INDEX IF NOT EXISTS idx_tiket_layanan_tanggal ON public.tiket_antrean(layanan_id, tanggal, status);
CREATE INDEX IF NOT EXISTS idx_tiket_kunjungan       ON public.tiket_antrean(kunjungan_id);

-- ============================================================
-- 4. Fungsi terbit tiket ATOMIK: nomor dari antrean_counter (WP-05) + baris tiket.
--    Mengembalikan tiket yang dibuat. Memanggil terbit_nomor_antrean() (atomik).
-- ============================================================
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
GRANT EXECUTE ON FUNCTION public.terbit_tiket(uuid, uuid) TO authenticated;

-- ============================================================
-- 5. RLS (ketat, mengikuti 04-RBAC-MATRIX).
-- ============================================================
ALTER TABLE public.kunjungan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiket_antrean ENABLE ROW LEVEL SECURITY;

-- Kunjungan: publik/FO boleh membuat (walk-in); pengunjung baca miliknya; staf baca semua.
DROP POLICY IF EXISTS kunjungan_insert_public ON public.kunjungan;
CREATE POLICY kunjungan_insert_public ON public.kunjungan FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS kunjungan_select_own ON public.kunjungan;
CREATE POLICY kunjungan_select_own ON public.kunjungan FOR SELECT
  USING (pengunjung_id = (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid()));
DROP POLICY IF EXISTS kunjungan_staff_select ON public.kunjungan;
CREATE POLICY kunjungan_staff_select ON public.kunjungan FOR SELECT
  USING (public.get_my_role() IN ('petugas','admin','front_office'));
DROP POLICY IF EXISTS kunjungan_staff_update ON public.kunjungan;
CREATE POLICY kunjungan_staff_update ON public.kunjungan FOR UPDATE
  USING (public.get_my_role() IN ('petugas','admin','front_office'));

-- Tiket: publik/FO membuat; pengunjung baca tiketnya; petugas hanya layanannya; admin/FO semua.
DROP POLICY IF EXISTS tiket_insert_public ON public.tiket_antrean;
CREATE POLICY tiket_insert_public ON public.tiket_antrean FOR INSERT WITH CHECK (true);
DROP POLICY IF EXISTS tiket_select_own ON public.tiket_antrean;
CREATE POLICY tiket_select_own ON public.tiket_antrean FOR SELECT
  USING (kunjungan_id IN (SELECT id FROM public.kunjungan
        WHERE pengunjung_id = (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())));
DROP POLICY IF EXISTS tiket_staff_select ON public.tiket_antrean;
CREATE POLICY tiket_staff_select ON public.tiket_antrean FOR SELECT
  USING (public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id());
DROP POLICY IF EXISTS tiket_staff_update ON public.tiket_antrean;
CREATE POLICY tiket_staff_update ON public.tiket_antrean FOR UPDATE
  USING (public.get_my_role() IN ('admin','front_office') OR layanan_id = public.get_my_layanan_id());
