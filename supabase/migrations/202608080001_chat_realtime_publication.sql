-- 202608080001_chat_realtime_publication.sql
-- CHAT-REALTIME: aktifkan push postgres_changes untuk dashboard & badge.
-- Tanpa ini, listener .on('postgres_changes', ...) di admin/chat, sidebar,
-- dan halaman pengunjung tidak pernah menerima event -> harus refresh.

ALTER TABLE public.chat_sesi REPLICA IDENTITY FULL;
ALTER TABLE public.chat_pesan REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_sesi;
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_pesan;
