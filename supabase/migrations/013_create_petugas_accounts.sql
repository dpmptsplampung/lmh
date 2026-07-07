-- ========================================================
-- MIGRATION: 013_create_petugas_accounts
-- Description: Create default CS accounts for each service
-- Default password for all: password123
-- ========================================================

DO $$
DECLARE
    v_oss_id UUID := gen_random_uuid();
    v_halal_id UUID := gen_random_uuid();
    v_bpjs_id UUID := gen_random_uuid();
    v_bank_id UUID := gen_random_uuid();
    v_umkm_id UUID := gen_random_uuid();
    v_gallery_id UUID := gen_random_uuid();

    v_layanan_oss UUID;
    v_layanan_halal UUID;
    v_layanan_bpjs UUID;
    v_layanan_bank UUID;
    v_layanan_umkm UUID;
    v_layanan_gallery UUID;
BEGIN
    -- Dapatkan ID Layanan
    SELECT id INTO v_layanan_oss FROM layanan WHERE nama = 'Helpdesk OSS' LIMIT 1;
    SELECT id INTO v_layanan_halal FROM layanan WHERE nama = 'Sertifikasi Halal' LIMIT 1;
    SELECT id INTO v_layanan_bpjs FROM layanan WHERE nama = 'BPJS Kesehatan' LIMIT 1;
    SELECT id INTO v_layanan_bank FROM layanan WHERE nama = 'Bank Lampung' LIMIT 1;
    SELECT id INTO v_layanan_umkm FROM layanan WHERE nama = 'Matchmaking UMKM' LIMIT 1;
    SELECT id INTO v_layanan_gallery FROM layanan WHERE nama = 'Investment Gallery' LIMIT 1;

    -- Insert ke auth.users
    INSERT INTO auth.users (id, instance_id, aud, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, created_at, updated_at)
    VALUES
    (v_oss_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'oss@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_halal_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'halal@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_bpjs_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'bpjs@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_bank_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'banklampung@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_umkm_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'umkm@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
    (v_gallery_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'gallery@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now());

    -- Insert identities (required by Supabase to allow login)
    INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES
    (gen_random_uuid(), v_oss_id, v_oss_id::text, format('{"sub":"%s","email":"%s"}', v_oss_id::text, 'oss@lmh.go.id')::jsonb, 'email', now(), now(), now()),
    (gen_random_uuid(), v_halal_id, v_halal_id::text, format('{"sub":"%s","email":"%s"}', v_halal_id::text, 'halal@lmh.go.id')::jsonb, 'email', now(), now(), now()),
    (gen_random_uuid(), v_bpjs_id, v_bpjs_id::text, format('{"sub":"%s","email":"%s"}', v_bpjs_id::text, 'bpjs@lmh.go.id')::jsonb, 'email', now(), now(), now()),
    (gen_random_uuid(), v_bank_id, v_bank_id::text, format('{"sub":"%s","email":"%s"}', v_bank_id::text, 'banklampung@lmh.go.id')::jsonb, 'email', now(), now(), now()),
    (gen_random_uuid(), v_umkm_id, v_umkm_id::text, format('{"sub":"%s","email":"%s"}', v_umkm_id::text, 'umkm@lmh.go.id')::jsonb, 'email', now(), now(), now()),
    (gen_random_uuid(), v_gallery_id, v_gallery_id::text, format('{"sub":"%s","email":"%s"}', v_gallery_id::text, 'gallery@lmh.go.id')::jsonb, 'email', now(), now(), now());

    -- Insert ke petugas
    INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role)
    VALUES
    (v_oss_id, 'Petugas OSS', v_layanan_oss, 'petugas'),
    (v_halal_id, 'Petugas Halal', v_layanan_halal, 'petugas'),
    (v_bpjs_id, 'Petugas BPJS', v_layanan_bpjs, 'petugas'),
    (v_bank_id, 'Petugas Bank Lampung', v_layanan_bank, 'petugas'),
    (v_umkm_id, 'Petugas UMKM', v_layanan_umkm, 'petugas'),
    (v_gallery_id, 'Petugas Investment Gallery', v_layanan_gallery, 'petugas');

END $$;
