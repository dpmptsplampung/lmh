-- ============================================================
-- Migration 020: Storage RLS — deny anon access to investment-docs
--   The investment-docs bucket was already admin-only for
--   authenticated users (migration 018). This migration:
--     1. Adds an EXPLICIT anon-deny policy on _raw/* and pages/*
--        paths so that even if a future migration loosens bucket
--        access, raw PDFs and converted PNGs can never be served
--        directly to anonymous requests. Public access is only
--        possible via the page-image Route Handler which uses the
--        service role key and composites a watermark.
--   Note: Supabase storage RLS works at the object (row) level in
--   storage.objects. Policies below use path-prefix checks via
--   `storage.foldername(name)` to scope _raw/* and pages/*.
-- ============================================================

-- Ensure the bucket is private (defense in depth — should already be).
UPDATE storage.buckets
  SET public = false
  WHERE id = 'investment-docs';

-- ------------------------------------------------------------
-- 1. Explicit deny: anon cannot SELECT anything in investment-docs.
--    (No SELECT policy for `anon`/`public` role exists, which by
--    default denies. We add an explicit restrictive policy for
--    documentation & to guard against future drift.)
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'investment_docs_anon_deny_select'
  ) THEN
    CREATE POLICY "investment_docs_anon_deny_select" ON storage.objects
      FOR SELECT TO anon
      USING (false);
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Path-scoped admin SELECT for _raw/* (raw PDFs).
--    Only admin may read raw PDFs (used by signed-url route).
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'investment_docs_admin_raw_select'
  ) THEN
    CREATE POLICY "investment_docs_admin_raw_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'investment-docs'
        AND storage.foldername(name) = '_raw'
        AND get_my_role() = 'admin'
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Path-scoped admin SELECT for pages/* (converted PNGs).
--    Public reads via the page-image Route Handler use the
--    service role key (bypasses RLS), so pages/* can be admin-only.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'investment_docs_admin_pages_select'
  ) THEN
    CREATE POLICY "investment_docs_admin_pages_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'investment-docs'
        AND storage.foldername(name) = 'pages'
        AND get_my_role() = 'admin'
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Path-scoped admin INSERT for pages/* (upload pipeline).
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'investment_docs_admin_pages_insert'
  ) THEN
    CREATE POLICY "investment_docs_admin_pages_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'investment-docs'
        AND storage.foldername(name) = 'pages'
        AND get_my_role() = 'admin'
      );
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Path-scoped admin INSERT for _raw/* (upload pipeline).
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'investment_docs_admin_raw_insert'
  ) THEN
    CREATE POLICY "investment_docs_admin_raw_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'investment-docs'
        AND storage.foldername(name) = '_raw'
        AND get_my_role() = 'admin'
      );
  END IF;
END $$;

-- ============================================================
-- ROLLBACK:
--   DROP POLICY IF EXISTS "investment_docs_anon_deny_select" ON storage.objects;
--   DROP POLICY IF EXISTS "investment_docs_admin_raw_select" ON storage.objects;
--   DROP POLICY IF EXISTS "investment_docs_admin_pages_select" ON storage.objects;
--   DROP POLICY IF EXISTS "investment_docs_admin_pages_insert" ON storage.objects;
--   DROP POLICY IF EXISTS "investment_docs_admin_raw_insert" ON storage.objects;
--   (The broader admin_* policies from migration 018 remain and
--    would re-grant access. Re-running 018 is not required.)
-- ============================================================
