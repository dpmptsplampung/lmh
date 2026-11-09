# 04 katalog publik

Status: needs-triage
Wave: G2
Blocked by: 01

## What

Public catalog: umkm_cari_katalog, umkm_profil_publik, /umkm/katalog pages, 60-second cache of cards only, TikTok/Instagram links, zero-result exit.

## Requirements

K-A-01, K-A-02, K-A-04, K-A-23, K-A-19, K-NF-01

## Tests

U-01, U-09 (search and cursor part), U-11 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Also: uploaded photos stay in the closed `umkm-draf` R2 area through G1. This ticket adds how an approved upload becomes publicly visible (K-A-11, K-C-04), without moving image bytes through Vercel; a failed step keeps the old snapshot or placeholder and can be retried.

Also: store upload confirmation evidence (hash or ETag) on `umkm_foto` and refuse keys without it before any upload can go public (security review K7).

Detail is written when the wave starts.

## Comments
