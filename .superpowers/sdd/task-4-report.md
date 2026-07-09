# Task 4 Report: Admin UMKM — Form Modal + Photo Upload

## What Was Implemented

### 1. ESLint `set-state-in-effect` Fix
- Added `// eslint-disable-next-line react-hooks/set-state-in-effect` comment on the `loadData()` call inside `useEffect`, matching the existing pattern used in `src/app/admin/page.tsx:232`.

### 2. Multiple Photo Upload
- Added `uploadingPhotos: boolean` state.
- `handlePhotoUpload(files: FileList | null)`:
  - Validates max 8 photos total (existing + new).
  - Validates each file: image/* only, max 2MB.
  - Uploads each valid file to Supabase Storage `umkm-photos` bucket at path `{crypto.randomUUID()}.{ext}`.
  - Gets public URL via `supabase.storage.from('umkm-photos').getPublicUrl(path)`.
  - Appends URLs to `form.foto_produk` array.
  - Toast warnings on validation failure ("Maksimal 8 foto", "Ukuran foto maksimal 2MB").
  - Sets `uploadingPhotos` true/false around upload.
- `handleRemovePhoto(index: number)`: removes photo at index from `form.foto_produk`.

### 3. Create/Edit Form Modal
- "Tambah UMKM" button added in PageHeader with `Plus` icon, calls `handleOpenCreate()`.
- Edit button in each table row with `Edit2` icon, calls `handleOpenEdit(listing)`.
- Modal rendered when `showForm === true`:
  - Overlay: fixed, full screen, `rgba(0,0,0,0.5)` background, `backdropFilter: blur(4px)`, z-index 1200.
  - Modal card: centered, max-width 600px, white background, border-radius, padding, `overflow-y: auto`, `maxHeight: 90vh`.
  - Header: "Tambah UMKM" or "Edit UMKM" (with Store icon) + close button (X icon).
  - Form fields: `nama_umkm` (text, required), `kategori_kebutuhan` (select from KATEGORI_UMKM), `deskripsi` (textarea rows=6), `kontak_nama` (text, required), `kontak_hp` (text), `kontak_email` (email), `foto_produk` (file input, multiple, image/*).
  - Photo preview grid: 80x80px thumbnails using `<Image>` with remove button (X overlay) per photo.
  - Upload progress: Loader2 spinning when `uploadingPhotos` is true.
  - Hint text: "Maksimal 8 foto, masing-masing maks 2MB".
  - Submit button: "Simpan" with Save icon, disabled when saving (shows Loader2 spinner).
  - Cancel button: "Batal" with X icon, calls `handleCloseForm`.
  - Submit wired to existing `handleSubmitForm()`.
  - `foto_produk` array included in the payload for both insert and update.

### 4. View Detail Modal
- Rendered when `viewingId !== null` (uses `viewedItem` derived from `umkmList.find`).
- Eye button in table row: `onClick={() => setViewingId(listing.id)}`.
- Displays:
  - `nama_umkm` as title.
  - `kategori_kebutuhan` as badge (using `KATEGORI_UMKM[label]`).
  - `deskripsi` in a paragraph.
  - Photo grid: responsive grid of `<Image>` components (200x200px) from `foto_produk` array.
  - Contact info: `kontak_nama`, `kontak_hp` (WhatsApp link via `waLink()`), `kontak_email` (mailto link).
  - Status badge (using `.badge` classes).
  - `edit_token` (monospace, with copy button + `handleCopyToken`).
  - `created_at` and `updated_at` (formatted with `toLocaleString('id-ID')`).
  - Close button.

### 5. Dead Code Activated
- All imports used: `Store`, `Plus`, `Edit2`, `Save`, `X`, `Loader2`, `Trash2`, `Search`, `Eye`, `CheckCircle2`, `XCircle`, `Clock`, `RefreshCw`.
- All state used: `showForm`, `editingId`, `form`, `saving`, `formError`, `viewingId`, `uploadingPhotos`.
- All handlers used: `handleDelete`, `handleOpenCreate`, `handleOpenEdit`, `handleSubmitForm`, `handleCloseForm`, `handlePhotoUpload`, `handleRemovePhoto`, `handleCopyToken`.
- `viewedItem` used in view modal.
- `STATUS_LABELS` used in status badge labels and toast messages.

### 6. Toast Replacements
- Imported `useToast` from `@/components/Toast`.
- Added `const { toast } = useToast()`.
- All `console.error(...)` replaced with `toast('descriptive message', 'error')`.
- All `alert(...)` replaced with toast.
- Success toasts added: after create ("UMKM berhasil ditambahkan"), update ("UMKM berhasil diperbarui"), delete ("Listing UMKM berhasil dihapus"), status update, photo upload, token copy.
- `handleDelete` uses `confirm()` for confirmation then toast on success/error.

### 7. `<Image>` from next/image
- All images use `<Image>` from `next/image` (no `<img>` tags).
- Added `unoptimized` prop to handle Supabase Storage URLs without requiring next/image optimization config.
- Added `images.remotePatterns` to `next.config.ts` for `*.supabase.co` storage paths.

### Additional Changes
- `next.config.ts`: Added `images.remotePatterns` config for Supabase Storage public URLs (`*.supabase.co` / `/storage/v1/object/public/**`).
- Added `foto_produk: string[] | null` to `UMKMListing` interface.
- Added `foto_produk: string[]` to `FormData` interface and `emptyForm`.
- Added `handleCloseForm` helper for clean modal closing.
- Added `handleCopyToken` for edit token copy-to-clipboard.
- Added `statusBadgeClass` and `statusBadgeLabel` helper functions for consistent badge rendering.
- Added loading state and empty state for the table.
- Added delete button (Trash2 icon) in each table row.
- Click-outside-to-close on both modal overlays.

## Test Results

### TypeScript Check (`npx tsc --noEmit`)
- **Result: PASS** — 0 errors.

### ESLint (`npm run lint`)
- **Result: PASS for `src/app/admin/umkm/page.tsx`** — 0 errors, 0 warnings from this file.
- Other files in the project have pre-existing errors/warnings (not introduced by this task).

### Build (`npm run build`)
- **Result: PASS** — Build succeeded, all routes compiled including `/admin/umkm`.

## Files Changed

1. `src/app/admin/umkm/page.tsx` — Full rewrite: added photo upload, form modal, view modal, toast integration, all dead code activated.
2. `next.config.ts` — Added `images.remotePatterns` for Supabase Storage URLs.

## Self-Review Findings

### Concerns
1. **`unoptimized` prop on `<Image>`**: Used `unoptimized` on the `<Image>` components for Supabase Storage URLs. This bypasses Next.js image optimization. The `remotePatterns` config was also added to `next.config.ts` as a belt-and-suspenders approach, but `unoptimized` is used to ensure images render even if the optimization endpoint has issues with Supabase Storage URLs. If full optimization is desired, remove `unoptimized` and rely solely on `remotePatterns`.

2. **`snapshot_approved` field**: The existing `handleUpdateStatus` code references `snapshot_approved: null` when publishing. This field is not in the `UMKMListing` interface (it's only used in the update payload, not selected/read). This was pre-existing code and left as-is. If the column doesn't exist in the database, the update would fail — but this is pre-existing behavior, not introduced by this task.

3. **`confirm()` for delete**: The task specified using `confirm()` for delete confirmation. This is a browser-native blocking dialog. It's consistent with the existing code and the gallery admin page pattern.

4. **No `<img>` tags introduced**: All images use `<Image>` from next/image as required.

5. **All previously dead imports/state/handlers are now actively used**: Verified via lint (no unused variable warnings from this file).

### Positive Findings
- Follows existing patterns from `src/app/admin/gallery/page.tsx` (modal overlay style, form structure).
- Follows existing `react-hooks/set-state-in-effect` eslint-disable pattern from `src/app/admin/page.tsx`.
- Uses project's CSS class system (`form-group`, `form-label`, `form-input`, `badge`, `btn`).
- Uses `waLink()` utility from `@/lib/utils` for WhatsApp links.
- Uses `KATEGORI_UMKM` constant for select options and badge labels.
- No comments added to code (per code style requirement).
