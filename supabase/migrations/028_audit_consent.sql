-- ============================================================
-- Migration 028: Fase 1 / I8 — Tata kelola PDP
-- audit_log, consent_log, triggers, retensi pg_cron
-- ============================================================
--
-- Komponen:
--   1. audit_log            — tabel audit trail (hanya admin SELECT)
--   2. consent_log          — tabel persetujuan pengolahan data PDP
--   3. audit_change()       — fungsi trigger generik (SECURITY DEFINER)
--   4. Triggers audit       — pada kunjungan, reservasi, listing_umkm,
--                              investment_documents, petugas
--   5. anonymize_inactive_pengunjung() + jadwal pg_cron (retensi 730 hari)
--
-- Catatan: tabel `visit` belum ada (dibuat oleh I1). Trigger audit untuk
-- `visit` akan ditambahkan sendiri oleh migrasi I1. Migration ini hanya
-- menempel trigger pada tabel yang SUDAH ada.
--
-- pg_cron belum di-enable di instance ini. Migration tetap berhasil
-- walaupun pg_cron belum terpasang (DO block menangani ketiadaan).
-- Human prerequisite: enable pg_cron via Supabase Dashboard
-- (Database → Extensions → pg_cron → enable) untuk mengaktifkan jadwal
-- otomatis. Sebelum itu, jalankan manual: SELECT anonymize_inactive_pengunjung();
-- ============================================================

-- ------------------------------------------------------------
-- 1. audit_log
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  actor_id UUID,                -- auth.users.id pelaku (NULL untuk sistem)
  actor_role TEXT,              -- 'admin'/'petugas'/'pengunjung'/'anon'/'system'
  aksi TEXT NOT NULL,           -- 'update_status', 'approve_umkm', 'upload_dok', 'delete_dok', 'insert_petugas', 'delete_petugas'
  entitas TEXT NOT NULL,        -- nama tabel
  entitas_id TEXT,              -- id row (cast to text)
  detail JSONB,                 -- before/after ringkas
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_entitas ON audit_log(entitas, entitas_id);
CREATE INDEX idx_audit_log_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Hanya admin SELECT; tidak ada INSERT dari client (trigger pakai SECURITY DEFINER)
CREATE POLICY "audit_log_admin_select" ON audit_log
  FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

REVOKE ALL ON audit_log FROM anon;

-- ------------------------------------------------------------
-- 2. consent_log
-- ------------------------------------------------------------
CREATE TABLE consent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subjek_ref TEXT NOT NULL,      -- id pengunjung / sesi / listing
  tujuan TEXT NOT NULL,          -- 'checkin_data', 'chat_followup', 'umkm_contact'
  disetujui BOOLEAN NOT NULL,
  versi_kebijakan TEXT NOT NULL DEFAULT '1.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_consent_subjek ON consent_log(subjek_ref);

ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;

-- Pengunjung bisa INSERT consent sendiri; admin SELECT
CREATE POLICY "consent_log_insert_own" ON consent_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "consent_log_admin_select" ON consent_log
  FOR SELECT TO authenticated
  USING (get_my_role() = 'admin');

-- ------------------------------------------------------------
-- 3. audit_change() — fungsi trigger generik (SECURITY DEFINER)
--    Bypass RLS agar bisa INSERT ke audit_log dari trigger konteks apa pun.
--    Tidak mempertanyakan tabel pemicu (no recursion risk).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_change()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_role TEXT := COALESCE(
    (SELECT role FROM petugas WHERE auth_user_id = auth.uid()),
    CASE WHEN v_actor IS NOT NULL THEN 'pengunjung' ELSE 'system' END
  );
  v_aksi TEXT := TG_ARGV[0];
  v_entitas TEXT := TG_TABLE_NAME;
  v_entitas_id TEXT;
  v_detail JSONB;
BEGIN
  v_entitas_id := COALESCE((NEW.id)::text, (OLD.id)::text);
  IF TG_OP = 'UPDATE' THEN
    v_detail := jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW));
  ELSIF TG_OP = 'INSERT' THEN
    v_detail := jsonb_build_object('after', to_jsonb(NEW));
  ELSIF TG_OP = 'DELETE' THEN
    v_detail := jsonb_build_object('before', to_jsonb(OLD));
  END IF;
  INSERT INTO audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (v_actor, v_role, v_aksi, v_entitas, v_entitas_id, v_detail);
  RETURN NEW;
END;
$$;

-- ------------------------------------------------------------
-- 4. Triggers audit pada tabel sensitif (yang sudah ada)
-- ------------------------------------------------------------
-- kunjungan: audit status change
DROP TRIGGER IF EXISTS trg_audit_kunjungan_status ON kunjungan;
CREATE TRIGGER trg_audit_kunjungan_status
  AFTER UPDATE OF status ON kunjungan
  FOR EACH ROW EXECUTE FUNCTION audit_change('update_status');

-- reservasi: audit status change
DROP TRIGGER IF EXISTS trg_audit_reservasi_status ON reservasi;
CREATE TRIGGER trg_audit_reservasi_status
  AFTER UPDATE OF status ON reservasi
  FOR EACH ROW EXECUTE FUNCTION audit_change('update_status');

-- listing_umkm: audit approve (status → published)
DROP TRIGGER IF EXISTS trg_audit_umkm_status ON listing_umkm;
CREATE TRIGGER trg_audit_umkm_status
  AFTER UPDATE OF status ON listing_umkm
  FOR EACH ROW EXECUTE FUNCTION audit_change('update_status');

-- petugas: audit insert/delete
DROP TRIGGER IF EXISTS trg_audit_petugas_insert ON petugas;
CREATE TRIGGER trg_audit_petugas_insert
  AFTER INSERT ON petugas
  FOR EACH ROW EXECUTE FUNCTION audit_change('insert_petugas');

DROP TRIGGER IF EXISTS trg_audit_petugas_delete ON petugas;
CREATE TRIGGER trg_audit_petugas_delete
  AFTER DELETE ON petugas
  FOR EACH ROW EXECUTE FUNCTION audit_change('delete_petugas');

-- investment_documents: audit upload (insert) & delete
DROP TRIGGER IF EXISTS trg_audit_investment_insert ON investment_documents;
CREATE TRIGGER trg_audit_investment_insert
  AFTER INSERT ON investment_documents
  FOR EACH ROW EXECUTE FUNCTION audit_change('upload_dok');

DROP TRIGGER IF EXISTS trg_audit_investment_delete ON investment_documents;
CREATE TRIGGER trg_audit_investment_delete
  AFTER DELETE ON investment_documents
  FOR EACH ROW EXECUTE FUNCTION audit_change('delete_dok');

-- ------------------------------------------------------------
-- 5. Retensi: anonymize_inactive_pengunjung()
--    Tambah kolom updated_at ke pengunjung (sebelumnya tidak ada),
--    pasang trigger auto-update, lalu jadwalkan anonymisasi 730 hari.
-- ------------------------------------------------------------

-- 5a. Tambah kolom updated_at pada pengunjung (jika belum ada)
ALTER TABLE pengunjung ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS idx_pengunjung_updated_at ON pengunjung(updated_at);

-- 5b. Trigger auto-update updated_at (fungsi update_updated_at_column sudah ada dari migration 016)
DROP TRIGGER IF EXISTS trigger_pengunjung_updated_at ON pengunjung;
CREATE TRIGGER trigger_pengunjung_updated_at
  BEFORE UPDATE ON pengunjung
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5c. Fungsi anonymisasi
CREATE OR REPLACE FUNCTION anonymize_inactive_pengunjung()
RETURNS void LANGUAGE sql SECURITY DEFINER
AS $$
  UPDATE pengunjung
  SET nama = '[anonim]', email = NULL, foto_url = NULL
  WHERE updated_at < now() - INTERVAL '730 days'
    AND email IS NOT NULL;
$$;

-- 5d. Jadwalkan via pg_cron (hanya jika extension terpasang)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Hindari error duplikat: unschedule dulu jika sudah ada
    BEGIN
      PERFORM cron.unschedule('anonymize_inactive_pengunjung');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'anonymize_inactive_pengunjung',
      '0 2 * * *',
      'SELECT anonymize_inactive_pengunjung()'
    );
  ELSE
    RAISE NOTICE 'pg_cron tidak terinstall. Jalankan anonymisasi manual: SELECT anonymize_inactive_pengunjung();';
  END IF;
END $$;

-- ============================================================
-- ROLLBACK:
-- -- Hapus jadwal pg_cron
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     BEGIN
--       PERFORM cron.unschedule('anonymize_inactive_pengunjung');
--     EXCEPTION WHEN OTHERS THEN NULL;
--     END;
--   END IF;
-- END $$;
--
-- DROP FUNCTION IF EXISTS anonymize_inactive_pengunjung();
-- DROP TRIGGER IF EXISTS trigger_pengunjung_updated_at ON pengunjung;
-- DROP INDEX IF EXISTS idx_pengunjung_updated_at;
-- ALTER TABLE pengunjung DROP COLUMN IF EXISTS updated_at;
--
-- DROP TRIGGER IF EXISTS trg_audit_investment_delete ON investment_documents;
-- DROP TRIGGER IF EXISTS trg_audit_investment_insert ON investment_documents;
-- DROP TRIGGER IF EXISTS trg_audit_petugas_delete ON petugas;
-- DROP TRIGGER IF EXISTS trg_audit_petugas_insert ON petugas;
-- DROP TRIGGER IF EXISTS trg_audit_umkm_status ON listing_umkm;
-- DROP TRIGGER IF EXISTS trg_audit_reservasi_status ON reservasi;
-- DROP TRIGGER IF EXISTS trg_audit_kunjungan_status ON kunjungan;
--
-- DROP FUNCTION IF EXISTS audit_change();
--
-- DROP POLICY IF EXISTS "consent_log_admin_select" ON consent_log;
-- DROP POLICY IF EXISTS "consent_log_insert_own" ON consent_log;
-- DROP TABLE IF EXISTS consent_log;
--
-- DROP POLICY IF EXISTS "audit_log_admin_select" ON audit_log;
-- DROP TABLE IF EXISTS audit_log;
-- ============================================================
