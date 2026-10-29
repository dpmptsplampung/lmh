-- 202611030005_chat_lampiran.sql
-- Lampiran foto pada live chat (disimpan di Cloudflare R2, area chat-lampiran). Empat kolom di chat_pesan; semuanya NULL (pesan
-- biasa) atau semuanya terisi (pesan dengan lampiran). Tidak ada policy baru: RLS chat_pesan yang ada berlaku untuk kolom baru.
-- Batas: 5 MB, jpeg/png/webp (keputusan pemilik). Retensi 90 hari dijalankan api/chat/lampiran/bersihkan (cron).
-- ROLLBACK: docs/rollback-chat-lampiran-202611030005.sql.
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.chat_pesan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.chat_pesan belum ada';
  END IF;
END $$;

ALTER TABLE public.chat_pesan ADD COLUMN IF NOT EXISTS lampiran_kunci  text;
ALTER TABLE public.chat_pesan ADD COLUMN IF NOT EXISTS lampiran_mime   text;
ALTER TABLE public.chat_pesan ADD COLUMN IF NOT EXISTS lampiran_ukuran integer;
ALTER TABLE public.chat_pesan ADD COLUMN IF NOT EXISTS lampiran_nama   text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conname = 'chat_pesan_lampiran_valid' AND conrelid = 'public.chat_pesan'::regclass) THEN
    ALTER TABLE public.chat_pesan ADD CONSTRAINT chat_pesan_lampiran_valid CHECK (
      (lampiran_kunci IS NULL AND lampiran_mime IS NULL AND lampiran_ukuran IS NULL AND lampiran_nama IS NULL)
      OR (
        lampiran_kunci IS NOT NULL AND lampiran_mime IS NOT NULL AND lampiran_ukuran IS NOT NULL AND lampiran_nama IS NOT NULL
        AND lampiran_ukuran BETWEEN 1 AND 5242880
        AND lampiran_mime IN ('image/jpeg', 'image/png', 'image/webp')
        AND pg_catalog.char_length(lampiran_nama) <= 120
        AND pg_catalog.char_length(lampiran_kunci) <= 300
      )
    );
  END IF;
END $$;

-- Pembersihan: cari lampiran lama dengan cepat.
CREATE INDEX IF NOT EXISTS chat_pesan_lampiran_created ON public.chat_pesan (created_at) WHERE lampiran_kunci IS NOT NULL;
