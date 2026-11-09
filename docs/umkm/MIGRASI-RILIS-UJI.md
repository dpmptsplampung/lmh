# UMKM migration, release and tests

Review date: 6 November 2026. A future implementation plan, not executed tests or deployment evidence. This documentation task changes no code, migration, deployment setting or database, and reads no environment files.

## 1. Scope and active decisions

[FACT docs/umkm/KEPUTUSAN-PEMILIK.md] P-36 supersedes team complexity and earlier expiry/access caps. [PROPOSAL] Implement only the 45 active requirements in [KEBUTUHAN.md](KEBUTUHAN.md), the small contract in [SISTEM.md](SISTEM.md) and simple direct statistics in [SISTEM-STATISTIK.md](SISTEM-STATISTIK.md). All owner questions P-19..36 are closed.

[FACT AGENTS.md:60] New migrations must have later timestamps and adjacent contract tests; never edit/rename existing ones. [PROPOSAL] Add new tables/grants first with public/private paths closed, then compatible readers and writers. Preserve legacy tables/routes/history; no schema reset, destructive rollback or implicit legacy consent transfer.

[ASSUMPTION] Installed schema, real traffic, current resource use, staging/R2 settings and clean-source columns remain unverified. Curation/import is a separate workstream; satudata photos are never copied. Local SQL/source is not evidence of production behavior.

## 2. Legacy compatibility

| Existing evidence [FACT] | Keep/change [PROPOSAL] |
|---|---|
| `supabase/migrations/202607140003_feature_schema.sql:57`: `listing_umkm`; line 80 ownership; line 95 inquiry | Keep listing/inbox/edit ownership and behavior. No automatic company/profile merge, consent inheritance or number access. |
| `supabase/migrations/202607140005_views_and_jobs.sql:4`: public view; line 33 match view | Keep projection/match contracts; use a separate new catalog, proposed `/umkm/katalog`. |
| `src/app/umkm/inbox/page.tsx:90`, `src/app/umkm/edit/[id]/page.tsx:123` and existing inquiry/magic-link APIs | Regression-test original routes/links; no replacement or redirect to unowned profiles. |
| `supabase/migrations/202607300024_wp31_umkm_verifikasi.sql:24`: verification history | Retain history; new publication still needs its own manual decision. |
| `supabase/migrations/202611030004_umkm_foto_https.sql:4`: old photo URLs | Retain old assets/URLs; new uploads use R2, source photos stay links. No legacy bulk cleanup. |

[PROPOSAL] No dual-write or automatic entity sync. Optional TikTok/Instagram fields belong only to new reviewed revisions. Legacy mapping and coworker invitations stay Later; they do not add release dependencies.

## 3. Small release packages

S/M/L denotes relative complexity, not time. [PROPOSAL] Default new feature switches off; code must tolerate additive old/new schema.

| Package | Phase/size | Completion |
|---|---|---|
| M-A1 | A / M | Private profiles/revisions and manual review, safe photos/social links, automatic history, four profile states, handler labels and one-click takeover; legacy works. |
| M-A2 | A / M | DB search/20 per page/cache, short LMH contact form and private officer queue, FO counts/redacted supervision and limited no-number emergency actions. No company/visitor number access. |
| M-A3 | A / M | Likes, contextual recommendations, 90-day simple score/new slots, direct statistics and cleanup. Optional telemetry remains off until both privacy publications and technical gates pass. |
| M-B | B / L | Short company/Need data; five request states, one Setujui decision+opening, current consent, account-only number reads/revocation, personal-WhatsApp notification without the number; outcome record and receiving-company names. |
| M-C | C / M | Verified owner registration/claim/private edits, own trends/recipients and consent withdrawal, using the same officer screen/list. |

[PROPOSAL] A overall remains L for content/privacy/photos/legacy work; it provides links and form replies only. B remains L because number authorization is sensitive, despite fewer screens. C reuses the review flow. No phase requires reaching 10,000 profiles; publish a reviewed sample and grow gradually. No timed lease, expiry worker, separate sender queue, manual notification-confirmation step or architecture-comparison package.

### Capacity illustration, not a service promise

[ASSUMPTION] Profile review takes five minutes: 10,000 ×5/60 =833.33 hours. One contact case takes 15 minutes total: request/company review five, permission five, account opening/notification three, replies two. All inputs are unmeasured; the shared 1-2 days/week estimate remains unchanged by P-29..36.

[ASSUMPTION] With 8-16 effective hours/week and R cases/week, remaining profile hours/week = (8..16) - R×15/60; profile backlog weeks =833.33 / remaining hours. Do not multiply shared hours by account count.

| Cases/week | Case hours/week | Hours left for profiles/week | Illustrative weeks for 10,000 profiles |
|---|---|---|---|
| 0 | 0 | 8-16 | 52.08-104.17 |
| 10 | 2.5 | 5.5-13.5 | 61.73-151.52 |
| 30 | 7.5 | 0.5-8.5 | 98.04-1,666.67 |

[PROPOSAL] These exclude form replies outside cases, leave, corrections and interruptions. If remaining hours ≤0, profile growth stalls. Officers now also seek consent and answer personal WhatsApp; capacity risk increases. Use automatic work timestamps and a short operational observation to measure real minutes/case and shared hours. No volume, reply time or review day is promised. Unlimited legitimate requests may grow faster than the queue can clear.

## 4. Release gates

1. [PROPOSAL] Read applicable guides/status/diff and map active requirements to files. Build new forward migrations/static contracts and synthetic local/container fixtures without production data or environment files.
2. [PROPOSAL] Before public A: verify approved-only projections, text/photo contact checks, private R2 drafts, legacy, form privacy, shared technical anti-spam and FO isolation. Publish PDP/privacy text for the new form/personal-phone handling. Keep all number grants closed in A.
3. [PROPOSAL] Before optional telemetry: both `docs/KEBIJAKAN_PDP.md` and `/kebijakan-privasi` must be updated/published. DPO review is recommended. Prove dedup/atomic writes/cleanup/headroom; otherwise catalog/Likes/fallback can open without claiming Views completion.
4. [PROPOSAL] Before B: supervised synthetic Setujui checks decision/current consent/opening in one transaction, original applicant login and immediate withdrawal. Accountless assistance requires the private one-use login-link code first. Notification template has code/login link, no UMKM number. No separate approval/opening workflow.
5. [PROPOSAL] Before C: outside-account claims, draft photos, revisions and owner-only recipient names/statistics pass.
6. [PROPOSAL] Authorized staging must pass before future production deployment. Operators display destination host without password and forward migrations, staging evidence and rollback; use required release authorization. This worker performs none of those actions.
7. [PROPOSAL] Open gradually and inspect queue time, errors/RLS/cache and physical DB/egress/functions/R2 use. Relevant narrow tests plus integration-owner lint/typecheck/test/build gates accompany future code changes; no full build required for this document task.

[FACT AGENTS.md:58] Worker tests are narrow. Future command: `npx vitest run --pool=vmForks <existing-test-file>`. Never run production-linked migration/RLS/WP scripts as a documentation check.

## 5. Focused acceptance tests

[PROPOSAL] These are planned scenarios, not passing evidence. Static SQL contracts check grants/RLS/transactions/immutable migrations. Local/container and authorized staging behavioral tests call direct REST/RPC, not only mocked pages.

| Test | Active requirements | Acceptance |
|---|---|---|
| U-01 Public/private and content | K-A-01,04,06,07,08,10,25; K-C-01; K-NF-04 | Draft/rejected/hidden profiles and contacts never appear through pages, HTML/API, direct DB, recommendations or cache. Hidden detail fails immediately; cards leave within safe TTL. Synthetic number in text/URL blocks publication; manually inspect a business-card photo. Satudata needs review, no publication consent. Optional NIB never blocks. Report profile/photo with one reason and optional note; fraud reports enter the urgent work group. A company/visitor/FO path never opens a number. |
| U-02 Photos/social/revisions | K-A-11,23; K-C-04 | Approved optional links only; absent means no empty UI. Reject unsafe schemes/credentials/local hosts, preserve unrestricted safe HTTPS photo sites. New uploads use private R2 draft/type-size validation; no public draft URL, satudata copy or Supabase fallback. Old snapshot stays until revision approval. |
| U-03 One-screen review/concurrency | K-A-08,16; K-B-08; K-NF-05 | Four profile/five request states; no expiry/timed lease. One-click handler takeover logs actor; expected version and short row lock allow one concurrent decision. Setujui and refusal fit one screen/≤2 clicks, only short refusal reason. First company review shares the request screen. Replacing an officer updates decision actor; no silent sender impersonation. |
| U-04 Setujui/permission/retry | K-A-14,25; K-B-08; K-NF-04,05 | No current consent → `menunggu_izin`, never opened automatically later. Valid consent + manual Setujui → one decision/access/audit transaction, same officer, no number in its response. Withdrawal/contact change/hidden profile/emergency hold blocks opening. Crash/retry does not duplicate grant or outcome; stale conflicting version fails. |
| U-05 Account-only number access | K-B-02,03,04,05,12,17; K-C-06; K-NF-04 | Nonanonymous original applicant only, including same-company coworkers and guessed IDs. Unlinked assisted request cannot open; login plus private random one-use code links once. Replay/wrong code/another UID fails. Cancel before opening only. Repeated pair returns existing request; after revocation a new request needs manual decision. Every read rechecks consent/version; revocation hides immediately and new consent does not revive old grants. Never return a replacement number. |
| U-06 FO/admin and emergency | K-A-26,27; K-NF-04,05 | FO gets no number through base tables, views, RPC, exports, notifications, contact form or stale reviewer flags. No ordinary approve/consent-grant/open/write access. Admin number work needs officer assignment. Emergency only hides/holds/revokes without a number, with audit and next-officer review. Officer clears `tahan_darurat` one click; it is not another request state. |
| U-07 Form/personal phone/template | K-A-05; K-B-20,23; K-NF-05,10,11 | A form contains name/company/contact/message, private queue `baru/ditangani`; FO count only. Shared quiet technical guard handles bursts. No full staff number in public pages/cache/export. WhatsApp requester template has request code, login link and warning, no UMKM-number field/text/URL. One action records the notification attempt automatically; no manual send-confirmation step or claim of delivery. Account shows officer name/last four digits only. |
| U-08 Privacy and analytics atomicity | K-SA-01,06,08; K-NF-10,11 | One switch stays off before both policy publications: zero optional rows/counters/cookies. Form/Likes/catalog still work. When on, same account/tabs/day dedup correctly at WIB rollover; anonymous devices are not claimed unique people. Likes true/false retries are idempotent; staff/self/anonymous excluded. Dedup/daily/lifetime writes commit together; totals survive pruning. |
| U-09 Score/cursor/context | K-A-02; K-SA-02,03,04; K-NF-01 | `5*L90+V90`, fallback L90, no decay/percentiles. Match before score, deterministic daily tie shuffle, new slots at 5/15 only on page one. Current query/authorized Need/category and nearby preference, no history tracking; related ≤10, Need panel 10. Fixed snapshot traverses all 10,000 via 20/page without missing/duplicate IDs. Hidden profiles vanish regardless of score; expired-window signals leave the daily score. |
| U-10 Counts/recipients/outcomes/export | K-B-13; K-C-08; K-SA-05,07 | Public recorded 0/1/small counts visible, no minimum; with switch off Views absent publicly and report coverage says not recorded. Owner sees own trend and receiving company names/dates only; another owner/private buyer contact refused. Number opened creates unknown outcome, never cooperation. Export contains no numbers/form/query PII or spreadsheet formula execution. |
| U-11 Ownership and legacy | K-A-19; K-C-03; K-NF-04 | Login, old email and phone control alone do not grant profile ownership. Reviewed claim scope only. Legacy routes/inbox/edit/API/photo behavior remains; legacy inquiry never grants new consent/access. |
| U-12 Load/retention/safety floor | K-B-03; K-NF-01,13 | 1,000/5,000/10,000 synthetic approved profiles, broad/deep/selective search and one legitimate account with many selections/active requests. No business cap; technical chunks report completed work and resume idempotently. Query limits/indexes and safe cache keep requests bounded. Measure actual latency/DB locks/bytes/function use; exceed headroom → telemetry off, core/private safeguards intact. Automated retention prunes only eligible detail/evidence, protects review drafts and preserves coverage/totals. |

[PROPOSAL] Access fixtures include no session, anonymous Auth, company accounts A/B in same/different companies, owners X/Y, unassigned/disabled officers, two reviewers, FO and admin with/without reviewer flag. Call mutation functions directly with forged roles/UIDs/versions and deleted accounts. A menu test cannot prove RLS.

[PROPOSAL; INITIAL, P-27] Start performance checks with DB p95 ≤300 ms, request p95 ≤1 second and bounded query timeout, measured on staging. These are engineering checks, not user response deadlines. If simple indexed joins or direct counters fail at real scale, change the measured bottleneck then; no up-front comparative trial.

## 6. Rollback and residual risks

[PROPOSAL] Close new writers/feature switches first, preserve additive schema and saved work. Legacy stays available. Corrections are forward migrations, never DROP/reset or restoring an older DB over new transactions.

| Failure/risk | Response and limit |
|---|---|
| Uncertain access/consent or incident | Close new number opening/affected reads, retain references and fix forward. No service-role fallback, public export or claim that received copies were erased. |
| Wrong statistics/pressure | Stop optional collection, mark coverage and use Like/safe order. Do not fabricate history or delete contact evidence. |
| R2/source failure | Retain safe old snapshot/placeholder and retry publication; no draft disclosure, satudata copying or Supabase upload. |
| Personal phone retains data [FACT about design] | Contacts used for consent and applicant numbers remain in phone history; LMH cannot erase them. Mention this in privacy text. |
| Chat outside audit [FACT about design] | LMH proves its decisions/access attempts, not chat content, delivery or a person manually typing a number. |
| Staff turnover | Revoke reviewer access and transfer LMH cases. [PROPOSAL] Request deletion of work chats/contacts; external deletion is not provable. |
| Impersonation | [PROPOSAL] Applicant account shows assigned officer name/last four digits; check code inside LMH. A personal number itself does not prove an institutional identity. |
| One person decides/opens | Consent checks/audit/FO sample supervision reduce risk but are not equal to two-person review; malicious decisions may be found only afterward. |
| No business quotas, all counts public | Backlog and slow coordinated Like abuse can grow; shared burst limiting and new-profile slots do not guarantee capacity/fairness. Review actual queue/activity after three months. |

[INITIAL, P-27] Retention follows SISTEM: form 180 days after handling/last activity, case/access/consent evidence 730 days after closure/withdrawal, statistics raw seven days/daily 95 days/monthly 24 months. Remaining work weights/windows and resource/retention values are reviewed after three months. Officer hours, phone practices and public small counts are part of that review, not open owner questions.

## 7. Removed work and documentation evidence

| Removed by P-36 | Consequence |
|---|---|
| Separate sender, expiry worker and extra hold state | No second manual checkpoint or automatic ageing prompt; current consent checks/one atomic action remain. |
| Lease timer/daily contact cap/per-feature quotas | No automatic release or daily misuse ceiling; one-click takeover, audit and shared technical rate guard remain. |
| Clipboard and raw-query word list | Less copy/diagnostic convenience; smaller exposure and fewer flows. |
| Comparative architectures/formula harness | Use indexed joins/direct writes/simple score now; optimization awaits measured failure. |
| Detailed outcome stages/reminders | No forced reporting burden; reports have more unknown outcomes. |

[FACT] This task runs document checks only: active-ID coverage, states/terminology, local links/source references, actual text diff, prohibited-rule scan and secret indicators. No product test/lint/typecheck/build or SQL behavior is claimed passed. Report before/after byte counts for the three owned files and the whole seven-document package.

## Revision notes

| Decisions/findings | Sections |
|---|---|
| P-19..28 | 1, 4..6: publication/notice/revocation/counts/recipients, no business quotas, closed questions |
| P-29..35 | 3..6: workload, FO isolation/emergencies, personal-phone/form/account-only flow and risks |
| P-36 | 1, 3..7: small packages/12 test groups/five and four states, removed limits/comparison work |
| C-01..20, X-01..08 | Security/legacy/cost concerns retained only where consistent with the simplified owner contract |
