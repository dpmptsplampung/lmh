-- Rollback manual migrasi 202610070001 (pakai hanya bila dibutuhkan).
DROP TRIGGER IF EXISTS trg_bump_chat_sesi_on_pesan ON public.chat_pesan;
DROP FUNCTION IF EXISTS public.bump_chat_sesi_updated_at();
DROP FUNCTION IF EXISTS public.chat_sesi_ringkas(integer, boolean);
DROP INDEX IF EXISTS public.idx_chat_pesan_sesi_created;
CREATE OR REPLACE FUNCTION public.guard_chat_sesi_staff_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE caller_role text;
BEGIN
  caller_role := public.get_my_role();
  IF caller_role IN ('petugas', 'admin') THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Pengunjung tidak boleh mengubah status sesi chat';
  END IF;
  IF NEW.ditangani_oleh IS DISTINCT FROM OLD.ditangani_oleh THEN
    RAISE EXCEPTION 'Pengunjung tidak boleh mengubah penanganan sesi chat';
  END IF;
  RETURN NEW;
END $$;
