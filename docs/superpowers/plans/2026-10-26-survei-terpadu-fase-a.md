# Survei Terpadu, Fase A (SPAK + SKM, QR, status, unduhan): Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pengunjung yang layanannya selesai memindai QR di layar staf, mengisi SPAK lalu SKM dalam wizard HP 5 langkah, jawaban tersimpan di dua tabel, statusnya tampil di antrean dan kunjungan, dan Admin/FO bisa mengunduh hasilnya.

**Architecture:** Trigger DB membuat `survei_undangan` (token 32 jam) saat `kunjungan` menjadi `selesai`; staf mengambil QR lewat RPC; wizard publik memanggil `get_survei_context` dan route `POST /api/survei/kirim` yang memanggil `kirim_survei` (satu transaksi, dua tabel). Logika wizard berupa fungsi murni di `src/lib/survei/`, UI di `src/components/survei/`.

**Tech Stack:** Next.js 16 App Router (React 19, CSS Modules), Supabase/Postgres (RLS, RPC `SECURITY DEFINER`), zod, ExcelJS, `qrcode`, Vitest + Testing Library, PGlite (hanya verifikasi lokal, tidak masuk `package.json`).

**Spec:** `docs/superpowers/specs/2026-10-26-survei-terpadu-design.md` (Fase B saran/pengaduan dan Fase C impor memiliki rencana sendiri, bukan bagian ini).

## Global Constraints

- Implementasi di worktree dan branch baru dari `origin/main` (mis. `feat/survei-terpadu-a`), bukan di `docs/spec-survei-terpadu`. Jalankan `npm ci` bila `node_modules` belum ada.
- Bahasa UI dan komentar kode: Indonesia. Alias `@/` = `src/`. Semua hari/batas hari memakai WIB lewat `src/lib/time.ts`.
- Baca guide yang relevan di `node_modules/next/dist/docs/` sebelum menyentuh kode Next.js (Next 16 punya breaking changes; `params` route dinamis berupa Promise).
- **Dilarang** menerapkan migrasi, menjalankan `npm run test:rls`, `node scripts/apply-migration.mjs`, query ke DB produksi, atau memakai kunci di `.env.local`. Verifikasi DB hanya statis dan lewat PGlite lokal. Pemilik yang menerapkan migrasi. Tanpa `git push` kecuali diminta.
- Migrasi: berkas forward baru `YYYYMMDDNNNN_nama.sql`, nomor lebih besar dari semua yang ada (`202610260001` sudah dipakai paket audit); tanpa `BEGIN/COMMIT`; jangan mengedit migrasi lama.
- Fungsi `SECURITY DEFINER`: `SET search_path = pg_catalog, public`, `REVOKE ... FROM PUBLIC, anon, authenticated` lalu `GRANT` eksplisit. Policy baru selalu `TO authenticated`. Tidak ada tulis langsung dari klien ke tabel jawaban.
- Token: 64 karakter heksadesimal dari dua `gen_random_uuid()` digabung tanpa tanda hubung. Berlaku **32 jam** sejak `kunjungan.selesai_at`. Ditampilkan hanya sebagai QR, tidak pernah sebagai teks tautan. URL: `/survei/<token>`.
- Teks pertanyaan dan rentang jawaban persis Lampiran A spec. SPAK nilai 1–6 (6 = Sangat Setuju). SKM nilai 4–1 (Sangat Baik = 4, Baik = 3, Cukup = 2, Kurang = 1), 11 unsur.
- Wizard: 5 langkah (SPAK 3+2 soal, SKM 4+4+3 unsur); ketukan jawaban terakhir langsung lanjut **tanpa delay**; jawaban terakhir SKM langsung mengirim; Next dan Back tetap ada; auto-lanjut hanya untuk ketukan/klik (bukan keyboard).
- IKM = rata-rata unsur terisi × 25. Baris lama 9 unsur tetap valid.
- Setiap commit diakhiri baris `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Gate akhir: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` (`npm run audit:check` gagal karena advisory dependensi yang sudah ada, di luar scope).

## Review Focus

Kasus yang tidak tersirat jelas oleh spec tetapi paling mungkin menggigit; tiap baris punya tes di task yang disebut.

1. `ensure_undangan` dipanggil dua kali (trigger dan `notify_kunjungan_status`) tidak membuat dua undangan dan tidak menggeser batas 32 jam → Task 2.
2. Kirim tepat di batas 32 jam dan setelahnya ditolak `expired`; context melaporkan `kedaluwarsa` (jam dari database) → Task 4.
3. Dua kiriman bersamaan atau ketukan ganda: satu `submitted`, sisanya `duplicate`, tanpa baris setengah jadi; UI mengunci ketukan ganda → Task 4 dan 9.
4. Payload nakal (kunci asing, kunci kurang, nilai 0/7/3.5/"3"/null, bukan objek) → `invalid` dan tidak ada baris tertulis → Task 4 dan 8.
5. Kunjungan selesai di FO (unit `fo`) dan baris lama berkolom `u10/u11` kosong tidak merusak `hitung_ikm`/`ringkasan_ikm`; petugas tidak bisa membaca SPAK → Task 3.

## Prosedur migrasi baru (berlaku untuk Task 2–5)

Mengikuti `docs/ATURAN_MIGRASI.md`; tiap task migrasi menghasilkan satu commit berisi semuanya:
1. `supabase/migrations/<nomor>_<nama>.sql` dengan header (masalah, isi, penerapan `--atomic --dry-run` lalu tanpa dry-run, rollback), meniru `202610260001_standar_pelayanan_admin_authenticated.sql` dan `202610140014_walkin_data_lengkap.sql`.
2. Test kontrak statis `supabase/migrations/<nama>.test.ts` (pola `standar_pelayanan_rls.test.ts`: `listMigrationFiles`, `stripSqlComments`, `pecahPernyataan`, `mengandungKontrolTransaksi`).
3. Tambahkan nama berkas ke `FORWARD_MIGRATION_FILES` di `supabase/migrations/migration-test-utils.ts`, lalu `node scripts/gen-migration-manifest.mjs` dan `--check`.
4. Rollback `docs/rollback-<nama>-<nomor>.sql`; entri di `docs/analysis/DB-CHANGES.md` (status "DITULIS, BELUM DITERAPKAN", sertakan hasil skenario PGlite) dan `docs/MIGRATIONS.md`.
5. Skenario PGlite `scripts/lokal/skenario-<nama>.mjs` (Task 1) dijalankan dan lolos.

---

### Task 1: Harness verifikasi lokal (PGlite)

**Files:**
- Create: `scripts/lokal/pglite-stub.sql`, `scripts/lokal/pglite-harness.mjs`, `scripts/lokal/README.md`, `scripts/lokal/skenario-smoke.mjs`
- Modify: `eslint.config.mjs` hanya bila `npm run lint` menolak berkas baru

**Interfaces:**
- Produces: `bukaDb(): Promise<PGlite>` (menerapkan stub), `sebagai(db, role: 'anon'|'authenticated'|'service_role'|'postgres', uid: string|null, sql: string, params?: unknown[]): Promise<{ ok: true; rows: any[] } | { ok: false; pesan: string }>` (RESET ROLE, `set_config('app.uid', uid)`, `SET ROLE`, jalankan, RESET), `terapkanBerkas(db, path)`, `cek(nama: string, kondisi: boolean, detail?: string)` yang mencatat lolos/gagal dan mengakhiri proses dengan kode 1 bila ada yang gagal.

- [ ] **Step 1:** Tulis `pglite-stub.sql`: role `anon`, `authenticated`, `service_role` (NOLOGIN); schema `auth` dengan `auth.uid()` membaca `current_setting('app.uid', true)`; tabel minimal `layanan(id, nama)`, `petugas(id, auth_user_id, role, aktif, layanan_id)`, `kunjungan` (kolom: `id, pengunjung_id, nama, kontak_hp, email, kategori, asal, qr_token, tanggal, status, selesai_at, layanan_saran_id, created_at, updated_at`), `tiket_antrean(id, kunjungan_id, layanan_id, status, waktu_selesai)`, `skm_respons` persis baseline `202607140003` ditambah `kunjungan_id uuid` dan indeks unik parsial dari `202610140007`. Salin badan asli fungsi `peran_saya` (`202610090001_rbac_tahap1.sql:28`) dan `kunjungan_layanan_skm` (`202610140007_wp24_akhiri_dual_write.sql:1115`); `boleh_kunjungan(uuid)` dan `boleh_layanan(uuid)` boleh disederhanakan (admin/front_office true, petugas hanya bila ada tiket layanannya) dengan komentar bahwa ini stub. Cabut dan beri `GRANT` seperti migrasi asli.
- [ ] **Step 2:** Tulis `pglite-harness.mjs` sesuai Interfaces dan `skenario-smoke.mjs` dengan cek: anon `SELECT` ke `skm_respons` ditolak, `service_role` bisa, `auth.uid()` mengikuti parameter `uid`.
- [ ] **Step 3:** Pasang tanpa mengubah package: `npm i --no-save @electric-sql/pglite` di root worktree. Jalankan `node scripts/lokal/skenario-smoke.mjs`. Expected: semua cek lolos, kode keluar 0. Catat di `README.md` perintah ini dan larangan menambah PGlite ke `package.json`.
- [ ] **Step 4:** Jalankan `npm run lint`; bila berkas `scripts/lokal/**` ditolak, tambahkan ke `ignores` di `eslint.config.mjs`. Pastikan `git status` tidak menunjukkan perubahan `package.json`/`package-lock.json`.
- [ ] **Step 5: Commit** `chore(lokal): harness PGlite untuk verifikasi perilaku DB tanpa produksi`.

---

### Task 2: Migrasi `survei_undangan`, trigger, QR staf, view status

**Files:**
- Create: `supabase/migrations/202611020001_survei_undangan.sql`, `supabase/migrations/survei_undangan.test.ts`, `docs/rollback-survei-undangan-202611020001.sql`, `scripts/lokal/skenario-survei-undangan.mjs`
- Modify: `supabase/migrations/migration-test-utils.ts`, `supabase/migrations/MANIFEST.json`, `docs/analysis/DB-CHANGES.md`, `docs/MIGRATIONS.md`

**Interfaces:**
- Consumes: `kunjungan(id, status, selesai_at)`, `kunjungan_layanan_skm(uuid) → uuid`, `boleh_kunjungan(uuid) → boolean`, `peran_saya()`.
- Produces (SQL):
  - tabel `public.survei_undangan(id uuid pk default gen_random_uuid(), kunjungan_id uuid not null unique references kunjungan on delete cascade, token text not null unique, layanan_id uuid references layanan on delete set null, unit text not null check (unit in ('layanan','fo')), dibuat_pada timestamptz not null default now(), kedaluwarsa_pada timestamptz not null, diisi_pada timestamptz, saran_dikirim boolean not null default false, pengaduan_dikirim boolean not null default false)`; RLS aktif **tanpa policy**; `REVOKE ALL` dari `anon, authenticated`.
  - `public.ensure_undangan(p_kunjungan_id uuid) RETURNS uuid` (id undangan; `NULL` bila kunjungan belum `selesai`; idempoten `ON CONFLICT (kunjungan_id) DO NOTHING`; `kedaluwarsa_pada = COALESCE(k.selesai_at, now()) + interval '32 hours'`; `unit = 'fo'` bila `kunjungan_layanan_skm` NULL, selain itu `'layanan'`); EXECUTE hanya `service_role`.
  - trigger `trg_kunjungan_selesai_undangan` `AFTER UPDATE OF status ON kunjungan` `WHEN (NEW.status = 'selesai' AND OLD.status IS DISTINCT FROM 'selesai')` memanggil `ensure_undangan(NEW.id)`.
  - `public.ambil_qr_survei(p_kunjungan_id uuid) RETURNS jsonb` = `{status: 'belum_diisi'|'sudah_diisi'|'kedaluwarsa'|'tidak_ada', token: text|null, kedaluwarsa_pada: timestamptz|null, unit: text|null, layanan_nama: text|null}`; token hanya untuk `belum_diisi`; tanpa hak (`NOT boleh_kunjungan`) → `RAISE EXCEPTION 'FORBIDDEN: ...' USING ERRCODE = '42501'`; EXECUTE `authenticated`.
  - view `public.v_survei_status(kunjungan_id, status, unit, layanan_id, kedaluwarsa_pada, diisi_pada)` tanpa `security_invoker`, `WHERE public.boleh_kunjungan(kunjungan_id)`; `GRANT SELECT TO authenticated` (pola `v_skm_petugas`).

- [ ] **Step 1: Tulis skenario PGlite (gagal dulu)** `skenario-survei-undangan.mjs` memakai harness: (a) mengubah `kunjungan.status` ke `selesai` membuat tepat satu undangan dengan token 64 heksadesimal dan `kedaluwarsa_pada = selesai_at + 32 jam`; (b) `ensure_undangan` dipanggil lagi dan UPDATE status berulang tidak menambah baris maupun menggeser `kedaluwarsa_pada` (Review Focus 1); (c) kunjungan tanpa tiket selesai → `unit = 'fo'`, dengan tiket selesai → `'layanan'` dan `layanan_id` terisi; (d) kunjungan yang belum selesai tidak punya undangan; (e) `anon` dan `authenticated` tidak bisa `SELECT` langsung dari `survei_undangan`; (f) `ambil_qr_survei` oleh FO mengembalikan token untuk `belum_diisi`, tanpa token untuk `kedaluwarsa`/`sudah_diisi` (set `diisi_pada`/majukan waktu lewat `UPDATE` sebagai `postgres`), `FORBIDDEN` untuk petugas layanan lain dan untuk anon; (g) `v_survei_status` menyaring per `boleh_kunjungan`. Jalankan dan pastikan gagal (migrasi belum ada).
- [ ] **Step 2: Tulis test kontrak statis (gagal dulu)** `survei_undangan.test.ts`: berkas terdaftar dan paling akhir; tanpa kontrol transaksi; `mengubahPolicyAtauFungsi` true; pernyataan memuat `CREATE TABLE ... survei_undangan`, `ENABLE ROW LEVEL SECURITY`, tidak ada `CREATE POLICY ... survei_undangan`; semua `SECURITY DEFINER` punya `SET search_path = pg_catalog, public` dan `REVOKE` dari `PUBLIC`; trigger berklausa `WHEN`; `ambil_qr_survei` memakai `boleh_kunjungan` dan `42501`; rollback membatalkan semua objek berurutan terbalik.
- [ ] **Step 3: Tulis migrasi dan rollback** sesuai Interfaces (header lengkap seperti migrasi lain). Rollback: `DROP VIEW`, `DROP FUNCTION ambil_qr_survei`, `DROP TRIGGER`, `DROP FUNCTION ensure_undangan`, `DROP TABLE survei_undangan` (peringatan: menghapus data undangan).
- [ ] **Step 4:** Jalankan skenario PGlite (lolos) dan `npx vitest run --pool=vmForks supabase/migrations/survei_undangan.test.ts supabase/migrations/manifest.test.ts supabase/migrations/migration-files.test.ts` (lolos) setelah menjalankan prosedur migrasi butir 3–4.
- [ ] **Step 5: Commit** `feat(db): survei_undangan, trigger selesai, QR staf, view status (ditulis, belum diterapkan)`.

---

### Task 3: Migrasi jawaban: `skm_respons` diperluas, `spak_respons`, ringkasan

**Files:**
- Create: `supabase/migrations/202611020002_survei_jawaban.sql`, `supabase/migrations/survei_jawaban.test.ts`, `docs/rollback-survei-jawaban-202611020002.sql`, `scripts/lokal/skenario-survei-jawaban.mjs`
- Modify: daftar/manifest/docs seperti prosedur migrasi

**Interfaces:**
- Consumes: `survei_undangan` (Task 2), `skm_respons`, `v_skm_petugas`, `hitung_ikm`, `peran_saya()`, `boleh_layanan(uuid)`.
- Produces (SQL):
  - `skm_respons` + `u10_transparansi smallint check (between 1 and 4)`, `u11_integritas` idem, `versi smallint not null default 1`, `sumber text not null default 'form_lama' check (sumber in ('form_lama','wizard','impor'))`, `unit text not null default 'tidak_diketahui' check (unit in ('layanan','fo','tidak_diketahui'))`, `jenis_kelamin text`, `pendidikan text`; `UPDATE` sekali untuk baris ber-`layanan_id` → `unit = 'layanan'`; constraint `sumber <> 'wizard' OR (kunjungan_id IS NOT NULL AND versi = 2)`; `COMMENT` pada `visit_id` dan `saran` ("tidak dipakai alur baru").
  - `public.spak_respons(id uuid pk, kunjungan_id uuid unique references kunjungan on delete set null, layanan_id uuid references layanan on delete set null, unit text not null check (...3 nilai...), sumber text not null check (sumber in ('wizard','impor')), p1_tanpa_diskriminasi smallint not null check (between 1 and 6), p2_tanpa_kecurangan, p3_tanpa_imbalan, p4_tanpa_pungli, p5_tanpa_percaloan (sama), jenis_kelamin text, pendidikan text, created_at timestamptz not null default now())`; RLS: `GRANT SELECT TO authenticated`, policy `spak_select_staff FOR SELECT TO authenticated USING (public.peran_saya() IN ('admin','front_office'))`; tanpa policy tulis.
  - `v_skm_petugas` diganti: kolom lama + `u10_transparansi`, `u11_integritas`.
  - `hitung_ikm(uuid, date, date)` diganti (signature sama): rata-rata per baris `(u1..u9 + COALESCE(u10,0) + COALESCE(u11,0)) / (9 + (u10 IS NOT NULL)::int + (u11 IS NOT NULL)::int)` × 25, EXECUTE tetap `anon, authenticated`.
  - `public.ringkasan_ikm(p_start date, p_end date) RETURNS TABLE (layanan_id uuid, unit text, nama text, ikm numeric, responden integer)`: satu baris per layanan ber-respons, satu `unit='fo'` (nama "Front Office"), satu `unit='tidak_diketahui'` (nama "Tidak terklasifikasi (data lama/impor)"); hanya bila `peran_saya() IN ('admin','front_office','petugas')` (selain itu kosong); EXECUTE `authenticated`.
  - `public.ringkasan_spak(p_start date, p_end date) RETURNS TABLE (layanan_id uuid, unit text, nama text, responden integer, p1 numeric, p2 numeric, p3 numeric, p4 numeric, p5 numeric)`: hanya `peran_saya() IN ('admin','front_office')`; EXECUTE `authenticated`.
  - `public.ringkasan_response_rate(p_start date, p_end date) RETURNS TABLE (layanan_id uuid, unit text, nama text, diundang integer, mengisi integer)`: dari `survei_undangan` (diundang = `dibuat_pada` dalam periode WIB; mengisi = yang `diisi_pada`-nya terisi), baris per layanan dan satu baris `unit='fo'`; hanya `peran_saya() IN ('admin','front_office')`; EXECUTE `authenticated`.

- [ ] **Step 1: Skenario PGlite (gagal dulu)**: baris lama 9 unsur (u10/u11 NULL) tetap dihitung `hitung_ikm` dengan nilai sama seperti rumus lama; baris wizard 11 unsur dihitung `(Σ11/11)×25`; campuran dalam satu layanan dirata-ratakan per baris; `ringkasan_ikm` memuat baris FO dan "tidak terklasifikasi" terpisah dan tidak mencampur NULL dengan FO (Review Focus 5); `INSERT` `sumber='wizard'` tanpa `kunjungan_id` ditolak; nilai di luar rentang ditolak untuk kolom baru; `spak_respons` tidak bisa dibaca anon dan petugas, bisa dibaca FO dan admin; `ringkasan_spak` dan `ringkasan_response_rate` kosong untuk petugas, dan `ringkasan_response_rate` menghitung `diundang` dan `mengisi` per unit termasuk FO; `v_skm_petugas` tidak memuat `kunjungan_id`.
- [ ] **Step 2: Test kontrak statis**: semua kolom dan CHECK di atas ada; rentang CHECK sama dengan konstanta di `src/lib/survei/pertanyaan.ts` bila berkas itu sudah ada (bila belum, tandai `it.todo` dan lengkapi di Task 6); policy baru `TO authenticated`; fungsi `SECURITY DEFINER` memenuhi aturan global; migrasi tidak berisi `DROP COLUMN`/`DROP TABLE` pada tabel lama; rollback hanya menghapus yang ditambahkan.
- [ ] **Step 3:** Tulis migrasi dan rollback. Rollback menyalin ulang `hitung_ikm` dan `v_skm_petugas` versi lama persis (`202607140004`, `202610090001`).
- [ ] **Step 4:** Jalankan skenario dan test kontrak sampai lolos.
- [ ] **Step 5: Commit** `feat(db): jawaban survei 11 unsur, spak_respons, ringkasan IKM/SPAK (ditulis, belum diterapkan)`.

---

### Task 4: Migrasi RPC publik: `get_survei_context` dan `kirim_survei`

**Files:**
- Create: `supabase/migrations/202611020003_survei_rpc.sql`, `supabase/migrations/survei_rpc.test.ts`, `docs/rollback-survei-rpc-202611020003.sql`, `scripts/lokal/skenario-survei-rpc.mjs`
- Modify: daftar/manifest/docs seperti prosedur migrasi

**Interfaces:**
- Consumes: `survei_undangan`, `skm_respons`, `spak_respons` (Task 2–3).
- Produces (SQL), EXECUTE `anon, authenticated`:
  - `public.get_survei_context(p_token text) RETURNS jsonb` = `{status: 'ok'|'kedaluwarsa'|'sudah_diisi'|'tidak_valid', unit: 'layanan'|'fo'|null, layanan_nama: text|null, kedaluwarsa_pada: timestamptz|null}`. Urutan: tidak ada → `tidak_valid`; `diisi_pada` terisi → `sudah_diisi`; `now() > kedaluwarsa_pada` → `kedaluwarsa`; selain itu `ok`.
  - `public.kirim_survei(p_token text, p_spak jsonb, p_skm jsonb) RETURNS text` ∈ `submitted|invalid|expired|duplicate|not_found`. Urutan: validasi payload (keduanya objek JSON; kunci persis `p1..p5` dan `u1..u11`; tiap nilai `jsonb_typeof = 'number'`, bilangan bulat, SPAK 1–6, SKM 1–4; panjang token ≥ 16) → `invalid`; `SELECT ... FROM survei_undangan WHERE token = p_token FOR UPDATE` → `not_found`; `diisi_pada` terisi → `duplicate`; `now() > kedaluwarsa_pada` → `expired`; `kunjungan.status <> 'selesai'` → `invalid`; sisipkan `spak_respons` dan `skm_respons` (`sumber='wizard'`, `versi=2`, `unit`/`layanan_id` dari undangan, `kunjungan_id`), set `diisi_pada = now()`; `unique_violation` → `duplicate`. Jam selalu `now()` database.

- [ ] **Step 1: Skenario PGlite (gagal dulu)**: kiriman sah → `submitted`, tepat satu baris di tiap tabel, `diisi_pada` terisi, `get_survei_context` jadi `sudah_diisi`; kiriman kedua → `duplicate` dan jumlah baris tetap; set `kedaluwarsa_pada` tepat `now()` lalu `now() - 1 detik` → `expired` (Review Focus 2); `get_survei_context` melaporkan `kedaluwarsa`; token acak → `not_found`/`tidak_valid`; matriks payload nakal (kunci asing, kunci kurang, 0, 7, 3.5, `"3"`, `null`, array, SPAK diisi skala 7, SKM skala 5) → `invalid` dengan 0 baris tertulis di kedua tabel (Review Focus 4); dua kiriman berurutan dari dua sesi PGlite pada undangan sama → tepat satu `submitted` (Review Focus 3); anon dapat memanggil kedua RPC tetapi tidak bisa `SELECT` tabel.
- [ ] **Step 2: Test kontrak statis**: signature dan hak EXECUTE (`anon, authenticated`, tidak untuk `PUBLIC`), `search_path`, `FOR UPDATE` pada undangan, urutan hasil di atas (memakai teks fungsi), tidak ada `RAISE EXCEPTION` di jalur validasi (hasil harus berupa teks), rollback.
- [ ] **Step 3:** Tulis migrasi dan rollback. Step 4: skenario dan test kontrak lolos. 
- [ ] **Step 5: Commit** `feat(db): RPC get_survei_context dan kirim_survei atomik (ditulis, belum diterapkan)`.

---

### Task 5: Migrasi notifikasi: tautan survei memakai undangan

**Files:**
- Create: `supabase/migrations/202611020004_survei_notifikasi.sql`, `supabase/migrations/survei_notifikasi.test.ts`, `docs/rollback-survei-notifikasi-202611020004.sql`
- Modify: daftar/manifest/docs seperti prosedur migrasi

**Interfaces:**
- Consumes: `ensure_undangan(uuid) → uuid` dan `survei_undangan.token` (Task 2); fungsi lama `public.notify_kunjungan_status()` (`202610140007_wp24_akhiri_dual_write.sql:1310-1376`).
- Produces: `notify_kunjungan_status()` diganti dengan `CREATE OR REPLACE` penuh. **Hanya** cabang `status = 'selesai'` berubah: memanggil `ensure_undangan(NEW.id)`, membaca token undangan, dan memakai `<public_url>/survei/<token>` (bukan `/skm?token=<qr_token>`) di isi email, isi push, dan `payload.url`. Semua cabang lain, signature, atribut, hak, dan nama trigger identik.

- [ ] **Step 1: Test kontrak (gagal dulu)**: berkas membuka dengan penjaga `PRASYARAT` (`to_regprocedure` untuk `notify_kunjungan_status()`, `ensure_undangan(uuid)`); teks fungsi baru tidak mengandung `'/skm?token='`, mengandung `'/survei/'`; semua potongan di luar cabang `selesai` sama persis dengan versi 0007 (bandingkan setelah menormalkan spasi, dengan cara memotong teks cabang `selesai` dari kedua versi); trigger `trg_notify_kunjungan_status` tidak dibuat ulang; rollback memulihkan fungsi 0007 persis.
- [ ] **Step 2:** Tulis migrasi (salin fungsi 0007 lalu ubah hanya cabang `selesai`) dan rollback (salinan 0007 persis). Karena fungsi ini tidak bisa dijalankan di stub PGlite, verifikasi perilaku cukup lewat test statis dan dry-run oleh pemilik; catat itu di entri `DB-CHANGES.md`.
- [ ] **Step 3:** Jalankan test kontrak, manifest, dan inventori sampai lolos. **Step 4: Commit** `feat(db): email/push survei memakai tautan undangan (ditulis, belum diterapkan)`.

---

### Task 6: Konfigurasi pertanyaan dan uji golden

**Files:**
- Create: `src/lib/survei/pertanyaan.ts`, `src/lib/survei/pertanyaan.test.ts`

**Interfaces:**
- Produces:
  - `type KunciSpak = 'p1'|'p2'|'p3'|'p4'|'p5'`; `type KunciSkm = 'u1'|'u2'|…|'u11'`; `type Jawaban = Partial<Record<KunciSpak | KunciSkm, number>>`.
  - `SKALA_SPAK: readonly {nilai: 1|2|3|4|5|6; label: string}[]` (label Lampiran A); `SKALA_SKM: readonly {nilai: 4|3|2|1; label: string}[]` (urutan tampil: Sangat Baik, Baik, Cukup, Kurang).
  - `PERTANYAAN_SPAK: readonly {kunci: KunciSpak; teks: string}[]`, `UNSUR_SKM: readonly {kunci: KunciSkm; teks: string}[]` (teks Lampiran A).
  - `SURVEI: { spak: {judul: string; instruksi: string; bagian: string}; skm: {judul: string} }` memuat "Survey Persepsi Anti Korupsi", instruksi, dan judul bagian "A. PERTANYAAN TERKAIT SURVEY PERSEPSI KUALITAS PELAYANAN" (dibiarkan), "Survey Kepuasan Masyarakat".
  - `LANGKAH: readonly {survei: 'spak'|'skm'; kunci: readonly (KunciSpak|KunciSkm)[]}[]` = SPAK `[p1,p2,p3]`, `[p4,p5]`; SKM `[u1..u4]`, `[u5..u8]`, `[u9,u10,u11]`.
  - `RENTANG = { spak: {min: 1, max: 6}, skm: {min: 1, max: 4} }`.

- [ ] **Step 1: Tulis test golden (gagal dulu)**: `PERTANYAAN_SPAK.map(p => p.teks)` sama persis dengan lima kalimat Lampiran A (termasuk "pungutan liar" dan "percaloan"); `UNSUR_SKM` sama persis 11 nama; label kedua skala persis; `LANGKAH.length === 5`, setiap kunci muncul tepat sekali, urutan sesuai; tidak ada kunci di luar tipe.
- [ ] **Step 2:** Implementasikan konstanta (nilai persis Lampiran A spec; kapitalisasi awal kalimat seperti di sana).
- [ ] **Step 3:** Aktifkan `it.todo` Task 3: test kontrak migrasi memeriksa rentang CHECK `u10`/`u11` = `RENTANG.skm`, `p1..p5` = `RENTANG.spak`. Jalankan `npx vitest run --pool=vmForks src/lib/survei supabase/migrations/survei_jawaban.test.ts` (lolos).
- [ ] **Step 4: Commit** `feat(survei): konfigurasi pertanyaan SPAK dan SKM dengan uji golden`.

---

### Task 7: Logika wizard dan draf sesi (fungsi murni)

**Files:**
- Create: `src/lib/survei/wizard.ts`, `src/lib/survei/wizard.test.ts`, `src/lib/survei/penyimpanan.ts`, `src/lib/survei/penyimpanan.test.ts`

**Interfaces:**
- Consumes: `LANGKAH`, `Jawaban`, `KunciSpak`, `KunciSkm`, `RENTANG` (Task 6).
- Produces:
  - `interface StateWizard { indeks: number; jawaban: Jawaban }`; `buatState(jawaban?: Jawaban, indeks?: number): StateWizard`.
  - `type AksiSetelahJawab = { aksi: 'tetap' } | { aksi: 'gulir'; kunci: KunciSpak | KunciSkm } | { aksi: 'lanjut' } | { aksi: 'kirim' }`.
  - `jawab(state, kunci, nilai, opsi: { otomatis: boolean }): { state: StateWizard; hasil: AksiSetelahJawab }`: menolak nilai di luar rentang (state tak berubah, `tetap`); bila `otomatis` false → selalu `tetap`; bila langkah lengkap setelah jawaban → `kirim` bila langkah terakhir, selain itu `lanjut` (state **belum** maju: pemanggil memanggil `maju`); bila belum lengkap → `gulir` ke kunci belum terjawab pertama setelah kunci ini (atau yang pertama belum terjawab).
  - `langkahLengkap(state): boolean`, `semuaLengkap(state): boolean`, `maju(state): StateWizard` (tidak melewati langkah terakhir; tidak maju bila langkah tidak lengkap), `mundur(state): StateWizard`.
  - `bangunPayload(jawaban): { spak: Record<KunciSpak, number>; skm: Record<KunciSkm, number> } | null` (null bila ada yang kosong).
  - `simpanDraf(token: string, state: StateWizard): void`, `muatDraf(token: string): StateWizard | null`, `hapusDraf(token: string): void`: `sessionStorage` kunci `lmh:survei:<16 karakter pertama token>`; semua akses dibungkus try/catch; `muatDraf` memvalidasi bentuk dan rentang, mengembalikan `null` bila rusak.

- [ ] **Step 1: Tulis test (gagal dulu)** `wizard.test.ts`: menjawab soal terakhir yang belum terjawab di langkah 1 dengan `otomatis:true` → `lanjut`; menjawab soal pertama langkah SKM 1 → `gulir` ke `u2`; menjawab dengan `otomatis:false` → `tetap` walau lengkap; langkah terakhir lengkap `otomatis:true` → `kirim`; mengetuk jawaban yang sama pada langkah yang sudah lengkap tetap `lanjut` (Back ke langkah terjawab tidak memicu apa pun sebelum ada ketukan); nilai 0/7/3.5 pada SPAK dan 5 pada SKM ditolak; `maju` tidak melewati langkah belum lengkap; `bangunPayload` null bila satu kosong dan memetakan 5+11 kunci bila lengkap. `penyimpanan.test.ts` (jsdom): simpan lalu muat identik; JSON rusak atau nilai di luar rentang → `null`; `sessionStorage` melempar → tidak melempar ke pemanggil; `hapusDraf` menghapus.
- [ ] **Step 2:** Implementasikan sesuai Interfaces. Step 3: jalankan `npx vitest run --pool=vmForks src/lib/survei` (lolos). **Step 4: Commit** `feat(survei): logika wizard dan draf sesi sebagai fungsi murni`.

---

### Task 8: Skema zod dan route `POST /api/survei/kirim`

**Files:**
- Create: `src/lib/survei/schemas.ts`, `src/app/api/survei/kirim/route.ts`, `src/app/api/survei/kirim/kirim.test.ts`

**Interfaces:**
- Consumes: `RENTANG`, `KunciSpak`, `KunciSkm` (Task 6); `createClient` dari `@/lib/supabase/server`; `mutasiInsert` dari `@/lib/supabase/mutate`; `catatMutasi` dari `@/lib/observability/catat-mutasi`; RPC `kirim_survei` (Task 4).
- Produces: `kirimSurveiSchema` (zod, `.strict()`: `{ token: string 32–128, spak: object strict p1..p5 int 1–6, skm: object strict u1..u11 int 1–4 }` dibangun dari konstanta, bukan ditulis ulang); `POST /api/survei/kirim` → 201 `{ ok: true }` untuk `submitted`, 400 `invalid`, 404 `not_found`, 409 `duplicate`, 410 `expired`, 400 untuk body/zod gagal, 500 lainnya (pola `/api/skm/submit`).

- [ ] **Step 1: Tulis test (gagal dulu)** meniru `src/app/api/skm/submit/submit.test.ts`: payload sah memanggil `supabase.rpc('kirim_survei', { p_token, p_spak, p_skm })` sekali dan membalas 201; setiap status RPC dipetakan ke kode di atas; matriks payload nakal (kunci asing, kunci kurang, 0, 7, 3.5, `"3"`, null, bukan objek, JSON rusak) → 400 dan **RPC tidak dipanggil** (Review Focus 4); galat RPC → 500 dan `catatMutasi` terpanggil; isi respons tidak memuat teks galat mentah database.
- [ ] **Step 2:** Implementasikan skema dan route. Step 3: `npx vitest run --pool=vmForks src/app/api/survei` (lolos). **Step 4: Commit** `feat(survei): route kirim survei dengan validasi zod`.

---

### Task 9: Wizard publik `/survei/<token>`

**Files:**
- Create: `src/app/survei/[token]/page.tsx`, `src/components/survei/SurveiWizard.tsx`, `src/components/survei/SkalaSpak.tsx`, `src/components/survei/SegmenSkm.tsx`, `src/components/survei/PesanStatusSurvei.tsx`, `src/components/survei/AkhirSurvei.tsx`, `src/components/survei/survei.module.css`, `src/lib/survei/konteks.ts`, tes: `SurveiWizard.test.tsx`, `PesanStatusSurvei.test.tsx`, `src/lib/survei/konteks.test.ts`
- Modify: `next.config.ts` hanya bila CSP memblok sesuatu yang dipakai (tidak diperkirakan)

**Interfaces:**
- Consumes: Task 6 (konstanta), Task 7 (`jawab`, `maju`, `mundur`, `langkahLengkap`, `bangunPayload`, `simpanDraf`, `muatDraf`, `hapusDraf`), Task 8 (`POST /api/survei/kirim`), RPC `get_survei_context`, komponen `ErrorRetry` (`src/components/ErrorRetry.tsx`).
- Produces: `type KonteksSurvei = { status: 'ok'|'kedaluwarsa'|'sudah_diisi'|'tidak_valid'; unit: 'layanan'|'fo'|null; layananNama: string|null; kedaluwarsaPada: string|null }`; `ambilKonteks(supabase, token): Promise<KonteksSurvei>` (galat jaringan melempar); `<SurveiWizard token konteks onSelesai />`; `<PesanStatusSurvei status />` dengan `status: 'kedaluwarsa'|'sudah_diisi'|'tidak_valid'` (pesan ramah tanpa kata "token"); `<AkhirSurvei />` ("Terima kasih, jawaban Anda sudah terkirim." dan satu tombol "Selesai" yang menutup halaman/kembali ke `/`; tombol saran dan pengaduan ditambahkan Fase B).

- [ ] **Step 1: Baca** `node_modules/next/dist/docs/` bagian dynamic routes dan `useParams` di Client Component (Next 16) sebelum menulis `page.tsx`; halaman berupa Client Component yang memuat konteks, menampilkan `PesanStatusSurvei` untuk status selain `ok`, dan `SurveiWizard` untuk `ok`.
- [ ] **Step 2: Tulis test (gagal dulu)** `SurveiWizard.test.tsx` (jsdom, mock `fetch` dan `sessionStorage`): (a) mengetuk jawaban terakhir langkah 1 pindah ke langkah 2 **seketika** (tanpa `waitFor` timer, tanpa fake timer); (b) mengetuk soal pertama langkah SKM 1 memanggil `scrollIntoView` pada soal berikutnya yang belum terjawab; (c) pilihan lewat keyboard (`keyboard('{Enter}')`/`event.detail === 0`) tidak auto-lanjut dan Next aktif; (d) Back kembali tanpa memicu auto-lanjut dan jawaban tetap; (e) Next nonaktif saat langkah belum lengkap; (f) menjawab semua lalu ketukan terakhir SKM mengirim satu `POST /api/survei/kirim` dengan payload `{token, spak:{p1..p5}, skm:{u1..u11}}` dan menampilkan `AkhirSurvei`; ketukan ganda cepat pada jawaban terakhir hanya satu kali `POST` (Review Focus 3); (g) gagal jaringan menampilkan `ErrorRetry` dengan jawaban tetap, coba lagi mengirim ulang; respons 409 menampilkan status `sudah_diisi`, 410 `kedaluwarsa`; (h) muat ulang memulihkan draf dari `sessionStorage` dan `hapusDraf` dipanggil setelah terkirim; (i) judul "Survei 1 dari 2" lalu "Survei 2 dari 2"; fokus pindah ke judul langkah dan region `aria-live` mengumumkan "Langkah n dari 5". `PesanStatusSurvei.test.tsx`: tiga status memuat pesan ramah dan tidak memuat kata "token". `konteks.test.ts`: memetakan hasil RPC dan melempar saat galat.
- [ ] **Step 3:** Implementasikan komponen dan CSS Modules mobile-first (kolom maks. 480 px, target ≥ 48 px, nyaman di 320 px, `prefers-reduced-motion` mematikan animasi). `SkalaSpak`: baris 6 kotak angka dengan legenda skala dan label jawaban terpilih; `SegmenSkm`: satu baris 4 segmen berlabel; keduanya `radiogroup` berlabel. Auto-lanjut hanya bila `event.detail > 0` (pointer). Pengumuman di awal bahwa halaman akan otomatis lanjut. Tampilkan intro singkat tanpa tombol tambahan.
- [ ] **Step 4:** `npx vitest run --pool=vmForks src/components/survei src/lib/survei` (lolos), lalu `npm run dev` dan periksa halaman di lebar 375 px dengan token uji hanya bila tersedia DB lokal; bila tidak, catat bahwa pemeriksaan visual ditunda ke pemilik.
- [ ] **Step 5: Commit** `feat(survei): wizard publik SPAK dan SKM 5 langkah`.

---

### Task 10: Staf: QR, lencana status, integrasi layar

**Files:**
- Create: `src/lib/survei/staf.ts`, `src/lib/survei/staf.test.ts`, `src/components/admin/SurveiQrDialog.tsx`, `src/components/admin/SurveiQrDialog.test.tsx`, `src/components/admin/SurveiStatusBadge.tsx`
- Modify: `src/app/admin/fo/penanganan/page.tsx` (fungsi `berhasilSelesai`), `src/app/admin/antrian/page.tsx` (tiga jalur selesai), `src/app/admin/kunjungan/page.tsx` (kolom Survei), `src/app/admin/antrian/antrian.test.tsx`, `src/app/admin/kunjungan/kunjungan.test.tsx`

**Interfaces:**
- Consumes: RPC `ambil_qr_survei`, view `v_survei_status` (Task 2), `QRCodeDisplay` (`src/components/QRCode.tsx`, props `value`, `size`), `HasilSelesaiFo.kunjungan_id`.
- Produces: `type StatusSurvei = 'belum_diisi'|'sudah_diisi'|'kedaluwarsa'|'tidak_ada'`; `LABEL_STATUS_SURVEI: Record<StatusSurvei, string>` ("Belum diisi", "Sudah diisi", "Kedaluwarsa", "—"); `urlSurvei(origin: string, token: string): string` = `${origin}/survei/${token}`; `ambilQrSurvei(supabase, kunjunganId): Promise<{ status: StatusSurvei; token: string|null; kedaluwarsaPada: string|null; layananNama: string|null }>`; `ambilStatusSurvei(supabase, kunjunganIds: string[]): Promise<Map<string, StatusSurvei>>` (membaca `v_survei_status`, memecah `in()` per 200 id); `<SurveiQrDialog kunjunganId onTutup />` (memanggil `ambilQrSurvei` saat dibuka; **menutup diri tanpa menampilkan apa pun** bila tidak ada token, mis. kunjungan masih berjalan; menampilkan QR, nama layanan, "berlaku sampai <waktu WIB>"; origin dari `NEXT_PUBLIC_PUBLIC_URL` bila ada di env klien, selain itu `window.location.origin`; teks tautan tidak ditampilkan); `<SurveiStatusBadge status />`.

- [ ] **Step 1: Tulis test (gagal dulu)**: `staf.test.ts`: `urlSurvei`, pemetaan jawaban RPC, `ambilStatusSurvei` memecah 450 id menjadi 3 panggilan dan memetakan id tanpa baris ke `tidak_ada`. `SurveiQrDialog.test.tsx`: token ada → QR dirender dengan nilai `.../survei/<token>` dan tidak ada elemen teks yang memuat token; status `sudah_diisi` atau tanpa token → `onTutup` dipanggil dan tidak ada QR; galat RPC → pesan galat singkat dengan tombol tutup. Test halaman: setelah `berhasilSelesai` FO dan setelah tiga jalur selesai di antrean (RPC langsung, `PelayananWizardModal`, `SelesaiEskalasiModal`) dialog dibuka untuk `kunjungan_id` yang benar; baris antrean selesai dan baris kunjungan menampilkan lencana status; tombol "Tampilkan QR" hanya untuk `belum_diisi`.
- [ ] **Step 2:** Implementasikan. Integrasi: simpan `qrKunjunganId` pada state halaman dan render `<SurveiQrDialog>` bila terisi; di antrean, `kunjungan_id` sudah ada pada baris tiket; di halaman kunjungan dan antrean, ambil status untuk id yang tampil lewat `ambilStatusSurvei` sekali per muat data.
- [ ] **Step 3:** `npx vitest run --pool=vmForks src/lib/survei src/components/admin src/app/admin` (lolos). **Step 4: Commit** `feat(survei): QR staf, lencana status, integrasi antrean FO dan layanan`.

---

### Task 11: Unduhan XLSX

**Files:**
- Create: `src/lib/survei/export.ts`, `src/lib/survei/export.test.ts`, `src/app/api/admin/survei/export/route.ts`, `src/app/api/admin/survei/export/export.test.ts`

**Interfaces:**
- Consumes: `muatStafRekap`, `paramsDariRequest` (`src/lib/rekap/akses.ts`), `fetchAllPages` (`src/lib/rekap/exportAll.ts`), `awalHariWIB`, `awalHariBerikutnyaWIB`, `formatTanggalId` (`src/lib/rekap/format.ts`), `getServiceClient` (`src/lib/akun/server.ts`) untuk `audit_log`, `PERTANYAAN_SPAK`, `UNSUR_SKM`, `SKALA_*` (Task 6), RPC `ringkasan_ikm`, `ringkasan_spak`, `ringkasan_response_rate` (Task 3).
- Produces: `buildSurveiWorkbook(data: { dari: string; sampai: string; spak: BarisSpak[]; skm: BarisSkm[]; ringkasanIkm: RingkasanIkmRow[]; ringkasanSpak: RingkasanSpakRow[]; ringkasanRate: RingkasanRateRow[] }): Promise<Buffer>` dengan sheet `SPAK`, `SKM`, `Ringkasan` (IKM, rata-rata SPAK, dan response rate: diundang, mengisi, persen), `Legenda`; kolom identitas hanya `Tanggal Kunjungan`, `Unit`, `Kategori`, `Kode Kunjungan` (8 karakter pertama id, huruf besar; "—" untuk impor); header SPAK memuat kalimat pernyataan lengkap; sel teks diamankan dari injeksi rumus (`src/lib/csv.ts`). `GET /api/admin/survei/export?dari=YYYY-MM-DD&sampai=YYYY-MM-DD` → 401 belum masuk, 403 selain Admin/FO, 400 parameter tidak valid, 200 berkas `survei-<dari>-sd-<sampai>.xlsx` dengan `Content-Disposition: attachment`, `Cache-Control: no-store`, dan baris `audit_log` (`aksi: 'export_xlsx'`, `entitas: 'survei'`).

- [ ] **Step 1: Tulis test (gagal dulu)**: workbook memuat empat sheet dengan header sesuai; **tidak ada** kolom nama/HP/email; sel berawalan `=`/`+`/`-`/`@` diawali apostrof; 2.500 baris diambil lengkap lewat paginasi (mock halaman 1000/1000/500) dan tidak terpotong; filter tanggal memakai batas hari WIB; route: 401, 403 untuk petugas, 400 untuk `dari > sampai` atau format salah, 200 untuk Admin dan FO, `audit_log` ditulis.
- [ ] **Step 2:** Implementasikan. Data jawaban dibaca lewat klien pengguna (RLS Admin/FO) dengan `select('*, kunjungan:kunjungan_id(tanggal, kategori), layanan:layanan_id(nama)')`; tanggal untuk baris impor dari `created_at`.
- [ ] **Step 3:** `npx vitest run --pool=vmForks src/lib/survei src/app/api/admin/survei` (lolos). **Step 4: Commit** `feat(survei): unduhan XLSX survei untuk Admin dan FO`.

---

### Task 12: `/admin/skm`: ringkasan baru, tab SPAK, tombol unduh

**Files:**
- Modify: `src/app/admin/skm/page.tsx`, `src/app/admin/skm/skm.test.tsx`, `src/lib/ikm.ts` (hanya bila `IkmRow` perlu penanda unit), `src/components/IkmPanel.tsx` (hanya bila perlu)
- Create: `src/components/admin/SpakPanel.tsx`, `src/components/admin/SpakPanel.test.tsx`

**Interfaces:**
- Consumes: RPC `ringkasan_ikm`, `ringkasan_spak` (Task 3), rute unduh (Task 11), `PERTANYAAN_SPAK`, `IkmRow` (`layanan_id: string`, `layanan_nama`, `ikm`, `responden`).
- Produces: halaman memuat IKM lewat satu panggilan `ringkasan_ikm` (menggantikan loop `hitung_ikm` per layanan; baris FO dan tidak terklasifikasi memakai kunci `fo`/`tidak_diketahui` pada `layanan_id` dan ditampilkan paling bawah); tab "IKM" dan "SPAK" (tab SPAK dan tombol "Unduh" hanya untuk Admin dan FO; petugas tetap hanya IKM layanannya, dan `RoleNote` tetap tampil); `<SpakPanel rows />` menampilkan rata-rata per pernyataan per unit dengan teks pernyataan lengkap.

- [ ] **Step 1: Tulis test (gagal dulu)**: halaman memanggil `ringkasan_ikm` sekali (bukan N kali `hitung_ikm`) dan menampilkan baris "Front Office" dan "Tidak terklasifikasi (data lama/impor)"; peran FO/Admin melihat tab SPAK dan tombol Unduh dengan `href` ke `/api/admin/survei/export?dari=..&sampai=..` sesuai periode; peran petugas tidak melihat tab SPAK maupun Unduh; `SpakPanel` menampilkan lima pernyataan dan rata-rata dengan satu desimal, "—" bila tidak ada responden.
- [ ] **Step 2:** Implementasikan; pertahankan perilaku periode (bulan/kuartal/tahun) dan galat yang ada. Step 3: `npx vitest run --pool=vmForks src/app/admin/skm src/components/admin/SpakPanel.test.tsx src/components/IkmPanel*` (lolos). **Step 4: Commit** `feat(survei): dashboard SKM memakai ringkasan IKM, tab SPAK, unduhan`.

---

### Task 13: Dokumentasi dan gate akhir

**Files:**
- Modify: `CLAUDE.md` (peta halaman, API, tabel, RPC baru; baris `/skm` menyebut tautan lama), `docs/analysis/04-RBAC-MATRIX.md` (baris `/survei/<token>` anonim ✓, tab SPAK admin/FO), `docs/STATUS.md`

- [ ] **Step 1:** Perbarui dokumen di atas secara ringkas (rute `/survei/[token]`, `api/survei/kirim`, `api/admin/survei/export`, tabel `survei_undangan`, `spak_respons`, RPC baru, catatan "ditulis, belum diterapkan").
- [ ] **Step 2:** Jalankan `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; semua harus lolos. `npm run audit:check` boleh gagal hanya karena advisory dependensi yang sudah ada; laporkan.
- [ ] **Step 3:** Baca diff penuh dan pindai rahasia; pastikan `git status` tidak memuat `.env*`, `package.json`/lockfile tak berubah, dan tidak ada berkas di luar daftar task.
- [ ] **Step 4: Commit** `docs(survei): peta kode, matriks akses, dan status Fase A`. Laporkan ke pemilik: daftar migrasi yang harus diterapkan berurutan (`--atomic --dry-run` dulu), dan bahwa tidak ada yang diterapkan.
