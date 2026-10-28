-- 202611010003_identitas_satu_kesatuan.sql
-- Identitas pengunjung = SATU KESATUAN (keputusan pemilik 2026-10-27). Forward-only; tidak ada DELETE/TRUNCATE/DROP TABLE/
-- DROP COLUMN dan tidak ada UPDATE data lama pada migrasi ini (backfill data lama = migrasi terpisah 202611010004).
--
-- MASALAH
--   `kunjungan` adalah data induk yang diisi Front Office (email OPSIONAL karena banyak pengunjung enggan memberi email pada
--   FO). Pengunjung yang dieskalasi dilengkapi petugas layanan lewat formulir (pelayanan_oss / pelayanan_perizinan) atau
--   Pendataan Khusus, tetapi hasilnya TIDAK kembali ke `kunjungan`: rekap baris FO, saran pengunjung lama, dan email survei
--   (notify_kunjungan_status membaca kunjungan.email) tetap kosong. Email di formulir juga boleh diisi "Tidak berlaku".
--   Sejak Fase 3 FO juga tak bisa membaca hasil lengkap tiket yang sudah selesai.
--
-- ISI
--   1. email_nyata(text): email ternormalkan (huruf kecil, <= 254, format valid) atau NULL; nilai pengganti ("Tidak berlaku",
--      "-", dst.) bukan email.
--   2. kunjungan_email_efektif(kunjungan): email nyata pada kunjungan, atau pada akun pengunjung (login Google/reservasi).
--   3. kunjungan_terapkan_identitas(kunjungan, calon, sumber, rujukan): MENULIS BALIK identitas ke kunjungan. Nilai pengganti
--      dan nilai yang tak lolos validasi diabaikan per kolom; nilai terbaru MENANG (menimpa), hanya kolom yang berubah;
--      audit_log (aksi pendataan_identitas_disatukan) menyimpan nilai lama dan baru. Internal.
--   4. Trigger pada pelayanan_oss / pelayanan_perizinan (formulir SELESAI): email WAJIB nyata (EMAIL_WAJIB), lalu identitas
--      formulir ditulis balik ke kunjungan. Terjadi DI DALAM layanan_selesai SEBELUM kunjungan berstatus selesai, sehingga
--      email survei memakai email baru.
--   5. Trigger tiket_antrean: tiket tidak dapat berstatus selesai bila kunjungannya tidak punya email (EMAIL_WAJIB), jadi
--      aturan berlaku untuk SEMUA jalur penyelesaian layanan (formulir, Pendataan Khusus, tanpa formulir). Kunjungan yang
--      selesai di FO tanpa eskalasi TIDAK terkena.
--   6. layanan_selesai_khusus(+ p_identitas) dan chat_selesai_khusus: identitas dari petugas diterapkan SEBELUM penyelesaian
--      (email survei benar) dan email wajib ada. Fungsi 4 argumen diganti 5 argumen (default NULL; klien lama tetap jalan).
--   7. FO PENCATAT (kunjungan.dibuat_oleh) boleh MEMBACA (read-only) tahap penanganan, formulir pendataan, dan jawaban
--      Pendataan Khusus kunjungan yang ia daftarkan. FO lain dan petugas lain tidak berubah. Rekap tidak berubah.
--
-- KODE GALAT TAMBAHAN: EMAIL_WAJIB (22023, DETAIL = 'email').
-- SYARAT / URUTAN: setelah 202611010002 (dan 202610300002, 202610290001, 202610310001). Diterapkan dalam satu jendela dengan
--   deploy klien (klien lama menampilkan galat generik bila email kosong).
-- PENERAPAN (pemilik; atomik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202611010003_identitas_satu_kesatuan.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202611010003_identitas_satu_kesatuan.sql --atomic
-- ROLLBACK: docs/rollback-identitas-satu-kesatuan-202611010003.sql (identitas yang sudah ditulis balik TIDAK dikembalikan).
-- Idempoten.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.layanan_selesai_khusus(uuid,uuid,text,jsonb)') IS NULL
     AND pg_catalog.to_regprocedure('public.layanan_selesai_khusus(uuid,uuid,text,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610300002_selesai_dengan_pendataan belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.pendataan_identitas_validasi(jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: pendataan_identitas_validasi tidak ada (202610300002)';
  END IF;
  IF pg_catalog.to_regprocedure('public.boleh_penanganan(uuid,text,uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_baca_pendataan(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.boleh_baca_khusus(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: helper RLS Fase 3/4 belum lengkap (202610290001, 202610300001)';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_selesai(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: chat_selesai tidak ada (202610140009)';
  END IF;
END $$;

-- ============================================================
-- 1. email_nyata
-- ============================================================
CREATE OR REPLACE FUNCTION public.email_nyata(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog, public
AS $$
  SELECT CASE
           WHEN x.e = '' OR pg_catalog.char_length(x.e) > 254 THEN NULL
           WHEN x.e ~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN x.e
           ELSE NULL
         END
  FROM (SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(p, ''))) AS e) AS x
$$;

REVOKE ALL ON FUNCTION public.email_nyata(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.email_nyata(text) TO authenticated, service_role;

-- ============================================================
-- 2. kunjungan_email_efektif
-- ============================================================
CREATE OR REPLACE FUNCTION public.kunjungan_email_efektif(p_kunjungan uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(public.email_nyata(k.email), public.email_nyata(v.email))
  FROM public.kunjungan AS k
  LEFT JOIN public.pengunjung AS v ON v.id = k.pengunjung_id
  WHERE k.id = p_kunjungan
$$;

REVOKE ALL ON FUNCTION public.kunjungan_email_efektif(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kunjungan_email_efektif(uuid) TO service_role;

-- ============================================================
-- 3. kunjungan_terapkan_identitas (internal)
-- ============================================================
-- p_calon: objek berkunci nama, kontak_hp, email, asal_instansi, keperluan (teks mentah dari formulir). Mengembalikan nama
-- kolom yang berubah (kosong = tidak ada perubahan).
CREATE OR REPLACE FUNCTION public.kunjungan_terapkan_identitas(
  p_kunjungan uuid,
  p_calon     jsonb,
  p_sumber    text,
  p_rujukan   jsonb DEFAULT NULL
)
RETURNS text[]
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_kunci  text;
  v_mentah text;
  v_ok     jsonb := '{}'::jsonb;
  v_lama   record;
  v_ubah   text[];
  v_lama_j jsonb;
  v_baru_j jsonb;
  v_role   text;
  v_now    timestamptz := pg_catalog.now();
BEGIN
  IF p_kunjungan IS NULL OR p_calon IS NULL OR pg_catalog.jsonb_typeof(p_calon) <> 'object' THEN
    RETURN ARRAY[]::text[];
  END IF;

  FOREACH v_kunci IN ARRAY ARRAY['nama', 'kontak_hp', 'email', 'asal_instansi', 'keperluan'] LOOP
    v_mentah := pg_catalog.btrim(COALESCE(p_calon ->> v_kunci, ''));
    -- Nilai pengganti pengisi formulir bukan data nyata: tidak boleh menimpa data induk.
    IF v_mentah = '' OR pg_catalog.lower(v_mentah) IN ('-', '--', 'tidak berlaku', 'belum ada', 'tidak ada', 'n/a', 'na') THEN
      CONTINUE;
    END IF;
    BEGIN
      v_ok := v_ok || public.pendataan_identitas_validasi(pg_catalog.jsonb_build_object(v_kunci, v_mentah));
    EXCEPTION WHEN SQLSTATE '22023' THEN
      NULL; -- tak lolos aturan format: tidak ditulis balik (kolom lain tetap diproses)
    END;
  END LOOP;

  IF v_ok = '{}'::jsonb THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT k.nama, k.kontak_hp, k.email, k.asal_instansi, k.keperluan INTO v_lama
  FROM public.kunjungan AS k WHERE k.id = p_kunjungan FOR UPDATE;
  IF NOT FOUND OR v_lama.nama = '[anonim]' THEN
    RETURN ARRAY[]::text[];
  END IF;

  SELECT pg_catalog.array_agg(e.key ORDER BY e.key) INTO v_ubah
  FROM pg_catalog.jsonb_each_text(v_ok) AS e
  WHERE e.value IS DISTINCT FROM (pg_catalog.to_jsonb(v_lama) ->> e.key);
  IF v_ubah IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  UPDATE public.kunjungan AS k
     SET nama = COALESCE(v_ok ->> 'nama', k.nama),
         kontak_hp = COALESCE(v_ok ->> 'kontak_hp', k.kontak_hp),
         email = COALESCE(v_ok ->> 'email', k.email),
         asal_instansi = COALESCE(v_ok ->> 'asal_instansi', k.asal_instansi),
         keperluan = COALESCE(v_ok ->> 'keperluan', k.keperluan),
         updated_at = v_now
   WHERE k.id = p_kunjungan;

  SELECT pg_catalog.jsonb_object_agg(x, pg_catalog.to_jsonb(v_lama) -> x) INTO v_lama_j FROM pg_catalog.unnest(v_ubah) AS x;
  SELECT pg_catalog.jsonb_object_agg(e.key, e.value) INTO v_baru_j
    FROM pg_catalog.jsonb_each_text(v_ok) AS e WHERE e.key = ANY (v_ubah);
  SELECT me.role INTO v_role FROM public.staf_lingkup() AS me;

  -- audit_log hanya terbaca Admin dan tidak disentuh anonimisasi retensi (docs/KEBIJAKAN_PDP.md).
  INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
  VALUES (auth.uid(), COALESCE(v_role, 'sistem'), 'pendataan_identitas_disatukan', 'kunjungan', p_kunjungan::text,
          pg_catalog.jsonb_build_object('sumber', p_sumber, 'rujukan', p_rujukan, 'identitas_diubah', pg_catalog.to_jsonb(v_ubah)),
          v_lama_j, v_baru_j);
  RETURN v_ubah;
END $$;

REVOKE ALL ON FUNCTION public.kunjungan_terapkan_identitas(uuid, jsonb, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.kunjungan_terapkan_identitas(uuid, jsonb, text, jsonb) TO service_role;

-- ============================================================
-- 4. Formulir pendataan selesai: email nyata wajib + tulis balik ke kunjungan
-- ============================================================
CREATE OR REPLACE FUNCTION public.pelayanan_form_identitas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_email text;
BEGIN
  IF NEW.status_draft IS DISTINCT FROM 'selesai' THEN
    RETURN NEW; -- draf (autosave) tetap longgar
  END IF;
  -- Hanya saat formulir DISELESAIKAN atau emailnya diubah (data lama yang sudah selesai tidak diperiksa ulang).
  IF TG_OP = 'UPDATE' AND OLD.status_draft = 'selesai' AND NEW.email IS NOT DISTINCT FROM OLD.email THEN
    RETURN NEW;
  END IF;
  v_email := public.email_nyata(NEW.email);
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'EMAIL_WAJIB: email pengunjung wajib diisi dengan alamat email yang valid (bukan "Tidak berlaku" atau "-")'
      USING ERRCODE = '22023', DETAIL = 'email';
  END IF;
  PERFORM public.kunjungan_terapkan_identitas(
    NEW.kunjungan_id,
    pg_catalog.jsonb_build_object('nama', NEW.nama_pemohon, 'kontak_hp', NEW.no_hp, 'email', v_email,
                                  'asal_instansi', NEW.alamat_pemohon, 'keperluan', NEW.keperluan_awal),
    TG_TABLE_NAME, pg_catalog.jsonb_build_object('tiket_id', NEW.tiket_id));
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.pelayanan_form_identitas() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_oss_identitas ON public.pelayanan_oss;
CREATE TRIGGER trg_oss_identitas AFTER INSERT OR UPDATE ON public.pelayanan_oss
  FOR EACH ROW EXECUTE FUNCTION public.pelayanan_form_identitas();
DROP TRIGGER IF EXISTS trg_perizinan_identitas ON public.pelayanan_perizinan;
CREATE TRIGGER trg_perizinan_identitas AFTER INSERT OR UPDATE ON public.pelayanan_perizinan
  FOR EACH ROW EXECUTE FUNCTION public.pelayanan_form_identitas();

-- ============================================================
-- 5. Tiket layanan tidak dapat selesai tanpa email pengunjung
-- ============================================================
CREATE OR REPLACE FUNCTION public.tiket_selesai_wajib_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF public.kunjungan_email_efektif(NEW.kunjungan_id) IS NULL THEN
    RAISE EXCEPTION 'EMAIL_WAJIB: pengunjung yang dieskalasi ke layanan wajib memiliki email yang valid sebelum layanan diselesaikan'
      USING ERRCODE = '22023', DETAIL = 'email';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.tiket_selesai_wajib_email() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tiket_selesai_wajib_email ON public.tiket_antrean;
CREATE TRIGGER trg_tiket_selesai_wajib_email BEFORE UPDATE OF status ON public.tiket_antrean
  FOR EACH ROW
  WHEN (NEW.status = 'selesai' AND OLD.status IS DISTINCT FROM 'selesai')
  EXECUTE FUNCTION public.tiket_selesai_wajib_email();

-- ============================================================
-- 6. layanan_selesai_khusus (+ p_identitas) dan chat_selesai_khusus
-- ============================================================
DROP FUNCTION IF EXISTS public.layanan_selesai_khusus(uuid, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.layanan_selesai_khusus(
  p_tiket_id  uuid,
  p_topik_id  uuid,
  p_catatan   text,
  p_khusus    jsonb DEFAULT NULL,
  p_identitas jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hasil jsonb;
  v_pid   uuid;
  v_lyn   uuid;
  v_me    uuid;
  v_kid   uuid;
  v_ubah  text[];
  v_n     integer := 0;
BEGIN
  -- Identitas dari petugas diterapkan SEBELUM penyelesaian: email survei memakai nilai baru, dan trigger tiket menuntut email.
  -- Peran/sesi/kepemilikan ditegakkan layanan_selesai di bawah; bila ditolak, seluruh transaksi (termasuk ini) dibatalkan.
  SELECT t.kunjungan_id INTO v_kid FROM public.tiket_antrean AS t WHERE t.id = p_tiket_id;
  IF v_kid IS NOT NULL AND p_identitas IS NOT NULL THEN
    v_ubah := public.kunjungan_terapkan_identitas(
      v_kid, public.pendataan_identitas_validasi(p_identitas), 'layanan_selesai_khusus',
      pg_catalog.jsonb_build_object('tiket_id', p_tiket_id));
  END IF;

  v_hasil := public.layanan_selesai(p_tiket_id, NULL::text, NULL::jsonb, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  IF v_pid IS NOT NULL THEN
    SELECT p.layanan_id INTO v_lyn FROM public.penanganan AS p WHERE p.id = v_pid;
    v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, p_khusus, v_me);
  ELSE
    v_hasil := v_hasil || pg_catalog.jsonb_build_object(
      'peringatan', 'Tiket ini berasal dari alur lama (tanpa tahap penanganan), sehingga Pendataan Khusus tidak disimpan.');
  END IF;
  RETURN v_hasil || pg_catalog.jsonb_build_object(
    'khusus_tersimpan', v_n, 'identitas_diubah', pg_catalog.to_jsonb(COALESCE(v_ubah, ARRAY[]::text[])));
END $$;

REVOKE ALL ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb, jsonb) TO authenticated;
COMMENT ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb, jsonb) IS
  '202611010003: layanan_selesai (tanpa formulir tetap) + identitas pengunjung (ditulis balik ke kunjungan, email wajib ada) + Pendataan Khusus, satu transaksi.';

CREATE OR REPLACE FUNCTION public.chat_selesai_khusus(
  p_sesi_id    uuid,
  p_topik_id   uuid,
  p_catatan    text,
  p_khusus     jsonb DEFAULT NULL,
  p_identitas  jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hasil jsonb;
  v_pid   uuid;
  v_kid   uuid;
  v_me    uuid;
  v_peran text;
  v_lyn   uuid;
  v_ubah  text[];
  v_n     integer := 0;
BEGIN
  -- Identitas diterapkan SEBELUM chat_selesai (email survei) dan email wajib ada. Otorisasi ditegakkan chat_selesai; bila
  -- ditolak, seluruh transaksi dibatalkan.
  SELECT s.kunjungan_id INTO v_kid FROM public.chat_sesi AS s WHERE s.id = p_sesi_id;
  IF v_kid IS NOT NULL THEN
    IF p_identitas IS NOT NULL THEN
      v_ubah := public.kunjungan_terapkan_identitas(
        v_kid, public.pendataan_identitas_validasi(p_identitas), 'chat_selesai_khusus',
        pg_catalog.jsonb_build_object('sesi_id', p_sesi_id));
    END IF;
    IF public.kunjungan_email_efektif(v_kid) IS NULL THEN
      RAISE EXCEPTION 'EMAIL_WAJIB: pengunjung wajib memiliki email yang valid sebelum chat diselesaikan'
        USING ERRCODE = '22023', DETAIL = 'email';
    END IF;
  END IF;

  v_hasil := public.chat_selesai(p_sesi_id, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  SELECT p.peran_tahap, p.layanan_id INTO v_peran, v_lyn FROM public.penanganan AS p WHERE p.id = v_pid;

  IF v_peran = 'layanan' AND v_lyn IS NOT NULL THEN
    v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, p_khusus, v_me);
  ELSIF p_khusus IS NOT NULL AND pg_catalog.jsonb_typeof(p_khusus) = 'object' AND p_khusus <> '{}'::jsonb THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_BERLAKU: Pendataan Khusus hanya untuk chat yang diselesaikan petugas Layanan'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_hasil || pg_catalog.jsonb_build_object(
    'khusus_tersimpan', v_n, 'identitas_diubah', pg_catalog.to_jsonb(COALESCE(v_ubah, ARRAY[]::text[])));
END $$;

REVOKE ALL ON FUNCTION public.chat_selesai_khusus(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_selesai_khusus(uuid, uuid, text, jsonb, jsonb) TO authenticated;
COMMENT ON FUNCTION public.chat_selesai_khusus(uuid, uuid, text, jsonb, jsonb) IS
  '202611010003: identitas diterapkan sebelum chat_selesai (email survei) + email wajib ada + Pendataan Khusus, satu transaksi.';

-- ============================================================
-- 7. FO pencatat membaca hasil lengkap (read-only)
-- ============================================================
-- Salinan 202610290001 dengan SATU tambahan: FO yang mendaftarkan kunjungan (kunjungan.dibuat_oleh) lulus.
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
  SELECT me.id, me.role, me.layanan_id INTO v_id, v_role, v_layanan FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' THEN
    RETURN true;
  END IF;
  IF public.boleh_data_pelayanan(p_peran_tahap, p_layanan, p_penangan) THEN
    RETURN true;
  END IF;
  -- 202611010003: FO pencatat membaca seluruh tahap kunjungan yang ia daftarkan (hasil eskalasi dilengkapi layanan).
  IF v_role = 'front_office'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = p_kunjungan AND k.dibuat_oleh = v_id) THEN
    RETURN true;
  END IF;
  IF NOT (p_status IN ('menunggu', 'berjalan') OR public.kunjungan_operasional(p_kunjungan)) THEN
    RETURN false;
  END IF;
  IF v_role = 'front_office' THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_layanan IS NOT NULL THEN
    IF p_layanan = v_layanan OR p_penangan = v_id THEN
      RETURN true;
    END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.penanganan AS p WHERE p.kunjungan_id = p_kunjungan AND p.layanan_id = v_layanan
    ) OR EXISTS (
      SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
      WHERE k.id = p_kunjungan AND k.asal = 'online' AND s.layanan_id = v_layanan
    );
  END IF;
  RETURN false;
END $$;

REVOKE ALL ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_penanganan(uuid, text, uuid, uuid, text) IS
  '202611010003: lingkup baca penanganan = 202610290001 + FO pencatat kunjungan (read-only).';

CREATE OR REPLACE FUNCTION public.boleh_baca_pendataan(p_tiket uuid, p_petugas uuid)
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
  v_koord   boolean;
  v_t       record;
BEGIN
  SELECT me.id, me.role, me.layanan_id, me.koordinator INTO v_id, v_role, v_layanan, v_koord
  FROM public.staf_lingkup() AS me;
  IF v_id IS NULL THEN
    RETURN false;
  END IF;
  IF v_role = 'admin' OR (v_role = 'front_office' AND v_koord) THEN
    RETURN true;
  END IF;
  IF p_petugas = v_id THEN
    RETURN true;
  END IF;
  SELECT t.layanan_id, t.status, t.tanggal, t.dilayani_oleh, t.kunjungan_id INTO v_t FROM public.tiket_antrean AS t WHERE t.id = p_tiket;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF v_t.dilayani_oleh = v_id
     OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.tiket_id = p_tiket AND p.penangan_id = v_id) THEN
    RETURN true;
  END IF;
  -- 202611010003: FO pencatat kunjungan membaca formulir pendataan hasil eskalasi (read-only).
  IF v_role = 'front_office'
     AND EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = v_t.kunjungan_id AND k.dibuat_oleh = v_id) THEN
    RETURN true;
  END IF;
  IF v_role = 'petugas' AND v_koord AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan THEN
    RETURN true;
  END IF;
  IF NOT (v_t.status IN ('menunggu', 'dipanggil', 'dilayani')
          AND v_t.tanggal >= (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date - 1) THEN
    RETURN false;
  END IF;
  RETURN v_role = 'front_office' OR (v_role = 'petugas' AND v_layanan IS NOT NULL AND v_t.layanan_id = v_layanan);
END $$;

REVOKE ALL ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_baca_pendataan(uuid, uuid) IS
  '202611010003: lingkup baca formulir pendataan = 202610290001 + FO pencatat kunjungan (read-only).';

CREATE OR REPLACE FUNCTION public.boleh_baca_khusus(p_penanganan uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE((
    SELECT public.boleh_data_pelayanan(p.peran_tahap, p.layanan_id, p.penangan_id)
           OR EXISTS (
             SELECT 1
             FROM public.staf_lingkup() AS me
             JOIN public.kunjungan AS k ON k.id = p.kunjungan_id
             WHERE me.role = 'front_office' AND k.dibuat_oleh = me.id)
    FROM public.penanganan AS p
    WHERE p.id = p_penanganan
  ), false)
$$;

REVOKE ALL ON FUNCTION public.boleh_baca_khusus(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_baca_khusus(uuid) TO authenticated, service_role;
COMMENT ON FUNCTION public.boleh_baca_khusus(uuid) IS
  '202611010003: baca jawaban Pendataan Khusus = lingkup data Fase 3 + FO pencatat kunjungan (read-only).';
