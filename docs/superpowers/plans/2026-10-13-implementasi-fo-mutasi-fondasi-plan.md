# Rencana Implementasi: Fondasi, Mutasi Tercek, Error Publik, dan Alur Front Office

> Tanggal: 2026-10-13 · Status: **DRAFT — menunggu persetujuan CEO** · Basis: `main` @ `95195de`
>
> Menggabungkan tiga spec hasil brainstorm CEO:
> 1. [`2026-10-13-fondasi-dependensi-migrasi-error-publik-design.md`](../specs/2026-10-13-fondasi-dependensi-migrasi-error-publik-design.md) — T10, T11, T6, T7, S1, S14, V5
> 2. [`2026-10-12-mutasi-tercek-design.md`](../specs/2026-10-12-mutasi-tercek-design.md) — T2a–d, FAQ umum
> 3. [`2026-10-12-alur-fo-eskalasi-design.md`](../specs/2026-10-12-alur-fo-eskalasi-design.md) — T1, B1–B6 (+ T3, T4, T8, T9, S9, WP-24 yang ikut tersentuh)
>
> Pelacak status: [`docs/audit/AUDIT-2026-10-12-TRACKER.md`](../../audit/AUDIT-2026-10-12-TRACKER.md). **Di luar rencana ini:** survei terpadu (Tahap E, spec terpisah), staging (topik terpisah), T5 selain tab baru, S2, S4–S8, S10–S13, S15, R1–R4.

## 0. Aturan yang mengikat semua tugas

1. **Urutan kerja tiap tugas:** muat skill relevan → tulis test yang gagal (TDD) → implementasi → `npm run lint && npm run typecheck && npm test` → baca diff → perbarui pelacak dengan bukti. Gerbang akhir fase: `npm run verify:baseline`.
2. **Next.js 16:** sebelum menulis kode halaman/route/konfigurasi, baca guide terkait di `node_modules/next/dist/docs/` (AGENTS.md). Tugas 0.1 mengubah versi → baca ulang setelahnya.
3. **Migrasi:** hanya forward baru (`YYYYMMDDNNNN_nama.sql`, timestamp > `202610090005`), idempoten, ada test kontrak statis di sebelahnya dan **rollback SQL** di `docs/rollback-<nama>.sql`. Tidak pernah edit file lama. Penerapan ke produksi hanya dengan **konfirmasi CEO per migrasi** (`node scripts/apply-migration.mjs … --atomic`, mulai `--dry-run`), lalu **verifikasi di produksi** sebelum menandai selesai.
4. **Git:** kerja di branch fitur (bukan `main`); commit/push **hanya atas instruksi CEO** (AGENTS.md); remote lewat `gh`; scan secret sebelum menyatakan selesai.
5. **Tanpa CI GitHub:** semua gerbang (lint, typecheck, test, build, audit, sinkron dependensi) dijalankan lokal lewat `npm run verify:baseline`; tidak ada perubahan workflow GitHub Actions.
6. **Pelacak:** "Selesai" hanya dengan bukti (commit/diff, hasil gerbang, hasil verifikasi produksi bila ada DB). Perbarui juga `.superpowers/sdd/progress.md`.
7. **Model subagent** (memori `subagent-model-tiers`): inventaris/mekanis = **Haiku 5.5**; implementasi/migrasi/komponen = **Sonnet 5.5**; desain RLS, review keamanan, review upgrade `next` = **Opus 5.5**. Satu penulis per berkas pada satu waktu.
8. **Tidak ada `catch {}` kosong**; setiap mutasi memakai helper Fase 1 setelah tersedia.
9. **WIB:** semua batas hari lewat `src/lib/time.ts`.

## 1. Peta urutan dan ketergantungan

```
Fase 0  Fondasi ─────────────┐
 0.1 T10  0.2 gerbang lokal  0.3 T11-guard  0.4 ledger  (0.5 V5 = CEO)
                             ▼
Fase 1  Mutasi tercek ───────┤  (helper dipakai Fase 2 & 3)
                             ▼
Fase 2  Error publik + consent (T6/T7/S1/S14)
                             ▼
Gerbang Keputusan G ──► Fase 3  Alur FO
                             Tahap A  sesi tunggal + kepemilikan tiket (T1, B1)
                             Tahap B  penanganan, eskalasi, WP-24, TV, offline, a11y
                             Tahap C  chat online, pendaftaran, Pendataan wajib
                             Tahap D  rekap FO/petugas + performa
                             ▼
Fase 4  Penutupan: dokumen, STATUS, runbook rollout, pelacak
```

Paralelisme yang aman: 0.1 ∥ 0.3 ∥ 0.4 (berkas berbeda). Fase 1.1 (helper) bisa mulai bersamaan dengan Fase 0 setelah 0.1 selesai. Fase 2 menunggu helper 1.1. Tahap A bisa mulai setelah Gerbang G butir 1–2 dan Fase 1.1; Tahap B menunggu seluruh Gerbang G.

**Gerbang Keputusan G — SEMUA DIJAWAB CEO 2026-10-13** (dari spec FO §11):
1. WP-24/`visit`: **DIPUTUSKAN CEO 2026-10-13 = Opsi A**: hentikan tulis `visit` di Tahap B bersamaan dengan alur FO, nonaktifkan `trg_visit_dual_write` (data lama tetap sebagai arsip, ada rollback), cutover di luar jam layanan.
2. Batas sesi: **DIPUTUSKAN CEO 2026-10-13**: logout otomatis setelah jam tutup layanan (16:00 WIB, dibaca dari pengaturan layanan, bukan hardcode) dan idle 2 jam (dapat diubah admin).
3. Kolom identitas yang dikunci: **DIPUTUSKAN CEO 2026-10-13 = Opsi A**: hanya **Nama Lengkap** (profil pengunjung tidak punya kolom NIK; tidak menambah data baru). HP, instansi, kategori, email tetap dapat diubah pengunjung. Perubahan nama lewat FO/admin + `audit_log`.
4. Topik penanganan per layanan petugas: **DIPUTUSKAN CEO 2026-10-13 = Opsi A**: draf awal dibuat dari daftar layanan produksi (5-8 topik/layanan), dikoreksi CEO; disimpan di tabel `topik_penanganan` yang dapat diubah admin tanpa deploy.
5. Field Pendataan Pelayanan: **DIPUTUSKAN CEO 2026-10-13 = Opsi A**: SEMUA field wajib; field usaha (tipe pelaku, status modal, skala, KBLI, lokasi) punya pilihan eksplisit "Belum ada / Tidak berlaku" yang harus dipilih sadar (tidak boleh kosong; direkap sebagai "belum punya usaha"). Catatan internal/petugas wajib terisi (boleh "-"). Divalidasi di DB (`INVALID_PAYLOAD`) dan UI.
6. Jadwal cutover: **DIPUTUSKAN CEO 2026-10-13**: hanya setelah jam tutup (setelah 16:00 WIB) dan hanya bila antrean kosong; hari: **Jumat sore atau akhir pekan** (ada waktu perbaikan sebelum petugas masuk Senin). Didahului skrip pemeriksaan otomatis (transaksi di-rollback) yang hijau; petugas diberi tahu perubahan cara kerja sebelum hari H.

---

## Fase 0 — Fondasi (T10, T11)

### 0.1 Naikkan `next` dan `sharp` (T10) — Sonnet; review Opus
- **Berkas:** `package.json`, `package-lock.json`, `docs/PRODUCTION_READINESS.md`, `docs/TESTING.md`.
- **Langkah:** (1) baca catatan rilis 16.2→16.3 + `node_modules/next/dist/docs/`; (2) `package.json`: `next ^16.3.8`, `sharp ^0.35.5`; (3) `npm install` lalu `npm ci` (node_modules lokal sinkron dengan lockfile); (4) `npm run verify:baseline`; (5) uji manual alur PDF→PNG ber-watermark (`api/investment-docs/page-image`, `public-view`) dengan `canvas`/`pdfjs-dist`/`sharp`; (6) `npm audit` — catat sisa advisory.
- **Selesai bila:** gerbang hijau; `next --version` ≥ 16.3.8; pipeline PDF→PNG berjalan; `npm audit --audit-level=high` bersih atau semua sisa masuk allowlist (0.2).

### 0.2 Gerbang lokal: audit high + sinkron dependensi (T10, K2–K3) — Sonnet
- **Prinsip (CEO):** semua pemeriksaan CI dijalankan **di lokal**, tidak di GitHub. `.github/workflows/ci.yml` **tidak diubah** (dan tidak diandalkan); tugas ini hanya menambah gerbang lokal.
- **Berkas:** `scripts/check-audit.mjs`, `scripts/check-deps-sync.mjs` (+ test untuk keduanya), `audit-allow.json` (root repo), `package.json` (script `audit:check`, `deps:check`; keduanya ditambahkan ke `verify:baseline`), `docs/TESTING.md`, `docs/PRODUCTION_READINESS.md`.
- **Langkah:** `check-audit` membaca `npm audit --json`, gagal bila ada advisory high+ di luar allowlist atau tenggatnya lewat (entri `{id, alasan, tenggat}`); `check-deps-sync` gagal bila versi `next`/`sharp` di `node_modules` ≠ `package-lock.json`; selaraskan klaim di dokumen.
- **Test:** advisory high di luar allowlist → gagal; di dalam & belum kedaluwarsa → lolos; tenggat lewat → gagal; versi terpasang ≠ lockfile → gagal.
- **Opsional (tanya CEO):** git hook lokal `pre-push` (`.githooks/` + `core.hooksPath`) yang menjalankan `verify:baseline`; tidak memakai `--no-verify`.

### 0.3 Penjaga migrasi (T11 §4.1) — Sonnet
- **Berkas:** `supabase/migrations/MANIFEST.json` (baru), `supabase/migrations/manifest.test.ts` (baru), `scripts/gen-migration-manifest.mjs` (baru), `docs/MIGRATIONS.md`.
- **Langkah:** skrip membuat manifest (nama → SHA-256) untuk 57 file; test gagal bila isi file lama berubah atau file baru tidak ada di manifest; dokumentasikan aturan §4.1 spec fondasi (dilarang edit in-place, dilarang skrip ad-hoc ke produksi, wajib catat di `MIGRATIONS.md` + `DB-CHANGES.md` di commit yang sama).
- **Selesai bila:** mengubah satu karakter di migrasi lama membuat test gagal.

### 0.4 Verifikasi & pencatatan ledger (T11 §4.2, K5) — Sonnet (skrip), CEO (isi ledger)
- **Berkas:** `scripts/verify-migration-ledger.mjs` (baru, **read-only**), `docs/analysis/DB-CHANGES.md`, `docs/MIGRATIONS.md`, `docs/STATUS.md`.
- **Langkah:** bandingkan 57 file vs ledger (13 entri, berhenti di `202607280005`); untuk 44 file tak tercatat periksa objek penanda (tabel/kolom/fungsi/policy) di produksi → `terpasang | sebagian | tidak ditemukan`; tulis hasilnya di `DB-CHANGES.md` dan `MIGRATIONS.md`; perbarui `STATUS.md`. **Mengisi ledger (`INSERT` ke `supabase_migrations.schema_migrations`) = tulis produksi** → skrip terpisah dengan `--dry-run` dan konfirmasi CEO; tidak dijalankan otomatis.
- **Selesai bila:** laporan menyatakan status setiap 44 file; dokumen diperbarui; (opsional, setelah konfirmasi) ledger terisi dan `supabase migration list` konsisten.

### 0.5 V5 — CEO
Nilai "Max rows" (Dashboard → API) dan rate limit login (Authentication). Dicatat di pelacak; menentukan T5 dan S6.

**Gerbang Fase 0:** `npm run verify:baseline` (sudah memuat `audit:check` dan `deps:check` dari 0.2) + test manifest hijau — seluruhnya dijalankan lokal.

---

## Fase 1 — Mutasi tercek (T2a–d, FAQ umum)

### 1.1 Helper `mutasi*` — Sonnet
- **Berkas:** `src/lib/supabase/mutate.ts` + `mutate.test.ts` (baru).
- **Langkah (TDD):** `MutasiError {kode: jaringan|ditolak|tidak_ada_baris|database, pesan}`; `mutasiWajibBaris(query)` (UPDATE/DELETE: error atau 0 baris → throw); `mutasiInsert(query)` (INSERT/UPSERT: error → throw). Pesan Indonesia siap tampil; logging via `logServerEvent` di sisi server.
- **Test:** error → throw; 0 baris → `tidak_ada_baris`; baris ada → kembalikan; insert ditolak (`42501`) → throw.

### 1.2 Inventaris mutasi — Haiku
- Cari semua `.update(`/`.delete(`/`.upsert(`/`.insert(` pada rantai `.from(` di `src/` (page, component, route, lib); keluarkan tabel: berkas:baris, tabel, klien (anon/service), sudah dicek?, kelas (T2a/b/c/d/lain). Simpan di `docs/audit/INVENTARIS-MUTASI-2026-10.md`. Masukkan ke pelacak sebagai dasar T2d.

### 1.3 Konversi T2a/T2b/T2c — Sonnet
- **T2a:** `src/app/admin/chat/faq/page.tsx` — fungsi `layananFaqBolehDikelola(role, petugas)` di `src/lib/` (+test); dropdown ter-scope (admin: semua + "Umum"; petugas: layanannya; FO: "Umum"); edit/hapus lewat `mutasiWajibBaris`; toast sukses setelah terbukti.
- **T2b:** `src/app/me/notifications/page.tsx:102-111` — `upsert` via `mutasiInsert`; gagal → `sub.unsubscribe()` + toggle mati + pesan; jalur nonaktif juga cek hasil `delete`.
- **T2c:** `src/app/admin/dokumen/page.tsx:111-113` — `mutasiWajibBaris`; `loadDocs()` di jalur sukses dan gagal.
- **Test komponen** untuk ketiganya (mock `{error}` dan 0 baris → toast gagal; push gagal → toggle mati + langganan batal).

### 1.4 Konversi sisa inventaris (T2d) — Haiku (mekanis) + Sonnet (review)
- Konversi seluruh titik dari 1.2; titik yang sengaja tak dicek diberi komentar alasan. Tambah test untuk halaman besar yang disentuh (`admin/antrian`, `admin/scan`, `admin/umkm`) seperlunya agar perubahan terlindungi.

### 1.5 FAQ umum: migrasi + RAG + navigasi — Sonnet; review RLS Opus
- **Migrasi `202610130001_faq_umum.sql`** (+ `.test.ts` + `docs/rollback-faq-umum-202610130001.sql`): `layanan_id DROP NOT NULL`; policy `faq_fo_umum` (FO hanya baris `layanan_id IS NULL`); `match_faq_teks` & `match_faq`: `layanan_id = p_layanan OR layanan_id IS NULL`, prioritas layanan di atas umum.
- **Kode:** `src/app/api/chat/ai/route.ts`, `src/app/api/admin/faq/embed/route.ts` (tangani `layanan_id` NULL), tampilan FAQ publik di chat (layanan + umum), `src/lib/admin-nav.ts` (Kelola FAQ: `admin|petugas|front_office`) + `admin-nav.test.ts`.
- **Test:** kontrak migrasi (nullable, policy, `OR layanan_id IS NULL`); RAG menemukan FAQ umum di layanan mana pun; petugas tidak bisa menyentuh FAQ umum.
- **Rollout:** `--dry-run` → konfirmasi CEO → terapkan → verifikasi di produksi (policy ada, fungsi memuat klausa baru).

### 1.6 Aturan lint memblokir (K4) — Sonnet
- **Berkas:** `eslint.config.mjs`, aturan lokal (plugin kecil di `eslint-rules/` atau `no-restricted-syntax`) + test aturan.
- **Langkah:** aktifkan **setelah** 1.3–1.4 selesai; aturan menandai mutasi `.from(...)` tanpa pembungkus `mutasi*`; pengecualian hanya dengan `eslint-disable-next-line` + alasan. Bila terlalu berisik di route handler, batasi dulu ke `page.tsx`/`components`/`hooks` (keputusan saat inventaris).
- **Selesai bila:** `npm run lint` (`--max-warnings=0`) hijau dan contoh kode salah memicu error di test aturan.

**Gerbang Fase 1:** `verify:baseline`; pelacak T2a–d, B8 → Selesai (dengan bukti, termasuk verifikasi produksi FAQ umum).

---

## Fase 2 — Error halaman publik & consent (T6, T7, S1, S14)

### 2.1 Komponen `ErrorRetry` — Sonnet
- `src/components/ErrorRetry.tsx` + `.module.css` + test: `role="alert"`, pesan, tombol "Coba lagi" (`onRetry`), fokus yang benar, gaya mengikuti token `globals.css`.

### 2.2 Chat publik (T7, S14) — Sonnet
- **Berkas:** `src/app/chat/page.tsx:257-264,430,457-462,179-194`.
- **Langkah:** hapus daftar `fallback-N`; gagal muat layanan → `ErrorRetry` (memuat ulang); FAQ gagal → pesan + Coba lagi; hapus blok FAQ hardcoded ("Halal GRATIS", kode mati). Opsional setelah 1.5: FAQ umum sebagai alternatif.
- **Test:** `{error}` pada layanan → tampil `ErrorRetry`, tidak ada id palsu, tidak ada "periksa koneksi internet" saat memilih layanan; retry memuat ulang.

### 2.3 UMKM publik (T6, minimal) — Sonnet
- **Berkas:** `src/app/umkm/page.tsx:107-127,145-164,238-249,566`.
- **Langkah:** gagal muat → `ErrorRetry`, bukan "Belum ada listing"; "tautan edit terkirim" hanya bila `res.ok`. **Tidak** ada paginasi (K10).
- **Test:** kegagalan muat/kirim → pesan jelas; sukses → perilaku lama tetap.

### 2.4 Consent PDP memblokir (S1) — Sonnet
- **Berkas:** `src/app/chat/page.tsx:392-398`, `src/app/me/reservasi/page.tsx:194-200` (hapus komentar "konsisten"); acuan `src/app/checkin/page.tsx:168-181`.
- **Langkah:** `mutasiInsert` pada `consent_log`; gagal → proses tidak dilanjutkan + `ErrorRetry`.
- **Test:** consent gagal → sesi chat/reservasi tidak dibuat; sukses → dibuat. Rujuk `docs/KEBIJAKAN_PDP.md:51-61`.

**Gerbang Fase 2:** `verify:baseline`; pelacak T6, T7, S1, S14 → Selesai (bukti test + diff).

---

## Fase 3 — Alur Front Office

> Detail tugas di bawah setingkat tugas; **sebelum tiap tahap dimulai**, ditulis rencana langkah-demi-langkah (skill `writing-plans`) karena rincian bergantung pada Gerbang G dan hasil investigasi A0.

### Tahap A — Sesi tunggal + kepemilikan tiket (menutup T1, B1)

**A0. Investigasi arah tulis `visit` ↔ `tiket_antrean` — Opus (read-only)**
- Fakta awal: `trg_visit_dual_write` (AFTER INSERT/UPDATE pada `visit`, `sync_visit_dual_write()` di `202607300015`) menyalin `visit` → `kunjungan`/`tiket_antrean`; `admin/antrian/page.tsx:214,246` masih menulis `visit`, sementara `panggil_tiket()` menulis `tiket_antrean` langsung; pembacaan sudah dari `tiket_antrean` (WP-22).
- Keluaran: dokumen pendek `docs/analysis/ANTREAN-ARAH-TULIS.md`: siapa menulis apa, apakah trigger bisa berulang (rekursi), dan keputusan: RPC Tahap A menulis `tiket_antrean` **dan** baris `visit` terkait (`legacy_visit_id`) dalam satu transaksi sampai WP-24 (Tahap B.9), atau WP-24 dimajukan.

**A1. Sesi tunggal — DB — Sonnet; review Opus**
- **Migrasi `202610130002_sesi_staf.sql`** (+ test + rollback): tabel `sesi_staf(user_id PK, session_id, last_seen, dibuat_at)`; RPC `daftarkan_sesi()` (ambil `session_id` dari klaim JWT, upsert → menimpa sesi lama); fungsi `sesi_valid()`; RPC `ping_sesi()` (heartbeat); RLS: hanya pemilik membaca barisnya, tulis lewat RPC; hanya peran staf.
- **Verifikasi awal:** klaim `session_id` ada di JWT proyek ini; setting Auth "single session" Supabase (tidak diandalkan).

**A2. Sesi tunggal — aplikasi — Sonnet**
- **Berkas:** `src/app/login/page.tsx` (panggil `daftarkan_sesi()` setelah login), `src/proxy.ts` (tolak `/admin*` bila `sesi_valid()` palsu → login dengan pesan "Akun ini login di perangkat lain"), hook baru `src/lib/hooks/useSesiStaf.ts` (heartbeat tiap ~60 dtk + realtime; auto-logout), `AdminGuard`, `Sidebar` (logout). Logout otomatis setelah jam tutup (dari pengaturan layanan) dan bila heartbeat berhenti lewat batas (Gerbang G.2).
- **Test:** login kedua menggantikan sesi pertama; aksi dari sesi lama ditolak di DB; heartbeat memperbarui `last_seen`; menutup browser lalu login lagi tidak terkunci; pengunjung tidak terkena.

**A3. RPC atomik `layanan_mulai` / `layanan_selesai` — DB — Sonnet; review Opus**
- **Migrasi `202610130003_tiket_kepemilikan.sql`** (+ test + rollback): `layanan_mulai(tiket)` = `UPDATE … WHERE status IN ('menunggu','dipanggil') AND layanan sesuai petugas AND sesi_valid() RETURNING` (0 baris → `SUDAH_DIAMBIL`); `layanan_selesai(tiket, payload)` = `WHERE dilayani_oleh = pemanggil`; perbarui `finalize_pelayanan` agar FO **tidak** boleh menyelesaikan tiket layanan; semua mengikuti keputusan A0 soal `visit`.
- **Test kontrak + uji perilaku RLS** (`npm run test:rls` hanya bila CEO setuju, karena menyentuh produksi dalam transaksi yang di-rollback): dua pemanggil bersamaan → satu menang; selesai oleh orang lain → ditolak.

**A4. UI antrean — Sonnet**
- **Berkas:** `src/app/admin/antrian/page.tsx` (tombol 627/651/672 memakai RPC; kunci tombol selama request; pesan "Tiket ini sudah ditangani petugas lain"; `aria-live` untuk status), `src/components/admin/PelayananWizardModal.tsx` (kirim lewat RPC).
- **Test:** klik ganda → satu request; respons `SUDAH_DIAMBIL` → pesan + daftar dimuat ulang; petugas lain tidak melihat tombol "Selesai" pada tiket orang lain.
- **Gerbang Tahap A:** `verify:baseline`; migrasi diterapkan ke produksi (konfirmasi CEO) dan diverifikasi; pelacak **T1 dan B1 → Selesai** hanya dengan bukti ini.

### Tahap B — Penanganan, eskalasi, WP-24 (B2, S3, S9, T3, T4, T8, T9)

- **B1. Migrasi model data** (`202610130004…`, dipecah beberapa file bila perlu; semua + test + rollback): `layanan.prefiks_antrean` 2 huruf unik (CHECK `^[A-Z]{2}$`, UNIQUE, auto-generate + backfill 1→2 huruf); `kunjungan.asal` += `online`, `chat_sesi_id`, `selesai_at`; tabel `penanganan`; tabel `topik_penanganan`; `tiket_antrean` += `penanganan_asal_id`, status `dikembalikan|dialihkan`; cabut `kunjungan_insert_public`/`tiket_insert_public` (`WITH CHECK (true)`).
- **B2. RPC:** `fo_mulai_kunjungan`, `fo_selesai`, `fo_eskalasi`, `fo_ambil_dari_kotak_masuk`, `layanan_kembalikan`, `admin_ambil_alih`, `admin_alihkan` (semua cek role + `sesi_valid()`, catatan wajib, `audit_log` untuk admin). Opus meninjau RLS/otorisasi.
- **B3. UI FO:** halaman **Kotak Masuk FO** + **Penanganan FO** (`src/app/admin/…` + entri di `src/lib/admin-nav.ts` + test), form penanganan (topik/hasil/catatan wajib), dialog eskalasi; `WalkinWizard`, `admin/scan`, `checkin` menjadi alur FO tanpa tiket (modal a11y T8: `htmlFor`, Escape, focus trap, kembalikan fokus — pola `Sidebar.tsx:164-186`/`KoreksiPelayananModal.tsx:112-117`).
- **B4. UI petugas & admin:** antrean per layanan, tombol "Kembalikan ke FO", admin ambil alih/alihkan.
- **B5. Layar TV (T4):** `src/app/layar/[token]/page.tsx` — kegagalan jaringan sementara tidak menghasilkan "Token tidak valid" permanen (retry + backoff, bedakan token invalid vs gangguan); perbesar teks label di `layar-token.module.css`; hanya menampilkan tiket hasil eskalasi.
- **B6. Offline (T3) + kamera QR (T9):** `public/sw.js`, `src/lib/offline/replay.ts`, `src/app/checkin/page.tsx` — listener Background Sync nyata + replay saat halaman dibuka ulang; `client_request_id` pada replay (`api/checkin/route.ts`), `ownerUserId`; `admin/scan/page.tsx:157-161` — `stop()` pada cleanup.
- **B7. Durasi dari jam server (S9):** `mulai_at/selesai_at` diisi DB.
- **B8. Notifikasi eskalasi** ke petugas layanan (jalur `queue_notifikasi`).
- **B9. WP-24 — hentikan tulis `visit`:** hapus 7 titik tulis (`api/checkin`, `api/admin/pelayanan/[tiketId]`, `admin/antrian`, `admin/scan`, `checkin`, `me`, `me/reservasi`) + `WalkinWizard`; nonaktifkan `trg_visit_dual_write` dengan migrasi + rollback; **cutover di luar jam layanan, antrean kosong** (Gerbang G.6); jendela rollback tertulis.
- **Test:** pengujian per RPC (konkurensi, otorisasi per peran, catatan wajib), komponen untuk kotak masuk/form/eskalasi, replay offline idempoten, layar TV.
- **Gerbang Tahap B:** `verify:baseline`; skrip `scripts/selftest-fo-eskalasi.mjs`/`verify-…` terhadap DB dengan konfirmasi CEO; pelacak B2, S3, S9, T3, T4, T8, T9 → Selesai dengan bukti.

### Tahap C — Chat online, pendaftaran, Pendataan wajib (B3, B4, B5)

- **C1. Chat sebagai layanan online:** `chat_sesi.kunjungan_id`; RPC `chat_ambil` (atomik, `WHERE penangan IS NULL`), `chat_teruskan`, `chat_selesai` (topik + catatan wajib → `penanganan`); `src/app/admin/chat/page.tsx` (kotak masuk FO, petugas boleh ambil bila belum diambil FO); pesan penutup berisi tautan survei dipersiapkan (isi survei = Tahap E).
- **C2. Pendaftaran online + pernyataan kebenaran:** semua field profil wajib (`ProfileCompletenessGate`); kotak centang wajib + teks; catat `consent_log` (jenis `pernyataan_kebenaran`, versi teks, waktu) dengan `mutasiInsert`; kunci kolom identitas (Gerbang G.3); perubahan lewat FO/admin + `audit_log`.
- **C3. Pendataan Pelayanan wajib (K11):** `src/lib/types/pelayanan.ts` — skema final menuntut seluruh field non-kosong; `layanan_selesai` memvalidasi payload di DB (`INVALID_PAYLOAD`); audit field opsional satu per satu (Gerbang G.5); `PelayananWizardModal` menandai semua field wajib.
- **Gerbang:** `verify:baseline`; pelacak B3, B4, B5 → Selesai.

### Tahap D — Rekap FO/petugas + performa (B6, T5 tab baru)

- Rekap harian FO per orang per hari (WIB) dari `penanganan` via `src/lib/rekap/` (ExcelJS, paginasi penuh gaya `exportAll.ts`); rekap petugas layanan (+ data Pendataan); halaman **Performa** (jumlah dilayani, durasi per tahap, tingkat eskalasi/pengembalian) di `src/app/admin/…` + `admin-nav.ts`; `rekap_harian_layanan` lama dipertahankan sebagai historis.
- **Test:** agregasi per FO/hari, batas hari WIB, ekspor tidak terpotong untuk > batas baris PostgREST (lihat V5), nama FO tampil di ekspor.
- **Gerbang:** `verify:baseline`; pelacak B6 → Selesai.

---

## Fase 4 — Penutupan

1. Perbarui `docs/STATUS.md`, `docs/DECISION_LOG.md`, `docs/MIGRATIONS.md`, `docs/analysis/DB-CHANGES.md`, `docs/analysis/04-RBAC-MATRIX*.md`, `docs/ENVIRONMENT_VARIABLES.md` (bila ada env baru), `docs/RUNBOOK_*` rollout FO.
2. Runbook rollout + rollback tiap migrasi (`docs/RUNBOOK_FO_ESKALASI.md`); jadwal cutover dan komunikasi ke petugas (satu akun per orang, aturan login).
3. Pelacak: semua topik rencana ini berstatus Selesai dengan bukti; ringkasan diperbarui.
4. `verify:baseline` terakhir + scan secret + baca diff aktual sebelum melaporkan selesai.

## Risiko utama

| Risiko | Mitigasi |
|---|---|
| Upgrade `next` merusak pipeline PDF/canvas | Uji manual 0.1.5; review Opus; rollback ke lockfile lama |
| Migrasi besar (Tahap B) memutus antrean produksi | Rollback SQL per migrasi; cutover di luar jam layanan; dry-run `--atomic` |
| Ledger belum diisi → `db push` menjalankan ulang 44 migrasi | Jangan pakai `db push`; 0.4 mengisi ledger setelah konfirmasi |
| Aturan lint terlalu berisik | Bertahap lingkup (1.6) |
| Sesi tunggal mengunci petugas | Login baru menggantikan sesi lama; auto-logout jam tutup |
| `visit`/`tiket_antrean` dua sumber tulis | A0 sebelum Tahap A; B9 mengakhiri dual-write |
| Tabel tanpa cek `session_id` di JWT | Verifikasi di A1 sebelum desain final |

## Ringkasan urutan kerja (dapat dijadwalkan)

| # | Tugas | Model | Tergantung |
|---|---|---|---|
| 1 | 0.1, 0.3, 0.4 (paralel), 1.1 | Sonnet (+Opus review 0.1) | — |
| 2 | 0.2, 1.2 | Sonnet / Haiku | 0.1 |
| 3 | 1.3, 1.4, 1.5 | Sonnet/Haiku (+Opus RLS) | 1.1, 1.2 |
| 4 | 1.6, 2.1–2.4 | Sonnet | 1.3–1.4 / 1.1 |
| 5 | **Gerbang G** (keputusan CEO), A0 | CEO / Opus | — |
| 6 | Tahap A (A1–A4) | Sonnet (+Opus) | G.1–G.2, 1.1 |
| 7 | Tahap B | Sonnet (+Opus) | A, G |
| 8 | Tahap C, Tahap D | Sonnet | B |
| 9 | Fase 4 | Sonnet | semua |
