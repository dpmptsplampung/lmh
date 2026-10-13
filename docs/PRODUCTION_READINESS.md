# LMH 2.0 — Production Readiness (honest status)

> **Branch:** `main` (post production-readiness + forward hardening)  
> **Date:** 25 Juli 2026  
> **Scope:** Code gates 0–5 + P0 chat auth fix; staging/human work remains.  
> **Audit detail:** `docs/AUDIT_PRODUCTION_2026-07-25.md`

---

## 1. Executive status

| Area | Status |
|---|---|
| **Code gates 0–5** | Complete (security, baseline DB, app hardening, a11y/UX, CI, smoke, ops docs) |
| **P0/P1 hardening 2026-07-25** | Chat messages auth+ownership, checkin `pengunjung_id`, inquiry no service-role UPDATE, AI draft layanan scope, cron 2/5 min, error sanitization |
| **Migrations** | **5 baseline** + **3 forward** (`20260720`, `20260721`, `20260724`) + `seed.sql` |
| **CI** | `.github/workflows/ci.yml`: Node 22, lint, typecheck, test:coverage, build, `npm audit --audit-level=critical` (**hanya critical**, bukan high+ — lihat bagian 3b). Gerbang high+ ada **lokal**: `npm run verify:baseline` (termasuk `audit:check`) + hook pre-push, bukan di CI GitHub |
| **Production go-live** | **Code-ready.** Staging deploy, Dashboard config, secrets, legal sign-off still required |

**Honest bottom line:** Application code is production-oriented. Go-live still needs environment wiring, migration apply on a real project, and human acceptance — not more feature code.

---

## 2. What gates 0–3 delivered (code)

Summarized; see `.superpowers/sdd/reports/production-readiness-task-*-report.md` for evidence.

| Gate | Focus | Outcome |
|---|---|---|
| 0 | Env, health, engines, baseline docs | App identity, `/api/health/*`, Node pin |
| 1 | Baseline SQL + security hardening | 5 migrations, RLS/audit/notif claim, seed policy |
| 2 | App routes / secrets / contracts | Hardened handlers, tests |
| 3 | UX / WCAG | Privacy page, native controls, toast live region, not-found/error |

Historical feature work (SKM, antrean, AI RAG, UMKM, PWA, etc.) remains in the app; schema is expressed only via the **5-file baseline**, not legacy `020`–`038` paste steps.

---

## 3. What gates 4–5 delivered (ops / docs)

| Item | Location |
|---|---|
| CI Node 22 + lint/typecheck/test/build + audit (critical saja) | `.github/workflows/ci.yml` |
| Coverage (`v8`, soft 40% thresholds) | `vitest.config.ts`, `npm run test:coverage` |
| Supabase CLI skeleton | `supabase/config.toml` |
| Smoke script (`/api/health/live`) | `scripts/smoke.mjs`, `npm run smoke` |
| Testing residual notes | `docs/TESTING.md` |
| Backup/restore + RPO/RTO TBD | `docs/BACKUP_RESTORE.md` |
| Deploy runbook (5 baselines, no 020–038 loop) | `docs/DEPLOY_RUNBOOK.md` |

**Playwright E2E:** not added (Gate 4 residual — prefer docs over a half-broken harness). See `docs/TESTING.md`.

---

## 3b. Status dependensi & audit (diperbarui 13 Okt 2026)

Faktual per pemeriksaan lokal tanggal ini; bukan jaminan keamanan.

| Paket | Sebelum | Sekarang | Catatan |
|---|---|---|---|
| `next` | `^16.2.12` (terpasang 16.2.12, lockfile 16.3.6) | `^16.3.8` (terkunci 16.3.8) | 16.3.8 memuat perbaikan advisory HIGH SSRF Image Optimization (GHSA-cjq9-62q9-8jv4) dan beberapa MEDIUM cache poisoning ISR/SSG |
| `sharp` | `^0.35.3` (lockfile 0.35.4) | `^0.35.5` (terkunci 0.35.5) | memperbaiki GHSA-wq5f-xc86-pv6w |
| `eslint-config-next` | `^16.2.12` | `^16.3.8` | rule baru `no-location-assign-relative-destination` aktif (4 navigasi keras disengaja diberi `eslint-disable` beralasan) |

- **Gerbang audit CI hanya `critical`** (`npm audit --audit-level=critical`); `.github/workflows/ci.yml` tidak diubah. Klaim lama "audit high+" untuk CI tidak benar. Gerbang yang memblok **high+** kini ada **lokal**: `npm run audit:check` (`scripts/check-audit.mjs`) bagian dari `npm run verify:baseline` dan hook pre-push `.githooks/pre-push`. Advisory high+ yang belum punya perbaikan layak hanya boleh lolos lewat `audit-allow.json` (alasan + tenggat; lewat tenggat = gagal). `npm run deps:check` memastikan `next`/`sharp`/`eslint-config-next` terpasang sama dengan `package-lock.json`. Detail: `docs/TESTING.md`.
- `npm audit` terkini (diverifikasi ulang 13 Okt 2026): 11 paket rentan (0 critical, 5 high, 6 moderate); `next` dan `sharp` **tidak lagi** muncul. Hanya produksi (`--omit=dev`): 2 (0 high, 2 moderate):
  - high `brace-expansion` dan `source-map-js` yang tercatat pada pemeriksaan sebelumnya **tidak lagi** dilaporkan.
  - moderate `uuid` via `exceljs`: satu-satunya "perbaikan" yang ditawarkan npm adalah menurunkan `exceljs` ke 3.4.0 (breaking, tidak dipakai).
  - dev-only: rantai `braces` → `micromatch` → `fast-glob` → `@next/eslint-plugin-next` → `eslint-config-next` (5 paket high, satu advisory akar `GHSA-vfj7-8cjw-p6xm`; `braces` 3.0.3 masih rilis terbaru dan satu-satunya saran npm menurunkan `eslint-config-next` ke 14.x yang tidak layak) — dikecualikan di `audit-allow.json` sampai 2027-01-13 — dan `vitest`/`@vitest/mocker`/`@vitest/ui`/`@vitest/coverage-v8` (4 moderate).
- **npm 12 memblokir install-script**: `canvas` (binary native untuk render PDF→PNG) tidak terbangun setelah `npm ci` kecuali disetujui lewat `allowScripts` di `package.json` (`npm install-scripts approve canvas`), lalu `npm rebuild canvas`. Perilaku di CI/Vercel (Node 22, npm bawaan) belum diverifikasi di sini.

---

## 4. Remaining work (human / staging / legal)

These are **not** finished by this branch alone:

| # | Item | Owner |
|---|---|---|
| 1 | **Docker / Supabase CLI SQL verify** — apply 5 baselines + forward migrations (`20260720`–`20260724`) + seed on empty project | Ops |
| 2 | **Staging deploy** (Vercel + linked Supabase) | Ops |
| 3 | **Dashboard:** Anonymous Auth, Auth Hook JWT role, Site URL | Human |
| 4 | **Resend** domain verification + API key (magic-link + notif email) | Human |
| 5 | **VAPID** keys for web-push | Human |
| 6 | **Gemini** API key + FAQ embed backfill post-deploy | Human |
| 7 | **Admin invite** first staff accounts (no shared password seed) | Human |
| 8 | **Legal / DPO** sign-off on `KEBIJAKAN_PDP` + privacy page | DPO |
| 9 | ~~Gallery delete orphans~~ — closed (API DELETE cleans storage) | — |
| 10 | **Lighthouse** PWA/A11y formal scores | QA |
| 11 | **E2E** (Playwright) happy paths | Eng follow-up |
| 12 | **RPO/RTO** ownership numbers | Ops + management |
| 13 | ~~Notif cron frequency~~ — fixed: send `*/2`, retry `*/5` in `vercel.json` | — |

---

## 5. Go-live checklist (ordered)

1. Backup (see `docs/BACKUP_RESTORE.md`).
2. Fresh Supabase project → enable extensions as required by baseline preflight.
3. `supabase link` + `supabase db push --include-all --include-seed` (see `docs/MIGRATIONS.md`).
4. Dashboard: anon auth, JWT hook, site URL, Resend domain.
5. Set all env vars (`.env.example` / `docs/ENVIRONMENT_VARIABLES.md`).
6. Deploy app; confirm `GET /api/health/live` and `/api/health/ready`.
7. Invite admin/petugas; never rely on demo passwords.
8. Smoke flows: checkin, chat, SKM, magic-link, gallery watermark.
9. DPO/legal sign-off; privacy URL reachable from consent UIs.

Detail: `docs/DEPLOY_RUNBOOK.md`.

---

## 6. Documentation index

| File | Role |
|---|---|
| `docs/DEPLOY_RUNBOOK.md` | Deploy checklist |
| `docs/MIGRATIONS.md` | 5 baselines + seed rules |
| `docs/TESTING.md` | CI tests + residual E2E/Docker |
| `docs/BACKUP_RESTORE.md` | Backup before migrate |
| `docs/ENVIRONMENT_VARIABLES.md` | Env reference |
| `docs/KEBIJAKAN_PDP.md` | PDP policy draft (needs DPO) |
| `docs/KEBIJAKAN_AKUN_MITRA.md` | Individual partner accounts |
| `.env.example` | Template |

---

## 7. Anti-claims (do not reintroduce)

- Do **not** claim “100% code-complete, only Dashboard left” without staging verification.
- Do **not** document migration apply as pasting `020`–`038`.
- Do **not** treat demo seed as production data.
- Do **not** skip Resend domain verification for magic-link auth email.
- Do **not** claim CI menggagalkan build pada advisory "high+": gerbang CI saat ini hanya `critical`. Pemblokiran high+ hanya ada lokal (`npm run verify:baseline` / hook pre-push).
