-- ============================================================
-- Migration 018: Storage Buckets (Investment Docs + UMKM Photos)
-- ============================================================

-- ------------------------------------------------------------
-- 1. Private bucket: investment-docs
--    Untuk file PDF Investment Gallery. Akses publik HANYA
--    via signed URL yang di-generate server-side.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'investment-docs') THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('investment-docs', 'investment-docs', false);
  END IF;
END $$;

-- Policies: admin-only (SELECT, INSERT, UPDATE, DELETE)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'investment_docs_admin_select'
  ) THEN
    CREATE POLICY "investment_docs_admin_select" ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'investment-docs' AND get_my_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'investment_docs_admin_insert'
  ) THEN
    CREATE POLICY "investment_docs_admin_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'investment-docs' AND get_my_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'investment_docs_admin_update'
  ) THEN
    CREATE POLICY "investment_docs_admin_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'investment-docs' AND get_my_role() = 'admin')
      WITH CHECK (bucket_id = 'investment-docs' AND get_my_role() = 'admin');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'investment_docs_admin_delete'
  ) THEN
    CREATE POLICY "investment_docs_admin_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'investment-docs' AND get_my_role() = 'admin');
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Public bucket: umkm-photos
--    Untuk foto produk UMKM. Public read, write oleh
--    admin/petugas saja.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'umkm-photos') THEN
    INSERT INTO storage.buckets (id, name, public) VALUES ('umkm-photos', 'umkm-photos', true);
  END IF;
END $$;

-- Policies: public SELECT, admin/petugas INSERT/UPDATE/DELETE
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'umkm_photos_public_select'
  ) THEN
    CREATE POLICY "umkm_photos_public_select" ON storage.objects
      FOR SELECT USING (bucket_id = 'umkm-photos');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'umkm_photos_staff_insert'
  ) THEN
    CREATE POLICY "umkm_photos_staff_insert" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'umkm-photos' AND get_my_role() IN ('admin', 'petugas'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'umkm_photos_staff_update'
  ) THEN
    CREATE POLICY "umkm_photos_staff_update" ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'umkm-photos' AND get_my_role() IN ('admin', 'petugas'))
      WITH CHECK (bucket_id = 'umkm-photos' AND get_my_role() IN ('admin', 'petugas'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'umkm_photos_staff_delete'
  ) THEN
    CREATE POLICY "umkm_photos_staff_delete" ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'umkm-photos' AND get_my_role() IN ('admin', 'petugas'));
  END IF;
END $$;
