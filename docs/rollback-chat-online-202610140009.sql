-- docs/rollback-chat-online-202610140009.sql
-- Rollback 202610140009_chat_online.sql (Tahap C, C1-DB). BUKAN migrasi: dijalankan manual HANYA atas keputusan CEO,
-- atomik (node scripts/apply-migration.mjs docs/rollback-chat-online-202610140009.sql --atomic --dry-run dulu).
-- Jalankan SEBELUM rollback 202610140005/0004/0003 (bila semuanya hendak dibatalkan).
--
-- Mengembalikan katalog persis ke keadaan sebelum 0009:
--   - RPC chat_ambil / chat_teruskan / chat_selesai, fungsi internal chat_*, trigger penjaga & eskalasi (chat_sesi dan
--     chat_pesan) dihapus;
--   - boleh_penanganan (versi 202610140003) dan boleh_kunjungan (versi 202610090001) dipulihkan apa adanya;
--   - indeks baru dan kolom chat_sesi.kunjungan_id dihapus.
-- DATA TIDAK DIHAPUS: kunjungan asal 'online' dan baris penanganan saluran 'chat' yang sudah tercipta tetap ada
-- (sah menurut skema 0003). Akibat: tahap chat 'menunggu' tetap tampil di kotak masuk FO tetapi tidak bisa diambil
-- (fo_ambil_dari_kotak_masuk menolak SALURAN_CHAT). Bila CEO memutuskan membersihkannya, gunakan blok OPSIONAL di
-- bawah (dikomentari; menghapus catatan layanan online, tidak bisa dibatalkan).
-- Setelah rollback, aksi lama /api/chat/sesi (takeover/kembali_ke_bot/selesaikan) kembali diterima DB.
-- URUTAN: rollback 202610140012 (perbaikan review; job tutup_chat_tertinggal memakai objek 0009) WAJIB lebih dulu;
-- penjaga di bawah menolak bila 0012 masih terpasang.

DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.form_pendataan_dari_nama(text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.tutup_chat_tertinggal()') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140012 masih terpasang (jalankan docs/rollback-perbaikan-review-202610140012.sql dulu)';
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_chat_pesan_eskalasi_kunjungan ON public.chat_pesan;
DROP TRIGGER IF EXISTS trg_chat_sesi_eskalasi_kunjungan ON public.chat_sesi;
DROP TRIGGER IF EXISTS trg_chat_sesi_jaga_rpc ON public.chat_sesi;

DROP FUNCTION IF EXISTS public.chat_ambil(uuid, text);
DROP FUNCTION IF EXISTS public.chat_teruskan(uuid, uuid, uuid, text);
DROP FUNCTION IF EXISTS public.chat_selesai(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.chat_pesan_eskalasi_kunjungan();
DROP FUNCTION IF EXISTS public.chat_sesi_eskalasi_kunjungan();
DROP FUNCTION IF EXISTS public.chat_sesi_jaga_rpc();
DROP FUNCTION IF EXISTS public.chat_buat_kunjungan(uuid, text, date);
DROP FUNCTION IF EXISTS public.chat_pesan_sistem(uuid, text, text);
DROP FUNCTION IF EXISTS public.chat_ubah_sesi(uuid, text, uuid, uuid);

-- guard_chat_sesi_staff_columns: versi 202610070001 (persis).
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

-- boleh_penanganan: versi 202610140003 (persis).
CREATE OR REPLACE FUNCTION public.boleh_penanganan(
  p_kunjungan   uuid,
  p_peran_tahap text,
  p_layanan     uuid,
  p_penangan    uuid,
  p_status      text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id      uuid;
  v_role    text;
  v_layanan uuid;
BEGIN
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_saya() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  IF v_role = 'front_office' THEN
    IF p_penangan = v_id OR (p_peran_tahap = 'fo' AND p_status = 'menunggu') THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p
      WHERE p.kunjungan_id = p_kunjungan
        AND (p.penangan_id = v_id OR (p.peran_tahap = 'fo' AND p.status = 'menunggu'))
    );
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;

-- boleh_kunjungan: versi 202610090001 (persis).
CREATE OR REPLACE FUNCTION public.boleh_kunjungan(p_kunjungan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.staf_saya() AS me WHERE me.role IN ('admin', 'front_office'))
      OR EXISTS (
        SELECT 1 FROM public.tiket_antrean AS t
        WHERE t.kunjungan_id = p_kunjungan AND public.boleh_layanan(t.layanan_id)
      )
$$;

REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;

DROP INDEX IF EXISTS public.idx_penanganan_kotak_masuk_chat;
DROP INDEX IF EXISTS public.idx_penanganan_chat_sesi;
DROP INDEX IF EXISTS public.uq_kunjungan_online_chat_sesi;
DROP INDEX IF EXISTS public.uq_chat_sesi_kunjungan;
ALTER TABLE public.chat_sesi DROP COLUMN IF EXISTS kunjungan_id;

-- OPSIONAL (hanya atas keputusan CEO; menghapus catatan layanan online):
-- DELETE FROM public.penanganan WHERE saluran = 'chat';
-- DELETE FROM public.kunjungan WHERE asal = 'online';
