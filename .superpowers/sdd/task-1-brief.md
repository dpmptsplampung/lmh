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

