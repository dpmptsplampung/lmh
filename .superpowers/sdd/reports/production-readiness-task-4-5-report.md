# Production Readiness Gate 4+5 Report

**Status:** `DONE_WITH_CONCERNS`

## Delivered

### Gate 4 (ops / quality automation)
- CI (`.github/workflows/ci.yml`): Node via `.nvmrc` (20.19), `npm ci`, lint, typecheck, test, build with safe public env placeholders, optional `npm audit --audit-level=high` (continue-on-error).
- Vitest coverage config (`provider: v8`, thresholds 40%) + script `test:coverage`.
- Minimal `supabase/config.toml` for future CLI use.
- Smoke script `scripts/smoke.mjs` + `npm run smoke` (skips when `BASE_URL` unset).
- Docs: `docs/TESTING.md` (unit/contract now; E2E/Docker residual).

### Gate 5 (docs honesty)
- `docs/PRODUCTION_READINESS.md` rewritten: gates 0–3 complete on branch; **not** “100% only dashboard”; 5 baselines; residual human/staging list.
- `docs/DEPLOY_RUNBOOK.md`: `supabase db push --include-all --include-seed`; no 020–038 paste loop; health + privacy URL checks; Resend magic-link.
- `docs/BACKUP_RESTORE.md`: pre-migrate backup + dashboard restore notes.
- README structure aligned with 5 migrations + seed.

## Verification

```text
npm test        → 69 files / 415 tests pass
npm run lint    → 0 warnings
npm run typecheck → pass
npm run build   → pass (with APP_ENV=test placeholders)
npm run smoke   → skip without BASE_URL (expected)
```

## Residual (human / staging — not code-complete claims)

1. Start Docker Desktop → `supabase db reset` / live SQL lint on empty project.
2. Staging Supabase + Vercel project with real secrets.
3. Dashboard: anonymous auth, JWT Auth Hook, Resend domain, VAPID, Gemini, Site URL.
4. Provision admin via invite (no password123 seed).
5. Legal: DPO contact / retensi 730d provisional sign-off.
6. Optional: Playwright E2E, Lighthouse, gallery storage delete API, web-push producers.
7. Merge/push `production-readiness` and run CI on remote (not done — no commit/push authorized).

## Concerns

- Coverage package must be present for `test:coverage`; if missing, install `@vitest/coverage-v8` matching vitest.
- Playwright not installed (documented residual).
- Worktree still dirty; no git commit created by this gate.
