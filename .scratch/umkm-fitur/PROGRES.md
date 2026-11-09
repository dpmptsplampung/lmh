# Progres implementasi UMKM

Diperbarui 2026-11-09. Pengganti catatan pukul 12.15 WIB saat worker berhenti karena limit.

## Keadaan repo

- Branch `feat/umkm`. Kode G1 ada di commit `16f1795`, perbaikan uji kalender di `205ed4e`. Dokumen rencana di `91f4888`. Kode G2 ada di commit `9469df2`. Kode G3 masih di working tree.
- **Belum ada push**, jadi commit ini hanya ada di mesin ini.
- Migrasi `202611090001` sampai `0007` belum diterapkan ke database mana pun, termasuk staging.
- Worker: semua sudah dilepas. Run Orca G1: `run_f7c5c7375d19`, transkrip worker yang dihentikan: `.tim/umkm-fitur/transkrip-g1/`. Run Orca G2: `run_8d70cd1fda1b`. Run Orca G3: `run_2f77f9b64789`.

## Gelombang G3 (tiket 08, 09, 10)

**Kode selesai dan lulus gate, belum di-commit.** Menunggu persetujuan pemilik. Migrasi `202611090005`, `0006`, `0007` belum diterapkan ke database mana pun. Sakelar statistik bawaannya mati.

Kontrak: `.tim/umkm-fitur/KONTRAK-G3.md`. Tinjauan: `.tim/umkm-fitur/TINJAUAN-G3-KEAMANAN.md` (0 kritis, 0 tinggi, 2 sedang, 4 rendah) dan `TINJAUAN-G3-KODE.md` (1 tinggi, 3 sedang, 1 rendah), diperbaiki sesuai `.tim/umkm-fitur/PERBAIKAN-G3.md`. Bukti merah: `.scratch/umkm-fitur/qa-merah-g3.txt`. Hasil beban: `docs/umkm/HASIL-BEBAN-TAHAP-A.md`.

Keputusan PM yang disampaikan ke pemilik:

- Satu-satunya urutan katalog `paling_sesuai`. `terbaru` dihapus.
- Laporan memuat angka per UMKM, karena itu yang diminta pemilik.
- Tab yang terbuka sebelum sakelar dimatikan boleh mengirim satu beacon. Database menolaknya tanpa baris dan tanpa cookie.
- Dilihat bisa digelembungkan skrip saat sakelar aktif. Jalan keluarnya admin mematikan sakelar.
- Salinan draf foto hanya dilindungi selama revisinya tayang. Foto revisi lama yang sudah tidak dipakai ikut dibersihkan.

### Hasil gate terakhir G3

| Uji | Hasil |
|---|---|
| `npx eslint . --max-warnings=0 --ignore-pattern '.tim/**'` | lulus |
| `npm run typecheck` | lulus |
| `npm run build` | lulus |
| `npm test` | 6392 lulus, 0 gagal, 6 dilewati |
| `node scripts/lokal-rantai/skenario-umkm-a1.mjs` | 69 PASS, 0 FAIL |
| `node scripts/lokal-rantai/skenario-umkm-a2.mjs` | 16 PASS, 0 FAIL |
| `node scripts/lokal-rantai/skenario-umkm-a3.mjs` | 6 PASS, 0 FAIL |
| `node scripts/lokal-rantai/beban-umkm.mjs` | exit 0 |
| Manifest migrasi | cocok, 115 berkas |

### Yang belum terbukti G3

Butuh staging, lihat tiket 10: hak nyata Supabase, Auth dan penghapusan akun, `pg_cron`, penjadwal `bersihkan-draf`, R2 sungguhan termasuk `ListObjects` dan `StartAfter`, `revalidateTag` lintas instance, dan Excel wilayah Indonesia.

## Langkah rilis tahap A (semua butuh persetujuan pemilik)

1. Pemilik membaca teks privasi bagian 6. Tinjauan DPO disarankan.
2. Terapkan migrasi `0001` sampai `0007` ke staging, lalu jalankan pemeriksaan staging tiket 10.
3. Pasang penjadwal `POST /api/umkm-katalog/bersihkan-draf` sesuai `docs/DEPLOY_RUNBOOK.md`.
4. Terapkan ke produksi lewat prosedur resmi, dengan host dan daftar migrasi ditampilkan lebih dulu.
5. Pembersihan harus berjalan sebelum formulir dibuka untuk publik. Sakelar statistik dinyalakan terpisah sesudah kebijakan terbit.

## Gelombang G2 (tiket 04, 05, 06, 07)

**Di-commit di `9469df2` atas persetujuan pemilik, belum di-push.** Migrasi `202611090002`, `0003`, `0004` belum diterapkan ke database mana pun.

Dikerjakan worker (run `run_8d70cd1fda1b`), ditinjau dua kali (`.tim/umkm-fitur/TINJAUAN-G2-KEAMANAN.md`, `TINJAUAN-G2-KODE.md`), lalu diperbaiki sesuai `.tim/umkm-fitur/PERBAIKAN-G2.md` dan `PERBAIKAN-G2-RINCI.md`. Catatan per butir: `.tim/umkm-fitur/PROGRES-PERBAIKAN-G2-{backend,frontend}.md`. Bukti merah sebelum perbaikan: `.scratch/umkm-fitur/qa-merah-g2-perbaikan.txt`.

Keputusan PM yang perlu disampaikan ke pemilik:

- Tahap A tidak punya penahanan darurat karena permintaan baru ada di tahap B.
- Formulir memakai pemberitahuan tanpa kotak centang. Disarankan ditinjau DPO.
- `Laporkan` hanya ada di halaman detail profil. Laporan `nomor_tampil` ikut mendesak.
- Belum ada tautan ke katalog dari homepage atau halaman lama sampai pemilik memutuskan saat rilis.
- Laporan kembar memakai satu baris. Catatan pelapor berikutnya tidak disimpan.
- Pembersihan otomatis (tiket 09) harus berjalan sebelum formulir dibuka. Ini penghalang rilis.

### Hasil gate terakhir G2

| Uji | Hasil |
|---|---|
| `npx eslint . --max-warnings=0 --ignore-pattern '.tim/**'` | lulus |
| `npm run typecheck` | lulus |
| `npm run build` | lulus |
| `npm test` | 6304 lulus, 0 gagal, 6 dilewati |
| `node scripts/lokal-rantai/skenario-umkm-a1.mjs` | 69 PASS, 0 FAIL |
| `node scripts/lokal-rantai/skenario-umkm-a2.mjs` | 16 PASS, 0 FAIL |
| Manifest migrasi | cocok, 112 berkas; 109 hash lama identik |

### Catatan gate

- Skrip dokumentasi worker sempat menimpa `docs/analysis/DB-CHANGES.md` dengan isi matriks hak akses. Tertangkap oleh gate penuh PM, bukan oleh test sempit worker. Dipulihkan dari HEAD ditambah dua entri G2; selisih terhadap HEAD kini 43 baris tambahan, 0 baris terhapus.
- `src/app/api/me/profil/profil.test.ts` sempat gagal sekali-sekali pada putaran penuh. Penyebab terbukti saat G3: env dari berkas uji lain terbawa di worker yang sama, sehingga jalur email mencoba jaringan sampai habis waktu 5 detik. Diperbaiki saat G3 dengan mengunci env di berkas uji itu; bisa diulang dengan menyetel `NEXT_PUBLIC_PUBLIC_URL`, `NEXT_PUBLIC_SUPABASE_URL`, dan `SUPABASE_SERVICE_ROLE_KEY` palsu.

### Yang belum terbukti G2

Butuh staging atau tiket 10: salin lintas bucket R2 sungguhan, `CopySourceIfMatch`, bentuk `Errors` pada `DeleteObjects`, CDN, `revalidateTag` di Vercel, batas Auth anonim, uji dua koneksi bersamaan, hak `service_role` di produksi.

## Gelombang G1 (tiket 01, 02, 03)

Dikerjakan, ditinjau dua kali (`.tim/umkm-fitur/TINJAUAN-G1-KEAMANAN.md`, `TINJAUAN-G1-KODE.md`), lalu diperbaiki sesuai `.tim/umkm-fitur/PERBAIKAN-G1.md`. Backend 10 butir dan Frontend 6 butir selesai.

Keputusan PM yang sudah disampaikan ke pemilik: admin tidak bisa menandai dirinya sendiri sebagai pemeriksa; nomor hanya bisa dilihat selama pekerjaan terbuka; nomor di `alamat` tidak memblokir terbit karena alamat tidak tampil publik.

### Hasil gate terakhir

| Uji | Hasil |
|---|---|
| `npx eslint . --max-warnings=0 --ignore-pattern '.tim/**'` | lulus |
| `npm run typecheck` | lulus |
| `npm run build` | lulus |
| `npm test` | 6063 lulus, 0 gagal, 6 dilewati |
| `node scripts/lokal-rantai/skenario-umkm-a1.mjs` | 69 PASS, 0 FAIL |
| Manifest migrasi | cocok, 109 berkas |

Regresi lokal: `skenario-tinjauan-akhir` 102 lolos, `skenario-akses-fo` 58, `skenario-identitas` 46.

`npm run verify:baseline` tetap berhenti di lint karena `.tim/staging/realtime-smoke.mjs`, berkas lokal yang tidak ikut git, jadi gate dijalankan satu per satu.

### Kegagalan yang sudah ada sebelum pekerjaan ini

- `skenario-akses-data`: 121 lolos, 11 gagal. Hasil yang sama tanpa perubahan G1. Penyebab belum ditelusuri.

Uji kalender antrean FO yang gagal karena bergantung tanggal sudah diperbaiki di `205ed4e` dan lulus pada delapan tanggal simulasi, termasuk akhir bulan dan pergantian tahun.

### Test lama yang disesuaikan

Empat test survei (`supabase/migrations/survei_{undangan,jawaban,rpc,notifikasi}.test.ts`) mengandaikan seri survei adalah migrasi terbaru. Saringannya diperluas agar menerima `202611090001`, dan pemeriksaan entri `docs/analysis/DB-CHANGES.md` kini memeriksa urutan seri, bukan posisi terakhir di berkas. Berkas migrasi lama tidak berubah.

### Yang belum terbukti

Butuh staging atau tiket 10: uji dua koneksi bersamaan, perilaku R2 sungguhan, hak `service_role` di produksi.

## Cara melanjutkan

Kode tahap A selesai sesudah commit G3. Berikutnya langkah rilis di atas. Tahap B dan C di luar cakupan sekarang.

Push, penerapan migrasi, dan penghapusan branch remote `origin/feat/redesain-dasbor` tetap menunggu persetujuan eksplisit. Penerapan migrasi melewati staging dulu, dengan host dan daftar migrasi ditampilkan.
