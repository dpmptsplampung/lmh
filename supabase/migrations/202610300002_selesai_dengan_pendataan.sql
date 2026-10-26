-- 202610300002_selesai_dengan_pendataan.sql
-- Fase 4 (spec §7; rencana docs/superpowers/plans/2026-10-30-fase-4-pendataan.md Task 2). Forward-only, hanya MENAMBAH
-- fungsi (B1). TIDAK mengganti layanan_selesai maupun chat_selesai: kedua RPC pembungkus di bawah memanggil keduanya apa
-- adanya (peran, sesi, kepemilikan, validasi topik/catatan ditegakkan di sana), lalu menulis Pendataan Khusus dan
-- (chat) melengkapi identitas pengunjung dalam transaksi yang SAMA. Galat apa pun sesudah pemanggilan itu membatalkan
-- seluruhnya (satu fungsi plpgsql = satu transaksi).
--
-- ISI
--   1. layanan_selesai_khusus(p_tiket_id, p_topik_id, p_catatan, p_khusus): selesaikan tiket Layanan TANPA formulir tetap
--      (Pendataan Umum = topik + catatan wajib, ditegakkan layanan_selesai) dan simpan Pendataan Khusus pada tahap
--      penanganan yang terbentuk. Tiket lama tanpa tahap: jawaban Khusus tidak disimpan (khusus_tersimpan = 0).
--   2. chat_selesai_khusus(p_sesi_id, p_topik_id, p_catatan, p_khusus, p_identitas): selesaikan chat (chat_selesai),
--      lengkapi/koreksi identitas kunjungan chat (nama, HP, email, asal instansi, kategori, keperluan; kosong = tidak
--      diubah; aturan format = fo_mulai_kunjungan), dan simpan Pendataan Khusus bila tahap = layanan. Tahap FO tidak
--      punya Layanan: jawaban Khusus yang terisi ditolak KHUSUS_TIDAK_BERLAKU. audit_log mencatat nama field + nilai lama/baru (kolom yang berubah; audit_log hanya terbaca Admin).
--      Kanal Live Chat: tahap chat selesai sudah terhitung 'live_chat' di rekap terpadu Fase 3 (saluran = 'chat').
--   3. pendataan_identitas_validasi(p jsonb) internal: kunci terbatas, DATA_TIDAK_VALID (DETAIL = kunci).
--
-- KODE GALAT TAMBAHAN: KHUSUS_TIDAK_BERLAKU (22023), DATA_TIDAK_VALID (22023); selebihnya dari layanan_selesai/chat_selesai
--   dan 202610300001 (KHUSUS_WAJIB, KHUSUS_TIDAK_VALID).
-- SYARAT / URUTAN: setelah 202610300001; keduanya diterapkan BERSAMA dalam satu jendela deploy.
-- PENERAPAN (pemilik; atomik; dry-run dulu):
--   node scripts/apply-migration.mjs supabase/migrations/202610300002_selesai_dengan_pendataan.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610300002_selesai_dengan_pendataan.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi ini (klien memakai RPC lama bila tabel Pendataan Khusus belum ada).
-- Idempoten.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.pendataan_khusus_simpan(uuid,uuid,jsonb,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610300001_pendataan_khusus belum diterapkan';
  END IF;
  IF pg_catalog.to_regprocedure('public.layanan_selesai(uuid,text,jsonb,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: layanan_selesai 5 argumen tidak ada (202610140004)';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_selesai(uuid,uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: chat_selesai tidak ada (202610140009)';
  END IF;
END $$;

-- ============================================================
-- 1. Validasi identitas pengunjung (internal)
-- ============================================================
-- Hanya nilai yang DIISI (tidak kosong) yang dikembalikan, sudah dinormalkan; yang kosong berarti "tidak diubah".
CREATE OR REPLACE FUNCTION public.pendataan_identitas_validasi(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_in    jsonb := COALESCE(p, '{}'::jsonb);
  v_out   jsonb := '{}'::jsonb;
  v_asing text;
  v_nama  text;
  v_hp    text;
  v_email text;
  v_inst  text;
  v_kat   text;
  v_kep   text;
BEGIN
  IF pg_catalog.jsonb_typeof(v_in) <> 'object' THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: identitas harus berupa objek' USING ERRCODE = '22023';
  END IF;
  SELECT k INTO v_asing FROM pg_catalog.jsonb_object_keys(v_in) AS k
  WHERE k NOT IN ('nama', 'kontak_hp', 'email', 'asal_instansi', 'kategori', 'keperluan')
  LIMIT 1;
  IF v_asing IS NOT NULL THEN
    RAISE EXCEPTION 'DATA_TIDAK_VALID: kolom identitas tidak dikenal' USING ERRCODE = '22023', DETAIL = v_asing;
  END IF;

  v_nama := pg_catalog.btrim(pg_catalog.regexp_replace(COALESCE(v_in ->> 'nama', ''), '[[:space:]]+', ' ', 'g'));
  IF v_nama <> '' THEN
    IF pg_catalog.char_length(v_nama) NOT BETWEEN 3 AND 100
       OR v_nama !~ '^[[:alpha:]][[:alpha:] .,''’-]*$'
       OR pg_catalog.char_length(pg_catalog.regexp_replace(v_nama, '[^[:alpha:]]', '', 'g')) < 3 THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: nama 3-100 karakter, hanya huruf, spasi, titik, koma, apostrof, tanda hubung'
        USING ERRCODE = '22023', DETAIL = 'nama';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_object('nama', v_nama);
  END IF;

  v_hp := pg_catalog.regexp_replace(COALESCE(v_in ->> 'kontak_hp', ''), '[^0-9]', '', 'g');
  IF v_hp <> '' THEN
    IF pg_catalog.left(v_hp, 2) = '62' THEN
      v_hp := '0' || pg_catalog.substr(v_hp, 3);
    END IF;
    IF v_hp !~ '^08[1-9][0-9]{7,10}$' THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: nomor HP format 08xxxxxxxxxx (10-13 digit; +62/62 diterima)'
        USING ERRCODE = '22023', DETAIL = 'kontak_hp';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_object('kontak_hp', v_hp);
  END IF;

  v_email := pg_catalog.lower(pg_catalog.btrim(COALESCE(v_in ->> 'email', '')));
  IF v_email <> '' THEN
    IF pg_catalog.char_length(v_email) > 254 OR v_email !~ '^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$' THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: email tidak valid' USING ERRCODE = '22023', DETAIL = 'email';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_object('email', v_email);
  END IF;

  v_inst := pg_catalog.btrim(COALESCE(v_in ->> 'asal_instansi', ''));
  IF v_inst <> '' THEN
    IF pg_catalog.char_length(v_inst) NOT BETWEEN 3 AND 120
       OR pg_catalog.char_length(pg_catalog.regexp_replace(v_inst, '[[:space:]]', '', 'g')) < 3 THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: asal/instansi 3-120 karakter' USING ERRCODE = '22023', DETAIL = 'asal_instansi';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_object('asal_instansi', v_inst);
  END IF;

  v_kat := pg_catalog.btrim(COALESCE(v_in ->> 'kategori', ''));
  IF v_kat <> '' THEN
    IF v_kat NOT IN ('Umum', 'UMKM', 'Investor', 'Instansi') THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: kategori salah satu Umum, UMKM, Investor, Instansi'
        USING ERRCODE = '22023', DETAIL = 'kategori';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_object('kategori', v_kat);
  END IF;

  v_kep := pg_catalog.btrim(COALESCE(v_in ->> 'keperluan', ''));
  IF v_kep <> '' THEN
    IF pg_catalog.char_length(v_kep) NOT BETWEEN 10 AND 500
       OR pg_catalog.char_length(pg_catalog.regexp_replace(v_kep, '[[:space:]]', '', 'g')) < 10 THEN
      RAISE EXCEPTION 'DATA_TIDAK_VALID: keperluan 10-500 karakter' USING ERRCODE = '22023', DETAIL = 'keperluan';
    END IF;
    v_out := v_out || pg_catalog.jsonb_build_object('keperluan', v_kep);
  END IF;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.pendataan_identitas_validasi(jsonb) FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 2. Selesai tiket Layanan tanpa formulir tetap + Pendataan Khusus
-- ============================================================
CREATE OR REPLACE FUNCTION public.layanan_selesai_khusus(
  p_tiket_id uuid,
  p_topik_id uuid,
  p_catatan  text,
  p_khusus   jsonb DEFAULT NULL
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
  v_n     integer := 0;
BEGIN
  -- Peran, sesi, kepemilikan, topik + catatan wajib ditegakkan layanan_selesai (Layanan ber-formulir ditolak INVALID_PAYLOAD).
  v_hasil := public.layanan_selesai(p_tiket_id, NULL::text, NULL::jsonb, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  SELECT me.id INTO v_me FROM public.staf_saya() AS me;
  IF v_pid IS NOT NULL THEN
    SELECT p.layanan_id INTO v_lyn FROM public.penanganan AS p WHERE p.id = v_pid;
    v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, p_khusus, v_me);
  ELSE
    -- Tiket lama tanpa tahap penanganan: tidak ada tempat menyimpan jawaban. Petugas diberi tahu (bukan diam-diam).
    v_hasil := v_hasil || pg_catalog.jsonb_build_object(
      'peringatan', 'Tiket ini berasal dari alur lama (tanpa tahap penanganan), sehingga Pendataan Khusus tidak disimpan.');
  END IF;
  RETURN v_hasil || pg_catalog.jsonb_build_object('khusus_tersimpan', v_n);
END $$;

-- ============================================================
-- 3. Selesai chat + identitas + Pendataan Khusus
-- ============================================================
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
  v_role  text;
  v_peran text;
  v_lyn   uuid;
  v_id    jsonb;
  v_lama  record;
  v_ubah  text[];
  v_lama_j jsonb;
  v_baru_j jsonb;
  v_n     integer := 0;
  v_now   timestamptz := pg_catalog.now();
BEGIN
  -- Peran, sesi, kepemilikan tahap, topik + catatan wajib ditegakkan chat_selesai.
  v_hasil := public.chat_selesai(p_sesi_id, p_topik_id, p_catatan);
  v_pid := (v_hasil ->> 'penanganan_id')::uuid;
  v_kid := (v_hasil ->> 'kunjungan_id')::uuid;
  SELECT me.id, me.role INTO v_me, v_role FROM public.staf_saya() AS me;
  SELECT p.peran_tahap, p.layanan_id INTO v_peran, v_lyn FROM public.penanganan AS p WHERE p.id = v_pid;

  -- Pendataan Umum: identitas pengunjung (kosong = tidak diubah).
  v_id := public.pendataan_identitas_validasi(p_identitas);
  IF v_id <> '{}'::jsonb THEN
    SELECT k.nama, k.kontak_hp, k.email, k.asal_instansi, k.kategori, k.keperluan INTO v_lama
    FROM public.kunjungan AS k WHERE k.id = v_kid;
    SELECT pg_catalog.array_agg(e.key ORDER BY e.key) INTO v_ubah
    FROM pg_catalog.jsonb_each_text(v_id) AS e
    WHERE e.value IS DISTINCT FROM (pg_catalog.to_jsonb(v_lama) ->> e.key);
    IF v_ubah IS NOT NULL THEN
      UPDATE public.kunjungan AS k
         SET nama = COALESCE(v_id ->> 'nama', k.nama),
             kontak_hp = COALESCE(v_id ->> 'kontak_hp', k.kontak_hp),
             email = COALESCE(v_id ->> 'email', k.email),
             asal_instansi = COALESCE(v_id ->> 'asal_instansi', k.asal_instansi),
             kategori = COALESCE(v_id ->> 'kategori', k.kategori),
             keperluan = COALESCE(v_id ->> 'keperluan', k.keperluan),
             updated_at = v_now
       WHERE k.id = v_kid;
      -- Nilai lama/baru HANYA kolom yang berubah, agar koreksi dapat dipulihkan. audit_log hanya terbaca Admin
      -- (policy audit_log_admin_select) dan tidak disentuh job anonimisasi retensi: lihat docs/KEBIJAKAN_PDP.md.
      SELECT pg_catalog.jsonb_object_agg(k, pg_catalog.to_jsonb(v_lama) -> k) INTO v_lama_j FROM pg_catalog.unnest(v_ubah) AS k;
      SELECT pg_catalog.jsonb_object_agg(e.key, e.value) INTO v_baru_j
        FROM pg_catalog.jsonb_each_text(v_id) AS e WHERE e.key = ANY (v_ubah);
      INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
      VALUES (auth.uid(), v_role, 'chat_pendataan_identitas', 'kunjungan', v_kid::text,
              pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'penanganan_id', v_pid,
                'identitas_diubah', pg_catalog.to_jsonb(v_ubah)),
              v_lama_j, v_baru_j);
    END IF;
  END IF;

  -- Pendataan Khusus: hanya tahap Layanan (tahap FO tidak punya Layanan).
  IF v_peran = 'layanan' AND v_lyn IS NOT NULL THEN
    v_n := public.pendataan_khusus_simpan(v_pid, v_lyn, p_khusus, v_me);
  ELSIF p_khusus IS NOT NULL AND pg_catalog.jsonb_typeof(p_khusus) = 'object' AND p_khusus <> '{}'::jsonb THEN
    RAISE EXCEPTION 'KHUSUS_TIDAK_BERLAKU: Pendataan Khusus hanya untuk chat yang diselesaikan petugas Layanan'
      USING ERRCODE = '22023';
  END IF;

  RETURN v_hasil || pg_catalog.jsonb_build_object(
    'khusus_tersimpan', v_n,
    'identitas_diubah', pg_catalog.to_jsonb(COALESCE(v_ubah, ARRAY[]::text[])));
END $$;

REVOKE ALL ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.chat_selesai_khusus(uuid, uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_selesai_khusus(uuid, uuid, text, jsonb, jsonb) TO authenticated;

COMMENT ON FUNCTION public.layanan_selesai_khusus(uuid, uuid, text, jsonb) IS
  '202610300002: layanan_selesai (tanpa formulir tetap) + simpan Pendataan Khusus pada tahap penanganan, satu transaksi.';
COMMENT ON FUNCTION public.chat_selesai_khusus(uuid, uuid, text, jsonb, jsonb) IS
  '202610300002: chat_selesai + identitas pengunjung + Pendataan Khusus (tahap layanan), satu transaksi.';
