# 03 — MODEL DATA TARGET (FASE C)

> **DDL final** seluruh perubahan skema, beserta constraint, index, **kebijakan RLS per tabel baru**, dan **rencana backfill**.
> Dibuat untuk memenuhi **Bagian 8.3**. Dasar: skema nyata di `schema-live-snapshot.json` + konvensi migrasi yang ada (Bahasa Indonesia untuk tabel/kolom/enum, `timestamptz DEFAULT now()`, `uuid DEFAULT gen_random_uuid()`, RLS + fungsi `get_my_role()`/`get_my_layanan_id()`).
>
> **ATURAN KERAS:** Semua perubahan **ADITIF** (OPS-01). Tidak ada `DROP` kolom/tabel/enum. Setiap tabel baru menyertakan RLS-nya **dalam dokumen yang sama** — tabel tanpa RLS di Supabase adalah tabel terbuka. Semua batas hari = `Asia/Jakarta` (RPT-07).

---

## A. PERUBAHAN PADA TABEL YANG SUDAH ADA (semuanya aditif)

### A.1 `layanan` — SVC-02..05, QUE-10, QUE-16
```sql
ALTER TABLE public.layanan
  ADD COLUMN IF NOT EXISTS nomor_loket            text,
  ADD COLUMN IF NOT EXISTS prefiks_antrean        text,
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
-- kolom `tipe` DIPERTAHANKAN selama transisi (OPS-01), deprecate bertahap (OQ-06)
CREATE UNIQUE INDEX IF NOT EXISTS uq_layanan_prefiks ON public.layanan(prefiks_antrean) WHERE prefiks_antrean IS NOT NULL;
```

### A.2 `petugas` — RBA-06, RBA-08, RBA-02
```sql
ALTER TABLE public.petugas
  ADD COLUMN IF NOT EXISTS aktif            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS nonaktif_sejak   timestamptz NULL,
  ADD COLUMN IF NOT EXISTS nonaktif_oleh    uuid NULL REFERENCES public.petugas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nonaktif_alasan  text NULL;
-- RBA-02: perluas CHECK role agar menampung front_office (OPS-08: perbarui TS)
ALTER TABLE public.petugas DROP CONSTRAINT IF EXISTS petugas_role_check;
ALTER TABLE public.petugas ADD CONSTRAINT petugas_role_check
  CHECK (role IN ('petugas','admin','front_office'));
```

### A.3 `visit` — QUE-08 (transisi; akan digantikan kunjungan+tiket_antrean)
```sql
ALTER TABLE public.visit DROP CONSTRAINT IF EXISTS visit_status_check;
ALTER TABLE public.visit ADD CONSTRAINT visit_status_check
  CHECK (status IN ('terjadwal','menunggu','dilayani','selesai','batal','no_show','tidak_terlayani'));
-- JANGAN hapus kolom/tabel ini; digantikan bertahap oleh kunjungan + tiket_antrean (OPS-02)
```

### A.4 `absensi_petugas` — SCH-08, SCH-10
```sql
ALTER TABLE public.absensi_petugas DROP CONSTRAINT IF EXISTS absensi_petugas_status_check;
ALTER TABLE public.absensi_petugas ADD CONSTRAINT absensi_petugas_status_check
  CHECK (status IN ('pending','approved','ditolak','alpa'));  -- SCH-10
ALTER TABLE public.absensi_petugas
  ADD COLUMN IF NOT EXISTS sumber        text CHECK (sumber IN ('fo','petugas_ajukan','otomatis')),
  ADD COLUMN IF NOT EXISTS dicatat_oleh  uuid NULL REFERENCES public.petugas(id) ON DELETE SET NULL;
```

### A.5 `listing_umkm` — MMK-03, MMK-04, MMK-07
```sql
ALTER TABLE public.listing_umkm DROP CONSTRAINT IF EXISTS listing_umkm_status_check;
ALTER TABLE public.listing_umkm ADD CONSTRAINT listing_umkm_status_check
  CHECK (status IN ('draft','pending_review','published','nonaktif','expired','perlu_perbaikan'));  -- MMK-03
ALTER TABLE public.listing_umkm
  ADD COLUMN IF NOT EXISTS nib              text,
  ADD COLUMN IF NOT EXISTS npwp             text,
  ADD COLUMN IF NOT EXISTS nama_badan_usaha text,
  ADD COLUMN IF NOT EXISTS berkas_legalitas_path text,   -- di bucket PRIVAT umkm-legalitas (MMK-04)
  ADD COLUMN IF NOT EXISTS kontak_terverifikasi boolean NOT NULL DEFAULT false, -- MMK-06
  ADD COLUMN IF NOT EXISTS berlaku_sampai   date,        -- MMK-07
  ADD COLUMN IF NOT EXISTS catatan_review   text;        -- MMK-03
```

### A.6 `site_settings` — CMS-05
```sql
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS tipe_nilai              text NOT NULL DEFAULT 'teks'
        CHECK (tipe_nilai IN ('teks','angka','boolean','json')),
  ADD COLUMN IF NOT EXISTS boleh_diubah_dashboard  boolean NOT NULL DEFAULT true, -- CMS-04
  ADD COLUMN IF NOT EXISTS aturan_validasi         jsonb NULL;
```

### A.7 `faq_knowledge_base` — BOT-11
```sql
ALTER TABLE public.faq_knowledge_base
  ADD COLUMN IF NOT EXISTS perlu_embed_ulang    boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS diubah_oleh          uuid NULL REFERENCES public.petugas(id) ON DELETE SET NULL; -- BOT-10
```

---

## B. TABEL BARU (masing-masing lengkap dengan RLS)

### B.1 `kunjungan` — QUE-01
Satu kedatangan fisik satu orang pada satu hari.
```sql
CREATE TABLE public.kunjungan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengunjung_id   uuid REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  nama            text NOT NULL,
  kontak_hp       text,
  asal            text NOT NULL CHECK (asal IN ('walk_in','reservasi')),
  qr_token        text UNIQUE,                       -- untuk check-in & tambah tiket (QUE-03)
  tanggal         date NOT NULL,                     -- Asia/Jakarta (RPT-07)
  waktu_masuk     timestamptz NOT NULL DEFAULT now(),
  status          text NOT NULL DEFAULT 'menunggu'
        CHECK (status IN ('terjadwal','menunggu','dilayani','selesai','batal','no_show','tidak_terlayani')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_kunjungan_tanggal    ON public.kunjungan(tanggal DESC);
CREATE INDEX idx_kunjungan_pengunjung ON public.kunjungan(pengunjung_id);
CREATE INDEX idx_kunjungan_qr         ON public.kunjungan(qr_token);

ALTER TABLE public.kunjungan ENABLE ROW LEVEL SECURITY;
-- Publik (anon) boleh membuat kunjungan walk-in (seperti visit_insert_walk_in)
CREATE POLICY kunjungan_insert_public ON public.kunjungan FOR INSERT
  WITH CHECK (true);
-- Pengunjung membaca kunjungannya sendiri
CREATE POLICY kunjungan_select_own ON public.kunjungan FOR SELECT
  USING (pengunjung_id = (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid()));
-- Petugas/Admin/FO membaca semua (untuk antrean & rekap)
CREATE POLICY kunjungan_staff_select ON public.kunjungan FOR SELECT
  USING (get_my_role() IN ('petugas','admin','front_office'));
-- Hanya staf yang mengubah status kunjungan
CREATE POLICY kunjungan_staff_update ON public.kunjungan FOR UPDATE
  USING (get_my_role() IN ('petugas','admin','front_office'));
```

### B.2 `tiket_antrean` — QUE-01..08, QUE-13..17
Satu nomor antrean untuk satu layanan (FK ke kunjungan).
```sql
CREATE TABLE public.tiket_antrean (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kunjungan_id      uuid NOT NULL REFERENCES public.kunjungan(id) ON DELETE CASCADE,
  layanan_id        uuid NOT NULL REFERENCES public.layanan(id) ON DELETE RESTRICT,
  tanggal           date NOT NULL,                     -- Asia/Jakarta
  nomor             int  NOT NULL,                     -- urut per layanan+tanggal (QUE-06)
  nomor_display     text NOT NULL,                     -- '<PREFIKS>-<URUT>' misal 'A-001' (SVC-05)
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
CREATE INDEX idx_tiket_layanan_tanggal ON public.tiket_antrean(layanan_id, tanggal, status);
CREATE INDEX idx_tiket_kunjungan       ON public.tiket_antrean(kunjungan_id);

ALTER TABLE public.tiket_antrean ENABLE ROW LEVEL SECURITY;
CREATE POLICY tiket_insert_public ON public.tiket_antrean FOR INSERT WITH CHECK (true);
-- Pengunjung membaca tiket miliknya (lewat kunjungan)
CREATE POLICY tiket_select_own ON public.tiket_antrean FOR SELECT
  USING (kunjungan_id IN (SELECT id FROM public.kunjungan
        WHERE pengunjung_id = (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())));
-- Petugas layanan hanya tiket layanannya; Admin & FO semua
CREATE POLICY tiket_staff_select ON public.tiket_antrean FOR SELECT
  USING (get_my_role() IN ('admin','front_office') OR layanan_id = get_my_layanan_id());
-- Klaim/perbarui tiket: petugas layanan sendiri, FO, Admin (kunci baris via status di aplikasi/fungsi)
CREATE POLICY tiket_staff_update ON public.tiket_antrean FOR UPDATE
  USING (get_my_role() IN ('admin','front_office') OR layanan_id = get_my_layanan_id());
```

### B.3 `antrean_counter` — QUE-06 (penomoran atomik)
```sql
CREATE TABLE public.antrean_counter (
  layanan_id     uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal        date NOT NULL,
  nomor_terakhir int  NOT NULL DEFAULT 0,
  PRIMARY KEY (layanan_id, tanggal)
);
ALTER TABLE public.antrean_counter ENABLE ROW LEVEL SECURITY;
-- Tidak ada akses langsung; hanya lewat fungsi SECURITY DEFINER terbit_nomor_antrean()
CREATE POLICY antrean_counter_deny_all ON public.antrean_counter FOR ALL USING (false) WITH CHECK (false);

-- Penomoran atomik: UPSERT + RETURNING (JANGAN SELECT MAX+1 di aplikasi)
CREATE OR REPLACE FUNCTION public.terbit_nomor_antrean(p_layanan_id uuid, p_tanggal date)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_nomor int;
BEGIN
  INSERT INTO public.antrean_counter (layanan_id, tanggal, nomor_terakhir)
  VALUES (p_layanan_id, p_tanggal, 1)
  ON CONFLICT (layanan_id, tanggal)
  DO UPDATE SET nomor_terakhir = public.antrean_counter.nomor_terakhir + 1
  RETURNING nomor_terakhir INTO v_nomor;
  RETURN v_nomor;
END $$;
REVOKE ALL ON FUNCTION public.terbit_nomor_antrean(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.terbit_nomor_antrean(uuid, date) TO authenticated;
```

### B.4 `buku_tamu` — GST-01..04
```sql
CREATE TABLE public.buku_tamu (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nama             text NOT NULL,
  asal             text,                  -- instansi/daerah
  no_hp            text,
  menemui_siapa    text NOT NULL,
  keperluan        text,
  waktu_masuk      timestamptz NOT NULL DEFAULT now(),
  tanda_tangan_svg text,                  -- SVG path (GST-03), BUKAN PNG
  dicatat_oleh     uuid REFERENCES public.petugas(id) ON DELETE SET NULL, -- FO (GST-04)
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_buku_tamu_waktu ON public.buku_tamu(waktu_masuk DESC);

ALTER TABLE public.buku_tamu ENABLE ROW LEVEL SECURITY;
-- Hanya FO & Admin yang membaca/menulis buku tamu (tanda tangan = data pribadi, GST-03)
CREATE POLICY buku_tamu_fo_admin_all ON public.buku_tamu FOR ALL
  USING (get_my_role() IN ('admin','front_office'))
  WITH CHECK (get_my_role() IN ('admin','front_office'));
```

### B.5 `layanan_kontak` — NOT-01, SVC-06
```sql
CREATE TABLE public.layanan_kontak (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  email         text,
  peran         text CHECK (peran IN ('pic','atasan','cc')),
  aktif         boolean NOT NULL DEFAULT true,
  -- kontak resmi instansi (SVC-06) untuk pengalihan saat alpa (P3)
  nama_pic      text,
  telepon_wa    text,
  alamat_kantor text,
  jam_layanan   text,
  tautan_online text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_layanan_kontak_layanan ON public.layanan_kontak(layanan_id) WHERE aktif;

ALTER TABLE public.layanan_kontak ENABLE ROW LEVEL SECURITY;
-- Publik boleh membaca kontak instansi (untuk pengalihan P3)
CREATE POLICY layanan_kontak_public_read ON public.layanan_kontak FOR SELECT
  USING (aktif = true);
-- Hanya Admin yang mengelola
CREATE POLICY layanan_kontak_admin_write ON public.layanan_kontak FOR ALL
  USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
```

### B.6 `jadwal_standby` + `jadwal_pengecualian` — SCH-04
```sql
CREATE TABLE public.jadwal_standby (          -- pola berulang mingguan
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  hari        smallint NOT NULL CHECK (hari BETWEEN 1 AND 7),  -- 1=Senin..7=Minggu
  jam_mulai   time NOT NULL,
  jam_selesai time NOT NULL,
  aktif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, hari)
);
CREATE TABLE public.jadwal_pengecualian (     -- penyimpangan per tanggal
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal     date NOT NULL,
  jenis       text NOT NULL CHECK (jenis IN ('libur','ganti_hari','jam_beda')),
  jam_mulai   time,                            -- diisi bila ganti_hari/jam_beda
  jam_selesai time,
  alasan      text NOT NULL,
  dibuat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);
ALTER TABLE public.jadwal_standby ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jadwal_pengecualian ENABLE ROW LEVEL SECURITY;
-- Publik membaca jadwal (untuk tampilan jadwal standby & validasi reservasi)
CREATE POLICY jadwal_standby_public_read ON public.jadwal_standby FOR SELECT USING (true);
CREATE POLICY jadwal_pengecualian_public_read ON public.jadwal_pengecualian FOR SELECT USING (true);
-- FO & Admin mengelola (SCH-07), berjejak via trigger audit_change()
CREATE POLICY jadwal_standby_staff_write ON public.jadwal_standby FOR ALL
  USING (get_my_role() IN ('admin','front_office')) WITH CHECK (get_my_role() IN ('admin','front_office'));
CREATE POLICY jadwal_pengecualian_staff_write ON public.jadwal_pengecualian FOR ALL
  USING (get_my_role() IN ('admin','front_office')) WITH CHECK (get_my_role() IN ('admin','front_office'));
```

### B.7 `jadwal_harian_beku` — SCH-05 (TIDAK BOLEH diubah surut)
```sql
CREATE TABLE public.jadwal_harian_beku (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal       date NOT NULL,
  seharusnya_standby boolean NOT NULL,
  jam_mulai     time,
  jam_selesai   time,
  dibekukan_pada timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);
ALTER TABLE public.jadwal_harian_beku ENABLE ROW LEVEL SECURITY;
CREATE POLICY jhb_staff_read ON public.jadwal_harian_beku FOR SELECT
  USING (get_my_role() IN ('petugas','admin','front_office'));
-- INSERT hanya lewat fungsi pembeku (SECURITY DEFINER). UPDATE/DELETE dilarang (I-08).
-- Satu-satunya pengecualian: Admin dengan alasan (dicatat audit) — ditegakkan lewat fungsi khusus, bukan policy longgar.
CREATE POLICY jhb_deny_write ON public.jadwal_harian_beku FOR ALL USING (false) WITH CHECK (false);
```

### B.8 `layanan_hari` — QUE-11, QUE-14, SCH-06
Status operasional per layanan per hari (jam efektif, tutup manual, jam selesai aktual).
```sql
CREATE TABLE public.layanan_hari (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id         uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal            date NOT NULL,
  jam_buka_efektif   time,
  jam_tutup_efektif  time,
  ditutup_manual     boolean NOT NULL DEFAULT false,  -- SCH-06 tombol FO
  alasan_tutup       text,
  ditutup_oleh       uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  jam_selesai_aktual timestamptz,                     -- QUE-14 jam tiket terakhir selesai
  status_hari        text NOT NULL DEFAULT 'belum_dibuka'
        CHECK (status_hari IN ('belum_dibuka','dibuka','ditutup','alpa')),  -- SCH-02/SCH-10
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);
ALTER TABLE public.layanan_hari ENABLE ROW LEVEL SECURITY;
CREATE POLICY layanan_hari_public_read ON public.layanan_hari FOR SELECT USING (true); -- untuk situs & layar TV
CREATE POLICY layanan_hari_staff_write ON public.layanan_hari FOR ALL
  USING (get_my_role() IN ('admin','front_office')) WITH CHECK (get_my_role() IN ('admin','front_office'));
```

### B.9 `dokumen_peraturan` + `dokumen_potongan` — BOT-01..05
```sql
CREATE TABLE public.dokumen_peraturan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  nomor         text NOT NULL,             -- misal 'Permen X No. 5/2023'
  tahun         int  NOT NULL,
  judul         text NOT NULL,
  status        text NOT NULL DEFAULT 'berlaku' CHECK (status IN ('berlaku','dicabut')), -- BOT-05/I-16
  tanggal_berlaku date,
  tinjau_berikutnya date,                  -- pengingat tinjau ulang 6–12 bulan (BOT-09)
  diunggah_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  sumber_tautan text,                      -- tautan JDIH hanya rujukan tampilan (BOT-07)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.dokumen_potongan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dokumen_id    uuid NOT NULL REFERENCES public.dokumen_peraturan(id) ON DELETE CASCADE,
  pasal         text,
  ayat          text,
  halaman       int,
  teks          text NOT NULL,             -- potongan per pasal/ayat (BOT-03)
  embedding     extensions.vector(768),    -- di-embed SEKALI saat unggah (BOT-02)
  perlu_embed_ulang boolean NOT NULL DEFAULT false,
  embedding_updated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_dokumen_potongan_doc ON public.dokumen_potongan(dokumen_id);
-- Index IVFFlat untuk similarity (seperti faq_knowledge_base)
CREATE INDEX idx_dokumen_potongan_embedding ON public.dokumen_potongan
  USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists = 100);

ALTER TABLE public.dokumen_peraturan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dokumen_potongan ENABLE ROW LEVEL SECURITY;
-- Publik membaca dokumen berstatus berlaku (sumber ditampilkan ke warga, BOT-09)
CREATE POLICY dokumen_public_read ON public.dokumen_peraturan FOR SELECT USING (true);
CREATE POLICY potongan_public_read ON public.dokumen_potongan FOR SELECT
  USING (dokumen_id IN (SELECT id FROM public.dokumen_peraturan WHERE status = 'berlaku'));
-- Petugas hanya dokumen layanannya; Admin semua (BOT-09, cocok get_my_layanan_id())
CREATE POLICY dokumen_staff_write ON public.dokumen_peraturan FOR ALL
  USING (get_my_role() = 'admin' OR layanan_id = get_my_layanan_id())
  WITH CHECK (get_my_role() = 'admin' OR layanan_id = get_my_layanan_id());
CREATE POLICY potongan_staff_write ON public.dokumen_potongan FOR ALL
  USING (get_my_role() = 'admin' OR dokumen_id IN
        (SELECT id FROM public.dokumen_peraturan WHERE layanan_id = get_my_layanan_id()))
  WITH CHECK (get_my_role() = 'admin' OR dokumen_id IN
        (SELECT id FROM public.dokumen_peraturan WHERE layanan_id = get_my_layanan_id()));
```

### B.10 `pengaduan` + `pengaduan_riwayat` — CMP-01..08
```sql
CREATE TABLE public.pengaduan (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor_tiket     text NOT NULL UNIQUE,    -- acak tak berurutan (CMP-05), misal 'PGD-XXXXXX'
  jalur           text NOT NULL CHECK (jalur IN ('layanan','integritas')),  -- CMP-06
  layanan_id      uuid REFERENCES public.layanan(id) ON DELETE SET NULL,
  isi             text NOT NULL,
  kontak          text,                    -- untuk pelacakan tanpa login (CMP-05)
  anonim          boolean NOT NULL DEFAULT false,  -- jalur integritas boleh anonim
  sesi_chat_id    uuid REFERENCES public.chat_sesi(id) ON DELETE SET NULL,  -- CMP-08 dari chat
  status          text NOT NULL DEFAULT 'baru'
        CHECK (status IN ('baru','diverifikasi','diproses','eskalasi','selesai','ditolak')),
  batas_verifikasi  date NOT NULL,         -- 3 hari kerja (CMP-03)
  batas_penanganan  date NOT NULL,         -- 14 hari kerja
  diteruskan_ke   uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  lampiran_path   text,                    -- bucket PRIVAT pengaduan-bukti (CMP-07)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.pengaduan_riwayat (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengaduan_id uuid NOT NULL REFERENCES public.pengaduan(id) ON DELETE CASCADE,
  status_lama text, status_baru text NOT NULL,
  catatan     text,
  diubah_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pengaduan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengaduan_riwayat ENABLE ROW LEVEL SECURITY;
-- Siapa pun (termasuk anonim) boleh MEMBUAT pengaduan (CMP-05)
CREATE POLICY pengaduan_insert_public ON public.pengaduan FOR INSERT WITH CHECK (true);
-- Jalur LAYANAN: Admin, FO, dan petugas layanan terkait boleh membaca
CREATE POLICY pengaduan_layanan_read ON public.pengaduan FOR SELECT
  USING (jalur = 'layanan' AND (
        get_my_role() IN ('admin','front_office') OR layanan_id = get_my_layanan_id()));
-- Jalur INTEGRITAS: HANYA Admin (BUKAN petugas, BUKAN FO) — I-15/CMP-06, wajib diuji perilaku (SEC-04)
CREATE POLICY pengaduan_integritas_admin_only ON public.pengaduan FOR SELECT
  USING (jalur = 'integritas' AND get_my_role() = 'admin');
-- Update status: Admin (semua) & FO (hanya jalur layanan)
CREATE POLICY pengaduan_update ON public.pengaduan FOR UPDATE
  USING (get_my_role() = 'admin' OR (jalur = 'layanan' AND get_my_role() = 'front_office'));
CREATE POLICY pengaduan_riwayat_read ON public.pengaduan_riwayat FOR SELECT
  USING (pengaduan_id IN (SELECT id FROM public.pengaduan));
CREATE POLICY pengaduan_riwayat_write ON public.pengaduan_riwayat FOR INSERT
  WITH CHECK (get_my_role() IN ('admin','front_office'));
```

### B.11 `standar_pelayanan` — CMP-09
```sql
CREATE TABLE public.standar_pelayanan (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id  uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  persyaratan text, prosedur text, jangka_waktu text, biaya text,
  produk_layanan text, penanganan_pengaduan text,
  maklumat    text,                        -- Maklumat Pelayanan (UU 25/2009)
  aktif       boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id)
);
ALTER TABLE public.standar_pelayanan ENABLE ROW LEVEL SECURITY;
CREATE POLICY standar_public_read ON public.standar_pelayanan FOR SELECT USING (aktif = true);
CREATE POLICY standar_admin_write ON public.standar_pelayanan FOR ALL
  USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
```

### B.12 `konten_versi` — CMS-03
```sql
CREATE TABLE public.konten_versi (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitas     text NOT NULL,               -- 'landing_content' / 'site_settings' / 'standar_pelayanan'
  entitas_key text NOT NULL,
  nilai       jsonb NOT NULL,              -- snapshot isi
  versi       int NOT NULL,
  diubah_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.konten_versi ENABLE ROW LEVEL SECURITY;
CREATE POLICY konten_versi_admin_all ON public.konten_versi FOR ALL
  USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
```

### B.13 `rekap_harian_layanan` — RPT-05
```sql
CREATE TABLE public.rekap_harian_layanan (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  layanan_id    uuid NOT NULL REFERENCES public.layanan(id) ON DELETE CASCADE,
  tanggal       date NOT NULL,             -- Asia/Jakarta (RPT-07)
  jumlah_kunjungan int NOT NULL DEFAULT 0, -- orang unik (QUE-01)
  jumlah_tiket     int NOT NULL DEFAULT 0, -- layanan diberikan
  tiket_selesai    int NOT NULL DEFAULT 0,
  tiket_tidak_terlayani int NOT NULL DEFAULT 0,
  tiket_no_show    int NOT NULL DEFAULT 0,
  hadir            boolean,                -- dari jadwal_harian_beku + absensi (NOT-07)
  alpa             boolean NOT NULL DEFAULT false,
  jam_absen_masuk  timestamptz,
  jam_selesai_aktual timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (layanan_id, tanggal)
);
ALTER TABLE public.rekap_harian_layanan ENABLE ROW LEVEL SECURITY;
CREATE POLICY rekap_staff_read ON public.rekap_harian_layanan FOR SELECT
  USING (get_my_role() IN ('admin','front_office') OR layanan_id = get_my_layanan_id());
-- Diisi lewat fungsi rollup (SECURITY DEFINER), tidak diisi langsung
CREATE POLICY rekap_deny_write ON public.rekap_harian_layanan FOR ALL USING (false) WITH CHECK (false);
```

### B.14 `laporan_snapshot` — RPT-04
```sql
CREATE TABLE public.laporan_snapshot (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomor_laporan text NOT NULL UNIQUE,
  jenis         text NOT NULL,             -- 'kepatuhan_p4' / 'kepatuhan_internal' / 'rekap_kustom'
  periode_awal  date NOT NULL, periode_akhir date NOT NULL,
  isi           jsonb NOT NULL,            -- isi DIBEKUKAN (RPT-04)
  dicetak_oleh  uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  dicetak_pada  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.laporan_snapshot ENABLE ROW LEVEL SECURITY;
CREATE POLICY laporan_snapshot_admin_read ON public.laporan_snapshot FOR SELECT
  USING (get_my_role() = 'admin');
CREATE POLICY laporan_snapshot_insert ON public.laporan_snapshot FOR INSERT
  WITH CHECK (get_my_role() = 'admin');
-- Tidak ada UPDATE/DELETE — isi dibekukan
```

### B.15 `layar_token` — DSP-07
```sql
CREATE TABLE public.layar_token (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token      text NOT NULL UNIQUE,
  label      text,                          -- misal 'TV Lobi Utama'
  aktif      boolean NOT NULL DEFAULT true,
  dibuat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  kedaluwarsa timestamptz
);
ALTER TABLE public.layar_token ENABLE ROW LEVEL SECURITY;
-- Hanya Admin mengelola token; validasi token untuk layar lewat fungsi SECURITY DEFINER (bukan akses tabel langsung)
CREATE POLICY layar_token_admin_all ON public.layar_token FOR ALL
  USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
```

### B.16 `umkm_verifikasi_jejak` — MMK-05
```sql
CREATE TABLE public.umkm_verifikasi_jejak (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id  uuid NOT NULL REFERENCES public.listing_umkm(id) ON DELETE CASCADE,
  aspek       text NOT NULL,               -- 'kelengkapan' / 'legalitas' / 'kontak'
  cara        text NOT NULL,               -- misal 'NIB dicocokkan di OSS'
  hasil       text NOT NULL,
  diverifikasi_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.umkm_verifikasi_jejak ENABLE ROW LEVEL SECURITY;
CREATE POLICY umkm_jejak_staff ON public.umkm_verifikasi_jejak FOR ALL
  USING (get_my_role() IN ('admin','petugas')) WITH CHECK (get_my_role() IN ('admin','petugas'));
```

### B.17 `jejak_minat_investasi` — INV-02
```sql
CREATE TABLE public.jejak_minat_investasi (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pengunjung_id uuid REFERENCES public.pengunjung(id) ON DELETE SET NULL,
  jenis        text NOT NULL,              -- 'lihat_peta' / 'lihat_sektor' / 'buka_dokumen'
  referensi    text,                       -- sektor / doc_id
  lead_id      uuid REFERENCES public.investasi_lead(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.jejak_minat_investasi ENABLE ROW LEVEL SECURITY;
-- Pengguna login mencatat jejaknya sendiri; Admin membaca semua (INV-06: diungkap di privacy + consent_log)
CREATE POLICY jejak_insert_own ON public.jejak_minat_investasi FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY jejak_admin_read ON public.jejak_minat_investasi FOR SELECT USING (get_my_role() = 'admin');
```

### B.18 `hari_libur` — CMP-03, SCH-04
```sql
CREATE TABLE public.hari_libur (
  tanggal   date PRIMARY KEY,
  keterangan text NOT NULL
);
ALTER TABLE public.hari_libur ENABLE ROW LEVEL SECURITY;
CREATE POLICY hari_libur_public_read ON public.hari_libur FOR SELECT USING (true);
CREATE POLICY hari_libur_admin_write ON public.hari_libur FOR ALL
  USING (get_my_role() = 'admin') WITH CHECK (get_my_role() = 'admin');
```

---

## C. BUCKET PENYIMPANAN (perubahan)

```sql
-- BARU (PRIVAT): legalitas UMKM (MMK-04) & bukti pengaduan (CMP-07)
INSERT INTO storage.buckets (id, name, public) VALUES
  ('umkm-legalitas',  'umkm-legalitas',  false),
  ('pengaduan-bukti', 'pengaduan-bukti', false)
ON CONFLICT (id) DO NOTHING;
-- investment-docs: PRIVAT (sudah ada). umkm-photos: PUBLIK (sudah ada) — JANGAN taruh yang sensitif.
-- RLS storage: kedua bucket baru hanya bisa diakses peran terkait (petugas/admin untuk umkm-legalitas; admin+fo jalur layanan untuk pengaduan-bukti).
```

---

## D. RENCANA BACKFILL (OPS-01/OPS-02)

### D.1 Backfill `kunjungan` + `tiket_antrean` dari `visit` (paling berisiko)
```
1. Buat kunjungan & tiket_antrean (kosong)            -- Langkah 1 TAMBAH
2. Backfill (data-live: 28 baris visit, semua tujuan='loket'):
   setiap visit (tujuan='loket') → 1 kunjungan + 1 tiket
     kunjungan: id baru, pengunjung_id, nama, kontak_hp, asal, qr_token,
                tanggal = (waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date, waktu_masuk, status
     tiket   : kunjungan_id, layanan_id, tanggal sama, nomor = urutan per (layanan,tanggal)
                dari ROW_NUMBER() OVER (PARTITION BY layanan_id, tanggal ORDER BY waktu_masuk),
                nomor_display = prefiks || '-' || lpad(nomor,3,'0'), status dari visit
   setiap visit (tujuan='bertemu_seseorang') → 1 buku_tamu  (data-live: 0 baris)
3. VERIFIKASI: COUNT(visit) = COUNT(tiket_antrean) + COUNT(buku_tamu)  untuk seluruh rentang
4. Aktifkan dual-write (tulis ke visit DAN kunjungan/tiket)  -- Langkah 2 ISI
5. Pindahkan pembacaan per halaman, mulai dari yang paling jarang dipakai  -- Langkah 3 PINDAH
6. /checkin & dashboard antrean dipindah TERAKHIR; setelah ≥2 minggu stabil + persetujuan,
   hentikan penulisan ke visit (JANGAN hapus kolomnya)          -- Langkah 4 HENTIKAN
```

### D.2 Backfill `layanan` (seed 11 layanan — SVC-01)
- Isi `penyerta`, `nomor_loket`, `prefiks_antrean`, `status_tampilan`, bendera kemampuan untuk 11 layanan Bagian 2.1.
- Tambah **BPN** sebagai `status_tampilan='coming_soon'`, `punya_antrean=false` sementara.
- Koreksi "BALMON" → "Balai Monitor SFR". Ubah Matchmaking & Investment Gallery → `penyerta='dpmptsp'`, `punya_antrean=true`.

### D.3 Backfill `jadwal_standby` dari `layanan_jadwal`
- Untuk tiap `layanan_jadwal.hari_kerja[]` → 1 baris `jadwal_standby` per hari (jam dari `jam_buka`/`jam_tutup`).
- `layanan_libur` → `jadwal_pengecualian` (`jenis='libur'`). **Catatan:** data-live semua Senin–Jumat 08:00–16:00; jadwal P4 nyata (misal BPJS hanya Senin) **harus diisi** sebagai bagian dari seed ini (OQ-04).

### D.4 Backfill `site_settings` registry (CMS-05)
- Isi `tipe_nilai` default 'teks', `boleh_diubah_dashboard=true` untuk kunci yang ada; tandai kunci terlarang (CMS-04) `boleh_diubah_dashboard=false`.

### D.5 Tanpa backfill (tabel baru murni)
`layanan_kontak, jadwal_harian_beku, layanan_hari, dokumen_peraturan, dokumen_potongan, pengaduan, pengaduan_riwayat, standar_pelayanan, konten_versi, rekap_harian_layanan, laporan_snapshot, layar_token, umkm_verifikasi_jejak, jejak_minat_investasi, hari_libur` — mulai kosong, diisi oleh proses baru.

---

## E. CATATAN MIGRASI
- **Urutan file** mengikuti konvensi `2026MMDDNNNN_nama` (lanjutan dari `202607280005`). Rincian file per work package ada di `05-IMPLEMENTATION-PLAN.md` (fase D).
- Setiap penambahan nilai enum/CHECK (`tidak_terlayani`, `perlu_perbaikan`, `front_office`, `alpa`, `coming_soon`, status baru `tiket_antrean`) **wajib** disertai pencarian pemetaan ekshaustif di TypeScript (OPS-08).
- `terbit_nomor_antrean()` diuji konkurensi nyata (SK-06) — dua permintaan bersamaan harus menghasilkan dua nomor berbeda tanpa duplikat (I-01).
