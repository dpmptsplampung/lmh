-- Idempotency: client_uuid untuk dedup pesan optimistic vs broadcast.
BEGIN;

ALTER TABLE public.chat_pesan ADD COLUMN IF NOT EXISTS client_uuid uuid;
CREATE INDEX IF NOT EXISTS idx_chat_pesan_client_uuid
  ON public.chat_pesan(sesi_id, client_uuid) WHERE client_uuid IS NOT NULL;

COMMIT;
