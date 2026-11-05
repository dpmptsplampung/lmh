-- Rollback MANUAL 202611030009; bukan migrasi, tidak pernah dijalankan worker.
-- Pemilik: hanya setelah staging lolos dan mengikuti docs/ATURAN_MIGRASI.md.
-- Melepas gerbang ini membuka kembali akses INSERT pengunjung non-Google/anonim sesuai policy lama;
-- pastikan keputusan pemilik sebelum menjalankan rollback secara atomik.
-- Data chat, policy owner/rate limit, penjaga RPC lama, RPC staf/bot, dan lampiran tetap utuh.

DROP TRIGGER IF EXISTS trg_chat_sesi_identitas_insert ON public.chat_sesi;
DROP TRIGGER IF EXISTS trg_chat_pesan_identitas_insert ON public.chat_pesan;

DROP POLICY IF EXISTS "chat_sesi_identitas_insert" ON public.chat_sesi;
DROP POLICY IF EXISTS "chat_pesan_identitas_insert" ON public.chat_pesan;

DROP FUNCTION IF EXISTS public.chat_jaga_identitas_insert();
DROP FUNCTION IF EXISTS public.chat_identitas_diizinkan();
