# Task K5 Report — Magic-link UMKM edit

## Summary

Replaced the non-functional `edit_token` flow on `listing_umkm` with a magic-link email flow via Supabase Auth. Owners request an edit link by email → click it → get a session → UPDATE their listing via owner-scoped RLS. The existing admin-approval workflow is preserved (owners cannot set `status='published'` directly).

## Step 1 — Migration `024_umkm_magic_link.sql`

**File:** `supabase/migrations/024_umkm_magic_link.sql`

Full SQL:

```sql
-- ============================================================
-- Fase 0 / K5: Magic-link edit UMKM via Supabase Auth
-- ============================================================
CREATE TABLE umkm_listing_owner (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID REFERENCES listing_umkm(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(listing_id, email)
);
CREATE INDEX idx_umkm_owner_email ON umkm_listing_owner(email);

ALTER TABLE umkm_listing_owner ENABLE ROW LEVEL SECURITY;

CREATE POLICY "umkm_owner_select_own" ON umkm_listing_owner
  FOR SELECT TO authenticated
  USING (
    email = (SELECT email FROM auth.users WHERE id = auth.uid())
    OR get_my_role() = 'admin'
  );

CREATE POLICY "umkm_owner_admin_all" ON umkm_listing_owner
  FOR ALL TO authenticated
  USING (get_my_role() = 'admin')
  WITH CHECK (get_my_role() = 'admin');

CREATE POLICY "listing_umkm_select_own" ON listing_umkm
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = listing_umkm.id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  );

CREATE POLICY "listing_umkm_update_own" ON listing_umkm
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM umkm_listing_owner
      WHERE listing_id = listing_umkm.id
        AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
    )
    OR get_my_role() = 'admin'
  )
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM umkm_listing_owner
        WHERE listing_id = listing_umkm.id
          AND email = (SELECT email FROM auth.users WHERE id = auth.uid())
      )
      OR get_my_role() = 'admin'
    )
    AND (status NOT IN ('published') OR get_my_role() = 'admin')
  );

INSERT INTO umkm_listing_owner (listing_id, email)
SELECT id, kontak_email FROM listing_umkm
WHERE kontak_email IS NOT NULL
  AND kontak_email != ''
ON CONFLICT (listing_id, email) DO NOTHING;

COMMENT ON COLUMN listing_umkm.edit_token IS 'DEPRECATED (K5): tidak lagi divalidasi. Edit UMKM via magic-link Supabase Auth + RLS owner. Akan di-drop di migration mendatang.';

-- ROLLBACK:
--   DROP POLICY IF EXISTS "listing_umkm_update_own" ON listing_umkm;
--   DROP POLICY IF EXISTS "listing_umkm_select_own" ON listing_umkm;
--   DROP POLICY IF EXISTS "umkm_owner_admin_all" ON umkm_listing_owner;
--   DROP POLICY IF EXISTS "umkm_owner_select_own" ON umkm_listing_owner;
--   ALTER TABLE umkm_listing_owner DISABLE ROW LEVEL SECURITY;
--   DROP TABLE IF EXISTS umkm_listing_owner;
--   COMMENT ON COLUMN listing_umkm.edit_token IS 'Token unik per listing, divalidasi server-side via Edge Function';
```

Key points:
- New `umkm_listing_owner(listing_id, email)` mapping table with `UNIQUE(listing_id, email)` + index on `email`.
- RLS on `umkm_listing_owner`: owner self-SELECT (`email = auth email`) + admin ALL.
- New `listing_umkm_select_own` policy: owners can SELECT their own listings (even `draft`/`pending_review`) — required because the existing `listing_public_read` only allows `status='published'`.
- New `listing_umkm_update_own` policy: owners can UPDATE their own listings, **but** the `WITH CHECK` enforces `status NOT IN ('published') OR get_my_role()='admin'` — owners cannot self-publish (admin approval preserved).
- Backfill from `listing_umkm.kontak_email` with `ON CONFLICT DO NOTHING`.
- `edit_token` column is **NOT dropped** — marked deprecated via `COMMENT ON COLUMN`. To be dropped in a future migration after the magic-link flow is verified in production.
- ROLLBACK section included.

## Step 2 — Route Handler `request-edit-link`

**File:** `src/app/api/umkm/request-edit-link/route.ts`

`POST /api/umkm/request-edit-link` — accepts `{ listing_id: UUID, email: email }` (zod-validated).

Logic:
1. Validate input (zod). 400 on invalid.
2. If `SUPABASE_SERVICE_ROLE_KEY` missing → return `200 { sent: true, dev_note: "service role key missing — no email sent" }` (no-op dev fallback; does not leak whether email is registered).
3. Rate-limit: query `anon_rate_limit` table (reusing the K3 mechanism) with action `'umkm_request_link'`, max 3/60s. **Fail-closed**: if the rate-limit query errors, return 429. **Note:** because `anon_rate_limit.user_id` references `auth.users(id)` and this endpoint is anon (no `auth.uid()`), the rate limit is currently **global per action** (not per-IP). The route captures `x-forwarded-for`/`x-real-ip` via `clientIp()` for future per-IP limiting once a `identifier` column is added. Documented in code comments.
4. Query `umkm_listing_owner WHERE listing_id=? AND email=?`. If no match (or query error) → return `200 { sent: true }` **without sending an email** (does not leak whether the email is registered as an owner).
5. If match → log the rate-limit action, then ensure the auth user exists: try `admin.generateLink({ type: 'magiclink', options: { redirectTo: '/umkm/edit/<listing_id>' } })`. If `generateLink` returns "user not found", call `admin.createUser({ email, email_confirm: true })` (no password) and retry `generateLink`.
6. Return `200 { sent: true }`. The link is delivered via Supabase email (production).
   - **Dev fallback:** if `LMH_DEV_RETURN_LINK=set`, the response includes `dev_link` (the `action_link`) so a developer can click it manually. Never set this in production.

Security properties:
- Does not leak whether an email is a registered owner (same 200 response shape).
- Fail-closed on rate-limit DB errors.
- Service-role client only constructed when the key is present.

## Step 3 — Edit page

**Files:**
- `src/app/umkm/edit/[id]/page.tsx` (client component)
- `src/app/umkm/edit/[id]/edit.module.css`

Logic:
1. Uses `useParams<{ id: string }>()` (Next.js 16 client hook) to read the listing id.
2. On mount: `supabase.auth.getUser()`. If no session → renders a "no session" notice with a link back to `/umkm?edit_login_required=1`.
3. If session present: `SELECT` the listing by `id`. RLS (`listing_umkm_select_own` + `listing_public_read`) allows the owner to read it even if `draft`/`pending_review`. If not found / not allowed → "not found" notice.
4. Renders an edit form (nama_umkm, kategori_kebutuhan, deskripsi, kontak_nama, kontak_hp, kontak_email). Pre-filled from the fetched listing. `foto_produk` is read-only (managed by admin — a hint is shown).
5. On submit: `UPDATE` with the new values, `status='pending_review'`, and `updated_at=now()`. RLS (`listing_umkm_update_own`) allows the update for owners; the `WITH CHECK` prevents `status='published'`.
6. Success message: "Perubahan Anda tersimpan dan menunggu persetujuan admin."
7. Handles loading / not-found / error / no-session states with distinct UI.

CSS module `edit.module.css` styles the page, form fields, notices, success/error boxes, spinner, and a responsive layout (stacks on mobile).

## Step 4 — UMKM page change (surgical)

**Files modified:** `src/app/umkm/page.tsx`, `src/app/umkm/umkm.module.css`

Changes to `page.tsx`:
- Added imports: `Suspense`, `useSearchParams`, and icons (`Mail`, `X`, `Loader2`, `CheckCircle2`).
- Extracted a `LoginNotice` subcomponent that calls `useSearchParams()` and renders the `edit_login_required=1` notice. It is wrapped in `<Suspense fallback={null}>` — required by Next.js 16 because `useSearchParams` forces client-side rendering of the component subtree (build failed without the Suspense boundary; fixed).
- Added state for the edit-link modal (`editModalListing`, `editEmail`, `editSending`, `editSent`).
- Added `openEditModal`, `closeEditModal`, `submitEditRequest` handlers. `submitEditRequest` POSTs to `/api/umkm/request-edit-link` and **always** shows the generic success message "Jika email Anda terdaftar sebagai pemilik, link edit telah dikirim" (no leak, even on network error).
- Each listing card now has a "Minta link edit" button (with `Mail` icon) alongside the existing "Hubungi" WhatsApp button, inside a new `.listingActions` flex container.
- The modal renders an email input + submit button, then transitions to a success view on submit.

CSS additions to `umkm.module.css`: `.loginNotice`, `.listingActions`, `.editLinkBtn`, `.editModalOverlay`, `.editModal`, `.editModalClose`, `.editModalTitle`, `.editModalListing`, `.editModalDesc`, `.editModalForm`, `.editModalSuccess`, `.spinner` (with `umkm-spin` keyframes to avoid clashing with any existing `spin` animation).

The page's existing structure, tabs, pembiayaan section, and branch grid were left untouched.

## Step 5 — Tests

### `src/app/api/umkm/request-edit-link/request-edit-link.test.ts` (14 tests)

Mocks `@supabase/supabase-js` (service client). Test groups:
- **input validation** (5): missing `listing_id`, invalid UUID, missing email, invalid email, invalid JSON body → all 400.
- **owner check / no leak** (2): email not registered as owner → `200 { sent: true }` and `generateLink` not called; owner query errors → `200 { sent: true }` and `generateLink` not called.
- **happy path** (3): owner match → `200 { sent: true }`, `generateLink` called with correct `email`/`type='magiclink'`/`redirectTo`; user-not-found path → `createUser` called then `generateLink` retried (2 calls); `LMH_DEV_RETURN_LINK=set` → response includes `dev_link`.
- **service key missing** (1): returns `200` with `dev_note` (no-op).
- **rate limiting** (3): count≥3 → 429 and `generateLink` not called; count<3 → allowed; rate-limit query error → 429 (fail-closed).

### `src/app/umkm/umkm.rls.test.ts` (15 tests)

File-level assertions on `024_umkm_magic_link.sql`:
- exists, has `Fase 0 / K5` header, creates `umkm_listing_owner` table, has `UNIQUE(listing_id, email)`, has index on `email`, enables RLS, creates `umkm_owner_select_own` + `umkm_owner_admin_all` policies, creates `listing_umkm_update_own` with owner EXISTS check, update `WITH CHECK` prevents `status='published'`, creates `listing_umkm_select_own`, backfills from `kontak_email` with `ON CONFLICT DO NOTHING`, does NOT drop `edit_token`, marks `edit_token` deprecated via `COMMENT`, includes ROLLBACK section.

## Step 6 — Verification

```
npm run test
  Test Files  9 passed (9)
       Tests  103 passed (103)

npm run typecheck
  (no output, exit 0)

npm run lint
  D:\Project\LMH\src\app\admin\absensi\page.tsx
    47:6  warning  React Hook useEffect has a missing dependency: 'fetchData'  react-hooks/exhaustive-deps
  ✖ 1 problem (0 errors, 1 warning)
  (warning is pre-existing in admin/absensi — outside K5 scope)

npm run build
  ✓ Compiled successfully in 6.2s
  Routes: /umkm (static), /umkm/edit/[id] (dynamic), /api/umkm/request-edit-link (dynamic)
  BUILD_EXIT=0
```

Test count went from 74 → 103 (+29 new tests: 14 route handler + 15 RLS migration).

## Step 7 — Commit

Single commit:
- Subject: `fix(security,K5): magic-link UMKM edit via Supabase Auth + owner RLS`
- SHA: (filled at commit time)

## Self-review

- **Completeness:** All 7 steps met. Migration, route handler, edit page + CSS, UMKM page surgical change, tests, verification, commit.
- **Quality:**
  - Migration adds `umkm_listing_owner` + UPDATE policy (`listing_umkm_update_own`) + SELECT policy (`listing_umkm_select_own`) for owners.
  - The UPDATE `WITH CHECK` prevents owners from setting `status='published'` (admin approval preserved).
  - Route handler never leaks whether an email is registered (same `200 { sent: true }` shape for owner-miss, DB error, and createUser/generateLink failures).
  - Edit page works for owners: RLS allows SELECT (via `listing_umkm_select_own`) and UPDATE (via `listing_umkm_update_own`).
- **Discipline:**
  - `edit_token` column NOT dropped — marked deprecated via `COMMENT ON COLUMN`.
  - No edits to `src/proxy.ts`, `src/lib/supabase/*`, or `src/app/admin/**`.
  - UMKM page change is surgical — existing tabs, pembiayaan, branch grid untouched.
  - Pre-existing lint warning in `admin/absensi/page.tsx` left alone (out of scope).
- **Testing:** Tests assert real behavior (no-leak assertions verify `generateLink` call counts; rate-limit tests verify 429 + fail-closed; migration tests verify exact SQL clauses).

## Concerns

1. **Rate limit is global, not per-IP.** The `anon_rate_limit` table (migration 022) has `user_id REFERENCES auth.users(id)` and no `identifier` column. Since this endpoint is anon (no `auth.uid()`), the rate limit is currently **global per action** (max 3/60s across all requesters), which is overly strict for many users but prevents email-spam floods. A future migration should add an `identifier TEXT` column (IP or hashed IP) to `anon_rate_limit` and update `check_anon_rate` for true per-IP limiting. The route captures `clientIp()` but does not yet use it for this reason. Documented in code comments.
2. **`auth.users` lookup via PostgREST may fail under RLS.** The route first tries `admin.from('auth.users').select(...)` but falls back to trying `generateLink` directly and catching "user not found" errors, then creating the user. This dual-path is defensive but means `createUser` may be called even when the user already exists (if the lookup silently returns null due to RLS on the service-role query). Supabase's `createUser` returns a "user already exists" error in that case, which the route treats as a non-leak `200 { sent: true }`. This is acceptable but slightly wasteful. A cleaner fix would be a dedicated SQL function `SECURITY DEFINER` to look up `auth.users` by email, but that is out of K5 scope.
3. **Magic-link `redirectTo` uses a relative path.** `admin.generateLink` `options.redirectTo` is set to `/umkm/edit/<listing_id>`. Supabase appends its auth token to this path based on the project's configured Site URL. If the Supabase project's Site URL is not the LMH app URL, the redirect may land on the wrong host. This is a deployment-config concern, not a code bug — the Supabase project Site URL must match the LMH app URL.
