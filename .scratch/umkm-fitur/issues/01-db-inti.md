# 01 DB core: profiles, revisions, photos, contact, consent, history, officer RPCs

Status: ready-for-agent
Wave: G1
Blocked by: none

## What

New tables, RLS, and RPCs for officer work in Phase A. Read `docs/umkm/SISTEM.md` sections 3 to 8 and `docs/umkm/ALUR-DAN-PERAN.md`.

Tables: `umkm_profil`, `umkm_revisi`, `umkm_foto`, `umkm_kontak_versi`, `umkm_izin`, `umkm_riwayat`; column `petugas.pemeriksa_umkm`.

RPCs: `umkm_simpan_profil` (add or correct; creates a private revision), `umkm_daftar_tugas`, `umkm_ambil_tugas`, `umkm_putuskan_profil`, `umkm_ubah_visibilitas` (hide or restore a profile or one photo), `umkm_akses_kontak_petugas`, `umkm_ubah_izin`, and the admin action that sets the reviewer flag.

## Requirements

K-A-07, K-A-08, K-A-10, K-A-11, K-A-14, K-A-16, K-A-23, K-A-25, K-NF-04, K-NF-05. Part of K-A-04: a number or contact in name, description, address, or photo URL returns a warning and blocks "Terbitkan" until cleaned, checked in the database function.

## Must hold

- Exactly four profile statuses: `diajukan`, `terbit`, `disembunyikan`, `ditolak`. A corrected published profile keeps its approved revision visible until the new one is approved. Restoring goes through review.
- No anon or authenticated direct read of base tables holding private data. `umkm_kontak_versi` is reachable only through `umkm_akses_kontak_petugas`, which returns one contact to an active reviewer holding that task, logged automatically, and never to FO, admin without the flag, or an officer not handling it.
- A contact number change voids current consent. Consent history is never deleted.
- Direct writes to status, decision, and actor columns are revoked; RPCs derive the actor from the session. Definer functions use a locked `search_path` and no PUBLIC EXECUTE.
- Takeover: "sedang dipegang [nama]" has no timer; another officer takes over in one click, logged. Decisions use expected version plus a short row lock so concurrent reviewers cannot both win.
- Mutations are idempotent by a UUID operation key: same key returns the original result, same key with a different body conflicts. No PII stored in retry data.
- `umkm_daftar_tugas`: urgent first, then oldest; at most 20 per call. Build it so tickets 05 and 06 can add form messages, reports, and urgent items with a later `create or replace`.
- `umkm_riwayat` records actor, role, time, object, old and new status, short reason. Never a raw number.
- Adding a new R2 area for UMKM photo drafts is allowed in `src/lib/storage/area.ts`; drafts have no public address. Satudata photos stay as links. Nothing new goes to Supabase Storage.

## Deliver

Forward migrations and adjacent contract tests, rollback document, `docs/MIGRATIONS.md` entry, new section in `docs/analysis/04-RBAC-MATRIX.md`, zod schemas and typed RPC wrappers in `src/lib/umkm-katalog/`. Write the API contract for ticket 02 to `.tim/umkm-fitur/KONTRAK.md` before product code, and send it as a `PROPOSAL`.

## Comments

2026-11-09: perbaikan tinjauan selesai dan gate lulus; di-commit di `16f1795`, belum di-push, migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
