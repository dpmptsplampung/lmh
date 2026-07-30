# WP-21 Task 2 — Required Remediation

Apply all findings below only in:

- `supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql`
- `supabase/migrations/kunjungan_dual_write.test.ts`
- `supabase/migrations/migration-test-utils.ts` only if required for M16 (its filename/order must remain unchanged)

Do not touch production, app code, M15, docs, or `visit` data. Do not commit.

## 1. Make ticket eligibility status-safe

Never insert a `tiket_antrean` row with `status='terjadwal'`, because the M20
ticket constraint rejects it. Historical ticket backfill must require
`v.status <> 'terjadwal'` for every source origin. For a legacy walk-in that
was inserted `terjadwal` and later transitions to `menunggu`, the UPDATE branch
must atomically issue exactly one ticket, with no `waktu_scan` requirement.

## 2. Refuse unmappable legacy data before backfill

Before target-table backfill inserts, add preflight `DO` checks that raise clear
exceptions if either condition exists:

```sql
EXISTS (
  SELECT 1 FROM public.visit
  WHERE tujuan = 'loket' AND layanan_id IS NULL
)
```

```sql
EXISTS (
  SELECT 1 FROM public.visit
  WHERE tujuan = 'bertemu_seseorang'
    AND waktu_scan IS NOT NULL
    AND nama_yang_ditemui IS NULL
)
```

The error must stop the single transaction; do not invent a service or person,
and do not modify `visit`.

For trigger paths, raise a clear exception before ticket or guest-book writes
when a loket visit lacks `NEW.layanan_id`, or a meeting arrival lacks
`NEW.nama_yang_ditemui`.

## 3. Preserve the physical-arrival meaning of `buku_tamu`

Historical meeting rows go to `buku_tamu` only when `v.waktu_scan IS NOT NULL`.
The live UPDATE branch may create the guest-book row only on a transition to
`menunggu` with `NEW.waktu_scan IS NOT NULL`; otherwise it must not manufacture
an arrival record. Existing linked guest-book rows may still have their
`waktu_masuk` synchronized.

## 4. Add a DB backstop for one legacy visit → one ticket

Add nullable `tiket_antrean.legacy_visit_id uuid REFERENCES public.visit(id) ON
DELETE RESTRICT` and a unique constraint/index that permits multiple NULLs but
allows at most one non-null legacy visit ID. This must not constrain future
native multi-ticket behavior, which leaves the column NULL.

Historical ticket inserts set `legacy_visit_id = h.visit_id`. Trigger-created
tickets must capture the UUID returned by `public.terbit_tiket(...)` and set
that ticket's `legacy_visit_id = NEW.id` in the same transaction. Ticket lookup
and duplicate checks for transition synchronization use `legacy_visit_id`, not
only `(kunjungan_id, layanan_id)`.

## 5. Harden the static test

Extend M16 assertions to cover: transaction bounds; no legacy `visit` mutation
including `UPDATE`/`INSERT`/`TRUNCATE`; both preflight checks; historical ticket
status condition; meeting `waktu_scan` condition; new ticket legacy link/unique
backstop; counter repair; trigger update guard/row lock; `SECURITY DEFINER`
fixed search path/revoke; and direct `PUBLIC` schema-CREATE revoke.

## Verification

Run:

```powershell
npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts supabase/migrations/visit_spine.test.ts
```

Update `D:\Project\LMH\.superpowers\sdd\task-2-report.md` by appending a
remediation section with each finding, files changed, and the exact test result.
