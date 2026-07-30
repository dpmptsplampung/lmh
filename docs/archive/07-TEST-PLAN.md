# 07 — RENCANA UJI (FASE D)

> Memetakan **setiap invarian (I-01..I-24)** dan **setiap skenario uji ujung-ke-ujung (SK-01..SK-32)** dari Bagian 6 spec menjadi **kasus uji nyata**.
> Dibuat untuk memenuhi **Bagian 8.4** dan Bagian 6 ("kalau sebuah keputusan tidak bisa diubah menjadi uji, angkat ke OPEN-QUESTIONS").
> Setiap kasus uji merujuk WP yang mengimplementasikannya (lihat `05-IMPLEMENTATION-PLAN.md`).
>
> **Jenis uji:** `unit` (vitest) · `db` (fungsi/RLS di Postgres) · `rls` (perilaku per-peran dengan token nyata, SEC-04) · `e2e` (alur lengkap; beberapa menunggu SEC-16) · `manual` (verifikasi produksi).

---

## A. UJI INVARIAN (I-01 .. I-24)

| ID | Invarian | Jenis | Cara uji | WP | Keputusan |
|---|---|---|---|---|---|
| I-01 | Tidak ada dua tiket `(layanan_id,tanggal,nomor)` sama | db | konkurensi nyata: 2 transaksi paralel memanggil `terbit_nomor_antrean`; cek `UNIQUE` menolak duplikat | WP-05 | QUE-06 |
| I-02 | Satu tiket tidak `dilayani` dua kali oleh dua petugas | db/rls | `UPDATE ... WHERE status='menunggu'` dari 2 sesi; tepat 1 baris terpengaruh | WP-22 | QUE-07 |
| I-03 | `COUNT(kunjungan) ≤ COUNT(tiket)` per tanggal | db | setelah backfill & dual write, bandingkan agregat per tanggal | WP-21 | QUE-01 |
| I-04 | Tidak ada tiket `menunggu` pada tanggal yang sudah lewat | db | setelah cron akhir hari, `SELECT count(*) WHERE status='menunggu' AND tanggal < todayWIB()` = 0 | WP-22/23 | QUE-09/15, SCH-10 |
| I-05 | Tidak ada tiket untuk layanan tanpa absensi hari itu | db/rls | terbitkan tiket untuk layanan tanpa absensi → ditolak | WP-17 | SCH-02 |
| I-06 | Tidak ada tiket/reservasi pada tanggal tanpa jadwal | db | insert tiket/reservasi di luar jadwal → ditolak trigger | WP-16 | SCH-01 |
| I-07 | Reservasi tidak boleh > hari ini + 7 | unit/db | `MAX_BOOKING_DAYS=7`; validasi klien + server menolak H+8 | WP-16/22 | QUE-05 |
| I-08 | `jadwal_harian_beku` tidak berubah setelah dibuat | db | `UPDATE`/`DELETE` baris beku → ditolak | WP-07 | SCH-05 |
| I-09 | Jam absensi tidak lebih awal dari waktu server | db | `catat_absensi()` mengisi `now()` server; input jam mundur dari klien diabaikan | WP-17 | SCH-08 |
| I-10 | Entri buku tamu tidak punya tiket antrean | db | buku tamu tidak punya FK ke tiket; verifikasi struktural | WP-21 | GST-01 |
| I-11 | Berkas legalitas UMKM tidak di bucket publik | db/storage | cek `berkas_legalitas_path` mengarah ke bucket privat `umkm-legalitas`; akses anonim ditolak | WP-31 | MMK-04 |
| I-12 | Listing `published` wajib kontak terverifikasi | db | set `status='published'` tanpa `kontak_terverifikasi=true` → ditolak | WP-31 | MMK-06 |
| I-13 | Listing `published` wajib `berlaku_sampai` di masa depan | db | cron expired mengubah listing lewat `berlaku_sampai` → `expired` & hilang dari publik | WP-31 | MMK-07 |
| I-14 | Endpoint layar TV tidak mengembalikan nama pengunjung | unit/api | panggil endpoint layar; periksa payload **tidak** memuat kolom nama | WP-29 | DSP-06 |
| I-15 | Pengaduan integritas tak terbaca `petugas`/`front_office` | rls | login petugas & FO, baca `pengaduan.jalur='integritas'` → 0 baris/ditolak | WP-12 | CMP-06 |
| I-16 | Bot tidak mengutip dokumen `dicabut` | db/unit | tandai dokumen `dicabut`; `match_dokumen()` tidak mengembalikannya | WP-27 | BOT-05 |
| I-17 | Setiap jawaban bot punya penanda jenis | unit | setiap pesan bot memiliki `jenis_jawaban` ∈ {resmi, umum} | WP-25/27 | BOT-06 |
| I-18 | FAQ diubah tidak dicari dengan embedding lama | db/unit | edit FAQ → `perlu_embed_ulang=true`; setelah re-embed jawaban baru muncul | WP-04 | BOT-11 |
| I-19 | Pengaturan `boleh_diubah_dashboard=false` tak berubah via dashboard | rls/api | Admin mencoba ubah kunci terlarang via API dashboard → ditolak | WP-26 | CMS-04 |
| I-20 | Setiap ekspor ber-PII menghasilkan 1 baris `audit_log` | db | jalankan ekspor; cek 1 baris audit dengan siapa/kapan/rentang/jumlah | WP-30 | RPT-06 |
| I-21 | Semua batas hari dihitung Asia/Jakarta | unit | `todayWIB()` pada 23:50 & 00:10 WIB → tanggal WIB benar | WP-01 | RPT-07 |
| I-22 | Petugas nonaktif tidak bisa login/memanggil antrean | rls/api | set `aktif=false`; login & aksi antrean → ditolak | WP-06 | RBA-06/08 |
| I-23 | Pemegang akun lama tidak bisa login setelah ganti PIC | e2e/api | jalankan pergantian; sesi lama yang masih terbuka → diakhiri | WP-19 | RBA-07 |
| I-24 | Angka metrik identik di dashboard, PDF, Excel | unit | hitung metrik yang sama lewat lapisan tunggal; bandingkan 3 penyaji | WP-30 | RPT-01 |

---

## B. UJI SKENARIO UJUNG-KE-UJUNG (SK-01 .. SK-32)

| SK | Skenario | Jenis | Harapan yang diverifikasi | WP |
|---|---|---|---|---|
| SK-01 | Reservasi normal sampai selesai | e2e | 1 kunjungan, 1 tiket, status `selesai`; rekap 1 pengunjung + 1 layanan | WP-16/22/30 |
| SK-02 | Satu kunjungan, tiga layanan | e2e | 1 kunjungan, 3 tiket prefiks beda; rekap 1 pengunjung + 3 layanan (I-03) | WP-22 |
| SK-03 | Tiket tambahan tanpa isi data ulang | e2e | scan QR → tambah layanan ke-2 tanpa identitas ulang; terkait kunjungan sama | WP-22 |
| SK-04 | Petugas alpa padahal ada reservasi | db+e2e | status `alpa`; 4 email dini; 4 tiket `tidak_terlayani`; eskalasi atasan+FO; laporan mencatat warga terdampak | WP-17/18 |
| SK-05 | Reservasi di luar hari jadwal ditolak | e2e | ditolak; pesan menyebut "hanya hari X"; tawaran jadwal terdekat + live chat | WP-16 |
| SK-06 | Dua orang check-in bersamaan | db | dua nomor berbeda, tanpa error/duplikat (I-01) — **konkurensi nyata** | WP-05 |
| SK-07 | Dua petugas mengklaim tiket sama | db/rls | satu berhasil, satu dapat pesan "sudah diambil" tanpa error mentah (I-02) | WP-22 |
| SK-08 | Batas ambil nomor | e2e | datang 15:05 → dapat nomor+estimasi; 15:15 → ditolak + tawaran reservasi/chat | WP-23 |
| SK-09 | Jam tutup efektif bergeser | e2e | petugas pulang 14:00 → datang 14:10 ditolak; tiket menunggu `tidak_terlayani`; TV tutup | WP-17/23 |
| SK-10 | Antrean sisa saat jam tutup | e2e | 5 tiket `menunggu` tetap bisa dilayani; jam selesai aktual tercatat; tidak dihanguskan | WP-23 |
| SK-11 | Chat ditinggal lalu dilanjut | e2e | utas sama berlanjut dengan seluruh riwayat; notifikasi saat tidak aktif | WP-25 |
| SK-12 | Chat saat loket libur | e2e | chat tetap bisa dibuka; bot menyebut jadwal; pesan tersimpan | WP-25 |
| SK-13 | Bot tidak menemukan sumber | e2e | bot tidak mengarang; menawarkan petugas; ditandai "informasi umum"; masuk usulan FAQ | WP-27 |
| SK-14 | Bot mengutip dengan rujukan | e2e | jawaban memuat nomor/tahun/pasal; "informasi resmi"; sumber ditampilkan; tanpa kesimpulan tambahan | WP-27 |
| SK-15 | Dokumen dicabut | db/e2e | bot tidak mengutip dokumen `dicabut` (I-16) | WP-27 |
| SK-16 | FAQ diedit lalu dicari | db/e2e | pencarian tidak mengembalikan versi lama; embedding diperbarui (I-18) | WP-04 |
| SK-17 | Listing UMKM diubah setelah tayang | e2e | ubah nama usaha → `pending_review`; ubah deskripsi kecil → tetap tayang | WP-31 |
| SK-18 | Listing kedaluwarsa | db | pengingat 2 minggu; setelah lewat → `expired` & hilang dari publik (I-13) | WP-31 |
| SK-19 | Berkas legalitas tidak bocor | api/storage | akses tanpa auth → ditolak; NIB tidak muncul di `v_umkm_public` (I-11) | WP-31 |
| SK-20 | Dokumen IPRO tanpa login | api | gambar **selalu** berwatermark (dibakar); verifikasi dengan mengunduh gambar, bukan tampilan | WP-03 |
| SK-21 | Peta potensi tanpa login | e2e | ditolak/diminta login; UMKM & galeri tetap terbuka | WP-32 |
| SK-22 | Layar TV | e2e | semua loket tampil; loket tutup + jadwal; **tidak ada nama di payload**; penanda waktu; sambung ulang/polling | WP-29 |
| SK-23 | Pengaduan integritas tidak terlihat petugas | rls | petugas & FO tidak bisa membaca; Admin bisa (I-15) | WP-12 |
| SK-24 | SLA pengaduan terlampaui | db | setelah 14 hari kerja → naik ke Admin/pimpinan, bukan mengingatkan pelaksana | WP-12 |
| SK-25 | Pelacakan pengaduan tanpa login | e2e/api | bisa dilacak tiket+kontak; nomor tak bisa ditebak berurutan; rate limit | WP-12 |
| SK-26 | Pergantian PIC | e2e | pemegang lama tidak bisa login (sesi terbuka diuji); undangan terkirim; audit berisi garis waktu; email `layanan_kontak` tak berubah | WP-19 |
| SK-27 | FO menonaktifkan akun | e2e | FO menonaktifkan dengan alasan; **tidak bisa** mengaktifkan kembali; Admin diberi tahu; riwayat utuh | WP-06/19 |
| SK-28 | Pengaturan terlarang | api/rls | ubah penjaga bot via dashboard sebagai Admin → ditolak (I-19) | WP-26 |
| SK-29 | Kembalikan versi konten | e2e | ubah halaman utama → kembalikan ke versi sebelumnya (CMS-03) | WP-26 |
| SK-30 | Konsistensi angka rekap | unit | rekap rentang sama di dashboard, PDF, Excel → identik (I-24) | WP-30 |
| SK-31 | Batas hari Asia/Jakarta | unit | check-in 23:50 & 00:10 WIB → hari kalender benar; reset tengah malam WIB (bukan 07:00) | WP-01 |
| SK-32 | Buku tamu | e2e | tidak dapat nomor; tidak muncul di rekap kunjungan layanan; tanda tangan SVG path beberapa KB; tak bisa diakses tanpa auth | WP-21 |

---

## C. CAKUPAN & KEWAJIBAN EKSEKUSI

- **Setiap WP wajib** menuliskan tes yang dirujuk (kolom "Tes yang wajib ditulis" di 05) dan **lulus** sebelum WP dinyatakan selesai (aturan Bagian 8.5 #3).
- **Wajib konkurensi nyata** untuk SK-06 & I-02 (bukan berurutan).
- **Wajib perilaku RLS (SEC-04)** untuk I-05, I-15, I-19, I-22 dan SK-23 — bukan hanya static parsing.
- **Wajib bukti unduhan gambar** untuk SK-20 (membuktikan watermark terbakar, bukan overlay).
- `eslint --max-warnings=0` + `vitest run` + `tsc --noEmit` wajib hijau per WP (skrip `verify:baseline`).
- Uji **e2e penuh** menunggu SEC-16 (Playwright) bila disetujui; sampai itu, alur kritis diverifikasi dengan tes db/rls/api + verifikasi manual terstruktur.

---

**BERHENTI DI SINI.** Menunggu persetujuan manusia sebelum melanjutkan ke **Fase E (Eksekusi)**.
