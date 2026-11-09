# 03 Access and behavior tests for G1

Status: ready-for-agent
Wave: G1
Blocked by: 01 migrations

## What

A local behavior scenario on real SQL: `scripts/lokal-rantai/skenario-umkm-a1.mjs`, following the existing scenarios and `scripts/lokal-rantai/README.md`. Run all migrations in PGlite, then call tables and RPCs directly with forged roles and UIDs. Do not rely on mocks or menus. Read `docs/umkm/MIGRASI-RILIS-UJI.md` section 5.

## Coverage

From U-01, U-02, U-03, U-04 (consent part), U-06, plus K-A-25. Fixtures: no session, anon Auth, ordinary logged-in visitor, reviewers A and B, disabled officer, officer without the flag, FO with and without the flag, admin with and without the flag.

Must prove at least:

1. Draft, rejected, and hidden profiles and all contact columns are unreachable through direct table reads for anon, visitor, and FO.
2. No role except the reviewer holding the task gets a number from any table, view, or RPC. FO with a forged flag gets nothing.
3. Two reviewers deciding from the same version, in sequence: exactly one wins; the other gets a version conflict. Takeover is logged. The static contract test checks the row lock comes before the version comparison. A real two-connection test is not claimed here; it moved to ticket 10.
4. A synthetic number in name, description, address, or photo URL blocks "Terbitkan".
5. Retry with the same operation key returns the original result and writes no second history row; same key with a different body conflicts.
6. A contact number change voids consent. History rows stay.
7. Published revision stays visible while a correction is under review. Restoring a hidden profile goes through review.
8. `umkm_riwayat` and audit contain no raw number.
9. Legacy tables and policies for `listing_umkm` are unchanged by the migrations.

Report each as PASS or FAIL with the command output. A failing check is a finding for the backend worker, not something to work around. If the scenario finds a defect, tell backend directly with the exact RPC call and result.

## Comments

2026-11-09: perbaikan tinjauan selesai dan gate lulus; di-commit di `16f1795`, belum di-push, migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
