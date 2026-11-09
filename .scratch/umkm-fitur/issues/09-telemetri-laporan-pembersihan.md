# 09 telemetri laporan pembersihan

Status: needs-triage
Wave: G3
Blocked by: 08, 07

## What

One optional switch, default off: Views, zero-result groups, form-open clicks. Report for officers and admin with download. Bounded retention jobs.

## Requirements

K-SA-01, K-SA-05, K-SA-08

## Tests

U-08, U-10, U-12 (retention part) in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Detail is written when the wave starts.

Also from G2 (security review finding 2): **release blocker for the contact form.** The cleanup covers contact form and report content after 180 days, `umkm_private.operasi_publik` retry keys, and draft photos in R2 after 30 days from cancellation or 90 inactive days. Cancelled means the revision was rejected or the photo was taken out of the form; there is no separate status. The privacy page states these periods, so they must be running before the form opens to the public.

## Comments
