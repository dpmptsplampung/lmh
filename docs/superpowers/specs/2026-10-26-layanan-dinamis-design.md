# Rancangan: Layanan Dinamis, Homepage Etalase, Akses per Orang, Rekap Terpadu

- Tanggal: 2026-10-26
- Status: **Disepakati dengan pemilik lewat sesi tanya-jawab Q1–Q48** — belum ada implementasi
- Asal: audit menyeluruh 2026-10-26 (perjalanan pengunjung online, homepage, model layanan, jadwal, pendataan, rekap & hak akses).
- Istilah: mengikuti [`GLOSSARY.md`](../../../GLOSSARY.md) (Instansi, Layanan, Sistem Resmi, Layanan Arsip, Front Office, Petugas Layanan, Koordinator, Pendataan Umum, Pendataan Khusus).
- ADR terkait: [0001](../../adr/0001-instansi-terpisah-dari-layanan.md), [0002](../../adr/0002-formulir-oss-dan-non-oss-tetap.md), [0003](../../adr/0003-koordinator-dan-akses-data-per-orang.md).
- `LMH-AGENT-SPEC.md` sudah ditinggalkan pemilik dan **bukan** acuan rancangan ini.

## 1. Peran LMH

LMH adalah **fasilitator**: semua proses perizinan/layanan tetap berjalan di Sistem Resmi masing-masing instansi (OSS RBA, SiCantik, dll.). LMH menunjang kerja petugas, memantau pelayanan dinas ke masyarakat, dan menjadi alat bantu dinas untuk mendata pelayanan. LMH **tidak** menerima permohonan atau unggahan berkas. (Q1)

## 2. Batasan global (mengikat semua fase)

| # | Batasan |
|---|---|
| B1 | **Data yang sudah ada di database tidak diubah atau dihapus.** Boleh: tabel/kolom baru, baris baru, mengisi kolom baru pada baris lama. Tidak boleh: `DELETE`, `DROP TABLE/COLUMN`, `UPDATE` nilai yang sudah ada. Objek lama yang tak terpakai dibiarkan (mis. `laporan_snapshot`, `layanan_jadwal`, `layanan_libur`, `jadwal_harian_beku`, `layanan_hari`). Perubahan oleh pengguna lewat UI admin tetap boleh. (Q42, Q47) |
| B2 | Migrasi = file forward baru (`YYYYMMDDNNNN_nama.sql`) + test kontrak statis + entri `MANIFEST.json`. Penerapan ke produksi hanya oleh pemilik. Agen tidak memakai kunci produksi (`AGENTS.md` "Keamanan data dan server"). |
| B3 | Role tetap tiga: `admin`, `front_office`, `petugas`. Tidak ada role baru. (Q33) |
| B4 | Semua batas hari memakai WIB (`src/lib/time.ts`). |
| B5 | Live chat wajib login Google; tidak ada login email/magic-link untuk pengunjung. (Q4, Q14) |

## 3. Fase dan cakupan

Urutan disepakati (Q48). Setiap fase punya rencana implementasi sendiri di `docs/superpowers/plans/`.

| Fase | Isi |
|---|---|
| 1 | Fondasi layanan: Instansi, kelola Layanan dari admin (tambah/ubah/arsip), website terkait, saklar perilaku, satu jadwal per layanan, hari libur lewat admin |
| 2 | Homepage dinamis + popup layanan |
| 3 | Penanda Koordinator, akses data per orang, unit FO, ambil alih pendataan, rekap terpadu |
| 4 | Pendataan Khusus dinamis (selain OSS/Non OSS) + pendataan saat menyelesaikan live chat |
| 5 | Live chat: riwayat seperti WhatsApp, bot di luar jam, email ke petugas |
| 6 | Pencarian pengunjung lama di FO |

Ditunda ke fase berikutnya (di luar rancangan ini): gerbang layanan berdasarkan absensi petugas (Q29), papan kinerja publik (Q5), survei & pengaduan (Q15, Q24), lampiran foto/dokumen di chat (Q28).

## 4. Fase 1 — Fondasi layanan

### 4.1 Model data (Q2, Q3, Q7, Q17, Q18)

- **Instansi**: entitas baru. Atribut fase ini: nama resmi, singkatan (opsional). Satu Instansi memiliki satu atau lebih Layanan. Tanpa logo dan tanpa halaman instansi.
- **Layanan** menunjuk ke satu Instansi dan mendapat atribut baru:
  - `slug` unik (dipakai alamat popup, Q25),
  - deskripsi pelayanan (satu teks bebas, termasuk apa saja yang bisa dibantu),
  - urutan tampil,
  - daftar **website terkait** (0..n, masing-masing label + URL `https://`), mis. Helpdesk OSS → "OSS RBA → oss.go.id",
  - tanggal terakhir konten diperbarui dan tautan sumber konten (Q8).
- Isi konten disusun admin secara manual dari sumber resmi; **tidak ada** pengambilan otomatis dari website instansi. (Q8)

### 4.2 Kelola Layanan dari admin (Q2, Q9, Q10)

- Hanya **admin** yang membuat, mengubah, dan mengarsipkan Instansi dan Layanan. Petugas tidak bisa menyunting konten. (Q9)
- Tambah Layanan langsung berlaku di homepage, antrean, chat, reservasi tanpa deploy. Layanan baru otomatis mendapat prefiks antrean (sudah ada) **dan** jadwal default (§4.4) supaya tidak tertutup permanen.
- **Arsip** menggantikan hapus (Q10): Layanan Arsip hilang dari homepage, antrean, layar TV, chat, reservasi, dan tidak bisa menerbitkan tiket baru; riwayatnya tetap. Hapus permanen hanya untuk Layanan yang belum pernah punya tiket, kunjungan, atau penanganan. Arsip bisa dibatalkan.
- Ubah nama tidak boleh mengubah jenis formulir pendataan secara diam-diam: jenis formulir menjadi pilihan eksplisit (`oss`, `perizinan`, atau tanpa formulir tetap). Penebakan dari nama (`determineFormType`, `form_pendataan_dari_nama`) tidak dipakai untuk keputusan baru.

### 4.3 Saklar perilaku (Q11)

Perilaku ditentukan saklar yang terlihat di admin per Layanan: punya antrean, tampil di layar TV, punya live chat, bot aktif, tampil di homepage. Kolom `tipe` tidak lagi menentukan perilaku apa pun. Akibat langsung: Layanan bertipe `mitra` (BALMON, Bank Lampung — keduanya memakai antrean LMH) ikut tampil di estimasi antrean bila antreannya aktif.

### 4.4 Satu jadwal per Layanan (Q20, Q26, Q27)

- Sumber kebenaran: **jam operasional mingguan per Layanan** (hari + jam buka + jam tutup) ditambah **hari libur nasional** yang berlaku untuk semua Layanan. Tidak ada pengecualian per tanggal per Layanan.
- Admin mengubah keduanya lewat halaman admin (hari libur saat ini hanya bisa lewat SQL — diperbaiki).
- Satu fungsi keputusan "Layanan X buka pada tanggal T jam J?" dipakai oleh: status di homepage/popup, penerbitan tiket (eskalasi FO, alih admin), pilihan tanggal reservasi (UI dan RPC), dan layar TV.
- **Hari tutup** (di luar jadwal atau hari libur): FO tidak bisa meneruskan pengunjung ke Layanan itu, tiket tidak terbit, tanggal itu tidak bisa dipilih untuk reservasi, kartu homepage tetap tampil dengan keterangan "Tutup hari ini · Buka setiap Kamis". **Live chat tetap bisa diakses** (perilaku chat di luar jadwal: §8).
- Jam tutup per Layanan menggantikan jam 16:00 global untuk penerbitan tiket Layanan. Batas akhir kerja FO (`layanan_sudah_tutup()`) tetap berlaku untuk pendaftaran walk-in.
- Bug yang ikut tertutup: halaman admin Jadwal saat ini menulis tabel yang tidak dibaca gerbang mana pun; `is_layanan_buka_jadwal` tidak mengenal `hari_libur`; reservasi meng-hardcode Sabtu/Minggu; Layanan baru tanpa baris jadwal tertutup permanen.

### 4.5 Bot

Bot memakai konten Layanan hasil susunan admin (nama, Instansi, deskripsi, website terkait, jadwal) sebagai pengetahuan per Layanan, tidak hanya nama. (Q8)

## 5. Fase 2 — Homepage etalase (Q5, Q13, Q19, Q25)

- Homepage = **etalase layanan**, sederhana namun informatif: beberapa teks penjelasan singkat dan daftar kartu Layanan.
- Tersusun dari blok berjenis tetap: hero, cari & daftar layanan, status hari ini (antrean), jalur cepat, ajakan bertindak, footer, plus satu slot papan kinerja (belum dibangun). Admin bisa menyalakan/mematikan, mengurutkan, dan mengubah teks tiap blok. Bukan page builder bebas. Blok yang dimatikan **tidak tampil** (bukan jatuh ke teks cadangan).
- Daftar kartu diisi otomatis dari Layanan yang tampil di homepage dan tidak diarsipkan. `FALLBACK_SERVICES` dan baris `service` di `landing_content` tidak dipakai lagi (baris lama dibiarkan, B1).
- Kartu bisa diklik → **popup** berisi: nama Layanan, Instansi, deskripsi, website terkait, jadwal, status buka/tutup hari ini, antrean saat ini, dan tautan kecil "Tanya lewat live chat". Popup punya alamat sendiri (`/?layanan=<slug>`) supaya bisa dibagikan dan ditautkan bot.
- Judul jumlah layanan dihitung dari data, bukan teks tetap.

## 6. Fase 3 — Akses data dan rekap

### 6.1 Koordinator dan lingkup akses (Q33–Q35, Q37–Q39)

- **Koordinator** = penanda pada akun Front Office atau Petugas Layanan; bukan role.
- **Unit**: Front Office dihitung sebagai satu unit; setiap Layanan adalah unit. Satu akun memegang satu unit.

| Akun | Operasional antrean | Melihat/unduh data |
|---|---|---|
| FO biasa | Semua Layanan (memanggil, mengambil alih antrean yang belum dimulai, mengelola antrean) | Hanya data yang ia tangani sendiri |
| FO + Koordinator | Semua Layanan | Semua data semua Layanan |
| Petugas Layanan biasa | Layanannya | Hanya data yang ia tangani sendiri |
| Petugas Layanan + Koordinator | Layanannya | Semua data Layanannya |
| Admin | Semua | Semua + pengaturan |

- Ini **membalik** keputusan CEO 2026-10-14 (`202610140013_fo_keterbukaan_data.sql`) bahwa semua FO saling bisa melihat data; lihat ADR 0003.

### 6.2 Ambil alih pendataan (Q33, Q38)

Koordinator bisa mengambil alih pendataan yang sudah dimulai petugas lain di unitnya sampai selesai. Petugas semula **tetap bisa menyunting**. Pelayanan tercatat atas nama Koordinator bila diambil alih. `audit_log` menyimpan siapa memegang sebelum dan sesudah; petugas semula melihat pemberitahuan.

### 6.3 Rekap terpadu (Q42–Q44)

- Satu halaman Rekap, otomatis dibatasi lingkup akses §6.1, dengan tiga bagian:
  1. **Rekap Harian** — jumlah per Layanan per hari, selalu terkini (tanpa tombol "Rollup Hari Ini").
  2. **Data Pelayanan** — satu baris per pelayanan; kolom Pendataan Umum + Pendataan Khusus Layanan terpilih; unduh Excel.
  3. **Kinerja Petugas** — per petugas, untuk akun yang berhak.
- Tab OSS, Non OSS, Per Layanan, Petugas Layanan, dan halaman Rekap FO dilebur ke tiga bagian itu.
- **Satu definisi "dilayani"**: tahap pelayanan berstatus selesai; tanggal = tanggal kunjungan dalam WIB; pelayanan batal atau draf tidak dihitung. Dipakai di semua angka.
- Kunjungan tanpa tahap FO (mis. chat diambil langsung petugas) hanya masuk data Layanannya, ditandai **kanal Live Chat**.

## 7. Fase 4 — Pendataan

- **Pendataan Umum** ditetapkan sistem, sama untuk semua Layanan, tidak diedit admin: identitas pengunjung (nama, nomor HP, email, asal instansi, kategori, keperluan) dicatat sekali oleh FO, ditambah topik dan catatan petugas untuk **semua** Layanan. (Q21, Q30, Q31)
- **Pendataan Khusus** diatur admin per Layanan (Q12, Q22, Q23):
  - jenis isian: teks singkat, teks panjang, angka, tanggal, pilihan tunggal, pilihan ganda, ya/tidak; masing-masing wajib atau opsional; tanpa unggah berkas;
  - isian yang pernah diisi: label dan urutan boleh diubah, tidak bisa dihapus (hanya disembunyikan dari formulir baru), jenis tidak bisa diubah;
  - tidak menanyakan ulang identitas (Q30).
- **Helpdesk OSS dan Non OSS tetap memakai formulir tetap yang sekarang** (Q36 opsi C, Q45; ADR 0002): isian formulir tidak berubah, identitas tetap terisi otomatis dari data FO seperti sekarang. Tambahan satu-satunya: pilihan topik di langkah selesai (Q46); data lama tanpa topik tampil "(tidak tercatat)".
- **Live chat**: Pendataan Umum + Pendataan Khusus Layanan itu diisi petugas saat **menyelesaikan percakapan**, dan pelayanan ditandai kanal Live Chat. (Q44)

## 8. Fase 5 — Live chat (Q28, Q40)

- Setiap pengunjung punya **satu percakapan per Layanan** yang tersimpan terus, seperti satu kontak di WhatsApp. Menu "Live chat" membuka daftar percakapan. Petugas melihat seluruh riwayat percakapan pengunjung itu di Layanannya. Sesi per kunjungan tetap dicatat di belakang layar untuk rekap dan survei nanti.
- **Di luar jam operasional Layanan**: bot tetap menjawab; pengunjung diberi tahu bahwa petugas sedang tidak tersedia dan chat dibalas bot otomatis. Bila pengunjung meminta bicara dengan petugas, **baru** email dikirim ke petugas Layanan itu, dan pengunjung melihat "Mohon menunggu respon dari petugas; petugas akan menjawab pada jam kerja."
- Kalimat "tautan survei akan disediakan di sini" di akhir sesi dihapus sampai modul survei dirancang. (Q24)
- Lampiran foto/dokumen: fase berikutnya.

## 9. Fase 6 — Pencarian pengunjung lama di FO (Q30, Q41)

Saat FO mengetik minimal 3 huruf nama atau angka nomor HP, muncul paling banyak 5 saran: nama, nomor HP disamarkan (mis. `0812****789`), asal instansi, tanggal kunjungan terakhir. Memilih saran mengisi formulir otomatis; bisa dikosongkan lagi. Hanya akun FO dan admin yang bisa mencari. Data yang sudah dianonimkan sesuai kebijakan PDP tidak muncul.

## 10. Keputusan yang sudah dikerjakan di luar rancangan ini

Branch `claude/busy-poitras-cb912c` (belum di-push): tujuan login lewat `?next=`, menu mobile mengenali `front_office`, teks SKM, koreksi `CLAUDE.md`, migrasi `202610260001` (RLS `standar_pelayanan`, belum diterapkan), `/peta-potensi` tanpa login (Q6, Q16).
Branch `claude/amazing-borg-b06657` (belum di-push): dependensi rentan dinaikkan (next 16.4.1, zod 4.6.6, undici 7.30.1).

## 11. Pertanyaan terbuka

Tidak ada pada tingkat rancangan. Detail teknis per fase diputuskan di rencana implementasinya dan dikonfirmasi ke pemilik bila menyentuh perilaku yang terlihat pengguna.
