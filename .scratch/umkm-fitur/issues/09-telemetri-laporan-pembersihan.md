# 09 telemetri laporan pembersihan

Status: ready-for-agent
Wave: G3
Blocked by: 08, 07

## What

One optional switch, default off: Views, zero-result groups, form-open clicks. Report for officers and admin with download. Bounded retention jobs.

## Requirements

K-SA-01, K-SA-05, K-SA-08

## Tests

U-08, U-10, U-12 (retention part) in `docs/umkm/MIGRASI-RILIS-UJI.md`.

Also from G2 (security review finding 2): **release blocker for the contact form.** The cleanup covers contact form and report content after 180 days, `umkm_private.operasi_publik` retry keys, and draft photos in R2 after 30 days from cancellation or 90 inactive days. Cancelled means the revision was rejected or the photo was taken out of the form; there is no separate status. The privacy page states these periods, so they must be running before the form opens to the public.

## Detail (PM, 2026-11-09)

Dasar: `docs/umkm/SISTEM-STATISTIK.md` bagian 2, 5, 7 dan `docs/umkm/SISTEM.md` bagian retensi. Prinsip sama: jalan sederhana (P-36).

**Sakelar**
- Satu baris `telemetri_opsional_aktif`, bawaan mati. Hanya admin yang mengubah, di halaman laporan, dengan konfirmasi bahwa kebijakan sudah terbit. Mencatat versi naskah dan waktu aktif ke jejak.
- Tidak ada pematian otomatis berdasarkan ukuran. Bila tiket 10 atau operasi menunjukkan beban berlebih, admin mematikan sakelar.
- Mati: nol baris, nol cookie, nol panggilan beacon. Respons profil memberi tahu klien sakelarnya, sehingga klien tidak mengirim apa pun.

**Pencatatan (hanya saat aktif)**
- Dilihat: membuka profil di tab aktif; satu per identitas harian per profil per hari WIB. Klik buka formulir: sama. Pencarian tanpa hasil: hitungan per hari, kategori, dan kabupaten/kota, tanpa kata pencarian.
- Akun login memakai UID dari sesi. Pengunjung lain memakai cookie statistik acak first-party, `HttpOnly`, umur 24 jam, dibuat hanya saat sakelar aktif. Yang disimpan hanya hash harian berkunci.
- Bot (user agent sederhana), staf, dan pratinjau tidak dihitung. Isi beacon hanya jenis dan id profil.
- Penulisan dedup, harian, dan total dalam satu transaksi. Tidak ada pekerja agregasi.

**Laporan (K-SA-05)**
- Halaman `/admin/umkm-laporan` untuk admin dan pemeriksa aktif, plus unduhan lewat `lib/csv.ts`. Tambah entri `lib/admin-nav.ts`.
- Profil per status, Dilihat, Suka per UMKM dan totalnya, kelompok tanpa hasil. Sakelar mati: Dilihat dan tanpa hasil bertuliskan "belum dicatat", bukan nol. Tanpa nomor UMKM dan kontak pengirim.

**Pembersihan (penghalang rilis formulir)**
- pg_cron harian, berbatas per putaran dan dapat dilanjutkan, tanpa HTTP:
  - baris pesan dan laporan dihapus 180 hari sejak selesai, atau sejak aktivitas terakhir bila belum selesai;
  - `operasi_publik` 180 hari;
  - dedup 7 hari, harian 95 hari, tanpa hasil harian 95 hari, ringkasan bulanan 24 bulan; total seumur hidup tetap.
- Foto draf R2: route `POST /api/umkm-katalog/bersihkan-draf` dengan `Authorization: Bearer $CRON_SECRET`, pola `api/chat/lampiran/bersihkan`. Tanpa antrean: route menelusuri objek `umkm-draf/` berumur lebih dari 30 hari, menanyakan database mana yang dilindungi, dan menghapus sisanya. Dilindungi: revisi berkeputusan terbit; revisi ditinjau dengan aktivitas kurang dari 90 hari; revisi ditolak kurang dari 30 hari. Ini juga mencakup objek yang tidak pernah terhubung ke baris.
- Tambah ke tabel penjadwal `docs/DEPLOY_RUNBOOK.md`. Pemasangan jadwal nyata adalah langkah rilis.

**Teks privasi**
- Tambah di `src/app/kebijakan-privasi/page.tsx` bagian 6 dan `docs/KEBIJAKAN_PDP.md`: cookie statistik acak 24 jam untuk pengunjung yang belum login, serta masa simpan statistik. Pemilik membaca teks ini sebelum sakelar dinyalakan.

## Comments

2026-11-09: kode sakelar, pencatatan, laporan, dan pembersihan selesai, ditinjau, gate lulus. Penjadwal `bersihkan-draf` dipasang saat rilis. Belum di-commit; migrasi belum diterapkan. Lihat `.scratch/umkm-fitur/PROGRES.md`.
