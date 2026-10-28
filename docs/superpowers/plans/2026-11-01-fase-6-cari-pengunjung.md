# Fase 6 — Saran Pengunjung Lama pada Isian Nama/HP Front Office — Implementation Plan

**Goal:** Saat FO mengetik di isian **Nama** (>= 3 huruf) atau **Nomor HP** (>= 3 angka) pada formulir walk-in yang sudah ada, muncul dropdown paling banyak 5 saran (nama, HP disamarkan `0812****789`, asal instansi, tanggal kunjungan terakhir WIB) tepat di bawah isian itu. Memilih saran mengisi formulir (nama, HP, email, asal instansi, kategori); bisa dikosongkan lagi; mengetik nama baru yang tak cocok apa pun berjalan persis seperti sebelumnya. Hanya akun FO dan Admin aktif. Data yang sudah dianonimkan (PDP) tidak pernah muncul. Menggantikan banner "Pernah berkunjung" lama.

**Spec:** [`docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`](../specs/2026-10-26-layanan-dinamis-design.md) §2 (B1–B5), **§9**, §6. Konteks: Fase 3 K14 ([plan](2026-10-29-fase-3-koordinator-rekap.md)) — setelah RLS Fase 3, FO biasa tak lagi bisa membaca kunjungan lama untuk autofill.

**Persyaratan pemilik (mengikat, disusulkan koordinator):** BUKAN kolom pencarian baru: combobox ARIA pada input Nama dan Nomor HP yang ada; debounce + batalkan permintaan basi; tanpa kedip; Panah/Enter/Esc, Tab tidak dibajak; mouse/sentuh; tutup saat blur tanpa menelan klik; tidak pernah memblokir ketikan/kirim bila RPC lambat/galat/tidak ada (diam-diam). Berlaku di semua tempat FO mendaftar walk-in: satu-satunya adalah `WalkinPanel` (tab Walk-in di `/admin/fo/registrasi`); `/admin/fo/daftar` hanya redirect ke tab itu dan `WalkinWizard` hanya tautan (deprecated).

## Arsitektur

- **DB (`202611010001_fo_cari_pengunjung.sql`, aditif):** `hp_normal(text)` IMMUTABLE; indeks trigram `idx_kunjungan_nama_trgm`, `idx_kunjungan_hp_trgm` (pg_trgm sudah ada sejak 202609230002; migrasi hanya memeriksa, tidak membuat ekstensi); `fo_cari_pengunjung(p_q)` (SECURITY DEFINER, `SET search_path`, `sesi_valid()` + peran aktif `front_office`/`admin` via `staf_lingkup()`, minimal 3 karakter/digit di server, maks 5 orang, satu baris per orang = kunjungan terkininya, HP disamarkan, tanpa email/HP penuh); `fo_ambil_pengunjung(p_id)` (identitas penuh satu kunjungan terpilih, FO/admin, diaudit `audit_log` tanpa PII, 60 per 10 menit per akun). Kunjungan teranonimkan (`nama='[anonim]'`, `asal_instansi` kosong) dan yang lebih tua dari 730 hari dikecualikan.
- **Klien:** `src/lib/fo/cari-pengunjung.ts` (murni: `jenisQuery`, `cariPengunjung`, `periksaKetersediaan`, `ambilPengunjung`; semua kegagalan jadi status, tidak melempar; mendukung `AbortSignal`), `src/components/fo/InputSaranPengunjung.tsx` (combobox pada input yang ada), integrasi di `WalkinPanel`. `pengunjung-lama.ts` kini hanya `muatAsalSering` (datalist asal).
- **Sebelum migrasi diterapkan:** `WalkinPanel` mem-probe `fo_cari_pengunjung('')` sekali; RPC tidak ada / bukan FO-admin = isian Nama/HP tetap input biasa tanpa atribut combobox.

## Tugas

- [x] 1. Migrasi + test kontrak statis + rollback + `MANIFEST.json` + `FORWARD_MIGRATION_FILES`.
- [x] 2. Pustaka klien `cari-pengunjung.ts` + test (TDD).
- [x] 3. `InputSaranPengunjung` + test perilaku (debounce, basi, kedip, papan ketik, ARIA, blur, galat diam-diam, hasil lambat tak menimpa).
- [x] 4. Integrasi `WalkinPanel` (Nama + HP, "Kosongkan isian", probe ketersediaan) + test integrasi; buang banner/autofill lama.
- [x] 5. Dokumen: `MIGRATIONS.md`, `STATUS.md`, `CLAUDE.md`, RBAC §10, PDP.
- [x] 6. Gate penuh (lint, typecheck, test, build, manifest `--check`).

## Keputusan pelaksana (spec diam)

| # | Keputusan | Biaya bila keliru |
|---|---|---|
| K1 | Sumber data = tabel `kunjungan` (bukan `pengunjung`/`buku_tamu`): hanya kunjungan yang punya `asal_instansi` (walk-in/registrasi FO). Satu baris per orang: kunci = HP kanonik, atau nama+asal bila tanpa HP; yang tampil = kunjungan terbarunya. | Orang yang hanya pernah chat/reservasi tanpa asal instansi tidak muncul; dua orang tanpa HP dengan nama+asal sama bergabung jadi satu saran. |
| K2 | Id saran = `kunjungan.id` (UUID opak) dan identitas penuh diambil lewat RPC kedua `fo_ambil_pengunjung`; HP penuh/email tidak pernah ada di daftar saran. | Satu panggilan jaringan tambahan saat memilih (~100 ms); bila lambat, formulir tetap bisa diisi manual. |
| K3 | Pembatasan pengambilan identitas: audit ringan (`audit_log` aksi `fo_ambil_pengunjung`, hanya id kunjungan) + batas 60/10 menit per akun (`RATE_LIMIT`). Pencarian (HP tersamar) tidak diaudit/dibatasi. | FO yang sah mengambil > 60 data dalam 10 menit terhambat (sangat tak wajar untuk loket); penyedot pelan (<= 6/menit) tidak terblokir tetapi tercatat dan terlacak. |
| K4 | Mode pencarian: input yang hanya berisi angka/`+()-`/spasi = HP (>= 3 digit setelah dikanonkan; awalan 62 -> 0, cocok sebagian di mana saja); selain itu = nama (ILIKE `%q%`, >= 3 karakter, `%`/`_`/`\` dinetralkan). Isian Nama hanya mencari nama; isian HP hanya mencari angka. | Pencarian awalan-tengah lebih longgar dari "awalan saja"; hasil tetap dibatasi 5 dan indeks trigram menjaga kecepatan. |
| K5 | Batas retensi dihormati ganda: kunjungan > 730 hari (WIB) tidak dikembalikan walau job anonimisasi terlambat. | Orang yang kembali setelah > 2 tahun harus diketik ulang (selaras kebijakan PDP). |
| K6 | Memilih saran menimpa lima isian identitas (nama, asal, kategori bila ada, email, HP); "Kosongkan isian" mengosongkan lima isian itu saja (keperluan/layanan saran dibiarkan). Ringkasan "diisi dari data pengunjung lama" hilang sendiri bila Nama diubah. | FO yang sudah mengetik email manual lalu memilih saran kehilangan email ketikannya (bisa diketik lagi). |
| K7 | Pencarian hanya dipicu ketikan pengguna (bukan perubahan nilai dari kode), sehingga pengisian otomatis tidak memunculkan dropdown lagi. Daftar lama tetap tampil selama menunggu hasil baru (tanpa kedip). Hasil lambat dari "pilih" dibuang bila pengguna sudah mengetik lagi. | Tidak ada. |
| K8 | `buku_tamu` (celah Fase 3: terbaca semua FO) **tidak disentuh**: Fase 6 tidak membaca `buku_tamu` sama sekali. Tetap tercatat sebagai celah terbuka. | Semua FO tetap bisa membaca seluruh `buku_tamu`. |
| K9 | Tidak ada ekstensi baru; indeks trigram dipasang biasa (bukan `CONCURRENTLY`, karena migrasi berjalan atomik). Bila `kunjungan` besar, pembuatan indeks mengunci tulis sebentar. | Jeda tulis `kunjungan` beberapa detik saat terap (tabel ribuan baris: tak terasa). |
| K10 | Probe ketersediaan lewat panggilan `fo_cari_pengunjung('')` saat panel dibuka (0 baris, tanpa menyentuh data). | Satu RPC ringan per pembukaan formulir. |
