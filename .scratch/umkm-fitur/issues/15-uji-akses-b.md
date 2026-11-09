# 15 uji akses tahap B

Status: ready-for-human
Wave: G4
Blocked by: 11

## What

Local PGlite scenario that calls the Phase B RPCs directly with forged roles, UIDs, versions, and deleted accounts, plus one account with many requests.

## Requirements

K-B-08, K-B-12, K-B-17, K-NF-04, K-NF-13 (many requests part)

## Tests

U-03, U-04, U-05, U-06, U-07 (template), U-10 (outcome), U-12 (one account, many requests) in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Skrip `scripts/lokal-rantai/skenario-umkm-b1.mjs`, pola sama dengan `skenario-umkm-a2.mjs`. Uji hanya aturan di tiket 11 dan U-* di atas. Yang wajib ada:

- Tidak ada jalan ke `nomor_dibuka` tanpa petugas menekan Setujui, termasuk untuk perusahaan yang pernah disetujui.
- Setujui tanpa izin menjadi `menunggu_izin` dan tidak terbuka sendiri sesudah izin dicatat. Setujui sesudah pencabutan, saat profil disembunyikan, atau saat ditahan tidak membuka.
- Baca nomor: hanya pemohon asli dan sesi bukan anonim. Rekan satu perusahaan, akun lain, FO, admin, UID tebakan, dan akun terhapus ditolak. Pencabutan langsung menutup baca. Izin baru dan nomor pengganti tidak terbuka lewat pembukaan lama.
- Permintaan bantuan tidak bisa dibuka sebelum tertaut. Kode salah, kode dipakai ulang, dan kode milik permintaan lain gagal.
- Pasangan ulang mengembalikan permintaan yang ada; sesudah pencabutan, permintaan baru dibuat.
- Batal hanya sebelum `nomor_dibuka`. Dua petugas bersamaan: hanya satu keputusan menang. Ulang kunci operasi tidak menggandakan pembukaan atau hasil.
- FO dan admin tanpa penanda tidak mendapat nomor, isi Kebutuhan, data pemohon, atau kode lewat tabel, view, RPC, ringkasan, jejak, dan ekspor. Tahan darurat bisa oleh FO, lepas hanya petugas.
- Templat WhatsApp tidak punya parameter nomor UMKM (cukup dari test unit tiket 11; skenario tidak mengulangnya).
- Satu akun dengan 300 permintaan aktif berjalan tanpa batas bisnis.

Bukti merah sebelum migrasi ada ke `.scratch/umkm-fitur/qa-merah-g4.txt`.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G4 selesai, gate lulus, di-commit lokal. Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
