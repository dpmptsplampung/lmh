# Task 12: Sidebar + ProfileCompletenessGate Fixes — Report

## Files Changed

1. `src/components/layout/Sidebar.tsx`
2. `src/components/ProfileCompletenessGate.tsx`

---

## Part A: Sidebar (`src/components/layout/Sidebar.tsx`)

### 1. `.single()` → `.maybeSingle()`

Changed the Supabase query from `.single()` to `.maybeSingle()` so it doesn't throw when no `petugas` row exists for the authenticated user.

Also added `error` destructuring from the query result and handle it by setting `userRole` to `null`.

### 2. Flash of all nav items fix

- Changed initial `userRole` state from `null` to `undefined`:
  ```ts
  const [userRole, setUserRole] = useState<string | null | undefined>(undefined);
  ```
- Updated the nav items filter logic to hide all items while role is loading (`undefined`) or when user is not a petugas (`null`):
  ```ts
  const visibleItems = navItems.filter(item => {
    if (userRole === undefined || userRole === null) return false;
    if (!item.roles) return true;
    return item.roles.includes(userRole);
  });
  ```

Previously, the filter `!userRole` was truthy for `null`, which caused ALL items (including admin-only) to display briefly before the role loaded.

### 3. Handle `petugas === null` case

After the query, if `petugas` is null (user exists but is not a petugas), `userRole` is set to `null`, and no nav items are shown. Also handles the case where `user` itself is null (not authenticated) by setting `userRole` to `null`.

### 4. Removed unused imports

- Removed `Building2` from lucide-react imports
- Removed `import { APP_NAME } from '@/lib/constants'`

Both were imported but never referenced in the component body.

---

## Part B: ProfileCompletenessGate (`src/components/ProfileCompletenessGate.tsx`)

### 1. Error fallback fix

**Before:** In the catch block, `setComplete(true)` was called, which silently bypassed the profile requirement on any DB error — a security concern.

**After:**
- Added `dbError` state: `const [dbError, setDbError] = useState(false)`
- In the catch block: `setDbError(true)` (no longer sets `complete = true`)
- Added a render block for the error state (after loading check, before `!complete` check):
  ```jsx
  if (dbError) {
    return (
      <div className={styles.overlay}>
        <div className={styles.loaderOverlay}>
          <p>Gagal memverifikasi profil. Coba refresh halaman.</p>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>
            Coba Lagi
          </button>
        </div>
      </div>
    );
  }
  ```
- `complete = true` is only set when `user` is null (anonymous user — middleware handles redirect), preserving the original anonymous bypass behavior.

---

## Test Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 new errors from changed files (pre-existing errors in `absensi/page.tsx` and `chat/page.tsx` remain) |
| `npm run build` | Fails with pre-existing `/login` useSearchParams Suspense error — **not caused by these changes** (verified by stashing changes and rebuilding with identical error) |

### Build failure verification

The build fails on the `/login` page due to `useSearchParams()` not being wrapped in a Suspense boundary. This was confirmed as a pre-existing issue by stashing all changes and running `npm run build` on the unmodified code — the exact same error occurred.

---

## Self-Review Findings

1. **Sidebar destructuring fix:** During editing, a closing brace was accidentally dropped from `const { data: { user } = await supabase.auth.getUser();` (should be `const { data: { user } = await ...`). This was caught by `tsc --noEmit` and fixed by reformatting to multi-line destructuring.

2. **Error handling in Sidebar:** Added `error` handling from the `.maybeSingle()` query — if the query errors, `userRole` is set to `null` (no items shown), which is a safe default.

3. **Anonymous user in ProfileCompletenessGate:** The `complete = true` for anonymous users (`user === null`) is preserved, as this is intentional — the middleware/proxy handles auth redirects. The fix only removes the `complete = true` fallback from the catch block (DB errors).

4. **No comments added:** Per code style requirements, no new comments were added to the code.

---

## Commit

```
f0fadb6 fix: sidebar maybeSingle + flash fix, ProfileCompletenessGate error fallback
```

2 files changed, 36 insertions(+), 11 deletions(-)
