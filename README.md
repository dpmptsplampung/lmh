# Lampung Maju Hub (LMH)

Portal pelayanan terpadu DPMPTSP Provinsi Lampung. Dibangun dengan Next.js 16
(App Router), React 19, TypeScript, dan Supabase. Bahasa antarmuka dan komentar
kode: Indonesia.

## Fitur Utama

| Area | Fitur |
|---|---|
| **Pelayanan** | Pendaftaran walk-in oleh Front Office, scan QR, reservasi, antrean dengan penomoran atomik di database ("Visit Spine": `kunjungan` + `tiket_antrean`), layar TV antrean bertoken (`/layar/[token]`), absensi petugas |
| **Chat** | Live chat pengunjung dan petugas (satu percakapan per Layanan) dengan asisten AI ber-RAG (FAQ dan dokumen peraturan, pgvector) serta eskalasi ke petugas |
| **Rekap** | Rekap terpadu per lingkup pengguna (harian, Helpdesk OSS, Non OSS, data pelayanan dengan unduhan Excel, kinerja petugas) |
| **Pesan Perilaku** | Survei publik bertoken (SPAK dan SKM), agregasi IKM, saran dan pengaduan, laporan cetak, transparansi IKM publik |
| **UMKM** | Katalog UMKM publik dan alat kurasi/pengawasan di admin |
| **Investasi** | Gallery dokumen investasi (PDF dirender menjadi PNG ber-watermark), peta potensi, funnel lead investor |
| **Etalase** | Beranda berbasis blok yang diatur admin, kartu Layanan otomatis, Layanan dan Instansi dinamis |
| **Notifikasi** | Email (Resend) dan web-push (VAPID), terpicu dari trigger database dan cron |
| **Tata kelola** | Audit log, consent log, anonimisasi terjadwal, kebijakan PDP |
| **PWA** | Dapat dipasang, antrean offline untuk pendaftaran walk-in Front Office dengan replay |

Tiga role: `admin`, `petugas`, `front_office`. Akses halaman admin per role
terdaftar di satu tempat: `src/lib/admin-nav.ts`.

## Tumpukan Teknologi

- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, CSS Modules dengan custom properties (tanpa Tailwind)
- **Backend**: Supabase (PostgreSQL, Auth, Storage, Realtime) dan Route Handlers Next.js. Logika bisnis penting hidup di Postgres (RLS, trigger, RPC, pg_cron)
- **AI**: rantai LLM multi-vendor dengan circuit breaker dan kuota harian di `src/lib/llm/registry.ts` (diatur env `LLM_CHAT_PROVIDERS`, format `provider:model,...`); embedding dan prompt RAG di `src/lib/gemini.ts`; penyimpanan vektor pgvector
- **Penyimpanan berkas**: Supabase Storage dan Cloudflare R2 (`src/lib/storage/`, dipakai absensi Front Office; sisanya bertahap)
- **Email dan push**: Resend, web-push (VAPID)
- **Pengujian**: Vitest, Testing Library, jsdom, fake-indexeddb
- **Deploy**: Vercel (penjadwalan ada di database lewat pg_cron, bukan `vercel.json`)
- **Runtime**: Node >= 22

Versi pasti ada di `package.json`.

## Mulai Cepat (Pengembangan)

```bash
npm install
cp .env.example .env.local   # lalu isi nilai sesuai docs/ENVIRONMENT_VARIABLES.md
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000). Daftar variabel lingkungan
dan artinya: `docs/ENVIRONMENT_VARIABLES.md`. Env divalidasi saat start
(`src/instrumentation.ts`); nilai placeholder ditolak.

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Build produksi |
| `npm run start` | Menjalankan hasil build |
| `npm run lint` | ESLint (`--max-warnings=0`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Seluruh test Vitest (`--pool=vmForks`) |
| `npm run test:watch` | Vitest mode watch |
| `npm run test:coverage` | Vitest dengan coverage v8 (dipakai CI; ambang sekitar 35/25/28/33) |
| `npm run smoke` | Smoke `GET /api/health/live` (butuh `BASE_URL`) |
| `npm run deps:check` | Memastikan versi paket kunci di `node_modules` sama dengan `package-lock.json` |
| `npm run audit:check` | Gerbang audit dependensi lokal (advisory berat; pengecualian beralasan di `audit-allow.json`) |
| `npm run verify:baseline` | `deps:check` + `audit:check` + lint + typecheck + test + build; gate sebelum selesai atau push |
| `npm run test:rls`, `npm run test:rls:tahap0` | Tes RLS perilaku. **Menyambung ke database yang diatur `.env.local` (produksi); jalankan hanya dengan persetujuan** |

Menjalankan satu file test: `npx vitest run --pool=vmForks src/lib/time.test.ts`.

```bash
BASE_URL=http://localhost:3000 npm run smoke
```

Detail strategi pengujian: `docs/TESTING.md`.

## Struktur Direktori

```
src/
  app/               # Halaman (App Router) dan Route Handlers
    admin/           # Dasbor Admin/Petugas/Front Office (akses per role di lib/admin-nav.ts)
    api/             # Route Handlers (chat, rekap, survei, notif, health, ...)
    chat/ checkin/ gallery/ layar/ login/ me/ pengaduan/ peta-potensi/
    saran/ standar-pelayanan/ survei/ transparansi/ umkm/ ...
  components/
    ui/              # Komponen bersama (Kartu, Tombol, Tabel, Dialog, Field, ...)
    layout/          # Sidebar, AdminGuard, PageHeader, IsiHalaman
    admin/ fo/ chat/ homepage/ survei/ umkm-*/   # Komponen per domain
  lib/
    data/            # Lapisan data: akses Supabase terpusat (antrean, referensi, publik)
    llm/             # Rantai LLM multi-vendor, profil Layanan untuk bot
    supabase/        # Klien browser, server, dan service-role (server-only)
    storage/         # Cloudflare R2 (presign, unggah)
    rekap/ survei/ chat/ offline/ env/ observability/ ...
    time.ts          # Semua "hari ini"/batas hari dalam WIB
    pii.ts csv.ts    # Output PII wajib lewat helper ini
  styles/            # globals.css dan token desain
  test/              # Setup Vitest dan test lintas-bagian (CSP, anggaran kode, tema, ...)
  proxy.ts           # Pengganti middleware di Next 16: sesi + penjaga /admin dan /me
supabase/
  migrations/        # Baseline 202607140001-5 (immutable) + migrasi maju; MANIFEST.json mencatat hash
  seed.sql           # Aman untuk produksi
  seed-demo.sql      # Hanya DEV/STAGING
docs/                # Dokumentasi, ADR, rencana, rollback SQL
public/              # Aset statis, manifest PWA, sw.js, sw-push.js
scripts/             # smoke, penerapan migrasi, harness lokal PGlite, skrip verifikasi
```

### Lapisan UI dan data (hasil refaktor arsitektur)

- **Komponen bersama**: `src/components/ui/` dengan kontrak pemakaian di
  `src/components/ui/README.md`. Warna dan ukuran memakai token tema
  (`var(--...)`), bukan nilai tertulis.
- **Lapisan data**: `src/lib/data/*` (`antrean`, `referensi`, `publik-server`,
  `chat-pengunjung`, dan `klien/` untuk sisi browser) memusatkan kueri Supabase
  agar halaman tidak mengulangnya.
- **Pagar anggaran kode**: `src/test/anggaran-kode.test.ts` dengan angka batas
  di `src/test/anggaran-kode.json` (warna tertulis, `z-index`, kueri langsung di
  `page.tsx`, ukuran halaman raksasa, dan sebagainya). Angka hanya boleh turun;
  bila turun, perbarui JSON ke angka baru.

## Basis Data dan Migrasi

- Baseline `202607140001`-`5` bersifat immutable. Perubahan = file migrasi baru
  (`YYYYMMDDNNNN_nama.sql`) dengan timestamp lebih besar, test kontrak di
  `supabase/migrations/*.test.ts`, entri `MANIFEST.json`, dan SQL rollback di `docs/`.
- Aturan lengkap: `docs/ATURAN_MIGRASI.md` dan `docs/MIGRATIONS.md`.
- Satu-satunya jalur ke produksi: `node scripts/apply-migration.mjs` (selalu
  `--dry-run` dulu, dengan konfirmasi pemilik). Jangan menempel SQL ke Dashboard.
  `supabase db push --include-all --include-seed` hanya untuk project kosong.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| `docs/STATUS.md` | Status terbaru pekerjaan (work package) |
| `docs/DECISION_LOG.md` | Log keputusan teknis |
| `docs/adr/` | Catatan keputusan arsitektur |
| `GLOSSARY.md` | Istilah domain |
| `docs/DEPLOY_RUNBOOK.md` | Runbook deploy |
| `docs/ENVIRONMENT_VARIABLES.md` | Variabel lingkungan (nama dan arti) |
| `docs/TESTING.md` | Strategi dan cakupan pengujian |
| `docs/MIGRATIONS.md`, `docs/ATURAN_MIGRASI.md` | Alur dan aturan migrasi |
| `docs/OBSERVABILITY.md` | Logging, error log, health check |
| `docs/PRODUCTION_READINESS.md` | Status kesiapan produksi |
| `docs/BACKUP_RESTORE.md` | Cadangan dan pemulihan |
| `docs/KEBIJAKAN_PDP.md`, `docs/KEBIJAKAN_AKUN_MITRA.md` | Perlindungan data pribadi dan model akun mitra individual |
| `docs/CHANGELOG.md` | Riwayat perubahan |
| `LMH-AGENT-SPEC.md` | Spesifikasi panjang proyek |
| `CLAUDE.md`, `AGENTS.md` | Peta kode dan aturan kerja untuk agent |
| `docs/superpowers/{specs,plans}` | Spesifikasi dan rencana fitur terbaru |
| `docs/archive/` | Arsip historis, tidak lagi akurat |

## Integrasi Berkelanjutan

`.github/workflows/ci.yml`: lint, typecheck, test dengan coverage, build, lalu
`npm audit`.

## Lisensi

Hak cipta DPMPTSP Provinsi Lampung.
