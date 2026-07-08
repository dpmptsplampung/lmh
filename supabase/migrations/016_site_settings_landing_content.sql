-- ============================================================
-- Migration 016: Tabel site_settings & landing_content
-- ============================================================

-- Tabel pengaturan global (key-value store)
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE site_settings IS 'Pengaturan global website — key-value store';

-- Seed: FOILA URL
INSERT INTO site_settings (key, value) VALUES
  ('foila_url', 'https://invest.lampungprov.go.id/'),
  ('wa_number', '6281234567890'),
  ('wa_default_message', 'Halo, saya ingin bertanya tentang layanan DPMPTSP Provinsi Lampung.');

-- RLS: admin full, public read
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settings_public_read" ON site_settings
  FOR SELECT USING (true);

CREATE POLICY "settings_admin_all" ON site_settings
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- ============================================================
-- Tabel landing_content — konten landing page yang bisa di-edit admin
-- ============================================================

CREATE TABLE landing_content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section TEXT NOT NULL,          -- 'hero', 'service', 'cta', 'footer'
  item_key TEXT NOT NULL,         -- 'title', 'description', 'icon_name', 'urutan', dll
  item_value TEXT,                -- nilai konten
  item_order INTEGER DEFAULT 0,   -- urutan tampil (untuk list seperti services)
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(section, item_key, item_order)
);

COMMENT ON TABLE landing_content IS 'Konten landing page yang dapat diedit via admin panel';

-- RLS: admin full, public read
ALTER TABLE landing_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "landing_public_read" ON landing_content
  FOR SELECT USING (is_active = true);

CREATE POLICY "landing_admin_all" ON landing_content
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

-- Seed: Hero section
INSERT INTO landing_content (section, item_key, item_value, item_order) VALUES
  ('hero', 'badge_text', 'DPMPTSP Provinsi Lampung', 0),
  ('hero', 'description', 'Hub digital yang menyatukan layanan perizinan, sertifikasi halal, BPJS Kesehatan, matchmaking UMKM, dan galeri investasi dalam satu platform terintegrasi.', 0),
  ('hero', 'cta_primary_text', 'Rencanakan Kedatangan', 0),
  ('hero', 'cta_primary_link', '/me/reservasi', 0),
  ('hero', 'cta_secondary_text', 'Chat via WhatsApp', 0),
  ('hero', 'cta_secondary_link', 'wa', 0),
  ('cta', 'title', 'Siap Berkunjung?', 0),
  ('cta', 'description', 'Booking kedatangan online terlebih dahulu untuk mempercepat pelayanan Anda di kantor DPMPTSP Provinsi Lampung.', 0),
  ('cta', 'button_text', 'Rencanakan Kedatangan', 0),
  ('cta', 'button_link', '/me/reservasi', 0),
  ('footer', 'copyright', 'DPMPTSP Provinsi Lampung. Hak cipta dilindungi.', 0),
  ('section_header', 'label', 'Layanan Kami', 0),
  ('section_header', 'title', '9 Layanan dalam Satu Atap', 0),
  ('section_header', 'description', 'Layanan konsultatif tatap muka dan platform digital yang bisa diakses dari mana saja, kapan saja.', 0);

-- Seed: Services (9 layanan)
INSERT INTO landing_content (section, item_key, item_value, item_order) VALUES
  ('service', 'title', 'Helpdesk OSS', 1),
  ('service', 'description', 'Konsultasi perizinan usaha melalui Online Single Submission. Petugas siap membantu proses NIB dan izin berusaha Anda.', 1),
  ('service', 'icon', 'ClipboardCheck', 1),
  ('service', 'color', 'serviceIconPrimary', 1),

  ('service', 'title', 'Sertifikasi Halal', 2),
  ('service', 'description', 'Pendampingan proses sertifikasi halal untuk produk UMKM. Konsultasi gratis langsung dengan petugas terlatih.', 2),
  ('service', 'icon', 'Shield', 2),
  ('service', 'color', 'serviceIconSuccess', 2),

  ('service', 'title', 'BPJS Kesehatan', 3),
  ('service', 'description', 'Layanan informasi dan bantuan terkait BPJS Kesehatan. Tersedia konsultasi tatap muka dan online.', 3),
  ('service', 'icon', 'HeartHandshake', 3),
  ('service', 'color', 'serviceIconAccent', 3),

  ('service', 'title', 'Matchmaking UMKM', 4),
  ('service', 'description', 'Platform penghubung kebutuhan UMKM — dari bahan baku hingga kemitraan bisnis. Tersedia juga layanan PEMBIAYAAN UMKM.', 4),
  ('service', 'icon', 'Store', 4),
  ('service', 'color', 'serviceIconPrimary', 4),

  ('service', 'title', 'Investment Gallery', 5),
  ('service', 'description', 'Pameran potensi investasi Provinsi Lampung. Dokumen IPRO dan Peta Potensi tersedia untuk dilihat secara daring.', 5),
  ('service', 'icon', 'FileText', 5),
  ('service', 'color', 'serviceIconAccent', 5),

  ('service', 'title', 'Bank Lampung', 6),
  ('service', 'description', 'Layanan perbankan daerah pendukung ekosistem UMKM dan investasi.', 6),
  ('service', 'icon', 'Building2', 6),
  ('service', 'color', 'serviceIconPrimary', 6),

  ('service', 'title', 'Balai Monitor SFR', 7),
  ('service', 'description', 'Pelayanan Balai Monitor Spektrum Frekuensi Radio, meliputi perizinan frekuensi dan sertifikasi alat telekomunikasi.', 7),
  ('service', 'icon', 'Sparkles', 7),
  ('service', 'color', 'serviceIconSuccess', 7),

  ('service', 'title', 'Sertifikasi Mutu Keamanan Hasil Perikanan', 8),
  ('service', 'description', 'Sertifikasi Kelayakan Pengolahan (SKP) produk perikanan untuk menjamin mutu dan keamanan pangan standar ekspor.', 8),
  ('service', 'icon', 'Shield', 8),
  ('service', 'color', 'serviceIconAccent', 8),

  ('service', 'title', 'Layanan Jasa Industri', 9),
  ('service', 'description', 'Layanan sertifikasi SNI, pengujian, dan kalibrasi produk industri.', 9),
  ('service', 'icon', 'FileText', 9),
  ('service', 'color', 'serviceIconPrimary', 9);

-- Trigger: auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_site_settings_updated_at
  BEFORE UPDATE ON site_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_landing_content_updated_at
  BEFORE UPDATE ON landing_content
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
