-- ============================================================
-- Migration 033: Fase 2 / I5: Notifikasi omnichannel (email + web-push)
-- ============================================================
--
-- Komponen:
--   1. Tabel `notifikasi`          — antrian notifikasi (email + web_push)
--   2. RLS policies                — pengunjung SELECT milik sendiri, admin ALL
--   3. Function `queue_notifikasi` — helper SECURITY DEFINER untuk insert dari trigger
--   4. Trigger visit selesai       — kirim SKM email ke pengunjung (link /skm?token=)
--   5. Trigger umkm published      — kirim email ke owner listing (umkm_listing_owner)
--
-- Sumber data:
--   - visit (migration 029): status='selesai' + qr_token → SKM survey link
--   - pengunjung (migration 008): email tujuan SKM
--   - listing_umkm (migration 006): status='published' + nama_umkm
--   - umkm_listing_owner (migration 024): email pemilik listing
--
-- Catatan:
--   - notifikasi hanya mengantri; pengiriman via Route Handler /api/notif/send
--     (dijadwalkan oleh Vercel Cron, dilindungi CRON_SECRET).
--   - queue_notifikasi SECURITY DEFINER agar trigger bisa INSERT melewati RLS.
--   - WhatsApp defer ke Fase 2.5 (butuh approval Meta).
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tabel notifikasi
-- ------------------------------------------------------------
CREATE TABLE notifikasi (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tujuan_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tujuan_email TEXT,
  kanal TEXT NOT NULL CHECK (kanal IN ('email', 'web_push')),
  subjek TEXT,
  body TEXT NOT NULL,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  retry_count INT NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

COMMENT ON TABLE notifikasi IS 'Antrian notifikasi omnichannel (email + web_push). Diproses oleh /api/notif/send (Vercel Cron).';

CREATE INDEX idx_notifikasi_status ON notifikasi(status, created_at);
CREATE INDEX idx_notifikasi_tujuan ON notifikasi(tujuan_user_id);


-- ------------------------------------------------------------
-- 2. RLS policies
--    Pengunjung SELECT milik sendiri; admin ALL; INSERT via trigger/SECURITY DEFINER
-- ------------------------------------------------------------
ALTER TABLE notifikasi ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notifikasi_select_own" ON notifikasi
  FOR SELECT TO authenticated
  USING (
    tujuan_user_id = auth.uid()
    OR get_my_role() = 'admin'
  );

CREATE POLICY "notifikasi_admin_all" ON notifikasi
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');


-- ------------------------------------------------------------
-- 3. Helper function: queue_notifikasi()
--    SECURITY DEFINER agar bisa INSERT dari trigger tanpa RLS.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION queue_notifikasi(
  p_tujuan_user_id UUID,
  p_tujuan_email TEXT,
  p_kanal TEXT,
  p_subjek TEXT,
  p_body TEXT,
  p_payload JSONB DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifikasi (tujuan_user_id, tujuan_email, kanal, subjek, body, payload)
  VALUES (p_tujuan_user_id, p_tujuan_email, p_kanal, p_subjek, p_body, p_payload)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;


-- ------------------------------------------------------------
-- 4. Trigger: visit status → selesai → queue SKM email
--    Link ke /skm?token={qr_token} (akses publik, no login).
--    public_url diambil dari setting app.public_url (fallback default).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_visit_selesai()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email TEXT;
BEGIN
  IF NEW.status = 'selesai' AND (OLD IS NULL OR OLD.status != 'selesai') THEN
    SELECT email INTO v_email FROM pengunjung WHERE id = NEW.pengunjung_id;
    IF v_email IS NOT NULL THEN
      PERFORM queue_notifikasi(
        NULL, v_email, 'email',
        'Survei Kepuasan Masyarakat — DPMPTSP Lampung',
        'Layanan Anda telah selesai. Mohon isi survei: ' ||
        COALESCE((SELECT current_setting('app.public_url', true)), 'https://lmh.lampungprov.go.id') ||
        '/skm?token=' || NEW.qr_token,
        jsonb_build_object('visit_id', NEW.id, 'type', 'skm_survey')
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_visit_selesai
  AFTER UPDATE OF status ON visit
  FOR EACH ROW EXECUTE FUNCTION notify_visit_selesai();


-- ------------------------------------------------------------
-- 5. Trigger: listing_umkm approved (status='published') → email owner
--    Owner email diambil dari umkm_listing_owner (migration 024).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_umkm_approved()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email TEXT;
BEGIN
  IF NEW.status = 'published' AND (OLD IS NULL OR OLD.status != 'published') THEN
    SELECT email INTO v_email FROM umkm_listing_owner WHERE listing_id = NEW.id LIMIT 1;
    IF v_email IS NOT NULL THEN
      PERFORM queue_notifikasi(
        NULL, v_email, 'email',
        'Listing UMKM Anda Disetujui — DPMPTSP Lampung',
        'Listing "' || NEW.nama_umkm || '" telah disetujui dan tayang di marketplace.',
        jsonb_build_object('listing_id', NEW.id, 'type', 'umkm_approved')
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_umkm_approved
  AFTER UPDATE OF status ON listing_umkm
  FOR EACH ROW EXECUTE FUNCTION notify_umkm_approved();


-- ============================================================
-- ROLLBACK:
--   DROP TRIGGER IF EXISTS trg_notify_umkm_approved ON listing_umkm;
--   DROP FUNCTION IF EXISTS notify_umkm_approved();
--
--   DROP TRIGGER IF EXISTS trg_notify_visit_selesai ON visit;
--   DROP FUNCTION IF EXISTS notify_visit_selesai();
--
--   DROP FUNCTION IF EXISTS queue_notifikasi(UUID, TEXT, TEXT, TEXT, TEXT, JSONB);
--
--   DROP POLICY IF EXISTS "notifikasi_admin_all" ON notifikasi;
--   DROP POLICY IF EXISTS "notifikasi_select_own" ON notifikasi;
--   ALTER TABLE notifikasi DISABLE ROW LEVEL SECURITY;
--
--   DROP INDEX IF EXISTS idx_notifikasi_tujuan;
--   DROP INDEX IF EXISTS idx_notifikasi_status;
--   DROP TABLE IF EXISTS notifikasi;
-- ============================================================
