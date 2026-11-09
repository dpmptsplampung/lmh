# 06 pengawasan fo darurat

Status: needs-triage
Wave: G2
Blocked by: 01, 05

## What

FO page /admin/umkm-pengawasan: counts, process time, redacted work trail. umkm_tindakan_darurat for FO and admin: temporary hide, hold flag, record revocation, short reason, no number, enters the officer list.

## Requirements

K-A-26, K-A-27, K-NF-05

## Tests

U-06 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Also: this ticket is the first place that sets `umkm_profil.mendesak`, and it must add a one-click way for an officer to finish that review without changing consent or content. Extend the open-work predicate in `umkm_akses_kontak_petugas` only if needed.

Detail is written when the wave starts.

## Comments
