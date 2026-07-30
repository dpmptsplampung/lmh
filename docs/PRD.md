# Product Requirement Document (PRD)

## Project: Lampung Maju Hub (LMH)

| Meta | Value |
|---|---|
| **Document Version** | 2.1 — Comprehensive Codebase Reference |
| **Author** | Senior System Analyst |
| **Owner** | DPMPTSP Provinsi Lampung |
| **Target Audience** | AI Agents, Engineering Team, External Auditors |
| **App Version** | 2.1.0 (`package.json`) |
| **Framework** | Next.js 16.2.10 (App Router) + React 19.2.4 |
| **Backend** | Supabase (PostgreSQL + Auth + Storage + Realtime) |
| **Deployment** | Vercel |
| **Language** | TypeScript 5+ (strict) |
| **Node.js** | >= 22 |

---

## 1. Executive Summary

**Lampung Maju Hub (LMH)** adalah portal pelayanan publik terpadu milik **DPMPTSP (Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu) Provinsi Lampung**. Platform ini menggabungkan:

1. **Visit Spine** — Walk-in check-in & reservasi online dengan antrean pintar dan estimasi waktu real-time.
2. **Live Chat + AI RAG** — Virtual assistant berbasis Gemini 1.5 Flash + pgvector dengan eskalasi otomatis ke petugas.
3. **SKM (Survei Kepuasan Masyarakat)** — 9 unsur PermenPANRB 14/2017 dengan agregasi IKM otomatis dan transparansi publik.
4. **Marketplace UMKM** — Dua sisi (kebutuhan/penawaran) dengan matchmaking otomatis, inquiry termoderasi, dan edit via magic-link.
5. **Investment Gallery** — Watermarked PDF viewer + funnel lead investor.
6. **Notification Engine** — Email (Resend) + Web Push (VAPID) dipicu dari trigger database.
7. **Data Governance (PDP)** — Audit log imutabel, consent log, anonimisasi otomatis pg_cron.
8. **PWA Offline-First** — IndexedDB queue + background sync, installable, WCAG 2.1 AA.

---

## 2. Technical Stack — Dependency Map

### 2.1. Production Dependencies (`dependencies`)

| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.10 | App Router SSR/RSC framework |
| `react` / `react-dom` | 19.2.4 | UI library |
| `@supabase/supabase-js` | ^2.110.0 | Supabase client SDK |
| `@supabase/ssr` | ^0.12.0 | Cookie-based SSR auth helper |
| `@google/generative-ai` | ^0.24.1 | Gemini API (chat + embedding) |
| `@chatscope/chat-ui-kit-react` | ^2.1.1 | Chat UI components |
| `@chatscope/chat-ui-kit-styles` | ^1.4.0 | Chat styling |
| `recharts` | ^3.9.2 | Dashboard charts (SKM, kunjungan) |
| `lucide-react` | ^1.23.0 | Icon library |
| `zod` | ^4.4.3 | Runtime schema validation (API routes) |
| `resend` | ^6.17.2 | Transactional email delivery |
| `web-push` | ^3.6.7 | VAPID Web Push notifications |
| `pdfjs-dist` | ^6.1.200 | PDF rendering (Investment Gallery) |
| `canvas` | ^3.2.3 | Server-side PDF page rendering |
| `sharp` | ^0.35.3 | Image optimization |
| `qrcode` | ^1.5.4 | QR code generation (server) |
| `html5-qrcode` | ^2.3.8 | QR code scanner (camera) |

### 2.2. Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `vitest` | ^4.1.10 | Test runner |
| `@vitest/coverage-v8` | ^4.1.10 | Coverage (v8 engine) |
| `@testing-library/react` | ^16.3.2 | React component testing |
| `@testing-library/jest-dom` | ^6.9.1 | DOM assertions |
| `jsdom` | ^29.1.1 | Browser DOM simulator |
| `fake-indexeddb` | ^6.2.5 | IndexedDB mock for offline tests |
| `eslint` + `eslint-config-next` | 16.2.10 | Linting (max-warnings=0) |
| `typescript` | ^5 | Static type checking |

### 2.3. External Services

| Service | Used For | Env Key |
|---|---|---|
| **Supabase** | Database, Auth (Google OAuth + email magic-link), Storage, Realtime WebSocket | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| **Google Gemini** | RAG chatbot (generative) + embedding (768-dim) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL` |
| **Resend** | Email delivery (invitation, notification, magic-link) | `RESEND_API_KEY`, `RESEND_FROM` |
| **VAPID (Web Push)** | Browser push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY` |
| **Vercel** | Deployment + Cron jobs (`/api/notif/send`, `/api/notif/retry`) | `CRON_SECRET` |

---

## 3. Folder Structure — Complete Source Map

```
d:\Project\LMH\
├── .env.example                    # Template env vars (30 vars)
├── .env.local                      # Local env (gitignored)
├── next.config.ts                  # Next.js config (CSP, image domains, security headers)
├── vercel.json                     # Vercel cron: /api/notif/send (*/2), /api/notif/retry (*/5)
├── package.json                    # v2.1.0, node>=22
├── tsconfig.json                   # Strict TS config
├── vitest.config.ts                # Vitest + jsdom + fake-indexeddb
├── eslint.config.mjs               # ESLint flat config (max-warnings=0)
│
├── public/
│   ├── logo.png                    # DPMPTSP logo
│   ├── logo_foila.webp             # FOILA partner logo
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service Worker (cache + offline)
│   └── sw-push.js                  # Push notification Service Worker
│
├── supabase/
│   ├── config.toml                 # Supabase CLI skeleton
│   ├── seed.sql                    # Production-safe reference/config data
│   ├── seed-demo.sql               # Demo data (DEV/STAGING only)
│   └── migrations/
│       ├── 202607140001_extensions_and_preflight.sql   # pgcrypto, vector, pg_cron
│       ├── 202607140002_core_schema.sql                # layanan, petugas, pengunjung, visit, absensi, site_settings, landing_content
│       ├── 202607140003_feature_schema.sql             # chat, faq, umkm, investment, skm, notifikasi, push, audit, consent, rate_limit
│       ├── 202607140004_security_and_automation.sql    # RLS, functions, triggers, storage buckets
│       ├── 202607140005_views_and_jobs.sql             # views, materialized views, pg_cron jobs
│       ├── 202607200001_p0_security_governance.sql     # Security hardening incremental
│       ├── 202607210001_walkin_kontak_dan_layanan_perizinan.sql
│       ├── 202607240001_pengunjung_no_hp.sql
│       ├── 202607280001_layanan_jadwal.sql             # Jadwal operasional & kuota
│       ├── 202607280002_chat_pesan_owner_strict.sql
│       ├── 202607280003_faq_petugas_scope.sql
│       ├── 202607280004_chat_pesan_client_uuid.sql
│       ├── 202607280005_antrian_hari_ini.sql
│       └── *.test.ts (20 migration-level tests)
│
├── docs/
│   ├── PRD.md                      # <-- Dokumen ini
│   ├── CHANGELOG.md
│   ├── DEPLOY_RUNBOOK.md
│   ├── PRODUCTION_READINESS.md
│   ├── TESTING.md
│   ├── MIGRATIONS.md
│   ├── KEBIJAKAN_AKUN_MITRA.md
│   ├── KEBIJAKAN_PDP.md
│   ├── DECISION_LOG.md
│   ├── ENVIRONMENT_VARIABLES.md
│   ├── OBSERVABILITY.md
│   ├── BACKUP_RESTORE.md
│   └── AUDIT_DAN_ROADMAP_INOVASI.md
│
├── scripts/
│   └── smoke.mjs                   # Health check smoke test
│
└── src/
    ├── proxy.ts                    # Next.js middleware (auth + role guard)
    ├── instrumentation.ts          # Next.js instrumentation hook
    │
    ├── styles/
    │   └── globals.css             # 20KB — design tokens + utility classes + base components
    │
    ├── lib/
    │   ├── constants.ts            # APP_NAME, APP_DESCRIPTION, LAYANAN, STATUS_*, KATEGORI_*, ROLES
    │   ├── admin-nav.ts            # ADMIN_NAV[] — single source of truth for sidebar + route guard
    │   ├── gemini.ts               # Gemini client factory, system prompt, RAG context builder
    │   ├── pii.ts                  # PII redaction + prompt injection detection
    │   ├── ikm.ts                  # IKM calculation helper
    │   ├── utils.ts                # Shared utility functions
    │   ├── email-html.ts           # Email HTML template builder
    │   ├── site-settings.ts        # site_settings reader with fallback defaults
    │   ├── env/                    # Environment variable helpers
    │   ├── observability/
    │   │   └── logger.ts           # Structured JSON logger with PII sanitization
    │   ├── offline/
    │   │   ├── queue.ts            # IndexedDB offline action queue (enqueue, getPending, markSynced, clearQueue)
    │   │   └── replay.ts           # Replay queued actions when back online
    │   └── supabase/
    │       ├── server.ts           # createServerClient (cookie-based SSR)
    │       └── client.ts           # createBrowserClient (client components)
    │
    ├── components/
    │   ├── layout/
    │   │   ├── Sidebar.tsx         # Admin sidebar navigation (role-filtered via ADMIN_NAV)
    │   │   ├── AdminGuard.tsx      # Client-side role guard (canAccessAdminPath)
    │   │   ├── PageHeader.tsx      # Reusable page header with title + description
    │   │   └── PageHeader.module.css / Sidebar.module.css
    │   ├── EstimasiAntrean.tsx     # Queue estimation display component
    │   ├── IkmPanel.tsx            # IKM score display panel
    │   ├── OfflineBanner.tsx       # "Anda offline" banner
    │   ├── Pagination.tsx          # Generic pagination component
    │   ├── ProfileCompletenessGate.tsx # Profile completion gate (13KB — multi-step wizard)
    │   ├── QRCode.tsx              # QR code display wrapper
    │   ├── ServiceWorkerRegister.tsx # SW registration on mount
    │   ├── Toast.tsx               # Toast notification system (ToastProvider + useToast)
    │   └── WalkinWizard.tsx        # Walk-in check-in wizard (14KB — multi-step form)
    │
    ├── test/                       # Test utilities
    │
    └── app/                        # Next.js App Router pages
        ├── layout.tsx              # Root layout (Inter + Plus Jakarta Sans fonts, ToastProvider, OfflineBanner, ServiceWorkerRegister)
        ├── page.tsx                # Landing page (18.5KB — hero, fitur, layanan, kontak)
        ├── loading.tsx             # Global loading fallback
        ├── error.tsx               # Global error boundary
        ├── not-found.tsx           # 404 page
        ├── landing.module.css      # Landing page styles (10KB)
        │
        ├── login/
        │   ├── page.tsx            # Login page (Google OAuth + email magic-link)
        │   └── login.module.css
        │
        ├── auth/
        │   └── callback/           # OAuth callback handler
        │
        ├── checkin/
        │   ├── page.tsx            # Walk-in check-in form (16KB — WalkinWizard integration)
        │   └── checkin.module.css
        │
        ├── chat/
        │   ├── page.tsx            # Public chat page (37.5KB — RAG AI + Realtime + escalation)
        │   └── chat.module.css
        │
        ├── skm/
        │   ├── page.tsx            # SKM survey form (9 unsur, token-gated)
        │   └── skm.module.css
        │
        ├── umkm/
        │   ├── page.tsx            # UMKM marketplace (36KB — catalog, filter, matchmaking)
        │   ├── umkm.module.css
        │   ├── edit/               # UMKM listing edit (magic-link authenticated)
        │   └── inbox/              # UMKM inquiry inbox
        │
        ├── gallery/
        │   ├── page.tsx            # Investment Gallery (24KB — PDF viewer, lead form)
        │   └── gallery.module.css
        │
        ├── transparansi/
        │   ├── page.tsx            # Public IKM transparency dashboard
        │   └── transparansi.module.css
        │
        ├── me/
        │   ├── layout.tsx          # Citizen dashboard layout
        │   ├── page.tsx            # Citizen dashboard (16.5KB — aktif visits, riwayat, QR code)
        │   ├── me.module.css
        │   ├── reservasi/          # Online reservation flow
        │   └── notifications/      # Notification settings (VAPID push subscription)
        │
        ├── kebijakan-privasi/
        │   └── page.tsx            # Privacy policy page
        │
        ├── layar-antrian/
        │   ├── page.tsx            # Public queue display screen (digital signage)
        │   └── layar-antrian.module.css
        │
        ├── offline/
        │   └── ...                 # PWA offline fallback page
        │
        ├── admin/
        │   ├── layout.tsx          # Admin layout (Sidebar + AdminGuard)
        │   ├── page.tsx            # Admin dashboard (16KB — stats, charts, quick actions)
        │   ├── admin.module.css
        │   ├── dashboard.module.css
        │   ├── antrian/            # Queue management (call, serve, skip, cancel)
        │   ├── chat/               # Live chat admin (escalation handler)
        │   │   ├── page.tsx        # Officer chat interface (25.6KB)
        │   │   ├── faq/            # FAQ knowledge base management
        │   │   └── ai-log/         # AI chat audit log viewer
        │   ├── scan/               # QR scanner for check-in validation
        │   ├── kunjungan/          # Visit history & reporting
        │   ├── absensi/            # Officer attendance management
        │   ├── skm/                # SKM results dashboard
        │   ├── umkm/               # UMKM listing moderation
        │   ├── gallery/            # Investment document upload & management
        │   ├── investasi-leads/    # Investor lead pipeline management
        │   ├── petugas/
        │   │   ├── page.tsx        # Officer list & role management
        │   │   └── invite/         # Officer invitation form (K4 flow)
        │   ├── data-governance/    # Audit log + consent log + DPO dashboard
        │   └── settings/
        │       ├── page.tsx        # General site settings
        │       ├── jadwal/         # Service schedule & quota management
        │       └── landing/        # Landing page content editor
        │
        └── api/
            ├── health/
            │   ├── live/           # GET — liveness probe
            │   └── ready/          # GET — readiness probe
            ├── checkin/
            │   └── route.ts        # POST — walk-in check-in registration
            ├── chat/
            │   ├── ai/
            │   │   └── route.ts    # POST — RAG AI chat (embed → match_faq → Gemini → persist → broadcast)
            │   └── messages/       # POST — direct message handling
            ├── skm/
            │   └── submit/         # POST — SKM survey submission
            ├── umkm/
            │   ├── inquiry/        # POST — UMKM inquiry submission
            │   └── request-edit-link/ # POST — magic-link for UMKM edit
            ├── investasi/
            │   └── lead/           # POST — investor lead submission
            ├── investment-docs/
            │   ├── [id]/           # GET — PDF document by ID
            │   ├── upload/         # POST — document upload (admin)
            │   ├── signed-url/     # POST — signed URL generation
            │   ├── page-image/     # GET — rendered PDF page image
            │   └── public-view/    # GET — public PDF viewer
            ├── notif/
            │   ├── send/           # POST — Vercel cron: claim & deliver pending notifications
            │   └── retry/          # POST — Vercel cron: retry failed notifications
            └── admin/
                ├── petugas/
                │   └── invite/     # POST — invite new officer (K4 flow, admin-only)
                └── faq/            # FAQ CRUD API
```

---

## 4. User Roles — Complete RBAC Matrix

LMH menerapkan **Individual Account Policy** (Kebijakan B5): setiap petugas/mitra login dengan akun pribadi, **bukan** akun bersama per instansi.

### 4.1. Role Hierarchy & Determination

```
┌─────────────────────────────────────────────────────────────┐
│                    ROLE DETERMINATION FLOW                    │
│                                                             │
│  User logs in → Auth Hook (set_user_role_claim) fires       │
│  ↓                                                          │
│  Query: SELECT role FROM petugas WHERE auth_user_id = uid    │
│  ↓                                                          │
│  Found?                                                     │
│    YES → JWT claim `app_metadata.role` = 'admin'/'petugas'  │
│    NO  → JWT claim `app_metadata.role` = 'pengunjung'       │
│  ↓                                                          │
│  Middleware (proxy.ts): checks JWT claim (fast path)         │
│  or fallback DB query (pre-hook setup)                      │
│                                                             │
│  Protected routes: /admin/* → role must be admin|petugas    │
│  Protected routes: /me/*    → must be authenticated         │
│  Public routes: all others  → no auth required              │
└─────────────────────────────────────────────────────────────┘
```

### 4.2. Role: Pengunjung Anonim (`anon` / Unauthenticated)

Warga yang mengakses portal **tanpa login**.

| Fitur | Path | Akses |
|---|---|---|
| Landing page | `/` | ✅ Full |
| Galeri Investasi (PDF watermarked) | `/gallery` | ✅ Read-only |
| Katalog UMKM publik | `/umkm` | ✅ Read-only (via `v_umkm_public` view) |
| IKM publik / Transparansi | `/transparansi` | ✅ Read-only (via `hitung_ikm()`) |
| Walk-in check-in | `/checkin` | ✅ Rate-limited (5/menit via `check_anon_rate`) |
| Live Chat AI | `/chat` | ✅ Rate-limited (chat_sesi: 3/menit, chat_pesan: 20/menit) |
| SKM survey | `/skm?token=...` | ✅ Token-gated (tiket selesai) |
| UMKM inquiry | `/umkm` → form | ✅ Rate-limited (5/jam) |
| Investor lead form | `/gallery` → form | ✅ Rate-limited (3/jam) |
| Layar antrean publik | `/layar-antrian` | ✅ Read-only real-time |
| Kebijakan privasi | `/kebijakan-privasi` | ✅ Read-only |

**Catatan**: Anonim di sini sebenarnya tetap terautentikasi secara teknis via Supabase anonymous/authenticated session — RLS policy menggunakan `auth.uid()`. Walk-in check-in dan chat sesi memerlukan user terautentikasi minimal (Google OAuth atau anonymous session).

### 4.3. Role: Pengunjung Terotentikasi (`pengunjung` / Citizen)

Masyarakat, pelaku UMKM, atau investor yang login via **Google OAuth** atau **Email Magic Link**.

| Fitur | Path | Akses |
|---|---|---|
| Semua fitur anonim | (lihat di atas) | ✅ |
| Dashboard Pribadi | `/me` | ✅ |
| Riwayat kunjungan + tiket QR | `/me` | ✅ (RLS: `pengunjung_id` milik sendiri) |
| Reservasi online | `/me/reservasi` | ✅ (insert visit `asal=reservasi`, RLS check `pengunjung_id` = self) |
| Pengaturan notifikasi | `/me/notifications` | ✅ (push subscription `user_id` = self) |
| UMKM edit via magic-link | `/umkm/edit?token=...` | ✅ (RLS via `umkm_listing_owner.email` matching) |
| Inbox UMKM inquiry | `/umkm/inbox` | ✅ (RLS via owner email) |
| Lihat notifikasi sendiri | via RLS | ✅ (`notifikasi.tujuan_user_id` = self) |

**Database**: Row disimpan di `pengunjung` table dengan:
- `auth_user_id` (link ke `auth.users`)
- `nama`, `email`, `foto_url`, `provider` (google)
- `kategori`: `'UMKM'` | `'Umum'` | `'Instansi'` | `'Investor'`
- `asal_instansi`

### 4.4. Role: Petugas Loket / Mitra (`petugas` / Service Officer)

Pegawai internal DPMPTSP atau instansi mitra yang terikat pada **1 `layanan_id`** spesifik.

| Fitur | Path Admin | Akses |
|---|---|---|
| Antrian (panggil/selesai/skip) | `/admin/antrian` | ✅ **Hanya layanan miliknya** (RLS: `layanan_id = get_my_layanan_id()`) |
| Absensi (checkin/checkout) | `/admin/absensi` | ✅ **Milik sendiri** (RLS: `petugas_id` = self) |
| Live Chat (balas eskalasi) | `/admin/chat` | ✅ **Hanya sesi layanannya** (RLS: `chat_sesi.layanan_id = get_my_layanan_id()`) |
| Kelola FAQ | `/admin/chat/faq` | ✅ **Layanan sendiri** (RLS: scoped) |
| Hasil SKM | `/admin/skm` | ✅ **Layanan sendiri** (RLS: `skm_respons.layanan_id = get_my_layanan_id()`) |
| Jadwal layanan | `/admin/settings/jadwal` | ✅ **PTSP service saja** (hanya jika `layanan.is_ptsp = true` atau admin) |
| Tampilan publik | `/` (link) | ✅ Link navigasi |
| Insert listing UMKM | — | ✅ (RLS: `listing_staff_insert`) |
| Upload foto UMKM | — | ✅ (Storage RLS: `umkm-photos` bucket) |

**Tidak bisa**:
- ❌ Dashboard admin utama (`/admin`) — redirect ke `/admin/antrian`
- ❌ Kunjungan global (`/admin/kunjungan`)
- ❌ Scan QR (`/admin/scan`)
- ❌ Kelola Petugas (`/admin/petugas`)
- ❌ Moderasi UMKM (`/admin/umkm`)
- ❌ Investment Gallery management (`/admin/gallery`)
- ❌ Lead Investasi (`/admin/investasi-leads`)
- ❌ Log AI Chat (`/admin/chat/ai-log`)
- ❌ Tata Kelola Data (`/admin/data-governance`)
- ❌ Pengaturan umum (`/admin/settings`)
- ❌ Konten Landing (`/admin/settings/landing`)

**Database**: Row di `petugas` table:
- `auth_user_id` → link ke `auth.users`
- `nama`
- `layanan_id` → FK ke `layanan.id` (wajib isi untuk role petugas)
- `role` = `'petugas'`

### 4.5. Role: Administrator DPMPTSP (`admin` / System Admin)

Pengelola pusat seluruh sistem. `role = 'admin'` di tabel `petugas`, `layanan_id` biasanya NULL (akses global).

| Fitur | Path Admin | Akses |
|---|---|---|
| Dashboard utama | `/admin` | ✅ Statistik global (total kunjungan, SKM, IKM, chart) |
| Kunjungan global | `/admin/kunjungan` | ✅ Semua layanan |
| Scan QR | `/admin/scan` | ✅ Semua tiket |
| Antrian semua layanan | `/admin/antrian` | ✅ **Semua layanan** (RLS: `get_my_role() = 'admin'`) |
| Absensi semua petugas | `/admin/absensi` | ✅ + Approve/reject absensi |
| Live Chat semua sesi | `/admin/chat` | ✅ Semua layanan |
| Kelola FAQ | `/admin/chat/faq` | ✅ Semua FAQ |
| Log AI Chat | `/admin/chat/ai-log` | ✅ Lihat semua log AI (audit) |
| UMKM moderasi | `/admin/umkm` | ✅ Approve/reject listing, ubah status |
| Investment Gallery | `/admin/gallery` | ✅ Upload/delete dokumen PDF |
| Lead Investasi | `/admin/investasi-leads` | ✅ Kelola pipeline investor |
| Hasil SKM semua | `/admin/skm` | ✅ Semua layanan |
| Tata Kelola Data | `/admin/data-governance` | ✅ Audit log + consent log + DPO dashboard |
| Kelola Petugas | `/admin/petugas` | ✅ List, edit role/layanan |
| Invite Petugas | `/admin/petugas/invite` | ✅ K4 invite flow via Resend email |
| Jadwal Layanan | `/admin/settings/jadwal` | ✅ Semua layanan |
| Pengaturan | `/admin/settings` | ✅ Site settings, WA number, kontak |
| Konten Landing | `/admin/settings/landing` | ✅ Edit konten landing page |

**Storage**: Admin dapat upload/delete ke bucket `investment-docs` (folder `_raw/`, `pages/`) dan `umkm-photos`.

### 4.6. Role: Service Role / System Background

Proses otomatis yang berjalan di sisi server.

| Function / Trigger | Kapan | Apa yang dilakukan |
|---|---|---|
| `set_user_role_claim(event)` | Setiap login | Inject `app_metadata.role` ke JWT |
| `notify_visit_selesai()` | Visit status → `selesai` atau `menunggu` atau `dilayani` | Queue email SKM + web push |
| `notify_umkm_approved()` | Listing status → `published` | Queue email notifikasi ke owner |
| `audit_change()` | INSERT/UPDATE/DELETE di tabel tertentu | Insert ke `audit_log` |
| `claim_notifikasi(limit, status)` | Vercel cron `/api/notif/send` (*/2 menit) | Claim batch notifikasi pending |
| `complete_notifikasi(id, token, status, error)` | Setelah delivery attempt | Mark sent/failed + retry logic |
| `anonymize_inactive_pengunjung()` | pg_cron daily 02:00 | Anonymize pengunjung inactive > 730 hari |
| `refresh_estimasi_layanan()` | pg_cron */5 menit | Refresh materialized view estimasi antrean |
| `prune_anon_rate_limit()` | pg_cron daily 03:00 | Clean up rate limit entries > 7 hari |

---

## 5. Database Schema — Complete Table Reference

### 5.1. Core Tables (Migration 002)

| Table | Columns | Purpose |
|---|---|---|
| `layanan` | `id` (uuid PK), `nama` (text UNIQUE), `tipe` (konsultatif\|mitra\|modul_publik), `aktif` (bool), `chatbot_aktif` (bool), `created_at` | Daftar layanan/instansi |
| `petugas` | `id`, `auth_user_id` (UNIQUE FK auth.users), `nama`, `layanan_id` (FK layanan), `role` (petugas\|admin), `created_at` | Akun petugas individual |
| `pengunjung` | `id`, `auth_user_id` (UNIQUE FK), `nama`, `email`, `foto_url`, `provider`, `asal_instansi`, `kategori` (UMKM\|Umum\|Instansi\|Investor), `created_at`, `updated_at` | Profil pengunjung |
| `site_settings` | `key` (text PK), `value`, `updated_at` | Key-value site config |
| `landing_content` | `id`, `section`, `item_key`, `item_value`, `item_order`, `is_active`, `created_at`, `updated_at` | CMS konten landing page |
| `absensi_petugas` | `id`, `petugas_id` (FK), `tanggal` (date), `jam_masuk`, `jam_pulang`, `status` (pending\|approved), `approved_by` (FK petugas), `created_at`, UNIQUE(petugas_id, tanggal) | Absensi harian |
| `visit` | `id`, `asal` (walk_in\|reservasi), `pengunjung_id` (FK), `nama`, `asal_instansi`, `layanan_id` (FK), `tujuan` (loket\|bertemu_seseorang), `nama_yang_ditemui`, `keperluan`, `qr_token` (UNIQUE hex), `status` (terjadwal\|menunggu\|dilayani\|selesai\|batal\|no_show), `tanggal_rencana`, `jam_rencana`, `waktu_masuk`, `waktu_scan`, `waktu_mulai_layan`, `waktu_selesai`, `diarahkan_ke`, `catatan_petugas`, `created_at`, `updated_at` | Visit spine terpadu |

### 5.2. Feature Tables (Migration 003)

| Table | Key Columns | Purpose |
|---|---|---|
| `faq_knowledge_base` | `layanan_id`, `pertanyaan`, `jawaban`, `embedding` (vector 768), `aktif`, `urutan` | RAG knowledge base |
| `chat_sesi` | `layanan_id`, `pengunjung_id`, `kontak_pengunjung`, `status` (aktif\|bot\|eskalasi\|selesai), `ditangani_oleh` (FK petugas) | Chat session |
| `chat_pesan` | `sesi_id` (FK), `pengirim` (pengunjung\|bot\|petugas), `isi`, `sumber_faq_id` | Chat messages |
| `chat_ai_log` | `sesi_id`, `pertanyaan`, `context_faq_ids` (uuid[]), `jawaban`, `top_similarity`, `eskalasi`, `reason` | AI audit log |
| `listing_umkm` | `nama_umkm`, `kategori_kebutuhan` (7 kategori), `sisi` (kebutuhan\|penawaran), `deskripsi`, `foto_produk` (text[]), `kontak_nama`, `kontak_hp`, `kontak_email`, `status` (draft\|pending_review\|published\|nonaktif\|expired), `snapshot_approved` (jsonb), `dibuat_oleh` (FK petugas) | UMKM listings |
| `umkm_listing_owner` | `listing_id` (FK), `email`, UNIQUE(listing_id, email) | Listing ownership |
| `umkm_inquiry` | `listing_id` (FK), `from_email`, `from_nama`, `pesan`, `status` (pending\|approved\|rejected) | UMKM inquiries |
| `investment_documents` | `judul`, `kategori`, `urutan_tampil`, `file_path`, `halaman_gambar` (text[]), `jumlah_halaman`, `status` (aktif\|nonaktif), `deskripsi`, `nilai_investasi`, `image_url`, `uploaded_by` (FK petugas) | Dokumen investasi |
| `investasi_lead` | `doc_id` (FK), `nama`, `email`, `instansi`, `minat`, `catatan`, `status` (baru\|dihubungi\|berlanjut\|ditolak\|selesai) | Lead investor |
| `anon_rate_limit` | `user_id` (FK auth.users), `action`, `created_at` | Rate limiting tracker |
| `audit_log` | `actor_id`, `actor_role`, `aksi`, `entitas`, `entitas_id`, `detail` (jsonb) | Immutable audit log |
| `consent_log` | `subjek_ref`, `tujuan`, `disetujui`, `versi_kebijakan` | Privacy consent log |
| `skm_respons` | `visit_id` (FK UNIQUE), `layanan_id` (FK), `u1_persyaratan` .. `u9_pengaduan` (smallint 1-4), `saran` | SKM responses |
| `notifikasi` | `tujuan_user_id`, `tujuan_email`, `kanal` (email\|web_push), `subjek`, `body`, `payload` (jsonb), `status` (pending\|processing\|sent\|failed\|skipped), `claim_token`, `retry_count`, `idempotency_key`, `available_at` | Notification queue |
| `push_subscriptions` | `user_id` (FK), `endpoint`, `keys` (jsonb) | Web push subscriptions |

### 5.3. Views & Materialized Views (Migration 005)

| View | Type | Purpose |
|---|---|---|
| `v_umkm_public` | View (security_invoker) | Published UMKM listings (via `get_public_umkm()`) |
| `v_umkm_match` | View (security_invoker) | Matchmaking: kebutuhan ↔ penawaran by kategori |
| `mv_estimasi_layanan` | Materialized View | Avg service duration per layanan per jam slot (14 days) |
| `v_antrian_loket` | View | Real-time queue count + estimated wait per layanan |

### 5.4. Key Database Functions

| Function | Returns | Used By |
|---|---|---|
| `get_my_role()` | text | RLS policies — returns current user's role from `petugas` |
| `get_my_layanan_id()` | uuid | RLS policies — returns current user's assigned service |
| `set_user_role_claim(event jsonb)` | jsonb | Auth hook — injects role into JWT `app_metadata` |
| `check_anon_rate(action, max, window_sec)` | boolean | RLS — rate limiting |
| `match_faq(query_embedding, p_layanan_id, match_count)` | TABLE | RAG — cosine similarity search |
| `hitung_ikm(p_layanan_id, p_start, p_end)` | TABLE | IKM calculation |
| `get_skm_context(p_token)` | TABLE | SKM token validation |
| `submit_skm_response(p_token, u1..u9, saran)` | text | SKM submission (returns 'submitted'\|'invalid'\|'not_found'\|'not_completed'\|'duplicate') |
| `get_public_umkm()` | TABLE | Public UMKM listings (hides contact PII) |
| `queue_notifikasi(...)` | uuid | Queue a notification with idempotency |
| `claim_notifikasi(limit, status)` | TABLE | Batch claim for delivery |
| `complete_notifikasi(id, token, status, error)` | boolean | Mark delivery result |
| `refresh_estimasi_layanan()` | void | Refresh materialized view |
| `anonymize_inactive_pengunjung()` | void | PDP anonymization |

### 5.5. Storage Buckets

| Bucket | Public | RLS |
|---|---|---|
| `investment-docs` | ❌ Private | Admin-only CRUD (folders: `_raw/`, `pages/`) |
| `umkm-photos` | ✅ Public (read) | Insert/update/delete: admin + petugas |

---

## 6. Authentication & Authorization Architecture

### 6.1. Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    AUTHENTICATION METHODS                        │
│                                                                  │
│  1. Google OAuth                                                 │
│     User → /login → Supabase Auth (Google provider)             │
│     → /auth/callback → redirect to /me or /admin                │
│                                                                  │
│  2. Email Magic Link (password recovery untuk invite petugas)   │
│     Admin invite → Resend email → recovery link                 │
│     → /auth/callback?next=/admin                                │
│                                                                  │
│  3. Magic-Link UMKM Edit                                        │
│     UMKM owner → /api/umkm/request-edit-link                   │
│     → Resend email with OTP/token → /umkm/edit?token=...        │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2. Middleware (`src/proxy.ts`)

The Next.js middleware protects routes at the edge layer:

1. **Protected Prefixes**: `/admin`, `/me` — require authenticated user
2. **Role Check (for `/admin/*`)**: Reads role from `user.app_metadata.role` (JWT claim, fast path) or fallback DB query to `petugas` table
3. **Routing**:
   - Unauthenticated → redirect to `/login?redirect=<path>`
   - Authenticated but no `admin`/`petugas` role on `/admin` → redirect to `/me`
4. **Request ID**: Generates/propagates `x-request-id` header for tracing

### 6.3. Client-Side Guard (`AdminGuard.tsx`)

Additional client-side protection inside the admin layout:
1. Queries `petugas.role` for current user
2. Calls `canAccessAdminPath(role, pathname)` from `admin-nav.ts`
3. If petugas not found → redirect to `/me`
4. If role lacks permission for specific path → redirect to `/admin/antrian`

### 6.4. Admin Navigation — Single Source of Truth (`admin-nav.ts`)

The `ADMIN_NAV` array defines **all** admin menu items with their allowed roles:

| Menu | Path | Roles |
|---|---|---|
| Dashboard | `/admin` | admin |
| Kunjungan | `/admin/kunjungan` | admin |
| Scan QR | `/admin/scan` | admin |
| Antrian | `/admin/antrian` | admin, petugas |
| Absensi | `/admin/absensi` | admin, petugas |
| Live Chat | `/admin/chat` | admin, petugas |
| Kelola FAQ | `/admin/chat/faq` | admin, petugas |
| UMKM | `/admin/umkm` | admin |
| Investment Gallery | `/admin/gallery` | admin |
| Lead Investasi | `/admin/investasi-leads` | admin |
| Hasil SKM | `/admin/skm` | admin, petugas |
| Log AI Chat | `/admin/chat/ai-log` | admin |
| Tata Kelola Data | `/admin/data-governance` | admin |
| Kelola Petugas | `/admin/petugas` | admin |
| Jadwal Layanan | `/admin/settings/jadwal` | admin, petugas |
| Pengaturan | `/admin/settings` | admin |
| Konten Landing | `/admin/settings/landing` | admin |
| Tampilan Publik | `/` | admin, petugas |

Unregistered `/admin/*` paths default to **admin-only** (fail-closed).

---

## 7. API Routes — Complete Reference

### 7.1. Public / Rate-Limited

| Method | Path | Input | Output | Notes |
|---|---|---|---|---|
| `POST` | `/api/checkin` | `{ nama, asal_instansi, layanan_id, tujuan, ... }` | `{ visit }` | Walk-in registration, rate-limited |
| `POST` | `/api/chat/ai` | `{ pertanyaan, layanan_id, sesi_id }` | `{ jawaban, sumber[], eskalasi, reason }` | RAG AI: embed → match_faq → Gemini → persist → broadcast |
| `POST` | `/api/chat/messages` | `{ sesi_id, isi }` | `{ message }` | Direct message in chat session |
| `POST` | `/api/skm/submit` | `{ token, u1..u9, saran }` | `{ status }` | SKM submission via `submit_skm_response()` |
| `POST` | `/api/umkm/inquiry` | `{ listing_id, from_email, from_nama, pesan }` | `{ id }` | Inquiry to UMKM owner, rate-limited 5/hour |
| `POST` | `/api/umkm/request-edit-link` | `{ email }` | `{ success }` | Magic-link for UMKM owner editing |
| `POST` | `/api/investasi/lead` | `{ doc_id, nama, email, instansi, minat }` | `{ id }` | Investor lead, rate-limited 3/hour |
| `GET` | `/api/investment-docs/[id]` | `id` param | PDF stream | PDF document streaming |
| `GET` | `/api/investment-docs/page-image` | `{ doc_id, page }` | Image | Rendered PDF page |
| `GET` | `/api/investment-docs/public-view` | `{ id }` | JSON metadata | Document metadata for viewer |
| `POST` | `/api/investment-docs/signed-url` | `{ path }` | `{ url }` | Signed URL for download |

### 7.2. Admin-Only

| Method | Path | Input | Auth | Notes |
|---|---|---|---|---|
| `POST` | `/api/admin/petugas/invite` | `{ email, nama, layanan_id, role }` | `admin` | K4 invite flow: createUser → upsert petugas → send recovery email |
| `POST` | `/api/investment-docs/upload` | FormData (PDF) | `admin` | Upload investment PDF |
| `*` | `/api/admin/faq/*` | CRUD | `admin`/`petugas` | FAQ knowledge base management |

### 7.3. Internal (Vercel Cron)

| Method | Path | Schedule | Auth | Purpose |
|---|---|---|---|---|
| `POST` | `/api/notif/send` | `*/2 * * * *` | `CRON_SECRET` | Claim pending notifications + deliver via Resend/Web Push |
| `POST` | `/api/notif/retry` | `*/5 * * * *` | `CRON_SECRET` | Retry failed notifications (max 3 retries) |

### 7.4. Health

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health/live` | Liveness probe |
| `GET` | `/api/health/ready` | Readiness probe |

---

## 8. Frontend Architecture

### 8.1. Design System

- **CSS**: Vanilla CSS + CSS Modules + CSS Custom Properties (NO Tailwind)
- **Design Tokens**: Defined in `src/styles/globals.css` (20KB) — colors, spacing, typography, shadows, breakpoints
- **Fonts**: Inter (body) + Plus Jakarta Sans (headings) via `next/font/google`
- **Icons**: `lucide-react`
- **Charts**: `recharts` (admin dashboard, SKM reporting)
- **Chat UI**: `@chatscope/chat-ui-kit-react`

### 8.2. Component Pattern

```
Naming Convention:
  ComponentName.tsx           → Component logic
  component-name.module.css   → Scoped styles (CSS Modules)
  ComponentName.test.tsx      → Unit tests

Pattern:
  'use client'                → Client Components (interactive)
  Server Components           → Default (data fetching)
  CSS Modules                 → import styles from './name.module.css'
  Supabase Client             → createClient() from lib/supabase/client (client)
  Supabase Server             → createClient() from lib/supabase/server (server)
```

### 8.3. Key Shared Components

| Component | File | Size | Purpose |
|---|---|---|---|
| `Sidebar` | `components/layout/Sidebar.tsx` | 7.8KB | Admin sidebar, filters menu by role via `ADMIN_NAV` |
| `AdminGuard` | `components/layout/AdminGuard.tsx` | 1.5KB | Client-side route guard using `canAccessAdminPath()` |
| `PageHeader` | `components/layout/PageHeader.tsx` | 0.6KB | Reusable page header (title + description) |
| `WalkinWizard` | `components/WalkinWizard.tsx` | 14KB | Multi-step walk-in check-in wizard |
| `ProfileCompletenessGate` | `components/ProfileCompletenessGate.tsx` | 13.7KB | Profile completion form (kategori, nama, instansi) |
| `EstimasiAntrean` | `components/EstimasiAntrean.tsx` | 5.6KB | Queue estimation display with real-time data |
| `IkmPanel` | `components/IkmPanel.tsx` | 4.9KB | IKM score display (per layanan) |
| `Toast` | `components/Toast.tsx` | 4.5KB | Toast notification system (ToastProvider + `useToast`) |
| `QRCode` | `components/QRCode.tsx` | 0.8KB | QR code renderer wrapper |
| `OfflineBanner` | `components/OfflineBanner.tsx` | 1.9KB | "Anda offline" notification banner |
| `ServiceWorkerRegister` | `components/ServiceWorkerRegister.tsx` | 0.7KB | Service worker registration on mount |
| `Pagination` | `components/Pagination.tsx` | 1.7KB | Generic pagination controls |

### 8.4. Page Size Guide (Complexity Indicator)

| Page | File Size | Complexity |
|---|---|---|
| Landing (`/`) | 18.5KB | Hero, features grid, layanan list, contact, animated |
| Chat (`/chat`) | 37.5KB | Realtime WebSocket, Gemini RAG, escalation UX, message history |
| UMKM (`/umkm`) | 36KB | Catalog grid, filter, matchmaking, inquiry form |
| Admin Chat (`/admin/chat`) | 25.6KB | Multi-panel: session list + message view + escalation controls |
| Investment Gallery (`/gallery`) | 24KB | PDF viewer, watermark overlay, lead form |
| Admin Dashboard (`/admin`) | 16KB | Charts (Recharts), KPIs, quick actions |
| Checkin (`/checkin`) | 16KB | WalkinWizard integration, layanan selector, consent |
| Me Dashboard (`/me`) | 16.5KB | Visit history, active queue, QR display, reservasi link |
| Login (`/login`) | 10KB | Google OAuth button, email magic-link form, redirect handling |
| SKM (`/skm`) | 9.6KB | 9-question form, token validation, submission |

---

## 9. Security Architecture

### 9.1. Security Headers (next.config.ts)

```
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()
Content-Security-Policy-Report-Only: (dynamic based on Supabase URL)
```

### 9.2. Rate Limiting (Database-Level)

| Action | Limit | Window | Enforced By |
|---|---|---|---|
| `visit_insert_walk_in` | 5 | 60s | RLS + `check_anon_rate()` |
| `chat_sesi_insert` | 3 | 60s | RLS + `check_anon_rate()` |
| `chat_pesan_insert` | 20 | 60s | RLS + `check_anon_rate()` |
| `chat_ai_call` | 10 | 60s | Route handler manual check |
| `umkm_inquiry` | 5 | 3600s | RLS + `check_anon_rate()` |
| `investasi_lead_insert` | 3 | 3600s | RLS + `check_anon_rate()` |

### 9.3. PII Protection

- **`pii.ts`**: `redactPii()` strips email, phone, NIK from text before sending to Gemini
- **`pii.ts`**: `detectPromptInjection()` detects prompt injection attempts
- **`logger.ts`**: Sanitizes PII from structured logs (email, phone, nama, token fields → `[REDACTED]`)
- **`anonymize_inactive_pengunjung()`**: pg_cron daily — nullifies PII for inactive users > 730 days
- **FAQ matching**: Questions are PII-redacted before embedding/logging

### 9.4. Audit Trail

Every significant mutation is logged to `audit_log` via database triggers:
- `visit.status` changes
- `listing_umkm.status` changes
- `petugas` insert/delete
- `investment_documents` insert/delete
- `investasi_lead.status` changes

---

## 10. Offline & PWA Architecture

### 10.1. Service Workers

- **`public/sw.js`** (5.4KB): Cache strategy (stale-while-revalidate), offline fallback page, background sync
- **`public/sw-push.js`** (1.4KB): Push notification handler

### 10.2. IndexedDB Queue (`src/lib/offline/`)

- **`queue.ts`**: `lmh-offline` database, `queue` object store
  - Action types: `'checkin'` | `'investasi_lead'` | `'umkm_inquiry'`
  - Per-user isolation via `owner_user_id` index
  - Functions: `enqueueAction()`, `getPending()`, `markSynced()`, `removeSynced()`, `clearQueue()`
- **`replay.ts`**: Replay queued actions when online, POST to respective API routes

### 10.3. PWA Manifest

```json
{
  "name": "Lampung Maju Hub",
  "short_name": "LMH",
  "theme_color": "#4f46e5"
}
```

---

## 11. Notification System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                     NOTIFICATION PIPELINE                            │
│                                                                      │
│  DB Trigger (visit.status change, listing approved)                  │
│  ↓                                                                   │
│  queue_notifikasi(user_id, email, kanal, subjek, body, payload)     │
│  → INSERT notifikasi (status='pending', idempotency_key)            │
│  ↓                                                                   │
│  Vercel Cron (*/2 min) → POST /api/notif/send                      │
│  ↓                                                                   │
│  claim_notifikasi(10, 'pending')                                    │
│  → SELECT FOR UPDATE SKIP LOCKED (concurrent-safe)                  │
│  → status = 'processing', claim_token assigned                      │
│  ↓                                                                   │
│  For each claimed notification:                                      │
│    kanal = 'email'     → Resend API send                            │
│    kanal = 'web_push'  → web-push library (VAPID)                   │
│  ↓                                                                   │
│  complete_notifikasi(id, claim_token, 'sent'|'failed', error)       │
│    'sent'   → status = 'sent', sent_at = now()                     │
│    'failed' → retry_count++, available_at = now() + 5min            │
│  ↓                                                                   │
│  Vercel Cron (*/5 min) → POST /api/notif/retry                     │
│  → claim_notifikasi(10, 'failed') WHERE retry_count < 3            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 12. AI RAG Chat Pipeline

```
┌──────────────────────────────────────────────────────────────────────┐
│                     CHAT AI PIPELINE (POST /api/chat/ai)             │
│                                                                      │
│  1. Validate input (pertanyaan, layanan_id, sesi_id)                │
│  2. Detect prompt injection → if positive, return eskalasi          │
│  3. Redact PII from question (email, phone, NIK stripped)           │
│  4. Auth check: verify caller owns the chat session                 │
│  5. Rate limit check: 10 calls / 60s per user                      │
│  6. Embed question → text-embedding-004 (768-dim vector)            │
│  7. match_faq RPC (cosine similarity, threshold 0.7)                │
│  8. Weekend mode? → restrict to general info, no escalation         │
│  9. Build RAG context from FAQ matches                              │
│  10. Gemini generateContent(context + question)                     │
│      System prompt: Zero-Hallucination Policy, cite sources [1][2]  │
│  11. Redact PII from AI response                                    │
│  12. Persist bot message to chat_pesan (server-side trust boundary) │
│  13. Broadcast via Supabase Realtime channel                        │
│  14. If eskalasi → update chat_sesi.status = 'eskalasi'            │
│  15. Log to chat_ai_log for audit                                   │
│  16. Return { jawaban, sumber[], eskalasi, reason }                 │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 13. Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase anon key (RLS-governed) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase service role key (bypasses RLS) |
| `GEMINI_API_KEY` | ✅ | Google Gemini API key |
| `GEMINI_MODEL` | ❌ | Default: `gemini-1.5-flash` |
| `GEMINI_EMBEDDING_MODEL` | ❌ | Default: `text-embedding-004` |
| `RESEND_API_KEY` | ✅ | Resend API key for email delivery |
| `RESEND_FROM` | ❌ | Default: `DPMPTSP Lampung <noreply@lmh.lampungprov.go.id>` |
| `VAPID_PUBLIC_KEY` | ✅ | VAPID public key for web push |
| `VAPID_PRIVATE_KEY` | ✅ | VAPID private key for web push |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | ✅ | Same as VAPID_PUBLIC_KEY (client-side) |
| `CRON_SECRET` | ✅ | Bearer token for Vercel cron endpoints |
| `NEXT_PUBLIC_PUBLIC_URL` | ✅ | Public base URL (e.g. `https://lmh.lampungprov.go.id`) |
| `APP_ENV` | ❌ | `development` / `staging` / `production` |
| `APP_VERSION` | ❌ | Build version tag |
| `LMH_DEV_RETURN_LINK` | ❌ | Dev-only escape hatch (never set in prod) |

---

## 14. Testing Strategy

### 14.1. Test Commands

| Command | Purpose |
|---|---|
| `npm test` | Vitest run (all tests) |
| `npm run test:watch` | Vitest watch mode |
| `npm run test:coverage` | Coverage with v8 (soft 40% threshold) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint (max-warnings=0) |
| `npm run build` | Production build |
| `npm run verify:baseline` | lint + typecheck + test + build |
| `npm run smoke` | Health check probe |

### 14.2. Test Types & Locations

| Type | Location | Examples |
|---|---|---|
| Migration static tests | `supabase/migrations/*.test.ts` | SQL syntax, column constraints, RLS policy presence |
| Component tests | `src/app/**/*.test.tsx`, `src/components/*.test.tsx` | Rendering, accessibility, user interaction |
| Route handler tests | `src/app/api/**/*.test.ts` | API contract tests |
| Library tests | `src/lib/**/*.test.ts` | Utility function unit tests |
| Offline queue tests | `src/lib/offline/*.test.ts` | IndexedDB queue operations |
| Proxy tests | `src/proxy.test.ts` | Middleware auth/role guard |
| A11y tests | `*.a11y.test.ts` | Accessibility checks |

---

## 15. Conventions & Patterns for AI Agents

### 15.1. Coding Conventions

- **Language**: TypeScript strict mode, Bahasa Indonesia for UI text, English for code
- **Styling**: CSS Modules (`.module.css`), no Tailwind, use `var(--space-N)` / `var(--color-*)` tokens
- **State**: React `useState`/`useEffect` (no Redux/Zustand)
- **Data Fetching**: Supabase client SDK (both browser and server)
- **Validation**: Zod schemas in API route handlers
- **Error Handling**: Structured JSON errors, `logServerEvent()` for server logs
- **Comments**: Indonesian for inline comments, English for technical docs

### 15.2. Key Design Decisions

1. **Individual Account Policy (B5)**: NO shared/institutional accounts for mitra. Each staff has personal email login.
2. **RLS-First Security**: All data access governed by PostgreSQL Row Level Security. API routes are a thin layer.
3. **Server-Side Trust Boundary**: Bot messages are persisted server-side (not client-inserted) to prevent tampering.
4. **Fail-Closed**: Unknown admin routes default to admin-only. Missing Gemini key → auto-escalate to human.
5. **Zero-Hallucination Policy**: AI system prompt strictly prohibits speculation beyond FAQ data.
6. **Idempotent Notifications**: `idempotency_key` prevents duplicate notifications for the same event.
7. **PII-Safe Logging**: All structured logs sanitize sensitive fields before output.

### 15.3. Layanan Reference Data

Default layanan (dari seed data):

| Nama | Tipe | Notes |
|---|---|---|
| Helpdesk OSS | konsultatif | Online Single Submission support |
| Sertifikasi Halal | konsultatif | Halal certification service |
| BPJS Kesehatan | konsultatif | BPJS health insurance counter |
| Bank Lampung | konsultatif | Bank Lampung financial services |
| Matchmaking UMKM | konsultatif | UMKM matchmaking service |
| Investment Gallery | konsultatif | Investment information gallery |

---

## 16. Glossary

| Term | Definition |
|---|---|
| **DPMPTSP** | Dinas Penanaman Modal dan Pelayanan Terpadu Satu Pintu — One-Stop Investment & Service Agency |
| **LMH** | Lampung Maju Hub — the application name |
| **PTSP** | Pelayanan Terpadu Satu Pintu — One-Stop Service |
| **SKM** | Survei Kepuasan Masyarakat — Public Satisfaction Survey |
| **IKM** | Indeks Kepuasan Masyarakat — Public Satisfaction Index |
| **PermenPANRB 14/2017** | Ministerial regulation governing public satisfaction measurement |
| **PDP** | Perlindungan Data Pribadi — Personal Data Protection (Indonesia) |
| **DPO** | Data Protection Officer |
| **OSS** | Online Single Submission (national licensing system) |
| **FOILA** | Forum Investasi Lampung — Lampung Investment Forum |
| **UMKM** | Usaha Mikro Kecil Menengah — Micro Small Medium Enterprises |
| **RAG** | Retrieval-Augmented Generation |
| **RLS** | Row Level Security (PostgreSQL) |
| **VAPID** | Voluntary Application Server Identification (Web Push protocol) |
| **K4** | Konfigurasi 4 — Invite flow for officer onboarding |
| **K5** | Konfigurasi 5 — Magic-link edit flow for UMKM |
| **Visit Spine** | Unified visit data model for walk-in and reservasi flows |
| **Eskalasi** | Escalation — when AI bot transfers chat to human officer |
