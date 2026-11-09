# 06 pengawasan fo darurat

Status: ready-for-agent
Wave: G2
Blocked by: 01, 05

## What

FO page /admin/umkm-pengawasan: counts, process time, redacted work trail. umkm_tindakan_darurat for FO and admin: temporary hide, hold flag, record revocation, short reason, no number, enters the officer list.

## Requirements

K-A-26, K-A-27, K-NF-05

## Tests

U-06 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Also: this ticket is the first place that sets `umkm_profil.mendesak`, and it must add a one-click way for an officer to finish that review without changing consent or content. Extend the open-work predicate in `umkm_akses_kontak_petugas` only if needed.

## Detail (PM, 2026-11-09)

Migration `202611090004_umkm_pengawasan_darurat.sql`.

**PM decision: no hold in Phase A.** K-A-26 holds a contact request, and requests only exist in Phase B (`umkm_permintaan_kontak`). A button with no effect would mislead, so `tahan_darurat` ships with that table in Phase B. Phase A emergency actions are hide and record revocation. The owner is told.

**FO page `/admin/umkm-pengawasan`** for `front_office` and admin, added to `src/lib/admin-nav.ts`. All RPCs are for active FO or admin only and never return a number, form or report contents, or draft text.

- `umkm_ringkasan_pengawasan`: profile counts per status, tasks open, urgent, messages `baru` and `ditangani`, reports open, average process time for review and first form reply. No target or deadline.
- `umkm_jejak_pengawasan(cursor)`: at most 20 rows of action, role, actor name, time, old and new status, reason, approved name only. Draft names may hold a number that has not been cleaned, so an unpublished profile shows a neutral label.
- `umkm_cari_pengawasan(q)`: finds a profile by approved name only, returns id, name, status, version.

**`umkm_tindakan_darurat`.** Profile, action (`sembunyikan`, `catat_pencabutan`), short reason, expected version, operation key. For FO and admin, with no reviewer flag needed and no duty check. The reason passes the contact check. Both actions set `mendesak`, write `umkm_riwayat` with role and reason, and enter the officer list. Hiding removes the profile from public view at once and triggers the ticket 04 invalidation and public copy deletion. Revocation writes `dicabut` on the current contact version without returning it; no contact on file returns a calm 409. Grants nothing else. A stale reviewer flag on an FO changes nothing.

**Officer finish.** `umkm_selesaikan_mendesak`: one click, clears `mendesak` with no change to consent or content, logged. Restoring a hidden profile still goes through review. The `umkm_akses_kontak_petugas` predicate stays as it is, because `mendesak` already lets the holder confirm a revocation.

## Comments

2026-11-09: kode pengawasan FO dan tindakan darurat serta perbaikan tinjauan selesai, gate lulus. Belum di-commit, menunggu persetujuan pemilik; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
