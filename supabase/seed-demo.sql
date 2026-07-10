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
