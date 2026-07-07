-- ============================================================
-- Migration 015: Menambahkan Layanan Eksternal Baru & Akun CS
-- ============================================================

-- 1. Tambah Layanan Baru
INSERT INTO layanan (nama, chatbot_aktif) VALUES 
('BALMON', true),
('Sertifikasi Mutu Keamanan Hasil Perikanan', true),
('Layanan Jasa Industri', true)
ON CONFLICT (nama) DO NOTHING;

-- 2. Buat Akun CS untuk Layanan Baru
DO $$
DECLARE
    v_balmon_id UUID := gen_random_uuid();
    v_perikanan_id UUID := gen_random_uuid();
    v_industri_id UUID := gen_random_uuid();

    v_layanan_balmon UUID;
    v_layanan_perikanan UUID;
    v_layanan_industri UUID;
BEGIN
    -- Ambil ID layanan yang baru dibuat
    SELECT id INTO v_layanan_balmon FROM layanan WHERE nama = 'BALMON' LIMIT 1;
    SELECT id INTO v_layanan_perikanan FROM layanan WHERE nama = 'Sertifikasi Mutu Keamanan Hasil Perikanan' LIMIT 1;
    SELECT id INTO v_layanan_industri FROM layanan WHERE nama = 'Layanan Jasa Industri' LIMIT 1;

    -- Pastikan layanan ditemukan
    IF v_layanan_balmon IS NOT NULL AND v_layanan_perikanan IS NOT NULL AND v_layanan_industri IS NOT NULL THEN
        -- Cek apakah user sudah ada (jika script di-run ulang)
        IF NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'balmon@lmh.go.id') THEN
            -- Insert ke auth.users
            INSERT INTO auth.users (id, instance_id, aud, email, encrypted_password, email_confirmed_at, role, raw_app_meta_data, created_at, updated_at)
            VALUES
            (v_balmon_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'balmon@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
            (v_perikanan_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'perikanan@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now()),
            (v_industri_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'industri@lmh.go.id', crypt('password123', gen_salt('bf')), now(), 'authenticated', '{"provider": "email", "providers": ["email"]}', now(), now());

            -- Insert ke auth.identities
            INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
            VALUES
            (gen_random_uuid(), v_balmon_id, v_balmon_id::text, format('{"sub":"%s","email":"%s"}', v_balmon_id::text, 'balmon@lmh.go.id')::jsonb, 'email', now(), now(), now()),
            (gen_random_uuid(), v_perikanan_id, v_perikanan_id::text, format('{"sub":"%s","email":"%s"}', v_perikanan_id::text, 'perikanan@lmh.go.id')::jsonb, 'email', now(), now(), now()),
            (gen_random_uuid(), v_industri_id, v_industri_id::text, format('{"sub":"%s","email":"%s"}', v_industri_id::text, 'industri@lmh.go.id')::jsonb, 'email', now(), now(), now());

            -- Insert ke petugas
            INSERT INTO public.petugas (auth_user_id, nama, layanan_id, role)
            VALUES
            (v_balmon_id, 'Petugas BALMON', v_layanan_balmon, 'petugas'),
            (v_perikanan_id, 'Petugas SKP Perikanan', v_layanan_perikanan, 'petugas'),
            (v_industri_id, 'Petugas Jasa Industri', v_layanan_industri, 'petugas');
        END IF;
    END IF;
END $$;
