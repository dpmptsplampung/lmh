# LMH 2.0 Deploy Runbook

Single ordered checklist for deploying LMH 2.0 to production. Follow each
section in order. **Backup the database before applying migrations
(Section 3).**

---

## Section 1: Environment Variables

All required env vars. Copy `.env.example` to `.env.local` (local) and set
the same values in Vercel Project Settings → Environment Variables (prod).

```
# Core Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# I5: Notifikasi
RESEND_API_KEY=re_...
RESEND_FROM=DPMPTSP Lampung <noreply@lampungprov.go.id>
CRON_SECRET=...   # Vercel Cron sends Authorization: Bearer <CRON_SECRET>
NEXT_PUBLIC_PUBLIC_URL=https://lmh.lampungprov.go.id

# I5: Web Push (generate with: npx web-push generate-vapid-keys)
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...   # same as VAPID_PUBLIC_KEY, exposed to browser

# I4: AI RAG
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-1.5-flash
GEMINI_EMBEDDING_MODEL=text-embedding-004
```

### Variable reference

| Variable | Purpose | Where to get it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Supabase Dashboard → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon public key (browser-safe) | Supabase Dashboard → Project Settings → API → `anon` `public` |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (server-only, bypasses RLS) | Supabase Dashboard → Project Settings → API → `service_role` |
| `RESEND_API_KEY` | Resend transactional email | Resend Dashboard → API Keys |
| `RESEND_FROM` | From address (must be a verified domain) | Resend Dashboard → Domains |
| `CRON_SECRET` | Shared secret for Vercel Cron → internal endpoints | Generate a random 32+ char string |
| `NEXT_PUBLIC_PUBLIC_URL` | Public base URL used in notification bodies | Your production URL |
| `VAPID_PUBLIC_KEY` | Web Push VAPID public key | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | Web Push VAPID private key (server-only) | same command |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Same as `VAPID_PUBLIC_KEY` (browser-exposed) | same command |
| `GEMINI_API_KEY` | Google Gemini API key | Google AI Studio → API keys |
| `GEMINI_MODEL` | Chat model | default `gemini-1.5-flash` |
| `GEMINI_EMBEDDING_MODEL` | Embedding model (768-dim) | default `text-embedding-004` |

> **Security:** `SUPABASE_SERVICE_ROLE_KEY` and `VAPID_PRIVATE_KEY` must
> NEVER be prefixed with `NEXT_PUBLIC_`. They are server-only.

---

## Section 2: Supabase Dashboard Configuration

Perform these in order in the Supabase Dashboard (before applying
migrations):

1. **Enable extensions** — Database → Extensions → enable:
   - `pgvector` (required by migration 035 for FAQ embeddings)
   - `pg_cron` (required by migration 036 for `anon_rate_limit` pruning)
2. **Enable Anonymous Sign-In** — Authentication → Providers → Anonymous →
   toggle On. (Required for check-in flow — anon visitors get a temp auth
   session before INSERT.)
3. **Configure Auth Hook (JWT claim)** — Authentication → Hooks → JWT Hook →
   select `public.set_user_role_claim()` (installed by migration 027). This
   injects the user's role (`petugas` / `admin` / `pengunjung`) into the JWT
   so RLS policies can call `get_my_role()` without an extra round-trip.
4. **Set Site URL** — Authentication → URL Configuration → Site URL = your
   production app URL (e.g. `https://lmh.lampungprov.go.id`). Used for
   magic-link redirects (UMKM edit flow).
5. **Verify Resend domain** — Resend Dashboard → Domains → confirm
   `lampungprov.go.id` (or the subdomain you send from) is verified. Without
   this, Resend refuses to send.

---

## Section 3: Migration Apply Order (CRITICAL — follow exactly)

Apply migrations `020` → `038` **in order** via Supabase Dashboard →
SQL Editor (paste each file, run). **Backup the database first**
(Database → Backup).

### Warnings (read before applying)

- **Before 023:** Provision replacement petugas accounts via the invite
  flow (`POST /api/admin/petugas/invite`). Migration 023 **DELETES** the 9
  hardcoded `password123` accounts created in 013. If you apply 023 without
  replacements, **you lock yourself out of admin**.
- **Before 026:** Confirm the real DPMPTSP WhatsApp number. Migration 026
  sets `site_settings.wa_number` to a placeholder (`6281277000000`). After
  applying 026, run:
  ```sql
  UPDATE site_settings SET value = '<real number>' WHERE key = 'wa_number';
  ```
- **Before 035:** The `pgvector` extension **MUST** be enabled (Section 2,
  step 1). Migration 035 adds a `vector(768)` column and an ivfflat index —
  it will fail hard without pgvector.
- **Before 036:** (Optional but recommended) `pg_cron` should be enabled
  (Section 2, step 1). Migration 036 creates the `prune_anon_rate_limit()`
  function regardless, but the daily cron schedule only registers if
  `pg_cron` is installed. If not installed, the migration prints a NOTICE
  and you must run `SELECT prune_anon_rate_limit();` manually on a schedule.
- **Before 038:** Safe online ALTER — migration 038 adds
  `listing_umkm.sisi` column with `NOT NULL DEFAULT 'kebutuhan'`.
  Existing rows are treated as `kebutuhan` (correct — that was the
  implicit assumption before two-sided marketplace). No table rewrite
  (Postgres ≥ 11 optimizes non-volatile defaults).

### Migration list

| # | File | Notes |
|---|---|---|
| 020 | `020_*.sql` | |
| 021 | `021_*.sql` | K2 chat ownership |
| 022 | `022_anon_rate_limit.sql` | K3 rate limiting |
| 023 | `023_*.sql` | **WARNING — deletes petugas accounts, see above** |
| ... | ... | (024–025) |
| 026 | `026_*.sql` | **WARNING — placeholder WA number, see above** |
| 027 | `027_*.sql` | `set_user_role_claim()` — wire up in Section 2 step 3 |
| ... | ... | (028–034) |
| 035 | `035_faq_embedding.sql` | **Requires pgvector — see above** |
| 036 | `036_anon_rate_prune.sql` | `prune_anon_rate_limit()` + pg_cron |
| 037 | `037_investasi_lead.sql` | I6 — `investasi_lead` table, RLS, audit trigger |
| 038 | `038_umkm_dua_sisi.sql` | I7 — `listing_umkm.sisi` column, `umkm_inquiry` table, `v_umkm_match` view |

---

## Section 4: Vercel Deployment

1. Set **all** env vars from Section 1 in Vercel Project Settings →
   Environment Variables (for the Production environment; repeat for Preview
   if you want a staging deploy).
2. Generate VAPID keys locally and set them in Vercel:
   ```bash
   npx web-push generate-vapid-keys
   ```
   Copy the public key into both `VAPID_PUBLIC_KEY` and
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and the private key into
   `VAPID_PRIVATE_KEY`.
3. Deploy the branch (Vercel Git integration auto-deploys on push, or run
   `vercel --prod` manually).
4. Configure Vercel Cron to send the auth header. The `vercel.json` schedules
   are already defined in-repo; in Vercel Dashboard → Cron Jobs, ensure each
   cron job sends `Authorization: Bearer <CRON_SECRET>` so the internal
   endpoints (`/api/notif/send`, `/api/notif/retry`) accept the request.

---

## Section 5: Post-Deploy

1. **FAQ embedding backfill** — as an admin, POST to
   `/api/admin/faq/embed` repeatedly until the response returns
   `{ remaining: 0 }`. This generates vector embeddings for every active
   FAQ row so the RAG chatbot can match. Without this, the AI chat will
   always eskalasi (no matches).
2. **Smoke test** the end-to-end flows:
   - Check-in (anon visitor → kunjungan INSERT)
   - Chat (anon + Google sign-in → chat_sesi + chat_pesan)
   - SKM submission (post-service survey)
   - UMKM magic-link (request edit link → email → edit page)
   - Gallery page-image (image upload + display)
   - Notification send (admin triggers → email/web_push)
   - AI chat eskalasi (ask a question with no FAQ match → bot hands off to
     petugas)
   - **I6 — Investasi lead funnel:** open Gallery → click "Ajukan Minat
     Investasi" on an IPRO card → submit form → verify row appears at
     `/admin/investasi-leads` → update status via dropdown.
   - **I7 — UMKM inquiry:** open `/umkm` → matchmaking tab → "Kirim Pesan"
     on a listing → submit → owner logs in via magic-link → `/umkm/inbox`
     → approve/reject. Verify `kontak_hp`/`kontak_email` NOT visible on
     public listing cards (only via owner inbox after approval).
   - **I9 — Offline checkin:** open `/checkin` in DevTools → Application →
     Service Workers confirms `sw.js` active → toggle "Offline" in
     Network tab → submit checkin form → verify "tersimpan offline"
     message → toggle "Online" → verify queue replays and visit appears
     in admin.
   - **I9 — Checkin Bantuan:** login as petugas → `/admin/checkin-asist`
     → submit a visitor on their behalf → verify visit appears in admin
     antrian with `pengunjung_id = NULL`.
   - **I9 — PWA install:** DevTools → Application → Manifest confirms
     metadata; "Install app" prompt works (Chrome/Edge).
3. **Verify `anon_rate_limit` pruning is scheduled** (migration 036):
   ```sql
   SELECT * FROM cron.job WHERE jobname = 'prune_anon_rate_limit';
   ```
   If `pg_cron` is not installed, set up an external scheduler to run
   `SELECT prune_anon_rate_limit();` daily.
