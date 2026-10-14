-- 202610140009_chat_online.sql
-- Tahap C (C1-DB): LIVE CHAT = LAYANAN ONLINE TERCATAT (spec docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md
-- §3 "Chat", §4.7, K8, K10). Model penanganan dari 202610140003/0004/0005. Kontrak untuk UI:
-- docs/analysis/FO-CHAT-KONTRAK-RPC.md.
--
-- ISI
--   1. chat_sesi.kunjungan_id (FK kunjungan, ON DELETE SET NULL) + indeks unik: satu kunjungan 'online' per sesi chat
--      (uq_kunjungan_online_chat_sesi) dan satu sesi per kunjungan (uq_chat_sesi_kunjungan).
--   2. KAPAN kunjungan dibuat (KEPUTUSAN): saat sesi BER-ESKALASI, bukan saat pengunjung memulai. Alasan: sesi yang
--      hanya dijawab bot bukan layanan manusia; mencatatnya sebagai kunjungan mencemari rekap (kunjungan tanpa tahap
--      yang tidak pernah selesai). Pemicu: trigger AFTER INSERT/UPDATE OF status pada chat_sesi saat status menjadi
--      'eskalasi' (INSERT langsung 'eskalasi' oleh pengunjung bila chatbot nonaktif, atau UPDATE bot->eskalasi oleh
--      /api/chat/ai) -> kunjungan (asal 'online', status 'menunggu', tanggal WIB hari ini, chat_sesi_id, data
--      pengunjung disalin dari profil pengunjung, layanan_saran_id = layanan sesi, qr_token baru) + penanganan tahap 1
--      (peran 'fo', saluran 'chat', 'menunggu', chat_sesi_id) = KOTAK MASUK FO. Alur bot/eskalasi yang ada tidak
--      berubah (route tidak perlu diubah untuk itu). Staf juga boleh mengambil sesi yang masih 'bot' lewat chat_ambil
--      (kunjungan dibuat saat itu juga) agar fitur "ambil alih" sesi bot tetap ada.
--      BATAS SPAM (review): kunjungan HANYA dibuat bila sesi eskalasi punya minimal SATU pesan pengunjung. Sesi yang
--      langsung dibuat 'eskalasi' (chatbot nonaktif) tanpa pesan tidak mencatat kunjungan; kunjungan tercatat saat
--      pesan pengunjung pertama masuk (trigger trg_chat_pesan_eskalasi_kunjungan AFTER INSERT pada chat_pesan,
--      pengirim 'pengunjung'). Alur bot -> eskalasi lewat /api/chat/ai selalu didahului pesan pengunjung (pesan
--      disimpan /api/chat/messages sebelum AI dipanggil), jadi tidak berubah.
--   3. RPC klien (SECURITY DEFINER, search_path terkunci, staf_wajib_sesi = peran aktif + sesi_valid(); galat berawalan
--      KODE seperti kontrak FO; jam server; audit_log bila pelaku Admin):
--        chat_ambil(p_sesi_id uuid, p_alasan text DEFAULT NULL)        FO / petugas layanan sesi / Admin, atomik.
--        chat_teruskan(p_sesi_id, p_layanan_id, p_topik_id, p_catatan) FO pemilik tahap: handoff TANPA tiket.
--        chat_selesai(p_sesi_id, p_topik_id, p_catatan)                pemilik tahap: topik + catatan WAJIB.
--      fo_ambil_dari_kotak_masuk / fo_selesai / fo_eskalasi (0004/0007) TIDAK diubah: tetap menolak saluran chat
--      dengan SALURAN_CHAT; tahap chat hanya diambil/ditutup lewat RPC di sini (konsisten). Job akhir hari
--      (tandai_tidak_terlayani_akhir_hari) dan tutup_penanganan_tertinggal (0008) sudah mengecualikan saluran chat:
--      chat tidak terikat hari/jam tutup.
--   4. Penjaga chat_sesi (trg_chat_sesi_jaga_rpc, BEFORE INSERT OR UPDATE): kolom status/ditangani_oleh/layanan_id/
--      kunjungan_id pada sesi yang sudah tercatat (punya kunjungan) HANYA berubah lewat RPC chat (flag transaksi-lokal
--      lmh.chat_rpc yang tidak bisa diset lewat PostgREST). Tanpa flag hanya diizinkan: INSERT berstatus bot/eskalasi
--      tanpa penangan/kunjungan; bot -> eskalasi dan bot -> selesai (sesi tanpa kunjungan); SET NULL akibat FK.
--      AKIBAT SADAR: aksi lama /api/chat/sesi (takeover, kembali_ke_bot, selesaikan) DITOLAK (CHAT_HARUS_RPC)
--      sampai route dipindah ke RPC ini (cutover bersama klien Tahap C). Berlaku juga untuk service_role.
--   5. boleh_penanganan / boleh_kunjungan: petugas boleh MEMBACA tahap & kunjungan chat yang sesinya sedang berada di
--      layanannya (chat_sesi.layanan_id), agar bisa mengambil langsung / melihat catatan FO setelah diteruskan.
--      Cabang lain identik dengan 202610140003 / 202610090001. RLS chat_sesi/chat_pesan TIDAK diubah.
--   6. Backfill: sesi 'eskalasi' tanpa kunjungan -> kunjungan 'menunggu' + tahap FO 'menunggu'; sesi 'aktif' dengan
--      penangan staf -> kunjungan 'dilayani' + tahap 'berjalan' (fo, atau layanan bila penangan petugas berlayanan);
--      sesi 'aktif' tanpa penangan -> seperti eskalasi (status sesi -> 'eskalasi'). Tanggal kunjungan = tanggal WIB
--      created_at sesi. Sesi 'bot'/'selesai' tidak disentuh.
--      BATAS (review): hanya sesi yang (a) punya minimal satu pesan pengunjung dan (b) aktivitas terakhirnya (pesan
--      terakhir, atau created_at bila tanpa pesan) dalam 24 jam terakhir. Sesi eskalasi/aktif yang lebih tua DIBIARKAN
--      tanpa kunjungan (tidak mencemari rekap tanggal lampau) dan ditutup oleh tutup_chat_tertinggal()
--      (202610140012: dijalankan sekali saat migrasi itu + job harian). Sesi baru tanpa pesan pengunjung mendapat
--      kunjungan saat pesan pertamanya masuk (bagian 4) atau saat diambil staf (chat_ambil).
--
-- PESAN SISTEM: RPC menulis pesan chat (pengirim 'bot') di transaksi yang sama (ambil, teruskan, selesai). Route
--   TIDAK boleh menulis pesan sistem sendiri lagi. Pesan penutup chat_selesai bertanda jenis_jawaban='penutup_survei'
--   dan berisi TEMPAT tautan survei (tanpa URL; diisi Tahap E/K13).
-- URUTAN KUNCI chat: chat_sesi (FOR NO KEY UPDATE) -> kunjungan -> penanganan. Trigger eskalasi berjalan saat baris
--   chat_sesi sudah terkunci oleh UPDATE/INSERT pemicunya dan hanya membuat baris baru (tanpa konflik kunci).
--
-- SYARAT: 202610140003, 202610140004 (staf_wajib_sesi, fo_validasi_topik, fo_validasi_catatan). Tidak bergantung pada
--   202610140006..0008 (tidak memakai fo_sinkron_visit yang di-DROP 0007). Penjaga di bagian 0.
-- PENERAPAN (WAJIB atomik; dry-run dulu; hanya setelah konfirmasi CEO; bersamaan dengan klien Tahap C):
--   node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic
-- Idempoten. Rollback: docs/rollback-chat-online-202610140009.sql. Uji perilaku (transaksi di-ROLLBACK):
--   scripts/test-chat-online.mjs.

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regclass('public.penanganan') IS NULL OR pg_catalog.to_regclass('public.topik_penanganan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel penanganan/topik_penanganan belum ada (terapkan 202610140003_fo_model_data.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.staf_wajib_sesi(text[])') IS NULL
     OR pg_catalog.to_regprocedure('public.fo_validasi_topik(uuid,uuid)') IS NULL
     OR pg_catalog.to_regprocedure('public.fo_validasi_catatan(text,integer)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: fungsi internal FO belum ada (terapkan 202610140004_fo_rpc.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.queue_notifikasi(uuid,text,text,text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.queue_notifikasi belum ada';
  END IF;
  IF pg_catalog.to_regprocedure('public.antrean_dibuka(uuid,date)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.antrean_dibuka(uuid,date) belum ada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.kunjungan'::regclass AND a.attname = 'chat_sesi_id' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom kunjungan.chat_sesi_id belum ada (202610140003)';
  END IF;
END $$;

-- ============================================================
-- 1. chat_sesi.kunjungan_id + indeks
-- ============================================================
ALTER TABLE public.chat_sesi
  ADD COLUMN IF NOT EXISTS kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.chat_sesi.kunjungan_id IS
  'Kunjungan asal=online milik sesi ini (dibuat saat eskalasi atau chat_ambil). Hanya ditulis RPC/trigger chat (flag lmh.chat_rpc).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sesi_kunjungan
  ON public.chat_sesi (kunjungan_id) WHERE kunjungan_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_kunjungan_online_chat_sesi
  ON public.kunjungan (chat_sesi_id) WHERE asal = 'online';
CREATE INDEX IF NOT EXISTS idx_penanganan_chat_sesi
  ON public.penanganan (chat_sesi_id) WHERE chat_sesi_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_penanganan_kotak_masuk_chat
  ON public.penanganan (created_at) WHERE status = 'menunggu' AND saluran = 'chat';

-- ============================================================
-- 2. Fungsi internal (tanpa GRANT ke anon/authenticated)
-- ============================================================
-- Ubah kolom staf chat_sesi di bawah flag lmh.chat_rpc (penjaga trg_chat_sesi_jaga_rpc). NULL = kolom tidak diubah,
-- KECUALI p_ditangani: selalu ditulis (NULL = lepas penangan).
CREATE OR REPLACE FUNCTION public.chat_ubah_sesi(
  p_sesi_id   uuid,
  p_status    text,
  p_ditangani uuid,
  p_layanan   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM pg_catalog.set_config('lmh.chat_rpc', 'on', true);
  UPDATE public.chat_sesi AS s
     SET status         = COALESCE(p_status, s.status),
         ditangani_oleh = p_ditangani,
         layanan_id     = COALESCE(p_layanan, s.layanan_id)
   WHERE s.id = p_sesi_id;
  PERFORM pg_catalog.set_config('lmh.chat_rpc', 'off', true);
END $$;

-- Pesan sistem (pengirim 'bot') di sesi chat. Mengembalikan id pesan.
CREATE OR REPLACE FUNCTION public.chat_pesan_sistem(p_sesi_id uuid, p_isi text, p_jenis text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.chat_pesan (sesi_id, pengirim, isi, jenis_jawaban)
  VALUES (p_sesi_id, 'bot', p_isi, p_jenis)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Kunjungan 'online' untuk sesi (idempoten: sesi yang sudah punya kunjungan mengembalikan id lama). Data pengunjung
-- disalin dari profil (pengunjung); nama jatuh ke kontak_pengunjung sesi bila profil kosong. Menautkan
-- chat_sesi.kunjungan_id di bawah flag. TIDAK membuat tahap penanganan (pemanggil yang membuat).
CREATE OR REPLACE FUNCTION public.chat_buat_kunjungan(p_sesi_id uuid, p_status text, p_tanggal date)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s        record;
  v_nama     text;
  v_hp       text;
  v_email    text;
  v_instansi text;
  v_kategori text;
  v_kid      uuid;
  v_now      timestamptz := pg_catalog.now();
  v_qr       text := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');
BEGIN
  SELECT s.id, s.layanan_id, s.pengunjung_id, s.kontak_pengunjung, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_s.kunjungan_id IS NOT NULL THEN
    RETURN v_s.kunjungan_id;
  END IF;
  IF v_s.pengunjung_id IS NOT NULL THEN
    SELECT p.nama, p.no_hp, p.email, p.asal_instansi, p.kategori INTO v_nama, v_hp, v_email, v_instansi, v_kategori
    FROM public.pengunjung AS p WHERE p.id = v_s.pengunjung_id;
  END IF;

  INSERT INTO public.kunjungan (
    pengunjung_id, nama, kontak_hp, asal, qr_token, tanggal, waktu_masuk, status,
    asal_instansi, kategori, email, layanan_saran_id, chat_sesi_id, created_at, updated_at
  ) VALUES (
    v_s.pengunjung_id,
    COALESCE(NULLIF(pg_catalog.btrim(v_nama), ''), NULLIF(pg_catalog.btrim(v_s.kontak_pengunjung), ''), 'Pengunjung chat'),
    NULLIF(pg_catalog.btrim(v_hp), ''),
    'online', v_qr, COALESCE(p_tanggal, (v_now AT TIME ZONE 'Asia/Jakarta')::date), v_now, p_status,
    NULLIF(pg_catalog.btrim(v_instansi), ''), v_kategori, NULLIF(pg_catalog.btrim(v_email), ''),
    v_s.layanan_id, p_sesi_id, v_now, v_now
  ) RETURNING id INTO v_kid;

  PERFORM pg_catalog.set_config('lmh.chat_rpc', 'on', true);
  UPDATE public.chat_sesi AS s SET kunjungan_id = v_kid WHERE s.id = p_sesi_id;
  PERFORM pg_catalog.set_config('lmh.chat_rpc', 'off', true);
  RETURN v_kid;
END $$;

REVOKE ALL ON FUNCTION public.chat_ubah_sesi(uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ubah_sesi(uuid, text, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.chat_pesan_sistem(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_pesan_sistem(uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.chat_buat_kunjungan(uuid, text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_buat_kunjungan(uuid, text, date) TO service_role;

-- ============================================================
-- 3. Penjaga kolom staf chat_sesi (hanya lewat RPC chat)
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_sesi_jaga_rpc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('lmh.chat_rpc', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.kunjungan_id IS NOT NULL OR NEW.ditangani_oleh IS NOT NULL OR NEW.status NOT IN ('bot', 'eskalasi') THEN
      RAISE EXCEPTION 'CHAT_HARUS_RPC: sesi chat baru harus berstatus bot/eskalasi tanpa penangan' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- SET NULL akibat FK (kunjungan/petugas terhapus) diizinkan.
  IF NEW.kunjungan_id IS DISTINCT FROM OLD.kunjungan_id
     AND NOT (NEW.kunjungan_id IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.kunjungan AS k WHERE k.id = OLD.kunjungan_id)) THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: kunjungan sesi chat hanya diubah RPC chat' USING ERRCODE = '42501';
  END IF;
  IF NEW.ditangani_oleh IS DISTINCT FROM OLD.ditangani_oleh
     AND NOT (NEW.ditangani_oleh IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.petugas AS p WHERE p.id = OLD.ditangani_oleh)) THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: penangan sesi chat hanya diubah lewat chat_ambil/chat_teruskan/chat_selesai'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status = 'bot' AND NEW.status IN ('eskalasi', 'selesai') AND OLD.kunjungan_id IS NULL) THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: status sesi chat % -> % hanya lewat RPC chat', OLD.status, NEW.status
      USING ERRCODE = '42501';
  END IF;
  IF NEW.layanan_id IS DISTINCT FROM OLD.layanan_id AND OLD.kunjungan_id IS NOT NULL THEN
    RAISE EXCEPTION 'CHAT_HARUS_RPC: layanan sesi chat tercatat hanya diubah lewat chat_teruskan' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.chat_sesi_jaga_rpc() FROM PUBLIC, anon, authenticated;

-- Penjaga lama (202610070001) menolak perubahan status/penangan bila pemanggil bukan staf/service_role; backfill
-- migrasi (tanpa JWT) dan trigger chat berjalan di bawah flag lmh.chat_rpc -> diizinkan. Selain flag: identik.
CREATE OR REPLACE FUNCTION public.guard_chat_sesi_staff_columns()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF COALESCE(pg_catalog.current_setting('lmh.chat_rpc', true), '') = 'on'
     OR auth.role() = 'service_role'
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

DROP TRIGGER IF EXISTS trg_chat_sesi_jaga_rpc ON public.chat_sesi;
CREATE TRIGGER trg_chat_sesi_jaga_rpc
  BEFORE INSERT OR UPDATE ON public.chat_sesi
  FOR EACH ROW EXECUTE FUNCTION public.chat_sesi_jaga_rpc();

-- ============================================================
-- 4. Eskalasi -> kunjungan online + kotak masuk FO
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_sesi_eskalasi_kunjungan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_kid uuid;
BEGIN
  -- Batas spam: hanya sesi yang sudah punya pesan pengunjung (sesi kosong menunggu pesan pertamanya).
  IF NEW.status = 'eskalasi' AND NEW.kunjungan_id IS NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'eskalasi')
     AND EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = NEW.id AND m.pengirim = 'pengunjung') THEN
    v_kid := public.chat_buat_kunjungan(NEW.id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chat_sesi_eskalasi_kunjungan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chat_sesi_eskalasi_kunjungan ON public.chat_sesi;
CREATE TRIGGER trg_chat_sesi_eskalasi_kunjungan
  AFTER INSERT OR UPDATE OF status ON public.chat_sesi
  FOR EACH ROW EXECUTE FUNCTION public.chat_sesi_eskalasi_kunjungan();

-- Pesan pengunjung pertama pada sesi 'eskalasi' yang belum tercatat -> kunjungan online + kotak masuk FO. Baris sesi
-- dikunci (FOR NO KEY UPDATE) lalu diperiksa ulang sehingga pesan serentak / eskalasi serentak tidak menggandakan
-- kunjungan (urutan kunci chat: chat_sesi -> kunjungan -> penanganan; trigger bump updated_at 202610070001 sudah
-- memegang kunci baris yang sama lebih dulu).
CREATE OR REPLACE FUNCTION public.chat_pesan_eskalasi_kunjungan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_s   record;
  v_kid uuid;
BEGIN
  SELECT s.id, s.status, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = NEW.sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NOT NULL AND v_s.status = 'eskalasi' AND v_s.kunjungan_id IS NULL THEN
    v_kid := public.chat_buat_kunjungan(NEW.sesi_id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', NEW.sesi_id);
  END IF;
  RETURN NULL;
END $$;

REVOKE ALL ON FUNCTION public.chat_pesan_eskalasi_kunjungan() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_chat_pesan_eskalasi_kunjungan ON public.chat_pesan;
CREATE TRIGGER trg_chat_pesan_eskalasi_kunjungan
  AFTER INSERT ON public.chat_pesan
  FOR EACH ROW WHEN (NEW.pengirim = 'pengunjung')
  EXECUTE FUNCTION public.chat_pesan_eskalasi_kunjungan();

-- ============================================================
-- 5. RLS baca: petugas melihat tahap/kunjungan chat yang sedang di layanannya
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
      OR EXISTS (
        -- Tahap C: kunjungan chat yang sesinya sedang berada di layanan petugas.
        SELECT 1 FROM public.kunjungan AS k JOIN public.chat_sesi AS s ON s.id = k.chat_sesi_id
        WHERE k.id = p_kunjungan AND k.asal = 'online' AND public.boleh_layanan(s.layanan_id)
      )
$$;

REVOKE ALL ON FUNCTION public.boleh_kunjungan(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_kunjungan(uuid) TO authenticated, service_role;

-- ============================================================
-- 6. chat_ambil: atomik (WHERE status='menunggu' AND penangan_id IS NULL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_ambil(p_sesi_id uuid, p_alasan text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_alasan  text := pg_catalog.btrim(COALESCE(p_alasan, ''));
  v_s       record;
  v_kid     uuid;
  v_p       record;
  v_tahap   integer;
  v_pid     uuid;
  v_peran   text;
  v_lyn     uuid;
  v_n       integer;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin', 'petugas']) AS s;

  SELECT s.id, s.status, s.layanan_id, s.kunjungan_id, s.ditangani_oleh INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_me_role = 'petugas' AND (v_me_lyn IS NULL OR v_s.layanan_id IS DISTINCT FROM v_me_lyn) THEN
    RAISE EXCEPTION 'FORBIDDEN: chat ini bukan untuk layanan Anda' USING ERRCODE = '42501';
  END IF;
  IF v_s.status = 'selesai' THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat sudah selesai' USING ERRCODE = 'P0001';
  END IF;

  -- Sesi bot (belum eskalasi) atau sesi lama tanpa kunjungan: catat sekarang (masuk "kotak masuk" lalu diambil).
  v_kid := v_s.kunjungan_id;
  IF v_kid IS NULL THEN
    v_kid := public.chat_buat_kunjungan(p_sesi_id, 'menunggu', NULL);
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
    VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', p_sesi_id);
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_kid FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_kid AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL THEN
    RAISE EXCEPTION 'DIVERGENSI: sesi chat belum selesai tetapi tidak punya tahap terbuka' USING ERRCODE = 'P0001';
  END IF;

  -- Sudah berjalan.
  IF v_p.status = 'berjalan' THEN
    IF v_p.penangan_id = v_me_id THEN
      RETURN pg_catalog.jsonb_build_object(
        'ok', true, 'sudah_milik_anda', true, 'ambil_alih', false, 'sesi_id', p_sesi_id, 'kunjungan_id', v_kid,
        'penanganan_id', v_p.id, 'peran_tahap', v_p.peran_tahap, 'mulai_at', v_p.mulai_at);
    END IF;
    IF v_me_role <> 'admin' THEN
      RAISE EXCEPTION 'SUDAH_DIAMBIL: chat sudah ditangani staf lain' USING ERRCODE = 'P0001';
    END IF;
    -- Admin mengambil alih (alasan wajib, audit), pola admin_ambil_alih.
    IF pg_catalog.char_length(v_alasan) NOT BETWEEN 5 AND 500 THEN
      RAISE EXCEPTION 'ALASAN_WAJIB: alasan ambil alih chat wajib 5-500 karakter' USING ERRCODE = '22023';
    END IF;
    UPDATE public.penanganan AS p
       SET status = 'batal', batal_karena = 'diambil_alih', selesai_at = v_now,
           catatan = pg_catalog.left('Diambil alih Admin: ' || v_alasan, CASE WHEN p.peran_tahap = 'fo' THEN 200 ELSE 1000 END)
     WHERE p.id = v_p.id;
    SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_kid;
    INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status,
                                   mulai_at, chat_sesi_id, dibuat_oleh)
    VALUES (v_kid, v_tahap, v_p.peran_tahap, v_p.layanan_id, 'chat', v_me_id, 'berjalan', v_now, p_sesi_id, v_me_id)
    RETURNING id INTO v_pid;
    PERFORM public.chat_ubah_sesi(p_sesi_id, 'aktif', v_me_id);
    PERFORM public.chat_pesan_sistem(p_sesi_id,
      'Percakapan ini dilanjutkan oleh petugas lain. Pesan Anda akan dibalas langsung oleh petugas.');
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_ambil_alih', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_kid, 'penanganan_lama', v_p.id,
              'penanganan_baru', v_pid, 'pemilik_lama', v_p.penangan_id, 'alasan', v_alasan),
            pg_catalog.jsonb_build_object('penangan_id', v_p.penangan_id),
            pg_catalog.jsonb_build_object('penangan_id', v_me_id));
    RETURN pg_catalog.jsonb_build_object(
      'ok', true, 'sudah_milik_anda', false, 'ambil_alih', true, 'pemilik_lama', v_p.penangan_id, 'sesi_id', p_sesi_id,
      'kunjungan_id', v_kid, 'penanganan_id', v_pid, 'peran_tahap', v_p.peran_tahap, 'mulai_at', v_now);
  END IF;

  -- Menunggu: tentukan peran tahap setelah diambil.
  IF v_p.peran_tahap = 'fo' THEN
    IF v_me_role = 'petugas' THEN
      -- Petugas mengambil langsung selama BELUM diambil FO: tahap menjadi tahap layanannya (tidak ada tahap FO fiktif).
      v_peran := 'layanan';
      v_lyn   := v_me_lyn;
    ELSE
      v_peran := 'fo';
      v_lyn   := NULL;
    END IF;
  ELSE
    IF v_me_role = 'front_office' THEN
      RAISE EXCEPTION 'FORBIDDEN: chat ini sudah diteruskan dan menunggu petugas layanan' USING ERRCODE = '42501';
    END IF;
    IF v_me_role = 'petugas' AND v_p.layanan_id IS DISTINCT FROM v_me_lyn THEN
      RAISE EXCEPTION 'FORBIDDEN: chat ini menunggu petugas layanan lain' USING ERRCODE = '42501';
    END IF;
    v_peran := 'layanan';
    v_lyn   := v_p.layanan_id;
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'berjalan', penangan_id = v_me_id, mulai_at = v_now, peran_tahap = v_peran, layanan_id = v_lyn,
         chat_sesi_id = p_sesi_id
   WHERE p.id = v_p.id AND p.status = 'menunggu' AND p.penangan_id IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'SUDAH_DIAMBIL: chat sudah ditangani staf lain' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.kunjungan AS k SET status = 'dilayani', updated_at = v_now WHERE k.id = v_kid;
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'aktif', v_me_id);
  PERFORM public.chat_pesan_sistem(p_sesi_id,
    'Percakapan ini telah diambil oleh petugas. Pesan Anda akan dibalas langsung oleh petugas.');

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_ambil', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_kid, 'penanganan_id', v_p.id,
              'peran_tahap', v_peran),
            pg_catalog.jsonb_build_object('status_sesi', v_s.status),
            pg_catalog.jsonb_build_object('status_sesi', 'aktif', 'penangan_id', v_me_id));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sudah_milik_anda', false, 'ambil_alih', false, 'sesi_id', p_sesi_id, 'kunjungan_id', v_kid,
    'penanganan_id', v_p.id, 'peran_tahap', v_peran, 'mulai_at', v_now);
END $$;

-- ============================================================
-- 7. chat_teruskan: FO -> petugas layanan, TANPA tiket
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_teruskan(
  p_sesi_id    uuid,
  p_layanan_id uuid,
  p_topik_id   uuid,
  p_catatan    text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_tgl     date := (pg_catalog.now() AT TIME ZONE 'Asia/Jakarta')::date;
  v_s       record;
  v_p       record;
  v_l       record;
  v_topik   text;
  v_catatan text;
  v_tahap   integer;
  v_pl      uuid;
  v_notif   integer := 0;
  r         record;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin']) AS s;

  SELECT s.id, s.status, s.layanan_id, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_s.status = 'selesai' OR v_s.kunjungan_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat belum diambil atau sudah selesai (status=%)', v_s.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_s.kunjungan_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL OR v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: chat tidak sedang ditangani (ambil dulu dengan chat_ambil)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.peran_tahap <> 'fo' THEN
    RAISE EXCEPTION 'BUKAN_TAHAP_FO: chat ini sedang ditangani petugas layanan' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: chat ini ditangani staf lain' USING ERRCODE = '42501';
  END IF;
  v_topik   := public.fo_validasi_topik(p_topik_id, NULL);
  v_catatan := public.fo_validasi_catatan(p_catatan, 200);

  SELECT l.id, l.nama, l.aktif, l.punya_chat INTO v_l FROM public.layanan AS l WHERE l.id = p_layanan_id;
  IF v_l.id IS NULL OR NOT v_l.aktif OR NOT COALESCE(v_l.punya_chat, false) THEN
    RAISE EXCEPTION 'LAYANAN_TIDAK_VALID: layanan tujuan tidak ada, nonaktif, atau tidak melayani chat' USING ERRCODE = '22023';
  END IF;

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'dieskalasi', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = v_p.id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  SELECT COALESCE(pg_catalog.max(p.tahap_ke), 0) + 1 INTO v_tahap FROM public.penanganan AS p WHERE p.kunjungan_id = v_s.kunjungan_id;
  INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, status, chat_sesi_id, dibuat_oleh)
  VALUES (v_s.kunjungan_id, v_tahap, 'layanan', p_layanan_id, 'chat', 'menunggu', p_sesi_id, v_me_id)
  RETURNING id INTO v_pl;

  UPDATE public.kunjungan AS k SET status = 'menunggu', updated_at = v_now WHERE k.id = v_s.kunjungan_id;
  -- Sesi pindah ke layanan tujuan (RLS chat yang ada memberi petugas layanan itu akses baca/tulis), penangan dilepas.
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'eskalasi', NULL, p_layanan_id);
  PERFORM public.chat_pesan_sistem(p_sesi_id, pg_catalog.format(
    'Percakapan Anda diteruskan ke petugas layanan %s. Mohon tunggu, petugas akan segera membalas.', v_l.nama));

  -- Notifikasi web push ke petugas aktif layanan tujuan (tanpa PII pengunjung).
  FOR r IN
    SELECT p.auth_user_id FROM public.petugas AS p
    WHERE p.layanan_id = p_layanan_id AND p.role = 'petugas' AND p.aktif = true
  LOOP
    PERFORM public.queue_notifikasi(
      r.auth_user_id, NULL, 'web_push',
      'Chat menunggu',
      pg_catalog.format('Front Office meneruskan satu chat ke layanan %s.', v_l.nama),
      pg_catalog.jsonb_build_object('type', 'chat_diteruskan', 'sesi_id', p_sesi_id, 'layanan_id', p_layanan_id,
                                    'url', '/admin/chat'));
    v_notif := v_notif + 1;
  END LOOP;

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_teruskan', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id,
              'penanganan_fo_id', v_p.id, 'penanganan_layanan_id', v_pl),
            pg_catalog.jsonb_build_object('layanan_id', v_s.layanan_id),
            pg_catalog.jsonb_build_object('layanan_id', p_layanan_id));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true,
    'sesi_id', p_sesi_id,
    'kunjungan_id', v_s.kunjungan_id,
    'penanganan_fo_id', v_p.id,
    'penanganan_layanan_id', v_pl,
    'layanan_id', p_layanan_id,
    'layanan_nama', v_l.nama,
    'petugas_hadir', public.antrean_dibuka(p_layanan_id, v_tgl),
    'notifikasi_diantrekan', v_notif);
END $$;

-- ============================================================
-- 8. chat_selesai: topik + catatan WAJIB, kunjungan & sesi selesai, pesan penutup
-- ============================================================
CREATE OR REPLACE FUNCTION public.chat_selesai(p_sesi_id uuid, p_topik_id uuid, p_catatan text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_me_id   uuid;
  v_me_role text;
  v_me_lyn  uuid;
  v_now     timestamptz := pg_catalog.now();
  v_s       record;
  v_p       record;
  v_topik   text;
  v_catatan text;
  v_pesan   uuid;
BEGIN
  SELECT s.o_id, s.o_role, s.o_layanan INTO v_me_id, v_me_role, v_me_lyn
  FROM public.staf_wajib_sesi(ARRAY['front_office', 'admin', 'petugas']) AS s;

  SELECT s.id, s.status, s.kunjungan_id INTO v_s
  FROM public.chat_sesi AS s WHERE s.id = p_sesi_id FOR NO KEY UPDATE;
  IF v_s.id IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: sesi chat tidak ditemukan' USING ERRCODE = 'P0002';
  END IF;
  IF v_s.status = 'selesai' OR v_s.kunjungan_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_STATUS: sesi chat belum diambil atau sudah selesai (status=%)', v_s.status USING ERRCODE = 'P0001';
  END IF;

  PERFORM 1 FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id FOR UPDATE;
  SELECT p.* INTO v_p FROM public.penanganan AS p
  WHERE p.kunjungan_id = v_s.kunjungan_id AND p.status IN ('menunggu', 'berjalan') FOR UPDATE;
  IF v_p.id IS NULL OR v_p.status <> 'berjalan' THEN
    RAISE EXCEPTION 'INVALID_STATUS: chat tidak sedang ditangani (ambil dulu dengan chat_ambil)' USING ERRCODE = 'P0001';
  END IF;
  IF v_p.penangan_id IS DISTINCT FROM v_me_id THEN
    RAISE EXCEPTION 'BUKAN_PEMILIK: chat ini ditangani staf lain' USING ERRCODE = '42501';
  END IF;
  -- Topik milik tahap (FO: topik FO; layanan: topik layanan itu). Catatan FO <= 200, layanan <= 1000 (K10).
  v_topik   := public.fo_validasi_topik(p_topik_id, v_p.layanan_id);
  v_catatan := public.fo_validasi_catatan(p_catatan, CASE WHEN v_p.peran_tahap = 'fo' THEN 200 ELSE 1000 END);

  UPDATE public.penanganan AS p
     SET status = 'selesai', hasil = 'selesai', topik_id = p_topik_id, topik = v_topik, catatan = v_catatan,
         selesai_at = v_now
   WHERE p.id = v_p.id AND p.status = 'berjalan' AND p.penangan_id = v_me_id;

  UPDATE public.kunjungan AS k SET status = 'selesai', updated_at = v_now
   WHERE k.id = v_s.kunjungan_id
     AND NOT EXISTS (SELECT 1 FROM public.penanganan AS x
                     WHERE x.kunjungan_id = v_s.kunjungan_id AND x.status IN ('menunggu', 'berjalan'));

  -- ditangani_oleh dipertahankan (riwayat siapa yang menutup).
  PERFORM public.chat_ubah_sesi(p_sesi_id, 'selesai', v_me_id);
  -- Pesan penutup: TEMPAT tautan survei (K13/Tahap E mengisi tautannya; jangan menaruh URL di sini).
  v_pesan := public.chat_pesan_sistem(p_sesi_id,
    'Sesi chat telah selesai. Terima kasih telah menghubungi DPMPTSP Provinsi Lampung. '
    || 'Tautan survei kepuasan layanan akan disediakan di sini.',
    'penutup_survei');

  IF v_me_role = 'admin' THEN
    INSERT INTO public.audit_log (actor_id, actor_role, aksi, entitas, entitas_id, detail, nilai_lama, nilai_baru)
    VALUES (auth.uid(), v_me_role, 'chat_selesai', 'chat_sesi', p_sesi_id::text,
            pg_catalog.jsonb_build_object('sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id, 'penanganan_id', v_p.id,
              'topik', v_topik),
            pg_catalog.jsonb_build_object('status_sesi', v_s.status),
            pg_catalog.jsonb_build_object('status_sesi', 'selesai'));
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'ok', true, 'sesi_id', p_sesi_id, 'kunjungan_id', v_s.kunjungan_id, 'penanganan_id', v_p.id,
    'kunjungan_status', (SELECT k.status FROM public.kunjungan AS k WHERE k.id = v_s.kunjungan_id),
    'selesai_at', v_now, 'pesan_penutup_id', v_pesan);
END $$;

REVOKE ALL ON FUNCTION public.chat_ambil(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_ambil(uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.chat_teruskan(uuid, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_teruskan(uuid, uuid, uuid, text) TO authenticated;
REVOKE ALL ON FUNCTION public.chat_selesai(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_selesai(uuid, uuid, text) TO authenticated;

-- ============================================================
-- 9. Backfill sesi eskalasi/aktif yang sudah ada
-- ============================================================
DO $$
DECLARE
  r       record;
  v_h_id  uuid;
  v_h_rol text;
  v_h_lyn uuid;
  v_kid   uuid;
  v_now   timestamptz := pg_catalog.now();
BEGIN
  FOR r IN
    SELECT s.id, s.status, s.ditangani_oleh, s.created_at
    FROM public.chat_sesi AS s
    WHERE s.status IN ('eskalasi', 'aktif') AND s.kunjungan_id IS NULL
      -- Batas (review): ada pesan pengunjung dan aktivitas terakhir <= 24 jam; sisanya ditutup 202610140012.
      AND EXISTS (SELECT 1 FROM public.chat_pesan AS m WHERE m.sesi_id = s.id AND m.pengirim = 'pengunjung')
      AND GREATEST(s.created_at,
                   COALESCE((SELECT pg_catalog.max(m.created_at) FROM public.chat_pesan AS m WHERE m.sesi_id = s.id),
                            s.created_at)) >= v_now - INTERVAL '24 hours'
    ORDER BY s.created_at, s.id
  LOOP
    v_h_id := NULL; v_h_rol := NULL; v_h_lyn := NULL;
    IF r.status = 'aktif' AND r.ditangani_oleh IS NOT NULL THEN
      SELECT p.id, p.role, p.layanan_id INTO v_h_id, v_h_rol, v_h_lyn FROM public.petugas AS p WHERE p.id = r.ditangani_oleh;
    END IF;
    IF v_h_id IS NOT NULL THEN
      v_kid := public.chat_buat_kunjungan(r.id, 'dilayani', (r.created_at AT TIME ZONE 'Asia/Jakarta')::date);
      INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, layanan_id, saluran, penangan_id, status,
                                     mulai_at, chat_sesi_id)
      VALUES (v_kid, 1,
              CASE WHEN v_h_rol = 'petugas' AND v_h_lyn IS NOT NULL THEN 'layanan' ELSE 'fo' END,
              CASE WHEN v_h_rol = 'petugas' AND v_h_lyn IS NOT NULL THEN v_h_lyn END,
              'chat', v_h_id, 'berjalan', v_now, r.id);
    ELSE
      v_kid := public.chat_buat_kunjungan(r.id, 'menunggu', (r.created_at AT TIME ZONE 'Asia/Jakarta')::date);
      INSERT INTO public.penanganan (kunjungan_id, tahap_ke, peran_tahap, saluran, status, chat_sesi_id)
      VALUES (v_kid, 1, 'fo', 'chat', 'menunggu', r.id);
      IF r.status = 'aktif' THEN
        PERFORM public.chat_ubah_sesi(r.id, 'eskalasi', NULL);
      END IF;
    END IF;
  END LOOP;
END $$;
