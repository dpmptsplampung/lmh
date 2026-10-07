# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

AGENTS.md di atas berisi aturan wajib (Next.js 16 punya breaking changes → baca `node_modules/next/dist/docs/` dulu, aturan GitHub (`gh`)/push, workflow skill). Bagian di bawah adalah peta kode agar tidak perlu membaca ulang seluruh project.

## Apa ini

Lampung Maju Hub (LMH) — portal pelayanan terpadu DPMPTSP Provinsi Lampung (bahasa UI & komentar kode: Indonesia). Next.js 16 App Router + React 19 + TypeScript, Supabase (Postgres/Auth/Storage/Realtime, RLS-heavy), CSS Modules (tanpa Tailwind), Vitest, deploy Vercel. Node >=22. Alias import `@/` → `src/`.
Catatan: `README.md` sebagian usang (mis. menyebut Gemini 1.5); sumber status terbaru: `docs/STATUS.md`, `docs/DECISION_LOG.md`, `LMH-AGENT-SPEC.md` (spesifikasi panjang, aturan 0.2).

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
**Domain (halaman di `src/app/*`, API di `src/app/api/*`)**
- Pelayanan/antrean: `checkin`, `admin/{kunjungan,scan,antrian,absensi}`, `layar/[token]` & `layar-antrian` (layar TV bertoken), `me/reservasi`. Model data "Visit Spine": tabel `kunjungan` + `tiket_antrean` (dual-write dari `visit` lama sampai WP-24 yang masih diblokir). Penomoran antrean atomik di DB (RPC/counter), absensi petugas jadi gerbang antrean, jadwal harian dibekukan. Helper: `src/lib/pelayanan.ts`, `lib/types/pelayanan.ts`, `lib/hooks/useRealtimeRefetch.ts` (Supabase Realtime), `components/{WalkinWizard,EstimasiAntrean}`, `components/admin/*Wizard*`.
- Chat & bot: `chat`, `admin/chat/*`, `api/chat/{ai,messages,sesi}`. `api/chat/ai/route.ts` = RAG (FAQ + `dokumen_peraturan` via pgvector 3072-dim & FTS) dengan `lib/gemini.ts`, rantai LLM multi-vendor + circuit breaker + kuota harian di `lib/llm/registry.ts` (env `LLM_CHAT_PROVIDERS` format `provider:model,...`), redaksi PII/deteksi prompt-injection di `lib/pii.ts`, eskalasi otomatis ke petugas. Embedding admin: `api/admin/{faq,dokumen}/embed`.
- Rekap harian: `admin/rekap`, `api/admin/rekap/*`, logika di `src/lib/rekap/` (query, rows, schemas zod, ExcelJS export). IKM/SKM: `skm`, `transparansi`, `lib/ikm.ts`. Pengaduan (`pengaduan`, `api/pengaduan`), `standar-pelayanan`, UMKM marketplace (`umkm`, `api/umkm`), investasi/gallery/`peta-potensi` (PDF di-render jadi PNG ber-watermark: `api/investment-docs/*`, `canvas`/`pdfjs-dist`/`sharp`), konten landing via CMS registry (`lib/site-settings.ts`).
- Notifikasi: trigger DB → `api/notif/{send,retry}` dipanggil cron (header `Authorization: Bearer $CRON_SECRET`); Resend (`lib/email-html.ts`) + web-push (`public/sw-push.js`). PWA offline: `public/sw.js`, `lib/offline/{queue,replay}.ts` (IndexedDB queue + replay check-in).
- Observability: `lib/observability/logger.ts` (`logServerEvent`), tabel error log, `api/health/{live,ready,error}`.

**Aturan lintas-bagian yang mudah terlewat**
- Semua "hari ini"/batas hari memakai **WIB** lewat `src/lib/time.ts` (`todayWIB()` dll.) — jangan `toISOString().split('T')[0]`.
- Logika bisnis penting hidup di Postgres (RLS, trigger, RPC, view, pg_cron), bukan hanya di route handler. Perubahan perilaku sering = migrasi baru + test kontrak di `supabase/migrations/*.test.ts`.
- CSP ketat diatur di `next.config.ts` (mis. `connect-src` pernah memblok `fetch(data:)`); fitur baru yang memanggil origin baru harus memperbarui CSP.
- Output PII: pakai helper di `lib/pii.ts`/`lib/csv.ts`; kebijakan di `docs/KEBIJAKAN_PDP.md`.

## Peta file lengkap (`src/`)

Pola umum: halaman (`page.tsx`) adalah **client component besar yang berisi logika + query Supabase langsung** (mis. `admin/umkm` ~1000 baris, `chat` ~980, `umkm` ~900, `admin/antrian` ~700). Style = `*.module.css` di sebelah halaman, token global di `styles/globals.css`. Komponen bersama sedikit; jarang ada hook/util khusus per halaman. `app/admin/layout.tsx` memasang Sidebar+AdminGuard; `app/me/layout.tsx` untuk dashboard pengunjung; `app/layout.tsx` root (SW register, offline banner, toast).

**Halaman publik/pengunjung** (`src/app/…/page.tsx`)
| Path | Fungsi | API/DB utama |
|---|---|---|
| `/` | landing (konten dari `landing_content`/`site_settings`) | `lib/site-settings` |
| `/login`, `/auth/callback` | login Google OAuth/magic-link/anon | Supabase Auth |
| `/checkin` | check-in walk-in + reservasi, QR | `api/checkin`, `WalkinWizard`, `lib/offline/*` |
| `/me`, `/me/reservasi`, `/me/notifications` | dashboard pengunjung | `kunjungan`, `notifikasi` |
| `/chat` | live chat + AI | `api/chat/{ai,messages,sesi}`, tabel `chat_*` |
| `/skm`, `/transparansi` | survei kepuasan, IKM publik | `api/skm/submit`, `lib/ikm`, `IkmPanel` |
| `/pengaduan`, `/pengaduan/lacak` | pengaduan 2 jalur + lacak | `api/pengaduan[/lacak]` |
| `/umkm`, `/umkm/inbox`, `/umkm/edit/[id]` | marketplace dua sisi, inquiry, edit via magic-link | `api/umkm/*`, `v_umkm_public/match` |
| `/gallery`, `/peta-potensi` | investment gallery (PDF→PNG watermark), peta potensi | `api/investment-docs/*`, `api/investasi/lead` |
| `/standar-pelayanan`, `/kebijakan-privasi`, `/offline` | statis/PWA fallback | — |
| `/layar/[token]`, `/layar-antrian` | layar TV antrean (token / legacy) | `v_layar_antrian`, `layar_token` |

**Admin** (`/admin/*`, akses per role di `lib/admin-nav.ts`): `/admin` dashboard · `kunjungan` · `scan` (QR) · `antrian` (panggil/selesai, `PelayananWizardModal`) · `absensi` · `chat` (+`faq`, `ai-log`) · `umkm` · `gallery` · `investasi-leads` · `skm` · `pengaduan` · `petugas` (+`invite`) · `rekap` · `dokumen` (RAG peraturan) · `layar` · `data-governance` · `settings` (+`jadwal`, `landing`).

**API route handlers** (`src/app/api/**/route.ts`, tiap route punya `*.test.ts` di sebelahnya; kebanyakan `force-dynamic`, validasi zod, service-role bila perlu):
- `admin/`: `dokumen/embed`, `faq/embed`, `layar`, `pelayanan/[tiketId]`, `pengaduan`, `petugas/{invite,status}`, `rekap/{export,layanan-options,rollup,tickets}`
- `chat/`: `ai` (RAG), `ai/draft` (draft balasan untuk petugas), `messages`, `sesi`
- publik: `checkin`, `skm/submit`, `pengaduan`, `pengaduan/lacak`, `umkm/{inquiry,inquiry/[id],request-edit-link}`, `investasi/lead[/id]`
- `investment-docs/`: `upload`, `[id]`, `page-image`, `public-view`, `signed-url`
- `notif/{send,retry}` (cron, `CRON_SECRET`) · `health/{live,ready,error}` (logika di `health.ts`)

**`src/lib/`** — `time.ts` (WIB) · `constants.ts` (nama layanan & status; nama layanan harus cocok seed DB) · `utils.ts` (format tanggal/durasi, `waLink`, `cn`) · `pelayanan.ts` + `types/pelayanan.ts` (tipe form pendataan OSS/perizinan, akses petugas) · `admin-nav.ts` · `ikm.ts` · `csv.ts` · `pii.ts` · `email-html.ts` · `site-settings.ts` · `gemini.ts` (embedding + prompt RAG) · `llm/registry.ts` · `chat/normalize.ts` · `hooks/useRealtimeRefetch.ts` · `offline/{queue,replay}.ts` · `observability/logger.ts` · `env/{server,client}.ts` · `supabase/{client,server,service}.ts` · `rekap/{query,rows,schemas,format,excel,exportAll}.ts`.

**`src/components/`** — `WalkinWizard`, `EstimasiAntrean`, `IkmPanel`, `QRCode`, `Toast`, `Pagination`, `OfflineBanner`, `ServiceWorkerRegister`, `ProfileCompletenessGate`; `admin/{AbsensiWizardModal,PelayananWizardModal,RekapLayananTable,RekapTiketDetailPanel}`; `layout/{AdminGuard,Sidebar,PageHeader}`.

**Root `src/`**: `proxy.ts` (middleware), `instrumentation.ts` (validasi env + `onRequestError`), `test/` (setup + test konfigurasi: CSP, service worker, vitest config). Test lintas-cutting lain: `layout.a11y.test.tsx`, `styles/globals.a11y.test.ts`, `chat.rls.test.tsx`, `consent.ownership.test.ts`.

## Peta database (Supabase/Postgres)

Dari 50-an migrasi di `supabase/migrations/` (urutan = nama file). Kelompok tabel:
- Pelayanan: `layanan`, `layanan_{jadwal,hari,libur,kontak}`, `jadwal_{harian_beku,pengecualian,standby}`, `hari_libur`, `kunjungan`, `tiket_antrean`, `antrean_counter`, `visit` (lama, dual-write), `buku_tamu`, `absensi_petugas`, `pelayanan_{oss,perizinan}`, `pengunjung`, `petugas`, `layar_token`, `rekap_harian_layanan`, `laporan_snapshot`
- Chat/AI: `chat_sesi`, `chat_pesan`, `chat_ai_log`, `faq_knowledge_base`, `faq_sinonim`, `dokumen_peraturan`, `dokumen_potongan`
- UMKM/investasi: `listing_umkm`, `umkm_inquiry`, `umkm_listing_owner`, `umkm_verifikasi_jejak`, `investment_documents`, `investasi_lead`, `jejak_minat_investasi`
- Lain: `skm_respons`, `skm_response_rate`, `pengaduan`, `pengaduan_riwayat`, `standar_pelayanan`, `notifikasi`, `push_subscriptions`, `landing_content`, `site_settings`, `konten_versi`, `audit_log`, `consent_log`, `error_log`, `anon_rate_limit`
- View: `v_antrian_loket`, `v_layar_antrian`, `v_rekap_pelayanan_{oss,perizinan}`, `v_umkm_public`, `v_umkm_match`
- RPC/fungsi kunci: `terbit_tiket`/`terbit_nomor_antrean`/`generate_nomor_tiket` (nomor antrean atomik), `panggil_tiket`, `finalize_pelayanan`, `catat_absensi`/`catat_pulang`, `check_anon_rate`, `match_faq`/`match_faq_teks`/`match_dokumen` (RAG), `submit_skm_response`/`hitung_ikm`, `buat_pengaduan`/`lacak_pengaduan`, `rollup_rekap_harian`, `validate_layar_token`, `set_user_role_claim` (Auth Hook), `get_my_role`/`is_ptsp_staff` (helper RLS), `queue_notifikasi`/`claim_notifikasi`.
- Job `pg_cron`: `notif_h0_pagi`, `notif_h1_sore`, `notif_eskalasi` + job otomatis lain (alpa otomatis, no-show reservasi, akhir hari, prune, anonimisasi). `vercel.json` kosong — penjadwalan ada di DB.
- Daftar tepat bisa berubah: cek `grep -l <nama> supabase/migrations/*.sql` atau `scripts/introspect-schema.mjs` sebelum mengandalkan daftar ini.

## Database & migrasi

- `supabase/migrations/`: 5 baseline `202607140001–5` **immutable**; perubahan = file forward-migration baru bertimestamp lebih besar (format `YYYYMMDDNNNN_nama.sql`), dengan test statis di sebelahnya. Jangan edit/rename/squash yang sudah ada.
- Jangan paste SQL ke Dashboard. Terapkan satu migrasi ke DB: `node scripts/apply-migration.mjs supabase/migrations/<file>.sql` (membaca `.env.local`, **menyentuh DB produksi** → konfirmasi CEO dulu). `supabase db push --include-all --include-seed` hanya untuk project kosong (`docs/MIGRATIONS.md`).
- `supabase/seed.sql` aman produksi; `seed-demo.sql` DEV/STAGING saja.
- `scripts/`: `selftest-wpNN.mjs`/`verify-wpNN.mjs` = verifikasi per work package terhadap DB; `seed-faq*.mjs`, `introspect-schema.mjs`, `backfill-investment-pdf.ts`.

## Dokumen rujukan cepat

`docs/STATUS.md` (status WP-01…32), `docs/DECISION_LOG.md`, `docs/DEPLOY_RUNBOOK.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/TESTING.md`, `docs/OBSERVABILITY.md`, `docs/analysis/04-RBAC-MATRIX*.md` (matriks hak akses), `docs/superpowers/{specs,plans}` (spesifikasi/rencana fitur terbaru). `.superpowers/sdd/progress.md` melacak pekerjaan subagent-driven yang sedang berjalan. `docs/archive/` sudah tidak akurat.
