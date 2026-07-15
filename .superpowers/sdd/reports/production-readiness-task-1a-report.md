# Production Readiness Gate 1A Report

**Status:** `DONE_WITH_CONCERNS`

Gate 1A replaces the never-deployed development history with five dependency-ordered final-state migrations. Static contracts, repository verification, and the production build pass. Database reset and local Supabase lint remain blocked because the Docker Desktop Linux engine is unavailable.

## Active Baseline

The active migration directory contains exactly:

1. `202607140001_extensions_and_preflight.sql`
2. `202607140002_core_schema.sql`
3. `202607140003_feature_schema.sql`
4. `202607140004_security_and_automation.sql`
5. `202607140005_views_and_jobs.sql`

The 38 old SQL files were removed from the active directory and were not copied elsewhere. Git history remains the archive.

## History Mapping

| Old migration | Final baseline destination or disposition |
|---|---|
| `001_fase1_layanan_kunjungan.sql` | `002`: final `layanan` and individual-account `petugas`; legacy `kunjungan` omitted in favor of final `visit`. |
| `002_fase1_absensi_mitra.sql` | Shared-account `kehadiran_layanan` omitted; final individual attendance is `absensi_petugas` in `002`. |
| `003_fase1_rls_policies.sql` | `004`: final helper functions and RLS; policies for retired tables omitted. |
| `004_fase2_log_fifo.sql` | `antrian_helpdesk` retired; final queue projection is `v_antrian_loket` in `005`. |
| `005_fase3_chat.sql` | `003`: final chat/FAQ tables; `004`: ownership-scoped chat RLS and automation. |
| `006_fase4_umkm.sql` | `003`: final two-sided listing table without `edit_token`; `004-005`: owner RLS and allowlisted public projection. |
| `007_fase4_investment.sql` | `003`: final investment document table; `004`: metadata RLS and private storage policy. |
| `008_pengunjung.sql` | `002`: final `pengunjung`, including profile, category, and retention timestamps. |
| `009_reservasi.sql` | Legacy table omitted; reservation lifecycle integrated directly into `visit` in `002`. |
| `010_walkin_asal_instansi.sql` | `002`: `visit.asal_instansi` integrated in initial `CREATE TABLE`. |
| `011_update_layanan.sql` | Final service rows moved to production-safe `supabase/seed.sql`. |
| `012_pengunjung_profile_completeness.sql` | `002`: final columns and category constraint integrated directly. |
| `013_create_petugas_accounts.sql` | Completely omitted; no Auth users or hardcoded credentials are created. |
| `014_absensi_petugas.sql` | `002`: final attendance table; `004`: self/admin RLS. |
| `015_update_layanan.sql` | Service rows moved to `seed.sql`; historical Auth users omitted. |
| `016_site_settings_landing_content.sql` | `002`: final config/content tables; safe defaults moved to `seed.sql`; `004`: RLS and timestamp triggers. |
| `017_investment_documents_extend.sql` | `003`: final columns integrated directly; demo/Unsplash rows omitted from production baseline. |
| `018_storage_buckets.sql` | `004`: final private `investment-docs` and public `umkm-photos` buckets/policies. |
| `019_fixes.sql` | Final constraints and timestamp triggers integrated in `002-004`; no corrective ALTER cycle. |
| `020_storage_raw_private.sql` | `004`: only path-scoped `_raw`/`pages` investment policies; no redundant broad policy. |
| `021_chat_idor_fix.sql` | Final ownership columns are in `003`; secure policies are created once in `004`; insecure chat policies never exist. |
| `022_anon_rate_limit.sql` | `003`: final rate table; `004`: fixed-path helpers, grants, policies, and final-table triggers. |
| `023_revoke_hardcoded_accounts.sql` | Omitted because forbidden users are never created; no cleanup DELETE is needed. |
| `024_umkm_magic_link.sql` | `003`: final owner mapping; `004`: owner policies; no backfill and no deprecated token. |
| `025_layanan_tipe.sql` | `002`: `tipe` and constraint integrated directly; final values are in `seed.sql`. |
| `026_update_wa_number.sql` | Omitted; no placeholder or unverified phone number is seeded. |
| `027_jwt_role_claim.sql` | `004`: fixed-search-path `set_user_role_claim` with restricted execution. |
| `028_audit_consent.sql` | `003`: final audit/consent tables; `004`: final-table audit and retention functions/triggers; `005`: cron job. |
| `029_visit_spine.sql` | `002`: final `visit` table; `004`: final RLS/automation. All dual-write and backfill history omitted. |
| `030_skm.sql` | `003`: final SKM table; `004`: RLS and restricted/public aggregation RPC. |
| `031_skm_unique_visit.sql` | `003`: partial unique visit index created with the table. |
| `032_antrean_estimasi.sql` | `005`: materialized/live views, restricted refresh function, and idempotent cron schedule. |
| `033_notifikasi.sql` | `003`: final notification queue; `004`: RLS, private helpers, and final-table notification triggers. |
| `034_push_subscriptions.sql` | `003`: final push table/indexes; `004`: user-scoped RLS. |
| `035_faq_embedding.sql` | `001`: vector prerequisite; `003`: vector column/index and AI log; `004`: restricted `match_faq`. |
| `036_anon_rate_prune.sql` | `004`: fixed-path prune helper; `005`: idempotent daily schedule. |
| `037_investasi_lead.sql` | `003`: final lead table; `004`: RLS, timestamps, audit, and rate accounting. |
| `038_umkm_dua_sisi.sql` | `003`: final `sisi` and inquiry schema; `004`: owner/rate RLS; `005`: safe public and match views. |

## Omitted History

- Retired objects: `kunjungan`, `reservasi`, `kehadiran_layanan`, and `antrian_helpdesk`.
- All source-to-visit dual-write functions, triggers, and data backfills.
- `listing_umkm.edit_token` and its index.
- Historical Auth user/identity inserts, `password123`, and cleanup DELETE statements.
- Production demo rows, Unsplash URLs, and placeholder WhatsApp numbers.
- Historical ALTER, create/drop, policy drop/recreate, and rollback-comment cycles.
- Public base-table UMKM SELECT and insecure `USING (true)` chat SELECT policies.

## Security Result

- All baseline `SECURITY DEFINER` functions set a fixed safe `search_path`, revoke execution from `PUBLIC`, `anon`, and `authenticated`, then grant only required callers.
- Public UMKM reads use `v_umkm_public`, a security-invoker allowlisted projection backed by a narrowly granted read function. The view excludes all `kontak_*`, owner mapping, snapshot, and token data. The base table has no public SELECT policy or grant.
- `visit` owners can SELECT their rows but cannot directly UPDATE them. Service-scoped staff and admins retain UPDATE access.
- `investment-docs` is private with admin policies restricted to `_raw` and `pages`; no broad permissive policy remains. `umkm-photos` remains public-read with staff writes.
- Rate/notification/state-transition atomic hardening remains intentionally deferred to Gate 1B.

## Seed Result

`supabase/seed.sql` contains exactly nine final services with explicit type and chatbot flags, safe site defaults, and safe landing defaults. It contains no Auth users, credentials, demo documents, Unsplash data, or phone-number placeholder. `supabase/seed-demo.sql` remains explicitly development/staging-only.

## TDD Evidence

### RED

Command:

```text
npx vitest run supabase/migrations src/app/chat/chat.rls.test.tsx src/app/checkin/checkin.rls.test.tsx src/app/umkm/umkm.rls.test.ts
```

Observed against the old migration set before baseline implementation:

```text
Test Files  15 failed (15)
Tests       24 failed | 14 passed (38)
```

Expected failures included the exact `38` versus `5` inventory mismatch, missing approved baseline files, old seed shape, and old filename/RLS contracts.

An additional runtime contract was observed RED before switching the public marketplace query:

```text
npx vitest run src/app/umkm/umkm.rls.test.ts
Test Files  1 failed (1)
Tests       1 failed | 2 passed (3)
```

### GREEN

Final focused command and result:

```text
npx vitest run supabase/migrations src/app/chat/chat.rls.test.tsx src/app/checkin/checkin.rls.test.tsx src/app/umkm/umkm.rls.test.ts
Test Files  15 passed (15)
Tests       64 passed (64)
```

## Verification

| Command | Result |
|---|---|
| `npm run lint` | PASS, ESLint exited with no warnings/errors. |
| `npm run typecheck` | PASS, `tsc --noEmit`. |
| Focused migration/RLS command above | PASS, 15 files / 64 tests. |
| `npm test` | PASS, 49 files / 366 tests. |
| `npm run build` | PASS, Next.js production build generated 44 static pages. |
| `npm run verify:baseline` | PASS; reran lint, typecheck, 366 tests, and production build in one command. |
| `git diff --check` | PASS; no whitespace errors. Git emitted only existing Windows LF/CRLF conversion warnings. |
| Active SQL inventory | PASS; exactly the five approved filenames. |
| Forbidden active SQL scan | PASS; no old created objects, dual-write names, `edit_token`, credentials, demo URLs, placeholder phone, insecure chat SELECT, or public UMKM base SELECT. |

## Database Execution Blocker

`supabase status` was attempted and returned:

```text
failed to inspect container health: error during connect:
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

Therefore the following were not executed and are not claimed:

- `supabase db reset`
- `supabase db lint --local --level warning`
- Runtime SQL execution against PostgreSQL/Supabase

Run those checks when Docker is available. No Supabase development dependency or config was added.

## Files

- Added the five SQL baseline files under `supabase/migrations/`.
- Added `supabase/migrations/migration-test-utils.ts`.
- Updated all migration contract tests and the chat/check-in/UMKM RLS contracts.
- Updated `supabase/seed.sql`; retained `supabase/seed-demo.sql` as explicit non-production data.
- Updated `src/app/umkm/page.tsx` to use the safe public view and removed public contact rendering.
- Updated semantic baseline comments in check-in, UMKM edit-link, and SKM runtime files.
- Updated `README.md` and added `docs/MIGRATIONS.md`.
- Removed all 38 old active SQL migration files.

Unrelated readiness work already present in the dirty worktree was left unchanged.

## Review Fixes

Prior review required functional and coverage fixes. Applied and re-reviewed:

1. Reservation inserts `visit.nama` from canonical `pengunjung.nama` (`src/app/me/reservasi/page.tsx` + `reservasi.test.tsx`).
2. Public UMKM inquiry verifies listings via `v_umkm_public`.
3. SKM uses token RPCs `get_skm_context` / `submit_skm_response`; page and submit route are token-only.
4. Auth hook is `set_user_role_claim(event jsonb) RETURNS jsonb` with `app_metadata.role` and `supabase_auth_admin` grant only.
5. `docs/MIGRATIONS.md` documents `supabase db push --include-all --include-seed`.
6. Final-invariant migration coverage restored for visit, notifikasi, audit/consent, SKM, FAQ, and antrean estimasi.
7. Exactly five baseline SQL files; no hardcoded passwords, legacy tables, or `edit_token`.

**Re-review:** Spec compliance APPROVED, Code quality APPROVED (2026-07-15). Residual only: Docker unavailable for live SQL execution.

**Verification after fixes:** `npm test` 52 files / 373 tests pass; lint 0 warnings; typecheck pass.
