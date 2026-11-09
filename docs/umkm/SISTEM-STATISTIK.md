# UMKM statistics, ranking and recommendations

Review date: 6 November 2026. Design only. Owner decisions P-01..36 are summarized in [SISTEM.md](SISTEM.md). [PROPOSAL] marks implementation; [INITIAL, P-27] marks starting values reviewed after three months. Scale inputs are [ASSUMPTION], not measured capacity. P-36 selects a simple formula and direct transactions now, without parallel implementation trials.

## 1. What is counted

[FACT docs/umkm/KEPUTUSAN-PEMILIK.md] The owner requests Views/Likes, ranking and visitor/company recommendations. [FACT docs/umkm/KEPUTUSAN-PEMILIK.md] P-20 permits optional telemetry after privacy notice publication, without separate consent. [FACT docs/umkm/KEPUTUSAN-PEMILIK.md] P-36 keeps automatic tracking safeguards without extra staff steps.

| Metric | Definition/source [PROPOSAL] | Limitation |
|---|---|---|
| Views | Open an approved profile in an active tab; one per profile/daily identity/WIB day. Exclude staff, owner visits, bots and previews. | Not card impressions, reloads or proven people. |
| Likes | One active functional favorite per nonanonymous logged-in account/profile. Idempotent true/false, not toggle; exclude staff/self/test activity from public scores. | Not purchase intent; account farms remain possible. |
| Contact clicks | Explicit contact-form entry action, deduplicated profile/session/day, under the optional telemetry switch. | Not a submitted message or opened number. |
| Contact messages | Short LMH form rows actually committed. | Operational intake, not optional browsing telemetry; messages still work with telemetry off. |
| Requests | Number requests committed per Need/UMKM pair. Report unique Needs separately. | A retry is not another request. |
| Number opened | Manual Setujui commits a valid applicant access grant, decision and consent reference. | Not WhatsApp delivery or proof the company read the number. |
| Receiving companies | Distinct companies with an opened number for this profile in the reporting period. | Internal report only, never ranking/public badge; report service/consent bias. |
| Outcomes | `belum_diketahui/kerja_sama/tidak_berlanjut`, recorded by an officer when reported. Number opening starts `belum_diketahui` automatically. | Silence is unknown; reported cooperation is not verified payment or realized investment. |
| Zero-result searches | Valid successful search has no public result; increment its day/label/area group. | No raw query words, person identifier or uniqueness claim; DB failure is not missing supply. |

[PROPOSAL] The server derives UID for logged-in users; anonymous visitors receive a random first-party statistical cookie only after the notice gate opens. Store daily keyed hashes, not raw UID/cookie/IP, in browsing dedup rows. Same account across devices counts once/day; anonymous devices may count twice. This is pseudonymization, not anonymity. No fingerprints, precise location, platform SDKs or cross-session history recommendations.

[PROPOSAL] Social links create zero telemetry writes and no platform requests before click; no social-score input. Existing consent remains purpose-specific: [FACT supabase/migrations/202607140003_feature_schema.sql:162] `consent_log` stores subject/purpose/version/time, not permission for every new use.

## 2. Visibility and notice gate

| Reader | Visible [PROPOSAL] | Hidden |
|---|---|---|
| Public | All recorded Views and active Likes, including zero, with coverage dates; order/recommendation reasons | Viewer/liker identities, company lists, contact data and private histories. |
| Verified UMKM owner | Own counts/trends and company names/opening dates from own number grants (P-24) | Other profiles, buyer contacts, private Needs and visitor identities. |
| UMKM officer | Domain activity, form/queue work, requests/openings/outcomes and waits | Unrelated private data or raw person-by-person browsing history. |
| FO | Queue counts, process duration and redacted officer work traces for supervision/sample checks | Numbers in tables/views/RPC/exports/notifications, raw form contents and ordinary operational writes. P-32's no-number emergency action remains. |
| Admin | Scoped administration, aggregate reports and job/resource health | Analytics is not a raw contact directory. |

[FACT docs/umkm/KEPUTUSAN-PEMILIK.md] P-23 removes minimum public counts. [PROPOSAL] Show 0-999 exactly; larger counts may use compact round-down formatting with exact accessible text. No low-activity placeholder. With collection off, omit Views on public profiles; reports show unavailable/coverage dates rather than fabricated zero. Likes still show. New-UMKM slots protect discovery without hiding small numbers.

[FACT docs/KEBIJAKAN_PDP.md:31] Current policy prohibits automatic profiling. [PROPOSAL] Before enabling telemetry, publish updated `docs/KEBIJAKAN_PDP.md` and `/kebijakan-privasi`, describing purposes, identifiers, retention and rights. The notice must also explain the private contact form, account-only disclosure and officers' personal WhatsApp. DPO review is recommended, not an extra owner approval gate.

[PROPOSAL] One `telemetri_opsional_aktif` switch controls Views, zero-result searches and contact clicks. Until both policy publications and technical safeguards pass, keep it off: no optional event/counter/cookie/daily marker. No separate statistical-consent dialog or per-visitor consent rows. Record notice version/activation time. Likes use the requested functional purpose; contextual search, form messages and requests continue when telemetry is off. Contact permission stays separate in `consent_log`.

## 3. Simple shared ranking

[PROPOSAL; INITIAL, P-27] Phase A and B share one formula. Review weights/window/new-slot behavior after three months using real activity, not an up-front comparison project.

```text
FORMULA SKETCH, not code:
L90 = eligible active Likes first made within the last 90 WIB days.
V90 = recorded, daily-deduplicated Views within the last 90 WIB days.
Ranking Score = 5*L90 + V90.
Optional telemetry off/incomplete: score = L90 for all profiles.
```

[PROPOSAL] Calculate once daily at 02.00 WIB in the database for all published profiles, including those whose signals leave the window. No half-lives, percentiles, score bands or completeness checklist. Expired-window signals fall out automatically. Unlike/re-Like does not reset the original Like date while the record exists. No number-consent, NIB, company-receipt, social or paid-promotion points. Identical profiles differing only in those attributes have identical scores.

[PROPOSAL] Filter private/hidden profiles first; satudata needs manual review without a publication-consent gate. Type/Category/Specific/area choices are hard filters. Match priority is Specific, Category, then matching text; popularity never lifts unrelated results ahead of better matches. Without a query/Need, use shared popularity. FTS searches approved revision text, not private drafts. Indexed joins are the chosen initial implementation, not a catalog read-model comparison.

[PROPOSAL; INITIAL, P-27] On page one of `Paling sesuai`, reserve positions 5 and 15 among 20 for relevant profiles first published within 30 days. Use normal results if none qualify. Rotate eligible new profiles deterministically by WIB day; no fake likes/score floor. Store inserted IDs in the cursor so later pages do not repeat/skip them.

[PROPOSAL] Within relevance, order by score then a deterministic daily hash and profile ID. Cursors bind filters, order, score snapshot/day and last key; include new-slot IDs. Paginate the complete eligible set, not a global top-200. Recheck visibility on every read. Snapshot change requests a fresh search; it never serves a private fallback.

[PROPOSAL] The only initial order is `Paling sesuai`. If collection is unavailable, apply the shared Like fallback to every profile; during snapshot transition use explained safe order. Public historical totals and the 90-day score are separate. Extra sorting options stay Later.

| Rejected default | Reason |
|---|---|
| Lifetime popularity | Older profiles can dominate indefinitely. |
| Company receipts/number consent/NIB score | Service/privacy/licensing bias, contrary to P-15. |
| AI/vector/collaborative or behavior-history ranking | Unneeded data/compute and profiling; current context is enough. |
| Random order every reload | Unstable pagination and extra requests. |

## 4. Contextual recommendations

[PROPOSAL] Anonymous/new visitors use current query and selected labels/area. Logged-in visitors get the same public context; login does not silently activate history tracking. Companies select one readable Need; match its Category, preferring the same regency/city without combining unrelated Needs. Only explicitly chosen search filters are hard constraints. Without a selected Need, use current query or ask for selection. No tracking account is required for public recommendations.

[PROPOSAL] `umkm_cari_rekomendasi(q text?,filters,kebutuhan_id uuid?,cursor?)` checks applicant identity/Need ownership and returns ≤20 public profiles/reasons/cursor; the Need panel shows 10. Exclude already-requested profiles only in that panel, not regular search. `umkm_serupa(profil_id uuid)` returns ≤10 approved same-Category profiles, same regency/city first, excluding self. Reasons explain matching category/area/popularity/new profile without revealing another buyer's data. Private Need inputs/results are no-store, not shared cache.

[PROPOSAL] Vercel validates/forwards; DB joins/filter/order supply the result immediately. No per-search job/AI call. Failure offers the public catalog with an explanation, never another user's cached Need or service-role disclosure.

## 5. Direct writes and bounded jobs

P-36 chooses direct transactions. [PROPOSAL] No raw-event aggregation worker, comparison harness or separate health table. Use compact typed rows and existing cron run metadata; retain one coverage/notice checkpoint in statistics metadata.

| Store | Essential fields and retention [INITIAL, P-27] |
|---|---|
| `umkm_stat_kejadian` | Daily type/profile/hash dedup key and receive time; seven days. No free JSON/identity payload. |
| `umkm_stat_harian` | WIB day/profile, Views/contact-click/Like changes and coverage; 95 days for the 90-day window plus buffer. |
| `umkm_stat_total` | Profile, recorded lifetime Views/active Likes, start/update/coverage; one row/profile. Lifetime totals survive detail pruning. |
| `umkm_stat_suka` | Account/profile unique, active flag, first/last dates and eligibility. Functional favorites while active; account deletion removes linked personal state. |
| Zero-result daily/monthly aggregates | WIB period, Category/regency-city and zero-result counts; 95-day daily, 24-month monthly. No raw words or person IDs. |
| `umkm_skor` | Profile, L90/V90, score/mode/snapshot; current and previous snapshot for cursors. |

[PROPOSAL] The typed collector derives date/hash, verifies current publication and gate, and performs: unique dedup INSERT, daily counter UPSERT and historical total UPSERT in one transaction for a new View. Duplicates add nothing; retries reuse the same key. This costs three logical row writes per new View, plus indexes/WAL, deliberately avoiding a separate aggregation/closure protocol. A transaction crash commits all or none.

| Action | Logical writes [PROPOSAL] |
|---|---|
| New View | 3; repeated same-day View adds no counter but still incurs conflict-query cost. |
| Contact click | Dedup plus daily aggregate, up to 3 if a historical total is maintained. |
| Zero-result search | 1 safe group UPSERT, no identity event. |
| Like/unlike | State UPSERT plus active-total update atomically; unchanged retry changes no counter. |
| Successful search | 0 analytics writes; the shared security guard has its own bucket cost. |
| Request/Setujui/outcome | Use business records/history, not another client analytics event. |

[PROPOSAL] Public collector accepts only typed event/profile references and signed session evidence, never counter values or caller-supplied UID. Use a narrow server writer with no browser service key or public arbitrary-increment RPC. One shared quiet technical anti-spam guard covers public writes; unlike remains possible. Filter bots/internal traffic and obvious replay automatically. These reduce abuse, not all fake accounts or forged browsers. Do not introduce staff freeze/recovery workflows now.

| Job | Schedule [INITIAL, P-27] | Bounded behavior [PROPOSAL] |
|---|---|---|
| Ranking | 02.00 WIB daily | Build snapshot in chunks, activate atomically; current visibility always applies. |
| Monthly summaries and pruning | Daily, after summaries | Preserve lifetime totals and monthly groups before pruning expired detail. Bounded transactions, resume from progress; same-job lock prevents overlap. |
| Business PII/draft cleanup | Daily | Apply SISTEM retention; protect active review evidence. R2 deletion follows commit, never HTTP under a lock. |
| Health | After each job | Existing job metadata plus concise coverage/size checkpoint; mark stale coverage on failure. |

[PROPOSAL] No Vercel compute job, catalog Realtime or per-event notification. Batch browser beacons when convenient; batch transport saves requests, not row/index writes. Recorded activity may be incomplete if a tab closes; coverage labels must say so. Job failure keeps a dated prior score or explained safe order, never stale contact authorization.

## 6. Capacity and pressure

[ASSUMPTION] All row sizes, activity and cache hit rates below are planning inputs. Actual shared DB/egress/CPU quotas and headroom need verification before rollout. A free-tier instruction is not a capacity guarantee; do not reopen P-13's accepted Vercel decision.

| Example | Calculation and effect |
|---|---|
| Catalog ceiling | 10,000 profiles ×4 KB including catalog indexes ≈40 MB, outside statistics/photos/other LMH data. Test 1,000/5,000/10,000; no 100,000-profile release scenario. |
| Starting Views | 500/day ×7 days ×300 bytes ≈1.05 MB dedup. 1,000 active profiles/day ×95 days ×160 bytes ≈15.2 MB daily data. |
| Likes and scores | 10,000 Like rows ×240 bytes ≈2.4 MB. 10,000 profiles ×2 score versions ×200 bytes ≈4 MB. Initial examples total ≈22.7 MB before metadata/buckets/bloat. |
| Pressure | 10,000 Views/day gives ≈21 MB seven-day dedup; 10,000 active profiles/day ×95 ×160 bytes ≈152 MB daily data. This cannot fit the statistics envelope. |
| Writes | 500 Views/day costs 1,500 logical writes; 10,000/day costs 30,000, excluding clicks/Likes/security/indexes/WAL. |
| Egress/functions | 10,000 searches/day ×20 cards ×1 KB ×30 days ≈6 GB before overhead/photos. 500 unbatched beacons/day ≈15,000 route invocations/month; 10,000/day ≈300,000. Other LMH routes/Proxy also consume resources. |

[PROPOSAL; INITIAL, P-27] Statistics envelope: 50 MB only if shared headroom permits. MB allocation: dedup 12, aggregates/totals 20, Likes 8, two scores 4, notice/session metadata 2, security buckets 1, health 1, reserve 2. Measure physical heap+indexes. Warn at 70%; if pruning cannot recover at 85%, turn off the single optional switch before service disruption and activate Like fallback. Do not erase contact/decision/consent evidence for analytics capacity.

[PROPOSAL] If activity exceeds the envelope, collection pauses: omit public Views and mark reports unavailable/limited; catalog, Likes, requests and officer work continue. Measure Like growth separately. Do not claim the full Views requirement complete while collection is unavailable, or silently shorten the agreed window to make pressure numbers fit. Revisit capacity from actual use before expanding.

## 7. Privacy cleanup, reports and removed complexity

[PROPOSAL] Rights-request/account cleanup removes linkable retained raw rows without double subtraction; unlinkable historical aggregates cannot promise person-by-person reversal. Active Likes drop on unlike/account deletion. Hiding removes public statistics immediately. Cookie lookup can fail after cookie deletion; explain that limit without collecting a new speculative identity. No separate telemetry-consent store; number consent remains independent.

[PROPOSAL] A reports recorded Views/Likes, form/queue activity and context. B adds Needs/requests/number openings and reported outcomes; number opening is not cooperation. C adds own-profile trends and receiving company names/dates. Period/coverage/source labels apply throughout. Report receipt/first-reply/decision/opening waits from automatic timestamps; no review-time promise or forced follow-up forms. Daily identities are not guaranteed people; do not claim monthly unique visitors.

[INITIAL, P-27] At three months review weights/windows/new slots, retention, resource use, queue time and personal-phone handling. All owner questions are closed by P-19..36. Later: catalog visits, extra sorting options, history personalization, social-click analytics, detailed word lists, recipient-company canonicalization and manual Like-freeze workflows.

| Removed under P-36 | Consequence |
|---|---|
| Half-life/percentiles/completeness bands | Fixed windows are easier to explain but may change score abruptly at the boundary. |
| Implementation/formula comparisons | Optimization waits for a measured problem. |
| Per-feature numerical rate limits | No separate feature abuse ceilings; shared technical guard and automatic dedup remain. |
| Raw query word lists and manual freeze workflow | Less diagnostic detail and no dedicated Like-moderation screen. |
| Follow-up stages/reminders | Fewer tasks, but outcome reports depend on voluntary reports. |

## Revision notes

| Decisions/findings | Sections |
|---|---|
| P-19..28, X-07 | 1..3, 6..7: notice gate, all counts, recipients, closed questions, starting parameters |
| P-29..35 | 1..2, 7: account opening, FO supervision and staff personal-phone policy |
| P-36 | 3..7: simple 90-day score/direct writes, no comparison project or manual analytics workflow |
| C-04..15, X-04..05 | Relevant pagination, dedup, cost and safe-fallback protections retained; former complexity superseded |
