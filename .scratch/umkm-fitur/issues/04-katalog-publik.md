# 04 katalog publik

Status: ready-for-agent
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

## Detail (PM, 2026-11-09)

Migration `202611090002_umkm_katalog.sql`. New files only; `202611090001` stays untouched.

**Search.** `umkm_cari_katalog` takes q, Type, Category, Specific, city, sort, cursor; anon and authenticated may call it. At most 20 cards plus an opaque `next_cursor`; filters and keyset run before LIMIT 21. Approved revision only. Card allowlist: id, name, Type, Category, Specific, city, short description, one cover photo.

- Sort in this wave: newest first publication, tie broken by id. Ticket 08 replaces it with the score through `create or replace`, so the cursor format stays private to the function and a bad cursor returns 400.
- q: trimmed, at most 100 characters, LIKE wildcards escaped, under 2 characters means no keyword. Trigram index on name and description, following the Fase 6 precedent.
- Filter options come from the database (distinct published Type, Category, city), bounded, callable by anon.
- `umkm_profil_publik` is replaced to include uploaded photos that have a public key.

**Cache.** Cards without a keyword and filter options only, 60 seconds, so random keywords cannot fill the cache; keyword searches read the database live. Entries are invalidated by tag from the decision, hide, restore, and emergency routes. A change that skips those routes expires within the 60 seconds. Detail stays live. No service-role read. Read `node_modules/next/dist/docs/` for the current cache API before choosing one.

**Pages.** `/umkm/katalog`: search, filters, cards, next page by cursor, zero-result exit opening the form with the keyword attached. `/umkm/katalog/[id]`: fields from K-A-01, photos through `FotoUmkm`, TikTok and Instagram as labeled links (new tab, noopener noreferrer, nothing rendered when absent), the Phase A text from `docs/umkm/ALUR-DAN-PERAN.md` section 8, "Hubungi lewat petugas", "Laporkan". Hidden or absent profile: a calm not-found page. Migration not applied: a calm unavailable message, never a 500. No link from the homepage or legacy `/umkm` in this wave; the owner decides that at release.

**Uploaded photo publication (K-A-11, K-C-04, security review item 7).**

- `umkm_foto` gains upload evidence (ETag and size) and a public key. The database refuses a public key when evidence is missing.
- The server reads evidence with a HEAD on the draft object and refuses a wrong type or size.
- After "Terbitkan" commits, the route copies draft to the public bucket with R2 CopyObject, conditional on the recorded ETag, under a new random key. No image bytes pass through Vercel. It then records the public key through an RPC.
- Failure leaves the profile published with the old snapshot or placeholder, tells the officer, and offers an idempotent retry. A decision never rolls back because R2 failed. Without R2 env the decision still works and photos stay placeholders.
- Hiding a photo or profile removes it from the public projection at once, then deletes the public copy best effort with a retry. The draft stays private, and restoring through review copies it again.

## Comments

2026-11-09: kode katalog publik dan perbaikan tinjauan selesai, gate lulus. Belum di-commit, menunggu persetujuan pemilik; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
