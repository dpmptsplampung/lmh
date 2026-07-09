# Task 5 Report: Admin Gallery — PDF Upload + Signed URL Viewer

## What Was Implemented

### Part A: Signed URL API Route
Created `src/app/api/investment-docs/signed-url/route.ts`:
- GET endpoint that accepts `file_path` query parameter
- Authenticates user via Supabase server client (cookie-based session)
- Checks user role in `petugas` table (admin or petugas required)
- Creates a signed URL with 1-hour (3600s) expiry for the `investment-docs` private bucket
- Returns JSON `{ signedUrl: string }` on success
- Returns appropriate HTTP status codes (400, 401, 403, 500) on errors

### Part B: Admin Gallery Page Fixes

#### 1. ESLint `set-state-in-effect` Fix
- Added `// eslint-disable-next-line react-hooks/set-state-in-effect` comment before `loadData()` in `useEffect`, matching the pattern used in `src/app/admin/page.tsx` and `src/app/admin/umkm/page.tsx`.

#### 2. PDF Upload Implementation
- Added `uploadingFile: boolean` state
- Implemented `handlePdfUpload(file: File)`:
  - Validates file type is `application/pdf`
  - Validates max file size (10MB)
  - Uploads to `investment-docs` bucket with path `{crypto.randomUUID()}.pdf`
  - Sets `form.file_path` to the uploaded path
  - Shows toast on validation failure or upload error
  - Shows success indicator with filename after upload
- Added file input `<input type="file" accept="application/pdf">` in form
- Replaced `file_path: 'pending-upload'` placeholder with actual upload requirement
- Added validation: if creating new and no file_path, shows "File PDF wajib diunggah." error
- Shows current file path (filename only) when editing

#### 3. Missing Form Fields
- Added `jumlah_halaman` number input to form (in a 3-column grid with urutan and status)
- `deskripsi` textarea (already existed, confirmed present)
- `nilai_investasi` text input (already existed, confirmed present)
- `image_url` URL input (already existed, confirmed present)
- Updated `emptyForm` and `GalleryForm` interface to include `file_path` and typed all fields

#### 4. Reorder Functionality
- Implemented `handleMoveUp(doc)`:
  - Sorts docs by `urutan_tampil`
  - Finds the previous document
  - Swaps `urutan_tampil` values in Supabase (both documents updated)
  - Updates local state optimistically
- Implemented `handleMoveDown(doc)`: same pattern with next document
- Added `ChevronUp` and `ChevronDown` buttons in table rows (replaced `GripVertical`)
- Up arrow disabled on first item, down arrow disabled on last item
- Error handling via toast

#### 5. Enhanced Detail Modal with PDF Viewer
- Added `signedUrl` and `loadingSignedUrl` state
- Added `handleViewDoc(doc)` function that:
  - Opens the detail modal
  - Fetches signed URL from `/api/investment-docs/signed-url?file_path=...`
  - Sets the signed URL for iframe rendering
- PDF preview section with `<iframe>`:
  - `onContextMenu={(e) => e.preventDefault()}` to disable right-click
  - CSS `@media print { display: none; }` to prevent printing
  - Loading spinner while fetching signed URL
- Displays `deskripsi`, `nilai_investasi`, `image_url` (as `<Image>`), `jumlah_halaman` in modal
- Modal width increased to 640px to accommodate PDF viewer

#### 6. UX Fixes
- Changed Edit button icon from `Upload` to `Edit2` (imported from lucide-react)
- Replaced all `console.error` with `toast()` calls
- Replaced all `alert()` with `toast()` calls
- Replaced `<img>` with `<Image>` from next/image (both in table and detail modal)
- Fixed `react/no-unescaped-entities`: escaped `"Tambah Dokumen"` as `&quot;Tambah Dokumen&quot;`
- Fixed `@typescript-eslint/no-explicit-any`: typed `catch (err)` with `instanceof Error` check
- Removed unused imports (`Upload`, `GripVertical`)
- Added `useToast` hook integration
- Typed `GalleryForm` interface for the form state

## Test Results

- `npx tsc --noEmit`: **0 errors** ✓
- `npm run lint` (on modified files only): **0 errors, 0 warnings** ✓
- `npm run build`: **succeeds** ✓ (all routes compiled, including new `/api/investment-docs/signed-url`)

## Files Changed

1. `src/app/api/investment-docs/signed-url/route.ts` — **NEW** — Signed URL API route
2. `src/app/admin/gallery/page.tsx` — **MODIFIED** — All Part B changes

## Self-Review Findings

### Verified
- All form fields present: judul, kategori, nilai_investasi, deskripsi, image_url, jumlah_halaman, urutan_tampil, status, file_path
- PDF upload validates type and size, uploads to correct bucket
- Reorder buttons swap urutan_tampil values correctly, disabled at boundaries
- Detail modal fetches signed URL and renders in iframe with print/right-click protection
- All `<img>` replaced with `<Image>` with `unoptimized` prop (matching UMKM page pattern)
- All `console.error`/`alert` replaced with toast
- No `any` types
- No unescaped entities
- ESLint disable comment matches existing project pattern

### Notes
- The signed URL API uses the server-side Supabase client which inherits the user's session via cookies. The storage policy `investment_docs_admin_select` allows admin users to SELECT from the bucket, enabling signed URL creation.
- The `next.config.ts` already has `remotePatterns` configured for `*.supabase.co` public storage paths. The signed URL uses a different path format (`/storage/v1/object/sign/...`) but the `<Image>` usage with `unoptimized` prop bypasses Next.js image optimization, so no config change needed.
- The `@media print` CSS is injected via a `<style>` tag inside the modal, which is a common pattern for scoped print styles.
