-- ========================================================
-- MIGRATION: 014_absensi_petugas
-- Description: Tabel untuk absensi mandiri petugas CS
-- ========================================================

CREATE TABLE absensi_petugas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  petugas_id UUID NOT NULL REFERENCES petugas(id) ON DELETE CASCADE,
  tanggal DATE NOT NULL DEFAULT CURRENT_DATE,
  jam_masuk TIMESTAMPTZ,
  jam_pulang TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved')) DEFAULT 'pending',
  approved_by UUID REFERENCES petugas(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(petugas_id, tanggal)
);

-- RLS (Row Level Security)
ALTER TABLE absensi_petugas ENABLE ROW LEVEL SECURITY;

-- Petugas bisa membaca absensinya sendiri atau admin bisa baca semua
CREATE POLICY "Petugas view own absensi or admin view all" ON absensi_petugas
FOR SELECT USING (
  petugas_id IN (
    SELECT id FROM petugas WHERE auth_user_id = auth.uid()
  ) OR 
  EXISTS (
    SELECT 1 FROM petugas WHERE auth_user_id = auth.uid() AND role = 'admin'
  )
);

-- Petugas bisa insert absensi (status otomatis pending)
CREATE POLICY "Petugas insert own absensi" ON absensi_petugas
FOR INSERT WITH CHECK (
  petugas_id IN (
    SELECT id FROM petugas WHERE auth_user_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM petugas WHERE auth_user_id = auth.uid() AND role = 'admin'
  )
);

-- Petugas bisa update jam_pulang miliknya sendiri
-- Admin bisa update status (approve) dan jam_pulang
CREATE POLICY "Update absensi" ON absensi_petugas
FOR UPDATE USING (
  petugas_id IN (
    SELECT id FROM petugas WHERE auth_user_id = auth.uid()
  ) OR
  EXISTS (
    SELECT 1 FROM petugas WHERE auth_user_id = auth.uid() AND role = 'admin'
  )
);
