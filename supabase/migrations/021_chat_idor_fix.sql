-- ============================================================
-- Migration 021: Fase 0 / K2: Fix IDOR pada chat_sesi & chat_pesan
-- ============================================================
-- Sebelumnya (migration 005) chat_sesi & chat_pesan punya RLS:
--   SELECT USING (true)   -> siapa saja baca SEMUA chat
--   INSERT WITH CHECK (true) -> siapa saja sisip pesan ke sesi manapun
-- Komentar "filter by id di client" BUKAN security.
--
-- Migration ini:
--   1. Tambah kolom chat_sesi.pengunjung_id -> pengunjung(id)
--      supaya RLS bisa memverifikasi kepemilikan sesi.
--   2. DROP semua policy lama yang using (true).
--   3. Buat policy baru berbasis kepemilikan:
--        pengunjung hanya akses sesi miliknya
--        (pengunjung.auth_user_id = auth.uid()),
--        petugas/admin akses sesi layanannya.
--   4. Berlaku untuk user Google maupun anon (setelah anon sign-in
--      diaktifkan via Dashboard — di luar kode). Anon tetap dapat
--      auth.uid() dan membuat baris pengunjung sendiri.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tambah kolom pengunjung_id ke chat_sesi
-- ------------------------------------------------------------
ALTER TABLE chat_sesi
  ADD COLUMN pengunjung_id UUID REFERENCES pengunjung(id) ON DELETE SET NULL;

COMMENT ON COLUMN chat_sesi.pengunjung_id IS
  'Pemilik sesi — dipakai RLS untuk verifikasi kepemilikan (pengunjung.auth_user_id = auth.uid()). NULL untuk sesi lama pra-migrasi (hanya admin yang bisa membacanya).';

CREATE INDEX idx_chat_sesi_pengunjung ON chat_sesi(pengunjung_id);


-- ------------------------------------------------------------
-- 2. DROP policy lama yang rentan (USING (true) / WITH CHECK (true))
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chat_sesi_anon_insert" ON chat_sesi;
DROP POLICY IF EXISTS "chat_sesi_anon_select_own" ON chat_sesi;
DROP POLICY IF EXISTS "chat_sesi_petugas_update" ON chat_sesi;
DROP POLICY IF EXISTS "chat_pesan_anon_insert" ON chat_pesan;
DROP POLICY IF EXISTS "chat_pesan_select" ON chat_pesan;


-- ------------------------------------------------------------
-- 3. Policy baru untuk chat_sesi
--    - SELECT: pemilik (pengunjung) ATAU petugas layanan tsb ATAU admin
--    - INSERT: hanya pemilik (pengunjung) untuk dirinya sendiri
--    - UPDATE: petugas layanan tsb ATAU admin
--    Semua di-TO authenticated (anon modern Supabase mendapat
--    auth.uid() dan masuk grup authenticated setelah anon sign-in).
-- ------------------------------------------------------------
CREATE POLICY "chat_sesi_owner_select" ON chat_sesi
  FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );

CREATE POLICY "chat_sesi_owner_insert" ON chat_sesi
  FOR INSERT TO authenticated
  WITH CHECK (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
  );

CREATE POLICY "chat_sesi_petugas_update" ON chat_sesi
  FOR UPDATE TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  )
  WITH CHECK (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );


-- ------------------------------------------------------------
-- 4. Policy baru untuk chat_pesan
--    Akses pesan diturunkan dari kepemilikan sesi induk.
--    - SELECT: pesan dalam sesi yang dipunyai pemilik/petugas/admin
--    - INSERT:
--        * pengunjung menyisip ke sesinya sendiri, ATAU
--        * petugas menyisip (pengirim='petugas') ke sesi layanannya, ATAU
--        * admin ke sesi mana pun
-- ------------------------------------------------------------
CREATE POLICY "chat_pesan_owner_select" ON chat_pesan
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM chat_sesi
      WHERE id = chat_pesan.sesi_id
        AND (
          pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
          OR layanan_id = get_my_layanan_id()
          OR get_my_role() = 'admin'
        )
    )
  );

CREATE POLICY "chat_pesan_owner_insert" ON chat_pesan
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chat_sesi
      WHERE id = chat_pesan.sesi_id
        AND (
          pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
          OR (pengirim = 'petugas' AND layanan_id = get_my_layanan_id())
          OR get_my_role() = 'admin'
        )
    )
  );


-- ============================================================
-- ROLLBACK:
--   -- Drop policy baru
--   DROP POLICY IF EXISTS "chat_sesi_owner_select" ON chat_sesi;
--   DROP POLICY IF EXISTS "chat_sesi_owner_insert" ON chat_sesi;
--   DROP POLICY IF EXISTS "chat_sesi_petugas_update" ON chat_sesi;
--   DROP POLICY IF EXISTS "chat_pesan_owner_select" ON chat_pesan;
--   DROP POLICY IF EXISTS "chat_pesan_owner_insert" ON chat_pesan;
--
--   -- Drop kolom & index
--   DROP INDEX IF EXISTS idx_chat_sesi_pengunjung;
--   ALTER TABLE chat_sesi DROP COLUMN IF EXISTS pengunjung_id;
--
--   -- (BERBAHAYA) Restore policy lama yang rentan — JANGAN dipakai
--   -- kecuali untuk revert darurat. Policy ini memang punya celah
--   -- IDOR yang ditutup migration ini.
--   -- CREATE POLICY "chat_sesi_anon_insert" ON chat_sesi
--   --   FOR INSERT WITH CHECK (true);
--   -- CREATE POLICY "chat_sesi_anon_select_own" ON chat_sesi
--   --   FOR SELECT USING (true);
--   -- CREATE POLICY "chat_sesi_petugas_update" ON chat_sesi
--   --   FOR UPDATE TO authenticated
--   --   USING (layanan_id = get_my_layanan_id() OR get_my_role() = 'admin');
--   -- CREATE POLICY "chat_pesan_anon_insert" ON chat_pesan
--   --   FOR INSERT WITH CHECK (true);
--   -- CREATE POLICY "chat_pesan_select" ON chat_pesan
--   --   FOR SELECT USING (true);
-- ============================================================
