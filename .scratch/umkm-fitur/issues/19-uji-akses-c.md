# 19 uji akses tahap C

Status: ready-for-agent
Wave: G5
Blocked by: 16

## What

Local PGlite scenario for owner rights.

## Requirements

K-C-01, K-C-03, K-C-04, K-C-06, K-C-08, K-NF-04

## Tests

U-02 (owner part), U-10 (owner part), U-11 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Skrip `scripts/lokal-rantai/skenario-umkm-c1.mjs`. Wajib: login, email lama, dan HP saja tidak memberi hak; klaim belum disetujui tidak memberi hak; draf dan foto draf tidak tampil publik dan tidak terbuka untuk pemilik lain; versi terbit tetap sampai revisi disetujui; pencabutan pemilik langsung menutup baca nomor tahap B; pemilik X tidak melihat statistik atau penerima profil Y; daftar penerima tanpa data pemohon; FO tidak mendapat data pemilik. A1 sampai A3 dan B1 tetap lulus.

## Comments
