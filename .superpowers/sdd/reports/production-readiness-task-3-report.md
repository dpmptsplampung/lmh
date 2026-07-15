# Production Readiness Gate 3 — Highest-Impact UX/WCAG

**Branch/worktree:** `C:\Users\Upell\AppData\Local\Temp\opencode\lmh-production-readiness`  
**Date:** 2026-07-15  
**Commit:** not created (explicit Do NOT commit/push)  
**Gates 0–2:** preserved

## Verification (fresh)

| Command | Result |
|---------|--------|
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm run typecheck` | **PASS** |
| `npm test` | **PASS** — **415 tests**, 69 files (+16 Gate 3 a11y/UX tests) |
| `npm run build` | **PASS** (EXIT=0; route `/kebijakan-privasi` in app-path-routes-manifest) |

## Deliverables

### 1. Kebijakan privasi route — DONE

| Item | Status | Evidence |
|------|--------|----------|
| Server-rendered page Indonesian | GREEN | `src/app/kebijakan-privasi/page.tsx` |
| Sections: pengendali, data, tujuan, retensi 730 provisional, hak subjek, kontak, versi | GREEN | Full copy; no DPO personal name; no `TBD`/`[nama]` |
| Version matches CONSENT_VERSION `1.0` | GREEN | `POLICY_VERSION = '1.0'`; test asserts checkin/chat |
| Links from checkin/chat | GREEN | Existing `href="/kebijakan-privasi"` |
| Footer/login links | GREEN | Landing footer + login privacy link |
| Tests | GREEN | `kebijakan-privasi.test.tsx` (3) |

### 2. Interactive div → native controls — DONE

| Item | Status | Evidence |
|------|--------|----------|
| Reservasi tujuan radios | GREEN | Native `<input type="radio">` + labels; radiogroup |
| Gallery peta card | GREEN | `<button type="button" className={styles.petaCard}>` |
| Admin chat session list | GREEN | `<button type="button">` for session select |
| Tests | GREEN | `tujuan-a11y.test.tsx`, `gallery-a11y.test.tsx`, `chat-session-a11y.test.ts` |

### 3. Global touch target + reduced motion — DONE

| Item | Status | Evidence |
|------|--------|----------|
| `.btn` min 44×44 | GREEN | `globals.css` min-height/min-width 44px |
| `.btn--icon` 44×44 (was 36) | GREEN | width/height/min 44px |
| Mobile no sub-44 shrink | GREEN | mobile `.btn` reasserts min 44px |
| `prefers-reduced-motion` | GREEN | scroll-behavior auto; animation/transition ~0 |
| Contract tests | GREEN | `globals.a11y.test.ts` (4) |

### 4. Toast live region — DONE

| Item | Status | Evidence |
|------|--------|----------|
| success/info polite | GREEN | `role="status"` `aria-live="polite"` |
| error assertive | GREEN | `role="alert"` `aria-live="assertive"` |
| Indonesian close + 44px | GREEN | `aria-label="Tutup notifikasi"` min 44×44 |
| Tests | GREEN | `Toast.test.tsx` (3) |

### 5. Route not-found + error boundary — DONE

| Item | Status | Evidence |
|------|--------|----------|
| `not-found.tsx` ID + home | GREEN | Halaman Tidak Ditemukan → Beranda |
| `error.tsx` client retry | GREEN | Coba Lagi → `reset()` |
| `loading.tsx` skeleton | GREEN | Optional simple skeleton |
| Test | GREEN | `not-found.test.tsx` |

### 6. Contrast quick wins — DONE

| Item | Status | Evidence |
|------|--------|----------|
| FOILA white-on-green | GREEN | `#10b981` → `#047857` (darker green) |
| Gallery project cards | N/A already buttons | Lihat Dokumen / Lead CTA already `<button>` |

## Files touched (Gate 3)

**Production**
- `src/app/kebijakan-privasi/page.tsx` (new)
- `src/app/not-found.tsx` (new)
- `src/app/error.tsx` (new)
- `src/app/loading.tsx` (new)
- `src/components/Toast.tsx`
- `src/styles/globals.css`
- `src/app/me/reservasi/page.tsx`
- `src/app/me/reservasi/reservasi.module.css`
- `src/app/gallery/page.tsx`
- `src/app/gallery/gallery.module.css`
- `src/app/admin/chat/page.tsx`
- `src/app/page.tsx`
- `src/app/landing.module.css`
- `src/app/login/page.tsx`
- `src/app/login/login.module.css`

**Tests (new)**
- `src/app/kebijakan-privasi/kebijakan-privasi.test.tsx`
- `src/components/Toast.test.tsx`
- `src/styles/globals.a11y.test.ts`
- `src/app/not-found.test.tsx`
- `src/app/me/reservasi/tujuan-a11y.test.tsx`
- `src/app/gallery/gallery-a11y.test.tsx`
- `src/app/admin/chat/chat-session-a11y.test.ts`

## Residual a11y debt (out of Gate 3 / deferred)

1. **Full Dialog primitive** — many modals still use overlay `div` + stopPropagation (umkm, gallery lead, admin forms); not rewritten.
2. **Other clickable divs** — e.g. UMKM tabs/filters, SKM rating chips, landing interactions beyond critical flows.
3. **Contrast elsewhere** — chat bubble white-on-primary, umkm white-on-brand chips, dark gallery cards not fully audited.
4. **`.btn--sm` density** — min 44px helps height; dense admin tables may still feel cramped.
5. **Lighthouse CI / Playwright** — Gate 4.
6. **next/font migration** — still Google CSS import in `globals.css`.
7. **Legal sign-off** — retensi 730 days still provisional; DPO contact is institutional only.
8. **CONSENT_VERSION** still duplicated as local constants in checkin/chat (not shared module) — values match `1.0`.

## Verdict

**DONE_WITH_CONCERNS**

All P0/P1 Gate 3 items implemented under TDD (RED then GREEN), full lint/typecheck/test/build green. Concerns: residual non-critical interactive divs/modals; provisional privacy retention; no Lighthouse/Playwright; no commit/push per instructions.

**Counts:** 415 tests (was 399) · +16 new · 69 files · build EXIT=0
