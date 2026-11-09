# 17 layar pemilik umkm

Status: ready-for-agent
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

## Comments
