# 10 beban dan regresi

Status: needs-triage
Wave: G3
Blocked by: 08, 09

## What

Load check with 1,000, 5,000, and 10,000 synthetic profiles. Legacy marketplace regression. Measured numbers, not promises.

## Requirements

K-A-19, K-NF-01, K-NF-13

## Tests

U-11, U-12 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Also: real two-connection test of concurrent decisions (moved from ticket 03), on a throwaway local container or staging.

Detail is written when the wave starts.

Also from G2, staging only: R2 cross-bucket CopyObject, CopySourceIfMatch with quoted ETag, the DeleteObjects `Errors` shape, token rights, edge cache after delete; `revalidateTag` across instances; Auth anonymous sign-in limit per IP, which sets the cost of a form flood; advisory lock in `jaga_laju` on two real connections.

## Comments
