-- docs/rollback-fo-keterbukaan-data-202610140013.sql
-- Rollback manual migrasi 202610140013_fo_keterbukaan_data.sql. BUKAN migrasi: dijalankan manual HANYA atas keputusan
-- CEO, ATOMIK (dry-run dulu):
--   node scripts/apply-migration.mjs docs/rollback-fo-keterbukaan-data-202610140013.sql --atomic --dry-run
--   node scripts/apply-migration.mjs docs/rollback-fo-keterbukaan-data-202610140013.sql --atomic
-- URUTAN: rollback ini PERTAMA (sebelum rollback 202610140012, 202610140011, 202610140009, ...). Rollback 0012 menolak
-- dijalankan selama penanda 0013 (komentar boleh_penanganan) masih ada.
--
-- Yang dikembalikan: boleh_penanganan <- 202610140009_chat_online.sql (PERSIS, diuji fo_keterbukaan.test.ts) + hak sama;
-- komentar fungsi dihapus (versi 0009 tidak berkomentar). FO kembali hanya membaca tahap miliknya, kotak masuk FO, dan
-- tahap lain dari kunjungan yang pernah ia sentuh.
-- KLIEN: kode yang ditulis untuk 0013 tetap berjalan tanpa galat (hanya membaca lebih sedikit baris lewat RLS): rekap FO
-- dan tab Rekap Petugas Layanan untuk FO menjadi tidak lengkap tanpa catatan keterbatasan. Bila rollback ini permanen,
-- kembalikan juga filter "milik sendiri" di src/lib/rekap/penanganan.ts (tentukanCakupan) dan catatan di
-- RekapPenangananTable.
-- Idempoten (CREATE OR REPLACE / COMMENT).

DO $$
BEGIN
  -- 202610290001 (Fase 3, Koordinator) harus di-rollback lebih dulu (penanda: komentar boleh_penanganan).
  IF COALESCE(pg_catalog.obj_description(
       pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)'), 'pg_proc'), '') LIKE '%202610290001%' THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610290001 masih terpasang (jalankan docs/rollback-koordinator-akses-data-202610290001.sql dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: boleh_penanganan tidak ada (keadaan tak terduga)';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_buat_kunjungan(uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION 'ROLLBACK DITOLAK: 202610140009 tidak terpasang (versi boleh_penanganan 0009 memakai kunjungan.chat_sesi_id)';
  END IF;
END $$;

-- boleh_penanganan <- 202610140009_chat_online.sql (persis)
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
    ) OR EXISTS (
      -- Tahap C: kunjungan chat yang sesinya sedang berada di layanan petugas (ambil langsung / setelah diteruskan).
      SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
      WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS NULL;
