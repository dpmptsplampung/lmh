-- ============================================================
-- Migration 037: I6 — Funnel investor (investasi_lead)
-- ============================================================
--
-- Komponen:
--   1. Tabel `investasi_lead` — CRM-lite leads dari gallery IPRO cards
--   2. Indexes               — status, doc_id, created_at
--   3. Trigger updated_at    — reuse update_updated_at_column() (migration 016)
--   4. Audit trigger          — reuse audit_change() (migration 028) on status change
--   5. Rate-limit trigger     — reuse log_anon_action() (migration 022)
--   6. RLS policies           — INSERT (rate-limited, petugas/admin exempt),
--                               SELECT (admin+petugas), UPDATE (admin only)
--
-- Sumber data:
--   investment_documents(id)  (migration 007) — doc_id reference, ON DELETE SET NULL
--
-- Helper yang dipakai (sudah ada):
--   - get_my_role()                  (migration 003)
--   - check_anon_rate(action, max, w)(migration 022 / K3)
--   - log_anon_action()              (migration 022) — AFTER INSERT trigger
--   - update_updated_at_column()     (migration 016)
--   - audit_change()                 (migration 028) — generic trigger fn
--
-- Catatan keamanan:
--   INSERT investasi_lead dilakukan via Route Handler (/api/investasi/lead).
--   RLS policy memanggil check_anon_rate('investasi_lead_insert', 3, 3600)
--   (3 per jam) untuk anon/authenticated. Petugas/admin di-exempt.
--   Route Handler fallback ke service-role client jika RLS menolak (anon
--   yang belum sign-in) — mengikuti pola skm/submit.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel investasi_lead
-- ------------------------------------------------------------
CREATE TABLE investasi_lead (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id UUID REFERENCES investment_documents(id) ON DELETE SET NULL,
  nama TEXT NOT NULL,
  email TEXT NOT NULL,
  instansi TEXT,
  minat TEXT,
  catatan TEXT,
  status TEXT NOT NULL DEFAULT 'baru'
    CHECK (status IN ('baru', 'dihubungi', 'berlanjut', 'ditolak', 'selesai')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE investasi_lead IS 'I6 — Funnel investor: leads minat investasi dari Investment Gallery';
COMMENT ON COLUMN investasi_lead.doc_id IS 'Dokumen IPRO terkait (NULL jika dokumen dihapus)';
COMMENT ON COLUMN investasi_lead.status IS 'Status CRM: baru → dihubungi → berlanjut/ditolak/selesai';

CREATE INDEX idx_investasi_lead_status ON investasi_lead(status);
CREATE INDEX idx_investasi_lead_doc ON investasi_lead(doc_id);
CREATE INDEX idx_investasi_lead_created_at ON investasi_lead(created_at DESC);


-- ------------------------------------------------------------
-- 2. Trigger updated_at (reuse update_updated_at_column() dari migration 016)
-- ------------------------------------------------------------
CREATE TRIGGER trg_investasi_lead_updated
  BEFORE UPDATE ON investasi_lead
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ------------------------------------------------------------
-- 3. Audit trigger — status changes (reuse audit_change() dari migration 028)
-- ------------------------------------------------------------
CREATE TRIGGER trg_audit_investasi_lead_status
  AFTER UPDATE OF status ON investasi_lead
  FOR EACH ROW EXECUTE FUNCTION audit_change('update_status');


-- ------------------------------------------------------------
-- 4. Rate-limit logging trigger (reuse log_anon_action() dari migration 022)
--    Setiap INSERT berhasil dicatat ke anon_rate_limit untuk check_anon_rate.
-- ------------------------------------------------------------
CREATE TRIGGER trg_log_investasi_lead_insert
  AFTER INSERT ON investasi_lead
  FOR EACH ROW EXECUTE FUNCTION log_anon_action('investasi_lead_insert');


-- ------------------------------------------------------------
-- 5. RLS policies
-- ------------------------------------------------------------
ALTER TABLE investasi_lead ENABLE ROW LEVEL SECURITY;

-- INSERT: authenticated (anon yang sudah sign-in) dengan rate limit 3/jam.
-- Petugas/admin di-exempt. Route Handler fallback ke service-role jika RLS
-- menolak (mis. anon yang belum sign-in).
CREATE POLICY "investasi_lead_insert" ON investasi_lead
  FOR INSERT TO authenticated
  WITH CHECK (
    get_my_role() IN ('petugas', 'admin')
    OR check_anon_rate('investasi_lead_insert', 3, 3600)
  );

-- SELECT: admin + petugas saja (CRM-lite)
CREATE POLICY "investasi_lead_select_staff" ON investasi_lead
  FOR SELECT TO authenticated
  USING (get_my_role() IN ('admin', 'petugas'));

-- UPDATE: admin saja (update status lead)
CREATE POLICY "investasi_lead_update_admin" ON investasi_lead
  FOR UPDATE TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');


-- ============================================================
-- ROLLBACK:
--   -- Drop policies
--   DROP POLICY IF EXISTS "investasi_lead_update_admin" ON investasi_lead;
--   DROP POLICY IF EXISTS "investasi_lead_select_staff" ON investasi_lead;
--   DROP POLICY IF EXISTS "investasi_lead_insert" ON investasi_lead;
--
--   -- Drop triggers (fungsi dimiliki oleh migrasi lain, TIDAK di-drop)
--   DROP TRIGGER IF EXISTS trg_log_investasi_lead_insert ON investasi_lead;
--   DROP TRIGGER IF EXISTS trg_audit_investasi_lead_status ON investasi_lead;
--   DROP TRIGGER IF EXISTS trg_investasi_lead_updated ON investasi_lead;
--
--   -- Drop tabel
--   DROP TABLE IF EXISTS investasi_lead;
-- ============================================================
