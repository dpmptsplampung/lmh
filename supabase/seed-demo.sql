-- ========================================================
-- HANYA UNTUK DEV/STAGING. JANGAN JALANKAN DI PRODUKSI.
-- Akun demo dengan password lemah untuk testing lokal.
-- ========================================================
--
-- TUJUAN:
--   Menyediakan akun petugas demo (dengan password lemah
--   `password123`) untuk pengembangan lokal / staging.
--
--   File ini DILUAR direktori migrations sehingga TIDAK
--   dijalankan otomatis oleh Supabase. Jalankan manual:
--     supabase db execute --file supabase/seed-demo.sql
--   atau paste di SQL Editor Supabase Studio (instance lokal).
--
-- PERINGATAN:
--   - JANGAN pernah menjalankan di produksi.
--   - Password `password123` hanya aman di lingkungan terisolasi.
--   - Akun produksi harus dibuat via invite Route Handler:
--       POST /api/admin/petugas/invite
--   - Migration 023 menghapus akun hardcode dari history migrations;
--     file ini menggantikan kebutuhan seeding di dev.
-- ========================================================

DO $$
DECLARE
    v_oss_id UUID := gen_random_uuid();
    v_halal_id UUID := gen_random_uuid();
    v_bpjs_id UUID := gen_random_uuid();
    v_bank_id UUID := gen_random_uuid();
    v_umkm_id UUID := gen_random_uuid();
    v_gallery_id UUID := gen_random_uuid();
    v_balmon_id UUID := gen_random_uuid();
    v_perikanan_id UUID := gen_random_uuid();
    v_industri_id UUID := gen_random_uuid();

    v_layanan_oss UUID;
    v_layanan_halal UUID;
    v_layanan_bpjs UUID;
    v_layanan_bank UUID;
    v_layanan_umkm UUID;
    v_layanan_gallery UUID;
    v_layanan_balmon UUID;
    v_layanan_perikanan UUID;
    v_layanan_industri UUID;
BEGIN
    -- Dapatkan ID Layanan
    SELECT id INTO v_layanan_oss FROM layanan WHERE nama = 'Helpdesk OSS' LIMIT 1;
    SELECT id INTO v_layanan_halal FROM layanan WHERE nama = 'Sertifikasi Halal' LIMIT 1;
    SELECT id INTO v_layanan_bpjs FROM layanan WHERE nama = 'BPJS Kesehatan' LIMIT 1;
    SELECT id INTO v_layanan_bank FROM layanan WHERE nama = 'Bank Lampung' LIMIT 1;
    SELECT id INTO v_layanan_umkm FROM layanan WHERE nama = 'Matchmaking UMKM' LIMIT 1;
    SELECT id INTO v_layanan_gallery FROM layanan WHERE nama = 'Investment Gallery' LIMIT 1;
    SELECT id INTO v_layanan_balmon FROM layanan WHERE nama = 'BALMON' LIMIT 1;
    SELECT id INTO v_layanan_perikanan FROM layanan WHERE nama = 'Sertifikasi Mutu Keamanan Hasil Perikanan' LIMIT 1;
    SELECT id INTO v_layanan_industri FROM layanan WHERE nama = 'Layanan Jasa Industri' LIMIT 1;

    -- Insert ke auth.users (idempoten: skip jika email sudah ada)
    INSERT INTO auth.users (id, instance_id, aud, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, created_at, updated_at)
    VALUES
    (v_oss_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'oss@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_halal_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'halal@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_bpjs_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'bpjs@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_bank_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'banklampung@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_umkm_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'umkm@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_gallery_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'gallery@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_balmon_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'balmon@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_perikanan_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'perikanan@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_industri_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'industri@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now())
    ON CONFLICT (email) DO NOTHING;

    -- Insert identities (idempoten)
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    SELECT gen_random_uuid(), id, id::text, format('{"sub":"%s","email":"%s"}', id::text, email)::jsonb, 'email', now(), now(), now()
    FROM auth.users
    WHERE email IN (
      'oss@lmh.go.id','halal@lmh.go.id','bpjs@lmh.go.id',
      'banklampung@lmh.go.id','umkm@lmh.go.id','gallery@lmh.go.id',
      'balmon@lmh.go.id','perikanan@lmh.go.id','industri@lmh.go.id'
    )
    ON CONFLICT DO NOTHING;

    -- Insert ke petugas (idempoten)
    INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role)
    SELECT u.id, 'Petugas ' || split_part(u.email, '@', 1), l.id, 'petugas'
    FROM auth.users u
    LEFT JOIN layanan l ON l.nama = CASE u.email
      WHEN 'oss@lmh.go.id' THEN 'Helpdesk OSS'
      WHEN 'halal@lmh.go.id' THEN 'Sertifikasi Halal'
      WHEN 'bpjs@lmh.go.id' THEN 'BPJS Kesehatan'
      WHEN 'banklampung@lmh.go.id' THEN 'Bank Lampung'
      WHEN 'umkm@lmh.go.id' THEN 'Matchmaking UMKM'
      WHEN 'gallery@lmh.go.id' THEN 'Investment Gallery'
      WHEN 'balmon@lmh.go.id' THEN 'BALMON'
      WHEN 'perikanan@lmh.go.id' THEN 'Sertifikasi Mutu Keamanan Hasil Perikanan'
      WHEN 'industri@lmh.go.id' THEN 'Layanan Jasa Industri'
    END
    WHERE u.email IN (
      'oss@lmh.go.id','halal@lmh.go.id','bpjs@lmh.go.id',
      'banklampung@lmh.go.id','umkm@lmh.go.id','gallery@lmh.go.id',
      'balmon@lmh.go.id','perikanan@lmh.go.id','industri@lmh.go.id'
    )
    ON CONFLICT (auth_user_id) DO NOTHING;
END $$;

-- ========================================================
-- B4: Demo investment documents (Unsplash URLs) — DEV/STAGING ONLY
-- ========================================================
-- Dipindahkan dari migration 017 (yang sudah historical/applied).
-- Instance baru tidak akan mendapat demo data ini dari migration;
-- jalankan file ini secara manual di dev/staging jika ingin gallery
-- tidak kosong:
--   supabase db execute --file supabase/seed-demo.sql
-- ========================================================

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Kawasan Industri Way Kanan (KIWK)', 'Manufaktur & Industri', 1, 'demo/kiwk.pdf', 24, 'aktif',
   'Pengembangan kawasan industri manufaktur terintegrasi seluas 500 Hektar untuk menampung industri hilir komoditas perkebunan.',
   'Rp 2.4 Triliun',
   'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Bakauheni Harbour City (BHC)', 'Pariwisata & Jasa', 2, 'demo/bhc.pdf', 18, 'aktif',
   'Pengembangan kawasan pariwisata terpadu skala internasional di gerbang pulau Sumatera (Pelabuhan Bakauheni).',
   'Rp 4.2 Triliun',
   'https://images.unsplash.com/photo-1559589689-577aabd1ce4c?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('PLTSa Bakung Bandar Lampung', 'Infrastruktur & Energi', 3, 'demo/pltsa.pdf', 32, 'aktif',
   'Proyek pengelolaan sampah perkotaan menjadi energi listrik ramah lingkungan berkapasitas 15 MW.',
   'Rp 650 Miliar',
   'https://images.unsplash.com/photo-1532601224476-15c79f2f7a51?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Kawasan Terpadu Pariwisata Teluk Kiluan', 'Pariwisata & Jasa', 4, 'demo/kiluan.pdf', 20, 'aktif',
   'Pengembangan resort dan fasilitas ekowisata pengamatan lumba-lumba berstandar internasional.',
   'Rp 850 Miliar',
   'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Agroindustri Nanas Terpadu Lampung Tengah', 'Pertanian & Pangan', 5, 'demo/nanas.pdf', 28, 'aktif',
   'Pembangunan pabrik pengolahan nanas kaleng dan konsentrat untuk pasar ekspor Timur Tengah.',
   'Rp 1.2 Triliun',
   'https://images.unsplash.com/photo-1550828520-4cb496926fc9?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Revitalisasi Tambak Udang Dipasena', 'Perikanan & Kelautan', 6, 'demo/dipasena.pdf', 40, 'aktif',
   'Modernisasi infrastruktur pertambakan dan penerapan teknologi smart aquaculture di Tulang Bawang.',
   'Rp 3.5 Triliun',
   'https://images.unsplash.com/photo-1615462575791-76495ff246a4?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('KEK Industri Karet Tulang Bawang', 'Manufaktur & Industri', 7, 'demo/karet.pdf', 45, 'aktif',
   'Kawasan Ekonomi Khusus yang difokuskan pada hilirisasi produk karet spesifikasi tinggi dan ban.',
   'Rp 5.1 Triliun',
   'https://images.unsplash.com/photo-1605374828131-0cfd80cbcd7b?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Ekspansi PLTP Ulubelu Unit 5 & 6', 'Infrastruktur & Energi', 8, 'demo/pltp.pdf', 36, 'aktif',
   'Pembangunan pembangkit listrik tenaga panas bumi tambahan untuk mendukung ketahanan energi hijau.',
   'Rp 2.8 Triliun',
   'https://images.unsplash.com/photo-1466611653911-95081537e5b7?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;

INSERT INTO investment_documents (judul, kategori, urutan_tampil, file_path, jumlah_halaman, status, deskripsi, nilai_investasi, image_url) VALUES
  ('Pengembangan Terminal Petikemas Panjang', 'Infrastruktur & Logistik', 9, 'demo/panjang.pdf', 22, 'aktif',
   'Peningkatan kapasitas terminal petikemas pelabuhan internasional Panjang menjadi 1 juta TEUs.',
   'Rp 1.9 Triliun',
   'https://images.unsplash.com/photo-1586528116311-ad8ed745eb33?auto=format&fit=crop&q=80&w=800')
  ON CONFLICT DO NOTHING;
