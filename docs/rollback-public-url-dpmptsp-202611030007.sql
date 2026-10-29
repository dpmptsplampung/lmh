-- Rollback 202611030007: kembalikan public_url ke nilai seed lama (hanya bila masih nilai yang ditetapkan migrasi ini).
UPDATE public.site_settings SET value = 'https://lmh.lampungprov.go.id', updated_at = now()
WHERE key = 'public_url' AND value = 'https://lmh.dpmptsp.web.id';
