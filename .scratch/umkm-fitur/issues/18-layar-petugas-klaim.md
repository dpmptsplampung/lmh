# 18 layar petugas klaim

Status: ready-for-human
Wave: G5
Blocked by: 16 (contract)

## What

Officer task list shows self-registered profiles with their owner, owner revisions, and claims; one-screen decisions.

## Requirements

K-C-01, K-C-03 (officer side)

## Tests

Screen tests: claim approve and reject in at most two clicks; registrant data shown only to officers.

## Detail (PM, 2026-11-09)

Kontrak backend tiket 16 mengikat. Profil mandiri dan revisi pemilik memakai layar tinjauan profil yang sudah ada, ditambah keterangan pemilik (nama akun, HP, email dari profil pengunjung). Klaim: profil, akun pengklaim, alasan, tombol Setujui dan Tolak dengan alasan singkat. FO tetap hanya hitungan.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G5 selesai, gate lulus, di-commit lokal. Perbaikan tambahan dari tinjauan ada di `.tim/umkm-fitur/PERBAIKAN-G5.md` (antara lain Cabut kepemilikan oleh petugas). Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
