-- Production baseline 4/5: helpers, RLS, storage, and trigger automation.
BEGIN;

CREATE FUNCTION public.get_my_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT staff.role FROM public.petugas AS staff WHERE staff.auth_user_id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

CREATE FUNCTION public.get_my_layanan_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT staff.layanan_id FROM public.petugas AS staff WHERE staff.auth_user_id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_layanan_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_layanan_id() TO authenticated;

CREATE FUNCTION public.set_user_role_claim(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  user_role text;
BEGIN
  SELECT staff.role INTO user_role
  FROM public.petugas AS staff
  WHERE staff.auth_user_id = (event->>'user_id')::uuid;

  user_role := COALESCE(user_role, 'pengunjung');
  event := pg_catalog.jsonb_set(
    event,
    '{claims,app_metadata}',
    COALESCE(event->'claims'->'app_metadata', '{}'::jsonb),
    true
  );
  event := pg_catalog.jsonb_set(
    event,
    '{claims,app_metadata,role}',
    pg_catalog.to_jsonb(user_role),
    true
  );
  RETURN event;
END
$$;
REVOKE EXECUTE ON FUNCTION public.set_user_role_claim(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_role_claim(jsonb) TO supabase_auth_admin;

CREATE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.check_anon_rate(
  p_action text,
  p_max integer DEFAULT 10,
  p_window_sec integer DEFAULT 60
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT pg_catalog.count(*) < p_max
  FROM public.anon_rate_limit AS rate
  WHERE rate.user_id = auth.uid()
    AND rate.action = p_action
    AND rate.created_at > pg_catalog.now() - pg_catalog.make_interval(secs => p_window_sec)
$$;
REVOKE EXECUTE ON FUNCTION public.check_anon_rate(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_anon_rate(text, integer, integer) TO authenticated;

CREATE FUNCTION public.log_anon_action()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO public.anon_rate_limit (user_id, action) VALUES (auth.uid(), TG_ARGV[0]);
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.log_anon_action() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.prune_anon_rate_limit()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  DELETE FROM public.anon_rate_limit
  WHERE created_at < pg_catalog.now() - INTERVAL '7 days'
$$;
REVOKE EXECUTE ON FUNCTION public.prune_anon_rate_limit() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.audit_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  entity_id text;
  actor uuid := auth.uid();
  actor_role text;
  detail_payload jsonb;
  status_val text;
  role_val text;
  created_val text;
  updated_val text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    entity_id := OLD.id::text;
  ELSE
    entity_id := NEW.id::text;
  END IF;

  SELECT staff.role INTO actor_role
  FROM public.petugas AS staff
  WHERE staff.auth_user_id = actor;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      status_val := OLD.status::text;
    ELSE
      status_val := NEW.status::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    status_val := NULL;
  END;

  BEGIN
    IF TG_OP = 'DELETE' THEN
      role_val := OLD.role::text;
    ELSE
      role_val := NEW.role::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    role_val := NULL;
  END;

  BEGIN
    IF TG_OP <> 'DELETE' THEN
      created_val := NEW.created_at::text;
      updated_val := NEW.updated_at::text;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    created_val := NULL;
    updated_val := NULL;
  END;

  detail_payload := pg_catalog.jsonb_build_object(
    'op', TG_OP,
    'actor', actor,
    'id', entity_id,
    'status', status_val,
    'role', role_val,
    'created_at', created_val,
    'updated_at', updated_val
  );

  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail)
  VALUES (
    actor,
    COALESCE(actor_role, CASE WHEN actor IS NULL THEN 'system' ELSE 'pengunjung' END),
    TG_ARGV[0],
    TG_TABLE_NAME,
    entity_id,
    detail_payload
  );
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.audit_change() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.anonymize_inactive_pengunjung()
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  UPDATE public.pengunjung
  SET nama = '[anonim]', email = NULL, foto_url = NULL
  WHERE updated_at < pg_catalog.now() - INTERVAL '730 days' AND email IS NOT NULL
$$;
REVOKE EXECUTE ON FUNCTION public.anonymize_inactive_pengunjung() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.match_faq(
  query_embedding extensions.vector(768),
  p_layanan_id uuid DEFAULT NULL,
  match_count integer DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  layanan_id uuid,
  pertanyaan text,
  jawaban text,
  similarity double precision
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
  SELECT faq.id, faq.layanan_id, faq.pertanyaan, faq.jawaban,
    1 - (faq.embedding OPERATOR(extensions.<=>) query_embedding) AS similarity
  FROM public.faq_knowledge_base AS faq
  WHERE faq.embedding IS NOT NULL
    AND faq.aktif = true
    AND (p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id)
  ORDER BY faq.embedding OPERATOR(extensions.<=>) query_embedding
  LIMIT match_count
$$;
REVOKE EXECUTE ON FUNCTION public.match_faq(extensions.vector, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_faq(extensions.vector, uuid, integer) TO authenticated;

CREATE FUNCTION public.hitung_ikm(p_layanan_id uuid, p_start date, p_end date)
RETURNS TABLE (layanan_id uuid, layanan_nama text, ikm numeric, responden integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_layanan_id, service.nama,
    pg_catalog.avg(
      (response.u1_persyaratan + response.u2_prosedur + response.u3_waktu +
       response.u4_biaya + response.u5_produk + response.u6_kompetensi +
       response.u7_perilaku + response.u8_sarana + response.u9_pengaduan) / 9.0
    ) * 25 AS ikm,
    pg_catalog.count(*)::integer AS responden
  FROM public.skm_respons AS response
  JOIN public.layanan AS service ON service.id = p_layanan_id
  WHERE response.layanan_id = p_layanan_id
    AND response.created_at::date BETWEEN p_start AND p_end
  GROUP BY service.nama
$$;
REVOKE EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hitung_ikm(uuid, date, date) TO anon, authenticated;

CREATE FUNCTION public.get_skm_context(p_token text)
RETURNS TABLE (eligible boolean, already_submitted boolean, layanan_nama text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    visit.status = 'selesai' AS eligible,
    EXISTS (
      SELECT 1 FROM public.skm_respons AS response
      WHERE response.visit_id = visit.id
    ) AS already_submitted,
    service.nama AS layanan_nama
  FROM public.visit AS visit
  LEFT JOIN public.layanan AS service ON service.id = visit.layanan_id
  WHERE visit.qr_token = p_token
$$;
REVOKE EXECUTE ON FUNCTION public.get_skm_context(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_skm_context(text) TO anon, authenticated;

CREATE FUNCTION public.submit_skm_response(
  p_token text,
  p_u1 integer,
  p_u2 integer,
  p_u3 integer,
  p_u4 integer,
  p_u5 integer,
  p_u6 integer,
  p_u7 integer,
  p_u8 integer,
  p_u9 integer,
  p_saran text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  trusted_visit_id uuid;
  trusted_layanan_id uuid;
BEGIN
  IF p_token IS NULL OR length(p_token) < 16 OR
     p_u1 NOT BETWEEN 1 AND 4 OR p_u2 NOT BETWEEN 1 AND 4 OR
     p_u3 NOT BETWEEN 1 AND 4 OR p_u4 NOT BETWEEN 1 AND 4 OR
     p_u5 NOT BETWEEN 1 AND 4 OR p_u6 NOT BETWEEN 1 AND 4 OR
     p_u7 NOT BETWEEN 1 AND 4 OR p_u8 NOT BETWEEN 1 AND 4 OR
     p_u9 NOT BETWEEN 1 AND 4 OR length(COALESCE(p_saran, '')) > 2000 THEN
    RETURN 'invalid';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.visit AS visit WHERE visit.qr_token = p_token) THEN
    RETURN 'not_found';
  END IF;

  SELECT visit.id, visit.layanan_id
  INTO trusted_visit_id, trusted_layanan_id
  FROM public.visit AS visit
  WHERE visit.qr_token = p_token AND visit.status = 'selesai'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 'not_completed';
  END IF;

  BEGIN
    INSERT INTO public.skm_respons (
      visit_id, layanan_id,
      u1_persyaratan, u2_prosedur, u3_waktu, u4_biaya, u5_produk,
      u6_kompetensi, u7_perilaku, u8_sarana, u9_pengaduan, saran
    ) VALUES (
      trusted_visit_id, trusted_layanan_id,
      p_u1, p_u2, p_u3, p_u4, p_u5, p_u6, p_u7, p_u8, p_u9,
      NULLIF(trim(p_saran), '')
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN 'duplicate';
  END;

  RETURN 'submitted';
END
$$;
REVOKE EXECUTE ON FUNCTION public.submit_skm_response(text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_skm_response(text, integer, integer, integer, integer, integer, integer, integer, integer, integer, text) TO anon, authenticated;

CREATE FUNCTION public.get_public_umkm()
RETURNS TABLE (
  id uuid,
  nama_umkm text,
  kategori_kebutuhan text,
  sisi text,
  deskripsi text,
  foto_produk text[],
  status text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT listing.id, listing.nama_umkm, listing.kategori_kebutuhan,
    listing.sisi, listing.deskripsi, listing.foto_produk, listing.status,
    listing.created_at, listing.updated_at
  FROM public.listing_umkm AS listing
  WHERE listing.status = 'published'
$$;
REVOKE EXECUTE ON FUNCTION public.get_public_umkm() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_umkm() TO anon, authenticated;

CREATE FUNCTION public.queue_notifikasi(
  p_tujuan_user_id uuid,
  p_tujuan_email text,
  p_kanal text,
  p_subjek text,
  p_body text,
  p_payload jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  notification_id uuid;
  stable_key text;
BEGIN
  stable_key := CASE
    WHEN p_payload ? 'visit_id' THEN 'visit:' || (p_payload->>'visit_id') || ':' || COALESCE(p_payload->>'type', p_kanal)
    WHEN p_payload ? 'listing_id' THEN 'listing:' || (p_payload->>'listing_id') || ':' || COALESCE(p_payload->>'type', p_kanal)
    ELSE NULL
  END;

  INSERT INTO public.notifikasi (
    tujuan_user_id, tujuan_email, kanal, subjek, body, payload, idempotency_key
  )
  VALUES (
    p_tujuan_user_id, p_tujuan_email, p_kanal, p_subjek, p_body, p_payload, stable_key
  )
  ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL AND stable_key IS NOT NULL THEN
    SELECT n.id INTO notification_id
    FROM public.notifikasi AS n
    WHERE n.idempotency_key = stable_key
    LIMIT 1;
  END IF;

  RETURN notification_id;
END
$$;
REVOKE EXECUTE ON FUNCTION public.queue_notifikasi(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.claim_notifikasi(
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
        OR (p_status = 'failed' AND n.retry_count < 3)
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

CREATE FUNCTION public.complete_notifikasi(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  updated_count integer;
BEGIN
  IF p_status NOT IN ('sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'invalid complete status: %', p_status;
  END IF;

  UPDATE public.notifikasi AS n
  SET
    status = p_status,
    error = p_error,
    sent_at = CASE WHEN p_status = 'sent' THEN pg_catalog.now() ELSE n.sent_at END,
    retry_count = CASE
      WHEN p_status = 'failed' THEN n.retry_count + 1
      ELSE n.retry_count
    END,
    available_at = CASE
      WHEN p_status = 'failed' THEN pg_catalog.now() + INTERVAL '5 minutes'
      ELSE n.available_at
    END,
    claim_token = NULL,
    claimed_at = NULL
  WHERE n.id = p_id
    AND n.claim_token = p_claim_token
    AND n.status = 'processing';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END
$$;
REVOKE EXECUTE ON FUNCTION public.complete_notifikasi(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_notifikasi(uuid, uuid, text, text) TO service_role;

CREATE FUNCTION public.notify_visit_selesai()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recipient_email text;
  recipient_user_id uuid;
  public_url text;
  skm_url text;
BEGIN
  SELECT visitor.email, visitor.auth_user_id
  INTO recipient_email, recipient_user_id
  FROM public.pengunjung AS visitor
  WHERE visitor.id = NEW.pengunjung_id;

  SELECT setting.value INTO public_url
  FROM public.site_settings AS setting WHERE setting.key = 'public_url';

  public_url := COALESCE(public_url, 'https://lmh.lampungprov.go.id');
  skm_url := public_url || '/skm?token=' || NEW.qr_token;

  IF NEW.status = 'selesai' AND OLD.status IS DISTINCT FROM 'selesai' THEN
    IF recipient_email IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        NULL, recipient_email, 'email',
        'Survei Kepuasan Masyarakat - DPMPTSP Lampung',
        'Layanan Anda telah selesai. Mohon isi survei: ' || skm_url,
        pg_catalog.jsonb_build_object('visit_id', NEW.id, 'type', 'skm_survey')
      );
    END IF;
    IF recipient_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        recipient_user_id, NULL, 'web_push',
        'Layanan Selesai - Isi Survei SKM',
        'Layanan Anda telah selesai. Mohon isi survei: ' || skm_url,
        pg_catalog.jsonb_build_object('visit_id', NEW.id, 'type', 'skm_survey_push')
      );
    END IF;
  END IF;

  IF NEW.status = 'menunggu' AND OLD.status IS DISTINCT FROM 'menunggu' THEN
    IF recipient_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        recipient_user_id, NULL, 'web_push',
        'Anda masuk antrean',
        'Anda masuk antrean. Mohon menunggu giliran di DPMPTSP Lampung.',
        pg_catalog.jsonb_build_object('visit_id', NEW.id, 'type', 'visit_menunggu')
      );
    END IF;
  END IF;

  IF NEW.status = 'dilayani' AND OLD.status IS DISTINCT FROM 'dilayani' THEN
    IF recipient_user_id IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        recipient_user_id, NULL, 'web_push',
        'Giliran Anda dimulai',
        'Giliran Anda dimulai. Silakan menuju loket layanan.',
        pg_catalog.jsonb_build_object('visit_id', NEW.id, 'type', 'visit_dilayani')
      );
    END IF;
  END IF;

  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.notify_visit_selesai() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.notify_umkm_approved()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  recipient_email text;
BEGIN
  IF NEW.status = 'published' AND OLD.status IS DISTINCT FROM 'published' THEN
    SELECT owner.email INTO recipient_email
    FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = NEW.id
    ORDER BY owner.created_at
    LIMIT 1;
    IF recipient_email IS NOT NULL THEN
      PERFORM public.queue_notifikasi(
        NULL, recipient_email, 'email',
        'Listing UMKM Anda Disetujui - DPMPTSP Lampung',
        'Listing "' || NEW.nama_umkm || '" telah disetujui dan tayang di marketplace.',
        pg_catalog.jsonb_build_object('listing_id', NEW.id, 'type', 'umkm_approved')
      );
    END IF;
  END IF;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.notify_umkm_approved() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON TABLE public.anon_rate_limit FROM anon, authenticated;
REVOKE ALL ON TABLE public.audit_log FROM anon;

ALTER TABLE public.layanan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.petugas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pengunjung ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.absensi_petugas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faq_knowledge_base ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sesi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_pesan ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_ai_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_umkm ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_listing_owner ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.umkm_inquiry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investment_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investasi_lead ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anon_rate_limit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.skm_respons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifikasi ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "layanan_public_read" ON public.layanan FOR SELECT USING (true);
CREATE POLICY "petugas_admin_full" ON public.petugas FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "petugas_self_read" ON public.petugas FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());
CREATE POLICY "pengunjung_self_select" ON public.pengunjung FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR public.get_my_role() = 'admin');
CREATE POLICY "pengunjung_self_insert" ON public.pengunjung FOR INSERT TO authenticated
  WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY "pengunjung_self_update" ON public.pengunjung FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
CREATE POLICY "settings_public_read" ON public.site_settings FOR SELECT USING (true);
CREATE POLICY "settings_admin_all" ON public.site_settings FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "landing_public_read" ON public.landing_content FOR SELECT USING (is_active = true);
CREATE POLICY "landing_admin_all" ON public.landing_content FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');

CREATE POLICY "absensi_select_own" ON public.absensi_petugas FOR SELECT TO authenticated
  USING (petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid()) OR public.get_my_role() = 'admin');
CREATE POLICY "absensi_insert_own" ON public.absensi_petugas FOR INSERT TO authenticated
  WITH CHECK (petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid()) OR public.get_my_role() = 'admin');
CREATE POLICY "absensi_update_own" ON public.absensi_petugas FOR UPDATE TO authenticated
  USING (petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid()) OR public.get_my_role() = 'admin')
  WITH CHECK (petugas_id IN (SELECT id FROM public.petugas WHERE auth_user_id = auth.uid()) OR public.get_my_role() = 'admin');

CREATE POLICY "visit_insert_walk_in" ON public.visit FOR INSERT TO authenticated
  WITH CHECK (asal = 'walk_in' AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('visit_insert_walk_in', 5, 60)));
CREATE POLICY "visit_insert_reservasi" ON public.visit FOR INSERT TO authenticated
  WITH CHECK (asal = 'reservasi' AND pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid()));
CREATE POLICY "visit_select_own" ON public.visit FOR SELECT TO authenticated
  USING (pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
CREATE POLICY "visit_update_staff" ON public.visit FOR UPDATE TO authenticated
  USING (layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin')
  WITH CHECK (layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');

CREATE POLICY "faq_public_read" ON public.faq_knowledge_base FOR SELECT USING (aktif = true);
CREATE POLICY "faq_admin_all" ON public.faq_knowledge_base FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "chat_sesi_owner_select" ON public.chat_sesi FOR SELECT TO authenticated
  USING (pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
CREATE POLICY "chat_sesi_owner_insert" ON public.chat_sesi FOR INSERT TO authenticated
  WITH CHECK (pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('chat_sesi_insert', 3, 60)));
CREATE POLICY "chat_sesi_petugas_update" ON public.chat_sesi FOR UPDATE TO authenticated
  USING (pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin')
  WITH CHECK (pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
CREATE POLICY "chat_pesan_owner_select" ON public.chat_pesan FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.chat_sesi WHERE id = chat_pesan.sesi_id AND (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin')));
CREATE POLICY "chat_pesan_owner_insert" ON public.chat_pesan FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.chat_sesi WHERE id = chat_pesan.sesi_id AND (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR (pengirim = 'petugas' AND layanan_id = public.get_my_layanan_id())
    OR public.get_my_role() = 'admin'))
    AND (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('chat_pesan_insert', 20, 60)));
CREATE POLICY "chat_ai_log_admin_select" ON public.chat_ai_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'admin');

CREATE POLICY "listing_admin_all" ON public.listing_umkm FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "listing_staff_insert" ON public.listing_umkm FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('admin', 'petugas'));
CREATE POLICY "listing_umkm_select_own" ON public.listing_umkm FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = listing_umkm.id AND lower(owner.email) = lower(auth.jwt()->>'email'))
    OR public.get_my_role() = 'admin');
CREATE POLICY "listing_umkm_update_own" ON public.listing_umkm FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = listing_umkm.id AND lower(owner.email) = lower(auth.jwt()->>'email'))
    OR public.get_my_role() = 'admin')
  WITH CHECK ((EXISTS (SELECT 1 FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = listing_umkm.id AND lower(owner.email) = lower(auth.jwt()->>'email'))
    OR public.get_my_role() = 'admin')
    AND (status NOT IN ('published') OR public.get_my_role() = 'admin'));
CREATE POLICY "umkm_owner_select_own" ON public.umkm_listing_owner FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt()->>'email') OR public.get_my_role() = 'admin');
CREATE POLICY "umkm_owner_admin_all" ON public.umkm_listing_owner FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "umkm_inquiry_insert" ON public.umkm_inquiry FOR INSERT TO authenticated
  WITH CHECK (length(trim(from_email)) > 0 AND (
    public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('umkm_inquiry', 5, 3600)));
CREATE POLICY "umkm_inquiry_select_owner" ON public.umkm_inquiry FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = umkm_inquiry.listing_id AND lower(owner.email) = lower(auth.jwt()->>'email'))
    OR public.get_my_role() = 'admin');
CREATE POLICY "umkm_inquiry_update_owner" ON public.umkm_inquiry FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = umkm_inquiry.listing_id AND lower(owner.email) = lower(auth.jwt()->>'email'))
    OR public.get_my_role() = 'admin')
  WITH CHECK (EXISTS (SELECT 1 FROM public.umkm_listing_owner AS owner
    WHERE owner.listing_id = umkm_inquiry.listing_id AND lower(owner.email) = lower(auth.jwt()->>'email'))
    OR public.get_my_role() = 'admin');

CREATE POLICY "investment_public_read" ON public.investment_documents FOR SELECT USING (status = 'aktif');
CREATE POLICY "investment_admin_all" ON public.investment_documents FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "investasi_lead_insert" ON public.investasi_lead FOR INSERT TO authenticated
  WITH CHECK (public.get_my_role() IN ('petugas', 'admin') OR public.check_anon_rate('investasi_lead_insert', 3, 3600));
CREATE POLICY "investasi_lead_select_staff" ON public.investasi_lead FOR SELECT TO authenticated
  USING (public.get_my_role() IN ('admin', 'petugas'));
CREATE POLICY "investasi_lead_update_admin" ON public.investasi_lead FOR UPDATE TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "audit_log_admin_select" ON public.audit_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'admin');
CREATE POLICY "consent_log_insert_own" ON public.consent_log FOR INSERT TO authenticated
  WITH CHECK (
    subjek_ref = auth.uid()::text
    OR subjek_ref IN (
      SELECT id::text FROM public.pengunjung WHERE auth_user_id = auth.uid()
    )
  );
CREATE POLICY "consent_log_admin_select" ON public.consent_log FOR SELECT TO authenticated
  USING (public.get_my_role() = 'admin');
CREATE POLICY "skm_select_staff" ON public.skm_respons FOR SELECT TO authenticated
  USING (layanan_id = public.get_my_layanan_id() OR public.get_my_role() = 'admin');
CREATE POLICY "notifikasi_select_own" ON public.notifikasi FOR SELECT TO authenticated
  USING (tujuan_user_id = auth.uid() OR public.get_my_role() = 'admin');
CREATE POLICY "notifikasi_admin_all" ON public.notifikasi FOR ALL TO authenticated
  USING (public.get_my_role() = 'admin') WITH CHECK (public.get_my_role() = 'admin');
CREATE POLICY "push_sub_self_select" ON public.push_subscriptions FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "push_sub_self_insert" ON public.push_subscriptions FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "push_sub_self_delete" ON public.push_subscriptions FOR DELETE TO authenticated USING (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public)
VALUES ('investment-docs', 'investment-docs', false), ('umkm-photos', 'umkm-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

CREATE POLICY "investment_docs_admin_select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] IN ('_raw', 'pages') AND public.get_my_role() = 'admin');
CREATE POLICY "investment_docs_admin_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] IN ('_raw', 'pages') AND public.get_my_role() = 'admin');
CREATE POLICY "investment_docs_admin_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] IN ('_raw', 'pages') AND public.get_my_role() = 'admin')
  WITH CHECK (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] IN ('_raw', 'pages') AND public.get_my_role() = 'admin');
CREATE POLICY "investment_docs_admin_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'investment-docs' AND (storage.foldername(name))[1] IN ('_raw', 'pages') AND public.get_my_role() = 'admin');
CREATE POLICY "umkm_photos_public_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'umkm-photos');
CREATE POLICY "umkm_photos_staff_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'umkm-photos' AND public.get_my_role() IN ('admin', 'petugas'));
CREATE POLICY "umkm_photos_staff_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'umkm-photos' AND public.get_my_role() IN ('admin', 'petugas'))
  WITH CHECK (bucket_id = 'umkm-photos' AND public.get_my_role() IN ('admin', 'petugas'));
CREATE POLICY "umkm_photos_staff_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'umkm-photos' AND public.get_my_role() IN ('admin', 'petugas'));

CREATE TRIGGER update_site_settings_updated_at BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_landing_content_updated_at BEFORE UPDATE ON public.landing_content
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_pengunjung_updated_at BEFORE UPDATE ON public.pengunjung
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_visit_updated BEFORE UPDATE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_chat_sesi_updated_at BEFORE UPDATE ON public.chat_sesi
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_faq_knowledge_base_updated_at BEFORE UPDATE ON public.faq_knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_listing_umkm_updated_at BEFORE UPDATE ON public.listing_umkm
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trigger_investment_documents_updated_at BEFORE UPDATE ON public.investment_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_investasi_lead_updated BEFORE UPDATE ON public.investasi_lead
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_umkm_inquiry_updated BEFORE UPDATE ON public.umkm_inquiry
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER trg_log_visit_insert AFTER INSERT ON public.visit
  FOR EACH ROW WHEN (NEW.asal = 'walk_in')
  EXECUTE FUNCTION public.log_anon_action('visit_insert_walk_in');
CREATE TRIGGER trg_log_chat_sesi_insert AFTER INSERT ON public.chat_sesi
  FOR EACH ROW EXECUTE FUNCTION public.log_anon_action('chat_sesi_insert');
CREATE TRIGGER trg_log_chat_pesan_insert AFTER INSERT ON public.chat_pesan
  FOR EACH ROW EXECUTE FUNCTION public.log_anon_action('chat_pesan_insert');
CREATE TRIGGER trg_log_investasi_lead_insert AFTER INSERT ON public.investasi_lead
  FOR EACH ROW EXECUTE FUNCTION public.log_anon_action('investasi_lead_insert');
CREATE TRIGGER trg_log_umkm_inquiry_insert AFTER INSERT ON public.umkm_inquiry
  FOR EACH ROW EXECUTE FUNCTION public.log_anon_action('umkm_inquiry');

CREATE TRIGGER trg_audit_visit_status AFTER UPDATE OF status ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('update_status');
CREATE TRIGGER trg_audit_umkm_status AFTER UPDATE OF status ON public.listing_umkm
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('update_status');
CREATE TRIGGER trg_audit_petugas_insert AFTER INSERT ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('insert_petugas');
CREATE TRIGGER trg_audit_petugas_delete AFTER DELETE ON public.petugas
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('delete_petugas');
CREATE TRIGGER trg_audit_investment_insert AFTER INSERT ON public.investment_documents
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('upload_dok');
CREATE TRIGGER trg_audit_investment_delete AFTER DELETE ON public.investment_documents
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('delete_dok');
CREATE TRIGGER trg_audit_investasi_lead_status AFTER UPDATE OF status ON public.investasi_lead
  FOR EACH ROW EXECUTE FUNCTION public.audit_change('update_status');
CREATE TRIGGER trg_notify_visit_selesai AFTER UPDATE OF status ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.notify_visit_selesai();
CREATE TRIGGER trg_notify_umkm_approved AFTER UPDATE OF status ON public.listing_umkm
  FOR EACH ROW EXECUTE FUNCTION public.notify_umkm_approved();

COMMIT;
