-- ============================================================
-- Migration 009: Tabel Reservasi (Booking Kunjungan Online)
-- ============================================================

CREATE TABLE reservasi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pengunjung_id UUID NOT NULL REFERENCES pengunjung(id) ON DELETE CASCADE,
  layanan_id UUID REFERENCES layanan(id) ON DELETE RESTRICT,
  tujuan TEXT NOT NULL CHECK (tujuan IN ('loket', 'bertemu_seseorang')),
  nama_yang_ditemui TEXT,
  tanggal_rencana DATE NOT NULL,
  jam_rencana TIME,
  keperluan TEXT,
  qr_token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  status TEXT NOT NULL CHECK (status IN (
    'terjadwal', 'hadir', 'dilayani', 'selesai', 'batal'
  )) DEFAULT 'terjadwal',
  waktu_scan TIMESTAMPTZ,
  diarahkan_ke TEXT,
  catatan_petugas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE reservasi IS 'Booking kunjungan online — pengunjung reservasi, dapat QR, scan di kantor';
COMMENT ON COLUMN reservasi.qr_token IS 'Token unik 32 char hex untuk QR code, di-generate otomatis';
COMMENT ON COLUMN reservasi.tujuan IS 'loket = menuju loket layanan, bertemu_seseorang = ketemu orang tertentu';
COMMENT ON COLUMN reservasi.nama_yang_ditemui IS 'Diisi jika tujuan = bertemu_seseorang (input teks bebas)';

-- Indexes
CREATE INDEX idx_reservasi_pengunjung ON reservasi(pengunjung_id);
CREATE INDEX idx_reservasi_tanggal ON reservasi(tanggal_rencana);
CREATE INDEX idx_reservasi_status ON reservasi(status);
CREATE INDEX idx_reservasi_qr_token ON reservasi(qr_token);

-- RLS
ALTER TABLE reservasi ENABLE ROW LEVEL SECURITY;

-- Pengunjung: baca reservasi sendiri
CREATE POLICY "reservasi_self_select" ON reservasi
  FOR SELECT USING (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
  );

-- Pengunjung: buat reservasi sendiri
CREATE POLICY "reservasi_self_insert" ON reservasi
  FOR INSERT WITH CHECK (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
  );

-- Pengunjung: update reservasi sendiri (hanya yg masih terjadwal)
CREATE POLICY "reservasi_self_update" ON reservasi
  FOR UPDATE USING (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    AND status = 'terjadwal'
  );

-- Petugas/Admin: bisa lihat semua reservasi
CREATE POLICY "reservasi_staff_select" ON reservasi
  FOR SELECT TO authenticated
  USING (
    get_my_role() IN ('petugas', 'admin')
  );

-- Petugas/Admin: bisa update semua reservasi (scan, arahkan, dll)
CREATE POLICY "reservasi_staff_update" ON reservasi
  FOR UPDATE TO authenticated
  USING (
    get_my_role() IN ('petugas', 'admin')
  );
