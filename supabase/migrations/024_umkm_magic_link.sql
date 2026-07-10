-- ============================================================
-- Fase 0 / K5: Magic-link edit UMKM via Supabase Auth
-- ============================================================
-- listing_umkm.edit_token (migration 006) tidak pernah divalidasi
-- server-side (Edge Function umkm-edit tidak pernah dibangun).
-- Migration ini mengganti alur edit-token dengan magic-link via
-- Supabase Auth: pemilik listing request link edit → klik email
-- → dapat session → UPDATE via RLS owner-scoped.
--
-- Perubahan:
--   1. Tabel umkm_listing_owner: mapping listing_id ↔ email pemilik.
--   2. RLS pada umkm_listing_owner (owner bisa SELECT row-nya sendiri,
--      admin ALL).
--   3. Policy SELECT baru pada listing_umkm untuk owner (selain
--      policy listing_public_read yang sudah ada — owner bisa lihat
--      listing draft/pending_review miliknya).
--   4. Policy UPDATE baru pada listing_umkm untuk owner + admin.
--      Owner TIDAK boleh set status='published' (butuh approval
--      admin — alur yang sudah ada dipertahankan).
--   5. Backfill umkm_listing_owner dari listing_umkm.kontak_email.
--   6. edit_token TIDAK di-drop (deprecated, harmless). Akan
--      di-drop di migration mendatang setelah magic-link stabil
--      di produksi.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel umkm_listing_owner
-- ------------------------------------------------------------
CREATE TABLE umkm_listing_owner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listing_umkm(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, email)
);

CREATE INDEX idx_umkm_owner_email ON umkm_listing_owner(email);


-- ------------------------------------------------------------
-- 2. RLS pada umkm_listing_owner
--    Owner bisa SELECT row-nya sendiri (email = auth email).
--    Admin ALL. Tidak ada INSERT/UPDATE/DELETE langsung untuk
--    owner — mapping dibuat oleh sistem (route handler / admin).
-- ------------------------------------------------------------
ALTER TABLE umkm_listing_owner ENABLE ROW LEVEL SECURITY;

CREATE POLICY "umkm_owner_select_own" ON umkm_listing_owner
  FOR SELECT TO authenticated
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR get_my_role() = 'admin'
  );

CREATE POLICY "umkm_owner_admin_all" ON umkm_listing_owner
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');


-- ------------------------------------------------------------
-- 3. Policy SELECT baru pada listing_umkm untuk owner
--    (listing_public_read yang ada hanya mengizinkan
--    status='published'. Owner perlu lihat draft /
--    pending_review miliknya untuk diedit.)
-- ------------------------------------------------------------
CREATE POLICY "listing_umkm_select_own" ON listing_umkm
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = listing_umkm.id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  );


-- ------------------------------------------------------------
-- 4. Policy UPDATE pada listing_umkm untuk owner + admin
--    Owner boleh UPDATE listing miliknya, TAPI tidak boleh
--    set status='published' (approval admin). WITH CHECK
--    memaksa status != 'published' untuk non-admin.
-- ------------------------------------------------------------
CREATE POLICY "listing_umkm_update_own" ON listing_umkm
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = listing_umkm.id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  )
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM umkm_listing_owner
        WHERE listing_id = listing_umkm.id
          AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
      )
      OR get_my_role() = 'admin'
    )
    AND (status NOT IN ('published') OR get_my_role() = 'admin')
  );


-- ------------------------------------------------------------
-- 5. Backfill umkm_listing_owner dari listing_umkm.kontak_email
-- ------------------------------------------------------------
INSERT INTO umkm_listing_owner (listing_id, email)
SELECT id, kontak_email FROM listing_umkm
WHERE kontak_email IS NOT NULL
  AND kontak_email != ''
ON CONFLICT (listing_id, email) DO NOTHING;


-- ------------------------------------------------------------
-- 6. Tandai edit_token sebagai deprecated (column comment).
--    TIDAK di-drop di migration ini — akan di-drop setelah
--    magic-link terverifikasi di produksi.
-- ------------------------------------------------------------
COMMENT ON COLUMN listing_umkm.edit_token IS 'DEPRECATED (K5): tidak lagi divalidasi. Edit UMKM via magic-link Supabase Auth + RLS owner. Akan di-drop di migration mendatang.';


-- ============================================================
-- ROLLBACK:
--   DROP POLICY IF EXISTS "listing_umkm_update_own" ON listing_umkm;
--   DROP POLICY IF EXISTS "listing_umkm_select_own" ON listing_umkm;
--   DROP POLICY IF EXISTS "umkm_owner_admin_all" ON umkm_listing_owner;
--   DROP POLICY IF EXISTS "umkm_owner_select_own" ON umkm_listing_owner;
--   ALTER TABLE umkm_listing_owner DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS umkm_listing_owner;
--   COMMENT ON COLUMN listing_umkm.edit_token IS 'Token unik per listing, divalidasi server-side via Edge Function';
-- ============================================================
