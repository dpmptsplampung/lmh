# 02 Officer API and work screen

Status: ready-for-agent
Wave: G1
Blocked by: 01 contract (`.tim/umkm-fitur/KONTRAK.md`)

## What

Route handlers under `src/app/api/admin/umkm-tugas/**` (owner: backend) and the page `/admin/umkm-tugas` (owner: frontend), reachable only with the reviewer flag. Read `docs/umkm/ALUR-DAN-PERAN.md` section 5 and the flowchart section "Kerja petugas".

## Requirements

K-A-07, K-A-08, K-A-10, K-A-11, K-A-14, K-A-16, K-A-23.

## Must hold

- One ordered task list; one review screen; at most two clicks per decision. Buttons: "Terbitkan", "Tolak" with one short reason. No other required field.
- Label "sedang dipegang [nama]" and one-click "Ambil alih". No timer anywhere.
- Add profile form: curated data, satudata, or counter guest. NIB is an optional yes/no and never blocks. A profile without a WhatsApp number shows a flag, not a block.
- Contact warning from the database shows next to the offending field and blocks "Terbitkan" until cleaned.
- Photo: https link (reuse `src/lib/umkm/foto-url.ts` rules) or upload to the private R2 draft area (reuse `src/lib/storage/unggah.ts` and `src/lib/foto/kompres.ts`). Changing a photo returns the profile to review.
- TikTok and Instagram: optional, https on those two domains only, blank becomes null.
- "Lihat nomor" reveals one number for the task in hand, not cached, not stored in the browser, and not kept in React state after leaving the task. Consent: one click to record `diberikan` or `dicabut`, plus a copyable WhatsApp message template asking for consent.
- Hide or restore a profile or one photo.
- Navigation: entry in `src/lib/admin-nav.ts` shown only to accounts with the flag, following how the Koordinator flag is checked. The admin can set the flag at `/admin/petugas`.
- Route handlers: `force-dynamic`, zod validation, RPC with the user's JWT, no service role, `no-store`. Error shape and codes per `docs/umkm/SISTEM.md` section 7. Each route has an adjacent test.
- Look: follow the current admin design (`src/styles/globals.css` tokens, existing `*.module.css`), usable at phone width, keyboard accessible. If the migration is not applied yet, the page shows a calm unavailable message and never a 500.

## Comments

2026-11-09: perbaikan tinjauan selesai dan gate lulus; di-commit di `16f1795`, belum di-push, migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
