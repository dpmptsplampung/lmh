# LMH 2.0 Deploy Runbook

Ordered checklist for staging/production. **Backup before any schema apply**
(`docs/BACKUP_RESTORE.md`).

Baseline schema is **five** final-state migrations + production seed — **not**
a paste loop of historical files `020`–`038`.

---

## Section 1: Environment Variables

Copy `.env.example` → `.env.local` (local) and set the same keys in Vercel
(Production / Preview as needed). Full notes: `docs/ENVIRONMENT_VARIABLES.md`.

```
APP_ENV=production
APP_VERSION=<git sha or release tag>

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

RESEND_API_KEY=re_...
RESEND_FROM=DPMPTSP Lampung <noreply@your-verified-domain>
CRON_SECRET=...
NEXT_PUBLIC_PUBLIC_URL=https://lmh.example

VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # same as VAPID_PUBLIC_KEY

GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004
```

> **Security:** Never expose `SUPABASE_SERVICE_ROLE_KEY` or `VAPID_PRIVATE_KEY`
> with a `NEXT_PUBLIC_` prefix.

---

## Section 2: Supabase Dashboard (before first traffic)

1. **Extensions** — enable what baseline preflight requires (typically
   `pgvector`, `pg_cron` / related). Confirm against
   `202607140001_extensions_and_preflight.sql`.
2. **Anonymous Sign-In** — Authentication → Providers → Anonymous → On  
   (check-in and public flows that mint temp sessions).
3. **Auth Hook (JWT role claim)** — wire `public.set_user_role_claim` (or the
   function name installed by baseline) so staff RLS can use role claims.
4. **Site URL + redirect allow-list** — production app origin (magic-link
   redirects for UMKM edit / invites).
5. **Resend domain** — domain in `RESEND_FROM` must be **verified** in Resend.
   Magic-link and notification email **will fail** without this.
6. **Consent / privacy URL** — confirm `https://<prod>/kebijakan-privasi`
   loads and matches checkin/chat consent links (`CONSENT_VERSION` / policy
   version `1.0`).

---

## Section 3: Apply migrations (5 baselines — CLI)

**Do not** paste legacy `001`–`038` SQL in the Dashboard.

On a **fresh / empty** linked project (Supabase CLI ≥ 2.107 recommended):

```bash
supabase link --project-ref <ref>
supabase db push --include-all --include-seed
```

This applies, in order:

1. `202607140001_extensions_and_preflight.sql`
2. `202607140002_core_schema.sql`
3. `202607140003_feature_schema.sql`
4. `202607140004_security_and_automation.sql`
5. `202607140005_views_and_jobs.sql`
6. Production seed: `supabase/seed.sql` (services/config only — **no** demo
   passwords, **no** fake WA, **no** Auth users)

Local full reset:

```bash
supabase db reset
```

Rules: `docs/MIGRATIONS.md`. After first apply, baselines are immutable;
further schema changes are **new** timestamped forward migrations only.

**Never** run `seed-demo.sql` in production.

### First staff accounts

There is no shared `password123` seed. Create admins/petugas via the invite
flow (`POST /api/admin/petugas/invite` as an existing admin, or bootstrap per
your org process). Complete magic-link / set password before go-live.

---

## Section 4: Vercel (or host) deployment

1. Set all Section 1 env vars for Production (and Preview if used).
2. Generate VAPID: `npx web-push generate-vapid-keys`.
3. Deploy (`git push` with Git integration or `vercel --prod`).
4. Cron: `vercel.json` schedules `/api/notif/send` and `/api/notif/retry` —
   ensure `Authorization: Bearer <CRON_SECRET>`.

---

## Section 5: Post-deploy health + smoke

### Health endpoints

```bash
# Liveness (process up)
curl -sS "$BASE_URL/api/health/live"
# Expect 200 + JSON status live

# Readiness (deps / config as implemented)
curl -sS "$BASE_URL/api/health/ready"
```

Or:

```bash
BASE_URL=https://your-app.example npm run smoke
```

(`scripts/smoke.mjs` — skips network if `BASE_URL` unset.)

### Functional smoke (manual)

- [ ] Anon check-in → appears in admin antrian  
- [ ] Chat session isolation  
- [ ] SKM submit → IKM path  
- [ ] UMKM / petugas magic-link email arrives (**Resend domain required**)  
- [ ] Gallery page-images watermarked; no raw PDF exfil  
- [ ] Privacy page `/kebijakan-privasi` from consent UIs  
- [ ] Invite admin login works  

### Optional backfills

- FAQ embeddings: `POST /api/admin/faq/embed` until `{ remaining: 0 }`  
- Investment PDF pages: `npx tsx scripts/backfill-investment-pdf.ts` (if legacy PDFs)

### Cron / jobs

If `pg_cron` is available, verify scheduled jobs from baseline
(`docs/MIGRATIONS.md` / SQL in `202607140005_*`). Otherwise schedule
equivalent maintenance externally.

---

## Section 6: Rollback notes

- **App only:** redeploy previous Vercel deployment.  
- **Schema:** restore from Supabase backup (see `docs/BACKUP_RESTORE.md`).  
- Do not re-apply old numbered migrations from git history into the live
  `supabase/migrations/` folder.
