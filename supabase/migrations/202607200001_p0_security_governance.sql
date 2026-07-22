-- P0 security & governance hardening (forward migration, post-baseline).
BEGIN;

-- ============================================================
-- (a) visit walk-in: pengunjung_id must belong to the caller
-- ============================================================
DROP POLICY "visit_insert_walk_in" ON public.visit;
CREATE POLICY "visit_insert_walk_in" ON public.visit FOR INSERT TO authenticated
  WITH CHECK (
    asal = 'walk_in'
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('visit_insert_walk_in', 5, 60))
    AND (
      pengunjung_id IS NULL
      OR pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    )
  );

-- ============================================================
-- (b) chat_sesi: pengunjung cannot alter status/ditangani_oleh
-- ============================================================
CREATE FUNCTION public.guard_chat_sesi_staff_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  caller_role text;
BEGIN
  caller_role := public.get_my_role();
  IF caller_role IN ('petugas', 'admin') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Pengunjung tidak boleh mengubah status sesi chat';
  END IF;
  IF NEW.ditangani_oleh IS DISTINCT FROM OLD.ditangani_oleh THEN
    RAISE EXCEPTION 'Pengunjung tidak boleh mengubah penanganan sesi chat';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.guard_chat_sesi_staff_columns() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_chat_sesi_staff BEFORE UPDATE ON public.chat_sesi
  FOR EACH ROW EXECUTE FUNCTION public.guard_chat_sesi_staff_columns();

-- ============================================================
-- (c) listing_umkm insert: petugas limited to draft/pending_review
-- ============================================================
DROP POLICY "listing_staff_insert" ON public.listing_umkm;
CREATE POLICY "listing_staff_insert" ON public.listing_umkm FOR INSERT TO authenticated
  WITH CHECK (
    public.get_my_role() IN ('admin', 'petugas')
    AND (public.get_my_role() = 'admin' OR status IN ('draft', 'pending_review'))
  );

-- ============================================================
-- (c2) consent_log: admin boleh mencatat consent kontak publik UMKM
-- (subjek_ref = id listing, bukan auth.uid milik admin)
-- ============================================================
CREATE POLICY "consent_log_admin_insert" ON public.consent_log FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() = 'admin');

-- ============================================================
-- (d) audit petugas role escalation
-- ============================================================
CREATE TRIGGER trg_audit_petugas_role AFTER UPDATE OF role ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('update_role');

-- ============================================================
-- (e) absensi anti-backdate + status 'ditolak'
-- ============================================================
ALTER TABLE public.absensi_petugas DROP CONSTRAINT absensi_petugas_status_check;
ALTER TABLE public.absensi_petugas
  ADD CONSTRAINT absensi_petugas_status_check CHECK (status IN ('pending', 'approved', 'ditolak'));

CREATE FUNCTION public.guard_absensi_tanggal_today()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NEW.tanggal <> pg_catalog.CURRENT_DATE THEN
    RAISE EXCEPTION 'Tanggal absensi harus hari ini';
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.guard_absensi_tanggal_today() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_guard_absensi_tanggal BEFORE INSERT OR UPDATE OF tanggal ON public.absensi_petugas
  FOR EACH ROW EXECUTE FUNCTION public.guard_absensi_tanggal_today();

-- ============================================================
-- (f) notifikasi dead-letter: stop claiming failed rows retried >= 5x
-- ============================================================
CREATE OR REPLACE FUNCTION public.claim_notifikasi(
  p_limit integer DEFAULT 10,
  p_status text DEFAULT 'pending'
)
RETURNS TABLE (
  id uuid,
  claim_token uuid,
  kanal text,
  tujuan_email text,
  tujuan_user_id uuid,
  subjek text,
  body text,
  payload jsonb,
  retry_count integer
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  batch_token uuid := pg_catalog.gen_random_uuid();
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT n.id
    FROM public.notifikasi AS n
    WHERE n.status = p_status
      AND n.available_at <= pg_catalog.now()
      AND (
        p_status = 'pending'
        OR (p_status = 'failed' AND n.retry_count < 5)
      )
    ORDER BY n.created_at
    FOR UPDATE OF n SKIP LOCKED
    LIMIT GREATEST(p_limit, 0)
  ),
  claimed AS (
    UPDATE public.notifikasi AS n
    SET
      status = 'processing',
      claim_token = batch_token,
      claimed_at = pg_catalog.now(),
      error = NULL
    FROM candidates AS c
    WHERE n.id = c.id
    RETURNING
      n.id,
      n.claim_token,
      n.kanal,
      n.tujuan_email,
      n.tujuan_user_id,
      n.subjek,
      n.body,
      n.payload,
      n.retry_count
  )
  SELECT * FROM claimed;
END
$$;
REVOKE EXECUTE ON FUNCTION public.claim_notifikasi(integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notifikasi(integer, text) TO service_role;

-- ============================================================
-- (g) chat_ai_log retention helper (cron scheduled below)
-- ============================================================
CREATE FUNCTION public.prune_chat_ai_log()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  DELETE FROM public.chat_ai_log
  WHERE created_at < pg_catalog.now() - INTERVAL '90 days'
$$;
REVOKE EXECUTE ON FUNCTION public.prune_chat_ai_log() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- (h) public queue position RPC (contract for other agents)
-- ============================================================
CREATE FUNCTION public.get_queue_position(p_qr_token uuid)
RETURNS TABLE (posisi int, total_menunggu int)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_layanan_id uuid;
  v_tanggal date;
  v_waktu_masuk timestamptz;
  v_status text;
BEGIN
  SELECT visit.layanan_id, visit.waktu_masuk::date, visit.waktu_masuk, visit.status
  INTO v_layanan_id, v_tanggal, v_waktu_masuk, v_status
  FROM public.visit AS visit
  WHERE visit.qr_token = p_qr_token::text;

  IF NOT FOUND OR v_status <> 'menunggu' OR v_waktu_masuk IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (pg_catalog.count(*) FILTER (
      WHERE queue.waktu_masuk <= v_waktu_masuk
    ))::integer AS posisi,
    pg_catalog.count(*)::integer AS total_menunggu
  FROM public.visit AS queue
  WHERE queue.layanan_id = v_layanan_id
    AND queue.status = 'menunggu'
    AND queue.waktu_masuk::date = v_tanggal;
END
$$;
REVOKE EXECUTE ON FUNCTION public.get_queue_position(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_queue_position(uuid) TO anon, authenticated;

-- ============================================================
-- (i) new notification triggers
-- ============================================================

-- (i.1) petugas replies in chat -> notify the visitor
CREATE FUNCTION public.notify_chat_petugas_reply()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recipient_email text;
  recipient_user_id uuid;
BEGIN
  IF NEW.pengirim <> 'petugas' THEN
    RETURN NEW;
  END IF;

  SELECT visitor.email, visitor.auth_user_id
  INTO recipient_email, recipient_user_id
  FROM public.chat_sesi AS sesi
  JOIN public.pengunjung AS visitor ON visitor.id = sesi.pengunjung_id
  WHERE sesi.id = NEW.sesi_id;

  IF recipient_user_id IS NOT NULL THEN
    PERFORM public.queue_notifikasi(
      recipient_user_id, NULL, 'web_push',
      'Balasan Baru dari Petugas',
      'Petugas telah membalas chat Anda. Silakan buka kembali sesi chat untuk melihat balasan.',
      pg_catalog.jsonb_build_object('sesi_id', NEW.sesi_id, 'type', 'chat_petugas_reply')
    );
  END IF;

  IF recipient_email IS NOT NULL THEN
    PERFORM public.queue_notifikasi(
      NULL, recipient_email, 'email',
      'Balasan Baru dari Petugas - DPMPTSP Lampung',
      'Petugas telah membalas chat Anda. Silakan buka kembali sesi chat untuk melihat balasan.',
      pg_catalog.jsonb_build_object('sesi_id', NEW.sesi_id, 'type', 'chat_petugas_reply_email')
    );
  END IF;

  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.notify_chat_petugas_reply() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_chat_petugas_reply AFTER INSERT ON public.chat_pesan
  FOR EACH ROW EXECUTE FUNCTION public.notify_chat_petugas_reply();

-- (i.2) umkm_inquiry approved/rejected -> email the sender
CREATE FUNCTION public.notify_umkm_inquiry_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  status_label text;
BEGIN
  IF NEW.status NOT IN ('approved', 'rejected') OR OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  status_label := CASE NEW.status WHEN 'approved' THEN 'disetujui' ELSE 'ditolak' END;

  PERFORM public.queue_notifikasi(
    NULL, NEW.from_email, 'email',
    'Status Inquiry Listing UMKM Anda - DPMPTSP Lampung',
    'Status inquiry listing UMKM Anda: ' || status_label || '. Terima kasih telah menggunakan Layanan Maju Hub.',
    pg_catalog.jsonb_build_object('listing_id', NEW.listing_id, 'type', 'umkm_inquiry_' || NEW.status)
  );

  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.notify_umkm_inquiry_status() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_umkm_inquiry_status AFTER UPDATE OF status ON public.umkm_inquiry
  FOR EACH ROW EXECUTE FUNCTION public.notify_umkm_inquiry_status();

-- (i.3) reservasi confirmed (terjadwal -> menunggu) -> notify the visitor
CREATE FUNCTION public.notify_reservasi_confirmed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recipient_email text;
  recipient_user_id uuid;
BEGIN
  IF NEW.asal <> 'reservasi' THEN
    RETURN NEW;
  END IF;
  IF NOT (NEW.status = 'menunggu' AND OLD.status = 'terjadwal') THEN
    RETURN NEW;
  END IF;

  SELECT visitor.email, visitor.auth_user_id
  INTO recipient_email, recipient_user_id
  FROM public.pengunjung AS visitor
  WHERE visitor.id = NEW.pengunjung_id;

  IF recipient_user_id IS NOT NULL THEN
    PERFORM public.queue_notifikasi(
      recipient_user_id, NULL, 'web_push',
      'Reservasi Dikonfirmasi',
      'Reservasi Anda telah dikonfirmasi, silakan menuju loket.',
      pg_catalog.jsonb_build_object('visit_id', NEW.id, 'type', 'reservasi_confirmed')
    );
  END IF;

  IF recipient_email IS NOT NULL THEN
    PERFORM public.queue_notifikasi(
      NULL, recipient_email, 'email',
      'Reservasi Dikonfirmasi - DPMPTSP Lampung',
      'Reservasi Anda telah dikonfirmasi, silakan menuju loket.',
      pg_catalog.jsonb_build_object('visit_id', NEW.id, 'type', 'reservasi_confirmed_email')
    );
  END IF;

  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.notify_reservasi_confirmed() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_notify_reservasi_confirmed AFTER UPDATE OF status ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.notify_reservasi_confirmed();

COMMIT;

-- pg_cron scheduling is kept outside the DDL transaction (same pattern as
-- the baseline jobs file). Reapplying replaces jobs by name.
DO $$
BEGIN
  PERFORM cron.unschedule(job.jobid)
  FROM cron.job AS job
  WHERE job.jobname = 'prune_chat_ai_log';
  PERFORM cron.schedule(
    'prune_chat_ai_log',
    '30 3 * * *',
    'SELECT public.prune_chat_ai_log()'
  );
END
$$;
