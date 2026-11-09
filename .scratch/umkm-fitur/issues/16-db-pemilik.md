# 16 db pemilik umkm

Status: ready-for-agent
Wave: G5
Blocked by: 11

## What

Phase C database and API: owner self-registration, claim of an existing profile, private draft edits with R2 draft photos and social links, owner revocation of number consent, owner statistics and receiving company names.

## Requirements

K-C-01, K-C-03, K-C-04, K-C-06, K-C-08, K-NF-04, K-NF-05

## Tests

U-02 (owner part), U-10 (owner part), U-11 in `docs/umkm/MIGRASI-RILIS-UJI.md`. Behavior in ticket 19.

## Detail (PM, 2026-11-09)

Dasar: `docs/umkm/SISTEM.md` bagian 3, 5, 7, 8 dan `docs/umkm/ALUR-DAN-PERAN.md`. Prinsip P-36. Pakai ulang alur tinjauan profil tahap A; jangan membuat antrean atau status baru di luar yang perlu.

- **Pemilik.** Tabel `umkm_pemilik`: profil, UID akun (bukan anonim), status `diajukan/disetujui/ditolak`, alasan, petugas pemeriksa, waktu. Hanya status `disetujui` memberi hak. Login, email lama, atau HP saja tidak memberi hak (K-C-03). Satu profil boleh punya lebih dari satu pemilik yang disetujui; tidak ada pengalihan otomatis dari pasar lama `listing_umkm`.
- **Daftar sendiri (K-C-01).** Akun login mengajukan profil baru: masuk sebagai `umkm_profil` `diajukan` sumber baru `mandiri`, revisi pertama, kontak WhatsApp opsional, dan baris pemilik `diajukan`. Petugas memeriksa profil dan pemilik di layar yang sama; Terbitkan juga menyetujui pemilik, Tolak juga menolak pemilik. Pemilik melihat status, tanggal ajuan, dan catatan petugas, tanpa posisi antrean atau tanggal selesai.
- **Klaim (K-C-03).** Akun login mengklaim profil `terbit` dengan alasan singkat. Masuk daftar tugas sebagai `jenis = 'klaim'`. Petugas memastikan penanggung jawab (telepon lewat WhatsApp pribadi bila perlu) lalu Setujui atau Tolak.
- **Draf (K-C-04).** Pemilik yang disetujui mengubah lewat revisi pribadi baru. Versi terbit tetap tampil sampai revisi disetujui petugas lewat alur tinjauan tahap A. Foto draf memakai area R2 tertutup `umkm-draf` (perluas izin area untuk pemilik dengan kunci berawalan profil miliknya), publikasi foto memakai mekanisme G2. TikTok dan Instagram mengikuti validasi tahap A. Perubahan nomor WhatsApp membuat versi kontak baru, sehingga izin lama otomatis tidak berlaku.
- **Kolom pelaku.** Kolom yang sekarang wajib berisi `petugas.id` (revisi, versi kontak, izin, riwayat) perlu cara mencatat pemilik sebagai pelaku. Pilih cara paling kecil, misalnya kolom UID pemilik opsional dengan CHECK salah satu terisi, lewat migrasi baru.
- **Cabut izin (K-C-06).** Pemilik mencatat `dicabut` untuk kontak terkini profilnya. Langsung berlaku untuk `umkm_baca_nomor` tahap B. Tidak ada pemberian izin oleh pemilik di tahap ini.
- **Statistik pemilik (K-C-08).** Dilihat (bila sakelar aktif), Suka, jumlah permintaan, nomor dibuka, tren 30 hari, dan `umkm_perusahaan_penerima`: nama perusahaan dan tanggal pembukaan saja, paling banyak 20 per halaman, tanpa data pemohon. Suka pemilik untuk profilnya sendiri tidak dihitung (sudah aturan G3; pastikan berlaku untuk pemilik).
- **Daftar tugas.** Profil mandiri dan revisi pemilik masuk antrean profil yang sudah ada; klaim sebagai jenis baru. Mendesak lalu tertua.
- **Route.** `src/app/api/umkm-pemilik/**` untuk pemilik, `src/app/api/admin/umkm-tugas/klaim/**` untuk petugas. 503 tenang sebelum migrasi.

## Comments
