-- Rollback manual 202611030005. BUKAN migrasi. Menghapus kolom lampiran chat (objek di R2 tidak dihapus).
DROP INDEX IF EXISTS public.chat_pesan_lampiran_created;
ALTER TABLE public.chat_pesan DROP CONSTRAINT IF EXISTS chat_pesan_lampiran_valid;
ALTER TABLE public.chat_pesan DROP COLUMN IF EXISTS lampiran_nama, DROP COLUMN IF EXISTS lampiran_ukuran, DROP COLUMN IF EXISTS lampiran_mime, DROP COLUMN IF EXISTS lampiran_kunci;
