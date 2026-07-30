# WP-21 Backfill and Atomic Dual-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill legacy `visit` records and keep the legacy visit workflow atomically synchronized with `kunjungan`, `tiket_antrean`, and `buku_tamu` without changing any reader before WP-22.

**Architecture:** PostgreSQL owns the transition boundary. Forward migrations add traceable one-to-one links, backfill the current historical records deterministically, and use a `SECURITY DEFINER` trigger to synchronize new inserts and lifecycle updates in the same transaction as the legacy `visit` mutation. All application pages continue to read and write `visit`; the trigger covers direct browser writes, route-handler writes, and offline replay without a multi-request client transaction.

**Tech Stack:** Next.js 16.2.10, React 19.2.4, TypeScript 5, Vitest 4.1.10, Supabase/PostgreSQL, existing `exec_sql`/`exec_query` production helpers.

## Global Constraints

- Production DB is `krxzbputwaqkvmjflram.supabase.co`; record every DB mutation in `docs/analysis/DB-CHANGES.md` with an executable rollback.
- `visit` data is critical. Never delete or alter a legacy `visit` row during WP-21; it remains the read source and source of truth through WP-24.
- Apply the two DB migrations outside 08:00–15:30 WIB and only after a verified backup timestamp is recorded per `docs/BACKUP_RESTORE.md`.
- All date derivation uses `Asia/Jakarta`; a reservation’s operational date is `tanggal_rencana`, not its creation timestamp.
- Walk-in loket gets a ticket on insert. Reservasi loket gets a ticket only after scan changes it from `terjadwal` to `menunggu`. A meeting visitor gets `buku_tamu` only after physical scan.
- All `SECURITY DEFINER` functions use `SET search_path = pg_catalog, public` and have direct execution revoked from `PUBLIC`, `anon`, and `authenticated`.
- Do not deploy code that moves reads from `visit`; that work belongs exclusively to WP-22.
- Do not commit unless the user explicitly requests a commit.

---

## File Map

| File | Responsibility |
|---|---|
| `supabase/migrations/202607300014_buku_tamu.sql` | M15: create private guest-book storage and its legacy visit link/RLS. |
| `supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql` | M16: add `kunjungan.legacy_visit_id`, ledger, deterministic backfill, counter repair, atomic trigger functions. |
| `supabase/migrations/migration-test-utils.ts` | Register M15 and M16 so migration inventory remains exact. |
| `supabase/migrations/kunjungan_dual_write.test.ts` | Static contract tests for both migrations and the trigger’s security/idempotency rules. |
| `scripts/selftest-wp21.mjs` | Read-only/temporary production verifier for counts, links, trigger behavior, and cleanup. |
| `docs/analysis/05-IMPLEMENTATION-PLAN.md` | Correct WP-21’s former unconditional ticket/count rule. |
| `docs/analysis/06-MIGRATION-PLAN.md` | Record M15/M16 traceability, conditional invariant, and ledger-based rollback. |
| `docs/analysis/DB-CHANGES.md` | Production change entries for M15/M16 and their measured result. |
| `docs/DECISION_LOG.md` | Record QUE-04’s operational interpretation: reservation ticket at scan. |

## Task 1: Create the private `buku_tamu` migration and its static contract test

**Files:**
- Create: `supabase/migrations/202607300014_buku_tamu.sql`
- Create: `supabase/migrations/kunjungan_dual_write.test.ts`
- Modify: `supabase/migrations/migration-test-utils.ts:14-36`

**Interfaces:**
- Consumes: `public.visit(id)`, `public.petugas(id)`, `public.get_my_role()`.
- Produces: `public.buku_tamu` with `legacy_visit_id uuid UNIQUE`, private FO/Admin RLS, and index `idx_buku_tamu_legacy_visit_id`.

- [ ] **Step 1: Write the failing static migration test**

```ts
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_DIR, stripSqlComments } from './migration-test-utils';

const readMigration = (name: string) =>
  stripSqlComments(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));

describe('WP-21 atomic visit dual-write migrations', () => {
  it('creates a private buku_tamu that can trace its legacy visit', () => {
    const sql = readMigration('202607300014_buku_tamu.sql');
    expect(sql).toMatch(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?public\.buku_tamu/i);
    expect(sql).toMatch(/legacy_visit_id\s+uuid\s+UNIQUE\s+REFERENCES\s+public\.visit\(id\)\s+ON\s+DELETE\s+RESTRICT/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+public\.buku_tamu\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).toMatch(/CREATE\s+POLICY\s+buku_tamu_fo_admin_all[\s\S]*get_my_role\(\)\s+IN\s*\('admin','front_office'\)/i);
    expect(sql).not.toMatch(/FOR\s+SELECT\s+USING\s*\(\s*true\s*\)/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails because M15 is absent**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts`

Expected: FAIL with `ENOENT` for `202607300014_buku_tamu.sql`.

- [ ] **Step 3: Add M15**

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.buku_tamu (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legacy_visit_id uuid UNIQUE REFERENCES public.visit(id) ON DELETE RESTRICT,
  nama text NOT NULL,
  asal text,
  no_hp text,
  menemui_siapa text NOT NULL,
  keperluan text,
  waktu_masuk timestamptz NOT NULL DEFAULT now(),
  tanda_tangan_svg text,
  dicatat_oleh uuid REFERENCES public.petugas(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_buku_tamu_waktu ON public.buku_tamu(waktu_masuk DESC);
CREATE INDEX IF NOT EXISTS idx_buku_tamu_legacy_visit_id
  ON public.buku_tamu(legacy_visit_id) WHERE legacy_visit_id IS NOT NULL;

ALTER TABLE public.buku_tamu ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.buku_tamu TO authenticated;
DROP POLICY IF EXISTS buku_tamu_fo_admin_all ON public.buku_tamu;
CREATE POLICY buku_tamu_fo_admin_all ON public.buku_tamu FOR ALL TO authenticated
  USING (public.get_my_role() IN ('admin', 'front_office'))
  WITH CHECK (public.get_my_role() IN ('admin', 'front_office'));

COMMIT;
```

Append `'202607300014_buku_tamu.sql'` directly after `'202607290013_kunjungan_tiket.sql'` in `FORWARD_MIGRATION_FILES`.

- [ ] **Step 4: Run the focused migration tests**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts`

Expected: PASS; inventory includes M15 and the RLS contract has no public read policy.

## Task 2: Add the traceable backfill and atomic dual-write trigger

**Files:**
- Create: `supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql`
- Modify: `supabase/migrations/kunjungan_dual_write.test.ts`
- Modify: `supabase/migrations/migration-test-utils.ts:14-37`

**Interfaces:**
- Consumes: M15, `public.visit`, `public.kunjungan`, `public.tiket_antrean`, `public.terbit_tiket(uuid, uuid)`, and `public.antrean_counter`.
- Produces: `kunjungan.legacy_visit_id`, `wp21_backfill_ledger`, `sync_visit_dual_write()`, and trigger `trg_visit_dual_write`.

- [ ] **Step 1: Extend the failing static test for M16**

```ts
it('uses an idempotent, secured trigger instead of client-side sequential writes', () => {
  const sql = readMigration('202607300015_backfill_kunjungan_dual_write.sql');
  expect(sql).toMatch(/ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+legacy_visit_id\s+uuid/i);
  expect(sql).toMatch(/ADD\s+CONSTRAINT\s+kunjungan_legacy_visit_id_key\s+UNIQUE\s*\(legacy_visit_id\)/i);
  expect(sql).toMatch(/CREATE\s+TABLE\s+public\.wp21_backfill_ledger/i);
  expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.sync_visit_dual_write\s*\(\)/i);
  expect(sql).toMatch(/SECURITY\s+DEFINER[\s\S]*SET\s+search_path\s*=\s*pg_catalog\s*,\s*public/i);
  expect(sql).toMatch(/PERFORM\s+public\.terbit_tiket\s*\(/i);
  expect(sql).toMatch(/ON\s+CONFLICT\s*\(legacy_visit_id\)\s+DO\s+NOTHING/i);
  expect(sql).toMatch(/CREATE\s+TRIGGER\s+trg_visit_dual_write\s+AFTER\s+INSERT\s+OR\s+UPDATE/i);
  expect(sql).toMatch(/REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.sync_visit_dual_write\s*\(\)\s+FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i);
  expect(sql).toMatch(/REVOKE\s+CREATE\s+ON\s+SCHEMA\s+public\s+FROM\s+PUBLIC/i);
  expect(sql).not.toMatch(/(?:DELETE\s+FROM|DROP\s+TABLE)\s+public\.visit\b/i);
});
```

- [ ] **Step 2: Run the test to verify it fails because M16 is absent**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts`

Expected: FAIL with `ENOENT` for `202607300015_backfill_kunjungan_dual_write.sql`.

- [ ] **Step 3: Implement M16 in one transaction**

The migration must use this order and behavior:

```sql
BEGIN;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

ALTER TABLE public.kunjungan
  ADD COLUMN IF NOT EXISTS legacy_visit_id uuid REFERENCES public.visit(id) ON DELETE RESTRICT;
ALTER TABLE public.kunjungan
  DROP CONSTRAINT IF EXISTS kunjungan_legacy_visit_id_key;
ALTER TABLE public.kunjungan
  ADD CONSTRAINT kunjungan_legacy_visit_id_key UNIQUE (legacy_visit_id);

CREATE INDEX IF NOT EXISTS idx_kunjungan_legacy_visit_id
  ON public.kunjungan(legacy_visit_id) WHERE legacy_visit_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.wp21_backfill_ledger (
  visit_id uuid PRIMARY KEY REFERENCES public.visit(id) ON DELETE RESTRICT,
  kunjungan_id uuid REFERENCES public.kunjungan(id) ON DELETE RESTRICT,
  tiket_id uuid REFERENCES public.tiket_antrean(id) ON DELETE RESTRICT,
  buku_tamu_id uuid REFERENCES public.buku_tamu(id) ON DELETE RESTRICT,
  backed_up_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (kunjungan_id IS NOT NULL AND buku_tamu_id IS NULL)
    OR (kunjungan_id IS NULL AND tiket_id IS NULL AND buku_tamu_id IS NOT NULL)
  )
);
ALTER TABLE public.wp21_backfill_ledger ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON TABLE public.wp21_backfill_ledger TO authenticated;
DROP POLICY IF EXISTS wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger;
CREATE POLICY wp21_backfill_ledger_admin_read ON public.wp21_backfill_ledger
  FOR SELECT TO authenticated USING (public.get_my_role() = 'admin');
```

Before inserting any historical row, abort if the WP-20 target tables or the
ledger are non-empty. The successful `INSERT` must create `kunjungan` from
every source `visit` whose `tujuan = 'loket'`; map `tanggal` as
`COALESCE(v.tanggal_rencana, (v.waktu_masuk AT TIME ZONE 'Asia/Jakarta')::date,
(v.created_at AT TIME ZONE 'Asia/Jakarta')::date)`. For each source row,
preserve `pengunjung_id`, `nama`, `kontak_hp`, `asal`, `qr_token`, `status`,
`waktu_masuk`, `created_at`, and `updated_at`.

Create a ticket only for a walk-in, or for a reservation that is already past
`terjadwal`. Assign ticket values with this exact window expression and copy
the source lifecycle timestamps:

```sql
ROW_NUMBER() OVER (
  PARTITION BY v.layanan_id, k.tanggal
  ORDER BY COALESCE(v.waktu_masuk, v.created_at), v.id
)::int AS nomor
```

`nomor_display` must be `COALESCE(l.prefiks_antrean, upper(substr(l.nama, 1, 1))) || '-' || lpad(nomor::text, 3, '0')`.
Insert the same source IDs and generated target IDs in `wp21_backfill_ledger`,
then repair every affected counter with:

```sql
INSERT INTO public.antrean_counter (layanan_id, tanggal, nomor_terakhir)
SELECT layanan_id, tanggal, max(nomor)
FROM public.tiket_antrean
GROUP BY layanan_id, tanggal
ON CONFLICT (layanan_id, tanggal) DO UPDATE
  SET nomor_terakhir = GREATEST(
    public.antrean_counter.nomor_terakhir,
    EXCLUDED.nomor_terakhir
  );
```

Define `public.sync_visit_dual_write()` as `SECURITY DEFINER` with fixed
`search_path`, revoke direct execution, and attach it to `INSERT OR UPDATE` on
`public.visit`. On UPDATE, its first guard returns immediately unless at least
one of `status`, `waktu_masuk`, `waktu_scan`, `waktu_mulai_layan`, or
`waktu_selesai` changed. This avoids PostgreSQL's invalid column-qualified
multi-event trigger form while retaining the intended scope. Its insert control
flow is:

```plpgsql
IF TG_OP = 'INSERT' AND NEW.tujuan = 'loket' THEN
  INSERT INTO public.kunjungan (
    legacy_visit_id, pengunjung_id, nama, kontak_hp, asal, qr_token,
    tanggal, waktu_masuk, status, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.pengunjung_id, NEW.nama, NEW.kontak_hp, NEW.asal, NEW.qr_token,
    COALESCE(NEW.tanggal_rencana,
      (COALESCE(NEW.waktu_masuk, NEW.created_at) AT TIME ZONE 'Asia/Jakarta')::date),
    COALESCE(NEW.waktu_masuk, NEW.created_at), NEW.status, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (legacy_visit_id) DO NOTHING
  RETURNING id INTO v_kunjungan_id;

  SELECT id INTO v_kunjungan_id
  FROM public.kunjungan WHERE legacy_visit_id = NEW.id;

  IF NEW.asal = 'walk_in' AND NEW.status <> 'terjadwal' THEN
    PERFORM public.terbit_tiket(v_kunjungan_id, NEW.layanan_id);
  END IF;
END IF;
```

For every relevant loket update, lock and find the linked `kunjungan`; raise
`'Kunjungan dual-write tidak ditemukan untuk visit %'` if it is absent; update
its status, `waktu_masuk`, and `updated_at`. When an unscanned reservasi first
becomes `menunggu`, call `terbit_tiket` only if no ticket exists for that
kunjungan. Update the resulting ticket’s status, `waktu_mulai_layan`,
`waktu_selesai`, and `updated_at` without creating a second ticket. If an
existing ticket would be changed back to `terjadwal`, raise an exception because
that state is invalid for `tiket_antrean`.

For `bertemu_seseorang`, insert into `buku_tamu` only when a meeting visit first
becomes `menunggu`; use `NEW.nama`, `NEW.asal_instansi`, `NEW.kontak_hp`,
`NEW.nama_yang_ditemui`, `NEW.keperluan`, and
`COALESCE(NEW.waktu_scan, NEW.waktu_masuk, now())`. A later scan/update updates
the existing row’s `waktu_masuk` rather than adding a second guest-book row.

Close the migration with `COMMIT;`, then append
`'202607300015_backfill_kunjungan_dual_write.sql'` after M15 in
`FORWARD_MIGRATION_FILES`. Before recreating the trigger, use
`DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit;` so the forward
migration is safely rerunnable by the controlled runner.

- [ ] **Step 4: Run focused regression tests**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts supabase/migrations/visit_spine.test.ts`

Expected: PASS; the old baseline remains immutable, both forward migrations are registered, and the new trigger contract is present.

## Task 3: Add a production verifier that cleans up only its own data

**Files:**
- Create: `scripts/selftest-wp21.mjs`

**Interfaces:**
- Consumes: `.env.local` service-role credentials, `exec_query`, `exec_sql`, M15/M16 objects.
- Produces: console evidence for preflight distribution, historical coverage, conditional runtime behavior, and cleanup completion.

- [ ] **Step 1: Write a verifier test plan into the script as executable assertions**

The script accepts `--preflight` and must stop before mutation unless all target
preconditions pass. In this mode it queries only M20 objects already present in
production (`visit`, `kunjungan`, and `tiket_antrean`) so it can run before M15
creates `buku_tamu`:

```js
const preflight = await s.rpc('exec_query', {
  q: `SELECT tujuan, asal, status, count(*)::int AS n
      FROM public.visit
      GROUP BY tujuan, asal, status ORDER BY tujuan, asal, status`,
});
if (preflight.error) throw new Error(preflight.error.message);
console.log('distribusi visit:', JSON.stringify(preflight.data));

const targets = await s.rpc('exec_query', {
  q: `SELECT
        (SELECT count(*)::int FROM public.kunjungan) AS kunjungan_count,
        (SELECT count(*)::int FROM public.tiket_antrean) AS tiket_count,
        has_schema_privilege('PUBLIC', 'public', 'CREATE') AS public_can_create`,
});
if (targets.error) throw new Error(targets.error.message);
if (targets.data[0].kunjungan_count !== 0 || targets.data[0].tiket_count !== 0) {
  throw new Error('WP-21 dihentikan: target WP-20 tidak kosong');
}
console.log('PUBLIC dapat CREATE di public (harus false setelah M16):', targets.data[0].public_can_create);
```

It must next print and assert these historical queries:

```sql
SELECT count(*)::int AS visit_count FROM public.visit;
SELECT count(*)::int AS linked_kunjungan
FROM public.visit v JOIN public.kunjungan k ON k.legacy_visit_id = v.id
WHERE v.tujuan = 'loket';
SELECT count(*)::int AS orphan_kunjungan
FROM public.kunjungan k
LEFT JOIN public.visit v ON v.id = k.legacy_visit_id
WHERE k.legacy_visit_id IS NOT NULL AND v.id IS NULL;
SELECT count(*)::int AS counter_behind
FROM (
  SELECT t.layanan_id, t.tanggal, max(t.nomor) AS ticket_max,
         max(c.nomor_terakhir) AS counter_max
  FROM public.tiket_antrean t
  LEFT JOIN public.antrean_counter c USING (layanan_id, tanggal)
  GROUP BY t.layanan_id, t.tanggal
) x WHERE counter_max IS NULL OR counter_max < ticket_max;
```

- [ ] **Step 2: Exercise both trigger branches with identifiable temporary records**

Use a cryptographically random `runId`, a `SELFTEST_WP21_<runId>` name, and a
reservation dated to the next open day returned by `jadwal_berikutnya`. Create
one loket reservation, assert one linked `kunjungan` and zero tickets, then
update it to `menunggu` with `waktu_scan=now()` and assert exactly one ticket.
Repeat the same update and assert the ticket count remains one. Update it to
`dilayani` and `selesai`, then assert ticket status/timestamps equal the visit.

Create a second `bertemu_seseorang` reservation with the same unique run ID;
assert no `buku_tamu` before scan, update it to `menunggu`, then assert exactly
one `buku_tamu.legacy_visit_id` row. Never call a route or browser client for
this verification; use service-role SQL only.

- [ ] **Step 3: Make cleanup deterministic and guarded**

The script must delete child records before their source visits:

```sql
DELETE FROM public.tiket_antrean
WHERE kunjungan_id IN (
  SELECT id FROM public.kunjungan WHERE legacy_visit_id IN (
    SELECT id FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%'
  )
);
DELETE FROM public.kunjungan
WHERE legacy_visit_id IN (SELECT id FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%');
DELETE FROM public.buku_tamu
WHERE legacy_visit_id IN (SELECT id FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%');
DELETE FROM public.visit WHERE nama LIKE 'SELFTEST_WP21_%';
```

Before restoring or deleting an affected `antrean_counter` row, query that its
current value is exactly the saved pre-test value plus the verifier’s own ticket
count. If not, throw and leave the counter unchanged; this prevents overwriting
a concurrent real ticket. Print a final query proving no `SELFTEST_WP21_` row
remains.

- [ ] **Step 4: Run syntax and focused project checks**

Run: `node --check scripts/selftest-wp21.mjs; npm test -- supabase/migrations/kunjungan_dual_write.test.ts`

Expected: both commands exit 0.

## Task 4: Update transition records and apply with a production safety gate

**Files:**
- Modify: `docs/analysis/05-IMPLEMENTATION-PLAN.md:358-371`
- Modify: `docs/analysis/06-MIGRATION-PLAN.md:110-118`
- Modify: `docs/analysis/DB-CHANGES.md`
- Modify: `docs/DECISION_LOG.md`

**Interfaces:**
- Consumes: approved design `docs/superpowers/specs/2026-07-30-wp21-dual-write-design.md` and the finished M15/M16 files.
- Produces: accurate operator instructions and a reversible production record.

- [ ] **Step 1: Correct the WP-21 documentation before DB mutation**

Replace the unconditional wording “setiap insert visit baru juga menulis
kunjungan+tiket” with the approved conditional behavior. Replace the global
runtime count rule with the four conditional invariants from the design. Add
the ledger-based rollback: disable `trg_visit_dual_write`; use only
`wp21_backfill_ledger` to identify removable backfill rows; never delete
post-cutover data or `visit`.

Add a dated decision-log entry: “QUE-04 interpretation — reservasi loket
menerima tiket hanya saat scan fisik; reservasi yang masih terjadwal tidak
memegang nomor antrean.”

- [ ] **Step 2: Capture production preflight and a manual backup**

Run `node scripts/selftest-wp21.mjs --preflight`, record its output and
the manual backup/PITR timestamp in the pending WP-21 entry of
`docs/analysis/DB-CHANGES.md`, and stop if either `kunjungan` or
`tiket_antrean` is not empty or `PUBLIC` can create objects in schema `public`.
Confirm the work is outside 08:00–15:30 WIB and that `public` remains exposed
in the Supabase Data API settings before relying on the new tables through
PostgREST.

- [ ] **Step 3: Apply M15, then M16, with the existing controlled runner**

Run sequentially:

```powershell
node scripts/apply-migration.mjs supabase/migrations/202607300014_buku_tamu.sql
node scripts/apply-migration.mjs supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql
```

Expected: each command reports `Migrasi diterapkan`. If M16 fails, do not retry
blindly; capture the exact error, verify transaction rollback, and inspect
counts before choosing rollback or correction.

- [ ] **Step 4: Verify production and finalize the DB log**

Run: `node scripts/selftest-wp21.mjs`

Expected: historical links/counters are valid, each branch proves the expected
0→1 ticket or guest-book transition without duplicates, and every self-test row
is removed. Then mark both DB log entries `DITERAPKAN`, recording observed
counts, trigger/function names, backup timestamp, and the ledger-based
rollback commands.

- [ ] **Step 5: Run the narrow codebase validation**

Run: `npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts; npm run typecheck`

Expected: all selected migration tests and TypeScript checks pass. Do not run a
project-wide build unless a changed TypeScript file or focused check fails.

## Task 5: Handoff criteria for WP-22

**Files:**
- Modify: `docs/analysis/DB-CHANGES.md`

**Interfaces:**
- Consumes: successful M15/M16 self-test results.
- Produces: a clear boundary that permits only read migration work in WP-22.

- [ ] **Step 1: Record the WP-21 cutover facts**

In the final M16 DB log entry, record: the original `visit` count and status
distribution, the linked historical `kunjungan` and ticket counts, zero orphan
links, zero lagging counters, and the timestamp at which
`trg_visit_dual_write` became active.

- [ ] **Step 2: Record the rollback window**

State explicitly that `visit` remains readable/writable; rollback before WP-22
is `DROP TRIGGER trg_visit_dual_write ON public.visit` plus ledger-scoped
cleanup only if no valid post-cutover row requires retention. If production
traffic exists after the trigger is enabled, preserve the new linked rows and
roll back only behavior by dropping the trigger.

- [ ] **Step 3: Validate the handoff boundary**

Run: `node scripts/selftest-wp21.mjs`

Expected: it reports all conditional invariants as true and leaves no self-test
records. Only after this result may WP-22 migrate one reader at a time; do not
change `/checkin` or the queue dashboard reader first.

## Plan Self-Review

- **Spec coverage:** M15 guest-book privacy, M16 legacy linkage, deterministic backfill, counter repair, trigger atomicity, reservasi-at-scan issuance, lifecycle synchronization, idempotency, production backup, verification, and rollback are each assigned to Tasks 1–5.
- **Placeholder scan:** No task has unfinished markers or a generic testing instruction; each has exact file paths, SQL/test contracts, and commands.
- **Type consistency:** All references use `legacy_visit_id`, `wp21_backfill_ledger`, `sync_visit_dual_write()`, and `trg_visit_dual_write` consistently. Ticket issuance calls the existing `terbit_tiket(uuid, uuid)` signature.
