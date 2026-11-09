# Hasil beban dan regresi UMKM tahap A

Tanggal: 9 November 2026. Data seluruhnya sintetis; angka berikut adalah hasil satu kali jalan,
bukan janji kapasitas. Mesin Linux x86_64, Intel Core i7-3770 3,40 GHz, 8 CPU terlihat, RAM 15 GiB,
Node.js v22.23.3. Proses lain berjalan di mesin yang sama; tidak ada isolasi beban atau pengulangan.

## PGlite lokal, pengukuran awal tabel kosong

Pengukuran awal memakai `node scripts/lokal-rantai/beban-umkm.mjs` versi sebelumnya. Setiap profil terbit dengan satu revisi,
kategori dan kota sama, tanpa foto, suka, atau kejadian telemetri. Skor dihitung sebelum pencarian;
pembersihan berjalan pada tabel retensi kosong. Waktu adalah durasi wall-clock satu panggilan.
Pencarian luas mengambil halaman pertama tanpa kata; selektif mencari UUID pada nama profil;
dalam adalah waktu panggilan halaman terakhir saat menelusuri seluruh katalog.

| Profil | Luas ms | Selektif ms | Dalam ms | Serupa ms | Job skor ms | Pembersihan ms |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.000 | 82,81 | 14,57 | 18,48 | 68,33 | 52,09 | 8,80 |
| 5.000 | 73,45 | 51,09 | 74,10 | 49,67 | 204,75 | 2,70 |
| 10.000 | 259,66 | 191,22 | 141,82 | 163,56 | 670,32 | 3,93 |

| Profil | Halaman | ID unik | Waktu telusur ms | Hasil |
| ---: | ---: | ---: | ---: | :--- |
| 1.000 | 50 | 1.000 | 1.108,41 | PASS |
| 5.000 | 250 | 5.000 | 21.031,74 | PASS |
| 10.000 | 500 | 10.000 | 79.913,27 | PASS |

Telusur dimulai dari hasil halaman pertama yang sudah diukur sehingga waktunya tidak mencakup
panggilan halaman pertama. Skenario memeriksa ukuran halaman, cursor berulang, dan ID ganda atau
hilang; seluruhnya 3 PASS, 0 FAIL. PGlite berjalan dalam proses, memakai stub Supabase dan cron,
tanpa jaringan atau konkurensi; hasilnya tidak mewakili latensi, throughput, kunci, penggunaan
memori, ukuran transfer, atau kapasitas PostgreSQL produksi. Pembersihan kosong bukan pengukuran
beban pemangkasan, dan job skor tanpa sinyal bukan representasi seluruh variasi data.

## PGlite lokal, pengukuran dengan data retensi

Perintah: `node scripts/lokal-rantai/beban-umkm.mjs`. Setiap profil memiliki 90 hari statistik,
satu suka aktif; separuh suka berada di luar jendela 90 hari. Sakelar telemetri aktif dan hasil
skor diperiksa terhadap 90 dilihat serta suka yang masih berlaku. Setiap ukuran memulai ulang data
sintetis statistik dan antrean; waktu di bawah adalah satu panggilan dalam proses yang sama.

| Profil | Suka dalam / luar 90 hari | Harian masuk | Skor ms | Retensi 1 ms | Retensi 2 ms | Retensi 3 ms |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: |
| 1.000 | 500 / 500 | 110.001 | 269,01 | 1.140,09 | 20,72 | 12,92 |
| 5.000 | 2.500 / 2.500 | 470.001 | 1.355,05 | 1.116,27 | 26,90 | 4,71 |
| 10.000 | 5.000 / 5.000 | 920.001 | 1.542,01 | 791,56 | 12,46 | 4,27 |

Pada setiap ukuran data masuk meliputi 501 pesan kedaluwarsa, 20.001 dedup kedaluwarsa,
20.001 harian kedaluwarsa, dan 20.004 baris tanpa hasil kedaluwarsa dari beberapa bulan.
Angka harian masuk pada tabel juga mencakup 90 hari yang dipertahankan untuk tiap profil.

| Putaran | Pesan terhapus / tersisa | Dedup terhapus / tersisa | Harian terhapus / tersisa | Tanpa hasil terhapus / tersisa | Jumlah bulanan |
| ---: | :--- | :--- | :--- | :--- | ---: |
| 1 | 500 / 1 | 20.000 / 1 | 20.000 / 90 × profil + 1 | 20.000 / 4 | 20.000 |
| 2 | 1 / 0 | 1 / 0 | 1 / 90 × profil | 4 / 0 | 20.004 |
| 3 | 0 / 0 | 0 / 0 | 0 / 90 × profil | 0 / 0 | 20.004 |

Hasil pengukuran: 3 PASS, 0 FAIL; katalog 10.000 profil ditelusuri dalam 500 halaman
dengan 10.000 ID unik. Putaran ketiga mengulang pekerjaan tanpa menggandakan ringkasan. Fixture tanpa hasil menyebar
lintas bulan dan memiliki pasangan tanggal dalam bulan yang sama; jumlah bulanan adalah jumlah
kejadian, bukan jumlah baris ringkasan. Pengukuran lokal ini bukan kapasitas produksi.

## Dua koneksi Postgres

Postgres 16 di kontainer sementara `lmh-umkm-uji`, port `127.0.0.1:32768`, dengan stub infrastruktur
dan rantai migrasi lokal, memakai data sintetis. Dua koneksi bersamaan mengirim putusan pada versi
yang sama: satu berhasil, satu `KONFLIK_VERSI` (PASS). Penjaga `jaga_laju` dengan 199 kejadian
sebelumnya menerima satu dari dua koneksi dan menolak satu dengan `TERLALU_BANYAK`; total 200 (PASS).
Kontainer dihapus setelah pengujian. Stub tidak membuktikan perilaku Auth, cron, R2, atau jaringan
produksi.

## Regresi

- `node scripts/lokal-rantai/skenario-umkm-a1.mjs`: 69 PASS, 0 FAIL.
- `node scripts/lokal-rantai/skenario-umkm-a2.mjs`: 16 PASS, 0 FAIL.
- `node scripts/lokal-rantai/skenario-umkm-a3.mjs`: 6 PASS, 0 FAIL; bukti merah awal tersimpan
  di `.scratch/umkm-fitur/qa-merah-g3.txt`.
- Vitest tujuh berkas marketplace lama: 7 berkas dan 90 tes lulus, 0 gagal, termasuk halaman,
  edit, RLS, foto, inquiry dan permintaan tautan edit.
- `git diff --name-only HEAD -- src/lib/umkm src/app/umkm src/app/api/umkm` dan pemeriksaan file
  belum terlacak pada jalur yang sama kosong. Ini membuktikan tidak ada perubahan lokal terhadap
  HEAD pada jalur lama, bukan perbandingan terhadap commit lain atau pengujian produksi.

Pemeriksaan staging yang tercantum di tiket 10 belum dijalankan dan tetap memerlukan persetujuan
pemilik. Pengukuran tidak mencakup tekanan bersamaan, lock wait, byte transfer, atau konkurensi pada data retensi
besar; hasil tidak boleh dipakai sebagai dasar janji kapasitas.
