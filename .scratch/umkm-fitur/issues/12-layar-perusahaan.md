# 12 layar perusahaan

Status: ready-for-human
Wave: G4
Blocked by: 11 (contract)

## What

Company screens: "Hubungi UMKM" on the profile page, short company data, Needs with the recommendation panel, "Permintaan saya" with cancel, the opened number, the officer's name and last four digits, and the link-code entry for assisted requests.

## Requirements

K-B-02, K-B-03, K-B-04, K-B-05, K-B-12, K-B-17 (requester side), K-B-23, K-SA-04 (Need panel)

## Tests

U-05 (screen part), U-07 (officer name and last four digits) in `docs/umkm/MIGRASI-RILIS-UJI.md`.

## Detail (PM, 2026-11-09)

Kontrak backend tiket 11 mengikat. Teks pengguna dari `docs/umkm/ALUR-DAN-PERAN.md` bagian 8.

- **Profil `/umkm/katalog/[id]`.** Bila tahap B aktif (route tahap B tidak memberi 503), teks pengganti nomor memakai versi tahap B dan ada tombol "Hubungi UMKM". Tombol "Hubungi lewat petugas" (formulir tahap A) tetap ada. Bila tahap B belum aktif, halaman sama persis dengan tahap A.
- **"Hubungi UMKM".** Belum login atau sesi anonim: ke `/login?next=...` lalu kembali. Sesudah login, bila data perusahaan belum ada, isi sekali (nama perusahaan, jabatan, satu kotak persetujuan). Lalu pilih Kebutuhan yang ada atau tulis yang baru (teks singkat, Kategori, kabupaten/kota opsional), dan kirim. Hasil: "Permintaan diterima pada [tanggal]".
- **Halaman `/me/umkm`.** Dua bagian: Kebutuhan saya dan Permintaan saya. Tiap Kebutuhan punya panel 10 rekomendasi dengan tombol tambah satu klik, dan tombol tutup Kebutuhan. Tiap permintaan menampilkan status, tanggal, alasan bila ditolak, kode permintaan, nama petugas dan empat angka terakhir HP-nya, tombol batal sebelum `nomor_dibuka`. Tambah tautan menu di dashboard `/me`.
- **Nomor.** Untuk `nomor_dibuka`, nomor diambil saat pengguna menekan "Tampilkan nomor", bukan saat halaman dimuat. Tidak disimpan di `localStorage`, cache, atau state global. Bila route menolak (izin dicabut, profil disembunyikan), tampilkan teks "Nomor tidak lagi ditampilkan" dari bagian 8 dengan tautan ke formulir.
- **Kode tautan.** Isian "Punya kode dari petugas?" di `/me/umkm` memanggil route tautkan. Pesan sukses dan gagal tenang, tanpa menyebut sebab rinci.
- **Peringatan.** Di dekat nomor: "DPMPTSP tidak menjamin transaksi; jangan mengirim uang sebelum ada kesepakatan tertulis."
- Sesuai pola lama: bisa dipakai di 320 px dan papan ketik, galat tenang, migrasi belum diterapkan tidak memberi 500.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G4 selesai, gate lulus, di-commit lokal. Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
