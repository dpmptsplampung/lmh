-- ============================================================
-- Migration 006: Fase 4a — Matchmaking UMKM
-- ============================================================

CREATE TABLE listing_umkm (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nama_umkm TEXT NOT NULL,
  kategori_kebutuhan TEXT NOT NULL CHECK (kategori_kebutuhan IN (
    'bahan_baku', 'pemasaran', 'modal', 'peralatan',
    'pelatihan', 'kemitraan', 'lainnya'
  )),
  deskripsi TEXT,
  foto_produk TEXT[],  -- array of Supabase storage paths
  kontak_nama TEXT NOT NULL,
  kontak_hp TEXT,
  kontak_email TEXT,
  edit_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'pending_review', 'published', 'nonaktif', 'expired'
  )) DEFAULT 'draft',
  snapshot_approved JSONB,  -- versi terakhir yang disetujui, tetap tayang selama pending_review
  dibuat_oleh UUID REFERENCES petugas(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE listing_umkm IS 'Marketplace kebutuhan UMKM — publik, edit via token (Edge Function)';
COMMENT ON COLUMN listing_umkm.edit_token IS 'Token unik per listing, divalidasi server-side via Edge Function';
COMMENT ON COLUMN listing_umkm.snapshot_approved IS 'Snapshot JSON versi terakhir disetujui — tetap tayang selama edit pending_review';
COMMENT ON COLUMN listing_umkm.foto_produk IS 'Array path file di Supabase Storage';

CREATE INDEX idx_listing_status ON listing_umkm(status);
CREATE INDEX idx_listing_kategori ON listing_umkm(kategori_kebutuhan);
CREATE INDEX idx_listing_token ON listing_umkm(edit_token);

-- RLS
ALTER TABLE listing_umkm ENABLE ROW LEVEL SECURITY;

-- Public: read published listings only
CREATE POLICY "listing_public_read" ON listing_umkm
  FOR SELECT USING (status = 'published');

-- Admin: full access (CRUD + approve pending_review)
CREATE POLICY "listing_admin_all" ON listing_umkm
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Staff (petugas): insert new listings
CREATE POLICY "listing_staff_insert" ON listing_umkm
  FOR INSERT TO authenticated
  WITH CHECK (get_my_role() IN ('admin', 'petugas'));

-- UMKM edit: TIDAK ada policy UPDATE langsung untuk anon
-- Semua update UMKM melalui Edge Function (umkm-edit) dengan service role key
