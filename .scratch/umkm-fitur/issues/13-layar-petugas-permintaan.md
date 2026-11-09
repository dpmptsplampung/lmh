# 13 layar petugas permintaan

Status: ready-for-human
Wave: G4
Blocked by: 11 (contract)

## What

Officer screen for requests inside the existing task list, assisted request entry, WhatsApp notification button, outcome, hold release; FO supervision and emergency hold; Phase B additions to the report page.

## Requirements

K-B-08, K-B-13, K-B-17 (officer side), K-B-20, K-A-26, K-A-27 (Phase B part), K-SA-05 (Phase B part)

## Tests

U-03 (one screen, two clicks), U-06 (FO screen), U-07 (template) in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Kontrak backend tiket 11 mengikat.

- **Daftar tugas `/admin/umkm-tugas`.** Butir `permintaan` tampil bersama profil, pesan, dan laporan. Detail satu layar: Kebutuhan, profil, perusahaan dan pemohon, tanda "perusahaan sudah diperiksa", status izin. Tombol "Setujui" dan "Tolak" (alasan singkat), paling banyak dua klik per keputusan.
- **Menunggu izin.** Layar menjelaskan langkahnya: "Lihat nomor" (tercatat), tanyakan ke UMKM lewat WhatsApp pribadi dengan teks minta izin dari `docs/umkm/ALUR-DAN-PERAN.md` bagian 8, catat izin satu klik, lalu tekan "Setujui" lagi.
- **Sesudah `nomor_dibuka`.** Tombol "Kirim pemberitahuan WhatsApp" membuka `wa.me` ke HP pemohon dengan teks dari fungsi templat tiket 11, dan memanggil route pencatatan. Tidak ada isian teks bebas. Pilihan hasil satu klik: kerja sama atau tidak berlanjut.
- **Bantuan tanpa akun.** Formulir singkat untuk petugas: nama dan kontak pemohon, perusahaan, jabatan, Kebutuhan, UMKM. Kode tautan tampil sekali dengan tombol salin dan teks pesan berisi kode dan tautan masuk. Sesudah ditutup, kode tidak bisa dilihat lagi.
- **Tahan darurat.** Butir yang ditahan bertanda mendesak; petugas melepasnya satu klik.
- **Pencarian petugas.** Kode permintaan bisa dicari di kotak cari yang sudah ada supaya hasil bisa dicatat saat kabar datang.
- **FO `/admin/umkm-pengawasan`.** Hitungan permintaan per status dan lama proses, jejak tanpa nomor dan tanpa data pemohon, tombol "Tahan permintaan" dengan alasan singkat.
- **Laporan `/admin/umkm-laporan`.** Tambahan permintaan per status, permintaan per UMKM, lama tunggu, hasil.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G4 selesai, gate lulus, di-commit lokal. Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
