# 17 layar pemilik umkm

Status: ready-for-human
Wave: G5
Blocked by: 16 (contract)

## What

Owner screens under `/me/usaha`: register, status, claim, private draft edit with photos and social links, own statistics and receiving companies, consent revocation, NIB information.

## Requirements

K-C-01, K-C-03, K-C-04, K-C-06, K-C-08

## Tests

Screen tests per item; no number of another party ever shown.

## Detail (PM, 2026-11-09)

Kontrak backend tiket 16 mengikat. Teks dari `docs/umkm/ALUR-DAN-PERAN.md` bagian 8 (teks pencabutan dan informasi NIB).

- `/me/usaha`: daftar profil milik akun, tombol "Daftarkan usaha", dan "Klaim profil" dari halaman profil katalog (tombol kecil "Ini usaha saya").
- Status ajuan: "Menunggu pemeriksaan, diajukan [tanggal]" dan catatan petugas.
- Ubah: formulir sama dengan petugas sejauh mungkin, foto ke area draf, keterangan bahwa versi lama tetap tampil sampai diperiksa.
- Statistik: angka dan tren 30 hari sederhana tanpa pustaka grafik baru, daftar perusahaan penerima (nama dan tanggal).
- Cabut izin: tombol dengan konfirmasi berisi teks pencabutan bagian 8.
- Informasi NIB tampil bila profil belum tercatat punya NIB.
- Teks privasi di `src/app/kebijakan-privasi/page.tsx` bagian 6 dan `docs/KEBIJAKAN_PDP.md`: satu paragraf pendek tahap C. Pemilik usaha yang mendaftar atau mengklaim profil memakai akun pribadi; hak mengubah baru berlaku sesudah petugas memastikan penanggung jawab; pemilik melihat nama perusahaan penerima nomor dan tanggalnya, tanpa data pribadi pemohon; perubahan profil diperiksa petugas sebelum tampil. Kalimat cara mencabut izin ditambah "atau dari halaman Usaha saya". Sesuaikan test halaman.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G5 selesai, gate lulus, di-commit lokal. Perbaikan tambahan dari tinjauan ada di `.tim/umkm-fitur/PERBAIKAN-G5.md` (antara lain Cabut kepemilikan oleh petugas). Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
