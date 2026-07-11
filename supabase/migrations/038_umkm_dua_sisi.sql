-- ============================================================
-- Migration 038: Inovasi #7 — Marketplace UMKM dua sisi
-- ============================================================
-- Sebelumnya (migration 006) listing_umkm hanya merekam
-- "kebutuhan" UMKM (satu sisi). Inovasi #7 menjadikannya dua
-- sisi: sebuah listing bisa berupa 'kebutuhan' (mencari) atau
-- 'penawaran' (menyediakan). Pengunjung dapat mengirim pesan
-- (inquiry) ke pemilik listing tanpa melihat kontak mentah
-- pemilik — kontak hanya dibuka setelah pemilik menyetujui
-- (approve) inquiry lewat inbox (alur magic-link K5).
--
-- Perubahan:
--   1. Kolom listing_umkm.sisi (default 'kebutuhan' supaya
--      listing yang ada dianggap kebutuhan — perilaku lama).
--   2. Tabel umkm_inquiry: pesan dari pengunjung ke pemilik
--      listing. Status pending/approved/rejected.
--   3. RLS pada umkm_inquiry:
--      - INSERT: authenticated + rate-limit (check_anon_rate
--        'umkm_inquiry', 5/jam). Petugas/admin di-exempt.
--      - SELECT/UPDATE: pemilik listing (via umkm_listing_owner
--        join) atau admin.
--   4. View v_umkm_match: pasangan kebutuhan + penawaran
--      dalam kategori yang sama (keduanya published).
--   5. Trigger updated_at pada umkm_inquiry (reuse
--      update_updated_at_column() dari migration 016).
--
-- Prasyarat:
--   - listing_umkm (migration 006)
--   - umkm_listing_owner (migration 024 / K5)
--   - check_anon_rate() + log_anon_action() (migration 022)
--   - update_updated_at_column() (migration 016)
--   - get_my_role() (migration 003)
-- ============================================================


-- ------------------------------------------------------------
-- 1. Kolom sisi pada listing_umkm
-- ------------------------------------------------------------
ALTER TABLE listing_umkm ADD COLUMN sisi TEXT NOT NULL DEFAULT 'kebutuhan'
  CHECK (sisi IN ('kebutuhan', 'penawaran'));

COMMENT ON COLUMN listing_umkm.sisi IS
  'Sisi marketplace dua sisi (Inovasi #7): '
  '''kebutuhan'' = UMKM mencari (default, perilaku lama), '
  '''penawaran'' = UMKM menyediakan. '
  'Kontak pemilik TIDAK ditampilkan di UI publik; pengunjung '
  'mengirim inquiry via umkm_inquiry, pemilik approve via inbox '
  'magic-link (K5).';


-- ------------------------------------------------------------
-- 2. Tabel umkm_inquiry
-- ------------------------------------------------------------
CREATE TABLE umkm_inquiry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listing_umkm(id) ON DELETE CASCADE,
  from_email TEXT NOT NULL,
  from_nama TEXT,
  pesan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_umkm_inquiry_listing ON umkm_inquiry(listing_id);
CREATE INDEX idx_umkm_inquiry_status ON umkm_inquiry(status);
CREATE INDEX idx_umkm_inquiry_created_at ON umkm_inquiry(created_at DESC);

COMMENT ON TABLE umkm_inquiry IS
  'Pesan dari pengunjung ke pemilik listing UMKM (Inovasi #7). '
  'Kontak pemilik tidak terekspos publik; pemilik menyetujui '
  '(approve) inquiry lewat inbox magic-link (K5) sebelum kontak '
  'dibuka.';


-- ------------------------------------------------------------
-- 3. Trigger updated_at pada umkm_inquiry
--    Reuse update_updated_at_column() dari migration 016.
-- ------------------------------------------------------------
CREATE TRIGGER trg_umkm_inquiry_updated
  BEFORE UPDATE ON umkm_inquiry
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ------------------------------------------------------------
-- 4. RLS pada umkm_inquiry
-- ------------------------------------------------------------
ALTER TABLE umkm_inquiry ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated, rate-limited 5/jam. Petugas/admin exempt.
-- from_email wajib non-empty (validasi format email dilakukan
-- route-side via zod; di sini cukup panjang > 0).
CREATE POLICY "umkm_inquiry_insert" ON umkm_inquiry
  FOR INSERT TO authenticated
  WITH CHECK (
    length(trim(from_email)) > 0
    AND (
      get_my_role() IN ('petugas', 'admin')
      OR check_anon_rate('umkm_inquiry', 5, 3600)
    )
  );

-- SELECT: pemilik listing (via umkm_listing_owner join) atau admin.
CREATE POLICY "umkm_inquiry_select_owner" ON umkm_inquiry
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = umkm_inquiry.listing_id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  );

-- UPDATE: pemilik listing (approve/reject) atau admin.
CREATE POLICY "umkm_inquiry_update_owner" ON umkm_inquiry
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = umkm_inquiry.listing_id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = umkm_inquiry.listing_id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  );


-- ------------------------------------------------------------
-- 5. Trigger AFTER INSERT untuk log ke anon_rate_limit
--    (reuse log_anon_action() dari migration 022).
-- ------------------------------------------------------------
CREATE TRIGGER trg_log_umkm_inquiry_insert
  AFTER INSERT ON umkm_inquiry
  FOR EACH ROW EXECUTE FUNCTION log_anon_action('umkm_inquiry');


-- ------------------------------------------------------------
-- 6. View v_umkm_match — pasangan kebutuhan + penawaran
--    dalam kategori yang sama (keduanya published).
-- ------------------------------------------------------------
CREATE VIEW v_umkm_match AS
SELECT
  k.id AS kebutuhan_id,
  k.nama_umkm AS kebutuhan_nama,
  k.kategori_kebutuhan AS kategori,
  k.deskripsi AS kebutuhan_deskripsi,
  p.id AS penawaran_id,
  p.nama_umkm AS penawaran_nama,
  p.deskripsi AS penawaran_deskripsi
FROM listing_umkm k
JOIN listing_umkm p
  ON p.kategori_kebutuhan = k.kategori_kebutuhan
  AND p.sisi = 'penawaran'
  AND p.status = 'published'
WHERE k.sisi = 'kebutuhan'
  AND k.status = 'published';

COMMENT ON VIEW v_umkm_match IS
  'Mesin pencocokan UMKM dua sisi (Inovasi #7): pasangan '
  'kebutuhan + penawaran dalam kategori yang sama, kedua-duanya '
  'published. Match kategori eksak (simple v1).';


-- ============================================================
-- ROLLBACK:
--   DROP VIEW IF EXISTS v_umkm_match;
--   DROP TRIGGER IF EXISTS trg_log_umkm_inquiry_insert ON umkm_inquiry;
--   DROP POLICY IF EXISTS "umkm_inquiry_update_owner" ON umkm_inquiry;
--   DROP POLICY IF EXISTS "umkm_inquiry_select_owner" ON umkm_inquiry;
--   DROP POLICY IF EXISTS "umkm_inquiry_insert" ON umkm_inquiry;
--   ALTER TABLE umkm_inquiry DISABLE ROW LEVEL SECURITY;
--   DROP TRIGGER IF EXISTS trg_umkm_inquiry_updated ON umkm_inquiry;
--   DROP TABLE IF EXISTS umkm_inquiry;
--   ALTER TABLE listing_umkm DROP COLUMN IF EXISTS sisi;
-- ============================================================
