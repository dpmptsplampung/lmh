-- 202609230003_antrean_realtime.sql
-- Fase 3: realtime antrean & layar + idempotensi check-in. Idempoten.

BEGIN;

-- 1. Publikasi realtime (dijaga agar re-run tidak error).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'tiket_antrean') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tiket_antrean;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'visit') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.visit;
  END IF;
END $$;

ALTER TABLE public.tiket_antrean REPLICA IDENTITY FULL;
ALTER TABLE public.visit REPLICA IDENTITY FULL;

-- 2. Kanal siaran PUBLIK (tanpa PII) untuk layar TV & estimasi pengunjung
--    anonim — postgres_changes menghormati RLS (anon tidak boleh SELECT
--    tiket_antrean), jadi tampilan publik memakai broadcast_changes.
CREATE OR REPLACE FUNCTION public.antrean_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, realtime
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  -- HANYA kolom non-PII: nomor antrean & status. Nama pengunjung tidak ikut.
  v_payload := jsonb_build_object(
    'tiket_id', NEW.id,
    'layanan_id', NEW.layanan_id,
    'nomor_display', NEW.nomor_display,
    'status', NEW.status
  );
  PERFORM realtime.broadcast_changes(
    'antrean:publik'::text, TG_OP::text, TG_OP::text,
    TG_TABLE_NAME::text, TG_TABLE_SCHEMA::text, v_payload, NULL::jsonb
  );
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_antrean_broadcast ON public.tiket_antrean;
CREATE TRIGGER trg_antrean_broadcast
  AFTER INSERT OR UPDATE ON public.tiket_antrean
  FOR EACH ROW EXECUTE FUNCTION public.antrean_broadcast();

-- 3. Kebijakan realtime.messages: siapa boleh menerima topik publik.
DROP POLICY IF EXISTS antrean_publik_receive ON realtime.messages;
CREATE POLICY antrean_publik_receive ON realtime.messages
  FOR SELECT
  USING (topic = 'antrean:publik');

-- 4. Idempotensi check-in: satu kunjungan per client_request_id. Klik ganda /
--    replay antrean offline tidak lagi menghasilkan tiket ganda.
ALTER TABLE public.visit
  ADD COLUMN IF NOT EXISTS client_request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_visit_client_request_id
  ON public.visit(client_request_id)
  WHERE client_request_id IS NOT NULL;

COMMIT;
