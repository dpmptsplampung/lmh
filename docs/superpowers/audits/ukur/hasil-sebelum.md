# Hasil pengukuran baseline (G0.4), sebelum perubahan

- Tanggal ukur: 2026-11-11 (WIB). Dijalankan PM atas persetujuan pemilik; semua blok `BEGIN READ ONLY`/`ROLLBACK`, tanpa tulis.
- Host: pooler Supabase `aws-1-ap-southeast-1` (Singapura), port 5432, db `postgres` (tanpa kredensial).
- Rentang: 7 hari = 2026-11-05..11-11; 30 hari = 2026-10-13..11-11; "366" = 365 hari (2025-11-11..2026-11-11).
- Run 1 = dingin, Run 2 = hangat. Angka = `Execution Time` (ms). Berkas mentah: scratchpad sesi (tidak di repo).

## Volume data (butir 4)

| Tabel | Baris |
|---|---|
| kunjungan | 720 |
| penanganan | 446 |
| tiket_antrean | 694 |
| umkm_profil (terbit) | 9.999 |
| umkm_produk | 10.000 |

Hasil nyata `rekap_data_pelayanan` (admin): 30 hari = 463 baris, 365 hari = 869 baris. Datanya kecil.

## Rekap (butir 1)

| Fungsi | 7 hari (r1/r2) | 30 hari (r1/r2) | 365 hari (r1/r2) |
|---|---|---|---|
| `rekap_data_pelayanan` p_hitung=false | 153,8 / 10,7 | 10,6 / 14,5 | 11,0 / 11,0 |
| `rekap_data_pelayanan` p_hitung=true | 13,9 / 13,8 | 15,2 / 14,8 | 16,5 / 16,8 |
| `p_tanpa_form=true`, 30 hari | | 13,5 / 13,4 | |
| satu layanan, 30 hari | | 14,0 / 14,0 | |
| `rekap_ringkasan_dilayani` | 20,4 / 6,5 | 7,9 / 8,0 | 9,6 / 12,1 |
| `rekap_harian_terpadu` | 6,9 / 3,7 | 5,6 / 5,8 | 8,2 / 8,1 |
| `rekap_kinerja_petugas` | 7,6 / 3,5 | 6,3 / 5,3 | 7,0 / 7,0 |

Rencana dalam `rekap_pelayanan_inti` (salinan tanpa predikat lingkup, butir 2): 7 hari 316/307, 30 hari 425/424, 365 hari 434/481. Salinan literal ini lebih lambat daripada RPC yang memanggilnya, jadi angkanya tidak mewakili RPC; dipakai hanya sebagai batas atas.

## UMKM (butir 3)

| Varian `umkm_cari_katalog` | r1 | r2 |
|---|---|---|
| tanpa filter | 745 | 59 |
| `p_jenis='Produk'` | 454 | 39 |
| `p_q` 4 huruf | 285 | 104 |

## pg_stat_statements (butir 4b) tersedia

Panggilan PostgREST ke RPC rekap/UMKM rata-rata 71-270 ms (277, 64, 205, 130, 113 panggilan); view `v_rekap_pelayanan_oss`/`perizinan` 18-25 ms; `rollup_rekap_harian` 38 ms.

## Kesimpulan (dikoreksi 2026-11-11)

1. Eksekusi SQL rekap di database CEPAT (4-17 ms hangat pada data sekarang).
2. KOREKSI: kesimpulan awal bahwa "lambat = jarak jaringan, region Vercel salah" TIDAK terbukti. Pemilik mengonfirmasi fungsi Vercel sudah di Singapura (`sin1`), jadi tidak ada jarak lintas benua. Dan angka `pg_stat_statements` (rata-rata 71-270 ms per panggilan) adalah waktu eksekusi SISI DATABASE, bukan waktu jaringan; saya salah menafsirkannya. Selisih antara 14 ms (`EXPLAIN` langsung) dan 71-270 ms (lewat PostgREST) belum dijelaskan: kandidat penyebab adalah pola panggilan PostgREST (peran/klaim JWT, RLS), beban bersamaan di CPU free tier, dan panggilan dingin.
3. Rantai 1 `auth.getUser` + 4-7 panggilan berurutan tetap memperbesar waktu total; G1 1.6 memangkasnya. Pengukuran yang menentukan: header `Server-Timing` (G0.2) dari browser pada produksi setelah deploy, per langkah.
4. UMKM: 9.999 profil terbit melewati ambang spec (> 2.000), jadi indeks trigram dikerjakan (lihat `hasil-sesudah-g2.md`).
5. Salinan `rekap_pelayanan_inti` literal (butir 2) tidak representatif; jangan dijadikan dasar keputusan.
