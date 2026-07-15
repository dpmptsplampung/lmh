# LMH 2.0 — Production Readiness (honest status)

> **Branch:** `production-readiness`  
> **Date:** 15 Juli 2026  
> **Scope:** Code gates 0–5 on this branch; staging/human work remains.

---

## 1. Executive status

| Area | Status |
|---|---|
| **Code gates 0–3** | Complete on branch `production-readiness` (security, baseline DB, app hardening, a11y/UX) |
| **Code gates 4–5** | Complete in-branch: CI, coverage config, smoke script, ops docs (this pass) |
| **Migrations** | **5 baseline** files (`202607140001`–`005`) + `seed.sql` / `seed-demo.sql` — **not** 38 numbered files |
| **CI** | `.github/workflows/ci.yml`: Node 20.19, lint, typecheck, test, build (placeholder env), optional audit |
| **Production go-live** | **Not** “100% complete / only dashboard left.” Staging deploy, human Dashboard config, legal sign-off, and residual E2E still required |

**Honest bottom line:** Application code and baseline schema are production-oriented and verified by unit/contract tests + build. Go-live still needs environment wiring, migration apply on a real project, and human acceptance.

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
| CI Node 20.19 + lint/typecheck/test/build + optional audit | `.github/workflows/ci.yml` |
| Coverage (`v8`, soft 40% thresholds) | `vitest.config.ts`, `npm run test:coverage` |
| Supabase CLI skeleton | `supabase/config.toml` |
| Smoke script (`/api/health/live`) | `scripts/smoke.mjs`, `npm run smoke` |
| Testing residual notes | `docs/TESTING.md` |
| Backup/restore + RPO/RTO TBD | `docs/BACKUP_RESTORE.md` |
| Deploy runbook (5 baselines, no 020–038 loop) | `docs/DEPLOY_RUNBOOK.md` |

**Playwright E2E:** not added (Gate 4 residual — prefer docs over a half-broken harness). See `docs/TESTING.md`.

---

## 4. Remaining work (human / staging / legal)

These are **not** finished by this branch alone:

| # | Item | Owner |
|---|---|---|
| 1 | **Docker / Supabase CLI SQL verify** — apply 5 baselines + seed on empty project | Ops |
| 2 | **Staging deploy** (Vercel + linked Supabase) | Ops |
| 3 | **Dashboard:** Anonymous Auth, Auth Hook JWT role, Site URL | Human |
| 4 | **Resend** domain verification + API key (magic-link + notif email) | Human |
| 5 | **VAPID** keys for web-push | Human |
| 6 | **Gemini** API key + FAQ embed backfill post-deploy | Human |
| 7 | **Admin invite** first staff accounts (no shared password seed) | Human |
| 8 | **Legal / DPO** sign-off on `KEBIJAKAN_PDP` + privacy page | DPO |
| 9 | **Gallery delete orphans** (storage cleanup) | Product/ops |
| 10 | **Lighthouse** PWA/A11y formal scores | QA |
| 11 | **E2E** (Playwright) happy paths | Eng follow-up |
| 12 | **RPO/RTO** ownership numbers | Ops + management |

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
