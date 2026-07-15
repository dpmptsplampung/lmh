# Lampung Maju Hub (LMH)

Portal pelayanan terpadu DPMPTSP Provinsi Lampung. Dibangun dengan Next.js 16
(App Router) + Supabase + TypeScript.

## Fitur Utama

| Area | Fitur |
|---|---|
| **Pelayanan** | Check-in walk-in & reservasi (Visit Spine terpadu), scan QR, antrean pintar dengan estimasi real-time |
| **Chat** | Live chat pengunjung ↔ petugas, asisten AI ber-RAG (Gemini + pgvector) dengan eskalasi otomatis |
| **SKM** | Survei Kepuasan Masyarakat digital (9 unsur PermenPANRB 14/2017), agregasi IKM, dashboard pimpinan, transparansi publik |
| **UMKM** | Marketplace dua sisi (kebutuhan/penawaran), matchmaking otomatis, inquiry termoderasi, edit via magic-link |
| **Investasi** | Gallery dokumen investasi (view-only watermarked PDF), funnel lead investor |
| **Notifikasi** | Email (Resend) + web-push (VAPID), terpicu dari trigger DB |
| **Tata Kelola** | Audit log, consent log, anonymisasi pg_cron, dashboard DPO |
| **PWA** | Offline-first (checkin queue + background sync), installable, WCAG 2.1 AA |

## Tech Stack

- **Frontend**: Next.js 16.2.10 (App Router), React 19, CSS Modules + custom properties (no Tailwind)
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime), Next.js Route Handlers
- **AI**: Google Gemini 1.5 Flash + text-embedding-004 + pgvector
- **Email**: Resend
- **Web Push**: web-push (VAPID)
- **Testing**: Vitest + jsdom + fake-indexeddb
- **Deployment**: Vercel

## Quick Start (Development)

```bash
# 1. Install dependencies
npm install

# 2. Copy env vars
cp .env.example .env.local
# Edit .env.local dengan nilai Supabase Anda

# 3. Jalankan dev server
npm run dev
```

Buka [http://localhost:3000](http://localhost:3000).

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run start` | Jalankan production build |
| `npm run lint` | ESLint (max-warnings=0) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (run once) |
| `npm run test:watch` | Vitest (watch mode) |
| `npm run test:coverage` | Vitest + v8 coverage |
| `npm run smoke` | Health smoke (`BASE_URL` required for network) |
| `npm run verify:baseline` | lint + typecheck + test + build |

## Struktur Folder

```
src/
  app/
    admin/          # Dashboard petugas (12 sub-pages)
    api/            # Route Handlers (17 endpoints)
    auth/           # Callback Google OAuth
    chat/           # Live chat publik + AI
    checkin/        # Check-in walk-in
    gallery/        # Investment Gallery
    login/          # Halaman login
    me/             # Dashboard pengunjung (reservasi, notifikasi)
    offline/        # Fallback page PWA
    skm/            # Form SKM publik
    transparansi/   # IKM publik
    umkm/           # Marketplace UMKM + inbox + edit
  components/       # Shared components
  lib/
    offline/        # IndexedDB queue + replay
    supabase/       # Server & client helpers
  styles/           # globals.css + design tokens
  proxy.ts          # Middleware (auth + role guard)
supabase/
  config.toml       # Minimal CLI skeleton (project_id placeholder)
  migrations/       # 5 final-state baseline migrations only:
                    #   202607140001_extensions_and_preflight.sql
                    #   202607140002_core_schema.sql
                    #   202607140003_feature_schema.sql
                    #   202607140004_security_and_automation.sql
                    #   202607140005_views_and_jobs.sql
  seed.sql          # Production-safe reference/config (via --include-seed)
  seed-demo.sql     # Data demo (DEV/STAGING ONLY — never production)
docs/               # Dokumentasi
public/             # Static assets (logo, sw.js, manifest.json)
scripts/            # smoke.mjs, backfill PDF, etc.
```

Apply empty project schema:

```bash
supabase db push --include-all --include-seed
```

See `docs/MIGRATIONS.md`. Do **not** paste historical `001`–`038` SQL.

## Dokumentasi

| Dokumen | Isi |
|---|---|
| `docs/DEPLOY_RUNBOOK.md` | Deploy: env, Dashboard, 5 baselines, health, Resend, privacy |
| `docs/PRODUCTION_READINESS.md` | Honest gate status + residual human/staging work |
| `docs/TESTING.md` | CI unit/contract tests; residual E2E/Docker |
| `docs/BACKUP_RESTORE.md` | Backup before migrate; RPO/RTO TBD |
| `docs/KEBIJAKAN_PDP.md` | Kebijakan perlindungan data pribadi (retensi, consent, DPO) |
| `docs/KEBIJAKAN_AKUN_MITRA.md` | Model akun mitra individual (bukan shared) |
| `docs/MIGRATIONS.md` | Baseline database, aturan seed, dan alur migrasi |
| `docs/CHANGELOG.md` | Riwayat perubahan per versi |
| `docs/DECISION_LOG.md` | Log keputusan teknis di setiap gate |
| `docs/AUDIT_DAN_ROADMAP_INOVASI.md` | Audit LMH 1.0 + roadmap inovasi LMH 2.0 |

## Testing

```bash
npm test              # Vitest unit + contract (incl. migration static tests)
npm run test:coverage # Coverage report (v8, soft 40% thresholds)
npm run typecheck
npm run lint
npm run build
BASE_URL=http://localhost:3000 npm run smoke   # /api/health/live
```

Details: `docs/TESTING.md`.

## Lisensi

Hak cipta DPMPTSP Provinsi Lampung.
