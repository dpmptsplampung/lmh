# UMKM feature flows and roles

Who is involved, what they may do, journeys, statuses, edge cases, and core user text. Technical design is in `SISTEM.md`; numbered requirements in `KEBUTUHAN.md`, including the rule test and safety floor (P-36).

Labels: **[FACT path:line]** for current code, **[ASSUMPTION]**, **[PROPOSAL]**, **[INITIAL]** for a working number reviewed after three months (P-27). Decisions **P-01** to **P-36** are in `KEPUTUSAN-PEMILIK.md`. Status values and UI text stay in Indonesian.

## 1. Roles

| Role | Who | May | May not |
|---|---|---|---|
| Visitor | Anyone, no login | Browse, search, see public numbers, report a profile, send the short form | See UMKM numbers, like, submit requests |
| Company representative | Logged in (Google) with short company data | Visitor rights, like, create Needs, submit and cancel requests, see opened numbers unless consent was revoked (P-10, P-21) | See other accounts' data, including coworkers'; see unopened numbers |
| UMKM owner (Phase C) | Responsible person an officer confirmed | Register, edit into a private draft, see own statistics, revoke consent, see names of companies that received the number (P-24) | Change the published version without review |
| UMKM officer | Officer account given the UMKM reviewer flag by an admin, separate from the main Layanan [FACT supabase/migrations/202607140002_core_schema.sql:18] | All operational work (P-29, section 5) | Open a number when the system check fails; delete decision records |
| FO | `front_office` role [FACT supabase/migrations/202607290009_role_front_office.sql:9-11] | Read only (P-31): queue and form counts, process time, work trail. Urgent actions (P-32). Direct counter guests to the UMKM officer channel | Receive a UMKM number by any path; read form content; enter data; approve, change, or send anything else |
| Admin | LMH admin | Set the reviewer flag, urgent actions, reports. Reads or opens numbers only with the flag | Change recorded decisions |

Current state: `/admin/umkm` is admin-only [FACT src/lib/admin-nav.ts:125]; no reviewing UMKM officer exists yet.

## 2. Scope per phase

| Phase | For users | For officers |
|---|---|---|
| A | Catalog of published profiles, 20 per page, no numbers. Short form for "Hubungi lewat petugas" and zero-result searches (P-34). Likes, Views once the switch is on, report button. **No number sharing** (P-17) | Enter and review profiles, hide, answer form messages from personal WhatsApp, task list, report. FO supervision page |
| B | Login, short company data, Needs, "Hubungi UMKM", status, opened numbers in the account (account required, P-35), Need recommendations | One-button request decision, consent recording, outcome |
| C | Self-registration, claim, private drafts, owner statistics, consent revocation | Registrations and drafts in the same task list |

The legacy marketplace keeps running in all phases (P-11).

## 3. Main journeys

**Company finds a supplier (Phase B).** Bu Rina searches "keripik pisang", picks UMKMs, and presses "Hubungi UMKM". She logs in with Google, enters company name and position, and writes a Need. "Permintaan saya" shows each request as `diajukan` with its date. When an officer next works the list, the officer takes the oldest item, checks the company on the same screen, and presses "Setujui" or "Tolak". If the UMKM has valid consent, the status becomes `nomor_dibuka` at once. If not, it becomes `menunggu_izin`: the officer presses "Lihat nomor" (logged), asks the UMKM through the officer's personal WhatsApp, records consent with one click, and presses "Setujui" again. The officer then sends Bu Rina a WhatsApp notification with the request code and login link. No UMKM number is ever written in chat. She logs in and sees the number. Later the officer picks the outcome if news arrives.

**Visitor asks an officer (Phase A).** A visitor presses "Hubungi lewat petugas" and fills in the short form. The officer contacts the sender from personal WhatsApp and replies with a profile link. No UMKM number is shared in this phase.

**UMKM registered (A by officer, C by owner).** The profile is `diajukan` and private (P-01). The officer checks that the business is real, the category is right, the photo is fine, and no contact detail is written in the name, description, or photo. No consent to show is needed (P-19). The officer presses "Terbitkan" or "Tolak" with a short reason, or writes a note and leaves it `diajukan` while the data is fixed. Number consent may be recorded now or when a request arrives. A guest at the counter is sent by the FO to the UMKM officer channel; the officer enters the data.

**Owner edits (Phase C).** Changes save as a private draft; the published version stays until an officer approves.

**Consent revoked.** The owner (Phase C) or an officer records `dicabut`; if no officer is on duty, an admin or FO may (P-32). The number stops showing in company accounts at once (P-21), and no new opening is possible. A number already received cannot be recalled; the owner sees this when revoking.

## 4. Statuses

**Profile (4):** `diajukan` (private, awaiting review), `terbit` (public), `disembunyikan` (withdrawn; goes back through review), `ditolak` (not eligible, reason written). A closed business is hidden.

**Contact request (5):**

| Status | Requester sees | Moved by |
|---|---|---|
| `diajukan` | "Permintaan diterima pada [tanggal]" | System on creation |
| `menunggu_izin` | "Menunggu konfirmasi UMKM" | "Setujui" with no valid consent |
| `nomor_dibuka` | The number in the account, until consent is revoked | "Setujui" with valid consent |
| `ditolak` | Reason | UMKM officer |
| `dibatalkan` | "Dibatalkan" | Requester, before the number opens |

Not statuses: "sedang dipegang [nama]" is a label with no timer and one-click takeover; the urgent hold (`tahan_darurat`) is a flag that blocks "Setujui" until a UMKM officer clears it with one click. There is no expiry (P-36).

**Need:** `aktif` or `ditutup`. Closing a Need cancels its unopened requests. Any number of UMKMs and active requests is allowed (P-26). On behalf of a company without an account, the officer records the request; the number opens only after the requester logs in and enters the one-time link code the officer sent (P-35).

**Outcome** of each opened number: `belum_diketahui`, `kerja_sama`, `tidak_berlanjut`. One click, when news arrives. No reminders.

**Form message:** `baru`, `ditangani`.

## 5. Work split

| UMKM officer does | FO only supervises | Admin |
|---|---|---|
| Review and publish profiles. Review companies and requests. Ask for and record consent. Press "Setujui" and notify the requester. Answer form messages. Enter counter registrations. Record requests on behalf of a company. Hide photos or profiles. Pick outcomes | Read only: queue and form counts, process time, work trail without numbers. May look through the trail and report anomalies to an admin. Directs counter guests. Urgent actions only | Sets the reviewer flag. Urgent actions. Reports. Numbers only with the flag |

**Number reads.** "Lihat nomor" shows one number for the task held; it is logged automatically, with no list, search, or export. "Setujui" opens the number to the requester without showing it to the officer. The database never returns a number to the FO role.

**Replacing the second person.** One officer now approves and opens. The system consent check, the automatic trail, and the FO view are what remain. They are not equal to a two-person check: a dishonest or mistaken officer can still approve, and it is found only afterward.

**Urgent actions (P-32).** For a fraud report or consent revocation with no UMKM officer on duty, an admin or FO may temporarily hide a profile, hold a request, or record a revocation. None shows a number. Each needs a short reason and enters the officer task list. [ASSUMPTION] No duty roster exists (P-25), so the system does not test absence.

**Task list (P-07).** One list: urgent items first, then complete items oldest first across requests, form messages, and profiles. Each decision fits one screen and at most two clicks.

## 6. Role and action matrix

| Action | Visitor | Company rep. | UMKM owner | UMKM officer | FO | Admin |
|---|---|---|---|---|---|---|
| See catalog, send form, report | Yes | Yes | Yes | | | |
| Like | | Yes | Yes, own not counted | | | |
| See unpublished profiles | | | Own | Yes | | Yes |
| Create Need, submit request | | Own | | On behalf | | With flag |
| Decide a request, publish a profile | | | | Yes | | With flag |
| See a UMKM number | | Own `nomor_dibuka` | Own | "Lihat nomor", logged | Never | With flag, logged |
| See companies that received the number | | | Own | Yes | Through the trail | Yes |
| Record consent | | | Revoke own | Yes | Revocation, urgent only | Yes |
| Hide a profile, hold a request | | | | Yes | Urgent only | Yes |
| Read form content | | | | Yes | Counts only | Yes |
| Queue counts, process time, trail | | | | Yes | Read only | Yes |
| Statistics and download | | | Own profile | Yes | | Yes |

## 7. Edge cases

| Case | Behavior |
|---|---|
| UMKM refuses or cannot be reached | The request stays `menunggu_izin`; the officer closes it with "Tolak" and a short reason when ready. |
| UMKM number changes | Consent is void automatically; the old number stops showing; the officer asks again. |
| Officer away | Nothing waits on one person: any UMKM officer may take the item with one click and decide. |
| Profile hidden | "Setujui" fails and an opened number stops showing until the profile is `terbit` again. |
| Consent granted again after revocation | Old requests stay closed to that number; a new request follows the usual path. |
| Profile with no WhatsApp number | May publish; flagged so the officer sees it before deciding. |
| Number in text or photo | The system warns on text and links; the officer checks photos. If one slips through, reporting and hiding are the way out. |
| Linked photo changes, broken link | Report and hide; broken links show a placeholder [FACT src/components/umkm/FotoUmkm.tsx:44-54]. |
| One account submits many requests | Allowed (P-26); each is decided by hand in queue order. Only the rate limit stops bursts. |
| Duplicate with legacy marketplace | They run separately; no automatic merge. |

## 8. Core user text

Draft content in Indonesian. No WhatsApp template has a field for a UMKM number.

| Place | Text |
|---|---|
| Profile, in place of a number (Phase A) | "Nomor pemilik usaha tidak ditampilkan. Tekan Hubungi lewat petugas untuk mengisi formulir singkat; petugas akan menghubungi Anda." |
| Profile, in place of a number (Phase B) | "Nomor pemilik usaha tidak ditampilkan. Tekan Hubungi UMKM. Bila disetujui petugas, nomor tampil di akun Anda." |
| Reply to a form message (Phase A) | "Halo [nama], saya [nama petugas], petugas UMKM DPMPTSP. Berikut profil [nama UMKM]: [tautan]. Saat ini LMH belum membagikan nomor UMKM." |
| Status `diajukan` | "Permintaan Anda kami terima pada [tanggal]. Petugas memeriksa sesuai urutan masuk." |
| Status `ditolak` | "Permintaan untuk [nama UMKM] belum dapat dilanjutkan. Alasan: [alasan]. Anda dapat memilih UMKM lain atau mengisi formulir Hubungi lewat petugas." |
| Status `nomor_dibuka` | "Nomor [nama UMKM]: [nomor]. Dibuka petugas [nama petugas] pada [tanggal]. Sebutkan kode [kode] saat menghubungi." |
| Number after revocation | "Nomor [nama UMKM] tidak lagi ditampilkan. Untuk informasi, isi formulir Hubungi lewat petugas." |
| WhatsApp: ask for consent | "Halo [nama UMKM], saya [nama petugas], petugas UMKM DPMPTSP Provinsi Lampung. [Nama perusahaan] ingin membeli [kebutuhan singkat]. Bolehkah nomor Anda kami tampilkan untuk perusahaan yang sudah kami periksa? Izin dapat dicabut kapan saja. Kode: [kode]." |
| WhatsApp: notify requester | "Halo [nama pemohon], saya [nama petugas], petugas UMKM DPMPTSP. Permintaan [kode] untuk [nama UMKM] disetujui. Silakan masuk ke akun LMH untuk melihat nomornya: [tautan]. DPMPTSP tidak menjamin transaksi; jangan mengirim uang sebelum ada kesepakatan tertulis." |
| When revoking | "Setelah dicabut, nomor Anda tidak lagi diberikan ke perusahaan baru dan tidak tampil di akun perusahaan di LMH. Perusahaan yang sudah menerima nomor Anda mungkin masih menyimpannya." |
| NIB information | "Usaha Anda belum tercatat memiliki NIB. NIB gratis dan dapat diurus lewat Helpdesk OSS DPMPTSP. Profil Anda tetap tampil tanpa NIB." |

## 9. Remaining risks

| Risk | What remains |
|---|---|
| The personal phone keeps data | Asking for consent puts the UMKM number in the officer's chat; the requester's number lands there too. P-35 reduces this but does not remove it. LMH cannot delete it. |
| Chat is outside the audit trail | LMH records actions in LMH only. It cannot prove what was said in chat, whether a message arrived, or whether an officer wrote a number by hand. |
| Officer changes duty | Status lives in LMH, so another officer continues. An admin removes the reviewer flag at once. [PROPOSAL] The officer is asked to delete work chats; LMH cannot verify this. |
| Scammer posing as an officer | A personal number cannot be recognized as an institution number. [PROPOSAL] The request page shows the officer's name and last four digits, and messages carry a code checkable in the account. A UMKM with no account can only ask through the LMH form. |
| Policy | Officers' phones process personal data; `docs/KEBIJAKAN_PDP.md` and the privacy page must say so. DPO review is advised. |

**What each removed limit gives up (P-36).**

| Removed | What is lost |
|---|---|
| 14-day validity and `ditahan` | A `menunggu_izin` request can sit with no automatic prompt to review it again. |
| Separate approve and send | Nobody looks at the request a second time before the number opens. |
| 30-minute hold | Two officers can briefly look at the same item; the takeover is recorded, and the second decision fails. |
| 30 reads per day | Misuse of number reads is found only afterward, from the trail. |
| Feature limits on likes and reports | Slow, patient abuse below the single rate limit is not stopped. |
| Blocking a company | An abusive company can keep submitting; each request is rejected by hand. |
| Fixed review share | Registrations compete with requests by age alone. |
| FO sample schedule | Nobody is obliged to look at the trail on a set day. |

## 10. Revision notes

| Source | Changed sections |
|---|---|
| P-19 to P-28 | 1, 3, 4, 6, 7, 8 |
| P-29 to P-32 | 1, 2, 3, 5, 6 |
| P-33 to P-35 | 3, 4, 8, 9 |
| P-36 | Whole document rewritten shorter; the decision summary table is removed in favor of `KEPUTUSAN-PEMILIK.md` |
