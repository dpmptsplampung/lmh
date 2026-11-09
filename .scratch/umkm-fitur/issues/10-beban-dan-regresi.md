# 10 beban dan regresi

Status: ready-for-human
Wave: G3
Blocked by: 08, 09

## What

Load check with 1,000, 5,000, and 10,000 synthetic profiles. Legacy marketplace regression. Measured numbers, not promises.

## Requirements

K-A-19, K-NF-01, K-NF-13

## Tests

U-11, U-12 in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Also: real two-connection test of concurrent decisions (moved from ticket 03), on a throwaway local container or staging.

Also from G2, staging only: R2 cross-bucket CopyObject, CopySourceIfMatch with quoted ETag, the DeleteObjects `Errors` shape, token rights, edge cache after delete; `revalidateTag` across instances; Auth anonymous sign-in limit per IP, which sets the cost of a form flood; advisory lock in `jaga_laju` on two real connections.

## Detail (PM, 2026-11-09)

Bagian lokal dikerjakan gelombang ini. Bagian staging tetap terbuka dan butuh persetujuan pemilik.

**Lokal**
- `scripts/lokal-rantai/skenario-umkm-a3.mjs`: U-08, U-09, U-10 bagian tahap A, dan U-12 bagian retensi.
- `scripts/lokal-rantai/beban-umkm.mjs`: 1.000, 5.000, dan 10.000 profil sintetis. Ukur pencarian luas, dalam, dan selektif, `umkm_serupa`, job skor, job pembersihan, serta telusur seluruh 10.000 profil per 20 tanpa id hilang atau ganda. Catat angka apa adanya.
- Uji dua koneksi pada Postgres sungguhan: kontainer Docker sementara buatan sendiri, port hanya `127.0.0.1`, dihapus sesudahnya. Jangan menyentuh kontainer lain yang sedang berjalan di server ini. Cakup keputusan serentak (dari tiket 03) dan kunci `jaga_laju`. Bila rantai migrasi tidak bisa berjalan di sana, laporkan batasnya.
- K-A-19: tunjukkan `src/lib/umkm/**`, `/umkm`, `/umkm/inbox`, `/umkm/edit/[id]`, dan API lamanya tidak berubah, dan test lamanya lulus.
- Hasil ditulis ke `docs/umkm/HASIL-BEBAN-TAHAP-A.md`: angka, mesin, batasannya. PGlite bukan angka produksi, dan tidak ada janji kapasitas.

**Staging (butuh persetujuan, belum dikerjakan)**
Daftar di bagian "Also from G2" di atas, ditambah penjadwal `bersihkan-draf` dan hak `ListObjects` pada token R2.

## Comments

2026-11-09: bagian lokal selesai: `docs/umkm/HASIL-BEBAN-TAHAP-A.md`. Bagian staging belum dikerjakan dan butuh persetujuan pemilik. Belum di-commit; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
