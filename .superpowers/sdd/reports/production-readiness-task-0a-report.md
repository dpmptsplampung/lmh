# Production Readiness Gate 0A Report

Status: `DONE`

## Root Cause

- The chat RLS guard was a false positive. Its line-comment removal used `/--.*$/` on CRLF lines after splitting only on `\n`; the retained `\r` prevented the end-anchored expression from removing rollback documentation containing `FOR SELECT USING (true)`. The active `chat_sesi_owner_select` and `chat_pesan_owner_select` policies are both scoped to `authenticated` and enforce ownership/service/admin access.
- The check-in RLS guard was also a false positive. In addition to the same CRLF-sensitive comment handling, `/kunjungan[\s\S]*?FOR INSERT[\s\S]*?WITH CHECK (true)/` could span unrelated SQL and rollback documentation instead of isolating the final named policy. The active `kunjungan_anon_insert` policy is scoped to `authenticated` and calls `check_anon_rate('kunjungan_insert', 5, 60)`.
- No active SQL was vulnerable, so no migration was changed. The guards now extract and assert the relevant named `CREATE POLICY ...;` statements.
- Vitest discovery used only a partial custom `exclude` and no explicit `include`, allowing discovery behavior to depend on workspace contents. Discovery is now anchored to application tests under `src` and SQL contract tests under `supabase/migrations`, retains `configDefaults.exclude`, and explicitly excludes hidden tooling and generated test/build output.
- Strict lint exposed the two known warnings. The attendance refresh callback now has a complete dependency chain without stale closures; effect-triggered work is deferred to avoid synchronous state updates in an effect. The FAQ embed handler's unused request parameter was removed, which Next.js 16 documents as optional.

## RED Evidence

- Baseline focused RLS run: `npx vitest run src/app/chat/chat.rls.test.tsx src/app/checkin/checkin.rls.test.tsx` failed exactly 2 guards, with 36 passing tests.
- New config/metadata regression test: `npx vitest run src/test/vitest-config.test.ts` failed because lint was `eslint`, `verify:baseline` and `engines.node` were absent, and `.nvmrc` did not exist.
- Discovery regression run failed because `test.include` was absent and the custom exclude did not retain `configDefaults.exclude` or hidden tooling/generated-output exclusions.
- Strict lint RED: `npx eslint . --max-warnings=0` failed on the missing `fetchData` effect dependency and unused `_request` parameter.

## Files Changed

- `.nvmrc`
- `.superpowers/sdd/reports/production-readiness-task-0a-report.md`
- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `src/test/vitest-config.test.ts`
- `src/app/chat/chat.rls.test.tsx`
- `src/app/checkin/checkin.rls.test.tsx`
- `src/app/admin/absensi/page.tsx`
- `src/app/api/admin/faq/embed/route.ts`
- `src/app/api/admin/faq/embed/embed.test.ts`

## Commands And Results

- Focused guards/config/route: `npx vitest run src/test/vitest-config.test.ts src/app/chat/chat.rls.test.tsx src/app/checkin/checkin.rls.test.tsx src/app/api/admin/faq/embed/embed.test.ts` passed 4 files and 51 tests.
- Lint: `npm run lint` passed with zero warnings.
- Typecheck: `npm run typecheck` passed.
- Full tests: `npm test` passed 42 files and 471 tests.
- Build: `npm run build` completed successfully with 44 static pages generated.
- Sequential gate: `npm run verify:baseline` passed lint, typecheck, all 471 tests, and the production build.

## Concerns

None. No dependencies were added, SQL remained unchanged, and no integration/E2E commands were added to the baseline gate.

## Review Fixes

- Hardened the chat guard to remove active line/block comments safely, select the final active named policy, isolate its balanced `USING` expression, reject any unconditional `true`, and independently require the complete ownership/service/admin expression for both `chat_sesi_owner_select` and `chat_pesan_owner_select`.
- Hardened the check-in guard with the same comment-aware final-policy extraction, isolated the balanced `WITH CHECK`, rejected unconditional `true`, and required the complete petugas/admin exemption OR `check_anon_rate('kunjungan_insert', 5, 60)` expression.
- RED: `npx vitest run src/app/chat/chat.rls.test.tsx src/app/checkin/checkin.rls.test.tsx` failed 4 tests as expected. Both `true OR ...` fixtures were incorrectly accepted, commented chat SQL was incorrectly selected, and the real check-in migration was rejected because its earlier commented policy was selected.
- GREEN: the same focused command passed 2 files and 41 tests.
- Verification: `npm run lint` passed with zero warnings; `npm run typecheck` passed; `npm test` passed 42 files and 474 tests.
