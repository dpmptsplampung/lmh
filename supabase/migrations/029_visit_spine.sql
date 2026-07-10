-- ============================================================
-- Migration 029: Fase 1 / I1.a: Visit Spine — table + RLS + dual-write triggers + backfill (no UI switch)
-- ============================================================
--
-- Komponen:
--   1. Tabel `visit`            — unified spine (walk_in + reservasi)
--   2. RLS policies             — anon walk_in insert (rate-limited K3),
--                                 pengunjung reservasi insert, select/update own
--   3. Trigger updated_at       — reuse update_updated_at_column() dari migration 016
--   4. Dual-write kunjungan    — AFTER INSERT + AFTER UPDATE → visit (asal='walk_in')
--   5. Dual-write reservasi     — AFTER INSERT OR UPDATE → visit (asal='reservasi')
--   6. Backfill                — import existing kunjungan & reservasi (idempotent)
--
-- Tujuan:
--   I1.a = setup dual-write TANPA mengubah UI. Halaman existing tetap
--   membaca kunjungan/reservasi langsung. Trigger hanya MENAMBAH baris
--   ke visit (tidak pernah memutasi tabel sumber).
--
-- Sumber data:
--   - kunjungan (migration 001 + 010): walk-in, no pengunjung_id, no qr_token
--   - reservasi  (migration 009)     : booking, has pengunjung_id + qr_token + status lifecycle
--
-- Helper yang dipakai (sudah ada):
--   - get_my_role(), get_my_layanan_id()   (migration 003)
--   - check_anon_rate(action, max, window) (migration 022 / K3)
--   - update_updated_at_column()           (migration 016)
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel visit (unified spine)
-- ------------------------------------------------------------
CREATE TABLE visit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asal TEXT NOT NULL CHECK (asal IN ('walk_in', 'reservasi')),
  pengunjung_id UUID REFERENCES pengunjung(id) ON DELETE SET NULL,
  nama TEXT NOT NULL,
  asal_instansi TEXT,
  layanan_id UUID REFERENCES layanan(id) ON DELETE RESTRICT,
  tujuan TEXT CHECK (tujuan IN ('loket', 'bertemu_seseorang')),
  nama_yang_ditemui TEXT,
  keperluan TEXT,
  qr_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL CHECK (status IN (
    'terjadwal', 'menunggu', 'dilayani', 'selesai', 'batal', 'no_show'
  )) DEFAULT 'menunggu',
  tanggal_rencana DATE,
  jam_rencana TIME,
  waktu_masuk TIMESTAMPTZ,
  waktu_scan TIMESTAMPTZ,
  waktu_mulai_layan TIMESTAMPTZ,
  waktu_selesai TIMESTAMPTZ,
  diarahkan_ke TEXT,
  catatan_petugas TEXT,
  sumber_id UUID,            -- id row di tabel asal (kunjungan.id atau reservasi.id)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE visit IS 'Unified Visit Spine — baris dari walk_in (kunjungan) dan reservasi';
COMMENT ON COLUMN visit.asal IS 'walk_in = buku tamu (kunjungan), reservasi = booking online';
COMMENT ON COLUMN visit.sumber_id IS 'Id row di tabel asal (kunjungan.id atau reservasi.id). Digunakan untuk idempotensi backfill & sync trigger.';

CREATE INDEX idx_visit_layanan_status ON visit(layanan_id, status);
CREATE INDEX idx_visit_tanggal ON visit(tanggal_rencana);
CREATE INDEX idx_visit_qr ON visit(qr_token);
CREATE INDEX idx_visit_pengunjung ON visit(pengunjung_id);
CREATE INDEX idx_visit_asal ON visit(asal);
CREATE INDEX idx_visit_sumber ON visit(sumber_id);


-- ------------------------------------------------------------
-- 2. Trigger updated_at (reuse update_updated_at_column() dari migration 016)
-- ------------------------------------------------------------
-- Fungsi update_updated_at_column() sudah dibuat oleh migration 016
-- (site_settings_landing_content.sql:125). Kita hanya pasang trigger-nya.
CREATE TRIGGER trg_visit_updated
  BEFORE UPDATE ON visit
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ------------------------------------------------------------
-- 3. RLS policies
-- ------------------------------------------------------------
ALTER TABLE visit ENABLE ROW LEVEL SECURITY;

-- Anon: INSERT walk_in (rate-limited via check_anon_rate dari K3)
CREATE POLICY "visit_insert_walk_in" ON visit
  FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'walk_in'
    AND check_anon_rate('visit_insert_walk_in', 5, 60)
  );

-- Pengunjung: INSERT reservasi (must own the pengunjung_id)
CREATE POLICY "visit_insert_reservasi" ON visit
  FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'reservasi'
    AND pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
  );

-- Pengunjung: SELECT own visits (atau petugas layanan, atau admin)
CREATE POLICY "visit_select_own" ON visit
  FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );

-- Pengunjung/petugas/admin: UPDATE own/staff visits
CREATE POLICY "visit_update_own" ON visit
  FOR UPDATE TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  )
  WITH CHECK (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );


-- ------------------------------------------------------------
-- 4. Dual-write trigger: kunjungan → visit (asal='walk_in')
--    kunjungan tidak punya qr_token → di-generate.
--    kunjungan tidak punya tujuan → default 'loket'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_kunjungan_to_visit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO visit (
    asal, pengunjung_id, nama, asal_instansi, layanan_id, tujuan,
    keperluan, qr_token, status, waktu_masuk, waktu_selesai,
    sumber_id, created_at
  )
  SELECT
    'walk_in', NULL, NEW.nama, NEW.asal_instansi, NEW.layanan_id, 'loket',
    NEW.keperluan, COALESCE(NEW.qr_token, encode(gen_random_bytes(16), 'hex')),
    CASE WHEN NEW.status = 'selesai' THEN 'selesai' ELSE 'menunggu' END,
    NEW.waktu_masuk, NEW.waktu_selesai,
    NEW.id, NEW.created_at
  WHERE NOT EXISTS (SELECT 1 FROM visit WHERE sumber_id = NEW.id AND asal = 'walk_in');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kunjungan_to_visit
  AFTER INSERT ON kunjungan
  FOR EACH ROW EXECUTE FUNCTION sync_kunjungan_to_visit();


-- ------------------------------------------------------------
-- 4b. Dual-write trigger: kunjungan UPDATE → visit (status change)
--     Update status & waktu_selesai di visit row terkait.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_kunjungan_update_to_visit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE visit SET
    status = CASE WHEN NEW.status = 'selesai' THEN 'selesai' ELSE 'menunggu' END,
    waktu_selesai = NEW.waktu_selesai,
    asal_instansi = NEW.asal_instansi,
    keperluan = NEW.keperluan
  WHERE sumber_id = NEW.id AND asal = 'walk_in';
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_kunjungan_update_to_visit
  AFTER UPDATE ON kunjungan
  FOR EACH ROW EXECUTE FUNCTION sync_kunjungan_update_to_visit();


-- ------------------------------------------------------------
-- 5. Dual-write trigger: reservasi → visit (asal='reservasi')
--    Reservasi punya pengunjung_id & qr_token & status lifecycle.
--    nama diambil dari tabel pengunjung, dengan COALESCE fallback
--    (risk: pengunjung terhapus → subquery NULL → violates NOT NULL).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_reservasi_to_visit()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO visit (
    asal, pengunjung_id, nama, layanan_id, tujuan, nama_yang_ditemui,
    keperluan, qr_token, status, tanggal_rencana, jam_rencana,
    waktu_scan, diarahkan_ke, catatan_petugas, sumber_id, created_at
  )
  VALUES (
    'reservasi', NEW.pengunjung_id,
    COALESCE((SELECT nama FROM pengunjung WHERE id = NEW.pengunjung_id), 'Pengunjung'),
    NEW.layanan_id, NEW.tujuan, NEW.nama_yang_ditemui,
    NEW.keperluan, NEW.qr_token,
    CASE NEW.status
      WHEN 'terjadwal' THEN 'terjadwal'
      WHEN 'hadir' THEN 'menunggu'
      WHEN 'dilayani' THEN 'dilayani'
      WHEN 'selesai' THEN 'selesai'
      WHEN 'batal' THEN 'batal'
    END,
    NEW.tanggal_rencana, NEW.jam_rencana,
    NEW.waktu_scan, NEW.diarahkan_ke, NEW.catatan_petugas,
    NEW.id, NEW.created_at
  )
  ON CONFLICT (qr_token) DO UPDATE SET
    status = EXCLUDED.status,
    waktu_scan = EXCLUDED.waktu_scan,
    diarahkan_ke = EXCLUDED.diarahkan_ke,
    catatan_petugas = EXCLUDED.catatan_petugas,
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_reservasi_to_visit
  AFTER INSERT OR UPDATE ON reservasi
  FOR EACH ROW EXECUTE FUNCTION sync_reservasi_to_visit();


-- ------------------------------------------------------------
-- 6. Backfill existing data (idempotent — WHERE NOT EXISTS)
-- ------------------------------------------------------------
-- 6a. Backfill from kunjungan
INSERT INTO visit (
  asal, nama, asal_instansi, layanan_id, tujuan, keperluan, qr_token,
  status, waktu_masuk, waktu_selesai, sumber_id, created_at
)
SELECT
  'walk_in', k.nama, k.asal_instansi, k.layanan_id, 'loket', k.keperluan,
  encode(gen_random_bytes(16), 'hex'),
  CASE WHEN k.status = 'selesai' THEN 'selesai' ELSE 'menunggu' END,
  k.waktu_masuk, k.waktu_selesai, k.id, k.created_at
FROM kunjungan k
WHERE NOT EXISTS (SELECT 1 FROM visit WHERE sumber_id = k.id AND asal = 'walk_in');

-- 6b. Backfill from reservasi (nama dengan COALESCE fallback)
INSERT INTO visit (
  asal, pengunjung_id, nama, layanan_id, tujuan, nama_yang_ditemui,
  keperluan, qr_token, status, tanggal_rencana, jam_rencana,
  waktu_scan, diarahkan_ke, catatan_petugas, sumber_id, created_at
)
SELECT
  'reservasi', r.pengunjung_id,
  COALESCE((SELECT nama FROM pengunjung WHERE id = r.pengunjung_id), 'Pengunjung'),
  r.layanan_id, r.tujuan, r.nama_yang_ditemui,
  r.keperluan, r.qr_token,
  CASE r.status
    WHEN 'terjadwal' THEN 'terjadwal'
    WHEN 'hadir' THEN 'menunggu'
    WHEN 'dilayani' THEN 'dilayani'
    WHEN 'selesai' THEN 'selesai'
    WHEN 'batal' THEN 'batal'
  END,
  r.tanggal_rencana, r.jam_rencana,
  r.waktu_scan, r.diarahkan_ke, r.catatan_petugas,
  r.id, r.created_at
FROM reservasi r
WHERE NOT EXISTS (SELECT 1 FROM visit WHERE sumber_id = r.id AND asal = 'reservasi');


-- ============================================================
-- ROLLBACK:
--   -- Drop triggers
--   DROP TRIGGER IF EXISTS trg_reservasi_to_visit ON reservasi;
--   DROP TRIGGER IF EXISTS trg_kunjungan_update_to_visit ON kunjungan;
--   DROP TRIGGER IF EXISTS trg_kunjungan_to_visit ON kunjungan;
--   DROP TRIGGER IF EXISTS trg_visit_updated ON visit;
--
--   -- Drop policies
--   DROP POLICY IF EXISTS "visit_update_own" ON visit;
--   DROP POLICY IF EXISTS "visit_select_own" ON visit;
--   DROP POLICY IF EXISTS "visit_insert_reservasi" ON visit;
--   DROP POLICY IF EXISTS "visit_insert_walk_in" ON visit;
--
--   -- Drop functions (hanya yang dibuat migrasi ini —
--   --   update_updated_at_column() TIDAK di-drop, milik migration 016)
--   DROP FUNCTION IF EXISTS sync_reservasi_to_visit();
--   DROP FUNCTION IF EXISTS sync_kunjungan_update_to_visit();
--   DROP FUNCTION IF EXISTS sync_kunjungan_to_visit();
--
--   -- Drop tabel
--   DROP TABLE IF EXISTS visit;
-- ============================================================
