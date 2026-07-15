# Production Readiness Gate 1B Report

**Status:** `DONE_WITH_CONCERNS`

Gate 1B hardens remaining security gaps on the never-deployed five-file baseline (in-place edits preferred) without renumbering/replacing Gates 0A/0B/1A.

## Scope

1. Profile kategori UI/DB alignment (`KATEGORI_PENGUNJUNG`)
2. Remove service-role rate-limit bypass on lead/inquiry
3. Consent ownership policy + route assertion
4. Audit PII redaction
5. Notification atomic claim/complete
6. PDF upload magic-byte validation + cleanup
7. Docs

## Approach

- Prefer in-place edits to:
  - `supabase/migrations/202607140003_feature_schema.sql`
  - `supabase/migrations/202607140004_security_and_automation.sql`
- No 6th forward migration (project never deployed).
- Strict TDD: focused tests written RED, then implementation GREEN.

## Files Changed

### Schema / SQL
- `supabase/migrations/202607140003_feature_schema.sql` — notifikasi claim columns, processing status, idempotency unique index
- `supabase/migrations/202607140004_security_and_automation.sql` — consent ownership, audit allowlist, claim/complete RPCs, queue idempotency keys

### App
- `src/lib/constants.ts` — `KATEGORI_PENGUNJUNG`
- `src/components/ProfileCompletenessGate.tsx` — options from constant only
- `src/app/api/investasi/lead/route.ts` — auth required, no service-role bypass, 429 on RLS/rate
- `src/app/api/umkm/inquiry/route.ts` — same
- `src/app/api/notif/send/route.ts` — claim → send → complete
- `src/app/api/notif/retry/route.ts` — claim(failed) → send → complete
- `src/app/api/investment-docs/upload/route.ts` — magic bytes, page cap, cleanup
- `src/app/checkin/page.tsx` / `src/app/chat/page.tsx` — consent guard

### Tests
- `src/lib/constants.test.ts`
- `src/components/ProfileCompletenessGate.test.tsx`
- `src/app/api/investasi/lead/route.test.ts`
- `src/app/api/umkm/inquiry/route.test.ts`
- `src/app/api/notif/send/send.test.ts`
- `src/app/api/notif/retry/retry.test.ts`
- `src/app/api/investment-docs/upload/upload.test.ts`
- `src/app/checkin/consent.ownership.test.ts`
- `src/app/chat/consent.ownership.test.ts`
- `supabase/migrations/security_hardening_1b.test.ts`

### Docs
- `docs/MIGRATIONS.md`
- this report

## TDD Evidence

### RED

Command:

```text
npx vitest run src/lib/constants.test.ts src/components/ProfileCompletenessGate.test.tsx src/app/api/investasi/lead/route.test.ts src/app/api/umkm/inquiry/route.test.ts supabase/migrations/security_hardening_1b.test.ts src/app/api/notif/send/send.test.ts src/app/api/notif/retry/retry.test.ts src/app/api/investment-docs/upload/upload.test.ts src/app/checkin/consent.ownership.test.ts src/app/chat/consent.ownership.test.ts
```

Observed before implementation:

```text
Test Files  10 failed (10)
Tests       35 failed | 37 passed (72)
```

### GREEN

Same focused suite after implementation:

```text
Test Files  10 passed (10)
Tests       72 passed (72)
```

Full suite:

```text
Test Files  57 passed (57)
Tests       383 passed (383)
```

## Verification Commands

```text
npm run lint        # exit 0
npm run typecheck   # exit 0
npm test            # 383/383 pass
npm run build       # exit 0
```

## Concerns

- Docker/SQL execution not claimed (local Supabase engine may be unavailable); contracts are static SQL/text tests only.
- `audit_change` uses EXCEPTION blocks for optional columns (status/role) on heterogeneous trigger targets.
- Partial unique `ON CONFLICT` for `idempotency_key` relies on PostgreSQL partial unique index inference.
- `RATE_LIMIT_HMAC_SECRET` not added (stayed with auth.uid() RLS rate only after removing service bypass).
- UMKM inquiry admin approve path (`inquiry/[id]`) still has intentional service-role fallback for owner/admin updates — out of Gate 1B insert-bypass scope.

## Review Fixes

Important finding: check-in API wrote consent without assertion.

- src/app/api/checkin/route.ts now requires consent_given: true for authenticated callers before any consent_log insert.
- Offline enqueue carries consent_given + ersi_kebijakan from the form checkbox.
- Tests: src/app/api/checkin/route.test.ts (RED then GREEN).

**Re-check:** full suite 58 files / 385 tests pass; lint/typecheck pass.
