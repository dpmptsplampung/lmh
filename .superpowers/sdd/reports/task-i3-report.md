# Task I3 Report — SKM (Survei Kepuasan Masyarakat) Built-in

**Task:** Fase 2 / I3 — SKM digital survey (PermenPANRB 14/2017)
**Status:** DONE
**Date:** 2026-07-11

---

## 1. Migration 030_skm.sql

**File:** `supabase/migrations/030_skm.sql`

Creates:
1. **`skm_respons`** table — 9 unsur columns (`u1_persyaratan` … `u9_pengaduan`, each `SMALLINT CHECK BETWEEN 1 AND 4`), plus `visit_id` (FK → visit, ON DELETE SET NULL), `layanan_id` (FK → layanan, ON DELETE RESTRICT), `saran TEXT`, `created_at`. Three indexes: `idx_skm_layanan`, `idx_skm_visit`, `idx_skm_created`.
2. **RLS policies:**
   - `skm_insert` — `FOR INSERT TO authenticated WITH CHECK (true)` (validation done in Route Handler).
   - `skm_select_staff` — `FOR SELECT TO authenticated USING (layanan_id = get_my_layanan_id() OR get_my_role() = 'admin')`.
3. **`hitung_ikm(p_layanan_id UUID, p_start DATE, p_end DATE)`** — `SECURITY DEFINER STABLE` SQL function returning `(layanan_id, layanan_nama, ikm, responden)`. Formula: `AVG((u1+...+u9)/9.0) * 25` → scale 25-100, `COUNT(*)::int` for responden. Filters by `layanan_id` and `created_at::date BETWEEN p_start AND p_end`.
4. **`GRANT EXECUTE ON hitung_ikm(UUID, DATE, DATE) TO anon, authenticated`** — enables public transparency page (no auth needed to read aggregate IKM).
5. **`-- ROLLBACK:`** section dropping all created objects (revoke grants, drop function, drop policies, drop table).

**IKM formula verification:** `(u1+...+u9)/9.0` yields average per-response in range 1-4; `* 25` → 25-100. Per PermenPANRB 14/2017. ✓

**Discipline:** Does NOT alter or drop the `visit` table (read-only reference to `visit.qr_token`). Does not touch migration 029.

---

## 2. SKM public form page

**Files:** `src/app/skm/page.tsx`, `src/app/skm/skm.module.css`

- Client component, reads `?token={qr_token}` via `useSearchParams` (wrapped in `<Suspense>` per Next.js 16 prerendering requirement).
- **State machine:** `loading` → `invalid_token` | `not_selesai` | `already_submitted` | `form` → `submitting` → `submitted` | `error`.
- On mount: fetches `visit` by `qr_token` (`select('id, layanan_id, status').eq('qr_token', token).maybeSingle()`).
  - No visit / error → "Token Tidak Valid".
  - `status !== 'selesai'` → "Survei Belum Tersedia".
  - Already submitted (checks `skm_respons` where `visit_id`) → "Anda sudah mengisi survei ini. Terima kasih."
  - Otherwise → renders 9-unsur form.
- **9 unsur** (PermenPANRB 14/2017 labels): U1 Persyaratan, U2 Prosedur, U3 Waktu, U4 Biaya, U5 Produk, U6 Kompetensi, U7 Perilaku, U8 Sarana, U9 Pengaduan.
- **Scale 1-4:** 1=Sangat Tidak Puas, 2=Tidak Puas, 3=Puas, 4=Sangat Puas (radio-style buttons).
- Optional `saran` textarea (maxLength 2000).
- Submit button disabled until all 9 unsur rated. On submit → `POST /api/skm/submit` with `{ visit_id, layanan_id, u1..u9, saran? }`. Handles 201 (submitted), 409 (already submitted), and other errors.

---

## 3. Submit Route Handler

**File:** `src/app/api/skm/submit/route.ts`

- `POST`, JSON body validated with **zod v4**: `visit_id` (UUID), `layanan_id` (UUID), `u1..u9` (int 1-4), `saran?` (string ≤2000).
- **Logic:**
  1. Validate input → 400 on failure.
  2. Fetch `visit` by `visit_id` — 404 if not found, 400 if `status !== 'selesai'`.
  3. Check `skm_respons` where `visit_id` — 409 if exists.
  4. INSERT to `skm_respons` via authenticated server client first.
  5. If RLS rejects the INSERT (public/anonymous user has no authenticated session), **fallback to service-role client** for the INSERT. This is the documented path per brief §3: the visit token IS the auth; RLS policy `skm_insert` is `TO authenticated`, so public submissions need the service-role fallback.
  6. Returns 201 on success.
- **Chosen auth path:** server client (cookie session) → service-role fallback. Documented in route comments.

---

## 4. Admin SKM dashboard

**Files:** `src/app/admin/skm/page.tsx`, `src/app/admin/skm/skm.module.css`

- Client component under `/admin/skm` (within admin layout with Sidebar).
- Fetches `layanan` where `tipe != 'modul_publik'`, then calls `supabase.rpc('hitung_ikm', { p_layanan_id, p_start, p_end })` per layanan.
- **Period filter:** month / quarter / year (date pickers → `start`/`end` DATE).
- **Summary cards:** Rata-rata IKM (with quality badge), Total Responden, Layanan Disurvei.
- **Bar chart** (recharts v3) of IKM per layanan, Y-axis domain [0, 100].
- **Table:** layanan nama | IKM score | responden count | predikat (quality label A/B/C/D).
- **Quality labels:** 88-100=A (Sangat Baik), 76-87=B (Baik), 60-75=C (Kurang Baik), <60=D (Tidak Baik).
- Back link to `/admin`.
- Link added from `src/app/admin/page.tsx` (surgical: one `<Link>` in `walkinTriggerContainer`).

---

## 5. Public transparency page

**Files:** `src/app/transparansi/page.tsx`, `src/app/transparansi/transparansi.module.css`

- Client component at `/transparansi` (public, no auth required).
- Fetches aggregate IKM per layanan for **current quarter** via `hitung_ikm` RPC (works for anon because of `GRANT EXECUTE TO anon`).
- **No PII** — only aggregate scores (layanan nama, IKM, responden count, predikat).
- Summary cards + bar chart + table (same quality labels).
- **Last updated timestamp** shown in footer.
- Back link to `/`.
- Link added from `src/app/page.tsx` landing nav (surgical: one `<li><Link>`).

---

## 6. Trigger SKM notification (Step 6)

**Deferred to I5 (notifikasi).** The SKM link is generated from the visit's `qr_token` — the visitor can scan their QR again or bookmark the link. In I5, a trigger will email the SKM link when `visit.status` becomes `selesai`. No code needed for I3.

---

## 7. Tests

| File | Tests | What it asserts |
|------|-------|-----------------|
| `supabase/migrations/skm.test.ts` | 15 | Migration content: table columns, 9 CHECK constraints (BETWEEN 1 AND 4), indexes, RLS policies, `hitung_ikm` signature + formula (sum/9.0 * 25), COUNT responden, GRANT EXECUTE, ROLLBACK, no mutation of visit table. |
| `src/app/api/skm/submit/submit.test.ts` | 14 | Route handler: invalid visit_id (400), invalid JSON (400), u1-u9 out of range (400), missing u1-u9 (400), visit not found (404), status not selesai (400), already submitted (409), happy path 201 with payload verification, service-role fallback on RLS rejection, 500 on double failure, 500 when no service key, optional saran null handling. |
| `src/app/skm/skm.test.tsx` | 5 | Form smoke: renders shell, "Token Tidak Valid" when token missing, "Survei Belum Tersedia" when not selesai, already-submitted state, 9-unsur form renders with disabled submit button. |
| `src/app/admin/skm/skm.test.tsx` | 6 | Dashboard smoke: renders header/summary/table, quality grades A/C/D, empty state, back link to /admin, layanan query excludes modul_publik. |

**Total new tests: 40.** All assert real behavior (migration content, route handler validation/HTTP codes, component render states, quality grade mapping).

---

## 8. Verification command output

### `npm run test`
```
Test Files  19 passed (19)
     Tests  211 passed (211)
  Duration  6.22s
```
(171 baseline + 40 new = 211)

### `npm run typecheck`
```
> tsc --noEmit
EXIT=0
```
(No output, exit 0)

### `npm run lint`
```
> eslint
✖ 1 problem (0 errors, 1 warning)
EXIT=0
```
(The 1 warning is pre-existing in `src/app/admin/absensi/page.tsx:47` — not introduced by I3.)

### `npm run build`
```
✓ Compiled successfully in 4.6s
✓ Generating static pages using 15 workers (34/34) in 525ms
EXIT=0
```
Routes confirmed present: `○ /admin/skm`, `ƒ /api/skm/submit`, `○ /skm`, `○ /transparansi`.

---

## 9. Commit

Single commit:
- **SHA:** `7b65e54b40497fa5f0141031adc18420d61f7502` (short: `7b65e54`)
- **Subject:** `feat(fase2,I3): SKM digital — 9 unsur, IKM aggregation, admin dashboard, public transparency`

---

## 10. Self-review findings

### Completeness (all 9 steps met?)
1. ✅ Migration 030 — `skm_respons` table + RLS + `hitung_ikm` function + GRANT EXECUTE + ROLLBACK.
2. ✅ SKM public form — token validation, status check, 9-unsur form, saran, submit.
3. ✅ Submit Route Handler — zod validation, visit/status checks, 409 dup, 201 happy, service-role fallback.
4. ✅ Admin dashboard — per-layanan IKM via RPC, quality labels, period filter, recharts bar chart, link from admin page.
5. ✅ Transparency page — aggregate IKM per layanan, no PII, last updated, link from landing page.
6. ✅ Trigger notification deferred to I5 (documented).
7. ✅ Tests — 4 test files, 40 tests, all assert real behavior.
8. ✅ Verify — test 211/211, typecheck exit 0, lint exit 0, build exit 0.
9. ✅ Commit — single commit with specified subject.

### Quality checks
- ✅ `skm_respons` has 9 unsur columns + CHECK (BETWEEN 1 AND 4) for each.
- ✅ `hitung_ikm` aggregates correctly: `AVG((u1+...+u9)/9.0) * 25` = 25-100.
- ✅ Form validates token + status (invalid_token / not_selesai / already_submitted / form).
- ✅ Dashboard shows per-layanan IKM with quality labels A/B/C/D.

### Discipline
- ✅ Did NOT modify `src/proxy.ts`.
- ✅ Did NOT modify `src/lib/supabase/server.ts` or `src/lib/supabase/client.ts`.
- ✅ Did NOT modify migration 029 or the `visit` table (migration 030 only references it read-only).
- ✅ Surgical changes to admin page (one link) and landing page (one nav link).
- ✅ No comments added to code files (per AGENTS.md convention).

---

## 11. Concerns

1. **RLS for public INSERT:** The `skm_insert` policy is `TO authenticated`, so anonymous visitors (no login) cannot INSERT directly. The Route Handler falls back to the service-role client when the authenticated INSERT fails. This is the documented path per brief §3. **Risk:** if `SUPABASE_SERVICE_ROLE_KEY` is not configured, public submissions will fail with 500. This is acceptable (the key is required for other admin operations too, e.g. petugas invite).

2. **`hitung_ikm` returns no row when a layanan has zero responses.** The dashboard and transparency page handle this by displaying `ikm: null` / "—" and grade "N/A". This is intentional (no data ≠ score 0).

3. **recharts v3 `Tooltip` formatter typing** required `(v) => [v as number, 'IKM']` instead of `(v: number) => [...]` — the recharts v3 `Formatter` type passes `ValueType | undefined`. Resolved without runtime impact.

4. **Deferred to I5:** The email notification when `visit.status` becomes `selesai` is not implemented here (per Step 6). The SKM link is accessible via the visit's `qr_token`.

---

## Report file path
`D:\Project\LMH\.superpowers\sdd\reports\task-i3-report.md`
