# Task 11 Report: Me/Reservasi + Login + Check-in Fixes

## Files Changed

1. `src/app/me/page.tsx`
2. `src/app/login/page.tsx`
3. `src/app/checkin/page.tsx`
4. `src/app/me/reservasi/page.tsx`

## Implementation Details

### Part A: `src/app/me/page.tsx`

1. **Data leak fix (CRITICAL):** Added `.eq('pengunjung_id', pengunjung?.id || '')` to the reservasi query so only the current user's reservations are fetched. Also added `id` to the `pengunjung` select query (`'id, nama, email, foto_url'`).

2. **Stuck loading fix:** When `authUser` is null, the page now sets `loading(false)` and redirects to `/login?redirect=/me` instead of silently returning (which left loading=true forever).

3. **Toast instead of console.error:** Imported `useToast` from `@/components/Toast`, added `const { toast } = useToast()`. The `loadData().catch()` handler shows a toast error message instead of console.error.

4. **`<img>` → `<Image>`:** Replaced the `<img>` tag for user avatar with `<Image>` from `next/image` (with `width={40} height={40}` and `unoptimized` for external Google avatar URLs).

5. **Removed unused imports:** Removed `useRouter`, `Building2`, `APP_NAME`.

6. **Fixed syntax error:** The destructuring `const { data: { user: authUser } = await ...` was missing a closing brace. Fixed to `const { data: { user: authUser } = await ...`. (This was a pre-existing bug in the original file.)

### Part B: `src/app/login/page.tsx`

1. **setState in render fix:** Replaced the render-body `setError()` call and the `useEffect` approach with `useSearchParams()` hook. The `authError` boolean is derived directly from `searchParams.get('error') === 'auth'` and displayed in the error UI. This avoids both the "setState in render" anti-pattern and the React 19 `react-hooks/set-state-in-effect` lint rule.

2. **Navigation fix:** Imported `useRouter` from `next/navigation`, added `const router = useRouter()`. Replaced `window.location.href = '/me'` and `window.location.href = '/admin'` with `router.push('/me')` and `router.push('/admin')`. The OAuth redirect (`window.location.origin + '/auth/callback'`) is kept as-is since it's handled by Supabase.

3. **Removed dead imports:** Removed `Suspense`, `useEffect`, `Building2`, `APP_NAME`. Added `useSearchParams` (now used).

### Part C: `src/app/checkin/page.tsx`

1. **Fallback layanan IDs fix:** On fetch failure, `layananOptions` is now set to `[]` instead of mapping `LAYAN_LIST` to `fallback-${i}` IDs.
2. **Error message in dropdown:** When layanan fails to load (empty array + not loading), shows "Gagal memuat layanan. Coba refresh halaman." instead of the select dropdown.
3. **Submit button disabled:** Button is disabled when `layananOptions.length === 0`.
4. **Removed `LAYAN_LIST` import.**

### Part D: `src/app/me/reservasi/page.tsx`

1. **Fallback layanan IDs fix:** On fetch failure, `layananOptions` is set to `[]` instead of `fallback-${i}` IDs.
2. **Error message in dropdown:** When layanan fails to load, shows "Gagal memuat layanan" instead of the select dropdown.
3. **Submit button disabled:** Button is disabled when `form.tujuan === 'loket'` and `layananOptions.length === 0`.
4. **Removed `LAYAN_LIST` import.**

## Test Results

- **`npx tsc --noEmit`:** 0 errors ✅
- **`npm run lint`:** 2 errors + 5 warnings — all pre-existing (in `admin/absensi`, `chat`, `Sidebar`). No new errors from changed files. ✅
- **`npm run build`:** Succeeded ✅

## Self-Review Findings

1. **Login page approach change:** The task suggested using `useEffect` to check URL params, but React 19's `react-hooks/set-state-in-effect` lint rule flags `setState` calls inside `useEffect`. The idiomatic Next.js 16 solution is `useSearchParams()`, which reads URL params as a hook (no setState needed). This achieves the same goal without triggering the lint rule. The task said to remove `useSearchParams` if unused, but since we now use it, it's kept.

2. **`pengunjung` null safety in me/page.tsx:** When the profile query fails (no `pengunjung` record), the code falls back to auth metadata for display. The reservasi query uses `pengunjung?.id || ''` which filters by empty string (returning no results), which is the correct behavior — a user without a profile record can't have reservations.

3. **`<Image>` with external URLs:** Used `unoptimized` prop for the Google avatar URL since Next.js Image optimization doesn't work with arbitrary external domains without configuration.

4. **Pre-existing syntax bug fixed:** The original `me/page.tsx` had `const { data: { user: authUser } = await ...` (missing closing brace), which was a syntax error. This was fixed as part of the edit.
