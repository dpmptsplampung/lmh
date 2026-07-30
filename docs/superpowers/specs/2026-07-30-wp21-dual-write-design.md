# WP-21 — Backfill dan Dual Write Kunjungan

## Status

Disetujui pengguna pada 30 Juli 2026. Implementasi belum dimulai.

## Tujuan dan batasan

WP-21 memindahkan data historis `visit` ke model baru tanpa menghentikan
layanan atau menjadikan `visit` tidak dapat dipakai. Semua perubahan bersifat
aditif, diterapkan di luar jam layanan, dan dicatat sebelum/ketika dieksekusi
di `docs/analysis/DB-CHANGES.md`.

`visit` tetap menjadi sumber pembacaan dan sumber kebenaran selama transisi
sampai WP-24. Tidak ada tabel atau kolom lama yang dihapus.

Saat desain ini disetujui, produksi memiliki 28 baris `visit`, semuanya
bertujuan `loket`; `kunjungan` dan `tiket_antrean` masih kosong.

## Keputusan yang dikunci

- Tiket untuk **walk-in loket** diterbitkan pada saat check-in dibuat.
- Tiket untuk **reservasi loket** diterbitkan hanya ketika QR dipindai pada
  hari kedatangan, bukan ketika reservasi dibuat. Ini memenuhi QUE-04 dan
  mencegah nomor antrean hangus untuk warga yang tidak datang.
- Rekaman `buku_tamu` untuk tujuan `bertemu_seseorang` dibuat saat kedatangan
  fisik dikonfirmasi melalui scan, bukan saat reservasi dibuat.
- Penyelarasan dijalankan oleh trigger PostgreSQL atomik, bukan rangkaian
  operasi klien. Semua penulisan lama ke `visit` tetap aman selama masa
  transisi, termasuk bundle klien lama dan replay offline.

## Struktur tambahan

Migrasi M15 membuat `buku_tamu` sesuai model data, dengan penambahan
`legacy_visit_id uuid UNIQUE REFERENCES public.visit(id) ON DELETE RESTRICT`.

M16 menambah `kunjungan.legacy_visit_id uuid UNIQUE REFERENCES
public.visit(id) ON DELETE RESTRICT`. Kolom ini adalah tautan transisi dan
idempotency key; bukan pengganti ID baru `kunjungan`.

Kedua FK bersifat nullable agar struktur tetap aditif dan data yang kelak
dibuat langsung pada model baru tidak terhalang. Setiap baris yang berasal dari
`visit` wajib mengisinya.

M16 juga membuat ledger internal `wp21_backfill_ledger` dengan satu baris per
`visit` historis yang berhasil dimigrasikan dan referensi ke hasil
`kunjungan`, `tiket_antrean`, atau `buku_tamu`. Ledger ini membatasi rollback
ke data backfill yang tepat; data baru yang dibuat setelah trigger aktif tidak
boleh ikut terhapus.

## Alur data

### Backfill historis

1. Buat `buku_tamu` dan tautan transisi.
2. Backfill setiap `visit` historis bertujuan `loket` menjadi satu
   `kunjungan` yang tertaut dan satu `tiket_antrean` yang tertaut melalui
   kunjungan.
3. Salin identitas, asal, status, serta timestamp mulai/selesai bila tersedia.
   Tanggal walk-in dihitung dari waktu kedatangan dalam `Asia/Jakarta`; tanggal
   reservasi menggunakan `tanggal_rencana`, bukan waktu pembuatan reservasi.
4. Nomor historis ditetapkan deterministik dengan `ROW_NUMBER()` per
   `(layanan_id, tanggal)`, diurutkan oleh waktu kedatangan lalu ID. Nilai
   `antrean_counter.nomor_terakhir` dinaikkan ke maksimum hasil backfill agar
   tiket baru tidak berbenturan.
5. `INSERT ... ON CONFLICT (legacy_visit_id) DO NOTHING` membuat migrasi aman
   untuk dijalankan ulang tanpa menggandakan data.
6. Simpan referensi hasilnya ke `wp21_backfill_ledger` dalam transaksi yang
   sama.

### Penulisan dan perubahan setelah cutover

- INSERT `visit` walk-in loket membuat satu `kunjungan` dan memanggil
  `terbit_tiket()` dalam transaksi yang sama.
- INSERT `visit` reservasi loket membuat satu `kunjungan` berstatus
  `terjadwal`, tanpa tiket.
- UPDATE scan reservasi loket mengubah status/waktu pada `visit` dan
  `kunjungan`, lalu menerbitkan tepat satu tiket jika belum ada.
- UPDATE status antrean dari `visit` ke `dilayani`, `selesai`, `batal`,
  `tidak_terlayani`, atau `no_show` menyelaraskan tiket dan kunjungan yang
  tertaut, termasuk timestamp mulai/selesai bila tersedia.
- Scan reservasi bertujuan `bertemu_seseorang` membuat atau memperbarui satu
  `buku_tamu` yang tertaut. Tidak ada tiket antrean.
- Update loket yang semestinya punya kunjungan tetapi tidak menemukan tautan
  `legacy_visit_id` harus menggagalkan transaksi agar drift tidak disembunyikan.

Trigger memakai fungsi `SECURITY DEFINER` dengan `search_path` terkunci dan
input hanya dari baris `NEW`/`OLD` yang telah lolos constraint dan RLS `visit`.
Fungsi tidak menerima SQL atau nama tabel dari pemanggil.

## Invarian dan verifikasi

Sebelum trigger cutover, backfill historis harus membuktikan:

- `COUNT(visit) = COUNT(tiket_antrean) + COUNT(buku_tamu)` untuk snapshot
  historis yang menjadi sumber backfill.
- Setiap `visit` loket historis punya tepat satu `kunjungan` dengan
  `legacy_visit_id` yang sama dan tepat satu tiket.
- Tidak ada `kunjungan.legacy_visit_id` atau `buku_tamu.legacy_visit_id` yang
  tidak menunjuk ke `visit`.
- `antrean_counter.nomor_terakhir` tidak lebih kecil dari nomor tiket terbesar
  per layanan/tanggal.

Setelah trigger aktif, verifikasi berbasis kondisi menggantikan equality global:

- walk-in loket selalu memiliki satu kunjungan dan satu tiket;
- reservasi loket yang belum discan memiliki satu kunjungan dan nol tiket;
- reservasi loket yang sudah discan memiliki satu kunjungan dan satu tiket;
- reservasi bertemu yang sudah discan memiliki satu buku tamu;
- operasi ulang atau replay tidak menghasilkan baris atau tiket ganda.

## Pengembalian

Jika hasil backfill atau smoke test gagal, nonaktifkan trigger dual-write dan
jangan memindahkan pembacaan. Karena `visit` tidak disentuh, sistem lama tetap
berfungsi. Baris hasil backfill saja dapat dihapus dari
`wp21_backfill_ledger` dalam urutan aman (tiket, kunjungan, buku tamu), tanpa
menghapus data sumber atau data baru pasca-cutover. Nomor counter untuk tanggal
backfill dihitung ulang dari tiket yang tersisa.

## Di luar cakupan

- Mengubah halaman pembacaan dari `visit` ke `kunjungan`/`tiket_antrean`
  adalah WP-22.
- Menghentikan penulisan ke `visit` adalah WP-24 setelah stabil sedikitnya dua
  minggu dan persetujuan manusia.
- Tidak ada perubahan UI atau perubahan aturan penomoran di luar alur yang
  dijelaskan di atas.
