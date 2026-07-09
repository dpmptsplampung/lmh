# Task 10: Public Pages Fixes — Report

## Summary

Fixed the public Gallery and UMKM pages to fetch from database (removed hardcoded demo data) and use signed URL for PDF viewing via a new public API route.

## Files Changed

### 1. `src/app/api/investment-docs/public-view/route.ts` (NEW)
- Created public API route that generates a signed URL for investment documents without auth check
- Uses `createClient` from `@/lib/supabase/server` (server-side Supabase client)
- Accepts `file_path` query parameter
- Returns `{ signedUrl: string }` with 1-hour expiry (3600 seconds)
- The signed URL itself is the security mechanism (expires in 1 hour)

### 2. `src/app/gallery/page.tsx` (REWRITTEN)
**Removed:**
- `iproProjects` hardcoded array (9 demo projects with unsplash images)
- `renderDocPages()` function (hardcoded page content for specific IDs: `peta_potensi`, `kiwk`, `bhc`, `pltsa`)
- Unused imports: `Globe`, `Building2`, `APP_NAME`, `FileCheck` (FileCheck kept — used in button)
- `<img>` tag replaced with `<Image>` from `next/image`

**Added/Changed:**
- `GalleryDoc` interface with proper typing for all DB fields including `file_path`
- `loadData` fetches from `investment_documents` where `status = 'aktif'`, ordered by `urutan_tampil`
- Empty state: "Belum ada dokumen tersedia" when DB returns empty or errors
- `foilaUrl` continues to fetch from `site_settings` (kept fallback to URL constant)
- New `useEffect` for signed URL fetching: when `selectedDocId` changes, fetches from `/api/investment-docs/public-view?file_path={...}`
- Document viewer replaced with `<iframe>` rendering the signed URL
- Watermark overlay "DPMPTSP PROV LAMPUNG — DILINDUNGI" kept as absolutely positioned div
- Print-disabling style: `@media print { .no-print { display: none !important; }`
- `handleContextMenu` prevention kept on the page wrapper
- `onContextMenu={(e) => e.preventDefault()}` on the iframe
- `getSelectedDocTitle()` now references `docs` state (not removed `iproProjects`)
- Loading spinner (`Loader2`) shown while fetching signed URL
- Error state shown if signed URL fetch fails
- `Loader2` icon added to imports

### 3. `src/app/umkm/page.tsx` (REWRITTEN)
**Removed:**
- `demoListings` hardcoded array (9 demo UMKM listings with unsplash images)
- `APP_NAME` import (unused)
- Fallback to `demoListings` in catch block
- `<img>` tag replaced with `<Image>` from `next/image`
- `any` type annotations replaced with proper typing

**Added/Changed:**
- `UMKMListing` interface with proper typing for all DB fields
- `loadData` fetches from `listing_umkm` where `status = 'published'` (already existed, kept)
- Data mapping uses `Record<string, unknown>` cast to avoid `any` type
- Empty state: "Belum ada listing UMKM tersedia" when DB returns empty or errors
- Separate empty state for filtered results: "Belum Ada Listing" when filter returns nothing
- `KATEGORI_UMKM` import used to map `kategori_kebutuhan` to human-readable label
- `kategoriLabel` displayed instead of raw enum value
- Contact button uses `waLink(listing.kontak_hp)` (already existed, confirmed working)
- `bankLampungBranches` stays hardcoded (static data, not from DB)
- `<Image fill>` used for listing images (requires `position: relative` on container)

### 4. `src/app/umkm/umkm.module.css` (MODIFIED)
- Added `position: relative` to `.listingImage` (required for `next/image` `fill` prop)
- Removed `.listingImage img` CSS rule (no longer needed — `next/image` with `fill` handles sizing)

## Test Results

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors from changed files (2 pre-existing errors in `admin/absensi/page.tsx`) |
| `npm run build` | Exit code 0 — build succeeded |

## Self-Review Findings

1. **Peta Potensi card**: The original code had a hardcoded `selectedDocId = 'peta_potensi'` that triggered a special hardcoded viewer. Since we removed the hardcoded viewer, the Peta Potensi card now tries to find a doc with `kategori === 'Peta Potensi'` or `judul` containing "peta potensi" in the DB. If no such doc exists, clicking does nothing. This is acceptable — the admin would need to create such a document in the DB.

2. **Public API route security**: The `/api/investment-docs/public-view` route creates signed URLs without auth checks. The signed URL expires in 1 hour, which is the security mechanism. This matches the PRD requirement of "public read via signed URL". Anyone with the signed URL can view the PDF for up to 1 hour.

3. **Image optimization**: Used `unoptimized` prop on `<Image>` for DB-sourced images (same pattern as admin gallery page) since `image_url` may be from Supabase storage or external URLs. The `next.config.ts` only allows `*.supabase.co` for optimized images, so `unoptimized` avoids issues with other hosts.

4. **`set-state-in-effect` ESLint rule**: The first `setSignedUrl(null)` in the effect (when `selectedDocId` is null) triggers this rule. Used `// eslint-disable-next-line` comment, following the same pattern as the admin gallery page (line 98 of `admin/gallery/page.tsx`).

5. **`docs` dependency in signed URL effect**: The effect that fetches signed URLs depends on both `selectedDocId` and `docs`. This means if `docs` changes (e.g., after initial load), the effect re-runs. This is correct behavior — if the selected doc's `file_path` changes, we want to re-fetch.
