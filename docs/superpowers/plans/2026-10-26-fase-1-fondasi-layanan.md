# Fase 1 — Fondasi Layanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin bisa membuat, mengubah, dan mengarsipkan Layanan beserta Instansi, deskripsi, dan website terkaitnya tanpa deploy, dan satu jadwal per Layanan (+ hari libur nasional) benar-benar mengendalikan antrean, reservasi, dan status buka/tutup.

**Architecture:** Dua migrasi forward aditif (model konten + jadwal tunggal) mengubah fungsi keputusan yang sudah dipakai semua gerbang (`is_layanan_buka_jadwal`) alih-alih menambah jalur baru; route handler admin (zod + sesi Admin, RLS `layanan_admin_all`, trigger audit) dan halaman Kelola Layanan / Jadwal diperluas; bot menerima profil Layanan sebagai konteks.

**Tech Stack:** Next.js 16 App Router (baca `node_modules/next/dist/docs/` sebelum menulis route/page), React 19, Supabase Postgres + RLS, zod, Vitest (`--pool=vmForks`), CSS Modules.

**Spec:** [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](../specs/2026-10-26-layanan-dinamis-design.md) §2 dan §4. ADR: [`docs/adr/0001-instansi-terpisah-dari-layanan.md`](../../adr/0001-instansi-terpisah-dari-layanan.md).

## Global Constraints

- **B1 — data lama tidak diubah/dihapus.** Migrasi tidak boleh berisi `DELETE`, `TRUNCATE`, `DROP TABLE`, `DROP COLUMN`, atau `UPDATE` atas kolom yang sudah ada. Satu-satunya `UPDATE` yang boleh: mengisi kolom baru `layanan.slug`. `DROP TRIGGER`/`DROP POLICY`/`CREATE OR REPLACE` fungsi & view boleh (perilaku, bukan data). Tabel lama `layanan_jadwal`, `layanan_libur`, `jadwal_harian_beku`, `layanan_hari` dibiarkan.
- **B2 — migrasi:** file baru bertimestamp lebih besar dari semua file yang ada **di saat implementasi** (branch `claude/busy-poitras-cb912c` sudah memakai `202610260001`; rencana ini memakai `202610270001` dan `202610270002`, naikkan bila sudah terpakai). Setiap file: test kontrak statis di sebelahnya, entri sha256 di `supabase/migrations/MANIFEST.json`, entri di `FORWARD_MIGRATION_FILES` (`supabase/migrations/migration-test-utils.ts`). Fungsi yang diganti: `CREATE OR REPLACE` dengan **seluruh** isi versi terakhir disalin, hanya baris yang disebut yang berubah.
- **Dilarang:** menerapkan migrasi, `npm run test:rls`, `node scripts/apply-migration.mjs`, query ke DB produksi, memakai kunci di `.env.local`. Pemilik yang menerapkan.
- Policy tulis admin **wajib** `TO authenticated` (pelajaran bug `standar_pelayanan`: policy `FOR ALL` tanpa `TO` yang memanggil `get_my_role()` membuat SELECT anonim gagal).
- Hanya role `admin` yang menulis Instansi/Layanan/tautan/jadwal/hari libur (Q9). FO tetap hanya bisa melihat daftar layanan (perilaku GET sekarang).
- Teks UI bahasa Indonesia; muat `design:ux-copy` untuk teks baru dan `design:accessibility-review` untuk form baru. CSS Modules, tanpa Tailwind.
- Batas hari & jam memakai WIB (`src/lib/time.ts`, `Asia/Jakarta` di SQL).
- URL website terkait dan sumber konten: hanya `https://`, maks 500 karakter. Label tautan 1–80 karakter. Deskripsi maks 4000 karakter. Nama Instansi 2–150, singkatan maks 30.
- Jadwal default Layanan baru: Senin–Jumat (`hari` 1–5), 08:00–15:30, aktif. Jam tutup per Layanan tidak boleh melewati `jam_tutup_layanan()` global (16:00) — divalidasi di UI dan DB.
- Gate sebelum selesai: `npm run verify:baseline`.

## Review Focus

1. **Layanan arsip masih menerima tiket lewat jalur lain** — mis. reservasi lama yang di-check-in hari ini untuk layanan yang kemudian diarsipkan. Diharapkan: eskalasi/alih ditolak dengan `LAYANAN_TIDAK_BUKA`. Pin: test kontrak Task 2 (`is_layanan_buka_jadwal` memeriksa `aktif`).
2. **Hari libur nasional pada hari kerja** — reservasi loket, eskalasi FO, dan badge homepage harus menyatakan tutup. Pin: test kontrak Task 2 + test UI Task 6.
3. **Hapus permanen layanan yang pernah dipakai, termasuk hanya lewat `kunjungan.layanan_saran_id`** — FK itu `ON DELETE SET NULL` sehingga penghapusan akan diam-diam mengubah baris kunjungan lama (melanggar B1). Diharapkan 409. Pin: test route Task 3.
4. **Slug bentrok / nama berhuruf non-ASCII** (mis. "Sertifikasi Mutu Keamanan Hasil Perikanan", dua nama yang menghasilkan slug sama). Diharapkan slug unik valid `^[a-z0-9]+(-[a-z0-9]+)*$`. Pin: test kontrak Task 1 + 409 `SLUG_BENTROK` di Task 3.
5. **Nama mengandung "OSS" tetapi admin memilih "tanpa formulir"** — dulu trigger menebak dari nama. Diharapkan `form_pendataan` tetap NULL. Pin: test kontrak Task 1 (trigger tebakan dicabut) + test route Task 3.

---

### Task 1: Migrasi model konten — Instansi, atribut Layanan, website terkait

**Files:**
- Create: `supabase/migrations/202610270001_instansi_layanan_konten.sql`
- Create: `supabase/migrations/instansi_layanan_konten.test.ts`
- Modify: `supabase/migrations/MANIFEST.json`, `supabase/migrations/migration-test-utils.ts` (`FORWARD_MIGRATION_FILES`)

**Interfaces:**
- Produces (DB):
  - Tabel `public.instansi(id uuid pk default gen_random_uuid(), nama text NOT NULL UNIQUE CHECK char_length 2–150, singkatan text NULL CHECK char_length ≤ 30, created_at, updated_at)`.
  - Kolom baru `public.layanan`: `instansi_id uuid NULL REFERENCES instansi(id) ON DELETE RESTRICT`, `slug text NOT NULL` (UNIQUE, CHECK `^[a-z0-9]+(-[a-z0-9]+)*$`), `deskripsi text NULL` (≤ 4000), `urutan integer NOT NULL DEFAULT 100`, `konten_sumber_url text NULL` (CHECK `^https://\S+$`, ≤ 500), `konten_diperbarui_at timestamptz NULL`, `diarsipkan_at timestamptz NULL`.
  - Fungsi `public.slug_dari_nama(p_nama text) RETURNS text IMMUTABLE` (lowercase, `unaccent` bila extension tersedia — cek `202607140001`; kalau tidak, buang karakter non `[a-z0-9]`), spasi/simbol → `-`, rapikan `-` ganda/tepi, fallback `'layanan'` bila kosong.
  - Trigger `trg_layanan_isi_slug` BEFORE INSERT: bila `slug` NULL, isi `slug_dari_nama(nama)` + akhiran `-2`, `-3`, … sampai unik.
  - Tabel `public.layanan_tautan(id uuid pk, layanan_id uuid NOT NULL REFERENCES layanan(id) ON DELETE CASCADE, label text NOT NULL CHECK 1–80, url text NOT NULL CHECK `^https://\S+$` dan ≤ 500, urut integer NOT NULL DEFAULT 0, created_at)`; index `(layanan_id, urut)`.
  - View `public.v_layanan_publik` (CREATE OR REPLACE, `security_invoker = true`, WHERE tidak berubah) — kolom lama tetap di urutan semula, **ditambahkan di akhir**: `slug`, `deskripsi`, `urutan`, `instansi_nama`, `instansi_singkatan`, `website_terkait jsonb` (array `{label,url}` urut `urut, created_at`, `'[]'` bila kosong).

- [ ] **Step 1: Tulis test kontrak yang gagal** di `instansi_layanan_konten.test.ts` (pola `non_oss_rename.test.ts`: baca file, buang komentar `--`), dengan `it(...)`:
  - `membuat tabel instansi dan layanan_tautan dengan CHECK panjang & https` — regex untuk `CREATE TABLE IF NOT EXISTS public.instansi`, `CREATE TABLE IF NOT EXISTS public.layanan_tautan`, `ON DELETE CASCADE`, `'\^https://` di kedua CHECK URL.
  - `menambah kolom layanan secara aditif` — tujuh `ADD COLUMN IF NOT EXISTS` di atas.
  - `mengisi slug hanya untuk baris yang slug-nya NULL lalu menjadikannya NOT NULL dan UNIQUE` — `UPDATE public.layanan` hanya muncul sekali dan hanya `SET slug`; ada `ALTER COLUMN slug SET NOT NULL` dan unique index.
  - `tidak destruktif` — `expect(bare).not.toMatch(/\b(DELETE|TRUNCATE)\b|DROP\s+(TABLE|COLUMN)/i)`.
  - `policy tulis admin memakai TO authenticated, baca publik USING (true)` — untuk `instansi` dan `layanan_tautan`: `FOR SELECT USING (true)` dan `FOR ALL TO authenticated USING (public.get_my_role() = 'admin')`.
  - `audit perubahan dipasang` — `CREATE TRIGGER trg_audit_instansi` dan `trg_audit_layanan_tautan` `EXECUTE FUNCTION public.audit_perubahan()`.
  - `mencabut tebakan form dari nama` — `DROP TRIGGER IF EXISTS trg_layanan_isi_form_pendataan ON public.layanan` dan tidak ada `CREATE TRIGGER trg_layanan_isi_form_pendataan`.
  - `v_layanan_publik menambah kolom di akhir tanpa mengubah WHERE` — kolom `website_terkait` muncul setelah `prefiks_antrean`; `WHERE l.aktif = true AND l.status_tampilan <> 'nonaktif'`; `GRANT SELECT ON public.v_layanan_publik TO anon, authenticated`.
  - `terdaftar di manifest` — `FORWARD_MIGRATION_FILES` memuat nama file.
- [ ] **Step 2:** `npx vitest run --pool=vmForks supabase/migrations/instansi_layanan_konten.test.ts` → FAIL (file belum ada).
- [ ] **Step 3: Tulis migrasi** sesuai Interfaces. Backfill slug: loop baris `WHERE slug IS NULL ORDER BY nama` memakai logika yang sama dengan trigger. `GRANT SELECT` tabel baru ke `anon, authenticated`. Tambahkan `COMMENT ON` untuk tabel/kolom baru (pola file `202610090004`). Header komentar menyebut spesifikasi & ADR 0001.
- [ ] **Step 4:** Perbarui `MANIFEST.json` (sha256 file) dan `FORWARD_MIGRATION_FILES`; jalankan test Step 2 + `npx vitest run --pool=vmForks supabase/migrations/manifest.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(db): instansi, konten layanan, website terkait (migrasi 202610270001, belum diterapkan)`.

### Task 2: Migrasi jadwal tunggal, arsip, dan saklar antrean

**Files:**
- Create: `supabase/migrations/202610270002_jadwal_tunggal_layanan.sql`
- Create: `supabase/migrations/jadwal_tunggal_layanan.test.ts`
- Modify: `supabase/migrations/MANIFEST.json`, `supabase/migrations/migration-test-utils.ts`

**Interfaces:**
- Consumes: kolom `layanan.diarsipkan_at` (Task 1).
- Produces (DB):
  - `public.is_layanan_buka_jadwal(p_layanan_id uuid, p_tanggal date, p_jam time DEFAULT NULL) RETURNS boolean` — signature sama. Urutan baru: (1) `false` bila tidak ada baris `layanan` dengan `id = p_layanan_id AND aktif = true`; (2) `false` bila ada baris `hari_libur` dengan `tanggal = p_tanggal`; (3) logika `jadwal_pengecualian` lalu `jadwal_standby` versi `202607290010` tanpa perubahan.
  - `public.layanan_sudah_tutup_untuk(p_layanan_id uuid, p_waktu timestamptz DEFAULT now()) RETURNS boolean STABLE` — `true` bila `public.layanan_sudah_tutup(p_waktu)` (global) **atau** jam WIB `p_waktu` > `jam_selesai` baris `jadwal_standby` aktif untuk hari WIB itu, **atau** tidak ada baris itu. `GRANT EXECUTE` ke `authenticated`.
  - Trigger `trg_layanan_jadwal_default` AFTER INSERT ON `layanan`: sisipkan `jadwal_standby` hari 1–5, 08:00–15:30, `ON CONFLICT (layanan_id, hari) DO NOTHING`.
  - Trigger `trg_jadwal_standby_batas_tutup` BEFORE INSERT OR UPDATE ON `jadwal_standby`: tolak `jam_selesai > public.jam_tutup_layanan()` atau `jam_mulai >= jam_selesai` dengan `RAISE EXCEPTION 'JADWAL_TIDAK_VALID: …' USING ERRCODE = '22023'`. (Baris lama tidak disentuh; trigger hanya berlaku untuk tulisan baru.)
  - `public.fo_eskalasi` (salin utuh dari `202610140007_wp24_akhiri_dual_write.sql:648`) dan `public.admin_alihkan` (salin utuh dari `202610140012_perbaikan_review.sql:609`): blok `IF public.layanan_sudah_tutup() THEN RAISE … LAYANAN_TUTUP` diganti `IF public.layanan_sudah_tutup_untuk(<id layanan tujuan>) THEN RAISE EXCEPTION 'LAYANAN_TUTUP: % sudah tutup untuk hari ini', v_l.nama USING ERRCODE = 'P0001'` (pertahankan ERRCODE versi lama bila berbeda). Pesan `LAYANAN_TIDAK_BUKA` menyebut "libur/di luar jadwal/diarsipkan".
  - `public.reservasi_buat` (salin utuh dari `202610140012_perbaikan_review.sql:728`): cek `ISODOW IN (6,7)` hanya untuk `v_tujuan = 'bertemu_seseorang'`, ditambah tolak bila `tanggal` ada di `hari_libur` (pesan `TANGGAL_TIDAK_VALID: kantor libur pada tanggal tersebut`). Jalur `loket` hanya mengandalkan `is_layanan_buka_jadwal`.
  - `public.v_antrian_loket` (CREATE OR REPLACE, kolom identik dengan `202610140007:1496`): `WHERE service.punya_antrean = true AND service.aktif = true` (menggantikan `service.tipe = 'konsultatif'`).

- [ ] **Step 1: Tulis test kontrak yang gagal** `jadwal_tunggal_layanan.test.ts`, `it(...)`:
  - `is_layanan_buka_jadwal menolak layanan arsip dan hari libur sebelum pola mingguan` — body fungsi memuat `aktif = true` dan `FROM public.hari_libur` dan keduanya muncul sebelum `FROM public.jadwal_standby`.
  - `layanan_sudah_tutup_untuk menggabungkan batas global dan jam_selesai layanan`.
  - `fo_eskalasi dan admin_alihkan memakai batas tutup per layanan` — tiap fungsi memuat `layanan_sudah_tutup_untuk(` dan tidak lagi memuat `IF public.layanan_sudah_tutup() THEN`.
  - `reservasi_buat tidak lagi menolak akhir pekan untuk loket` — cek `ISODOW` berada di dalam cabang `bertemu_seseorang`; ada cek `hari_libur`.
  - `v_antrian_loket memakai saklar punya_antrean, bukan tipe` — tidak memuat `tipe = 'konsultatif'`.
  - `layanan baru mendapat jadwal default Senin–Jumat 08:00–15:30`.
  - `jadwal_standby tidak boleh melewati jam_tutup_layanan`.
  - `tidak destruktif` (regex sama dengan Task 1, ditambah `not.toMatch(/\bUPDATE\b/)` di luar body fungsi yang disalin — cukup pastikan tidak ada `UPDATE public.layanan`/`UPDATE public.jadwal_standby`).
- [ ] **Step 2:** Jalankan test → FAIL.
- [ ] **Step 3: Tulis migrasi** sesuai Interfaces; pertahankan `REVOKE`/`GRANT` setiap fungsi yang diganti persis seperti versi sumbernya.
- [ ] **Step 4:** Manifest + daftar file; jalankan test Task 1, Task 2, `manifest.test.ts`, dan test kontrak lama yang menyentuh fungsi ini (`supabase/migrations/fo_eskalasi.test.ts`, `perbaikan_review.test.ts`, `wp24.test.ts`, `antrean_estimasi.test.ts`) → PASS. Bila test lama mengunci teks versi lama, jangan ubah test lama; tambahkan pengecualian hanya bila test itu memang membaca "definisi terakhir" — laporkan bila ragu.
- [ ] **Step 5: Commit** — `feat(db): satu jadwal per layanan + hari libur + arsip menutup gerbang tiket/reservasi (migrasi 202610270002, belum diterapkan)`.

### Task 3: API admin — Instansi, Layanan (buat/ubah/arsip/hapus), website terkait

**Files:**
- Modify: `src/app/api/admin/layanan/route.ts` (GET kolom baru + POST)
- Modify: `src/app/api/admin/layanan/[id]/route.ts` (PATCH skema baru, DELETE; hapus guard `determineFormType`)
- Create: `src/app/api/admin/layanan/[id]/arsip/route.ts`, `src/app/api/admin/layanan/[id]/tautan/route.ts`
- Create: `src/app/api/admin/instansi/route.ts`, `src/app/api/admin/instansi/[id]/route.ts`
- Create: `src/lib/layanan/schemas.ts` (zod bersama)
- Test: `src/app/api/admin/layanan/layanan.route.test.ts`, `src/app/api/admin/instansi/instansi.route.test.ts` (pola mock: `src/app/api/admin/petugas/akun.test.ts`)

**Interfaces:**
- Consumes: Task 1 (kolom & tabel), helper yang sudah ada `requireAdmin`/`requireStaf`/`json` (`@/lib/akun/server`), `mutasiWajibBaris`/`MutasiError` (`@/lib/supabase/mutate`), `catatMutasiGagal`/`kodeDbMutasi`/`pesanDbMutasi` (`@/app/api/admin/_mutasi`).
- Produces (`src/lib/layanan/schemas.ts`):
  - `tautanSchema = z.object({ label: z.string().trim().min(1).max(80), url: z.string().trim().max(500).regex(/^https:\/\/\S+$/) })`
  - `layananKontenSchema` (dipakai POST dan PATCH): field PATCH lama + `instansi_id: z.uuid().nullable()`, `slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(80)`, `deskripsi: z.string().trim().max(4000).nullable()`, `urutan: z.number().int().min(0).max(9999)`, `konten_sumber_url: https-URL ≤ 500 nullable`, `form_pendataan: z.enum(['oss','perizinan']).nullable()`, `chatbot_aktif` **tidak** (tetap di `/bot`).
  - `instansiSchema = z.object({ nama: z.string().trim().min(2).max(150), singkatan: z.string().trim().max(30).nullable() })`
  - `type LayananAdmin` = baris GET (kolom lama + `aktif, instansi_id, slug, deskripsi, urutan, konten_sumber_url, konten_diperbarui_at, diarsipkan_at, website_terkait: {label,url}[]`).
- Produces (HTTP):
  - `GET /api/admin/layanan` → `{ layanan: LayananAdmin[], instansi: {id,nama,singkatan}[], bisa_ubah }` (admin & FO; termasuk layanan arsip, ditandai `aktif=false`).
  - `POST /api/admin/layanan` (admin) body `layananKontenSchema` dengan `nama` wajib → 201 `{ id, slug }`; 409 `NAMA_BENTROK` / `PREFIKS_BENTROK` / `SLUG_BENTROK`.
  - `PATCH /api/admin/layanan/[id]` → field konten; bila `deskripsi` atau `konten_sumber_url` berubah, set `konten_diperbarui_at = now()`.
  - `POST /api/admin/layanan/[id]/arsip` body `{ arsip: boolean }` → `aktif = !arsip`, `diarsipkan_at = arsip ? now() : null`.
  - `DELETE /api/admin/layanan/[id]` → 409 `SUDAH_DIPAKAI` bila ada baris di `tiket_antrean`, `penanganan`, `chat_sesi` (kolom `layanan_id`) atau `kunjungan` (kolom `layanan_saran_id`); selain itu hapus → 200.
  - `PUT /api/admin/layanan/[id]/tautan` body `{ tautan: tautanSchema[] }` (maks 10) → ganti seluruh daftar milik layanan itu (urut = indeks), set `konten_diperbarui_at`.
  - `GET/POST /api/admin/instansi`, `PATCH /api/admin/instansi/[id]` (admin; GET juga FO) → 409 `NAMA_BENTROK`.

- [ ] **Step 1: Tulis test route yang gagal**, minimal:
  - `POST layanan menolak non-admin (403) dan URL http:// (400)`.
  - `POST layanan mengirim form_pendataan null apa adanya` (Review Focus 5).
  - `PATCH nama yang memuat "OSS" tidak lagi ditolak RENAME_UBAH_JENIS_FORM`.
  - `PATCH deskripsi mengisi konten_diperbarui_at`.
  - `arsip true menulis aktif=false dan diarsipkan_at; arsip false mengembalikan`.
  - `DELETE menolak 409 SUDAH_DIPAKAI bila hanya kunjungan.layanan_saran_id yang merujuk` (Review Focus 3).
  - `DELETE layanan bersih → 200`.
  - `PUT tautan menolak lebih dari 10 tautan dan URL non-https`.
  - `slug bentrok 23505 → 409 SLUG_BENTROK` (Review Focus 4).
  - `instansi: POST nama bentrok → 409 NAMA_BENTROK; FO GET 200, FO POST 403`.
- [ ] **Step 2:** `npx vitest run --pool=vmForks src/app/api/admin/layanan src/app/api/admin/instansi` → FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces. Tulis lewat `createClient()` sesi Admin (bukan service-role) supaya trigger audit mencatat pelaku. Pemetaan galat 23505 dibedakan dari `pesanDbMutasi` (`prefiks` / `slug` / lainnya = nama).
- [ ] **Step 4:** Jalankan test → PASS; `npm run typecheck`.
- [ ] **Step 5: Commit** — `feat(admin): API kelola instansi, layanan (buat/arsip/hapus), dan website terkait`.

### Task 4: Halaman Kelola Layanan — tambah, konten, website terkait, Instansi, arsip

**Files:**
- Modify: `src/app/admin/layanan/page.tsx`, `src/components/admin/layanan/LayananForm.tsx`
- Create: `src/components/admin/layanan/TautanEditor.tsx`, `src/components/admin/layanan/InstansiDialog.tsx` (+ `*.module.css` bila perlu)
- Test: `src/app/admin/layanan/layanan.test.tsx` (tambah kasus; jangan hapus kasus lama kecuali yang menguji konfirmasi rename-OSS)

**Interfaces:**
- Consumes: endpoint Task 3, `LayananAdmin`, `tautanSchema` (validasi sisi klien).
- Produces: komponen `TautanEditor({ value: {label,url}[], onChange, disabled })`, `InstansiDialog({ open, onClose, instansi, onSaved })`.

- [ ] **Step 1: Tulis test UI yang gagal** (pola `layanan.test.tsx` dengan `fetch` di-mock):
  - `tombol "Tambah layanan" (admin) membuka form kosong dan mengirim POST ke /api/admin/layanan`.
  - `form menampilkan Instansi (select), Deskripsi, Urutan, Sumber konten, Formulir pendataan dengan opsi "Tanpa formulir tetap"`.
  - `website terkait: tambah/hapus baris, URL http:// diberi pesan galat dan tidak dikirim; simpan mengirim PUT .../tautan`.
  - `Arsipkan meminta konfirmasi lalu POST .../arsip {arsip:true}; baris arsip tampil di bagian "Diarsipkan" dengan tombol "Aktifkan lagi"`.
  - `Hapus permanen hanya tampil untuk layanan arsip; 409 SUDAH_DIPAKAI menampilkan pesan "Layanan ini sudah pernah dipakai, jadi hanya bisa diarsipkan."`.
  - `Front Office tidak melihat tombol tambah/arsip/hapus`.
  - `Kelola Instansi: tambah instansi baru lalu muncul di pilihan form`.
- [ ] **Step 2:** `npx vitest run --pool=vmForks src/app/admin/layanan` → FAIL.
- [ ] **Step 3: Implementasi.** Hapus dialog konfirmasi "ganti nama mengubah jenis form" bila hanya terkait `determineFormType`; konfirmasi ganti nama biasa tetap. Teks lewat `design:ux-copy`; form lewat `design:accessibility-review` (label eksplisit, galat terkait `aria-describedby`).
- [ ] **Step 4:** Test → PASS; `npm run lint`.
- [ ] **Step 5: Commit** — `feat(admin): kelola layanan dinamis (tambah, konten, website terkait, instansi, arsip)`.

### Task 5: Halaman Jadwal — jadwal mingguan per Layanan + hari libur nasional

**Files:**
- Modify: `src/app/admin/settings/jadwal/page.tsx`
- Test: `src/app/admin/settings/jadwal/jadwal.test.tsx`

**Interfaces:**
- Consumes: tabel `jadwal_standby` (`layanan_id, hari 1–7, jam_mulai, jam_selesai, aktif`, UNIQUE `(layanan_id, hari)`), `hari_libur(tanggal PK, keterangan)`, trigger validasi Task 2. Tulis lewat client browser sesi admin (RLS `jadwal_standby_admin_write`, `hari_libur_admin_write`).
- Produces: halaman tidak lagi membaca/menulis `layanan_jadwal` dan `layanan_libur`.

- [ ] **Step 1: Tulis test yang gagal**:
  - `memuat 7 baris hari dari jadwal_standby layanan terpilih (hari tanpa baris = tidak aktif)`.
  - `simpan melakukan upsert jadwal_standby dengan onConflict "layanan_id,hari" untuk 7 hari`.
  - `jam tutup lebih dari 16:00 atau jam buka ≥ jam tutup ditolak di klien dengan pesan`.
  - `galat 22023 JADWAL_TIDAK_VALID dari DB ditampilkan sebagai pesan, bukan "berhasil"`.
  - `bagian "Hari libur nasional" menambah baris ke hari_libur dan menampilkan daftar mulai hari ini (WIB)`.
  - `tidak ada pemanggilan from('layanan_jadwal') atau from('layanan_libur')`.
  - `teks "live chat tetap buka" sesuai aturan baru: "Live chat tetap bisa dipakai; di luar jadwal, bot yang menjawab."`.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implementasi.** Hapus hari libur nasional = hapus baris `hari_libur` buatan admin (aksi pengguna, bukan migrasi). Tanggal "hari ini" dari `todayWIB()`.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** — `fix(admin): jadwal mengubah jadwal_standby yang dipakai gerbang, hari libur nasional bisa diisi admin`.

### Task 6: Reservasi mengikuti jadwal layanan dan hari libur

**Files:**
- Modify: `src/app/me/reservasi/page.tsx:190-195`
- Test: `src/app/me/reservasi/reservasi.test.tsx`

**Interfaces:**
- Consumes: RPC `is_layanan_buka_jadwal`, `jadwal_berikutnya` (sudah dipakai), tabel `hari_libur` (baca publik).

- [ ] **Step 1: Tulis test yang gagal**:
  - `loket: Sabtu tidak ditolak di klien bila is_layanan_buka_jadwal mengembalikan true` (layanan yang buka Sabtu).
  - `loket: hari buka yang ternyata hari libur ditolak lewat RPC (false) dengan pesan jadwal terdekat`.
  - `bertemu_seseorang: akhir pekan tetap ditolak; tanggal di hari_libur ditolak "Kantor libur pada tanggal tersebut."`.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implementasi** — cek akhir pekan hanya untuk `tujuan === 'bertemu_seseorang'`, ditambah cek `hari_libur` untuk tujuan itu; jalur loket tetap lewat RPC.
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** — `fix(reservasi): tanggal mengikuti jadwal layanan dan hari libur nasional`.

### Task 7: Bot memakai profil Layanan

**Files:**
- Create: `src/lib/llm/profil-layanan.ts`, `src/lib/llm/profil-layanan.test.ts`
- Modify: `src/app/api/chat/ai/route.ts:187-195`, `src/lib/llm/bot.ts` (`jalankanBot` input + susunan `context`)

**Interfaces:**
- Produces:
  - `type ProfilLayanan = { nama: string; instansi: string | null; deskripsi: string | null; websiteTerkait: { label: string; url: string }[] }`
  - `teksProfilLayanan(p: ProfilLayanan): string` — blok `[PROFIL LAYANAN RESMI]` berisi nama, instansi, deskripsi (dipotong 1500 karakter), dan daftar `label: url`; mengembalikan `''` bila deskripsi kosong dan tidak ada tautan.
  - `jalankanBot` menerima `profilLayanan?: ProfilLayanan`; blok profil disisipkan di depan konteks FAQ/dokumen (bukan menggantikan aturan lingkup).
- Consumes: route membaca `nama, chatbot_aktif, deskripsi, instansi:instansi_id(nama), layanan_tautan(label,url,urut)` dari `layanan` (admin client yang sudah dipakai).

- [ ] **Step 1: Tulis test yang gagal** `profil-layanan.test.ts`:
  - `menyusun blok berisi nama, instansi, deskripsi, dan tautan berurutan`.
  - `memotong deskripsi lebih dari 1500 karakter`.
  - `mengembalikan string kosong bila tidak ada deskripsi dan tautan`.
  - Tambah satu kasus di test route chat AI yang ada (cari `src/app/api/chat/ai/*.test.ts`): `jalankanBot dipanggil dengan profilLayanan dari baris layanan`.
- [ ] **Step 2:** Test → FAIL.
- [ ] **Step 3: Implementasi.**
- [ ] **Step 4:** Test → PASS.
- [ ] **Step 5: Commit** — `feat(bot): konteks profil layanan (deskripsi, instansi, website terkait)`.

### Task 8: Dokumentasi dan gerbang akhir

**Files:**
- Modify: `CLAUDE.md` (peta DB: `instansi`, `layanan_tautan`, sumber jadwal = `jadwal_standby` + `hari_libur`; `layanan_jadwal`/`layanan_libur` tidak dipakai), `docs/MIGRATIONS.md` (dua migrasi, status "belum diterapkan", urutan terap: 202610270001 lalu 202610270002), `docs/STATUS.md` (baris Fase 1).

- [ ] **Step 1:** Perbarui ketiga dokumen.
- [ ] **Step 2:** `npm run verify:baseline` → semua langkah lolos (bila `audit:check` gagal karena advisory yang sudah ada di `main`, laporkan terpisah; jangan ubah dependensi di branch ini).
- [ ] **Step 3:** Baca `git diff origin/main...HEAD`, scan secret, pastikan tidak ada perubahan di luar daftar file rencana.
- [ ] **Step 4: Commit** — `docs: peta layanan dinamis fase 1 dan status migrasi`.
