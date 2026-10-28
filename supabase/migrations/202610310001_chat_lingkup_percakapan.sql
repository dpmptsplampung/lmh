-- 202610310001_chat_lingkup_percakapan.sql
-- Fase 5 (spec docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md §8, §6.1; ADR 0003; rencana
-- docs/superpowers/plans/2026-10-31-fase-5-live-chat.md Task 1). Forward-only, ADITIF terhadap data (B1): tidak ada
-- DELETE/TRUNCATE/DROP TABLE/DROP COLUMN, tidak ada UPDATE, tidak ada tabel/kolom baru.
--
-- ISI
--   1. boleh_chat_sesi(sesi) = lingkup baca chat staf (menutup celah Fase 3: chat_sesi/chat_pesan terbaca semua FO dan
--      semua petugas sebuah Layanan). Admin semua; FO+Koordinator semua; Petugas+Koordinator sesi Layanannya; siapa pun
--      yang menangani (ditangani_oleh, atau penanganan.penangan_id) sesi itu; jendela operasional = sesi TERBUKA
--      (eskalasi/aktif, bot <= 7 hari seperti chat_sesi_ringkas) bagi FO (semua Layanan) dan Petugas (Layanannya) agar
--      kotak masuk/ambil/teruskan tetap berjalan. Sesi yang sudah selesai hanya dalam lingkup data.
--   2. Policy baca chat_sesi (chat_sesi_owner_select) dan baca chat_pesan (chat_pesan_owner_select) diganti: pemilik
--      (pengunjung.auth_user_id = auth.uid()) ATAU boleh_chat_sesi. Policy UPDATE chat_sesi (chat_sesi_petugas_update)
--      menjadi PEMILIK SAJA (staf menulis lewat RPC/route service-role; kolom staf dijaga trigger CHAT_HARUS_RPC).
--      Policy INSERT tidak disentuh. chat_sesi_ringkas (SECURITY INVOKER) otomatis
--      mengikuti.
--   3. chat_percakapan_saya(): daftar percakapan pengunjung = satu baris per (pengunjung, Layanan), DITURUNKAN dari
--      chat_sesi (tanpa tabel/kolom baru, B1): sesi lama otomatis menjadi riwayat. Hanya milik auth.uid().
--   4. Indeks (pengunjung_id, layanan_id, created_at DESC) untuk riwayat percakapan.
--
-- SYARAT / URUTAN: setelah 202610290001 (staf_lingkup); disusul 202610310002. Penjaga di bagian 0.
-- PENERAPAN (pemilik; WAJIB atomik; dry-run dulu; bersama 202610310002):
--   node scripts/apply-migration.mjs supabase/migrations/202610310001_chat_lingkup_percakapan.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610310001_chat_lingkup_percakapan.sql --atomic
-- KLIEN: aman di-deploy sebelum migrasi (route memakai aturan TS lama bila boleh_chat_sesi belum ada).
-- Idempoten. Rollback tidak disediakan sebagai berkas (aditif); memulihkan policy lama = DROP POLICY lalu CREATE POLICY
-- seperti 202609230001 bagian 3 (chat_sesi_owner_select, chat_sesi_petugas_update, chat_pesan_owner_select).

-- ============================================================
-- 0. Penjaga prasyarat
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.staf_lingkup()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610290001_koordinator_akses_data belum diterapkan (staf_lingkup)';
  END IF;
  IF pg_catalog.to_regclass('public.chat_sesi') IS NULL OR pg_catalog.to_regclass('public.penanganan') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel chat_sesi/penanganan belum ada';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_sesi_ringkas(integer,boolean)') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: 202610070001_chat_fix_guard_ringkas belum diterapkan (chat_sesi_ringkas)';
  END IF;
END $$;

-- ============================================================
-- 1. Lingkup baca chat staf
-- ============================================================
CREATE OR REPLACE FUNCTION public.boleh_chat_sesi(p_sesi uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staf_lingkup() AS me
    JOIN public.chat_sesi AS s ON s.id = p_sesi
    WHERE me.role = 'admin'
       OR (me.role = 'front_office' AND me.koordinator)
       OR (me.role = 'petugas' AND me.koordinator AND me.layanan_id IS NOT NULL AND s.layanan_id = me.layanan_id)
       OR s.ditangani_oleh = me.id
       OR EXISTS (SELECT 1 FROM public.penanganan AS p WHERE p.chat_sesi_id = s.id AND p.penangan_id = me.id)
       OR (
         (s.status IN ('eskalasi', 'aktif')
          OR (s.status = 'bot' AND s.updated_at > pg_catalog.now() - INTERVAL '7 days'))
         AND (me.role = 'front_office'
              OR (me.role = 'petugas' AND me.layanan_id IS NOT NULL AND s.layanan_id = me.layanan_id))
       )
  )
$$;

REVOKE ALL ON FUNCTION public.boleh_chat_sesi(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.boleh_chat_sesi(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.boleh_chat_sesi(uuid) IS
  '202610310001: lingkup baca chat staf (Fase 5). Admin; FO Koordinator; Petugas Koordinator Layanannya; penangan sendiri; jendela operasional = sesi terbuka.';

-- ============================================================
-- 2. Policy baca/ubah chat_sesi dan baca chat_pesan
-- ============================================================
DROP POLICY IF EXISTS "chat_sesi_owner_select" ON public.chat_sesi;
CREATE POLICY "chat_sesi_owner_select" ON public.chat_sesi FOR SELECT TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    OR public.boleh_chat_sesi(id)
  );

-- UPDATE: HANYA pemilik (review Fase 5 A2). Semua perubahan staf atas chat_sesi lewat RPC SECURITY DEFINER (chat_ambil,
-- chat_teruskan, chat_selesai, tutup_chat_tertinggal) atau route service-role (/api/chat/ai: bot -> eskalasi); tidak ada
-- UPDATE staf langsung dari klien. Nama policy dipertahankan agar DROP/CREATE idempoten.
DROP POLICY IF EXISTS "chat_sesi_petugas_update" ON public.chat_sesi;
CREATE POLICY "chat_sesi_petugas_update" ON public.chat_sesi FOR UPDATE TO authenticated
  USING (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
  )
  WITH CHECK (
    pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "chat_pesan_owner_select" ON public.chat_pesan;
CREATE POLICY "chat_pesan_owner_select" ON public.chat_pesan FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_sesi
      WHERE id = chat_pesan.sesi_id
        AND pengunjung_id IN (SELECT id FROM public.pengunjung WHERE auth_user_id = auth.uid())
    )
    OR public.boleh_chat_sesi(sesi_id)
  );

-- ============================================================
-- 3. Daftar percakapan pengunjung (diturunkan dari chat_sesi)
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_chat_sesi_pengunjung_layanan
  ON public.chat_sesi (pengunjung_id, layanan_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.chat_percakapan_saya()
RETURNS TABLE (
  layanan_id       uuid,
  layanan_nama     text,
  layanan_aktif    boolean,
  punya_chat       boolean,
  chatbot_aktif    boolean,
  jumlah_sesi      integer,
  sesi_terakhir_id uuid,
  sesi_terbuka_id  uuid,
  status_terakhir  text,
  last_pesan       text,
  last_pesan_at    timestamptz,
  last_pengirim    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  WITH saya AS (
    SELECT p.id FROM public.pengunjung AS p WHERE p.auth_user_id = auth.uid()
  ),
  sesi AS (
    SELECT s.id, s.layanan_id, s.status, s.created_at
    FROM public.chat_sesi AS s
    WHERE s.pengunjung_id IN (SELECT saya.id FROM saya)
  ),
  agregat AS (
    SELECT sesi.layanan_id,
           pg_catalog.count(*)::integer AS jumlah_sesi,
           pg_catalog.max(sesi.created_at) AS terakhir_dibuat,
           (pg_catalog.array_agg(sesi.id ORDER BY sesi.created_at DESC, sesi.id DESC))[1] AS sesi_terakhir_id,
           (pg_catalog.array_agg(sesi.id ORDER BY sesi.created_at DESC, sesi.id DESC)
              FILTER (WHERE sesi.status <> 'selesai'))[1] AS sesi_terbuka_id,
           (pg_catalog.array_agg(sesi.status ORDER BY sesi.created_at DESC, sesi.id DESC))[1] AS status_terakhir
    FROM sesi
    GROUP BY sesi.layanan_id
  )
  SELECT a.layanan_id,
         l.nama,
         l.aktif,
         COALESCE(l.punya_chat, false),
         COALESCE(l.chatbot_aktif, false),
         a.jumlah_sesi,
         a.sesi_terakhir_id,
         a.sesi_terbuka_id,
         a.status_terakhir,
         lp.isi,
         lp.created_at,
         lp.pengirim
  FROM agregat AS a
  JOIN public.layanan AS l ON l.id = a.layanan_id
  LEFT JOIN LATERAL (
    SELECT pg_catalog.left(m.isi, 120) AS isi, m.created_at, m.pengirim
    FROM public.chat_pesan AS m
    JOIN public.chat_sesi AS s2 ON s2.id = m.sesi_id
    WHERE s2.layanan_id = a.layanan_id
      AND s2.pengunjung_id IN (SELECT saya.id FROM saya)
    ORDER BY m.created_at DESC
    LIMIT 1
  ) AS lp ON true
  ORDER BY GREATEST(COALESCE(lp.created_at, a.terakhir_dibuat), a.terakhir_dibuat) DESC, l.nama
$$;

REVOKE ALL ON FUNCTION public.chat_percakapan_saya() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.chat_percakapan_saya() TO authenticated;

COMMENT ON FUNCTION public.chat_percakapan_saya() IS
  '202610310001: satu baris per percakapan (pengunjung, Layanan) milik pemanggil, diturunkan dari chat_sesi; tanpa data pengunjung lain.';
