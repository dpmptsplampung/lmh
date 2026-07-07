-- ============================================================
-- Migration 003: Fase 1 — RLS Policies & Helper Functions
-- ============================================================

-- Helper functions (SECURITY DEFINER untuk hindari infinite recursion RLS)
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS TEXT AS $$
  SELECT role FROM petugas WHERE auth_user_id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_my_layanan_id()
RETURNS UUID AS $$
  SELECT layanan_id FROM petugas WHERE auth_user_id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- ---- LAYANAN ----
ALTER TABLE layanan ENABLE ROW LEVEL SECURITY;

CREATE POLICY "layanan_public_read" ON layanan
  FOR SELECT USING (true);

-- ---- PETUGAS ----
ALTER TABLE petugas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "petugas_admin_full" ON petugas
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "petugas_self_read" ON petugas
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

-- ---- KUNJUNGAN ----
ALTER TABLE kunjungan ENABLE ROW LEVEL SECURITY;

-- Anon: insert-only (form check-in publik)
-- Catatan: akan di-upgrade ke Supabase Anonymous Sign-In
CREATE POLICY "kunjungan_anon_insert" ON kunjungan
  FOR INSERT WITH CHECK (true);

-- Petugas: read/update kunjungan layanan sendiri
CREATE POLICY "kunjungan_petugas_select" ON kunjungan
  FOR SELECT TO authenticated
  USING (
    layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );

CREATE POLICY "kunjungan_petugas_update" ON kunjungan
  FOR UPDATE TO authenticated
  USING (
    layanan_id = get_my_layanan_id()
    OR get_my_role() = 'admin'
  );

-- ---- KEHADIRAN LAYANAN ----
ALTER TABLE kehadiran_layanan ENABLE ROW LEVEL SECURITY;

-- Instansi mitra: insert/update milik sendiri
CREATE POLICY "kehadiran_self_insert" ON kehadiran_layanan
  FOR INSERT TO authenticated
  WITH CHECK (instansi_user_id = auth.uid());

CREATE POLICY "kehadiran_self_select" ON kehadiran_layanan
  FOR SELECT TO authenticated
  USING (
    instansi_user_id = auth.uid()
    OR get_my_role() = 'admin'
  );

CREATE POLICY "kehadiran_self_update" ON kehadiran_layanan
  FOR UPDATE TO authenticated
  USING (
    instansi_user_id = auth.uid()
    OR get_my_role() = 'admin'
  );
