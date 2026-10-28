# Fase 2 — Homepage Etalase + Popup Layanan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Homepage menjadi etalase layanan: blok berjenis tetap yang bisa dinyalakan/dimatikan, diurutkan, dan diubah teksnya oleh admin; kartu layanan terisi otomatis dari data; klik kartu membuka popup aksesibel berisi nama, Instansi, deskripsi, website terkait, jadwal, status buka/tutup hari ini, dan antrean, dengan alamat sendiri `/?layanan=<slug>`.

**Architecture:** Satu migrasi forward aditif (kolom saklar `layanan.tampil_di_homepage`, tabel `homepage_blok`, fungsi publik `layanan_status_hari_ini()` yang memakai `is_layanan_buka_jadwal`, view publik diperluas). Aplikasi membaca lewat pemuat berlapis (`src/lib/homepage/*`) yang turun ke bawaan bila migrasi belum diterapkan, sehingga homepage tidak pernah 500. Halaman `/` tetap client component (pola proyek), dipecah menjadi komponen blok; popup memakai `useDialogFokus` yang sudah ada; alamat popup lewat `useSearchParams` + `router.push/back` (dibungkus `Suspense`).

**Tech Stack:** Next.js 16 App Router (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`: halaman prerender yang memakai `useSearchParams` wajib dibungkus `Suspense`), React 19, Supabase Postgres + RLS, zod, Vitest (`--pool=vmForks`), CSS Modules.

**Spec:** [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](../specs/2026-10-26-layanan-dinamis-design.md) §2 dan §5. Dibangun di atas Fase 1 ([plan](2026-10-26-fase-1-fondasi-layanan.md)).

## Global Constraints

- **B1 — data lama tidak diubah/dihapus.** Migrasi hanya menambah: kolom, tabel, fungsi, `CREATE OR REPLACE VIEW`, dan baris seed `INSERT … ON CONFLICT DO NOTHING`. Tidak ada `DELETE`/`TRUNCATE`/`DROP`/`UPDATE`. Baris `landing_content` (termasuk tipe `service`) dibiarkan; hanya **disalin** ke `homepage_blok` sebagai nilai awal teks.
- **B2 — migrasi:** `202610280001_homepage_etalase.sql` + test kontrak statis + sha256 di `MANIFEST.json` + `FORWARD_MIGRATION_FILES`. Policy tulis admin `TO authenticated`; policy baca publik `USING (true)` (konstan, aman untuk anon). Tidak diterapkan oleh agen.
- **Dilarang:** menerapkan migrasi, `npm run test:rls`, `node scripts/apply-migration.mjs`, query ke DB produksi.
- Aplikasi **tidak boleh crash** bila migrasi `202610280001` (atau bahkan `202610270001/2`) belum diterapkan: pemuat turun ke bawaan; homepage tetap tampil.
- Blok yang dimatikan **tidak dirender sama sekali** (tidak ada teks cadangan). Teks kosong pada blok yang menyala memakai teks bawaan.
- Status buka/tutup hanya dari `is_layanan_buka_jadwal` (lewat `layanan_status_hari_ini()`); hari WIB; tidak menduplikasi logika jadwal di klien.
- CSP tidak berubah (tidak ada origin baru; tautan eksternal hanya anchor). Teks UI Indonesia, CSS Modules, tanpa Tailwind. Dialog: `role="dialog"`, `aria-modal`, `aria-labelledby`, focus trap, Esc, fokus kembali ke pemicu.
- TDD: tes ditulis lebih dulu (`npx vitest run --pool=vmForks <berkas>`). Gate akhir: `npm run lint`, `typecheck`, `npm test`, `npm run build`.

## Keputusan pelaksana

Pemilik meminta tidak berhenti untuk bertanya; bagian spesifikasi yang diam soal perilaku terlihat diputuskan di sini.

| # | Keputusan | Biaya bila keliru |
|---|---|---|
| K1 | Saklar "tampil di homepage" = kolom baru `layanan.tampil_di_homepage boolean NOT NULL DEFAULT true` (Fase 1 menyebutnya di spesifikasi tetapi tidak membuat kolomnya). Layanan lama semua `true`. | Bila pemilik ingin sebagian layanan lama tersembunyi, admin cukup mencabut centang per layanan (satu klik). |
| K2 | Konfigurasi blok disimpan di tabel baru `homepage_blok(jenis PK, aktif, urutan, teks jsonb)`, bukan `landing_content`/`site_settings`. Nilai awal teks hero/layanan/ajakan/footer **disalin** dari `landing_content` (insert-if-missing) agar suntingan pemilik tidak hilang. | Bila lebih disukai di `site_settings`, cukup ganti pemuat; baris lama tak tersentuh. |
| K3 | Halaman admin `/admin/settings/landing` diganti menjadi **editor blok** (nyalakan/matikan, naik/turun, teks). Baris `landing_content` tidak lagi disunting dari UI. | Mengembalikan editor lama = memulihkan satu berkas dari git. |
| K4 | Jenis blok & urutan bawaan: hero, jalur_cepat, status_hari_ini, layanan, papan_kinerja (mati), ajakan, footer. **Footer selalu paling bawah** (bisa dimatikan/diedit teksnya, tidak bisa dipindah). | Footer di tengah halaman tidak masuk akal; bila dibutuhkan, lepas pembatasan di editor. |
| K5 | `papan_kinerja` = jenis blok tercadang, bawaan mati. Bila dinyalakan hanya menampilkan judul + deskripsi teksnya (bawaan kosong → tidak ada yang tampil). Editor memberi catatan "belum tersedia". | Tidak ada; konten papan dibangun fase lain. |
| K6 | Tautan jalur cepat **tetap di kode** (Rencanakan kedatangan, Live chat, Pengaduan, Lacak pengaduan, UMKM, Investasi, Standar pelayanan, Transparansi); admin hanya mengubah judul + deskripsi blok. | Bila pemilik ingin tautan bisa diubah, tambah daftar tautan pada `teks` (migrasi tidak perlu). |
| K7 | Judul bagian layanan memakai penampung `{jumlah}` (bawaan `{jumlah} Layanan dalam Satu Atap`); `{jumlah}` = jumlah kartu yang tampil. Admin yang menghapus `{jumlah}` berarti sengaja tanpa angka. Seed **tidak** menyalin judul lama "10 Layanan…" (angka usang). | Judul lama dengan angka tetap harus diketik ulang admin bila diinginkan. |
| K8 | Layanan `coming_soon` tampil sebagai kartu berlabel "Segera hadir" (popup tetap bisa dibuka, tanpa status/antrean). `nonaktif` dan arsip tidak tampil. | Bila `coming_soon` harus disembunyikan, ubah satu filter. |
| K9 | Layanan dengan `tampil_di_homepage=false` tidak punya kartu, tetapi **popupnya tetap bisa dibuka lewat `/?layanan=<slug>`** (supaya tautan dari bot tidak mati). Layanan arsip/nonaktif: slug tak dikenal, popup tidak muncul, halaman biasa. | Bila tautan layanan tersembunyi harus mati, filter pemuat popup. |
| K10 | Ikon kartu dipilih otomatis dari hash slug (tidak ada kolom ikon). | Ikon bisa tidak "pas"; menambah kolom ikon bisa belakangan. |
| K11 | Kartu memuat satu baris status ("Buka sekarang" / "Tutup saat ini · Buka setiap Kamis" / "Libur: keterangan"); status dinilai pada jam WIB sekarang (RPC meneruskan jam ke `is_layanan_buka_jadwal`), sehingga sesudah jam tutup tampil tutup. Frasa jadwal dibentuk dari `jadwal_standby` memakai pemadat yang sama dengan bot (`src/lib/jadwal-teks.ts`, dibagi pakai). Satu hari → "setiap Kamis"; rentang → "Senin–Jumat". | Hanya redaksi. |
| K12 | Antrean di popup diambil sekali saat popup dibuka dari `v_antrian_loket` (tanpa langganan realtime baru: `EstimasiAntrean` sudah memakai kanal `antrean:publik` dan kanal Supabase dedupe per topik). Hanya ditampilkan untuk layanan `punya_antrean` yang buka hari ini. | Angka bisa tertinggal sampai popup dibuka ulang; blok "Status hari ini" tetap realtime. |
| K13 | Bila `layanan_status_hari_ini()` belum ada/gagal, status buka/tutup **dihilangkan** (kartu tanpa baris status, popup tanpa jadwal) alih-alih ditebak di klien. | Sementara migrasi belum diterapkan etalase tampil tanpa status; ini sengaja agar tidak ada informasi jadwal yang salah. |
| K14 | Pemuat layanan dicoba 3 tingkat (view lengkap → kolom Fase 1 → kolom lama). Tingkat terakhir menurunkan slug dari nama di klien. | Hanya jalur darurat; hilang setelah migrasi diterapkan. |
| K15 | Tautan "Tanya lewat live chat" = `/chat?layanan=<id layanan>` (halaman chat sudah mencocokkan `id` persis), hanya bila `punya_chat`. | Tidak ada. |
| K16 | Bot: baris `Halaman layanan: /?layanan=<slug>` ditambahkan ke profil. Tautan relatif (aplikasi tidak punya URL publik di env) dan chat tidak membuat tautan klik otomatis, jadi manfaat penuh menyusul bila chat diberi linkify. Tidak diubah di sini. | Bot hanya menyebut alamat; pengunjung menyalin. |
| K17 | Navbar, menu seluler, dan tombol live chat mengambang bukan blok (selalu tampil). Isi blok `footer` memakai kontak dari `site_settings` seperti sekarang; yang dapat disunting hanya teks hak cipta. | Tidak ada. |
| K19 | Setelah review: footer boleh dimatikan, tetapi tautan Kebijakan Privasi dirender di luar blok (`TautanKebijakan`) sehingga selalu tampil. Pemuat halaman dibatasi 6 detik per pemuat. Deskripsi lama `service` tidak disalin otomatis; langkah admin + SQL baca-saja ada di `docs/MIGRATIONS.md`. `audit_perubahan()` diganti salinan utuh (hanya menambah `jenis`) di migrasi yang sama. | Fungsi audit bersama berubah; diverifikasi tes anti-drift (isi sama persis kecuali satu kunci). |
| K18 | Tautan di teks blok disaring (`/…`, `https://…`, atau `wa` untuk tombol kedua hero); nilai lain diganti bawaan. | Admin tak bisa memasang tautan bentuk lain (mis. `mailto:`). |

## Review Focus

1. **Blok mati tidak boleh jatuh ke teks cadangan** — baris `homepage_blok.aktif=false` harus menghilangkan seluruh blok. Pin: test `blok.test.ts` + test halaman.
2. **Anon SELECT** — `homepage_blok`, `v_layanan_publik`, `layanan_status_hari_ini()` dibaca anon; tidak ada policy `FOR ALL` tanpa `TO` yang memanggil `get_my_role()`. Pin: test kontrak migrasi.
3. **Migrasi belum diterapkan** — homepage tetap tampil (blok bawaan, kartu dari tingkat pemuat yang tersedia). Pin: test pemuat + test halaman.
4. **Alamat popup** — buka lewat klik → `push`; tutup → `back` bila dibuka dari kartu, selain itu `replace('/')`; slug tak dikenal diabaikan; Esc/overlay/tombol Tutup menutup; fokus kembali ke kartu. Pin: test popup/halaman.
5. **Status buka/tutup di WIB dan lewat `is_layanan_buka_jadwal`** — tidak ada logika jadwal baru di klien selain memadatkan teks. Pin: test kontrak migrasi.

---

### Task 1: Migrasi homepage etalase

**Files:**
- Create: `supabase/migrations/202610280001_homepage_etalase.sql`, `supabase/migrations/homepage_etalase.test.ts`
- Modify: `supabase/migrations/MANIFEST.json`, `supabase/migrations/migration-test-utils.ts`

**Interfaces (DB):**
- `layanan.tampil_di_homepage boolean NOT NULL DEFAULT true` (ADD COLUMN IF NOT EXISTS).
- `v_layanan_publik` (CREATE OR REPLACE, `security_invoker=true`, WHERE tak berubah): kolom Fase 1 tetap berurutan, `tampil_di_homepage` ditambahkan di akhir.
- `homepage_blok(jenis text PK CHECK IN (…7 jenis), aktif boolean NOT NULL DEFAULT true, urutan integer NOT NULL DEFAULT 100, teks jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(teks)='object'), updated_at)`; RLS: `FOR SELECT USING (true)` + `FOR ALL TO authenticated … get_my_role()='admin'`; grant SELECT anon+authenticated, INSERT/UPDATE/DELETE authenticated; trigger `update_updated_at_column` + `audit_perubahan`.
- Seed 7 baris `ON CONFLICT (jenis) DO NOTHING`; teks hero/layanan(label,description)/ajakan(cta)/footer disalin dari `landing_content` aktif.
- `layanan_status_hari_ini() RETURNS TABLE(layanan_id uuid, buka_hari_ini boolean, libur_keterangan text, jadwal jsonb)` — `SECURITY DEFINER`, `SET search_path`, hari WIB, `is_layanan_buka_jadwal(id, tgl, NULL)`, hanya layanan `aktif` dan `status_tampilan<>'nonaktif'`; `REVOKE … FROM PUBLIC; GRANT EXECUTE TO anon, authenticated`.

- [ ] **Step 1:** Tulis test kontrak: kolom saklar aditif; view menambah kolom di akhir tanpa mengubah WHERE; tabel+CHECK jenis; policy (`TO authenticated` untuk admin, `USING (true)` untuk publik); seed insert-if-missing dan salinan `landing_content` tanpa judul layanan; fungsi status memakai `is_layanan_buka_jadwal`, `Asia/Jakarta`, `SECURITY DEFINER`, `GRANT EXECUTE … anon`; tidak destruktif (`DELETE|TRUNCATE|DROP|UPDATE`); terdaftar di `FORWARD_MIGRATION_FILES`.
- [ ] **Step 2:** `npx vitest run --pool=vmForks supabase/migrations/homepage_etalase.test.ts` → FAIL.
- [ ] **Step 3:** Tulis migrasi; perbarui `MANIFEST.json` (sha256) dan `FORWARD_MIGRATION_FILES`.
- [ ] **Step 4:** Jalankan test ini + `manifest.test.ts` + `instansi_layanan_konten.test.ts` → PASS.
- [ ] **Step 5: Commit** — `feat(db): etalase homepage (migrasi 202610280001, belum diterapkan)`.

### Task 2: Pustaka murni — blok, jadwal teks

**Files:**
- Create: `src/lib/homepage/blok.ts`, `src/lib/homepage/blok.test.ts`, `src/lib/jadwal-teks.ts`, `src/lib/jadwal-teks.test.ts`
- Modify: `src/lib/llm/profil-layanan.ts` (memakai `jadwal-teks.ts`)

**Interfaces:**
- `JENIS_BLOK`, `type JenisBlok`, `DEFINISI_BLOK` (label admin, daftar bidang `{kunci,label,panjang:'pendek'|'panjang'}`, `bawaan` teks, `aktifBawaan`, `urutanBawaan`).
- `gabungkanBlok(rows: BarisBlok[] | null): BlokTersusun[]` — urut `urutan` (footer terakhir), baris hilang = bawaan, teks kosong = bawaan, `aktif` dari baris. Mengembalikan **semua** blok (termasuk mati); `blokTampil()` menyaring `aktif`.
- `judulLayanan(templat, jumlah)`; `linkAman(nilai, bawaan, {izinkanWa})`.
- `jadwal-teks.ts`: `kelompokJadwal(jadwal)`, `teksJadwalMingguan(jadwal)` (pindah dari profil-layanan), `teksBukaSetiap(jadwal)` ("setiap Kamis" / "Senin–Jumat" / dua kelompok), `labelHari`.

- [ ] **Step 1:** Tes: blok mati tak muncul di `blokTampil`; baris hilang → bawaan (papan_kinerja mati, lainnya nyala); urutan kustom dihormati, footer terakhir; teks kosong → bawaan; `{jumlah}` diganti, tanpa penampung tetap apa adanya; `linkAman` menolak `javascript:`; `teksBukaSetiap` kasus 1 hari/rentang/dua kelompok/kosong; test profil-layanan lama tetap lulus.
- [ ] **Step 2:** FAIL → **Step 3:** implementasi → **Step 4:** PASS (`blok.test.ts jadwal-teks.test.ts profil-layanan.test.ts`).
- [ ] **Step 5: Commit** — `feat(homepage): model blok dan pemadat jadwal`.

### Task 3: Pemuat data berlapis

**Files:** Create `src/lib/homepage/data.ts`, `src/lib/homepage/data.test.ts`

**Interfaces:**
- `type LayananEtalase { id, nama, slug, deskripsi, urutan, instansi: string|null, websiteTerkait, statusTampilan, punyaAntrean, punyaChat, tampilDiHomepage }`
- `type StatusHariIni { buka: boolean; liburKeterangan: string|null; jadwal: JadwalProfil[] }`
- `muatBlok(sb)` → `BlokTersusun[]` (galat/tabel hilang → bawaan); `muatLayanan(sb)` → `{layanan, tingkat}` (3 tingkat K14; gagal total → `[]`); `muatStatusHariIni(sb)` → `Map<id, StatusHariIni> | null` (K13); `slugDariNama(nama)`; `ikonKartu(slug)`.

- [ ] **Step 1:** Tes dengan Supabase tiruan: tingkat 1 sukses; tingkat 1 galat → tingkat 2; semua galat → `[]` tanpa melempar; slug turunan dari nama pada tingkat 3; tabel `homepage_blok` galat → blok bawaan; RPC status galat → `null`; urut menurut `urutan` lalu nama.
- [ ] **Step 2:** FAIL → **Step 3:** implementasi → **Step 4:** PASS.
- [ ] **Step 5: Commit** — `feat(homepage): pemuat blok, layanan, dan status hari ini dengan fallback`.

### Task 4: Popup layanan + daftar kartu

**Files:** Create `src/components/homepage/LayananPopup.tsx`, `LayananPopup.module.css`, `DaftarLayanan.tsx`, `DaftarLayanan.test.tsx`, `LayananPopup.test.tsx`

**Interfaces:**
- `LayananPopup({ layanan, status, antrean, onTutup })` — dialog; isi: nama (h2), Instansi, deskripsi, website terkait (anchor `target=_blank rel="noopener noreferrer"`), jadwal mingguan (7 hari), status ("Buka hari ini" / "Tutup hari ini · Buka setiap Kamis" / "Libur: …"), antrean (hanya `punyaAntrean` + buka), tautan kecil live chat bila `punyaChat`.
- `DaftarLayanan({ layanan, status, judul…, onBuka })` — kolom pencarian berlabel, kartu `<button>`, keadaan kosong "Tidak ada layanan yang cocok".

- [ ] **Step 1:** Tes: dialog punya `aria-modal` dan `aria-labelledby` ke nama; Esc, overlay, dan tombol Tutup memanggil `onTutup`; status tutup menampilkan "Tutup hari ini · Buka setiap Kamis"; libur; tanpa status (null) tidak menampilkan baris status/jadwal; tautan live chat memuat `/chat?layanan=<id>` dan hilang bila `punyaChat=false`; antrean tampil/tersembunyi sesuai K12; pencarian menyaring nama/instansi/deskripsi; kartu `coming_soon` berlabel "Segera hadir".
- [ ] **Step 2:** FAIL → **Step 3:** implementasi → **Step 4:** PASS. **Step 5: Commit** — `feat(homepage): popup layanan dan daftar kartu`.

### Task 5: Halaman `/` dari blok

**Files:** Modify `src/app/page.tsx`, `src/components/EstimasiAntrean.tsx` (props judul/subjudul opsional); Create `src/components/homepage/BlokLain.tsx` (hero, jalur cepat, ajakan, footer, papan kinerja), `src/app/page.test.tsx`

- [ ] **Step 1:** Tes halaman (mock `next/navigation`, Supabase, `EstimasiAntrean`): blok `aktif=false` tidak dirender (judul bawaannya tak ada di DOM); urutan blok mengikuti `urutan`; heading layanan memuat jumlah kartu dari data; `FALLBACK_SERVICES` tak muncul saat data kosong (hanya keadaan kosong); `?layanan=<slug>` membuka dialog; slug tak dikenal tidak membuka; klik kartu memanggil `router.push('/?layanan=<slug>', {scroll:false})`; tutup setelah klik → `router.back()`, tutup pada deep link → `router.replace('/', …)`; semua pemuat gagal → halaman tetap tampil (hero bawaan).
- [ ] **Step 2:** FAIL → **Step 3:** implementasi (halaman = pembungkus `Suspense` + isi yang memakai `useSearchParams`; hapus `FALLBACK_SERVICES`, `parseLandingContent`, `iconMap` lama) → **Step 4:** PASS + `EstimasiAntrean.test.tsx`.
- [ ] **Step 5: Commit** — `feat(homepage): etalase tersusun dari blok dan popup layanan`.

### Task 6: Admin — saklar homepage per layanan + editor blok

**Files:** Modify `src/lib/layanan/schemas.ts`, `src/app/api/admin/layanan/route.ts`, `src/components/admin/layanan/LayananForm.tsx` (+ tes route/form yang ada), rewrite `src/app/admin/settings/landing/page.tsx` + `landing.test.tsx`, `landing.module.css` bila perlu.

- [ ] **Step 1:** Tes: schema menerima `tampil_di_homepage`; GET admin tetap jalan bila kolom belum ada (ulang tanpa kolom); form menampilkan kotak "Tampil di homepage" dan mengirimnya; editor blok: memuat 7 blok (tabel hilang → bawaan + catatan migrasi), toggle, naik/turun (footer tak bisa dipindah), simpan = `upsert` 7 baris dengan `onConflict: 'jenis'` dan **dicek** (`mutasiWajibBaris`: 0 baris = galat, bukan sukses palsu), isian tidak hilang saat gagal.
- [ ] **Step 2:** FAIL → **Step 3:** implementasi → **Step 4:** PASS + `npm run lint`. **Step 5: Commit** — `feat(admin): saklar tampil di homepage dan editor blok homepage`.

### Task 7: Bot menautkan popup

**Files:** Modify `src/lib/llm/profil-layanan.ts`, `profil-layanan-server.ts`, tes terkait.

- [ ] **Step 1:** Tes: `teksProfilLayanan` memuat `Halaman layanan: /?layanan=<slug>` bila `slug` ada, dibersihkan dari penanda; tanpa slug tidak ada baris. **Step 2–4:** FAIL → implementasi (`slug` ikut `SELECT_PROFIL`) → PASS. **Step 5: Commit** — `feat(bot): profil layanan memuat alamat popup layanan`.

### Task 8: Dokumentasi dan gerbang akhir

- [ ] Perbarui `CLAUDE.md` (peta: homepage blok, `homepage_blok`, `layanan_status_hari_ini`), `docs/MIGRATIONS.md` (urutan terap: 202610270001 → 202610270002 → 202610280001; perilaku bila belum), `docs/STATUS.md` (baris Fase 2).
- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; baca diff, scan secret; `WalkinPanel.test.tsx` flaky → ulang sendiri.
- [ ] **Commit** — `docs: peta etalase homepage fase 2 dan status migrasi`.
