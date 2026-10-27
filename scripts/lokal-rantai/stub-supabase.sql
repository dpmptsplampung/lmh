-- Stub infrastruktur Supabase untuk menerapkan SELURUH rantai migrasi LMH di PGlite (Postgres dalam-proses).
-- Hanya infrastruktur yang bukan milik LMH: role, schema auth/storage/cron/extensions, publikasi realtime.
-- BUKAN replika penuh; lihat scripts/lokal-rantai/README.md untuk batasnya.
SET check_function_bodies = off;

CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
CREATE ROLE authenticator NOLOGIN NOINHERIT;
CREATE ROLE supabase_auth_admin NOLOGIN NOINHERIT;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE SCHEMA auth;
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  raw_app_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_anonymous boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  email_change text, email_change_token_new text, email_change_token_current text,
  email_change_confirm_status smallint, email_change_sent_at timestamptz,
  confirmation_token text, recovery_token text, phone text
);
-- JWT disimulasikan lewat GUC sesi: app.uid (sub), app.jwt (json klaim lain, mis. app_metadata.role, email).
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(pg_catalog.current_setting('app.uid', true), '')::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN NULLIF(pg_catalog.current_setting('app.uid', true), '') IS NULL THEN '{}'::jsonb
    ELSE COALESCE(NULLIF(pg_catalog.current_setting('app.jwt', true), '')::jsonb, '{}'::jsonb)
         || jsonb_build_object('sub', pg_catalog.current_setting('app.uid', true)) END $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT CASE WHEN NULLIF(pg_catalog.current_setting('app.uid', true), '') IS NULL THEN 'anon' ELSE 'authenticated' END $$;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false,
  file_size_limit bigint, allowed_mime_types text[]);
CREATE TABLE storage.objects (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE AS
$$ SELECT string_to_array(name, '/') $$;

CREATE SCHEMA cron;
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text);
CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS
$$ INSERT INTO cron.job (schedule, command) VALUES (schedule, command) RETURNING jobid $$;
CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS
$$ DELETE FROM cron.job WHERE jobid = job_id RETURNING true $$;
CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS
$$ DELETE FROM cron.job WHERE jobname = job_name RETURNING true $$;

CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL) RETURNS void
  LANGUAGE sql AS $$ SELECT 1 $$;

CREATE SCHEMA realtime;
CREATE TABLE realtime.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic text, extension text,
  payload jsonb, event text, private boolean DEFAULT false, inserted_at timestamptz DEFAULT now());
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
  RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;
CREATE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(pg_catalog.current_setting('realtime.topic', true), '') $$;

CREATE PUBLICATION supabase_realtime;

GRANT USAGE ON SCHEMA public, auth, extensions, storage, realtime TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt(), auth.role() TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA storage TO service_role;
GRANT SELECT ON storage.objects, storage.buckets TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

-- pgvector tidak tersedia di PGlite: tipe vector disimulasikan sebagai array float8 (operator jarak TIDAK ada).
CREATE DOMAIN extensions.vector AS float8[];
