-- WP-25 / CHT-01..09, CHT-11: Chat persisten - schema additions.
-- ADITIF: chat_sesi and chat_pesan columns are expanded only.

-- BOT-06: Tag bot answer type for future RAG/FAQ attribution.
ALTER TABLE public.chat_pesan
  ADD COLUMN IF NOT EXISTS jenis_jawaban text;
  -- values: 'faq' | 'rag' | 'langsung' | NULL (non-bot messages)

-- CHT-07: Index for dashboard sort by longest-waiting session.
CREATE INDEX IF NOT EXISTS idx_chat_sesi_status_updated
  ON public.chat_sesi(status, updated_at ASC)
  WHERE status IN ('bot', 'eskalasi');

-- CHT-09: Fast lookup for unread count per session.
CREATE INDEX IF NOT EXISTS idx_chat_pesan_sesi_created
  ON public.chat_pesan(sesi_id, created_at DESC);
