# 07 kebijakan privasi

Status: ready-for-agent
Wave: G2
Blocked by: none

## What

Update docs/KEBIJAKAN_PDP.md and /kebijakan-privasi for Phase A: contact form, recorded statistics, retention, officers' personal WhatsApp. Must merge before ticket 05 opens the form. Draft text for owner review; state plainly that DPO review is advised.

## Requirements

K-NF-11

## Tests

U-08 (notice part) in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Update `docs/KEBIJAKAN_PDP.md` and `src/app/kebijakan-privasi/page.tsx`. Plain Indonesian for the public page. State only what the system does in Phase A. Cover:

- Catalog: UMKM profiles come from curated data, satudata, and counter guests. The public page never shows number, email, detailed address, or owner name.
- Contact form: name, company, contact number, message, attached profile or keyword. Purpose: an officer replies. Retention [INITIAL]: 180 days after handling or last activity.
- Reports: reason and optional note, same purpose and handling.
- Officers' personal WhatsApp: officers reply from their own phones. Those chats sit outside LMH, LMH cannot erase them, and a departing officer is asked to delete work chats, which cannot be proven. Say this plainly.
- UMKM contact held by officers for asking permission: read only by the officer handling the task, logged. Phase A shares no UMKM number with anyone.
- Statistics (Views, zero-result counts without search words, form-open clicks, Likes): recorded only once the switch is on, on a notice basis, with no cookie for advertising. The switch stays off until this text is published.
- Draft photo retention: 30 days after cancellation or 90 inactive days.

The doc's version section states that DPO review is advised before the form opens. Check how the policy version is used in code before bumping it; if a bump forces visitors to consent again, raise it with the PM instead of changing it.

The owner reads the text before release. The form does not open before this text is live.

## Comments

2026-11-09: teks privasi bagian 6 dan `docs/KEBIJAKAN_PDP.md` diperbarui sesuai tinjauan, test lulus. Teks perlu dibaca pemilik, dan tinjauan DPO disarankan. Belum di-commit, menunggu persetujuan pemilik; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
