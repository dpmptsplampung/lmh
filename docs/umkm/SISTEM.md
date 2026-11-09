# UMKM system specification

Review date: 6 November 2026. Planning only, not implementation or production evidence. [FACT] cites local sources or owner decisions; [PROPOSAL] marks design. [INITIAL, P-27] means a starting parameter reviewed after three months. [ASSUMPTION] marks unmeasured inputs. Database names below are prospective.

## 1. Current owner contract

[FACT docs/umkm/KEPUTUSAN-PEMILIK.md] Decisions P-01..36 are authoritative; P-29..36 supersede earlier staff/channel rules and team parameters. The active contract is grouped here rather than repeated in every document.

| Decisions | Current behavior |
|---|---|
| P-01,03,05,19 | Profiles stay private until manual review. Satudata publication needs no separate owner consent. NIB is optional. |
| P-02,08,17,18,34 | A: catalog, short contact form, officer tools and FO supervision, no number sharing. B: companies, several Needs and number requests. C: verified owner registration/editing, reviewed before publication. Catalog grows gradually, at most 10,000 profiles. |
| P-04,10,21,29,30,35,36 | The reviewing officer presses **Setujui** once: the system checks current UMKM consent and opens the number only in the logged-in applicant's account. No number in WhatsApp; the officer sends a notification from personal WhatsApp. Withdrawal ends account access immediately. |
| P-06,07,25,26,36 | Estimated shared officer time remains 1-2 working days/week, unmeasured. Review anytime, urgent then oldest complete first; no promised response time, fixed review day or business quota on selected UMKM/active requests. |
| P-09,11,12,13 | Legacy remains. Database search/authorization/audit, 20 results/page, contact-free catalog cache. External HTTPS photos remain unrestricted by site; satudata photos stay links; new uploads use R2, not Supabase Storage. The Vercel-plan decision is closed. |
| P-14 | Optional reviewed TikTok/Instagram links display when present; no empty element when absent. |
| P-15,20,23,24,28 | Notice-based optional telemetry after both privacy publications; all recorded Views/Likes visible, no minimum. No public company-interest badge or ranking component. Verified owners see receiving company names/dates only. |
| P-16,22,27,36 | No special contact path for FO, approval expiry, timed review lease, daily contact-access cap or temporary number clipboard. Remaining initial parameters are reviewed after three months. |
| P-31,32 | FO supervises counts, durations and redacted work traces. When no UMKM officer is on duty, admin/FO may temporarily hide a profile, apply an emergency hold or record revocation, without numbers; next officer reviews. |
| P-33..36 | Officer personal numbers stay off public pages/cache/exports. Public contact and empty-search help open the LMH form. Companies need individual accounts before any number opens. One review screen, at most two clicks per decision; one short rejection reason. |

No owner questions remain. Operational detail stays in this file, statistics in [SISTEM-STATISTIK.md](SISTEM-STATISTIK.md), tests and rollout in [MIGRASI-RILIS-UJI.md](MIGRASI-RILIS-UJI.md).

## 2. Local source facts and reuse

| Local evidence [FACT] | Treatment [PROPOSAL] |
|---|---|
| `supabase/migrations/202607140003_feature_schema.sql:57` combines demand/supply/contact in `listing_umkm`; line 80 has email-based ownership; line 95 has legacy inquiry states. | Preserve legacy contracts. Neither email ownership nor an approved inquiry grants new account ownership or number consent. |
| `supabase/migrations/202607140004_security_and_automation.sql:331` projects public UMKM without contact columns. | New approved projections must also inspect text/media for numbers. Column filtering alone is insufficient. |
| `supabase/migrations/202607140005_views_and_jobs.sql:33` matches categories; `src/app/umkm/page.tsx:134` has no explicit page limit and line 204 filters in the client. | New catalog filters/paginates in the database. This does not establish how many rows production returns. |
| `src/app/admin/umkm/page.tsx:143` changes status directly; consent insertion at line 353 is separate. | New decisions, access grants and audit commit atomically. |
| `src/lib/admin-nav.ts:125` limits the old UMKM admin menu to admin; `supabase/migrations/202607140002_core_schema.sql:18` has one staff Layanan. | Add officer operations and FO supervision; use a separate audited reviewer assignment, not a new primary role or changed Layanan. |
| `src/lib/profil-pengunjung.ts:19` holds visitor identity fields; `src/app/login/page.tsx:54` uses Google login. `docs/KEBIJAKAN_AKUN_MITRA.md:7` specifies individual accounts. | Reuse Auth/visitor identity, not shared company accounts. Membership/name matching does not expose another applicant's numbers. |
| `supabase/migrations/202607140004_security_and_automation.sql:67` defines `check_anon_rate`. | Use one shared technical rate guard for public writes, not a list of business quotas. |

[ASSUMPTION] Clean source IDs, labels, photo links and contact availability arrive from the separate curation workstream. Its actual table/columns remain unverified. Labels, photos and legacy records prove neither manual review nor number consent.

## 3. Minimal data model

[PROPOSAL] UUID identities, timestamptz, database WIB dates. Retain references/history; no cascade deletion of evidence. Reuse Auth, `pengunjung`, `petugas`, `consent_log`, `audit_log` and `notifikasi`.

| Entity | Essential fields and purpose |
|---|---|
| `umkm_profil`, `umkm_revisi` | Profile id, source ref, status, approved revision, first-publication date; revision id/profile/version, name, description, Type/Category/Specific, regency/city, optional NIB and TikTok/Instagram. Draft changes are private; approved pointer preserves the old snapshot until review. |
| `umkm_foto` | Revision, origin `satudata/eksternal/unggahan`, source URL or R2 key, visibility and review record. Draft uploads are private. |
| `umkm_kontak_versi`, `umkm_izin` | Immutable contact version/number; consent id/profile/contact version, purpose `izin_nomor`, `diberikan/dicabut`, evidence reference, actor/text/time. No `izin_profil` prerequisite for satudata. No copying raw numbers into audit. |
| `umkm_pemilik` | Profile/account, verified representative and review reference. A claim grants no rights until checked; email/phone control alone is insufficient. |
| `umkm_perusahaan`, `umkm_kebutuhan` | Short company identity linked to individual applicant accounts; Need id/company/applicant, description and matching labels/area. Several Needs and UMKM allowed. Review company with its first request rather than a separate verification queue. |
| `umkm_pesan_kontak` | id, optional profile ref, name, company, contact number, message, actor if logged in, `baru/ditangani`, receipt/first-reply time, assigned officer. A's short form with optional private profile/search context, not a new ticket system. FO sees counts only. |
| `umkm_permintaan_kontak` | id/Need/profile/applicant UID?, reference code, one of five states, reviewed version, officer, decision/access refs, `tahan_darurat boolean`, timestamps. Accountless assistance stays unlinked until login with the private one-use code; the officer is never the recipient. Repeating an active Need/profile/applicant pair returns its existing request; revocation permits a new manual round. |
| `umkm_keputusan`, `umkm_pembukaan_nomor` | Append-only manual decision and access record: request, applicant UID, decision, consent/contact version, approving officer UID and opening time. Approval and opening are one transaction, one officer. No separate sending/preparation entity. |
| `umkm_riwayat` | Entity/version/action, actor/time, prior/new state, short reason/evidence reference and operation key. Audited idempotency stores result references, not number/message payloads. |
| `umkm_rekonsiliasi` | Need/candidate, source and outcome `belum_diketahui/kerja_sama/tidak_berlanjut`. Optional source note distinguishes reported cooperation from confirmed payment. No forced follow-up stages or reminders. |

[PROPOSAL] The “being handled by [name]” label uses current handler/version, without a timer. Another officer takes over in one click with automatic history. Decisions use a short row lock and expected version so concurrent reviewers cannot approve conflicting revisions. No database lock while chatting.

## 4. States and one-screen work

Profiles have exactly four states: `diajukan/terbit/disembunyikan/ditolak`. [PROPOSAL] New profiles and revisions stay private. Officers publish or reject with one short reason; corrections create a private revision. Hiding removes discovery/detail access immediately and invalidates public cards. Restore through review, not popularity.

Requests have exactly five states:

| State | Meaning and next action |
|---|---|
| `diajukan` | Officer reviews company/Need/profile together; asks for missing information in the same work record. |
| `menunggu_izin` | Officer chose Setujui but valid UMKM number consent is absent. Record permission, then press Setujui again; no automatic opening. No reply is not rejection. |
| `nomor_dibuka` | Setujui atomically recorded decision/current consent/access for the logged-in original applicant. WhatsApp notification is separate and cannot open access. |
| `ditolak` | Manual refusal with one selected or short typed reason. |
| `dibatalkan` | Applicant cancellation before opening; keep history. |

[PROPOSAL] Setujui validates active officer/session, latest request/profile/contact versions, applicant account, current consent and no emergency hold. Company check and number opening share the screen; no second sender or expiry task. The officer whose decision opens access is recorded. A replacement officer reviews current information and presses the same button, not a separate approval workflow.

[PROPOSAL] Withdrawal immediately invalidates access tied to that consent, even if a tab was already open. New consent never revives an old grant; a fresh manual request/decision is needed. Number changes never reveal a replacement via an older grant. Hiding, revoked contact validity and `tahan_darurat` fail new openings and account reads safely. No sixth request state: emergency hold is an access guard; the next UMKM officer clears it with one click and audit, then reviews normally.

[FACT docs/umkm/KEPUTUSAN-PEMILIK.md] P-32 permits only temporary hiding, emergency holding and recording revocation when no officer is on duty. [PROPOSAL] Admin/FO use a dedicated action requiring a short reason, no number payload or ordinary mutation rights. There is no duty-roster gate; the actor records the emergency context, and supervision reviews its use. Record actor/time/reason and mark next-officer review automatically.

[PROPOSAL] Queue: urgent revocation/triaged fraud first, then oldest complete item. Preserve original receipt date when completing data. No fixed review days or response deadline. FO directs walk-in visitors to the officer channel without entering data; UMKM officers assist accountless applicants. Guide those applicants to login and enter a random one-use linking code sent privately to their recorded contact. The system binds it atomically to that account; no additional verification form or staff step. This code is not a public reference or FO work-trace field. Setujui cannot open before linking.

## 5. Authorization and number isolation

[FACT docs/adr/0003-koordinator-dan-akses-data-per-orang.md:3] Coordinator is not another primary role. [FACT node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md:29] Proxy is not complete authorization. [PROPOSAL] A separate admin-managed `petugas.pemeriksa_umkm` assignment leaves Layanan intact. An admin performs ordinary number work only with an explicit UMKM-officer assignment. FO remains supervisory regardless of a stale/forged reviewer flag.

| Action/data | Public | Original applicant | Verified UMKM owner | UMKM officer | FO | Admin |
|---|---|---|---|---|---|---|
| Approved catalog/Views/Likes | Yes | Yes | Yes | Yes | Yes | Yes |
| Private drafts/Needs/evidence | No | Own Needs | Own revisions | Assigned domain | No | Administrative scope |
| Contact-form contents | No | Own submission if linked | No | Work scope | Count only | Controlled administration |
| Manual review/Setujui | No | No | No | Yes | No | Only as assigned officer |
| UMKM number | No | Own opened grant, valid consent | Own contact | Logged work purpose | Never | Only as assigned officer |
| Receiving company names/dates | No | Own records | Own profile only | Work scope | Redacted supervision | Scoped |
| Queue/work history | No | Own status | Own status | Work scope | Counts/duration/redacted sample traces | Administrative scope |
| P-32 emergency action | No | No | Own revocation | Normal work | Limited action, no number | Same limited action |

[PROPOSAL] Enforce RLS, function privileges and current identity in the database, including direct REST/RPC. Public projections allowlist approved columns/photos, never raw SELECT *. No general authenticated/anon contact or evidence access. Contact consent and account authorization are both necessary, not substitutes. Use nonanonymous applicant/owner accounts; user metadata and company names grant no authority.

[PROPOSAL] Revoke direct state/decision/actor writes. RPC derives actor/time; definer functions only when needed, explicit tables and locked search_path, no PUBLIC EXECUTE. Sensitive calls recheck current staff/session, not only JWT/menu. FO table/view/RPC/export/notification paths never return numbers, including raw form contents and emergency replies. Staff personal numbers are private too.

[PROPOSAL] Owner recipient view joins verified profile ownership to opened grants/company names and opening dates; returns no buyer phone/private Need/evidence. Company coworkers have no inherited access to the original applicant's grant.

## 6. Public contact, consent and account opening

[FACT docs/umkm/KEPUTUSAN-PEMILIK.md] P-33..35 choose each officer's personal WhatsApp, the short LMH entry form and account-only number access. [PROPOSAL] “Hubungi lewat petugas” and empty-search help open the form with name, company, contact number and message. The system queues it privately and records first reply; no WhatsApp URL exposes an officer's personal number publicly.

[PROPOSAL] The task's **Lihat nomor** calls `umkm_akses_kontak_petugas`; return one contact to the active assigned officer currently handling that profile review or number request, with automatic audit. Profile review can seek consent in A; this never opens access to a company in A. Derive purpose from the action, without another staff field. No contact book/export. Consent is checked at applicant opening, not before seeking permission. Missing contact does not block profile publication.

[PROPOSAL] Setujui calls `umkm_setujui_dan_buka`: row lock, version checks and current consent; commit decision, access/history and status together. Retry returns the original result; timeout checks operation result rather than repeating the work. No valid consent means `menunggu_izin`; no linked applicant means guide login, without opening. The response contains state/reference, never the number to paste into chat. P-04's operative evidence is decision, current consent and account opening.

[PROPOSAL] The officer manually sends only request code and canonical LMH login link from personal WhatsApp. The template has no UMKM-number placeholder, arbitrary message text or contact URL query. Record notification separately; delivery/read receipt is not proven by LMH. Account read `umkm_baca_nomor` checks original UID, open grant and its unrevoked consent/contact version every time. Revocation routes to the LMH form/report action. Use private no-store, no prefetch/PWA/CDN cache, local storage, replay capture or payload logs.

[PROPOSAL] System consent checks, automatic audit and FO sample review of redacted traces replace the former staff separation; they are not equivalent to two-person review. No extra daily access cap or clipboard step.

## 7. Small RPC contract

[PROPOSAL] Routes validate shape/session, DB enforces authorization. Shared success `{data,meta:{request_id,next_cursor?}}`; error `{error:{code,message},request_id}`. UUID operation key plus payload hash makes mutations idempotent; same key/different body conflicts. No PII in errors or stored retry payloads.

| RPC/API | Typed input | Response, scope and cost |
|---|---|---|
| `umkm_cari_katalog`, `umkm_profil_publik` | q text?, Type/Category/Specific/city?, sort, cursor?; profile UUID | Approved public projection, ≤20/search, indexed filters before LIMIT 21; detail checks current visibility. |
| `umkm_kirim_pesan_kontak` | name/company/contact/message text, profile UUID? | Opaque receipt id, no submitted PII echoed; public A form, shared rate guard, one insert. |
| `umkm_simpan_kebutuhan`, `umkm_ajukan_kontak` | company/Need allowlist, nonempty profile UUIDs[], expected version, key | Own IDs/states. No business selection/active quota. Technical payload chunks commit atomically with idempotent continuation and reported committed IDs. Officer assistance permitted. |
| `umkm_daftar_tugas`, `umkm_ambil_tugas` | type/cursor?; entity UUID/version/key | ≤20 private work items; handler label/takeover, one short lock. FO supervision is a separate redacted projection. |
| `umkm_putuskan_profil`, `umkm_setujui_dan_buka`, `umkm_tolak_permintaan` | entity UUID, expected version, key; short reason for refusal | Current officer, manual decision/state/access references only; row/history writes commit together. |
| `umkm_akses_kontak_petugas`, `umkm_baca_nomor` | profile/request task UUID for staff; request UUID for applicant | One logged contact for the current officer task or original applicant's opened version. Purpose derived automatically; private no-store, no FO access. |
| `umkm_perusahaan_penerima` | profile UUID, cursor? | Verified owner only; company names/opening dates, ≤20, indexed grant/company join. |
| `umkm_ubah_izin`, `umkm_tindakan_darurat` | entity UUID/version/key, action, short reason/evidence ref | Owner/officer consent scope; limited admin/FO emergency path without number. State/access guards and audit atomically. |
| Profile/revision/claim/report/assistance/outcome operations | entity UUID?, allowlisted fields, version/key | Officer work or verified owner/own applicant scope; photo/profile reports triaged. No bulk public contact reads. |

[PROPOSAL] Errors: invalid input 400, login required 401, forbidden 403, absent/inaccessible 404, stale version/state/key or revoked consent 409, shared technical anti-spam 429 with retry information, unavailable new module 503. No zero-row “success” or service-role fallback. A missing consent is the explicit waiting result, not silent opening.

[PROPOSAL] Use one shared technical rate guard, quiet for normal users; no feature-specific quotas or public threshold numbers. Bound request bytes/queries and let larger legitimate selections continue. This controls bursts, not business demand; high legitimate demand can still overwhelm manual review.

## 8. Photos, social links, audit and privacy

[FACT src/lib/storage/unggah.ts:17] The browser uploads directly to R2. [FACT src/components/umkm/FotoUmkm.tsx:44] Photos load with img/lazy/no-referrer/fallback; [FACT next.config.ts:40] CSP allows HTTPS images. [PROPOSAL] Keep safe external HTTPS photo sources without a site allowlist or Vercel downloader. Satudata remains linked, including on publication; no R2/binary copy. New uploads use private R2 drafts, validated type/size, then reviewed publication; failure never falls back to Supabase. External content can change: report/hide/fallback remain.

[PROPOSAL] Review name/description/address, URLs and photos for contact content before publication; a business-card photo needs a contact-free replacement. No OCR subsystem. Nullable TikTok/Instagram links must be safe HTTPS profile URLs on the intended platforms; blank becomes NULL, changes wait for review. Approved links render as accessible ordinary links with noopener/noreferrer, no embeds, guessed accounts, ranking points or page-load tracking.

[PROPOSAL] Audit automatically records actor, entity/version, action/result, reason, DB time and decision/consent references. No raw phone, chat, name/email or evidence body in logs/cache/notification/export. Notifications use event/recipient/channel keys; optional email failures do not undo decisions.

| Data [INITIAL, P-27] | Retention; review after three months |
|---|---|
| Contact form | 180 days after handling, or last activity if unhandled; delete private content, retain safe totals. |
| Closed requests/access/outcomes and consent evidence | 730 days after closure/withdrawal or last case activity; then unlink PII while keeping safe aggregates/evidence required for the purpose. |
| Canceled/abandoned draft photos | 30 days after cancellation or 90 inactive days; protect drafts under review. |
| Active profiles/contacts | While the purpose remains valid; manual correction/hiding/revocation available. |
| Optional telemetry | Short separate windows and a conditional 50 MB envelope in SISTEM-STATISTIK. |

[FACT docs/KEBIJAKAN_PDP.md:35] Current visitor retention is 730 days; this does not by itself cover new purposes. [PROPOSAL] Publish updated PDP policy and privacy page before telemetry; describe form data, account grants and staff personal WhatsApp before those flows open. DPO review is recommended, not another owner decision gate.

[FACT about this design, P-33..35] Personal phones retain applicant numbers and UMKM contacts used to seek permission; LMH cannot erase their chat histories. Chat content is outside LMH audit: a notification record proves neither receipt nor what a person actually typed. Account-only disclosure reduces exposure, not all phone risk.

[PROPOSAL] On reassignment revoke staff access, transfer LMH cases and request deletion of work chats/contacts on the departing officer's phone; this cannot prove external deletion. To reduce impersonation, the applicant account shows assigned officer name and last four digits of that officer's number; messages contain a request code checked inside the account, not proof by WhatsApp alone. No personal-number public directory.

## 9. Small runtime and removed rules

[FACT node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:51] GET is not automatically cached. [PROPOSAL] Use indexed joins over approved revisions, filters/sort/cursor before LIMIT 21, not an unmeasured catalog read-table subsystem. Index public labels/text, task age/status, ownership UID, request/applicant and history. At 10,000 profiles test broad/selective/deep queries; change design only if measured scale fails.

[PROPOSAL; INITIAL, P-27] Public cards only may cache for 60 seconds with publish/hide invalidation. Detail visibility and all private reads stay live. Cursor carries filter/sort/snapshot/ID and new-slot IDs so 20/page traversal has no duplicates/gaps. No catalog Realtime, endless polling, source downloads or jobs in Vercel; database jobs are bounded and retry safely. Measure real LMH resource use before expansion.

| Removed under P-36 | Lost protection or behavior |
|---|---|
| Separate approval/opening and expiry | No later expiry checkpoint; the one atomic decision and every read enforce current consent instead. |
| Timed claims | No automatic abandoned-claim release; any officer can take over the handler label in one click. |
| Daily access cap and per-feature limits | No daily misuse ceiling; automatic audit, supervision and shared anti-spam remain. |
| Temporary clipboard | No contact-copy convenience; number access stays in the applicant account. |
| Comparative architecture/formula trials | No parallel optimization program; use the simple design until real scale fails. |
| Detailed follow-up workflow | No automatic outcome chasing; record an outcome only when reported. |

Later: coworker invitations, legacy entity mapping, separate company blocking/status workflow, follow-up reminders and history-based personalization. None blocks the agreed phases. Remaining work parameters are initial values, reviewed after three months against queue time, phone handling, resource use and actual activity.

## Revision notes

| Decisions/findings | Sections |
|---|---|
| P-19..28 | 1, 3..8: publication/notice/counts/recipients/revocation, no business quotas |
| P-29..35 | 3..8: officer work, FO supervision/emergencies, personal WhatsApp, short form, account access |
| P-36 | 3..4, 6..9: five/four states, single Setujui, removed timers/caps/clipboard/comparisons |
| C-01..20, X-01..08 | Security/legacy/audit protections retained where consistent with P-36; former sending and expiry rules superseded |
| X-09 | No mandatory comparator; P-36 now directly selects the simple formula |
