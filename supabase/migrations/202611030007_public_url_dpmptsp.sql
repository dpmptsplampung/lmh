-- Domain publik yang benar adalah lmh.dpmptsp.web.id. Seed lama mengisi site_settings.public_url dengan
-- https://lmh.lampungprov.go.id (dan fungsi pembuat tautan memakai nilai itu sebagai fallback), sehingga tautan survei di email
-- dan push mengarah ke domain yang salah. Migrasi ini hanya mengganti nilai yang kosong atau masih domain lama; nilai lain
-- yang sengaja diatur admin tidak disentuh. Idempotent.
INSERT INTO public.site_settings (key, value) VALUES ('public_url', 'https://lmh.dpmptsp.web.id')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now()
  WHERE public.site_settings.value IS NULL
     OR btrim(public.site_settings.value) = ''
     OR public.site_settings.value ~* '^https?://lmh\.lampungprov\.go\.id/?$';
