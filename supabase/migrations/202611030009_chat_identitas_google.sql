-- 202611030009_chat_identitas_google.sql
-- G1 putaran 2, R1: pengunjung chat wajib identitas Google dari Auth tepercaya.
-- Hanya DDL; tidak mengubah data historis. DILARANG menerapkan berkas ini oleh worker.
-- Pemilik: terapkan hanya setelah staging lolos, secara atomik mengikuti docs/ATURAN_MIGRASI.md.
-- ROLLBACK: docs/rollback-chat-identitas-google-202611030009.sql (manual, bukan migrasi).
--
-- Kontrak identik dengan src/lib/chat/identitas-google.ts dan gerbang-google.ts:
--   anonim ditolak sebelum klasifikasi; staf AKTIF (admin/petugas/front_office) boleh memakai sandi;
--   pengunjung nonanonim harus punya identities.provider=google ATAU app_metadata.provider/providers=google.
--   user_metadata dan pengunjung.provider bukan sumber otorisasi. Petugas nonaktif ditolak, seperti resolveActor.
-- Helper tanpa argumen hanya memberi boolean untuk auth.uid() sendiri, tidak mengekspos tabel Auth ke klien.
-- Biaya: lookup PK auth.users, lookup petugas.auth_user_id, dan EXISTS identitas pengguna; policy memakai initplan.
-- Tidak mengubah batas lama: sesi 3/60 detik, pesan 20/60 detik (pengecualian staf sesuai policy yang sudah ada).

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.chat_sesi') IS NULL
     OR pg_catalog.to_regclass('public.chat_pesan') IS NULL
     OR pg_catalog.to_regprocedure('public.get_my_role()') IS NULL
     OR pg_catalog.to_regprocedure('public.chat_sesi_jaga_rpc()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel chat, get_my_role, dan penjaga RPC chat harus tersedia';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.chat_identitas_diizinkan()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_meta jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Data Auth tersimpan, bukan profil/metadata yang dapat diubah pemanggil.
  SELECT COALESCE(u.raw_app_meta_data, '{}'::jsonb) INTO v_meta
  FROM auth.users AS u
  WHERE u.id = v_uid AND u.is_anonymous IS FALSE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.petugas AS p WHERE p.auth_user_id = v_uid AND p.aktif = false) THEN
    RETURN false;
  END IF;
  IF public.get_my_role() IN ('admin', 'petugas', 'front_office') THEN
    RETURN true;
  END IF;

  RETURN COALESCE(
    EXISTS (SELECT 1 FROM auth.identities AS i WHERE i.user_id = v_uid AND i.provider = 'google')
    OR v_meta ->> 'provider' = 'google'
    OR (pg_catalog.jsonb_typeof(v_meta -> 'providers') = 'array'
        AND v_meta -> 'providers' @> '["google"]'::jsonb),
    false
  );
END $$;

REVOKE ALL ON FUNCTION public.chat_identitas_diizinkan() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_identitas_diizinkan() TO authenticated, service_role;

-- RESTRICTIVE = AND dengan policy permisif yang ada, bukan OR (yang justru membuka akses).
-- chat_sesi_owner_insert dan chat_pesan_owner_insert tetap memeriksa pemilik, pengirim, scope staf, serta rate limit.
-- Pengecualian staf pada helper hanya membebaskan syarat Google, bukan syarat akses atas sebuah sesi.
DROP POLICY IF EXISTS "chat_sesi_identitas_insert" ON public.chat_sesi;
CREATE POLICY "chat_sesi_identitas_insert" ON public.chat_sesi
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.chat_identitas_diizinkan()));

DROP POLICY IF EXISTS "chat_pesan_identitas_insert" ON public.chat_pesan;
CREATE POLICY "chat_pesan_identitas_insert" ON public.chat_pesan
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.chat_identitas_diizinkan()));

-- SECURITY DEFINER dan service_role melewati RLS, tetapi tetap menjalankan trigger.
-- Jangan percaya pengirim='bot' atau lmh.chat_rpc sebagai bukti otorisasi: chat_minta_petugas
-- dipanggil pengunjung dan menulis pesan bot melalui chat_pesan_sistem. Identitas pemanggil tetap wajib sah.
-- Penulis yang diperiksa: chat_pesan_sistem, chat_minta_petugas, chat_ambil, chat_teruskan, chat_selesai,
-- tutup_chat_tertinggal; helper chat_ubah_sesi/chat_buat_kunjungan dan trigger eskalasi tidak menulis pesan langsung.
-- Route messages/ai memakai service_role setelah otorisasi route (gerbang route dimiliki DELTA2).
CREATE OR REPLACE FUNCTION public.chat_jaga_identitas_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Klaim role ditandatangani Auth. Bukan current_user (dapat menjadi postgres di dalam SECURITY DEFINER).
  IF auth.jwt() ->> 'role' = 'service_role' THEN
    RETURN NEW;
  END IF;
  -- pg_cron menjalankan tutup_chat_tertinggal sebagai koneksi DB postgres, tanpa JWT pengguna.
  -- SESSION_USER tidak berubah oleh SECURITY DEFINER; authenticator/akun JWT biasa tidak mendapat pengecualian ini.
  IF SESSION_USER IN ('postgres', 'supabase_admin')
     AND auth.uid() IS NULL
     AND COALESCE(auth.jwt() ->> 'role', '') = '' THEN
    RETURN NEW;
  END IF;
  IF NOT public.chat_identitas_diizinkan() THEN
    RAISE EXCEPTION 'LOGIN_GOOGLE: pengunjung chat wajib masuk dengan akun Google' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.chat_jaga_identitas_insert() FROM PUBLIC, anon, authenticated, service_role;

-- Terpisah dari chat_sesi_jaga_rpc agar pemeriksaan identitas tidak dilewati flag RPC.
-- BEFORE INSERT mencakup jalur tabel langsung dan semua penulis SECURITY DEFINER, termasuk lampiran chat_pesan.
DROP TRIGGER IF EXISTS trg_chat_sesi_identitas_insert ON public.chat_sesi;
CREATE TRIGGER trg_chat_sesi_identitas_insert
  BEFORE INSERT ON public.chat_sesi
  FOR EACH ROW EXECUTE FUNCTION public.chat_jaga_identitas_insert();

DROP TRIGGER IF EXISTS trg_chat_pesan_identitas_insert ON public.chat_pesan;
CREATE TRIGGER trg_chat_pesan_identitas_insert
  BEFORE INSERT ON public.chat_pesan
  FOR EACH ROW EXECUTE FUNCTION public.chat_jaga_identitas_insert();
