# Hasil pengukuran sesudah G2

- Tanggal: 2026-11-11 (WIB). Host: pooler Supabase `aws-1-ap-southeast-1` (produksi). Pengukuran read-only (`ROLLBACK`).
- Diterapkan atas persetujuan pemilik, atomik (`--atomic`, didahului `--dry-run`):
  - `202611110002_nav_lencana.sql` (fungsi `nav_lencana_saya`, `SECURITY INVOKER`)
  - `202611110003_umkm_cari_indeks.sql` (indeks trigram `umkm_katalog_spesifik`, `umkm_katalog_kategori`, `umkm_produk_nama_trgm`; `umkm_cari_katalog` ditulis ulang, hasil setara)
- Verifikasi: ketiga indeks ada; `nav_lencana_saya` dipanggil sebagai admin mengembalikan `{saran, antrian, liveChat, pengaduan, kotakMasukFo{semua,kembali}, penangananFo}`.

## `umkm_cari_katalog`, `Execution Time` hangat (ms), 6 kali ulang

| Varian | Sebelum (r2) | Sesudah (min-maks, 6 kali) |
|---|---|---|
| `p_q` = 'kopi' (4 huruf) | 103,7 | 20-21 (pertama 65 dingin) |
| `p_q` = 'bata' | n/a | 33-41 (pertama 109) |
| `p_q` = 'jasa' | n/a | 27-28 (pertama 77) |
| `p_jenis` = 'Produk' | 38,6 | 39,5 (tidak terpengaruh predikat q) |
| tanpa filter | 59,4 | 59,6-88 (tidak terpengaruh) |

Run tunggal blok 21 saat pengukuran ulang menampilkan 179,8 ms, tetapi enam kali ulang berikutnya stabil 20-21 ms: itu noise (cache/koneksi), bukan regresi.

## Kesimpulan

1. Pencarian dengan kata kunci turun kira-kira 5x (104 -> 20 ms hangat) pada 9.999 profil terbit.
2. Jalur tanpa filter dan dengan jenis saja tidak berubah (tidak memakai predikat q); mereka sudah ditutupi cache 60 detik di aplikasi (G1 1.9). Sisa biaya jalur itu ada di CTE `cocok` yang menghitung semua profil terbit: kandidat perbaikan berikutnya bila perlu.
3. `nav_lencana_saya` aktif; sidebar memakainya setelah deploy aplikasi (klien sudah punya jalur lama bila fungsi tidak ada).
