# Production Readiness Residual Report

**Worktree:** `C:\Users\Upell\AppData\Local\Temp\opencode\lmh-production-readiness`  
**Date:** 2026-07-15  
**Constraint:** No commit/push. Strict TDD. Prior gates preserved.

## Residuals closed

### 1. Gallery DELETE with storage cleanup
- **Route:** `src/app/api/investment-docs/[id]/route.ts` — `DELETE`
  - Auth + admin role (same pattern as upload)
  - Loads `file_path` + `halaman_gambar`
  - Removes storage objects under `investment-docs` first, then DB row
  - 401 / 403 / 404 / 200; 500 if DB fails after storage cleanup (with note)
- **UI:** `src/app/admin/gallery/page.tsx` `handleDelete` → `DELETE /api/investment-docs/${id}`
- **Tests:** `src/app/api/investment-docs/[id]/route.test.ts` + gallery delete path in `gallery.test.tsx`

### 2. `sample_count` on `v_antrian_loket`
- **Baseline:** `supabase/migrations/202607140005_views_and_jobs.sql`
  - Adds `COALESCE((SELECT estimate.sample_count …), 0) AS sample_count`
- **Contract:** `antrean_estimasi.test.ts` asserts column presence
- **UI:** `EstimasiAntrean` already treats `sample_count > 0` as historical; provisional when 0/missing

### 3. Web-push producers for visit lifecycle
- **Function:** `notify_visit_selesai` in `202607140004_security_and_automation.sql`
  - `selesai`: email (existing) + `web_push` when `pengunjung.auth_user_id` present (`type: skm_survey_push`)
  - `menunggu`: `web_push` “Anda masuk antrean” (`type: visit_menunggu`)
  - `dilayani`: `web_push` “Giliran Anda dimulai” (`type: visit_dilayani`)
- Idempotency via existing `queue_notifikasi` payload keys (`visit_id` + `type`)
- **Contract:** `notifikasi.test.ts` extended

### 4. Vercel Cron GET support
- `src/app/api/notif/send/route.ts` — `GET` = same handler as `POST`
- `src/app/api/notif/retry/route.ts` — `GET` = same handler as `POST`
- **Tests:** GET unauthorized 401; GET with valid `CRON_SECRET` processes like POST

### 5. Report
- This file.

## Verification

| Command | Result |
|---------|--------|
| `npm run lint` | pass (`eslint . --max-warnings=0`) |
| `npm run typecheck` | pass (`tsc --noEmit`) |
| `npm run test` | **429 passed** / 70 files |
| `npm run build` | pass (`next build`, exit 0); includes `/api/investment-docs/[id]` |

## Status

**DONE** — all four residual work items + report complete. No commit/push.
