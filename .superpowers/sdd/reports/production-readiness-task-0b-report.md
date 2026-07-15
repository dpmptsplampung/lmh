# Production Readiness Gate 0B Report

Status: `DONE_WITH_CONCERNS`

## Local Next.js 16.2.10 Documentation Read

- `node_modules/next/dist/docs/01-app/02-guides/instrumentation.md`
- `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`
- `node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md`

## Design Decisions

- Vercel Runtime Logs receive one-line JSON through a focused logger; no observability dependency was added.
- Environment parsing is split into server and static-reference client modules. Strict staging/production checks are explicit, while test/development and the production-build phase remain build-safe.
- Readiness behavior is implemented as a dependency-injected helper. The route alone creates the server-only service-role client, allowing success, config, database, and timeout tests without module mocking.
- Request IDs are bounded at the proxy boundary and attached to forwarded request headers and every returned proxy response without changing authentication or role decisions.
- CSP is report-only. Supabase HTTP/WSS and storage images are allowed; Resend and Gemini remain server-only and therefore receive no browser CSP source.

## RED/GREEN Evidence

- Initial focused RED: `npx vitest run src/lib/observability/logger.test.ts src/lib/env/env.test.ts src/instrumentation.test.ts src/app/api/health/health.test.ts src/test/next-config-security.test.ts src/proxy.test.ts` produced 6 failed files, 9 failed tests, 8 passing tests, and three missing-module suites. Existing proxy/config behaviors failed for absent request-ID/security headers; new contracts failed because implementation modules did not exist.
- Focused GREEN: the same command passed 6 files and 33 tests.
- Hardening RED: `npx vitest run src/lib/env/env.test.ts src/test/next-config-security.test.ts` failed 3 tests for an obvious test secret, empty `APP_VERSION`, and production `unsafe-eval`.
- Hardening GREEN: the same command passed 2 files and 11 tests.
- Final review RED: `npx vitest run src/lib/env/env.test.ts` failed 1 of 11 tests because the exact `.env.example` `replace-with-*` marker was not rejected.
- Final focused GREEN: the six-file focused command passed 6 files and 36 tests.

## Verification

- Focused tests: `npx vitest run src/lib/observability/logger.test.ts src/lib/env/env.test.ts src/instrumentation.test.ts src/app/api/health/health.test.ts src/test/next-config-security.test.ts src/proxy.test.ts` passed 6 files and 36 tests.
- Lint: `npm run lint` passed with zero warnings.
- Typecheck: `npm run typecheck` passed.
- Full tests: standalone `npm test` passed 47 files and 501 tests before the final placeholder regression was added. The final sequential gate passed 47 files and 502 tests.
- Build: `npm run build` compiled with Next.js 16.2.10, completed TypeScript, generated 44 static pages, and listed `/api/health/live` and `/api/health/ready` as dynamic routes.
- Sequential gate: final `npm run verify:baseline` passed lint, typecheck, 47 test files/502 tests, and the production build with 44 static pages.

## Files Changed

- `.env.example`
- `.superpowers/sdd/reports/production-readiness-task-0b-report.md`
- `docs/ENVIRONMENT_VARIABLES.md`
- `docs/OBSERVABILITY.md`
- `next.config.ts`
- `src/instrumentation.ts`
- `src/instrumentation.test.ts`
- `src/proxy.ts`
- `src/proxy.test.ts`
- `src/lib/env/client.ts`
- `src/lib/env/server.ts`
- `src/lib/env/env.test.ts`
- `src/lib/observability/logger.ts`
- `src/lib/observability/logger.test.ts`
- `src/lib/supabase/service.ts`
- `src/app/api/health/health.test.ts`
- `src/app/api/health/live/health.ts`
- `src/app/api/health/live/route.ts`
- `src/app/api/health/ready/health.ts`
- `src/app/api/health/ready/route.ts`
- `src/test/next-config-security.test.ts`

## Concerns

- CSP is intentionally report-only for Gate 0B. Vercel violation data should be reviewed before enforcement.
- Health endpoint tests exercise the route logic through focused dependency-injected helpers; they do not contact a real Supabase project in CI.

## Review Fixes

- Startup now parses configuration on every non-build runtime. `VERCEL_ENV=preview` requires `APP_ENV=staging`, `VERCEL_ENV=production` requires `APP_ENV=production`, and missing, misspelled, inconsistent, or unknown deployed values fail closed. Local `phase-production-build` remains exempt.
- The service worker bypasses all `/api/health/` requests before interception and guards every runtime `cache.put` against `Cache-Control: no-store`.
- Structured logging omits stacks in staging and production, normalizes bigint, serializes shared references independently, and bounds active circular references.
- Readiness now passes an `AbortSignal` through `.abortSignal(signal)`, aborts on timeout, exposes `maxDuration = 5`, and uses a dependency-injected route handler for validation/client/query tests.
- Proxy construction, authentication, and role-query exceptions produce sanitized structured events and bounded JSON 500 responses carrying `x-request-id`; the old HTML/config `console.error` response was removed.
- CSP now derives exact HTTPS/WSS Supabase origins from a valid HTTPS URL, omits invalid/missing origins, and allows only the current exact Google Fonts stylesheet/font origins.
- Initial review RED: `npx vitest run src/instrumentation.test.ts src/lib/observability/logger.test.ts src/app/api/health/health.test.ts src/test/service-worker.test.ts src/proxy.test.ts src/test/next-config-security.test.ts` failed 6 files and 15 tests with 25 passing tests.
- Initial review GREEN: the same command passed 6 files and 40 tests.
- Readiness route RED: `npx vitest run src/app/api/health/ready/route.test.ts` failed 1 file and all 5 tests because the handler factory and `maxDuration` did not exist.
- Readiness route GREEN: the same command passed 1 file and 5 tests.
- Consolidated focused GREEN before final verification: 8 files and 57 tests passed.
- Final focused verification: `npx vitest run src/instrumentation.test.ts src/lib/env/env.test.ts src/lib/observability/logger.test.ts src/app/api/health/health.test.ts src/app/api/health/ready/route.test.ts src/test/service-worker.test.ts src/proxy.test.ts src/test/next-config-security.test.ts` passed 8 files and 57 tests.
- Final lint: `npm run lint` passed with zero warnings.
- Final typecheck: `npm run typecheck` passed.
- Final full suite: `npm test` passed 49 files and 523 tests.
- Final standalone build: `npm run build` compiled with Next.js 16.2.10, completed TypeScript, generated 44 static pages, and retained both health endpoints as dynamic routes.
- Final sequential gate: `npm run verify:baseline` passed lint, typecheck, all 49 files/523 tests, and the production build with 44 static pages.
- Review files changed: `.superpowers/sdd/reports/production-readiness-task-0b-report.md`, `docs/ENVIRONMENT_VARIABLES.md`, `docs/OBSERVABILITY.md`, `next.config.ts`, `public/sw.js`, `src/instrumentation.ts`, `src/instrumentation.test.ts`, `src/proxy.ts`, `src/proxy.test.ts`, `src/lib/env/server.ts`, `src/lib/observability/logger.ts`, `src/lib/observability/logger.test.ts`, `src/app/api/health/health.test.ts`, `src/app/api/health/ready/health.ts`, `src/app/api/health/ready/route.ts`, `src/app/api/health/ready/route.test.ts`, `src/test/next-config-security.test.ts`, and `src/test/service-worker.test.ts`.

## Remaining Review Fixes

- Root cause: the readiness route tests invoked `createReadinessHandler` directly, while production `GET` reused a closure composed at module import. The tests could not prove the exported route was wired to runtime validation, service-role creation, or the real timeout path.
- `route.test.ts` now dynamically imports `route.ts` and invokes its actual exported `GET` for invalid configuration, successful service-role query wiring, timeout/abort, database failure sanitization, and route control exports. Only runtime-env parsing, service-role client creation, and structured-log output are mocked; the readiness handler, timer, `AbortController`, response generation, and `GET` composition are real.
- Production `GET` now composes the same dependencies at invocation rather than module import. Validation, 3-second timeout, service-role client, query, response, and logging behavior are unchanged.
- Proxy missing-configuration logging now passes a named `ConfigurationError`, preserving its safe explicit type instead of reclassifying the plain object as `UnknownError`.
- RED: `npx vitest run src/app/api/health/ready/route.test.ts src/proxy.test.ts` failed 2 files and 2 tests with 21 passing tests. The route factory was called zero times during actual `GET`, and the proxy log contained `error.type=UnknownError`.
- First GREEN after minimal production changes: the same focused command passed 2 files and 23 tests.
- Final focused verification after replacing helper-only route tests: the same command passed 2 files and 22 tests.
- Lint: `npm run lint` passed with zero warnings.
- Typecheck: `npm run typecheck` passed.
- Full suite: `npm test` passed 49 files and 523 tests.
- Production build: `npm run build` completed with Next.js 16.2.10, generated 44 static pages, and retained `/api/health/live` and `/api/health/ready` as dynamic routes.
- Files changed for these remaining findings: `.superpowers/sdd/reports/production-readiness-task-0b-report.md`, `src/app/api/health/ready/route.test.ts`, `src/app/api/health/ready/route.ts`, `src/proxy.test.ts`, and `src/proxy.ts`.
