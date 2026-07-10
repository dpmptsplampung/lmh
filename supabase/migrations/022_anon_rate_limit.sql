-- ============================================================
-- Migration 022: Fase 0 / K3: Rate limit insert publik via RLS function
-- ============================================================
-- Sebelumnya (migration 003:39-40) kunjungan punya policy:
--   CREATE POLICY "kunjungan_anon_insert" ON kunjungan
--     FOR INSERT WITH CHECK (true);
-- Artinya: siapa saja (anon, tanpa auth) bisa INSERT kunjungan
-- tanpa batas. Setelah anon sign-in diaktifkan, anon users juga
-- bisa spam INSERT ke chat_sesi & chat_pesan (K2 sudah memaksa
-- auth, tapi belum ada rate limit).
--
-- Migration ini:
--   1. Buat tabel anon_rate_limit untuk mencatat insert per user.
--   2. Function check_anon_rate() dipanggil dari WITH CHECK RLS.
--   3. Trigger AFTER INSERT mencatat ke tabel rate limit.
--   4. DROP + recreate policy INSERT untuk kunjungan, chat_sesi,
--      chat_pesan supaya memanggil check_anon_rate().
--   5. Petugas/admin di-exempt (get_my_role() IN ('petugas','admin')).
--   6. kunjungan INSERT sekarang TO authenticated (sebelumnya anon).
--      Halaman check-in harus authenticate user (Google atau anon
--      sign-in) sebelum INSERT — dihandle di src/app/checkin/page.tsx.
--
-- Limit:
--   kunjungan_insert  : 5 / 60 detik / user
--   chat_sesi_insert : 3 / 60 detik / user
--   chat_pesan_insert: 20 / 60 detik / user
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel anon_rate_limit
-- ------------------------------------------------------------
CREATE TABLE anon_rate_limit (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_anon_rate_user_action_time
  ON anon_rate_limit(user_id, action, created_at DESC);


-- ------------------------------------------------------------
-- 2. Function check_anon_rate(p_action, p_max, p_window_sec)
--    Dipanggil dari WITH CHECK RLS. Mengembalikan true jika user
--    masih di bawah limit (boleh insert), false jika sudah melebihi.
--    SECURITY DEFINER supaya bisa baca anon_rate_limit meskipun
--    client tidak punya SELECT/INSERT ke tabel tsb (REVOKE di bawah).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_anon_rate(
  p_action TEXT,
  p_max INT DEFAULT 10,
  p_window_sec INT DEFAULT 60
) RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*) < p_max
  FROM anon_rate_limit
  WHERE user_id = auth.uid()
    AND action = p_action
    AND created_at > now() - (p_window_sec || ' seconds')::INTERVAL
$$;


-- ------------------------------------------------------------
-- 3. Function log_anon_action() — dipanggil trigger AFTER INSERT
--    supaya setiap insert yang berhasil dicatat di anon_rate_limit.
--    Pakai TG_ARGV[0] untuk nama action.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_anon_action()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO anon_rate_limit (user_id, action)
  VALUES (auth.uid(), TG_ARGV[0]);
  RETURN NEW;
END;
$$;


-- ------------------------------------------------------------
-- 4. Revoke akses langsung client ke anon_rate_limit
--    Hanya function SECURITY DEFINER (check_anon_rate,
--    log_anon_action) yang boleh akses tabel ini.
-- ------------------------------------------------------------
REVOKE ALL ON anon_rate_limit FROM anon, authenticated;


-- ------------------------------------------------------------
-- 5. Update kunjungan INSERT policy
--    DROP yang lama (WITH CHECK (true), TO public) lalu buat baru
--    TO authenticated + rate limit 5/60s.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "kunjungan_anon_insert" ON kunjungan;

CREATE POLICY "kunjungan_anon_insert" ON kunjungan
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('petugas', 'admin')
    OR check_anon_rate('kunjungan_insert', 5, 60)
  );


-- ------------------------------------------------------------
-- 6. Update chat_sesi INSERT policy
--    K2 (migration 021) membuat "chat_sesi_owner_insert" tanpa
--    rate limit. DROP + recreate dengan rate limit 3/60s.
--    Petugas/admin di-exempt (defensive — seharusnya pengunjung
--    saja yang insert chat_sesi).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chat_sesi_owner_insert" ON chat_sesi;

CREATE POLICY "chat_sesi_owner_insert" ON chat_sesi
  FOR INSERT TO authenticated
  WITH CHECK (
    pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
    AND (
      get_my_role() IN ('petugas', 'admin')
      OR check_anon_rate('chat_sesi_insert', 3, 60)
    )
  );


-- ------------------------------------------------------------
-- 7. Update chat_pesan INSERT policy
--    K2 membuat "chat_pesan_owner_insert" dengan ownership check
--    tapi tanpa rate limit. DROP + recreate dengan rate limit
--    20/60s. Petugas/admin di-exempt supaya bisa bulk-reply.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "chat_pesan_owner_insert" ON chat_pesan;

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
    AND (
      get_my_role() IN ('petugas', 'admin')
      OR check_anon_rate('chat_pesan_insert', 20, 60)
    )
  );


-- ------------------------------------------------------------
-- 8. Triggers AFTER INSERT untuk log ke anon_rate_limit
-- ------------------------------------------------------------
CREATE TRIGGER trg_log_kunjungan_insert
  AFTER INSERT ON kunjungan
  FOR EACH ROW EXECUTE FUNCTION log_anon_action('kunjungan_insert');

CREATE TRIGGER trg_log_chat_sesi_insert
  AFTER INSERT ON chat_sesi
  FOR EACH ROW EXECUTE FUNCTION log_anon_action('chat_sesi_insert');

CREATE TRIGGER trg_log_chat_pesan_insert
  AFTER INSERT ON chat_pesan
  FOR EACH ROW EXECUTE FUNCTION log_anon_action('chat_pesan_insert');


-- ============================================================
-- ROLLBACK:
--   -- Drop triggers
--   DROP TRIGGER IF EXISTS trg_log_kunjungan_insert ON kunjungan;
--   DROP TRIGGER IF EXISTS trg_log_chat_sesi_insert ON chat_sesi;
--   DROP TRIGGER IF EXISTS trg_log_chat_pesan_insert ON chat_pesan;
--
--   -- Drop policy baru (rate-limited)
--   DROP POLICY IF EXISTS "kunjungan_anon_insert" ON kunjungan;
--   DROP POLICY IF EXISTS "chat_sesi_owner_insert" ON chat_sesi;
--   DROP POLICY IF EXISTS "chat_pesan_owner_insert" ON chat_pesan;
--
--   -- Restore policy K2 (tanpa rate limit) untuk chat
--   CREATE POLICY "chat_sesi_owner_insert" ON chat_sesi
--     FOR INSERT TO authenticated
--     WITH CHECK (
--       pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
--     );
--   CREATE POLICY "chat_pesan_owner_insert" ON chat_pesan
--     FOR INSERT TO authenticated
--     WITH CHECK (
--       EXISTS (
--         SELECT 1 FROM chat_sesi
--         WHERE id = chat_pesan.sesi_id
--           AND (
--             pengunjung_id IN (SELECT id FROM pengunjung WHERE auth_user_id = auth.uid())
--             OR (pengirim = 'petugas' AND layanan_id = get_my_layanan_id())
--             OR get_my_role() = 'admin'
--           )
--       )
--     );
--
--   -- (BERBAHAYA) Restore policy kunjungan lama yang rentan —
--   -- JANGAN dipakai kecuali revert darurat. Policy ini membuka
--   -- INSERT tanpa auth dan tanpa rate limit.
--   -- CREATE POLICY "kunjungan_anon_insert" ON kunjungan
--   --   FOR INSERT WITH CHECK (true);
--
--   -- Drop function & tabel
--   DROP FUNCTION IF EXISTS log_anon_action() CASCADE;
--   DROP FUNCTION IF EXISTS check_anon_rate(TEXT, INT, INT) CASCADE;
--   DROP TABLE IF EXISTS anon_rate_limit;
-- ============================================================
