# Backup & Restore

## Before migrate / deploy

1. **Supabase Dashboard** → Project → **Database** → **Backups** → create a manual backup (or confirm PITR window is acceptable).
2. Record the backup timestamp and who authorized the change.
3. Prefer applying schema with CLI on a **fresh** project or after restore to empty baseline — see `docs/MIGRATIONS.md`.

## Restore

| Scenario | Action |
|---|---|
| Accidental data loss | Supabase Dashboard → Database → Backups → restore point-in-time or download backup (plan-dependent) |
| Failed migration on empty project | Drop/recreate project or reset local with `supabase db reset`, then `supabase db push --include-all --include-seed` |
| App-only rollback | Redeploy previous Vercel deployment; DB restore only if schema/data was changed |

Do **not** re-paste historical `001`–`038` SQL. Active baseline is the five `20260714000x_*.sql` files only.

## RPO / RTO

| Metric | Status |
|---|---|
| **RPO** (recovery point objective) | **TBD** — ownership: DPMPTSP ops + DPO; depends on Supabase plan backup frequency |
| **RTO** (recovery time objective) | **TBD** — ownership: DPMPTSP ops; target after first staging drill |

Until formal numbers exist, treat every production schema change as requiring a verified backup and a named operator on call.
