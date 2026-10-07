-- CHAT-FIX: guard chat_sesi mengizinkan service_role & front_office, bump
-- updated_at saat ada pesan, dan RPC ringkas daftar sesi (hemat egress).
BEGIN;

-- 1. Guard: sebelumnya service_role (route /api/chat/*) ditolak karena
--    get_my_role() NULL -> status/ditangani_oleh tak pernah berubah.
CREATE OR REPLACE FUNCTION public.guard_chat_sesi_staff_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF auth.role() = 'service_role'
     OR public.get_my_role() IN ('petugas', 'admin', 'front_office') THEN
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

-- 2. Pesan MANUSIA (pengunjung/petugas) menaikkan chat_sesi.updated_at. Pesan bot
--    tidak: ia selalu menyusul pesan pengunjung beberapa detik sebelumnya, jadi
--    bump-nya hanya menambah satu event realtime chat_sesi tanpa informasi baru.
CREATE OR REPLACE FUNCTION public.bump_chat_sesi_updated_at()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.chat_sesi SET updated_at = pg_catalog.now() WHERE id = NEW.sesi_id;
  RETURN NEW;
END
$$;
REVOKE EXECUTE ON FUNCTION public.bump_chat_sesi_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER trg_bump_chat_sesi_on_pesan AFTER INSERT ON public.chat_pesan
  FOR EACH ROW WHEN (NEW.pengirim IN ('pengunjung', 'petugas'))
  EXECUTE FUNCTION public.bump_chat_sesi_updated_at();

CREATE INDEX IF NOT EXISTS idx_chat_pesan_sesi_created
  ON public.chat_pesan(sesi_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sesi_status_updated
  ON public.chat_sesi(status, updated_at DESC);

-- 3. Daftar sesi ringkas (SECURITY INVOKER: RLS chat_sesi/chat_pesan berlaku).
CREATE OR REPLACE FUNCTION public.chat_sesi_ringkas(
  p_limit integer DEFAULT 100,
  p_include_selesai boolean DEFAULT false
)
RETURNS TABLE (
  id uuid, status text, layanan_id uuid, pengunjung_id uuid, ditangani_oleh uuid,
  created_at timestamptz, updated_at timestamptz,
  last_pesan text, last_pesan_at timestamptz, last_pengirim text, unread boolean
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, s.status, s.layanan_id, s.pengunjung_id, s.ditangani_oleh,
         s.created_at, s.updated_at,
         lp.isi, lp.created_at, lp.pengirim,
         COALESCE(lv.created_at > COALESCE(ls.created_at, '-infinity'::timestamptz), false)
  FROM public.chat_sesi s
  LEFT JOIN LATERAL (
    SELECT pg_catalog.left(m.isi, 120) AS isi, m.created_at, m.pengirim
    FROM public.chat_pesan m WHERE m.sesi_id = s.id
    ORDER BY m.created_at DESC LIMIT 1
  ) lp ON true
  LEFT JOIN LATERAL (
    SELECT m.created_at FROM public.chat_pesan m
    WHERE m.sesi_id = s.id AND m.pengirim = 'pengunjung'
    ORDER BY m.created_at DESC LIMIT 1
  ) lv ON true
  LEFT JOIN LATERAL (
    SELECT m.created_at FROM public.chat_pesan m
    WHERE m.sesi_id = s.id AND m.pengirim IN ('bot', 'petugas')
    ORDER BY m.created_at DESC LIMIT 1
  ) ls ON true
  -- Biaya terbatas: eskalasi/aktif selalu; sesi bot hanya 7 hari terakhir;
  -- selesai hanya bila diminta.
  WHERE s.status IN ('eskalasi', 'aktif')
     OR (s.status = 'bot' AND s.updated_at > pg_catalog.now() - interval '7 days')
     OR (p_include_selesai AND s.status = 'selesai')
  ORDER BY COALESCE(lp.created_at, s.updated_at) DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500)
$$;
REVOKE EXECUTE ON FUNCTION public.chat_sesi_ringkas(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_sesi_ringkas(integer, boolean) TO authenticated;

COMMIT;
