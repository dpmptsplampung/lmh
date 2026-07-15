# Production Readiness Gate 2 — Core Product Flows

**Branch/worktree:** `C:\Users\Upell\AppData\Local\Temp\opencode\lmh-production-readiness`  
**Date:** 2026-07-15  
**Commit:** not created (explicit Do NOT commit/push)  
**Gates 0–1:** preserved (no migration squash / env baseline rework)

## Verification (fresh)

| Command | Result |
|---------|--------|
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** — **399 tests**, 62 files |
| `npm run build` | **PASS** (Next.js 16.2.10, EXIT=0) |

## Deliverables

### A. Visit operational lifecycle UI — DONE

| Item | Status | Evidence |
|------|--------|----------|
| Load walk_in + reservasi | GREEN | Removed `asal='walk_in'`-only; uses `.in('asal', ['walk_in','reservasi'])` |
| Asal badge | GREEN | Walk-in / Reservasi badges in table |
| Mulai Layanan `menunggu→dilayani` + `waktu_mulai_layan` | GREEN | `handleMulaiLayanan` |
| Selesai only for `dilayani` + `waktu_selesai` | GREEN | Button gated on status |
| Component tests | GREEN | `src/app/admin/antrian/antrian.test.tsx` (5 tests) |

**Files:** `src/app/admin/antrian/page.tsx`, `src/app/admin/antrian/antrian.test.tsx`

**RED→GREEN:** tests failed first (walk_in-only filter, no Mulai Layanan / dilayani path); then implementation.

**Note:** Direct client UPDATE relies on existing `visit_update_staff` RLS. Scan `terjadwal→menunggu` unchanged (`src/app/admin/scan/page.tsx`).

### B. Admin gallery PDF pipeline — DONE (with delete gap)

| Item | Status | Evidence |
|------|--------|----------|
| Create via multipart `/api/investment-docs/upload` | GREEN | `handleSave` FormData + fetch |
| No client `storage.upload` on create | GREEN | Test asserts `_storageUpload` not called |
| Delete storage cleanup | **GAP** | DB delete only; documented in UI code comment |

**Files:** `src/app/admin/gallery/page.tsx`, `src/app/admin/gallery/gallery.test.tsx`  
**Existing pipeline:** `src/app/api/investment-docs/upload/route.ts` (unchanged)

### C. UMKM magic-link email — DONE

| Item | Status | Evidence |
|------|--------|----------|
| Resend after `generateLink` | GREEN | `resend.emails.send` with action link |
| Absolute callback | GREEN | `${PUBLIC_URL}/auth/callback?next=/umkm/edit/${id}` |
| Missing Resend/config → 503 | GREEN | No service key / no RESEND / no PUBLIC_URL |
| Dev link only when `APP_ENV=development` AND `LMH_DEV_RETURN_LINK=set` | GREEN | Tests cover prod leak block |
| Tests | GREEN | 16 tests in `request-edit-link.test.ts` |

**Files:** `src/app/api/umkm/request-edit-link/route.ts`, `request-edit-link.test.ts`

### D. UMKM sisi — DONE

| Item | Status | Evidence |
|------|--------|----------|
| Admin create/edit sisi select | GREEN | `admin/umkm/page.tsx` |
| Owner edit sisi | GREEN | `umkm/edit/[id]/page.tsx` |
| Payload includes sisi | GREEN | insert/update payloads |
| Tests | GREEN | `umkm-form.test.tsx`, `umkm-edit-sisi.test.tsx` |

### E. Offline queue owner isolation — DONE (minimal)

| Item | Status | Evidence |
|------|--------|----------|
| `QueuedAction.owner_user_id` | GREEN | `queue.ts` + DB v2 index |
| `getPending(owner?)` filter | GREEN | Filter when owner provided |
| `replayQueue(owner?)` | GREEN | Passes filter to getPending |
| Checkin offline enqueue user id | GREEN | `checkin/page.tsx` uses `currentUserId` |
| Tests | GREEN | queue + replay isolation tests |

**Files:** `src/lib/offline/queue.ts`, `replay.ts`, `queue.test.ts`, `replay.test.ts`, `src/app/checkin/page.tsx`

### F. Estimasi honesty — DONE (minimal UI)

| Item | Status | Evidence |
|------|--------|----------|
| No false “14-day history accuracy” claim | GREEN | Subtitle + per-card provisional copy |
| Provisional when sample_count=0 or missing | GREEN | `isProvisional()` |
| Schema/view sample_count on `v_antrian_loket` | **NOT added** (out of minimal scope) | UI defaults missing sample → provisional |

**Files:** `src/components/EstimasiAntrean.tsx`, `EstimasiAntrean.test.tsx`

## Remaining gaps (out of Gate 2 / deferred)

1. **Gallery delete** does not remove storage objects (`_raw/*.pdf`, `pages/*`); needs staff DELETE API or cleanup job.
2. **`v_antrian_loket`** still lacks `sample_count` column — UI treats missing as provisional (honest, slightly conservative when history exists).
3. Full web-push producers, visit transition RPC state machine, WCAG redesign, Docker SQL — out of scope.
4. Offline DB version bump to 2: existing browsers keep old records without `owner_user_id` until re-enqueue (acceptable minimal isolation).

## Files touched (Gate 2)

**Production**
- `src/app/admin/antrian/page.tsx`
- `src/app/admin/gallery/page.tsx`
- `src/app/admin/umkm/page.tsx`
- `src/app/umkm/edit/[id]/page.tsx`
- `src/app/api/umkm/request-edit-link/route.ts`
- `src/app/checkin/page.tsx`
- `src/components/EstimasiAntrean.tsx`
- `src/lib/offline/queue.ts`
- `src/lib/offline/replay.ts`

**Tests**
- `src/app/admin/antrian/antrian.test.tsx` (new)
- `src/app/admin/gallery/gallery.test.tsx` (new)
- `src/app/admin/umkm/umkm-form.test.tsx` (new)
- `src/app/umkm/edit/[id]/umkm-edit-sisi.test.tsx` (new)
- `src/app/api/umkm/request-edit-link/request-edit-link.test.ts`
- `src/lib/offline/queue.test.ts`
- `src/lib/offline/replay.test.ts`
- `src/components/EstimasiAntrean.test.tsx`

## Verdict

**DONE_WITH_CONCERNS**

All priority deliverables A–F implemented under TDD with full lint/typecheck/test/build green. Concerns: gallery storage orphan on delete; estimasi `sample_count` not in public view (UI provisional fallback); no commit/push per instructions.
