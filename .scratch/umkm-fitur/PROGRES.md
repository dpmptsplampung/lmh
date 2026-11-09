# Progres implementasi UMKM

Diperbarui 2026-11-09. Pengganti catatan pukul 12.15 WIB saat worker Codex berhenti karena limit.

## Keadaan repo

- Branch `feat/umkm`. Kode G1 ada di commit `16f1795`, perbaikan uji kalender di `205ed4e`. Dokumen rencana di `91f4888`.
- **Belum ada push**, jadi commit ini hanya ada di mesin ini.
- Migrasi `202611090001` belum diterapkan ke database mana pun, termasuk staging.
- Worker: semua sudah dilepas. Run Orca: `run_f7c5c7375d19`. Transkrip worker yang dihentikan: `.tim/umkm-fitur/transkrip-g1/`.

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

1. Commit berikutnya memakai `git add` dengan path eksplisit, tanpa atribusi alat AI. `contoh/` tidak ikut.
2. Mulai G2 (tiket 04 sampai 07). Rinci spec saat mulai. Worker Codex (`gpt-6.1-sol`, `high`) untuk pembuatan, ditambah satu tinjauan keamanan terpisah. Teks kebijakan privasi (tiket 07) harus mendahului pembukaan formulir, dan sebaiknya ditinjau DPO.
3. Sesudah G2, G3 (suka dan skor, telemetri, uji beban). Tahap B dan C di luar cakupan sekarang.

Push, penerapan migrasi, dan penghapusan branch remote `origin/feat/redesain-dasbor` tetap menunggu persetujuan eksplisit. Penerapan migrasi melewati staging dulu, dengan host dan daftar migrasi ditampilkan.
