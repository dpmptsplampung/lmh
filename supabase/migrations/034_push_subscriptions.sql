-- ============================================================
-- Migration 034: Fase 2 / I5: Push subscriptions (web-push VAPID)
-- ============================================================
--
-- Komponen:
--   1. Tabel `push_subscriptions` — endpoint + keys per user (browser)
--   2. RLS policies               — user bisa kelola subscription sendiri
--
-- Sumber data:
--   - /me/notifications page: navigator.serviceWorker + pushManager.subscribe
--   - VAPID keys dari env (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
--
-- Catatan:
--   - Satu user bisa punya banyak subscription (multidevice).
--   - keys JSONB berisi { p256dh, auth } per spec Web Push.
--   - Pengiriman dilakukan oleh /api/notif/send (kanal='web_push').
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel push_subscriptions
-- ------------------------------------------------------------
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_sub_user ON push_subscriptions(user_id);
CREATE UNIQUE INDEX idx_push_sub_endpoint ON push_subscriptions(endpoint);


-- ------------------------------------------------------------
-- 2. RLS policies — user kelola subscription sendiri
-- ------------------------------------------------------------
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "push_sub_self_select" ON push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "push_sub_self_insert" ON push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "push_sub_self_delete" ON push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());


-- ============================================================
-- ROLLBACK:
--   DROP POLICY IF EXISTS "push_sub_self_delete" ON push_subscriptions;
--   DROP POLICY IF EXISTS "push_sub_self_insert" ON push_subscriptions;
--   DROP POLICY IF EXISTS "push_sub_self_select" ON push_subscriptions;
--   ALTER TABLE push_subscriptions DISABLE ROW LEVEL SECURITY;
--   DROP INDEX IF EXISTS idx_push_sub_endpoint;
--   DROP INDEX IF EXISTS idx_push_sub_user;
--   DROP TABLE IF EXISTS push_subscriptions;
-- ============================================================
