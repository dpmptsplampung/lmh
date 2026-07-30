## Recovery Task 1a: Restore the WP-21 red test

**Files:**
- Modify only: `supabase/migrations/kunjungan_dual_write.test.ts`

**Goal:** Correct the interrupted test stub so it targets the approved M15
filename and demonstrably fails because the migration has not yet been created.

**Required change:** Replace only
`2026073000014_buku_tamu.sql` with `202607300014_buku_tamu.sql`.

**Verification:** Run:

```powershell
npm test -- supabase/migrations/kunjungan_dual_write.test.ts
```

The test must fail with `ENOENT` for
`202607300014_buku_tamu.sql`. Do not create the migration, alter the migration
inventory, write application code, touch production, or modify any other file.

**Report:** Write full evidence to
`D:\Project\LMH\.superpowers\sdd\task-1a-report.md`, including the changed
line and exact failing command/output summary. Do not commit.
