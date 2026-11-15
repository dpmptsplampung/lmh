# Pengukuran baseline (G0.1)

`baseline.sql` berisi pengukuran BACA SAJA untuk SPEC refaktor arsitektur UI §10 butir 1-4. Tiap blok `BEGIN ... ROLLBACK`; tidak ada pernyataan yang menulis data dan tidak ada kredensial. `EXPLAIN (ANALYZE, BUFFERS)` memang menjalankan query, tetapi semua RPC yang diukur `STABLE`.

## Placeholder yang harus diisi PM

| Placeholder | Isi |
|---|---|
| `<UID_ADMIN>` | `auth.users.id` satu akun admin aktif (bukan `petugas.id`). Tanpa ini RPC rekap kosong. |
| `<SAMPAI>` | tanggal akhir `YYYY-MM-DD` (mis. hari ini WIB) |
| `<DARI_7>`, `<DARI_30>`, `<DARI_366>` | `<SAMPAI>` dikurangi 6, 29, 365 hari (selisih >= 366 ditolak RPC) |
| `<LAYANAN_ID>` | uuid satu Layanan ramai (hanya blok 1a'') |
| `<JENIS_UMKM>` | nilai `umkm_revisi.jenis` yang nyata (blok 3b) |
| `<DARI_x>` | hanya blok 2: pilih salah satu `<DARI_*>`; jalankan tiga kali |

## Cara menjalankan

1. Tampilkan host tujuan (tanpa password) dan minta persetujuan pemilik. Hanya PM yang menjalankan, bukan worker.
2. Isi placeholder (salinan sementara, jangan commit nilai UID).
3. Jalankan per blok lewat `psql` atau SQL editor yang tidak mengotomatiskan commit lain. Contoh: `psql "$DATABASE_URL" -f baseline.sql > hasil-mentah.txt`.
4. Blok 4b butuh `pg_stat_statements`; bila galat, catat "tidak tersedia".
5. Jalankan sekali dua kali untuk memanaskan cache; catat run kedua dan pertama.

## Isi

1. `rekap_data_pelayanan` (7/30/366 hari, `p_hitung` false/true, `p_tanpa_form`, satu layanan), `rekap_ringkasan_dilayani`, `rekap_harian_terpadu`, `rekap_kinerja_petugas`.
2. Dua cabang SELECT `rekap_pelayanan_inti` (salinan literal dari `202611040001`, tanpa predikat lingkup) untuk melihat rencana dalam.
3. `umkm_cari_katalog` tanpa filter, dengan `p_jenis`, dengan `p_q` 4 huruf.
4. Jumlah baris `kunjungan`, `penanganan`, `tiket_antrean`, `umkm_profil` terbit, `umkm_produk`; `pg_stat_statements`.

## Format hasil (`hasil-sebelum.md`)

Satu tabel per butir:

| Blok | Rentang | Execution Time (ms) | Planning Time (ms) | Buffers (hit/read) | Node termahal | Catatan |
|---|---|---|---|---|---|---|

Sertakan tanggal ukur, host (tanpa kredensial), dan jumlah baris butir 4 di bagian atas. Tempel potongan plan hanya untuk node dengan Seq Scan besar atau `Rows Removed by Filter` tinggi.
