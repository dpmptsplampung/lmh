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
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest (run once) |
| `npm run test:watch` | Vitest (watch mode) |

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
  migrations/       # 38 SQL migrations (001-038)
  seed-demo.sql     # Data demo (DEV ONLY)
docs/               # Dokumentasi
public/             # Static assets (logo, sw.js, manifest.json)
scripts/            # One-off scripts (backfill PDF)
```

## Dokumentasi

| Dokumen | Isi |
|---|---|
| `docs/DEPLOY_RUNBOOK.md` | Checklist deploy production (env vars, Dashboard config, migration order, smoke test) |
| `docs/PRODUCTION_READINESS.md` | Status produksi: apa yang sudah ada, apa yang belum, langkah selanjutnya |
| `docs/KEBIJAKAN_PDP.md` | Kebijakan perlindungan data pribadi (retensi, consent, DPO) |
| `docs/KEBIJAKAN_AKUN_MITRA.md` | Model akun mitra individual (bukan shared) |
| `docs/CHANGELOG.md` | Riwayat perubahan per versi |
| `docs/DECISION_LOG.md` | Log keputusan teknis di setiap gate |
| `docs/AUDIT_DAN_ROADMAP_INOVASI.md` | Audit LMH 1.0 + roadmap inovasi LMH 2.0 |

## Testing

```bash
npm test            # 467 tests, 41 files
npm run typecheck   # tsc --noEmit
npm run lint        # ESLint
npm run build       # Next.js build
```

## Lisensi

Hak cipta DPMPTSP Provinsi Lampung.
