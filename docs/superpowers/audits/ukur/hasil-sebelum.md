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

## Kesimpulan

1. Di sisi database rekap CEPAT (4-17 ms hangat pada data sekarang). Lambatnya halaman rekap bukan dari eksekusi SQL, melainkan dari rantai request (1 `auth.getUser` + 4-7 panggilan berurutan) dan jarak jaringan. Rata-rata nyata per panggilan 71-270 ms menunjukkan biaya per round-trip, bukan komputasi.
2. `vercel.json` berisi `{}` (tidak ada `regions`). Bila fungsi Vercel berjalan di region bawaan (AS timur) sementara Supabase di Singapura, setiap panggilan DB membayar ratusan ms. Region fungsi aktual HARUS dicek pemilik di dasbor Vercel (Project Settings > Functions). Menetapkan region Singapura (`sin1`) adalah kemenangan murah baru untuk G1.
3. Memparalelkan route rekap (G2) tetap berguna karena memotong jumlah round-trip, tetapi menulis ulang `rekap_pelayanan_inti` jadi satu lintasan (migrasi `202611110001`) hampir tidak menghemat waktu DB pada volume ini: turunkan prioritasnya, jangan dipaksakan.
4. UMKM: 9.999 profil terbit melewati ambang spec (> 2.000 profil) dan kueri dingin 285-745 ms melewati ambang 150 ms, jadi tugas bersyarat indeks trigram `umkm_cari_katalog` DIJALANKAN. Halaman hangat 39-104 ms.
5. Salinan `rekap_pelayanan_inti` literal (butir 2) tidak representatif; jangan dijadikan dasar keputusan.
