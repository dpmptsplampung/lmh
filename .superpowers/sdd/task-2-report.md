# Task 2 Report: Database Migrations (Storage + Fixes)

## Status: DONE_WITH_CONCERNS

## What I Implemented

### File 1: `supabase/migrations/018_storage_buckets.sql`
Created two storage buckets with idempotent DO blocks and per-policy existence checks (PostgreSQL `CREATE POLICY` does not support `IF NOT EXISTS`).

1. **Private bucket `investment-docs`** (public = false)
   - 4 policies on `storage.objects` filtered by `bucket_id = 'investment-docs'`:
     - SELECT: `get_my_role() = 'admin'` (admin only)
     - INSERT: `get_my_role() = 'admin'` (admin only)
     - UPDATE: `get_my_role() = 'admin'` (admin only)
     - DELETE: `get_my_role() = 'admin'` (admin only)
   - No public SELECT policy — public access is exclusively via signed URLs generated server-side, as specified.

2. **Public bucket `umkm-photos`** (public = true)
   - 4 policies on `storage.objects` filtered by `bucket_id = 'umkm-photos'`:
     - SELECT: `USING (true)` — public read (no `TO authenticated`, accessible to all including anon)
     - INSERT: `get_my_role() IN ('admin', 'petugas')`
     - UPDATE: `get_my_role() IN ('admin', 'petugas')`
     - DELETE: `get_my_role() IN ('admin', 'petugas')`

Idempotency: Each bucket insert and each policy creation is wrapped in a `DO $$ ... END $$` block that checks `storage.buckets` / `pg_policies` for existence first.

### File 2: `supabase/migrations/019_fixes.sql`

1. **`updated_at` triggers for 5 tables** — uses existing `update_updated_at_column()` function (migration 016). Each uses `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`:
   - `trigger_chat_sesi_updated_at` on `chat_sesi`
   - `trigger_faq_knowledge_base_updated_at` on `faq_knowledge_base`
   - `trigger_listing_umkm_updated_at` on `listing_umkm`
   - `trigger_investment_documents_updated_at` on `investment_documents`
   - `trigger_reservasi_updated_at` on `reservasi`

2. **CHECK constraint on `pengunjung.kategori`** — DO block checks `pg_constraint` for `pengunjung_kategori_check` before adding `CHECK (kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor'))`.

3. **Fix layanan name mismatch in `landing_content`** — Updated the service title from "Balai Monitor SFR" to "BALMON" to match the `layanan` table (migration 015).

## Files Created
- `supabase/migrations/018_storage_buckets.sql` (116 lines)
- `supabase/migrations/019_fixes.sql` (59 lines)

## Verification Performed
- Confirmed `get_my_role()` exists as SECURITY DEFINER STABLE function (migration 003) — safe to use in storage policies.
- Confirmed `update_updated_at_column()` exists (migration 016) — reused, not redefined.
- Confirmed all 5 target tables have `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` columns:
  - `chat_sesi` (migration 005, line 13)
  - `faq_knowledge_base` (migration 005, line 42)
  - `listing_umkm` (migration 006, line 24)
  - `investment_documents` (migration 007, line 16)
  - `reservasi` (migration 009, line 22)
- Confirmed none of these 5 tables had an `updated_at` trigger in any prior migration.
- Confirmed `pengunjung.kategori` is `TEXT` with no CHECK constraint (migration 012, line 7).
- Confirmed `layanan` table has `'BALMON'` as a nama value (migration 015, line 7).

## Concerns

### Concern 1 (IMPORTANT): landing_content UPDATE — column values corrected from spec
The task spec's UPDATE statement used:
```sql
WHERE section = 'services' AND item_key = 'nama' AND item_value = 'Balai Monitor SFR';
```
However, the actual seed data in migration 016 uses:
- `section = 'service'` (singular, NOT `'services'`)
- `item_key = 'title'` (NOT `'nama'`)

The spec's WHERE clause would match **zero rows** and the fix would silently do nothing. I corrected the UPDATE to use the actual column values:
```sql
WHERE section = 'service' AND item_key = 'title' AND item_value = 'Balai Monitor SFR';
```
This is a deviation from the literal spec text but is necessary for the fix to actually work. Verify this matches the intent.

### Concern 2: get_my_role() returns NULL for anon users
`get_my_role()` does `SELECT role FROM petugas WHERE auth_user_id = auth.uid()`. For unauthenticated (anon) users, `auth.uid()` returns NULL, so the function returns NULL. This is fine for the admin-only policies (NULL ≠ 'admin' → denied) and the staff policies (NULL not IN list → denied). The public SELECT on `umkm-photos` is not gated on `get_my_role()`, so anon read works. No issue, but worth noting the function is NULL-safe by virtue of inequality comparisons.

### Concern 3: CHECK constraint may reject existing NULL values — but NULLs are allowed
The CHECK constraint `kategori IN ('UMKM', 'Umum', 'Instansi', 'Investor')` will pass for NULL values (CHECK constraints accept NULLs in PostgreSQL — NULL is treated as "unknown" which does not violate the constraint). So existing rows with `kategori = NULL` (the default) will not be rejected. Existing rows with invalid non-NULL values WOULD cause the `ALTER TABLE` to fail. Since `kategori` was only added in migration 012 with no seed data and is filled by app code, this should be safe — but if any existing data has an invalid value, the constraint addition will fail. No backfill/cleanup was done since the spec didn't request it.

### Concern 4: Storage policies are global on storage.objects
Storage bucket policies in Supabase are defined on the global `storage.objects` table and filtered by `bucket_id`. This is the standard Supabase pattern and matches how the `get_my_role()` function works (SECURITY DEFINER bypasses RLS recursion). The policies are correctly scoped by `bucket_id` in every USING/WITH CHECK clause.

## Commit
- `855515b` — feat: add storage buckets and database fixes migrations
