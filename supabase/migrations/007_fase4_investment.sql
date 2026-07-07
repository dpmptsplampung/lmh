-- ============================================================
-- Migration 007: Fase 4b — Investment Gallery
-- ============================================================

CREATE TABLE investment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  judul TEXT NOT NULL,
  kategori TEXT,
  urutan_tampil INTEGER NOT NULL DEFAULT 0,
  file_path TEXT NOT NULL,        -- path di private bucket (PDF asli)
  halaman_gambar TEXT[],          -- array path gambar per halaman (hasil konversi)
  jumlah_halaman INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('aktif', 'nonaktif')) DEFAULT 'aktif',
  uploaded_by UUID REFERENCES petugas(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE investment_documents IS 'Dokumen Investment Gallery — PDF di private bucket, ditampilkan sebagai gambar';
COMMENT ON COLUMN investment_documents.file_path IS 'Path PDF asli di private Supabase Storage bucket';
COMMENT ON COLUMN investment_documents.halaman_gambar IS 'Array path gambar per halaman (dikonversi at-upload)';

CREATE INDEX idx_investment_status ON investment_documents(status);
CREATE INDEX idx_investment_urutan ON investment_documents(urutan_tampil);

-- RLS
ALTER TABLE investment_documents ENABLE ROW LEVEL SECURITY;

-- Public: read active documents metadata only
CREATE POLICY "investment_public_read" ON investment_documents
  FOR SELECT USING (status = 'aktif');

-- Admin: full access
CREATE POLICY "investment_admin_all" ON investment_documents
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');
