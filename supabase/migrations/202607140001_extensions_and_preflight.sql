-- Production baseline 1/5: required extensions and fail-fast preflight.
BEGIN;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required.name, ', ' ORDER BY required.name)
  INTO missing
  FROM (VALUES ('pgcrypto'), ('vector'), ('pg_cron')) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_extension extension
    WHERE extension.extname = required.name
  );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'LMH baseline requires unavailable PostgreSQL extension(s): %. Enable them in Supabase before retrying.', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_extension extension
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = extension.extnamespace
    WHERE extension.extname = 'vector' AND namespace.nspname = 'extensions'
  ) THEN
    RAISE EXCEPTION 'LMH baseline requires vector in the extensions schema.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'cron'
  ) THEN
    RAISE EXCEPTION 'LMH baseline installed pg_cron but the cron schema is unavailable.';
  END IF;
END
$$;

COMMIT;
