-- 202610140013_fo_keterbukaan_data.sql
-- KETERBUKAAN DATA ANTAR FRONT OFFICE (keputusan CEO 2026-10-14): "role FO itu walaupun petugas FO ada banyak, tapi
-- semua antrian, semua pengunjung, rekap, dll itu terbuka untuk semua FO, tapi nanti di setiap pengunjung ada nama
-- petugas FO yang melayani itu siapa." Semua Front Office adalah SATU unit layanan: data tidak dipersempit per FO.
--
-- ISI
--   1. boleh_penanganan (helper RLS policy penanganan_staf_select): cabang 'front_office' kini RETURN true = FO aktif
--      (staf_saya(): petugas.aktif = true, auth.uid() cocok) MEMBACA SEMUA baris penanganan (tahap 'fo' DAN
--      'layanan', semua tanggal, semua FO). Sebelumnya FO hanya membaca tahap miliknya, kotak masuk FO ('fo'
--      'menunggu'), dan tahap lain dari kunjungan yang pernah ia sentuh / sedang menunggu FO.
--      Cabang lain IDENTIK dengan versi 202610140009 (admin semua; petugas: layanannya + konteks kunjungan + chat yang
--      sesinya sedang di layanannya; pengunjung/anon: tidak). Signature, LANGUAGE, STABLE, SECURITY DEFINER,
--      search_path, dan hak (EXECUTE authenticated + service_role) tidak berubah.
--   2. HANYA BACA. Tabel penanganan tetap tanpa policy INSERT/UPDATE/DELETE untuk klien (GRANT SELECT saja,
--      202610140003): penulisan tetap hanya lewat RPC SECURITY DEFINER yang memeriksa pemilik tahap (fo_selesai /
--      fo_eskalasi: BUKAN_PEMILIK; chat_selesai / chat_teruskan: pemilik sesi; fo_ambil_dari_kotak_masuk: atomik
--      SUDAH_DIAMBIL). FO TIDAK mendapat hak tulis baru dan tetap TIDAK dapat menyelesaikan/menolak pekerjaan FO lain.
--   3. Tabel lain TIDAK diubah (sudah terbuka untuk semua FO sejak sebelum migrasi ini, diperiksa 2026-10-14):
--      kunjungan (boleh_kunjungan: admin/front_office semua, 202610090001/0009), tiket_antrean (tiket_staff_select:
--      admin/front_office semua, 202607290013), pelayanan_oss/pelayanan_perizinan (SELECT boleh_tiket ->
--      boleh_layanan: admin/front_office semua, 202610090001; isi Pendataan dibutuhkan kolom "Pendataan" rekap
--      petugas layanan; TULIS tetap pemilik tiket, 202610140002), petugas (petugas_fo_read, 202610090005: nama FO
--      untuk tampilan), chat_sesi (chat_sesi_owner_select: admin/front_office). Tabel pengunjung TIDAK dibuka untuk
--      FO (data yang dibutuhkan sudah disalin ke kunjungan).
--   4. Penanda: COMMENT ON FUNCTION boleh_penanganan memuat '202610140013'. Dipakai penjaga rollback
--      docs/rollback-perbaikan-review-202610140012.sql (menolak selama 0013 masih terpasang) agar urutan rollback
--      0013 -> 0012 -> 0011 -> 0009 ... terjaga (rollback 0009 mengganti boleh_penanganan).
--
-- AUDIT AKSES: tidak ditambah pencatatan per-baca (catatan untuk CEO, bukan fitur): pembacaan terbatas pada staf aktif
--   ber-sesi; setiap ekspor Excel rekap tetap tercatat di audit_log (route ekspor); setiap baris menampilkan nama FO
--   yang melayani (akuntabilitas). Lihat docs/KEBIJAKAN_PDP.md.
-- KLIEN: route /api/admin/rekap/penanganan(+/export) tidak lagi memaksa filter "milik sendiri"/"eskalasi asal dirinya"
--   untuk FO; halaman Penanganan FO, Kotak Masuk FO, Kunjungan, Rekap FO, tab Rekap Petugas Layanan menampilkan nama
--   FO. Klien boleh di-deploy sebelum migrasi ini: tanpa 0013, RLS lama tetap membatasi baris yang terbaca FO (rekap FO
--   menjadi tidak lengkap, bukan bocor). Deploy SETELAH 0013 agar tampilan lengkap.
--
-- SYARAT: 202610140012 (hari_tanpa_layanan) dan 202610140009 (versi boleh_penanganan yang diganti). URUTAN:
--   0002 -> ... -> 0009 -> 0011 -> 0012 -> 0013. PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO):
--   node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic
-- Idempoten. Rollback: docs/rollback-fo-keterbukaan-data-202610140013.sql. Uji perilaku: scripts/test-fo-keterbukaan.mjs.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.penanganan') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel penanganan / boleh_penanganan belum ada (202610140003_fo_model_data)';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_buat_kunjungan(uuid,text,date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140009_chat_online belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.hari_tanpa_layanan(date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610140012_perbaikan_review belum diterapkan';
  END IF;
END $$;

-- ============================================================
-- 1. RLS baca penanganan: semua FO membaca semua tahap
-- ============================================================
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
    -- Keputusan CEO 2026-10-14 (202610140013): semua FO satu unit layanan; baca saja, tulis tetap lewat RPC pemilik.
    RETURN true;
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

COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS
  '202610140013: RLS baca penanganan. Admin & Front Office semua (keputusan CEO 2026-10-14: keterbukaan antar FO, baca saja); petugas layanannya + konteks.';
