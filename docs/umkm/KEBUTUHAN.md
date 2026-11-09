# UMKM feature requirements

Numbered requirements for Phases A, B, and C. Terms, statuses, and roles follow `ALUR-DAN-PERAN.md`. Technical design is in `SISTEM.md` and `SISTEM-STATISTIK.md`; the test plan is in `MIGRASI-RILIS-UJI.md`.

**Rule test (P-36).** A rule stays only if the product owner decided it, or it stops a UMKM number leak or legal breach, or the system does it silently with no extra step for anyone. Everything else is removed or listed in section 7.

**Safety floor, never cut:** UMKM numbers are not public; profiles are reviewed before showing; requests are reviewed by a UMKM officer; the system checks UMKM consent when the number opens; the number shows only in the requester's account after login, never in cache or logs; recording is automatic; the FO is read only with no number, except urgent actions (P-32).

IDs keep their earlier numbers, so gaps are expected. All rows are priority Must unless marked (S) for Should. P-01 to P-36 are the decisions in `KEPUTUSAN-PEMILIK.md`. **[INITIAL]** marks a working number adopted under P-27 and reviewed after three months. UI text stays in Indonesian. Project rules in `CLAUDE.md` (WIB time, forward-only migrations with contract tests, `lib/pii.ts` and `lib/csv.ts`, accessibility patterns, no tool attribution) apply and are not repeated.

## 1. Phase A: catalog and officer tools

| ID | Actor | Requirement | Acceptance criteria | Ref |
|---|---|---|---|---|
| K-A-01 | Visitor | Browse `terbit` profiles and open a shareable profile page without login. | A profile in any other status never appears in the catalog, search, profile page, or direct link. The page shows business name, Type, Category, Specific, regency/city, description, photo. | P-01 |
| K-A-02 | Visitor | Search by keyword and filter by Type, Category, regency/city. | 20 results per page; search runs in the database; no request loads the whole catalog into the browser. | P-12 |
| K-A-04 | All | WhatsApp number, phone, email, detailed address, and owner name never appear on public pages. | Checks of HTML, public API responses, and catalog cache find no contact column. A synthetic number in the name, description, or photo URL raises a warning and blocks publication until cleaned. The officer looks at photos for written numbers; no OCR. | P-04, P-12 |
| K-A-05 | Visitor | "Hubungi lewat petugas" and the zero-result exit open a short LMH form. | Fields: name, company, contact number, message; the profile code or search keyword is attached silently. Messages are private and enter the officer task list with state `baru` or `ditangani`. The officer contacts the sender from the officer's personal WhatsApp. In Phase A the answer is a profile link, not a number. Retention [INITIAL: 180 days from `ditangani` or last activity]. The FO sees counts only. | P-17, P-33, P-34 |
| K-A-06 | Visitor | Report a profile or photo. | One pick of reason, optional note. A fraud report goes to the top of the task list. | P-07, P-09 |
| K-A-07 | UMKM officer | Add a profile from curated data, satudata, or a guest at the service counter. | The profile is `diajukan` with its source recorded silently. NIB is an optional yes/no with no effect on publication; a profile without NIB shows the owner how to obtain one. A profile without a WhatsApp number is flagged. | P-01, P-03, P-29 |
| K-A-08 | UMKM officer | Review a profile on one screen with at most two clicks. | "Terbitkan" or "Tolak" with one short reason; no other required field. Publication needs review only, with no owner consent to show (P-19). Officer, time, and data version are recorded automatically. A label shows "sedang dipegang [nama]" with no timer; another officer takes over with one click, recorded. | P-01, P-05, P-19, P-36 |
| K-A-10 | UMKM officer | Hide and restore a profile or single photo. | A hidden profile page is refused immediately, and an opened number for it stops showing until restored; its card leaves the catalog at the next cache refresh; a hidden photo shows a placeholder; recorded automatically. | P-09 |
| K-A-11 | UMKM officer | Set a photo from any https link or upload to R2. | Links must be https, with no username/password and no local address [FACT src/lib/umkm/foto-url.ts:10-31]. Satudata photos stay as links and are not copied to R2. No new UMKM photo goes to Supabase Storage. Changing a photo means review again. | P-09 |
| K-A-14 | UMKM officer | Ask for number consent through the officer's personal WhatsApp and record it with one click, during review or when a request arrives. | The officer reads the number with "Lihat nomor" (logged automatically); a message template exists. States `diberikan` or `dicabut`; date, source, and consent text version are recorded silently; history is never deleted; a contact number change voids consent automatically. A refusal closes the request with "Tolak", reason "UMKM belum bersedia". | P-04, P-19, P-29, P-33 |
| K-A-16 | UMKM officer | One ordered task list, reachable only with the UMKM reviewer flag. | Urgent items first (fraud reports, consent revocations, urgent holds), then complete items oldest first across all types; no completion date shown to users. New entry in `src/lib/admin-nav.ts`; an officer without the flag is refused in the database. | P-06, P-07 |
| K-A-19 | All | The legacy marketplace keeps working. | `/umkm`, `/umkm/inbox`, `/umkm/edit/[id]`, and their APIs pass existing tests with no behavior change. | P-11 |
| K-A-23 | Visitor, officer | Show a UMKM's TikTok and/or Instagram link when present. | Optional fields, reviewed with the profile. Only `https` on those two domains is accepted, checked silently. Shown as a labeled link on the profile page, opened in a new tab; absent means no box, icon, or empty text. No effect on ranking; clicks are not recorded. | P-14 |
| K-A-25 | All | Phase A shares no UMKM number; Phase B opens number sharing only when fully recorded. | Negative test: no Phase A screen, API, or RPC gives a number to an FO, company, or visitor. Phase B activation test: every `nomor_dibuka` has the officer's decision, the latest valid consent, and the opening record; if any is missing, opening fails. | P-04, P-17 |
| K-A-26 | FO, admin | Take limited urgent action on a fraud report or consent revocation when no UMKM officer is on duty. | Only: temporarily hide a profile, hold a contact request (flag, not a status), record a consent revocation. No action shows a number. Each is recorded with a short reason and enters the officer task list. A UMKM officer clears a hold with one click. No handling time promised. [ASSUMPTION] No duty roster exists (P-25), so the system does not test absence. | P-07, P-32 |
| K-A-27 | FO | Read-only supervision: queue and form counts, process time, officer work trail. | The database never returns a UMKM number to this role, not only masked on screen. Negative tests: no number through a table, view, RPC, export, or notification; an FO cannot approve, change, or send anything except K-A-26. The FO directs counter guests to the UMKM officer channel and enters no data. | P-29, P-31 |

## 2. Phase B: companies, Needs, contact requests

| ID | Actor | Requirement | Acceptance criteria | Ref |
|---|---|---|---|---|
| K-B-02 | Company representative | Log in with Google and fill in short company data once. | An anonymous session cannot submit. Required: company name, position, one consent checkbox recorded in `consent_log`. Name, email, phone come from the visitor profile. | P-02, P-35 |
| K-B-03 | Company representative | Create several Needs, each with any number of UMKMs. | A Need holds what is sought (short text), one Category, optional regency/city. Each Need-UMKM pair is one contact request; a repeat returns the existing request; after a revocation a new request is decided again. No business limit on UMKMs per submission or active requests. | P-02, P-26 |
| K-B-04 | Company representative | See "Permintaan saya": status, submission date, reason. | Only that account's requests appear; no completion date or review hour is promised. | P-07, P-25 |
| K-B-05 | Company representative | Cancel a request before the number opens. (S) | Status becomes `dibatalkan`; no cancel button after `nomor_dibuka`. | |
| K-B-08 | UMKM officer | Decide each request on one screen with at most two clicks: "Setujui" or "Tolak". | No path reaches `nomor_dibuka` without an officer pressing "Setujui", including for companies approved before (negative test). "Setujui" is one step: the database checks consent, contact version, profile status, and hold flag. Valid: `nomor_dibuka`, recorded in one transaction, the officer is not shown the number. No valid consent: `menunggu_izin`; the officer records consent and presses again. No expiry. Company review happens on the same screen with the first request; later requests show "perusahaan sudah diperiksa". Rejection needs one short reason. Negative test: "Setujui" cannot open a number after revocation. | P-04, P-05, P-30, P-35, P-36 |
| K-B-12 | Company representative | See an opened number in the account, the main path to the number. | Only for the original requester's account, after login, for `nomor_dibuka`. Absent from WhatsApp messages, shared cache, server logs, push, email. After revocation the number stops showing at once and the page points to the LMH form; a later new consent does not restore it. | P-10, P-21, P-35 |
| K-B-13 | System, UMKM officer | Record the outcome of each opened number. | `nomor_dibuka` creates one record automatically with `belum_diketahui`. The officer may pick `kerja_sama` or `tidak_berlanjut` with one click when news arrives. `nomor_dibuka` never counts as success. | |
| K-B-17 | UMKM officer | Record a Need and request on behalf of a company. (S) | Source recorded silently. The number opens only after the company has an account: the officer sends a one-time random link code and login link to the recorded contact, the requester logs in and enters the code, which links the account; the officer then presses "Setujui". | P-29, P-35 |
| K-B-20 | All | WhatsApp notification carries an anti-fraud reminder and no UMKM number. | The requester template holds request code, login link, and warning, and has no field for a UMKM number; a test proves it. It opens from one button, which records it silently; no extra step. LMH cannot prove delivery. | P-35 |
| K-B-23 | Company representative | Recognize the real officer. (S) | [PROPOSAL] The request page shows the officer's name and the last four digits of the officer's number; messages carry a code checkable in the account. The full officer number never appears on public pages, catalog cache, or exports. | P-33 |

## 3. Phase C: self-service UMKM

| ID | Actor | Requirement | Acceptance criteria | Ref |
|---|---|---|---|---|
| K-C-01 | UMKM owner | Register after login and see the status. | The new profile is `diajukan` and private. The owner sees status, submission date, and any officer note; no queue position or completion date. | P-01, P-07 |
| K-C-03 | UMKM owner | Claim an existing profile. | The owner link forms only after an officer confirms the responsible person; login alone grants no edit right. | P-05 |
| K-C-04 | UMKM owner | Edit a profile through a private draft, including photos and social links. | The published version stays until the draft is approved. Draft photos sit in a closed R2 area and cannot be opened by public address. | P-01, P-09, P-14 |
| K-C-06 | UMKM owner | Revoke own number consent. | Takes effect at once: no new opening, and the number stops showing in company accounts (K-B-12). The page explains that a number already received cannot be recalled. | P-04, P-21 |
| K-C-08 | UMKM owner | See own profile statistics and the companies that received the number. | Views, Likes, requests, numbers opened, 30-day trend. Company name and date only, no requester personal data. | P-24 |

## 4. Statistics, ranking, recommendations

Product detail is in `STATISTIK-REKOMENDASI-PRODUK.md`; technical detail in `SISTEM-STATISTIK.md`.

| ID | Phase | Requirement | Acceptance criteria |
|---|---|---|---|
| K-SA-01 | A | Count Views while the optional telemetry switch is on. | One per visitor per profile per WIB day; reloads, crawlers, staff, and the owner do not count. |
| K-SA-02 | A | Default ranking "Paling sesuai". | Search match first, then Score = 5 x Likes + Views over the last 90 days [INITIAL]. With the switch off, Score = Likes. Company interest, NIB, and consent stay out (P-15). Ties are shuffled daily. Updated once a day by pg_cron. |
| K-SA-03 | A | New-UMKM slots on the first page, the protection against looking empty (P-23). | Positions 5 and 15 of page one go to matching profiles published under 30 days, rotating daily; if none, normal order. |
| K-SA-04 | A, B | Recommendations from what users give knowingly. | "UMKM serupa" on the profile page: same Category, same regency/city first. For a saved Need: top 10 by Category, same regency/city first, excluding UMKMs already requested; private to that account. One database query on open. No feature uses a person's view or like history [FACT docs/KEBIJAKAN_PDP.md:31]. |
| K-SA-05 | A, B | One report for officers and admins, downloadable. | Profiles per status, Views, Likes, zero-result groups; from Phase B also requests per status, Company interest (P-15), wait time (internal), outcomes. With the switch off, Views and zero-result groups read "belum dicatat", not zero. No UMKM number or requester contact in the download. |
| K-SA-06 | A | Count Likes. | Logged-in accounts only; one per account per profile; can be undone; own profile and staff do not count. |
| K-SA-07 | A | Public numbers with no minimum (P-23). | Every published profile shows Likes and, while the switch is on, Views, including zero; exact under 1,000, compact above. With the switch off Views do not show. No "Diminati perusahaan" label (P-28). Under 30 days carries the "Baru" label. |
| K-SA-08 | A | One optional telemetry switch. | Holds Views, zero-result groups (counts per Category and regency/city filter, with no search words), and form-open clicks. Basis: announcement in the privacy policy, no separate consent (P-20). Off until K-NF-11 is done. Test: while off, nothing is written for these, and the catalog, ranking, and Likes keep working. |

## 5. Non-functional requirements

| ID | Phase | Requirement | Acceptance criteria | Ref |
|---|---|---|---|---|
| K-NF-01 | All | Light on Vercel and Supabase. | No image processing, ranking, or aggregation in server functions; no realtime subscription; no unbounded query; public catalog cache holds no contact data; private data never enters shared cache. | P-12 |
| K-NF-04 | All | Permission rules and status changes are enforced in the database. | SQL contract tests and RLS scenarios prove a wrong role is refused even when calling the database directly. | P-12 |
| K-NF-05 | All | Automatic audit trail for each decision, number read, number opening, consent change, and urgent action. | Stores actor, role, time, object, old and new status, with no raw number; no action asks the officer for extra input. The trail, the system consent check, and the FO view replace the second person. No document or screen calls them equal to a two-person check. | P-30, P-31, P-36 |
| K-NF-10 | All | One technical rate limit, invisible to normal users. | [PROPOSAL] Stops bursts on reports, likes, form messages, and submissions (`check_anon_rate` pattern); no number shown to users; never a business limit. | P-26, P-36 |
| K-NF-11 | A (before the form opens and before the switch turns on); B (before release) | Privacy policy page and `docs/KEBIJAKAN_PDP.md` are updated and published first. | Phase A text announces the contact form, recorded statistics, retention, and officers' personal WhatsApp. Phase B text adds number consent. [PROPOSAL] DPO review is advised, not a product owner condition. | P-20, P-33 |
| K-NF-13 | All | Target of at most 10,000 profiles; real officer time is measured. | Load tests use 10,000 synthetic profiles and one account with many active requests. No phase has a minimum profile count. Officer time is read from audit timestamps; no document or screen promises a volume, hour, or deadline. | P-18, P-25 |

## 6. Closed questions

All earlier questions are answered; none remain open. P-19 closes O-SIS-07; P-20 closes S4, O-STA-06; P-21 closes O-SIS-01; P-22, cancelled by P-36, closes O-SIS-02; P-23 closes S1, O-STA-02; P-24 closes S6; P-25 and P-26 close O-SIS-03; P-27 closes S5, O-STA-03, O-STA-05; P-28 closes S3. History personalization stays off (S2, O-STA-04).

## 7. Later (not built now)

Blocking a company. Coworker invitations. Linking legacy listings. Assistance requests with no target company. Recording officer offers. Follow-up reminders and detailed outcome stages. Like freeze and spike detection. Sorting options beyond "Paling sesuai". "Serupa dengan yang Anda sukai". Search boost for Need categories. Counting social link clicks and catalog visits. Zero-result word list. Stale-profile re-review. Recording notifications to the UMKM.

## 8. Revision notes

| Source | Changed |
|---|---|
| P-19 to P-28 | K-A-05, K-A-08, K-A-14, K-B-03, K-B-04, K-B-12, K-C-06, K-C-08, K-SA-03, K-SA-07, K-SA-08, K-NF-10, K-NF-11, K-NF-13 |
| P-29 to P-32 | K-A-07, K-A-14, K-A-16, K-A-26, K-A-27, K-B-08, K-NF-05 |
| P-33 to P-35 | K-A-05, K-A-14, K-B-08, K-B-12, K-B-17, K-B-20, K-B-23, K-NF-11 |
| P-36 | Whole document cut to 45 rows; merged rows keep the lowest ID; removed rows are in section 7 |
