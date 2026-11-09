# UMKM feature: implementation spec (Phase A, B, and C)

Source of truth: `docs/umkm/` (`KEPUTUSAN-PEMILIK.md` = P-01..36, `KEBUTUHAN.md` = K-* requirements, `SISTEM.md`, `SISTEM-STATISTIK.md`, `MIGRASI-RILIS-UJI.md` = U-* tests, `ALUR-DAN-PERAN.md`). Read only the parts a ticket names. If code and docs disagree, raise it; do not invent a rule. P-36: keep it simple. A rule stays only if the owner decided it, it stops a number leak or legal breach, or the system does it silently.

## Scope

Phase A: reviewed public catalog, short contact form, likes, officer task list, FO supervision. **No UMKM number reaches a company, visitor, or FO in Phase A** (K-A-25).

Phase B (added 2026-11-09, owner: finish all three phases): companies with individual accounts, Needs, contact requests, one "Setujui" that checks consent and opens the number only in the requester's account. **The number reaches only the original requester's account, never FO, chat, cache, logs, or notifications** (K-B-12). Phase B becomes active when its migration is applied; before that every page behaves as Phase A.

Phase C (wave G5, tickets 16 to 19): verified UMKM owners register, claim, edit through private drafts, see own statistics and receiving company names, and revoke their own number consent. **An account becomes an owner only after an officer confirms it** (K-C-03). Owners revoke consent but never grant number access to anyone.

## Tickets

| Wave | Ticket | Package |
|---|---|---|
| G1 | 01 DB core, 02 officer API and screen, 03 access tests | M-A1 |
| G2 | 04 public catalog, 05 form and reports, 06 FO supervision and urgent actions, 07 privacy policy | M-A2 |
| G3 | 08 likes, score, recommendations; 09 optional telemetry, report, cleanup; 10 load and regression | M-A3 |
| G4 | 11 DB and API for requests, 12 company screens, 13 officer, FO and report screens, 14 privacy text B, 15 access tests B | M-B |
| G5 | 16 DB and API for owners, 17 owner screens, 18 officer claim screen, 19 access tests C | M-C |

## Fixed naming

- Migrations: `supabase/migrations/20261109NNNN_umkm_*.sql`, later wave = later timestamp. Each has an adjacent `*.test.ts` static contract test and a rollback document following `docs/ATURAN_MIGRASI.md`.
- Tables and RPCs: names in `docs/umkm/SISTEM.md` sections 3 and 7.
- Public pages: `/umkm/katalog`, `/umkm/katalog/[id]`. Officer page: `/admin/umkm-tugas`. FO page: `/admin/umkm-pengawasan`.
- APIs: `src/app/api/umkm-katalog/**` (public), `src/app/api/admin/umkm-tugas/**` (staff).
- Shared code: `src/lib/umkm-katalog/**`, `src/components/umkm-katalog/**`, `src/components/admin/umkm-tugas/**`. Do not change legacy `src/lib/umkm/**` behavior; importing `foto-url.ts` and `FotoUmkm` is fine.
- Reviewer flag: `petugas.pemeriksa_umkm`, set by admin, mirroring how `petugas.koordinator` works. A `front_office` account is never an officer, even with the flag.

## Rules for every worker

- Next.js 16 has breaking changes: read the relevant guide in `node_modules/next/dist/docs/` before writing Next.js code.
- Dates through `src/lib/time.ts` (WIB). Baseline migrations are immutable; never edit or rename an existing migration. CSP lives in `next.config.ts`. PII output through `lib/pii.ts` and `lib/csv.ts`.
- Code map: `CLAUDE.md` sections Arsitektur, Peta file, Peta database. Terms: `GLOSSARY.md`.
- Permissions are enforced in the database, not only in the route or menu (K-NF-04). No raw number in audit, logs, cache, or error messages. No service-role fallback for public reads.
- Tests: `npx vitest run --pool=vmForks <file>`. Local Postgres behavior: `node scripts/lokal-rantai/<scenario>.mjs` (in-process PGlite, safe).
- **Forbidden:** `git push`, commits, any remote GitHub change, reading or printing `.env*`, credentials, or backups, and `node scripts/apply-migration.mjs`, `npm run test:rls`, `scripts/selftest-wp*.mjs`, `scripts/verify-wp*.mjs` (they reach production).
- **No tool attribution anywhere:** no credit, trailer, footer, watermark, or mention of any AI tool or vendor in code, comments, docs, or generated files.
- UI text and code comments in plain Indonesian, no em dash. Technical docs may be English.
- One file, one writer. Ask the owner of a file for changes; do not edit it yourself.
