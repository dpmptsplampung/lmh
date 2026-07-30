# WP-21 Phase 2 — Task 2 report

## TDD red evidence

The M16 contract test was added before the migration existed, then run with:

```text
npm test -- supabase/migrations/kunjungan_dual_write.test.ts
```

Result: failed as expected with:

```text
Error: ENOENT: no such file or directory, open
'D:\Project\LMH\supabase\migrations\202607300015_backfill_kunjungan_dual_write.sql'
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
```

## Implementation

- Added M16 as one `BEGIN`/`COMMIT` transaction.
- Revoked `PUBLIC` schema creation, added nullable unique `kunjungan.legacy_visit_id`, and created its partial index.
- Created an RLS-protected, admin-read-only backfill ledger. Its creation is idempotently guarded, while the subsequent empty-target precondition rejects any partial/repeated backfill.
- Locked source and target tables during the backfill-to-trigger handoff, deterministically migrated loket and meeting records, issued only eligible historical tickets with the specified window ordering, recorded source/target IDs, and repaired counters.
- Added a fixed-search-path `SECURITY DEFINER` trigger function, revoked direct execution, and recreated the `AFTER INSERT OR UPDATE` trigger safely.
- Registered M16 immediately after M15 and added the approved static M16 contract test.

## Self-review

- **Execution order:** DDL/security setup precedes locks and the empty-table guard; backfill, ledger entries, and counter repair precede function/trigger installation; `COMMIT` is last.
- **RLS:** the ledger has RLS enabled, grants only `authenticated` SELECT, and applies an authenticated admin-only SELECT policy. No anon/public table access was granted.
- **Exception behavior and rollback:** there are no exception handlers that swallow failures. Missing loket linkage and an attempted ticket transition to `terjadwal` raise exceptions. All DDL, backfill work, and trigger installation are covered by the single transaction, so an error rolls back the migration and the triggering source DML.
- **Duplicate prevention:** `legacy_visit_id` is unique; inserts use `ON CONFLICT`; loket updates lock the linked `kunjungan` and check for an existing service ticket before issuance; meeting rows use the unique legacy link with conflict handling.
- **Legacy preservation:** M16 contains no `UPDATE`, `DELETE`, or `DROP` against `public.visit`.

## Exact files changed

- `supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql` — created M16.
- `supabase/migrations/kunjungan_dual_write.test.ts` — added the M16 static contract test first.
- `supabase/migrations/migration-test-utils.ts` — registered M16 after M15.
- `.superpowers/sdd/task-2-report.md` — replaced with this required report.

No application code or repository `docs/` files were changed, and no commit was created.

## Green verification

```text
npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts supabase/migrations/visit_spine.test.ts

Test Files  3 passed (3)
Tests       16 passed (16)
```

## Production database confirmation

No database command, Supabase migration command, or production connection was run. Verification was limited to the focused static Vitest suite, as required.

## Concerns

The SQL was deliberately not executed against any database because applying a migration was explicitly prohibited. Runtime behavior therefore remains to be exercised in an approved non-production migration environment.

## Remediation evidence — independent review findings

### Red evidence

The M16 static contract was extended before changing the migration and run with:

```text
npm test -- supabase/migrations/kunjungan_dual_write.test.ts
```

It failed as expected because M16 did not yet define the required
`tiket_antrean.legacy_visit_id` column/backstop:

```text
AssertionError: expected ... to match
/ALTER\s+TABLE\s+public\.tiket_antrean\s+ADD\s+COLUMN...legacy_visit_id.../
Test Files  1 failed (1)
Tests       1 failed | 1 passed (2)
```

### Finding 1 — status-safe ticket eligibility

- Historical ticket selection now has an unconditional `v.status <> 'terjadwal'` predicate, so neither origin can insert an invalid ticket status.
- A `walk_in` transitioning from `terjadwal` to `menunggu` now issues one ticket in the UPDATE branch without any `waktu_scan` predicate.
- The existing reservation path remains scan-gated, and all transition duplicate checks use the source visit UUID.

### Finding 2 — unmappable legacy-data preflight and trigger guards

- Added locked, pre-backfill `DO` checks that abort for a loket source row without `layanan_id` or a scanned meeting source row without `nama_yang_ditemui`.
- Added clear trigger exceptions before target writes for a loket `NEW.layanan_id` omission and a scanned meeting with no `NEW.nama_yang_ditemui`.
- The checks only read `public.visit`; no legacy source data is altered.

### Finding 3 — physical-arrival guest-book semantics

- Historical `buku_tamu` insertion now requires `v.waktu_scan IS NOT NULL`.
- Live meeting creation requires both the first `menunggu` state and `NEW.waktu_scan IS NOT NULL`.
- Existing linked guest-book rows continue to synchronize `waktu_masuk`; an unlinked row is not manufactured without the required state transition and scan.

### Finding 4 — one-ticket legacy backstop

- Added nullable `public.tiket_antrean.legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT` plus `UNIQUE (legacy_visit_id)`. PostgreSQL unique constraints allow multiple NULLs, so future native multi-ticket rows remain unconstrained when this field is NULL.
- Historical ticket insertion stores `h.visit_id`; ledger lookup joins tickets by that legacy visit UUID.
- Trigger issuance captures the UUID returned by `public.terbit_tiket(...)`, writes that ticket's `legacy_visit_id = NEW.id` in the same transaction, and uses the legacy UUID for duplicate checks and synchronization lookup.

### Finding 5 — hardened static contract

The M16 test now asserts transaction bounds; no legacy `visit` mutation (including INSERT, UPDATE, or TRUNCATE); both source preflight checks; status-safe historical eligibility; scanned-meeting backfill; the nullable ticket legacy link and unique constraint; ticket linking after issuance; counter repair; lifecycle guard and row lock; fixed-path `SECURITY DEFINER` revocation; and the `PUBLIC` schema-CREATE revoke.

### Exact remediation files changed

- `supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql` — remediated M16 only.
- `supabase/migrations/kunjungan_dual_write.test.ts` — extended M16 static contract only.
- `.superpowers/sdd/task-2-report.md` — appended this required remediation evidence.

`migration-test-utils.ts` required no further change; M16's registered filename and ordering remain unchanged. M15, application code, and repository `docs/` files were not touched, and no commit was created.

### Green verification

```text
npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts supabase/migrations/visit_spine.test.ts

Test Files  3 passed (3)
Tests       16 passed (16)
```

### Production database confirmation

No database command, Supabase migration command, or production connection was run during remediation. No migration was applied; verification was limited to the focused static Vitest suite.
