# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

AGENTS.md di atas berisi aturan wajib (Next.js 16 punya breaking changes → baca `node_modules/next/dist/docs/` dulu, aturan GitHub (`gh`)/push, workflow skill). Bagian di bawah adalah peta kode agar tidak perlu membaca ulang seluruh project.

## Orkestrasi (tim developer)

Di project ini Claude bertindak sebagai project manager tim lintas model (Claude + Codex) lewat Orca. Aturan umum, roster model dan effort, serta protokol diskusi ada di skill global `tim` (`~/.claude/skills/tim/`); jangan diulang di sini. Panduan Orca versi terpasang: `orca skills get orchestration`.

Khusus LMH, setiap spec worker memuat:
- Next.js 16 punya breaking changes: baca `node_modules/next/dist/docs/` sebelum menulis kode Next.js.
- Waktu lewat `src/lib/time.ts` (WIB). Baseline migrasi immutable: migrasi baru = file baru bertimestamp lebih besar + test kontrak di `supabase/migrations/*.test.ts`. CSP di `next.config.ts`. PII lewat `lib/pii.ts` dan `lib/csv.ts`.
- Worker Codex membaca `AGENTS.md`, bukan `CLAUDE.md`: tunjuk bagian peta kode di file ini yang relevan (Arsitektur, Peta file, Peta database).
- Test sempit: `npx vitest run --pool=vmForks <file>`. Gate penuh `npm run verify:baseline` dijalankan PM sekali per gelombang, setelah diff direview.

**Batas keras (semua worker dan PM):**
- Tanpa konfirmasi pengguna: `git push`, membuat release/PR/label/issue, mengubah remote GitHub.
- Menyentuh DB produksi: `node scripts/apply-migration.mjs`, `npm run test:rls`, `scripts/selftest-wp*.mjs`, `scripts/verify-wp*.mjs` membaca `.env.local` dan menyambung ke produksi. Worker dilarang menjalankannya. PM hanya menjalankan setelah menampilkan host tujuan dan daftar migrasi, dan setelah pengguna setuju.
- Worker tidak membaca, mengubah, atau mencetak `.env*`, credential, atau backup, dan tidak membuat commit kecuali spec menyuruh.

## Apa ini

Lampung Maju Hub (LMH) — portal pelayanan terpadu DPMPTSP Provinsi Lampung (bahasa UI & komentar kode: Indonesia). Next.js 16 App Router + React 19 + TypeScript, Supabase (Postgres/Auth/Storage/Realtime, RLS-heavy), CSS Modules (tanpa Tailwind), Vitest, deploy Vercel. Node >=22. Alias import `@/` → `src/`.
Sumber status terbaru: `docs/STATUS.md`, `docs/DECISION_LOG.md`, `LMH-AGENT-SPEC.md` (spesifikasi panjang, aturan 0.2). Catatan rinci per fase ada di `docs/fase/` (daftar di bawah).

## Perintah

```bash
npm run dev              # dev server
npm run lint             # eslint --max-warnings=0
npm run typecheck        # tsc --noEmit
npm test                 # vitest run --pool=vmForks (semua test)
npx vitest run --pool=vmForks src/lib/time.test.ts          # satu file
npx vitest run --pool=vmForks -t "nama test"                # satu test
npm run test:coverage    # CI memakai ini (threshold ~35/25/28/33)
npm run build
npm run verify:baseline  # lint + typecheck + test + build (gate sebelum selesai/push)
BASE_URL=http://localhost:3000 npm run smoke   # GET /api/health/live
npm run test:rls         # tes RLS perilaku — NYAMBUNG KE DB PRODUKSI via .env.local (transaksi di-rollback)
```

Test ada di samping source (`*.test.ts(x)`) dan di `supabase/migrations/*.test.ts` (kontrak statis SQL — tidak mengeksekusi SQL). Setup: `src/test/setup.ts`. CI: `.github/workflows/ci.yml` (lint → typecheck → coverage → build → npm audit).

## Arsitektur

**Request flow & auth**
- `src/proxy.ts` (pengganti `middleware.ts` di Next 16) hanya menjaga `/admin*` dan `/me*`: refresh sesi Supabase, redirect ke `/login`, lalu cek role admin. Role dibaca dari JWT `app_metadata.role` (Auth Hook), fallback query tabel `petugas` (harus `aktif`). Menambah `x-request-id` ke semua respons.
- Tiga role: `admin`, `petugas`, `front_office`. **`src/lib/admin-nav.ts` adalah sumber tunggal** akses halaman admin per role (dipakai `Sidebar` + `AdminGuard`); halaman admin yang tak terdaftar = admin-only. Menambah halaman admin → tambah entri di sini.
- Pengunjung memakai anon sign-in Supabase (RLS `pengunjung_id = auth.uid()`); mitra/UMKM memakai magic-link. Akun mitra = individual (`docs/KEBIJAKAN_AKUN_MITRA.md`).
- Supabase client: `src/lib/supabase/{client,server,service}.ts`. `service.ts` = service-role (server-only; jangan dipakai di client). Env divalidasi zod di `src/lib/env/{server,client}.ts`, dipanggil dari `src/instrumentation.ts` saat start (placeholder value ditolak).

**Aturan lintas-bagian yang mudah terlewat**
- Semua "hari ini"/batas hari memakai **WIB** lewat `src/lib/time.ts` (`todayWIB()` dll.) — jangan `toISOString().split('T')[0]`.
- Logika bisnis penting hidup di Postgres (RLS, trigger, RPC, view, pg_cron), bukan hanya di route handler. Perubahan perilaku sering = migrasi baru + test kontrak di `supabase/migrations/*.test.ts`.
- CSP ketat diatur di `next.config.ts` (mis. `connect-src` pernah memblok `fetch(data:)`); fitur baru yang memanggil origin baru harus memperbarui CSP.
- Output PII: pakai helper di `lib/pii.ts`/`lib/csv.ts`; kebijakan di `docs/KEBIJAKAN_PDP.md`.

**Domain inti** (daftar lama per halaman/API/berkas: [docs/fase/peta-kode-rinci.md](docs/fase/peta-kode-rinci.md))
- Pelayanan/antrean: model "Visit Spine" = `kunjungan` + `tiket_antrean` (sumber kebenaran; `visit` lama = arsip baca-saja sejak WP-24, `docs/RUNBOOK_FO_ESKALASI.md` §12). Nomor antrean atomik di DB (RPC/counter), absensi petugas jadi gerbang antrean, jadwal harian dibekukan; jadwal = `jadwal_standby` + `hari_libur`. Walk-in dan scan QR dilakukan Front Office (`/admin/fo/*`, `/admin/scan`); `/checkin` hanya informasi. Layar TV `/layar/[token]` (token 8 angka, diatur `/admin/layar`).
- Chat & bot: `api/chat/ai/route.ts` = RAG (FAQ + `dokumen_peraturan` via pgvector 3072-dim & FTS) dengan `lib/gemini.ts`; rantai LLM multi-vendor + circuit breaker + kuota harian di `lib/llm/registry.ts` (env `LLM_CHAT_PROVIDERS` format `provider:model,...`); redaksi PII/deteksi prompt-injection di `lib/pii.ts`. Percakapan per Layanan dan minta petugas: [Fase 5](docs/fase/fase-5-live-chat.md).
- Rekap dan masukan: `admin/rekap` → `api/admin/rekap/terpadu[/export]` → RPC berlingkup ([Fase 3](docs/fase/fase-3-koordinator-rekap.md)); survei SPAK/SKM, IKM, saran, pengaduan = Pesan Perilaku ([pesan-perilaku](docs/fase/pesan-perilaku.md)).
- UMKM: Katalog UMKM publik `/umkm/katalog` (`api/umkm-katalog`, `lib/umkm-katalog`, `components/umkm-katalog`), pemilik usaha `/me/usaha` (`api/umkm-pemilik`), perusahaan pencari pemasok `/me/umkm`, staf `admin/umkm-tugas`/`umkm-pengawasan`/`umkm-laporan`; rencana `docs/umkm/`. Marketplace lama `/umkm` DIHAPUS 2026-11-10 (alamat lama dialihkan di `next.config.ts`, tabel lama tetap di DB). Rincian: [umkm](docs/fase/umkm.md).
- Investasi: gallery/`peta-potensi` (PDF di-render jadi PNG ber-watermark: `api/investment-docs/*`, `canvas`/`pdfjs-dist`/`sharp`). Konten situs lewat `lib/site-settings.ts`; beranda dari `homepage_blok` ([Fase 2](docs/fase/fase-2-homepage.md)).
- Notifikasi: trigger DB → `api/notif/{send,retry}` dipanggil cron (header `Authorization: Bearer $CRON_SECRET`); Resend (`lib/email-html.ts`) + web-push (`public/sw-push.js`). PWA offline: `public/sw.js`, `lib/offline/{queue,replay}.ts`. Observability: `lib/observability/logger.ts` (`logServerEvent`), `api/health/{live,ready,error}`, header `Server-Timing` (`lib/observability/durasi.ts`).

## Lapisan hasil refaktor G0-G9 (pegangan kode baru)

Rencana [docs/superpowers/plans/2026-11-11-refaktor-arsitektur-ui.md](docs/superpowers/plans/2026-11-11-refaktor-arsitektur-ui.md), rancangan [docs/superpowers/specs/2026-11-11-refaktor-arsitektur-ui-design.md](docs/superpowers/specs/2026-11-11-refaktor-arsitektur-ui-design.md), handover [docs/superpowers/HANDOVER-2026-11-13-refaktor.md](docs/superpowers/HANDOVER-2026-11-13-refaktor.md).
- **Token**: satu sumber `src/styles/token.css` dengan dua blok: `:root` = tema publik (indigo, kaca) dan `[data-tema="dasbor"]` = tema dasbor (biru, datar). Bedanya SENGAJA (keputusan pemilik 2026-11-11). `globals.css` dan `tema-dasbor.css` tidak mendefinisikan custom property. Z-index >= 100 hanya `var(--z-*)`; titik putus 640/1024/1280 (kontrak di kepala `token.css`; penjaga `src/test/token-peta.test.ts`).
- **Komponen bersama** `src/components/ui/` (aturan di [src/components/ui/README.md](src/components/ui/README.md)): satu `Tombol` (kelas `.btn` tidak dipakai lagi; Server Component tidak mengoper prop `ikon`), satu cangkang modal `KerangkaModal` (dasar `Dialog`, `PanelSamping`, `DialogKonfirmasi`; jangan `window.confirm`), satu `Tabel` (caption wajib; baris tambah lewat prop `akhir`), dan `components/layout/IsiHalaman` sebagai satu-satunya pemegang padding, lebar, dan jarak isi halaman admin.
- **Lapisan data** `src/lib/data/<domain>.ts` (`referensi`, `antrean`, `chat-pengunjung`, `chat-staf`, `faq`, `reservasi`): fungsi menerima `SupabaseClient` sebagai argumen pertama dan mengembalikan hasil bertipe `{ data, error }`; tanpa React, tanpa toast; kolom eksplisit lewat konstanta `KOLOM_*` (`select('*')` dilarang kecuali pengecualian tertulis); query daftar ber-`.limit()`/`.range()`; query yang tidak saling bergantung lewat `Promise.all`. Daftar referensi kecil di klien: `lib/data/klien/useReferensi.ts`.
- **Data publik ber-cache** `lib/data/publik-server.ts` (server-only, `unstable_cache`, tag `publik-{beranda,layanan,faq,transparansi}`): beranda, `/chat`, `/pengaduan`, `/transparansi` = Server Component dengan `revalidate = 60` (data boleh tertinggal sampai 60 detik). Setelah admin mengubah data publik, panggil `segarkanPublik` (`lib/data/klien/segarkanPublik.ts` → `POST /api/admin/revalidasi`).
- **Realtime**: pusat `lib/realtime/pusat.ts` = satu channel per tabel dengan banyak pendengar, buka ulang ber-backoff; `lib/hooks/useRealtimeRefetch.ts` berlangganan lewat pusat ini.
- **Pola halaman besar**: `<halaman>/_logika/` (fungsi murni, tanpa I/O) + `_hook/` (state, efek, Realtime; tanpa JSX; <= 250 baris) + `_bagian/` (JSX dari props; tanpa query; <= 300 baris) + `page.tsx` <= 200 baris yang hanya merakit. Contoh: `admin/antrian`, `chat`, `admin/chat`, `admin/chat/faq`, `me/reservasi`.
- **Pagar anggaran** `src/test/anggaran-kode.test.ts` + `src/test/anggaran-kode.json` (hex, rgb, z-index literal, breakpoint di luar skala, token tak terdefinisi, kelas `.btn`, `window.confirm`, `select('*')`, query di `page.tsx`, baris page raksasa): angka hanya boleh TURUN. Turun = perbarui JSON ke angka baru; naik = perbaiki kodenya. Angka terakhir: `kelasBtn` 0 dan `tokenTakTerdefinisi` 0 (juga `windowConfirm` 0, `zIndexLiteral` 0), dan harus tetap 0.

## Peta file (per folder `src/`)

Per folder, bukan per berkas; daftar lama per halaman/API/berkas beserta catatan perubahannya: [docs/fase/peta-kode-rinci.md](docs/fase/peta-kode-rinci.md). Style = `*.module.css` di sebelah komponen/halaman.
- `src/app/` — App Router. Publik: `/` (etalase), `login`, `auth/callback`, `checkin` (info statis), `chat`, `survei/[token]`, `saran`, `pengaduan`, `transparansi`, `standar-pelayanan`, `kebijakan-privasi`, `umkm/katalog`, `gallery`, `peta-potensi`, `layar/[token]`, `offline`, `skm` (redirect). `me/*` = dasbor pengunjung (`reservasi`, `notifications`, `usaha`, `umkm`). `admin/*` = dasbor staf (`admin/layout.tsx` memasang Sidebar + AdminGuard; `admin/fo/*` = Front Office). `app/layout.tsx` = root (SW register, offline banner, toast).
- `src/app/api/` — route handler (`route.ts` + `*.test.ts` di sebelahnya; kebanyakan `force-dynamic`, validasi zod, service-role bila perlu): `admin/*` (staf), `chat/*`, `survei/*`, `saran`, `pengaduan`, `umkm-katalog/*`, `umkm-pemilik/*`, `investment-docs/*`, `investasi`, `storage/*` (R2), `absensi`, `me`, `auth`, `notif/*` (cron, `CRON_SECRET`), `health/*`.
- `src/components/` — `ui/` (komponen dasar), `layout/` (`AdminGuard`, `Sidebar`, `PageHeader`, `IsiHalaman`, `AppBar`, `SesiStafGuard`, ...), `admin/` (modal dan wizard staf: `PelayananWizardModal`, `SelesaiEskalasiModal`, `AbsensiWizardModal`, ...), folder domain `fo/`, `chat/`, `homepage/`, `survei/`, `umkm-katalog/`, `umkm-form/`, `umkm-pemilik/`, `umkm-perusahaan/`, `umkm/`; berkas akar = komponen lintas halaman (`WalkinWizard`, `EstimasiAntrean`, `Toast`, `OfflineBanner`, `ErrorRetry`, ...).
- `src/lib/` — infrastruktur: `data/`, `supabase/`, `env/`, `realtime/`, `hooks/`, `observability/`, `offline/`. Domain: `rekap/`, `chat/`, `llm/`, `pendataan-khusus/`, `akses-data/`, `fo/`, `homepage/`, `layanan/`, `layar/`, `survei/`, `pengaduan/`, `storage/`, `foto/`, `umkm-katalog/`, `umkm/`, `akun/`, `settings/`, `types/`. Berkas akar: `time.ts` (WIB), `constants.ts` (nama layanan & status; harus cocok seed DB), `utils.ts`, `pii.ts`, `csv.ts`, `admin-nav.ts`, `ikm.ts`, `gemini.ts`, `email-html.ts`, `site-settings.ts`, `jadwal-teks.ts`, `pelayanan.ts`.
- `src/styles/` — `token.css` (semua custom property), `globals.css` (aturan elemen), `tema-dasbor.css` (aturan dasbor). `src/test/` — setup, test konfigurasi (CSP, service worker, vitest), pagar anggaran, penjaga token. Akar `src/`: `proxy.ts`, `instrumentation.ts` (validasi env + `onRequestError`).
- Di luar `src/`: `supabase/migrations/` (SQL + test kontrak), `scripts/` (alat DB; `lokal-rantai/` = harness PGlite), `public/` (`sw.js`, `sw-push.js`), `next.config.ts` (CSP, pengalihan alamat), `docs/`.

## Peta database

Kelompok tabel utama (daftar lama yang lebih lengkap: [docs/fase/peta-kode-rinci.md](docs/fase/peta-kode-rinci.md)). Nama tepat bisa berubah: cek `grep -l <nama> supabase/migrations/*.sql` atau `scripts/introspect-schema.mjs`.
- Pelayanan: `layanan` (+ `instansi`, `layanan_tautan`), `jadwal_standby` + `hari_libur`, `kunjungan` (data induk), `tiket_antrean` + `antrean_counter`, `penanganan`, `pelayanan_{oss,perizinan}`, `topik_penanganan`, `pendataan_khusus_*`, `absensi_petugas`, `petugas` (+ penanda `koordinator`), `layar_token`, `panggilan_layar`; `visit` = arsip. Lihat [Fase 1](docs/fase/fase-1-layanan-dinamis.md), [Fase 3](docs/fase/fase-3-koordinator-rekap.md), [Fase 4](docs/fase/fase-4-pendataan.md), [identitas](docs/fase/identitas.md), [absensi FO](docs/fase/absensi-fo.md).
- Chat/AI: `chat_sesi`, `chat_pesan`, `chat_ai_log`, `faq_knowledge_base`, `faq_sinonim`, `dokumen_peraturan`, `dokumen_potongan` ([Fase 5](docs/fase/fase-5-live-chat.md)).
- Masukan: `survei_undangan`, `skm_respons`, `spak_respons`, `saran`, `pengaduan` (+ `pengaduan_riwayat`) ([pesan-perilaku](docs/fase/pesan-perilaku.md)).
- UMKM/investasi: katalog `umkm_*` (privat, diakses lewat RPC); tabel marketplace lama (`listing_umkm`, `umkm_inquiry`, `umkm_listing_owner`, `umkm_verifikasi_jejak`) tinggal data; `investment_documents`, `investasi_lead` ([umkm](docs/fase/umkm.md)).
- Lain: `homepage_blok`, `site_settings`, `notifikasi`, `push_subscriptions`, `audit_log`, `consent_log`, `error_log`, `anon_rate_limit`. Fungsi kunci: Auth Hook `set_user_role_claim`; helper RLS `get_my_role`/`is_ptsp_staff`/`peran_saya`/`sesi_valid`/`boleh_*`; nomor antrean `terbit_tiket`/`generate_nomor_tiket`; RAG `match_faq`/`match_dokumen`. Job `pg_cron` (notifikasi, alpa otomatis, no-show, akhir hari, retensi); `vercel.json` kosong — penjadwalan ada di DB.

## Database & migrasi

- `supabase/migrations/`: 5 baseline `202607140001–5` **immutable**; perubahan = file forward-migration baru bertimestamp lebih besar (format `YYYYMMDDNNNN_nama.sql`), dengan test statis di sebelahnya. Jangan edit/rename/squash yang sudah ada.
- Jangan paste SQL ke Dashboard. Terapkan satu migrasi ke DB: `node scripts/apply-migration.mjs supabase/migrations/<file>.sql` (membaca `.env.local`, **menyentuh DB produksi** → konfirmasi CEO dulu). `supabase db push --include-all --include-seed` hanya untuk project kosong (`docs/MIGRATIONS.md`).
- `supabase/seed.sql` aman produksi; `seed-demo.sql` DEV/STAGING saja.
- `scripts/`: `selftest-wpNN.mjs`/`verify-wpNN.mjs` = verifikasi per work package terhadap DB; `seed-faq*.mjs`, `introspect-schema.mjs`, `backfill-investment-pdf.ts`.
- Penerapan terbaru juga lewat `doppler run --project lmh --config prd -- node scripts/terapkan-migrasi-berurutan.mjs --dry-run --berkas <f...>` lalu `--terapkan` (`docs/MIGRATIONS.md`): sama-sama **menyentuh DB produksi**, tunduk pada "Batas keras" di atas. Staging belum ada; bukti perilaku lokal = harness PGlite `scripts/lokal-rantai/` (`npm i --no-save @electric-sql/pglite`, skenario `node scripts/lokal-rantai/skenario-*.mjs`, batas di README-nya).
- **Status penerapan**: sumbernya `docs/MIGRATIONS.md`, tetapi sebagian judul "BELUM DITERAPKAN" di sana tertinggal (contoh: survei `202611020001` pasti sudah di produksi, karena `202611030001`/`0003` yang DITERAPKAN 2026-10-28 menjaganya sebagai prasyarat). Tercatat pasti di produksi: `202610140001`-`0015` tanpa `0010` (Oktober; `docs/STATUS.md`, `docs/analysis/DB-CHANGES.md`), `202611030001`-`0003` dan `0007`, UMKM `202611090001`-`0012` (2026-11-09) dan `202611100001`-`0003` (2026-11-10), G2 `202611110002_nav_lencana` dan `202611110003_umkm_cari_indeks`. Selain itu periksa dulu (baca-saja, oleh PM) sebelum mengandalkan statusnya.

## Catatan per fase dan domain (`docs/fase/`)

Dipindah utuh dari versi lama berkas ini; tiap berkas diakhiri catatan refaktor/pemeriksaan 2026-11-13 bila kodenya berubah.
- [Fase 1 Layanan dinamis](docs/fase/fase-1-layanan-dinamis.md): Instansi, website terkait, arsip layanan, jadwal tunggal.
- [Fase 2 Homepage etalase](docs/fase/fase-2-homepage.md): blok `homepage_blok`, kartu layanan otomatis, popup `/?layanan=<slug>`.
- [Fase 3 Koordinator & Rekap terpadu](docs/fase/fase-3-koordinator-rekap.md): penanda Koordinator, lingkup data per orang (RLS `boleh_*`), `admin/rekap`, harness PGlite.
- [Fase 4 Pendataan](docs/fase/fase-4-pendataan.md): Pendataan Umum (topik) dan Pendataan Khusus per Layanan.
- [Fase 5 Live chat](docs/fase/fase-5-live-chat.md): satu percakapan per Layanan, bot di luar jam, minta petugas.
- [Fase 6 Cari pengunjung lama](docs/fase/fase-6-cari-pengunjung.md): saran Nama/HP di walk-in FO.
- [Identitas satu kesatuan](docs/fase/identitas.md): `kunjungan` data induk, email nyata wajib saat layanan selesai.
- [Storage R2](docs/fase/storage-r2.md), [Absensi FO](docs/fase/absensi-fo.md), [Pesan Perilaku](docs/fase/pesan-perilaku.md) (survei SPAK/SKM, IKM, saran, pengaduan).
- [UMKM](docs/fase/umkm.md): Katalog UMKM dan sisa marketplace lama.
- [Peta kode rinci](docs/fase/peta-kode-rinci.md): daftar lama per halaman, API, `lib/`, komponen, dan tabel.

## Dokumen rujukan cepat

[docs/STATUS.md](docs/STATUS.md) (status WP-01…32), [docs/DECISION_LOG.md](docs/DECISION_LOG.md), [docs/MIGRATIONS.md](docs/MIGRATIONS.md), [docs/DEPLOY_RUNBOOK.md](docs/DEPLOY_RUNBOOK.md), [docs/ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md), [docs/TESTING.md](docs/TESTING.md), [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md), [docs/analysis/04-RBAC-MATRIX.md](docs/analysis/04-RBAC-MATRIX.md) (matriks hak akses; juga `04-RBAC-MATRIX-PENDATAAN-PELAYANAN.md`), `docs/superpowers/{specs,plans}` (spesifikasi/rencana fitur), [GLOSSARY.md](GLOSSARY.md) (istilah domain), [docs/adr/](docs/adr/) (keputusan arsitektur), refaktor: [rencana](docs/superpowers/plans/2026-11-11-refaktor-arsitektur-ui.md) + [handover](docs/superpowers/HANDOVER-2026-11-13-refaktor.md). `.superpowers/sdd/progress.md` melacak pekerjaan subagent-driven yang sedang berjalan. `docs/archive/` sudah tidak akurat.

## Agent skills

### Issue tracker

Tiket disimpan sebagai file markdown di `.scratch/<fitur>/`. Lihat `docs/agents/issue-tracker.md`.

### Triage labels

Lima status bawaan (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), ditulis di baris `Status:` tiap tiket. Lihat `docs/agents/triage-labels.md`.

### Domain docs

Satu konteks: `GLOSSARY.md` dan `docs/adr/` di akar repo. Lihat `docs/agents/domain.md`.
