# Statistics, ranking, and recommendations (product side)

Answers the product owner's request in `KEPUTUSAN-PEMILIK.md` section 4. Technical detail is in `SISTEM-STATISTIK.md`; requirement IDs refer to `KEBUTUHAN.md` section 4.

Labels: **[FACT path:line]**, **[ASSUMPTION]**, **[PROPOSAL]**, **[INITIAL]** for a working number reviewed after three months (P-27). Keep it simple (P-36).

## 1. What is counted

| Number | Definition | Not counted | Phase |
|---|---|---|---|
| Views (S) | Profile page opened; one per visitor per profile per WIB day | Reloads, crawlers, staff, the owner | A |
| Likes | A logged-in account presses "Suka"; one per account per profile; can be undone | Anonymous sessions, staff, the owner | A |
| Zero-result groups (S) | Searches with no result, counted per Category and regency/city filter. No search words and no searcher identity | Successful searches | A |
| Form-open clicks (S) | "Hubungi lewat petugas" pressed, one per visitor per profile per day | Repeat clicks | A |
| Requests | Per status | | B |
| Numbers opened | Requests in `nomor_dibuka` | | B |
| Company interest | Distinct companies with a number opened for the UMKM. Reports only, not in the formula (P-15) and no public label (P-28) | | B |
| Outcome | `belum_diketahui`, `kerja_sama`, `tidak_berlanjut` | `belum_diketahui` never counts as success | B |

**Optional telemetry switch (K-SA-08).** Numbers marked (S) sit behind one switch. The basis is an announcement in the privacy policy, with no separate consent (P-20). It stays off until `docs/KEBIJAKAN_PDP.md` and the privacy page are published. Off means no token and no row is written, and the catalog stays fully usable. Reports then read "belum dicatat", not zero. Likes are outside the switch because the owner asked for them and they are a deliberate act.

Visitors are recognized by a random browser token, masked daily; it only prevents double counting. It is pseudonymous, not absolutely anonymous.

## 2. Who sees which number

| Number | Public | UMKM owner (C) | Company rep. | UMKM officer, admin | FO |
|---|---|---|---|---|---|
| Views, Likes | Yes, no minimum (P-23) | Yes, 30-day trend | As public, plus own likes | Yes | |
| Requests, numbers opened, Company interest | No | Counts and company names (P-24) | Own only | Yes | Counts |
| Outcomes | No | No | No | Yes | Counts |
| Zero-result groups, form clicks | No | No | No | Yes | |

Every published profile shows its numbers, including zero. Numbers under 1,000 are exact; larger ones are compact ("1,2 rb kali dilihat"). While the switch is off, no Views number exists, so Views do not show. Profiles published under 30 days carry the "Baru" label. The new-UMKM slot is what protects new UMKMs from looking empty (P-23).

## 3. Ranking "Paling sesuai"

1. **Search match comes first.** The database text search ranks a match in Specific or Category above a match only in the name or description. Filters are filters; non-matching profiles do not appear.
2. **Then Score [INITIAL]:**

```
sketch:
Score = 5 x Likes in the last 90 days + Views in the last 90 days
Switch off: Score = Likes in the last 90 days
```

Plain explanation: one like weighs as much as five views, and only the last 90 days count, so old popularity drops out without any further rule. The weight favors likes because they come from logged-in people and are harder to fake. Score updates once a day at 02.00 WIB by pg_cron.

3. **Ties** are shuffled with the date as seed, so the order stays the same all day and changes tomorrow.
4. **New-UMKM slot:** positions 5 and 15 of page one go to matching profiles published under 30 days, rotating daily. If none, normal order.

Deliberately not in the formula: NIB (P-03), number consent, and Company interest (P-15), so a UMKM keeping its number private does not drop. Social links do not count either.

**What simplifying gives up.** A very popular UMKM can stay on top as long as it stays popular inside the window; there is no category-relative scaling. If real data shows this hurts, change the weight first.

**Rejected:** paid or hand-picked promotion (does not fit a government institution); AI or vector search (cost, hard to explain, too little data); personalization from view or like history (conflicts with [FACT docs/KEBIJAKAN_PDP.md:31]); buyer star ratings (no proven transactions).

## 4. Recommendations

The basis is data users give themselves. Each is one database query of at most 20 rows, using the prepared Score. No list is stored per person.

| User | Basis | Form | Phase |
|---|---|---|---|
| Visitor | Current keyword, filters | Ranked results; "UMKM serupa" on the profile page (same Category, same regency/city first) | A |
| Logged-in visitor | As above, plus own likes | "UMKM yang saya sukai" list | A |
| Company representative with a Need | Need Category and regency/city | "Rekomendasi untuk Kebutuhan [nama]": top 10, excluding UMKMs already requested; private | B |

## 5. Preventing manipulation

One count per visitor per profile per day; likes only from logged-in accounts; owner and staff not counted; known crawlers ignored; one technical rate limit (K-NF-10). What this gives up: several real accounts can still inflate likes; there is no spike detection or freeze. Reports show likes per profile, so an officer may notice. Showing all numbers publicly (P-23) raises the reward for this, so it is worth watching at the three-month review.

## 6. Privacy

| Data | Stored | Retention [INITIAL] | Basis |
|---|---|---|---|
| Views, form clicks | Profile, WIB date, masked daily token | Raw 7 days, daily 95 days, monthly summary 24 months | Announcement (P-20) |
| Zero-result groups | Filter group, count, date; no search words | Daily 95 days, monthly 24 months | Announcement (P-20) |
| Likes | Account and profile | While active | Deliberate user action |
| Form messages | Name, company, contact number, message | 180 days from `ditangani` or last activity | Sender's own message, explained on the form |
| Company data and Needs | Representative's entries | 730 days from case closure | Consent in `consent_log` [FACT supabase/migrations/202607140003_feature_schema.sql:162-169] |
| UMKM number consent | Status, source, text version | While valid; evidence 730 days after revocation | UMKM consent in `consent_log` |

`docs/KEBIJAKAN_PDP.md` and the privacy page must be published before the switch turns on and before Phase B, and they must name officers' personal WhatsApp (P-33). The PDP table still says "Matchmaking UMKM: nama UMKM, kontak, kebutuhan untuk marketplace publik" [FACT docs/KEBIJAKAN_PDP.md:20], and the legacy admin consent text promises public contact display [FACT src/app/admin/umkm/page.tsx:798]; both need aligning with P-04. [PROPOSAL] DPO review is advised before release; it is not a product owner condition.

## 7. Free tier cost

| Event | Database writes |
|---|---|
| Open a profile | Three for a new View (dedup row, daily count, lifetime total), only while the switch is on |
| Like or unlike | Two |
| Successful search | None for statistics |
| Zero-result search | One count per filter group per day, only while the switch is on |
| Score | All profiles, daily by pg_cron, so expired signals drop out |

[ESTIMATE] At 10,000 profiles (P-18): profile data about 40 MB [ASSUMPTION: 4 KB per profile], statistics at most 50 MB, of the 500 MB shared database. Not measured. If space runs short, the switch turns off first.

## 8. Reports

One report grows by phase (K-SA-05). **A:** profiles per status, Likes, Views, zero-result groups. What this gives up: officers see where supply is missing, not the exact words people typed; a sender who wants more uses the form. **B:** requests per status, Company interest, wait time (internal, never promised), outcomes. **C:** self-registrations per status. Downloads exclude UMKM numbers and requester contacts. The FO supervision page shows counts and process time, not this download.

## 9. Decisions

All product questions are closed: P-20 (S4), P-23 (S1), P-24 (S6), P-27 (S5), P-28 (S3). "Serupa dengan yang Anda sukai" (S2) stays off and is not built: it needs a separate owner decision and a privacy policy change. After three months, review the weight 5:1, the 90-day window, retention, and whether public zero numbers discourage new UMKMs.

## 10. Revision notes

| Source | Changed sections |
|---|---|
| P-20, P-23, P-24, P-27, P-28 | 1, 2, 3, 6, 9 |
| P-29 to P-35 | 1, 2, 6, 8 |
| P-36 | Formula simplified to 5 x Likes + Views over 90 days; catalog visits, unique visitors, category scaling, half-lives, equal bands, completeness, extra sorts, like freeze, Need boost removed |
