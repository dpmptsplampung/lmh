-- Production-safe reference and configuration data only.
BEGIN;

INSERT INTO public.layanan (nama, tipe, chatbot_aktif) VALUES
  ('Helpdesk OSS', 'konsultatif', false),
  ('Sertifikasi Halal', 'konsultatif', false),
  ('BPJS Kesehatan', 'konsultatif', false),
  ('Bank Lampung', 'mitra', false),
  ('Matchmaking UMKM', 'modul_publik', false),
  ('Investment Gallery', 'modul_publik', false),
  ('BALMON', 'mitra', true),
  ('Sertifikasi Mutu Keamanan Hasil Perikanan', 'konsultatif', true),
  ('Layanan Jasa Industri', 'konsultatif', true),
  ('Layanan Perizinan DPMPTSP Provinsi Lampung', 'konsultatif', false)
ON CONFLICT (nama) DO UPDATE SET
  tipe = EXCLUDED.tipe,
  chatbot_aktif = EXCLUDED.chatbot_aktif;

INSERT INTO public.site_settings (key, value) VALUES
  ('foila_url', 'https://invest.lampungprov.go.id/'),
  ('public_url', 'https://lmh.lampungprov.go.id'),
  ('wa_default_message', 'Halo, saya ingin bertanya tentang layanan DPMPTSP Provinsi Lampung.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.landing_content (section, item_key, item_value, item_order) VALUES
  ('hero', 'badge_text', 'DPMPTSP Provinsi Lampung', 0),
  ('hero', 'description', 'Hub digital layanan perizinan, kemitraan UMKM, dan investasi Provinsi Lampung.', 0),
  ('hero', 'cta_primary_text', 'Rencanakan Kedatangan', 0),
  ('hero', 'cta_primary_link', '/me/reservasi', 0),
  ('cta', 'title', 'Siap Berkunjung?', 0),
  ('cta', 'description', 'Rencanakan kedatangan untuk mempercepat pelayanan di DPMPTSP Provinsi Lampung.', 0),
  ('cta', 'button_text', 'Rencanakan Kedatangan', 0),
  ('cta', 'button_link', '/me/reservasi', 0),
  ('footer', 'copyright', 'DPMPTSP Provinsi Lampung. Hak cipta dilindungi.', 0),
  ('section_header', 'label', 'Layanan Kami', 0),
  ('section_header', 'title', '9 Layanan dalam Satu Atap', 0),
  ('section_header', 'description', 'Layanan konsultatif, mitra, dan modul publik dalam satu platform.', 0)
ON CONFLICT (section, item_key, item_order) DO UPDATE SET
  item_value = EXCLUDED.item_value,
  is_active = true,
  updated_at = now();

COMMIT;
