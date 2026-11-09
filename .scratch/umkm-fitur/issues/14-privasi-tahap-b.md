# 14 privasi tahap B

Status: ready-for-human
Wave: G4
Blocked by: 07

## What

Privacy text for Phase B before release: company data, number consent, number shown only in the requester account, officer personal WhatsApp notification, retention.

## Requirements

K-NF-11 (Phase B part)

## Tests

Page test for the new paragraphs.

## Detail (PM, 2026-11-09)

Di `src/app/kebijakan-privasi/page.tsx` bagian 6 dan `docs/KEBIJAKAN_PDP.md`, tambah satu paragraf tahap B. Isi wajib, dalam bahasa Indonesia sederhana:

- Perusahaan yang meminta nomor UMKM wajib masuk dengan akun pribadi dan mengisi nama perusahaan dan jabatan. Nama, email, dan HP diambil dari profil akun.
- Nomor UMKM hanya dibuka bila pemiliknya sudah memberi izin dan petugas menyetujui permintaan. Nomor hanya tampil di akun pemohon itu, tidak dikirim lewat WhatsApp, email, atau notifikasi.
- Pemilik UMKM dapat mencabut izin kapan saja. Sesudah dicabut, nomor tidak lagi tampil di akun perusahaan, tetapi perusahaan yang sudah mencatatnya mungkin masih menyimpannya.
- Petugas memakai WhatsApp pribadinya untuk menanyakan izin kepada UMKM dan memberi tahu pemohon. Riwayat chat di ponsel petugas berada di luar sistem LMH.
- Catatan permintaan disimpan sampai 730 hari sesudah ditutup atau sesudah izin dicabut, lalu teks Kebutuhan dan kontak bantuan dihapus.

Tinjauan DPO disarankan. Sesuaikan test halaman.

## Comments

2026-11-09: kode, tinjauan, dan perbaikan G4 selesai, gate lulus, di-commit lokal. Migrasi belum diterapkan; pemeriksaan staging tercatat di `.scratch/umkm-fitur/PROGRES.md`.
