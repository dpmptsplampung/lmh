# SDD ledger — plan: docs/superpowers/plans/2026-10-26-survei-terpadu-fase-a.md
Spec: docs/superpowers/specs/2026-10-26-survei-terpadu-design.md (binding authority).
Worktree: D:/Project/LMH/.claude/worktrees/survei-terpadu-a, branch feat/survei-terpadu-a, start commit 8abfef78eaab50930f96c78d253a2bfe5a6e493b (= docs/spec-survei-terpadu).
Workspace: D:/Project/LMH/.claude/worktrees/survei-terpadu-a/.superpowers/sdd/2026-10-26-survei-terpadu-fase-a
Models: implementers sonnet; reviewers opus for DB tasks 2-5 and sonnet for others; final review fable.

## Pre-flight scan (pairs sharing a file or interface; each task self-consistency)
| Pair/Task | Produces vs consumes / shared file | Finding |
|---|---|---|
| T2-T3 | T3 consumes survei_undangan(dibuat_pada,diisi_pada,unit) for ringkasan_response_rate; unit CHECK sets agree (undangan layanan|fo; jawaban +tidak_diketahui) | ok |
| T2-T5 | T5 consumes ensure_undangan(uuid)->uuid; idempotent so trigger order is irrelevant | ok |
| T3-T4 | T4 inserts skm_respons(sumber,versi,unit,kunjungan_id) and spak_respons; needs T3 columns/CHECK (sumber=wizard => kunjungan_id not null and versi=2) | ok |
| T2..T5 shared files | migration-test-utils.ts, MANIFEST.json, DB-CHANGES.md, MIGRATIONS.md appended sequentially, one commit each | ok (sequential) |
| T3-T6 | T3 Step 2 would add an it.todo (assertion-free) completed in T6 Step 3; T6 Files omits survei_jawaban.test.ts although Step 3 edits it | conflict -> R2, R3 |
| T3 self | CREATE OR REPLACE VIEW v_skm_petugas: new columns must be appended AFTER created_at (Postgres rule); plan says "kolom lama + u10,u11" without order | conflict -> R1 |
| T1 self | stub skm_respons "persis baseline" has FK to visit, kunjungan has FK to pengunjung; stub lists no such tables | conflict -> R4 |
| T6-T7 | T7 consumes LANGKAH/Jawaban/Kunci*/RENTANG exactly as T6 produces | ok |
| T6-T8 | kirimSurveiSchema built from RENTANG/keys | ok |
| T7-T9 | jawab(state,kunci,nilai,{otomatis}) -> {state,hasil}; maju/mundur; simpanDraf/muatDraf/hapusDraf; bangunPayload | ok |
| T8-T9 | POST /api/survei/kirim body {token,spak,skm}; 201/400/404/409/410 | ok |
| T4-T9 | RPC jsonb keys layanan_nama,kedaluwarsa_pada mapped to layananNama,kedaluwarsaPada in ambilKonteks | ok |
| T2-T10 | ambil_qr_survei jsonb keys and v_survei_status columns match ambilQrSurvei/ambilStatusSurvei; page files antrian/kunjungan tests exist | ok |
| T3-T11-T12 | ringkasan_ikm/ringkasan_spak/ringkasan_response_rate consumed by export (T11) and admin SKM (T12); T11 route is T12 download href | ok |
| T10 self | HasilSelesaiFo.kunjungan_id exists (src/lib/fo-penanganan.ts); antrian rows carry kunjungan_id; three completion paths exist (rpc layanan_selesai, PelayananWizardModal, SelesaiEskalasiModal) | ok |
| T5 self | notify_kunjungan_status defined only in 202610140007 (lines ~1310-1376) | ok |
| T3 self | skm_respons has only AFTER INSERT trigger (trg_skm_insert_rr); backfill UPDATE of unit is trigger-free | ok |
| T13 | docs only; no conflict | ok |

## Rulings
Ruling: R1 T3 v_skm_petugas new columns u10_transparansi,u11_integritas are appended after created_at (CREATE OR REPLACE VIEW only allows appending) — spec wants the columns added, order unconstrained — if wrong: nothing, dry-run would reject otherwise.
Ruling: R2 T3 Step 2 writes NO it.todo; the migration-vs-pertanyaan.ts CHECK-range cross-check is added in full in T6 Step 3 — avoids an assertion-free test the review rubric treats as a defect — if wrong: range cross-check lands one task later.
Ruling: R3 T6 also modifies supabase/migrations/survei_jawaban.test.ts (plan Step 3 requires it though Files omits it) — if wrong: none.
Ruling: R4 T1 stub may include minimal visit(id) and pengunjung(id) tables so baseline FKs resolve; stub stays local to scripts/lokal — if wrong: none.
Ruling: R5 scripts/lokal assumes @electric-sql/pglite installed via 'npm i --no-save' inside the worktree; never added to package.json/package-lock.json — if wrong: implementer must reinstall after any npm ci.
Ruling: R6 implementation branch feat/survei-terpadu-a is based on docs/spec-survei-terpadu (spec and plan commits included) instead of origin/main so subagents can read them — if wrong: a later PR carries 3 docs commits (harmless).
Ruling: R7 migration numbers 202610270001..0004 as in plan; the audit branch's 202610260001 is not on this branch, ordering stays valid when both merge — if wrong: renumber at merge.

## Tasks
Task 1: dispatched (implementer agent a151f3c853ce1e788, sonnet; BASE 8abfef7)
Task 1: implementer reported DONE_WITH_CONCERNS; commit amended 978e55d -> 4ee6078 after my first review dispatch (stale diff); first reviewer stopped, re-dispatching on 8abfef7..4ee6078
Task 1: review (reviewer a30164fc88be5a271, 8abfef7..4ee6078): spec OK; 1 Important (smoke check 'selesai_at dipertahankan' toothless: String(Date) 1s resolution) -> fix round 1
Task 1: minor (deferred): smoke 'uid tidak bocor' cannot detect missing finally cleanup; stub tiket_antrean.status CHECK omits 'dikembalikan','dialihkan' (0003:645); sebagai() finally RESET ROLE may mask result + not concurrency-safe (add README line); cek exit hook edge cases (no cek() => silent exit 0); README wording BYPASSRLS only service_role
Task 1: fix round 1/5 (1 addressed, 0 open; commits 4ee6078..c5fdf78)
Task 1: complete (commits 8abfef7..c5fdf78, review clean after 1 fix round)
Task 2: dispatched (implementer a3a811e353ce80b90, sonnet; BASE c5fdf78). Waiting for completion notification before reviewing (lesson: implementer may amend; wait for notification, not report file).
Task 2: implementer interrupted by session rate limit (resets 22:40); resumed 22:54 via SendMessage (only scenario file existed)
Ruling: R8 expiry comparator is 'now() >= kedaluwarsa_pada' = expired everywhere (T2 ambil_qr_survei uses it; T4 get_survei_context and kirim_survei MUST match); Review Focus 2 says exactly-at-boundary is rejected, the plan's '>' in T4 is superseded — if wrong: off-by-one at the exact boundary instant.
Task 2: implementer DONE_WITH_CONCERNS commit a902a43 (extra: token CHECK, security_barrier on v_survei_status, PRASYARAT block); review dispatched
Task 2: review (opus ada73c9a9bea1e7e4, c5fdf78..a902a43): spec OK; 1 Important (rollback header falsely promises dependency safety net; plpgsql has no deps so rollback before 0004's would silently break every kunjungan completion) -> fix round 1
Ruling: R9 spec-gap warnings from the T2 review accepted without change: (a) end-of-day auto-close (0008) and online chat close (0009) also set kunjungan 'selesai' and will create undangan; this matches existing behavior (SKM email/push and response-rate 'dilayani' already fire on every 'selesai'), unit 'fo' for online visits is right (no tiket, FO handles chat), so no change — if wrong: response-rate denominator includes auto-closed visits (same as today's skm_response_rate).
Ruling: R10 petugas may call ambil_qr_survei for a kunjungan with any tiket of their layanan (incl. cancelled) because boleh_kunjungan already defines petugas visibility so; token exposure limited to staff who handled the visit — if wrong: a petugas with only a cancelled tiket could show a QR for a visit rated under another unit.
Task 2: minor (deferred): status CASE duplicated in function and view (consider helper status_undangan(diisi_pada,kedaluwarsa_pada) when T4 adds third copy); static test hard-codes 3 function names (assert SECURITY DEFINER count == CREATE FUNCTION count); survei_undangan.test.ts:42,52 assert on literal BERKAS; later CREATE OR REPLACE VIEW v_survei_status must restate WITH (security_barrier=true) (T3 touches v_skm_petugas only; keep in mind)
Deferred-to-owner note: online (chat) visits get the survey link only via notify email/push (T5); the chat closing message has a placeholder for the link (0009 'K13/Tahap E') that Fase A does not fill.
Task 2: fix round 1/5 implemented (commit a78b333); scoped re-review dispatched
Task 2: re-review clean (reviewer ad1732c9c0d0edb30): finding addressed
Task 2: fix round 1/5 (1 addressed, 0 open; commits a902a43..a78b333)
Task 2: minor (deferred): rollback guard excludes the three dropped functions by name only, not exact signature (theoretical overload gap)
Task 2: complete (commits c5fdf78..a78b333, review clean after 1 fix round)
Task 3: dispatched (implementer a1221daf27c66b0b8, sonnet; BASE a78b333)
Task 3: implementer interrupted by session rate limit (reset 03:40); resumed 03:42 via SendMessage (tree clean). Parent session (GitHub main sync) asked to continue unattended: ruling: continue on feat/survei-terpadu-a worktree (not claude/busy-poitras-cb912c), same prohibitions; product decisions default to the safest option consistent with the spec, recorded as rulings.
Task 3: implementer DONE_WITH_CONCERNS commit 1318013; concerns: hitung_ikm uses /(9.0+...) (fine); ringkasan_ikm visible to petugas incl. FO/unclassified aggregates; deleting kunjungan with wizard SKM answer refused (23514) due to ON DELETE SET NULL vs wizard CHECK; 3-line edit to T2 survei_undangan.test.ts (last-entry assertion); legacy submit_skm_response rows get unit 'tidak_diketahui' with layanan_id set; scenario locks session to UTC. Review dispatched.
Ruling: R11 ringkasan_ikm stays readable by admin/front_office/petugas (aggregate IKM is already public via hitung_ikm on /transparansi), as the brief states — if wrong: petugas sees FO/unclassified aggregate rows (no identities).
Ruling: R12 accept fail-closed refusal of deleting a kunjungan that has a wizard SKM answer (nothing deletes kunjungan today); owner must revisit if a kunjungan retention/delete job is added — if wrong: such a job fails loudly instead of orphaning data.
Task 3: review (opus a4b874f2f764dc49c, a78b333..1318013): Spec OK, no Critical/Important, Approved
Task 3: minor (deferred): ringkasan_ikm visible to petugas incl FO/unclassified aggregates (spec 7.4 says petugas only own layanan; R11 accepted); hitung_ikm uses created_at::date (session TZ) while ringkasan_* use WIB dates (day-boundary mismatch 00:00-07:00 WIB; follow-up); ringkasan_* return EMPTY under service_role (peran_saya NULL) => export route MUST call them with the user's session client (carry into Task 11/12 briefs); rollback guard excludes by proname only; survei_undangan.test.ts:410 last-entry guard bypassable by other header formats; ringkasan period filters cannot use indexes (range rewrite later)
Task 3: complete (commits a78b333..1318013, review clean)
Task 4: dispatched (implementer a621a6e545ecaac93, sonnet; BASE 1318013)
Task 4: implementer DONE_WITH_CONCERNS commit 7f4255d (196 scenario checks, 36 static tests); concerns: two-connection lock wait untestable in PGlite (guarded by static order + sequential + unique-index TOCTOU sim); duplicate returned (diisi_pada not set) when kunjungan already has legacy answers; integer-valued 3.0/1e0 accepted; functions VOLATILE; no anon rate limit in Fase A; context has only 4 keys (no bisa_saran/bisa_pengaduan, Fase B). Review dispatched (opus).
Task 4: reviewer (opus a478818c6bb4f72a7) interrupted by session rate limit (reset 08:40 Jakarta); resume via SendMessage after reset
Ruling: R13 owner named the whole feature (survei + saran + pengaduan) "PESAN PERILAKU": user-facing copy uses "Pesan Perilaku" as the umbrella name (wizard page title/header, staff QR dialog title, staff status column/badge label, docs headings); SPAK/SKM sub-survey titles stay as in the spec; technical names (survei_* tables/functions, /survei/<token> route, api/survei/*) stay unchanged — if wrong: only copy/labels need a rename later, no schema/route churn.
Ruling: R14 owner asked for token economy (weekly limit nearly exhausted): short dispatch prompts that point to files (common.md, reviewer-rubric.md), sonnet for TS reviewers, opus only for remaining DB review (T4/T5), no extra rounds beyond what the loop requires.
Task 4: reviewer resumed 08:53
Ruling: R15 owner (via parent session GitHub main sync, same unattended run) asked to cut per-task review/verification: per-task reviewers and fix loops are SKIPPED for Tasks 5-13; implementers still run their own task tests/lint/typecheck and commit one commit per task; ONE broad review + ONE full gate at the end; Task 4's already-running review is allowed to finish; tasks are dispatched in batches (A: T5; B: T6-T8; C: T9-T10; D: T11-T13) to cut cold-start cost — if wrong: defects surface only at the final review (one fix wave) instead of per task.
Task 4: review (opus a478818c6bb4f72a7, 1318013..7f4255d): Spec OK, no Critical/Important, Approved; probe confirmed no raise/partial write
Task 4: minor (deferred): context says 'ok' for 32h when the visit already has a legacy SKM answer (kirim_survei returns duplicate, diisi_pada stays NULL) => owner decision/ retire legacy /skm after cutover; unique_violation handler broad (map only the two constraints); kunjungan status read unlocked (FOR SHARE would close); PRASYARAT guard samples columns; anon can call kirim_survei directly => Fase B must move EXECUTE to service_role when adding IP rate limiting; optional ^[0-9a-f]{64}$ token pre-check
Task 4: complete (commits 1318013..7f4255d, review clean)
Task 5: dispatched (implementer abeaf4937fcaecf72, sonnet; BASE 7f4255d); no per-task review (R15)
Task 5: implementer DONE commit d52cc72 (910 migration tests pass, 27 new); concerns: edited T4 survei_rpc.test.ts last-entry test; notification subject/body still say "SKM" (only the link changed; "Pesan Perilaku" naming R13 not applied in email/push -> owner follow-up: update text before first apply or in a later migration); function not runnable in PGlite stub (scratchpad one-off 30 checks, documented honestly); rollback guard recognises two text markers only. No review (R15).
Task 5: complete (commits 7f4255d..d52cc72, no per-task review per R15)
Batch B (Tasks 6-8): dispatched (implementer ad47218b424338eb6, sonnet; BASE d52cc72); no per-task review (R15)
Batch B: implementer DONE_WITH_CONCERNS commits ab76ba4 (T6), a9102a1 (T7), 5fcdb8f (T8); full npm test 240 files/3115 tests pass, build not run; concerns: zod .strict() ignores own __proto__ (route forwards cleaned object; test documents 201); muatDraf shape/range only (T9 must treat null bangunPayload as not ready); jawab also rejects key outside active step; cross-check test broader than brief. No review (R15).
Task 6,7,8: complete (commits d52cc72..5fcdb8f, no per-task review per R15)
Task 9: dispatched (implementer a813219eeca499de4, sonnet; BASE 5fcdb8f); no per-task review (R15)
Task 9: implementer DONE_WITH_CONCERNS commit 19134d7 (focused 116 tests; full npm test 244 files/3158 pass; build not run); concerns: clicks with detail>=2 ignored (double-tap guard); phone Back = step Back via one history entry per step (jsdom-tested only); added page.test.tsx; no fetch timeout (hung request leaves spinner); after final screen phone Back walks leftover history; Selesai goes to '/'; no visual/320px check (needs DB). No review (R15).
Task 9: complete (commit 19134d7)
Task 10: dispatched (implementer ac97b4cf0dd4a12fb, sonnet; BASE 19134d7); no per-task review (R15)
Task 10: implementer DONE_WITH_CONCERNS commit b490257 (full npm test 246 files/3202 pass; build/dev not run); concerns: antrian ticket query lacked kunjungan_id -> added to select/row type; SelesaiEskalasiModal.onSuccess also fires on stale-view errors (dialog may open for an already complete visit, closes silently without token; modal unchanged); edited penanganan.test.tsx (RPC log assertion). No review (R15).
Task 10: complete (commit b490257)
Batch D (Tasks 11-13): dispatched (implementer a8728de0991eaa8da, sonnet; BASE b490257); no per-task review (R15); final review next
