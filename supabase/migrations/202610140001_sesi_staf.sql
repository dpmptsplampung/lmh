-- 202610140001_sesi_staf.sql
-- Sesi tunggal staf (tugas A1; K1 spec docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md §5,
-- rencana docs/superpowers/plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md Tahap A).
--
-- KEPUTUSAN CEO: satu akun per orang, TIDAK boleh login ganda. Login baru MENIMPA sesi lama; sesi lama otomatis
-- tak sah DI SERVER. Berlaku hanya untuk peran staf (admin, petugas, front_office; get_my_role()); pengunjung
-- (anon sign-in) tidak terkena. Logout otomatis setelah jam tutup layanan dan idle 2 jam (dapat diubah admin).
--
-- ISI
--   1. Tabel public.sesi_staf(user_id PK -> auth.users, session_id, dibuat_at, last_seen, aktivitas_at).
--      RLS aktif TANPA policy dan REVOKE total dari anon/authenticated (hanya service_role): klien TIDAK punya
--      jalur baca/tulis langsung. Semua lewat RPC SECURITY DEFINER di bawah. (Pilihan paling ketat: klien tidak
--      perlu membaca barisnya, karena ping_sesi() sudah mengembalikan status. Bila A2 kelak butuh push realtime
--      "digantikan", migrasi lanjutan menambah policy SELECT-pemilik + publikasi realtime; bukan di sini.)
--   2. Pengaturan site_settings: sesi_idle_menit (120) dan sesi_tunggal_aktif (false), ON CONFLICT DO NOTHING.
--   3. Fungsi internal (hanya service_role/definer): sesi_klaim_id(), sesi_idle_menit(), sesi_tunggal_aktif().
--   4. sesi_status() -> text, sesi_valid() -> boolean (dipakai RPC mutasi Tahap A3 dan proxy).
--   5. RPC klien: daftarkan_sesi(), ping_sesi(p_aktif boolean DEFAULT true), akhiri_sesi().
--   Migrasi ini TIDAK mengubah fungsi/policy/tabel lain. Penerapan sesi_valid() ke RPC mutasi = migrasi A3.
--
-- KLAIM session_id (DIVERIFIKASI pada dokumentasi resmi Supabase, 2026-10-13, bukan pada token produksi):
--   - https://supabase.com/docs/guides/auth/jwt-fields : `session_id` (string, "Unique session identifier")
--     tercantum sebagai klaim WAJIB access token (bersama iss, aud, exp, iat, sub, role, aal, email, phone,
--     is_anonymous).
--   - https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook : daftar klaim wajib yang sama dan
--     contoh `"session_id": "4b938a09-..."`. Hook proyek ini (set_user_role_claim, 202610080001) hanya jsonb_set
--     pada claims.app_metadata dan mengembalikan event utuh, jadi session_id tidak hilang.
--   - https://supabase.com/docs/guides/auth/sessions : session_id = UUID sesi; penyegaran token menukar refresh
--     token DI DALAM sesi yang sama, sehingga session_id TETAP selama sesi hidup (ini kesimpulan dari dokumen,
--     tidak dinyatakan eksplisit; BELUM dibuktikan pada token proyek ini. Pembuktian = langkah pasca-terap/uji A2:
--     decode access token staf sebelum dan sesudah penyegaran dan bandingkan session_id; lihat docs/MIGRATIONS.md).
--   Dibaca lewat auth.jwt() ->> 'session_id' (klaim JWT yang dikirim PostgREST), BUKAN dari auth.sessions
--   (tidak dibaca dari klien; tidak diandalkan). Bila klaim hilang, daftarkan_sesi() menolak dengan SESI_TANPA_KLAIM
--   (tidak diam-diam lolos) dan sesi_status() menganggap sesi staf berbaris 'tidak_terdaftar'.
--   Setting Auth "Single session per user" Supabase (paket Pro+, hanya diberlakukan saat refresh) TIDAK diandalkan.
--
-- MATRIKS KEPUTUSAN sesi_status() / sesi_valid()  (urut dari atas; yang pertama cocok menang)
--   pemanggil bukan staf aktif (pengunjung, service_role, akun nonaktif)         -> 'bukan_staf'     valid
--   staf, TANPA baris sesi_staf, sesi_tunggal_aktif = false                      -> 'transisi'      valid
--   staf, TANPA baris sesi_staf, sesi_tunggal_aktif = true                       -> 'tidak_terdaftar' TIDAK valid
--   staf, baris ada, klaim session_id kosong/tak berbentuk UUID                  -> 'tidak_terdaftar' TIDAK valid
--   staf, baris ada, klaim session_id <> baris.session_id                        -> 'digantikan'     TIDAK valid
--   staf, baris ada, sama, last_seen ATAU aktivitas_at lebih tua dari idle       -> 'idle'           TIDAK valid
--   staf, baris ada, sama, belum idle                                            -> 'ok'             valid
--   Flag sesi_tunggal_aktif HANYA mengatur kasus "staf tanpa baris". Staf yang SUDAH punya baris selalu ditegakkan
--   penuh (digantikan/idle), juga saat flag false: baris adalah bukti klien A2 sudah memanggil daftarkan_sesi().
--
-- MASA TRANSISI (jelas dan terdokumentasi): sesi_tunggal_aktif = FALSE sampai cutover. Alasan: staf yang sudah login
-- SAAT migrasi ini diterapkan belum punya baris (login lama tidak memanggil daftarkan_sesi). Bila sesi_valid() langsung
-- menolak mereka, SEMUA staf yang sedang bekerja (termasuk Admin) terkunci dari RPC mutasi A3 sampai login ulang.
-- Selama flag false: staf tanpa baris tetap valid ('transisi'); begitu login ulang lewat klien A2 (atau klien
-- memanggil daftarkan_sesi saat ping mengembalikan status 'transisi'), baris dibuat dan penegakan penuh berlaku.
-- TRADE-OFF KEAMANAN: selama flag false, sesi staf lama yang tidak pernah mendaftar BELUM bisa digantikan/dipaksa
-- idle oleh server; jaminan sesi tunggal baru utuh setelah cutover (flag true, dilakukan terjadwal oleh CEO setelah
-- klien A2 ter-deploy). Keadaan flag true tanpa klien A2 = SEMUA staf ditolak RPC mutasi (tak ada yang mendaftar).
-- Urutan benar: terapkan migrasi ini -> deploy klien A2 -> terapkan A3 -> beri waktu staf login ulang -> ubah flag.
-- Ubah flag lewat site_settings (UPDATE site_settings SET value='true' WHERE key='sesi_tunggal_aktif') oleh Admin
-- (policy settings_admin_all) atau migrasi data; perubahan tercatat di audit_log (trg_audit_site_settings).
-- Nilai flag yang tak dikenal dibaca sebagai TRUE (gagal tertutup; nilai false hanya false/0/off/no/tidak/nonaktif);
-- baris hilang/kosong = false (default transisi). Nilai idle di luar 5..1440 menit atau bukan angka = 120.
--
-- IDLE = ketiadaan AKTIVITAS, bukan hanya ketiadaan heartbeat: ping_sesi(p_aktif) memperbarui last_seen (heartbeat)
-- selalu, tetapi aktivitas_at hanya bila p_aktif = true (klien mengirim true bila ada input pengguna sejak ping
-- sebelumnya; default true agar ping_sesi() polos = heartbeat+aktivitas). Tanpa kolom ini, tab terbuka yang terus
-- berdetak (komputer dibiarkan di meja) tidak pernah idle dan batas 2 jam tak berarti. Menyimpang dari rancangan awal
-- (tabel 4 kolom): satu kolom tambahan, ping_sesi() tanpa argumen tetap sah.
--
-- JAM TUTUP: sumber tunggal = site_settings.jam_tutup_layanan lewat public.jam_tutup_layanan() (202610090001; dikunci
-- 16:00 oleh guard 202610090005; dibaca default 16:00 bila tidak valid). Bukan hardcode di berkas ini. Sumber yang sama
-- dipakai layanan_sudah_tutup() dan guard walk-in. Catatan: antrean_dibuka() (202607290011) adalah gerbang
-- per layanan/hari (absensi petugas, libur) dan BUKAN sumber jam tutup; hari libur tidak dipertimbangkan di sini
-- (staf yang login hari libur tetap diakhiri pada jam tutup yang sama, tidak ada kondisi aneh).
-- ping_sesi() mengembalikan tutup = true bila sesi DIBUAT SEBELUM saat tutup terakhir (hari ini jam tutup bila sudah
-- lewat, selain itu kemarin jam tutup), dihitung WIB. Jadi login SETELAH jam tutup (mis. Admin lembur 17:00) tidak
-- langsung dikeluarkan; sesi itu baru berakhir pada jam tutup berikutnya (dan tetap dibatasi idle). Bendera tutup
-- bersifat INFORMASI untuk klien (logout otomatis; klien boleh memberi tenggang untuk menyelesaikan form). Server TIDAK
-- menolak mutasi hanya karena tutup (agar tidak memutus petugas di tengah pengisian form); batas keras server = idle
-- dan digantikan. Menegakkan tutup di sesi_status() (status 'tutup') adalah opsi terpisah yang perlu keputusan CEO.
--
-- SISA RISIKO (didokumentasikan): (a) pemegang access token yang masih berlaku dapat memanggil daftarkan_sesi() dan
-- merebut sesi (sama dengan kemampuan login sebagai orang itu); klien A2 TIDAK boleh memanggil daftarkan_sesi()
-- otomatis dari sesi yang baru dinyatakan 'digantikan' (akan terjadi rebutan bolak-balik) — hanya setelah login baru.
-- (b) Pembatasan ini mengatur RPC mutasi (A3) dan proxy; pembacaan lewat RLS memakai JWT yang sama tetap bisa sampai JWT
-- kedaluwarsa. (c) sesi_status() dipanggil per pemanggilan RPC (satu lookup PK + dua baca site_settings); jangan dipakai
-- di policy per-baris.
--
-- SYARAT: 202610090001 (jam_tutup_layanan) dan get_my_role() (202607290004) sudah diterapkan; penjaga di bagian 0.
-- PENERAPAN: berkas ini membuat fungsi, jadi WAJIB mode atomik. Dry-run dulu:
--   node scripts/apply-migration.mjs supabase/migrations/202610140001_sesi_staf.sql --atomic --dry-run
--   node scripts/apply-migration.mjs supabase/migrations/202610140001_sesi_staf.sql --atomic
-- Idempoten (aman dijalankan dua kali; tidak menimpa nilai pengaturan yang sudah ada). Sentuh produksi hanya setelah
-- konfirmasi CEO (docs/ATURAN_MIGRASI.md). Rollback: docs/rollback-sesi-staf-202610140001.sql.

-- ============================================================
-- 0. Penjaga prasyarat (galat jelas, bukan galat samar saat runtime)
-- ============================================================
DO $$
BEGIN
  IF pg_catalog.to_regprocedure('public.jam_tutup_layanan()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.jam_tutup_layanan() belum ada (terapkan 202610090001_rbac_tahap1.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_my_role()') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: public.get_my_role() belum ada (terapkan 202607290004_petugas_aktif.sql lebih dulu)';
  END IF;
  IF pg_catalog.to_regclass('public.site_settings') IS NULL THEN
    RAISE EXCEPTION 'PRASYARAT: tabel public.site_settings belum ada';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = 'public.site_settings'::regclass AND a.attname = 'keterangan' AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'PRASYARAT: kolom site_settings.keterangan belum ada (terapkan 202607300019_wp26_cms_registry.sql lebih dulu)';
  END IF;
END $$;

-- ============================================================
-- 1. Tabel sesi_staf (satu baris per pengguna staf = sesi tunggal)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sesi_staf (
  user_id      uuid        PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  session_id   uuid        NOT NULL,
  dibuat_at    timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  aktivitas_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sesi_staf IS
  'Sesi tunggal staf: satu baris per pengguna, berisi session_id (klaim JWT) sesi yang SAH. Hanya diubah RPC daftarkan_sesi/ping_sesi/akhiri_sesi (SECURITY DEFINER). Klien tidak punya akses langsung.';
COMMENT ON COLUMN public.sesi_staf.session_id IS 'Klaim session_id dari JWT sesi sah terakhir (login terbaru menimpa).';
COMMENT ON COLUMN public.sesi_staf.dibuat_at IS 'Waktu sesi ini didaftarkan (login). Dipakai untuk bendera tutup (sesi dibuat sebelum jam tutup terakhir).';
COMMENT ON COLUMN public.sesi_staf.last_seen IS 'Heartbeat terakhir (ping_sesi).';
COMMENT ON COLUMN public.sesi_staf.aktivitas_at IS 'Aktivitas pengguna terakhir (ping_sesi dengan p_aktif = true). Idle dihitung dari last_seen DAN aktivitas_at.';

ALTER TABLE public.sesi_staf ENABLE ROW LEVEL SECURITY;
-- Sengaja TANPA policy: anon/authenticated tidak punya jalur baca/tulis langsung. Penulis sah: fungsi
-- SECURITY DEFINER (pemilik tabel) dan service_role.
REVOKE ALL ON TABLE public.sesi_staf FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sesi_staf TO service_role;

-- ============================================================
-- 2. Pengaturan (tidak menimpa nilai yang sudah ada)
-- ============================================================
INSERT INTO public.site_settings (key, value, keterangan) VALUES
  ('sesi_idle_menit', '120',
   'Batas idle sesi staf (menit, 5-1440). Lewat batas tanpa aktivitas = sesi tidak sah dan staf harus login ulang. Nilai tidak valid dibaca 120.'),
  ('sesi_tunggal_aktif', 'false',
   'Cutover sesi tunggal staf. false = masa transisi (staf tanpa baris sesi tetap diterima). true = staf wajib terdaftar lewat login baru. JANGAN ubah ke true sebelum klien sesi tunggal ter-deploy dan staf login ulang.')
ON CONFLICT (key) DO NOTHING;

-- ============================================================
-- 3. Fungsi internal (tidak diberikan ke klien)
-- ============================================================
-- Klaim session_id dari JWT permintaan; NULL bila tidak ada atau bukan UUID.
CREATE OR REPLACE FUNCTION public.sesi_klaim_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text := auth.jwt() ->> 'session_id';
BEGIN
  IF v IS NOT NULL AND v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v::uuid;
  END IF;
  RETURN NULL;
END $$;

-- Batas idle (menit): angka 5..1440, selain itu 120.
CREATE OR REPLACE FUNCTION public.sesi_idle_menit()
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text;
  n integer;
BEGIN
  SELECT s.value INTO v FROM public.site_settings AS s WHERE s.key = 'sesi_idle_menit';
  IF v IS NOT NULL AND pg_catalog.btrim(v) ~ '^[0-9]{1,4}$' THEN
    n := pg_catalog.btrim(v)::integer;
    IF n BETWEEN 5 AND 1440 THEN
      RETURN n;
    END IF;
  END IF;
  RETURN 120;
END $$;

-- Cutover: baris hilang/kosong = false (transisi). Nilai false eksplisit = false. SEMUA nilai lain = true
-- (gagal tertutup: salah ketik tidak mematikan penegakan; akibatnya hanya staf harus login ulang).
CREATE OR REPLACE FUNCTION public.sesi_tunggal_aktif()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v text;
BEGIN
  SELECT pg_catalog.lower(pg_catalog.btrim(s.value)) INTO v
  FROM public.site_settings AS s WHERE s.key = 'sesi_tunggal_aktif';
  IF v IS NULL OR v = '' THEN
    RETURN false;
  END IF;
  RETURN v NOT IN ('false', '0', 'off', 'no', 'tidak', 'nonaktif');
END $$;

REVOKE ALL ON FUNCTION public.sesi_klaim_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sesi_klaim_id() TO service_role;
REVOKE ALL ON FUNCTION public.sesi_idle_menit() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sesi_idle_menit() TO service_role;
REVOKE ALL ON FUNCTION public.sesi_tunggal_aktif() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sesi_tunggal_aktif() TO service_role;

-- ============================================================
-- 4. sesi_status() dan sesi_valid()
-- ============================================================
-- Status sesi pemanggil (lihat MATRIKS di header). Hanya membaca; hanya menyangkut diri pemanggil.
CREATE OR REPLACE FUNCTION public.sesi_status()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_peran text := public.get_my_role();
  v_sid   uuid;
  v_baris public.sesi_staf%ROWTYPE;
  v_idle  interval;
BEGIN
  IF v_uid IS NULL OR v_peran IS NULL OR v_peran NOT IN ('admin', 'petugas', 'front_office') THEN
    RETURN 'bukan_staf';
  END IF;

  SELECT * INTO v_baris FROM public.sesi_staf AS ss WHERE ss.user_id = v_uid;
  IF NOT FOUND THEN
    IF public.sesi_tunggal_aktif() THEN
      RETURN 'tidak_terdaftar';
    END IF;
    RETURN 'transisi';
  END IF;

  v_sid := public.sesi_klaim_id();
  IF v_sid IS NULL THEN
    RETURN 'tidak_terdaftar';
  END IF;
  IF v_sid <> v_baris.session_id THEN
    RETURN 'digantikan';
  END IF;

  v_idle := pg_catalog.make_interval(mins => public.sesi_idle_menit());
  IF v_baris.last_seen <= pg_catalog.now() - v_idle OR v_baris.aktivitas_at <= pg_catalog.now() - v_idle THEN
    RETURN 'idle';
  END IF;
  RETURN 'ok';
END $$;

CREATE OR REPLACE FUNCTION public.sesi_valid()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.sesi_status() IN ('bukan_staf', 'transisi', 'ok')
$$;

REVOKE ALL ON FUNCTION public.sesi_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sesi_status() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.sesi_valid() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sesi_valid() TO authenticated, service_role;

-- ============================================================
-- 5. RPC klien: daftarkan_sesi, ping_sesi, akhiri_sesi
-- ============================================================
-- Dipanggil SEKALI setelah login sukses. Menimpa baris pemanggil: sesi lama otomatis 'digantikan'.
CREATE OR REPLACE FUNCTION public.daftarkan_sesi()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_peran text := public.get_my_role();
  v_sid   uuid;
BEGIN
  IF v_uid IS NULL OR v_peran IS NULL OR v_peran NOT IN ('admin', 'petugas', 'front_office') THEN
    RAISE EXCEPTION 'FORBIDDEN: sesi tunggal hanya untuk staf aktif (admin, petugas, front_office)'
      USING ERRCODE = '42501';
  END IF;

  v_sid := public.sesi_klaim_id();
  IF v_sid IS NULL THEN
    RAISE EXCEPTION 'SESI_TANPA_KLAIM: JWT tidak memuat klaim session_id yang valid; sesi tidak dapat didaftarkan'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.sesi_staf AS ss (user_id, session_id, dibuat_at, last_seen, aktivitas_at)
  VALUES (v_uid, v_sid, pg_catalog.now(), pg_catalog.now(), pg_catalog.now())
  ON CONFLICT (user_id) DO UPDATE
    SET session_id   = EXCLUDED.session_id,
        dibuat_at    = EXCLUDED.dibuat_at,
        last_seen    = EXCLUDED.last_seen,
        aktivitas_at = EXCLUDED.aktivitas_at;

  RETURN pg_catalog.jsonb_build_object('ok', true, 'idle_menit', public.sesi_idle_menit());
END $$;

-- Heartbeat. Hanya memperbarui bila sesi sah ('ok'); sesi tak sah dikembalikan apa adanya, TANPA pembaruan.
--   valid  : {valid:true,  status:'ok'|'transisi'|'bukan_staf', tutup, idle_menit}
--   invalid: {valid:false, status:<alasan>, alasan:'digantikan'|'idle'|'tidak_terdaftar', tutup:false, idle_menit}
-- p_aktif = true bila ada aktivitas pengguna sejak ping sebelumnya (memperbarui aktivitas_at); false = heartbeat saja.
CREATE OR REPLACE FUNCTION public.ping_sesi(p_aktif boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status    text := public.sesi_status();
  v_idle      integer := public.sesi_idle_menit();
  v_uid       uuid := auth.uid();
  v_dibuat    timestamptz;
  v_tutup     boolean := false;
  v_now_wib   timestamp;
  v_batas_wib timestamp;
BEGIN
  IF v_status NOT IN ('bukan_staf', 'transisi', 'ok') THEN
    RETURN pg_catalog.jsonb_build_object(
      'valid', false, 'status', v_status, 'alasan', v_status, 'tutup', false, 'idle_menit', v_idle);
  END IF;

  IF v_status = 'ok' THEN
    UPDATE public.sesi_staf AS ss
    SET last_seen    = pg_catalog.now(),
        aktivitas_at = CASE WHEN COALESCE(p_aktif, true) THEN pg_catalog.now() ELSE ss.aktivitas_at END
    WHERE ss.user_id = v_uid AND ss.session_id = public.sesi_klaim_id()
    RETURNING ss.dibuat_at INTO v_dibuat;

    IF NOT FOUND THEN
      -- Tertimpa login lain di antara status dan pembaruan.
      RETURN pg_catalog.jsonb_build_object(
        'valid', false, 'status', 'digantikan', 'alasan', 'digantikan', 'tutup', false, 'idle_menit', v_idle);
    END IF;

    -- Saat tutup terakhir (WIB): hari ini jam tutup bila sudah lewat, selain itu kemarin jam tutup.
    v_now_wib   := pg_catalog.now() AT TIME ZONE 'Asia/Jakarta';
    v_batas_wib := v_now_wib::date + public.jam_tutup_layanan();
    IF v_now_wib < v_batas_wib THEN
      v_batas_wib := v_batas_wib - interval '1 day';
    END IF;
    v_tutup := v_dibuat < (v_batas_wib AT TIME ZONE 'Asia/Jakarta');
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'valid', true, 'status', v_status, 'tutup', v_tutup, 'idle_menit', v_idle);
END $$;

-- Logout eksplisit. Hanya menghapus baris bila session_id-nya MILIK sesi pemanggil: logout dari perangkat lama
-- (yang sudah digantikan) tidak boleh menghapus sesi baru.
CREATE OR REPLACE FUNCTION public.akhiri_sesi()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_sid uuid := public.sesi_klaim_id();
  v_n   integer := 0;
BEGIN
  IF v_uid IS NOT NULL AND v_sid IS NOT NULL THEN
    DELETE FROM public.sesi_staf AS ss WHERE ss.user_id = v_uid AND ss.session_id = v_sid;
    GET DIAGNOSTICS v_n = ROW_COUNT;
  END IF;
  RETURN pg_catalog.jsonb_build_object('ok', true, 'dihapus', v_n > 0);
END $$;

REVOKE ALL ON FUNCTION public.daftarkan_sesi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.daftarkan_sesi() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.ping_sesi(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ping_sesi(boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.akhiri_sesi() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.akhiri_sesi() TO authenticated, service_role;
