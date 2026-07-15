# Testing

## What runs in CI

| Layer | Command | Scope |
|---|---|---|
| Lint | `npm run lint` | ESLint, max-warnings=0 |
| Types | `npm run typecheck` | `tsc --noEmit` |
| Unit / contract | `npm test` | Vitest + jsdom: components, API helpers, static migration SQL contracts |
| Build | `npm run build` | Next.js production build with placeholder public env |

CI workflow: `.github/workflows/ci.yml` (Node from `.nvmrc` = 20.19).  
Docker and Supabase local are **not** required for CI.

## Coverage

```bash
npm run test:coverage
```

- Provider: `@vitest/coverage-v8`
- Soft thresholds: lines/functions/branches/statements **40%** (report only; raise later)
- Output: `coverage/` (gitignored)

## Smoke (running server)

```bash
# Skip network if BASE_URL unset (exit 0)
npm run smoke

# Against local or staging
BASE_URL=http://localhost:3000 npm run smoke
BASE_URL=https://staging.example npm run smoke
```

Hits `/api/health/live` and expects HTTP 200. See `scripts/smoke.mjs`.

## Migration tests

Static/contract tests under `supabase/migrations/*.test.ts` assert baseline file presence, seed policy, and SQL shape. They do **not** execute SQL against a live Postgres.

## Residual (Gate 4 — not automated yet)

| Item | Why residual | Owner path |
|---|---|---|
| **Integration against live Supabase** | Needs project credentials + Docker/CLI for local stack | Staging deploy + human |
| **Docker SQL verify** | Apply 5 baseline migrations via `supabase db push --include-all --include-seed` and smoke DB | Ops with Docker/Supabase CLI |
| **Playwright E2E** | Not added in Gate 4 (avoid half-broken harness). Plan: happy-path checkin, login, admin shell | Follow-up |
| **Lighthouse PWA/A11y** | Formal audit not run | Post-staging |
| **Gallery delete orphans** | Storage cleanup job | Product/ops |

## Local developer loop

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:baseline   # lint + typecheck + test + build
```
