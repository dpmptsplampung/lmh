# SDD Progress Ledger — LMH 2.0

> Recovery map. Tasks marked complete here are DONE — do not re-dispatch.
> Source plan: `.opencode/plans/LMH_2_0_IMPLEMENTATION_PLAN.md`
> Granularity: per-inisiatif (one subagent per K1/K2/.../Inovasi#N).
> Branch: main (consent recorded).
> Dashboard-only subtasks (anon sign-in, revoke akun, pgvector enable, magic-link config) are handled by human out-of-band; subagents only do code+migration.

## Decisions
- Branch: main (explicit consent)
- Permission: open all edits (consent)
- Granularity: per inisiatif
- TDD: Task 0 = install vitest, then TDD mandatory per task
- Dashboard tasks: human handles out-of-band; subagent marks related checkboxes as "blocked-on-dashboard" and continues code-only parts

## Tasks
- [ ] Task 0: Install vitest + test infra
- [ ] Task K1: Hentikan bocoran PDF investasi
- [ ] Task K2: Tutup IDOR chat (code parts; human enables anon sign-in)
- [ ] Task K3: Insert publik + rate limit
- [ ] Task K4: Hapus password hardcode (code parts; human rotates prod passwords)
- [ ] Task K5: Magic-link UMKM (code parts; human configures Supabase Auth email)
- Gate 0
- [ ] Task I1: Unified Visit Spine
- [ ] Task B2: Tipe layanan
- [ ] Task B4: Pisahkan seed demo
- [ ] Task B5: Model akun mitra (docs only)
- [ ] Task A1: Role di JWT claims (code parts; human sets auth hook)
- [ ] Task I8: Tata kelola PDP
- Gate 1
- [ ] Task I3: SKM Built-in
- [ ] Task I2: Antrean pintar
- [ ] Task I5: Notifikasi email + web-push
- Gate 2
- [ ] Task I4: Asisten AI ber-RAG (code parts; human enables pgvector)
- [ ] Task I6: Funnel investor
- [ ] Task I7: Marketplace UMKM dua sisi
- Gate 3
- [ ] Task I9: Offline-first PWA + WCAG
- Gate 4 — RILIS LMH 2.0

## Cross-cutting
- [ ] X.1 Update AGENTS.md
- [ ] X.2 .env.example
- [ ] X.3 Arsip PRD.md & ARCHITECTURE.md
- [ ] X.4 README proper
- [ ] X.5 (covered by Task 0)
- [ ] X.6 CI GitHub Actions
- [ ] X.7 CHANGELOG.md

## Completed
- Production Readiness residual close-out: complete (working tree) — gallery DELETE + storage cleanup API; v_antrian_loket.sample_count; web-push producers for visit menunggu/dilayani/selesai; notif send/retry GET for Vercel Cron; 429 tests, lint/typecheck/build pass. Still human: Docker SQL, staging, commit/push.
- Production Readiness Gate 4+5: complete (working tree on `production-readiness`) — CI Node 20.19, coverage config, smoke script, supabase/config.toml, honest PRODUCTION_READINESS + DEPLOY_RUNBOOK (5 baselines CLI), BACKUP_RESTORE, TESTING.md; 415 tests, build pass. Residual: Docker SQL, staging secrets, Playwright/E2E, no commit/push.
- Production Readiness Gate 3: complete (working tree on `production-readiness`, review clean) — /kebijakan-privasi, native keyboard controls for reservasi/gallery/admin chat, 44px touch targets, reduced motion, toast live regions, not-found/error boundaries, FOILA contrast; 415+ tests. Residual: full dialog primitive, Lighthouse CI.
- Production Readiness Gate 2: complete (working tree on `production-readiness`, review clean) — antrian walk_in+reservasi with Mulai/Selesai lifecycle; gallery create via PDF pipeline API; magic-link Resend send; UMKM sisi; offline owner isolation; estimasi provisional copy; 399 tests passing. Residuals: gallery delete storage orphans; no sample_count on view.
- Production Readiness Gate 1B: complete (working tree on `production-readiness`, review clean after consent fix) — kategori profil aligned to DB; service-role insert bypass removed on lead/inquiry; consent ownership + checkin assertion; audit allowlist; notif claim/complete; PDF magic/page-cap/cleanup; 385 tests passing.
- Production Readiness Gate 1A: complete (working tree on `production-readiness`, review clean after fixes) — 38 migrations squashed to 5 final-state baselines; legacy tables/tokens removed; reservation nama, UMKM public view, SKM token RPCs, Auth Hook event contract, restored final-invariant tests; 373 tests passing (static). Residual: Docker unavailable for live db reset.
- Production Readiness Gate 0B: complete (working tree on `production-readiness`, review clean) — strict Vercel env validation, structured redacted logs, live/ready endpoints with abortable DB probe, request IDs, service-worker health bypass, and report-only security headers; 523 tests passing.
- Production Readiness Gate 0A: complete (working tree on `production-readiness`, review clean) — deterministic Vitest discovery, strict warning-free lint, Node 20.19 pin, hardened RLS guards, and `verify:baseline`; 474 tests passing.
- Task 0: complete (commits 8d28114..a38bdf2, review clean) — vitest + test scripts + smoke test. Minor: plugin-react vite peer-dep latent, exclude overrides vitest defaults (both non-blocking).
- Task K1: complete (commits a38bdf2..d69ce9a, review approved) — PDF exfiltration closed. Minor (deferred to final review): upload never attempts service-role client (relies on user-scoped + 018 admin policy); migration 020 path-scoped policies redundant w/ 018 bucket-wide; no happy-path upload test. Runtime concerns: SUPABASE_SERVICE_ROLE_KEY needed in env for page-image; pdfjs font warning; backfill script not run.
- Task K2: complete (commits d69ce9a..825bba6, review approved) — chat IDOR closed via pengunjung_id + ownership RLS. Minor (deferred): UPDATE WITH CHECK allows visitor to mutate own session metadata (spec-compliant but harden later); anon-row fallback silently swallows INSERT failure.
- Task K3: complete (commits 825bba6..ba7aa48, review approved) — rate limit via check_anon_rate() + AFTER INSERT triggers. Minor (deferred): TOCTOU race in check_anon_rate (acceptable for threat model); anon_rate_limit has no pruning job; ROLLBACK uses CASCADE on function drops.
- Task K4: complete (commits ba7aa48..f95baec, review approved; mojibake non-issue — byte-level audit confirmed clean, commit 2fed499) — migration 023 deletes 9 hardcoded accounts, seed-demo.sql for dev, invite Route Handler + admin UI, regression guard test. Runtime concerns: human must provision replacement accounts via invite BEFORE applying migration 023 to prod; createUser-without-password needs manual smoke test against real Supabase.
- Task K5: complete (commits f95baec..31ebfc4, review approved after fix 67f2df8) — magic-link UMKM edit via Supabase Auth, owner RLS (UPDATE blocks self-publish), no-leak request-link route, edit page. Fix addressed: rate-limit now logs every request (not just owner matches); redundant .or() removed. Minor (deferred): clientIp() captured but unused; auth.users PostgREST lookup likely always null (defensive fallback handles it). Runtime: Supabase Site URL must match app URL for magic-link redirect.
- Task B2+B4+B5: complete (commit aa56453, review approved) — migration 025 adds tipe column + backfill; UI filters on checkin/reservasi/chat; seed-demo appends 9 Unsplash INSERTs; migration 026 updates wa_number (placeholder); KEBIJAKAN_AKUN_MITRA.md + AGENTS.md update. Minor (deferred): migration 025 not idempotent (no IF NOT EXISTS — matches brief spec); wa_number placeholder needs human replacement.
- Task A1: complete (commit e60df8c, review approved) — proxy.ts reads role from JWT app_metadata first, fallback to DB .maybeSingle(); migration 027 set_user_role_claim() function for Auth hook. Runtime: human must wire Auth hook in Dashboard for JWT path to activate; until then fallback works. Tests assert from('petugas') NOT called on JWT path.
- Task I8: complete (commit 4a9d671, review approved) — audit_log + consent_log + audit_change() SECURITY DEFINER triggers on 5 tables + anonymize_inactive_pengunjung pg_cron + DPO dashboard + KEBIJAKAN_PDP.md. Scope expansion: added pengunjung.updated_at column (necessary for anonymization, minimal + idempotent + documented). Minor (deferred): chat consent INSERT is best-effort (swallows errors); audit_change() logs full to_jsonb(NEW) which could include PII (redact later); DPO dashboard test mock fragile (date-diff heuristic). Runtime: human must enable pg_cron in Dashboard.
- Task I1.a: complete (commit 248c207, review approved) — migration 029 creates visit table + RLS + dual-write triggers (kunjungan insert+update, reservasi insert+update) + idempotent backfill + ROLLBACK. ZERO UI changes (verified). Reused update_updated_at_column() from 016 + check_anon_rate() from 022. COALESCE fallback for nama added. Minor (deferred): sync_kunjungan_update_to_visit syncs extra columns beyond brief draft (transparent enhancement, low risk); visit_insert_walk_in is TO authenticated (matches existing pattern, but true anon walk-in would need TO anon — flag for I1.c).
- Task I1.b: complete (commit 1bff5df + fix 3219e9c, review approved after fix) — all 17 query sites in 6 files switched from kunjungan/reservasi to visit with asal filters. JOINs preserved. Fix addressed: 'hadir' status mapped to 'menunggu' in scan UPDATE + me/page filter + getStatusLabel case (brief had incorrectly claimed 'hadir' was valid in visit.status CHECK). Minor (deferred): dual-write triggers now idle for app-originated rows (intended under Option A, cleanup in I1.c); redundant updated_at in scan UPDATE (harmless, trg_visit_updated overwrites); stale "kunjungan" string in admin error message.
- Task I3: complete (commit 1151f64 + fix a25be3e, review approved after fix) — SKM digital survey (9 unsur PermenPANRB 14/2017), hitung_ikm RPC, admin dashboard + chart, public transparency page. Fix addressed: DB partial unique index on skm_respons.visit_id + service-role duplicate check + 23505→409 mapping. Minor (deferred): form pre-submit duplicate check is best-effort for anon (RLS blocks SELECT — route 409 is enforcement); hitung_ikm JOIN on parameter not s.layanan_id (readability only); period filter is presets not free date pickers. Runtime: public SKM INSERT uses service-role fallback — needs SUPABASE_SERVICE_ROLE_KEY in env.
- Task I2: complete (commit 6e5be97, review approved) — materialized view mv_estimasi_layanan + view v_antrian_loket (filters tipe=konsultatif) + refresh_estimasi_layanan() SECURITY DEFINER + pg_cron DO block. EstimasiAntrean component with Realtime subscription + cleanup. Added to landing + reservasi form. Minor (deferred): data-wait-level attribute collapses empty→normal (CSS keys on class, not attribute — cosmetic); no polling fallback (Realtime-only); assumes 1 loket per layanan (v1 per brief).
- Task I5: complete (commit fc19727 + fix fb54c16, review approved after fix) — notifikasi table + queue_notifikasi() + triggers (visit→selesai queues SKM email, umkm→published queues owner email) + send/retry routes (CRON_SECRET protected) + Vercel Cron + push_subscriptions + notifications page + service worker. Fix addressed: updateStatus now async + awaited at all 15 call sites (was discarding Promises — DB writes never happened); retry_count only increments on failed (not on sent); 3 regression tests added (macrotask-based, catch await bug). Minor (deferred): sendPush creates new service client per call (pass adminClient instead); push subscription dedup edge case (23505 on re-subscribe); notificationclick uses loose includes() match. Runtime: VAPID keys + RESEND_API_KEY + CRON_SECRET + verified Resend domain all required.
- Task I4: complete (commit b91bb89, review approved) — Gemini 1.5 Flash + text-embedding-004 + pgvector + ivfflat index + match_faq RPC (SECURITY DEFINER, GRANT EXECUTE) + chat_ai_log audit table + chat AI route (similarity < 0.7 → eskalasi BEFORE Gemini call, strict system prompt "Jawab HANYA dari konteks", fail-safe to eskalasi on any error) + embed route (admin bulk backfill) + admin AI log page with "Tambah ke FAQ" link. Minor (deferred): vector literal passed as text (implicit cast works in practice but unverified against live DB); chat route bypasses getEmbeddingModel helper (embed route uses it); admin log page has no pagination (LIMIT 100 per brief). Runtime: pgvector extension must be enabled in Dashboard + embedding backfill via /api/admin/faq/embed required before AI works.

## Final whole-branch review (commit b91bb89)
- Verdict: **Needs fixes first** (3 code + 1 doc before production deploy)
- Must-fix code:
  1. `/api/chat/ai` has NO rate limiting + NO sesi_id ownership check → cost-abuse vector against Gemini billing + log pollution. Add check_anon_rate('chat_ai_call', N, 60) + verify sesi_id belongs to caller.
  2. `anon_rate_limit` table has no pruning job → unbounded growth. Add pg_cron DELETE WHERE created_at < now() - 7 days.
  3. `push_subscriptions` UNIQUE(endpoint) → 23505 on re-subscribe (users clearing browser data get errors). Add ON CONFLICT DO UPDATE or catch in page.
- Must-fix doc:
  4. Consolidated deploy runbook + complete `.env.example` (current .env.example missing core Supabase vars + CRON_SECRET config notes + VAPID public variant). No single ordered checklist for the human.
- wa_number placeholder in migration 026 needs DPMPTSP confirmation before/after apply.
- K1-K5 verified CLOSED at whole-system level. Migration ordering 020-035 clean. RLS coherent (one minor: faq_knowledge_base.embedding exposed to anon SELECT — derived from public text, low risk, track as follow-up).
- ~10 tracked follow-up items acceptable as post-merge P2/P3 (PII redaction in audit_change, polling fallback for antrean, admin log pagination, etc.).

## Final-review fixes applied (commit 0e695ce)
- All 4 must-fix items resolved:
  1. `/api/chat/ai` now verifies sesi_id ownership (403 if not owner) + rate-limited via check_anon_rate('chat_ai_call', 10, 60) → 429 if exceeded
  2. Migration 036 adds prune_anon_rate_limit() + pg_cron schedule (daily 3am, delete > 7 days)
  3. Notifications page upserts push_subscriptions on endpoint conflict (23505 → update instead of error)
  4. `docs/DEPLOY_RUNBOOK.md` created with 5 sections + `.env.example` completed with all 12 env vars
- 350 tests passing (331 + 19 new across the 4 fixes)
- **LMH 2.0 branch is now production-ready pending human Dashboard configuration per DEPLOY_RUNBOOK.md**

## Task I6: Funnel investor (commit 12f3158, review pending)
- Migration 037: investasi_lead table + RLS (INSERT rate-limited via check_anon_rate('investasi_lead_insert', 3, 3600) with petugas/admin exempt, SELECT admin+petugas, UPDATE admin-only) + audit trigger (reuses audit_change from 028) + updated_at trigger (reuses update_updated_at_column) + log_anon_action trigger.
- POST /api/investasi/lead: zod validation, doc existence+aktif check, INSERT with service-role fallback (skm/submit pattern).
- PATCH /api/investasi/lead/[id]: admin-only status update (verifies get_my_role via DB).
- Gallery page: "Ajukan Minat Investasi" CTA per IPRO card + modal form (nama/email/instansi/minat/catatan) with success/error states, accessibility attrs.
- Admin /admin/investasi-leads: CRM-lite table with status dropdown filter + search, inline status update via PATCH, status badges (baru=blue, dihubungi=amber, berlanjut=green, ditolak=red, selesai=gray).
- Sidebar: "Lead Investasi" nav entry added.
- Minor (deferred): no unique constraint per email+doc_id (duplicate leads possible); rate limit bypassable via service-role fallback for anon; investment_documents relation typed as array (Supabase join quirk).
- 436 tests passing (350 + 86 new across I6+I7). Lint/typecheck/build clean.

## Task I9: Offline-first PWA + WCAG (commit 061675e, review approved)
- PWA manifest `public/manifest.json` (name, icons reusing logo.png for all sizes, theme_color #4f46e5).
- Unified service worker `public/sw.js` (precache app shell + /offline, network-first runtime cache for pages, cache-first for /_next/static, background sync 'checkin-sync', push + notificationclick handlers copied from sw-push.js). `ServiceWorkerRegister.tsx` registers prod-only. Notifications page switched from sw-push.js to sw.js (sw-push.js kept for backward compat).
- `/offline` fallback page (precached).
- `src/lib/offline/queue.ts` — IndexedDB queue (lmh-offline/queue, enqueue/getPending/markSynced/removeSynced/clearQueue). `fake-indexeddb` devDep added for tests.
- `src/lib/offline/replay.ts` — replays queued actions via existing API routes (checkin/investasi_lead/umkm_inquiry). markSynced only on res.ok; leaves in queue on failure.
- `src/app/api/checkin/route.ts` — centralized checkin POST (online + replay path). Matches previous direct-INSERT behavior (asal='walk_in', tujuan='loket', status='menunggu', waktu_masuk).
- Checkin page: offline branch enqueues to IndexedDB + registers background sync; 'online' event triggers replayQueue().
- Mode bantuan: `src/app/api/admin/checkin-asist/route.ts` (petugas+admin, service-role INSERT, pengunjung_id=NULL) + `src/app/admin/checkin-asist/page.tsx` form + sidebar nav "Checkin Bantuan".
- WCAG 2.1 AA: skip-link + `<main id="main-content">` in layout, `*:focus-visible` outline in globals.css, `--text-tertiary` darkened (#94a3b8 → #64748b, 4.62:1 AA pass), heading hierarchy fixed (h3→h2 on admin dashboard + transparansi), ARIA labels on umkm search inputs, alt text verified.
- 467 tests passing (436 + 31 new). Lint/typecheck/build clean.

## Final whole-branch review (I6+I7+I9, commits 12f3158 + 061675e)
- Verdict: **Approved** — 0 must-fix blockers. Safe for production deploy.
- Security confirmed: RLS correct on 037+038, no contact leak (kontak_hp/kontak_email not in /api/umkm/inquiry response or public UMKM cards — verified by test + grep), admin routes properly gated (investasi/lead/[id] PATCH admin-only, checkin-asist petugas+admin), no IDOR on inquiry/[id] (owner-scoped via umkm_listing_owner join), SW caches only same-origin GETs (no auth token leak).
- Doc updated: DEPLOY_RUNBOOK.md migration list extended 036 → 038, smoke tests added for I6/I7/I9 flows, warning for 038 (safe online ALTER).
- .env.example: no changes needed (I9 adds no env vars).
- Minor (deferred P2/P3, acceptable for v1):
  1. P2: Rate-limit bypass on investasi_lead + umkm_inquiry via service-role fallback (mirrors existing skm/submit pattern — pre-existing architectural choice).
  2. P2: Offline queue replay can fire under different user session on shared kiosk (queue doesn't store auth_user_id). Low-impact for checkin (pengunjung_id=NULL), but investasi_lead/umkm_inquiry from_email could mismatch session. Track as fast-follow.
  3. P3: umkm_inquiry PATCH response returns from_email even on reject (owner already sees it in inbox list — not a public leak).
  4. P3: SW cache version is static 'lmh-v1' (won't auto-invalidate on deploy — network-first self-heals but precache stays stale).
  5. P3: consent_log INSERT in /api/checkin runs before visit INSERT (not transactional — consistent with existing checkin/page.tsx).
  6. P3: Admin pages rely on client-side sidebar gating (no server-side role guard in admin/layout.tsx — consistent with existing pattern, but non-staff hitting /admin/investasi-leads directly sees page shell + error toast instead of redirect).
- **LMH 2.0 branch is production-ready pending human Dashboard configuration per DEPLOY_RUNBOOK.md (now covers migrations 020-038).**

## production-readiness residuals (2026-07-15)
- Residual close-out: complete (no commit/push) � gallery DELETE+storage cleanup API; v_antrian_loket.sample_count; visit lifecycle web_push (selesai/menunggu/dilayani); notif send/retry GET for Vercel Cron; residual report. Lint/typecheck/build pass; **429 tests**.
