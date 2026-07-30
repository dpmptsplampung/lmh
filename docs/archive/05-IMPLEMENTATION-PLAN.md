# 05 — RENCANA IMPLEMENTASI (FASE D)

> Daftar **work package (WP)** berurutan sesuai **Bagian 9** spec (Fase 0 → 7). Dibuat untuk memenuhi **Bagian 8.4**.
> Dasar: `02-TARGET-DESIGN.md`, `03-DATA-MODEL.md`, `04-RBAC-MATRIX.md`, `01-GAP-ANALYSIS.md`.
>
> **Aturan:** WP berukuran maksimal **satu penerapan**; yang tidak bisa diterapkan sendirian dipecah. Setiap WP menyebut **ID keputusan** yang dipenuhi (aturan 0.2 #5). Migrasi **aditif** (OPS-01); penerapan berisiko **di luar jam layanan** (OPS-03); setiap WP punya **rencana pengembalian teruji** (OPS-04).
>
> **Prasyarat keras sebelum Fase 3 (antrean):** WP-02 (observability) & WP-11 (prosedur cadangan manual) **wajib selesai** (OPS-06, OPS-05, Bagian 9.3).
>
> **Konvensi nama migrasi:** `2026MMDDNNNN_nama` (lanjutan dari `202607280005`). Tanggal diisi saat eksekusi; di sini dipakai placeholder `NNNN` urut logis.

---

## FASE 0 — Bisa dikerjakan sekarang, tanpa menyentuh antrean

### WP-01 — Perbaiki bug zona waktu Asia/Jakarta
```
Memenuhi keputusan : RPT-07 (prasyarat QUE-15, SCH-05, SCH-10, RPT-05, SVC-05)
Fase               : 0
Ukuran             : S
Bergantung pada    : —
Menyentuh data live: Tidak (logika klien/server)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** tidak ada.
**Perubahan kode:**
- `src/lib/time.ts` (BARU): helper `todayWIB()`, `nowWIB()`, `toWIBDateString(date)` memakai `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'})`.
- Ganti `new Date().toISOString().split('T')[0]` → `todayWIB()` di: `admin/antrian/page.tsx:43`, `admin/absensi/page.tsx:42,121,209`, `admin/page.tsx:118`, `admin/kunjungan/page.tsx:40`, `me/page.tsx:105`, `me/reservasi/page.tsx:59`.
**Kriteria penerimaan:** "hari ini" identik antara klien & view `v_antrian_loket` pada jam 00:00–07:00 WIB (I-21, SK-31).
**Tes:** unit test `time.ts` (mock Date, kasus 23:50 & 00:10 WIB); SK-31.
**Cara mengembalikan:** revert commit (helper baru, tanpa migrasi DB).
**Verifikasi pasca-tayang:** FO cek dashboard pukul <07:00 WIB menampilkan tanggal WIB yang benar.

### WP-02 — Observability: error tracking + alerting + SLO
```
Memenuhi keputusan : SEC-03, OPS-06
Fase               : 0
Ukuran             : M
Bergantung pada    : —
Menyentuh data live: Tidak
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** tidak ada.
**Perubahan kode:**
- Integrasi error tracking (misal Sentry) di `instrumentation.ts` + tangkap error route handlers. **Catatan dependensi baru:** `@sentry/nextjs` — dicatat sebagai keputusan terpisah (aturan 0.2 #10) dengan alternatif: endpoint `logServerEvent` → layanan log terkelola tanpa dependensi (pilih saat eksekusi dengan persetujuan).
- `src/lib/observability/logger.ts`: tambah pengiriman ke sink eksternal (bukan hanya `console.*`), pertahankan sanitasi PII.
- Alerting dasar (error rate, kegagalan check-in) + SLO sederhana di `docs/OBSERVABILITY.md`.
**Kriteria penerimaan:** kegagalan memicu alert tanpa menunggu keluhan warga; PII tidak bocor ke log.
**Tes:** unit test logger (sanitasi); uji tembak error → alert masuk.
**Cara mengembalikan:** nonaktifkan DSN (env); revert.
**Verifikasi pasca-tayang:** picu error uji di staging, pastikan alert tiba.

### WP-03 — Tutup kebocoran & perbaiki watermark dokumen IPRO
```
Memenuhi keputusan : SEC-05, INV-04
Fase               : 0
Ukuran             : S
Bergantung pada    : —
Menyentuh data live: Tidak
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** tidak ada.
**Perubahan kode:**
- `src/app/api/investment-docs/page-image/route.ts:185`: isi watermark — pengguna **login** → `nama + email` (ambil dari `pengunjung` via sesi); **anonim** → `waktu + penanda sesi` (bukan ipHash).
- Ganti rate limit in-memory (`:17`) → pakai `check_anon_rate`/tabel agar efektif multi-instance.
**Kriteria penerimaan:** gambar unduhan memuat identitas peminta (SK-20); tidak ada jalur tanpa watermark.
**Tes:** SK-20 (unduh gambar & verifikasi watermark terbakar); unit test isi watermark login vs anonim.
**Cara mengembalikan:** revert (mengembalikan watermark lama).
**Verifikasi pasca-tayang:** unduh halaman IPRO login & anonim, periksa teks watermark.

### WP-04 — Perbaiki pipeline embedding FAQ (+ mismatch dimensi)
```
Memenuhi keputusan : BOT-11, SEC-08, TB-01 (bagian dari BOT-14)
Fase               : 0
Ukuran             : S
Bergantung pada    : —
Menyentuh data live: Ya (kolom baru faq_knowledge_base; re-embed)
Jendela penerapan  : di luar jam layanan (re-embed)
```
**Perubahan basis data:** `2026MMDDNNNN_faq_reembed.sql` — tambah `perlu_embed_ulang`, `embedding_updated_at`, `diubah_oleh` (03 §A.7); trigger `UPDATE` pertanyaan/jawaban → set `perlu_embed_ulang=true`. Samakan dimensi: set `GEMINI_EMBEDDING_MODEL=text-embedding-004` (768) **atau** migrasi kolom ke 3072 (keputusan diambil saat eksekusi; default aman = 768).
**Perubahan kode:**
- `api/admin/faq/embed/route.ts:63` → proses `embedding IS NULL OR perlu_embed_ulang`; set `perlu_embed_ulang=false`, `embedding_updated_at=now()` setelah sukses.
- pg_cron `reembed_faq` (jadwal malam) memanggil endpoint/fungsi embed (bukan hanya tombol manual).
**Kriteria penerimaan:** edit FAQ → jawaban baru yang muncul (bukan versi lama) (I-18, SK-16).
**Tes:** SK-16; unit test endpoint memproses `perlu_embed_ulang`.
**Cara mengembalikan:** kolom aditif bisa diabaikan; matikan cron.
**Verifikasi pasca-tayang:** edit 1 FAQ uji, jalankan embed, tanyakan ke bot.

### WP-05 — Penomoran antrean atomik (fondasi nomor)
```
Memenuhi keputusan : QUE-06, SVC-05 (sebagian: penomoran; tampilan nomor di WP Fase 3)
Fase               : 0
Ukuran             : M
Bergantung pada    : WP-01 (tanggal WIB)
Menyentuh data live: Ya (tabel baru antrean_counter; TIDAK mengubah visit)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_antrean_counter.sql` — tabel `antrean_counter` + fungsi `terbit_nomor_antrean()` + kolom `layanan.prefiks_antrean`, `layanan.nomor_loket` (03 §A.1/B.3). **Tidak** mengubah alur `visit` yang ada (fondasi saja; penggunaan nomor penuh di Fase 3).
**Perubahan kode:** tidak ada perubahan perilaku (fondasi DB + seed prefiks/loket).
**Kriteria penerimaan:** dua panggilan `terbit_nomor_antrean` bersamaan → dua nomor berbeda (I-01, SK-06).
**Tes:** tes konkurensi nyata (SK-06) terhadap fungsi DB.
**Cara mengembalikan:** tabel/fungsi aditif bisa diabaikan.
**Verifikasi pasca-tayang:** jalankan uji konkurensi di staging.

### WP-06 — Kolom aktif/nonaktif petugas
```
Memenuhi keputusan : RBA-06 (fondasi RBA-08, I-22)
Fase               : 0
Ukuran             : XS
Bergantung pada    : —
Menyentuh data live: Ya (kolom baru petugas)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** `2026MMDDNNNN_petugas_aktif.sql` — tambah `aktif`, `nonaktif_sejak`, `nonaktif_oleh`, `nonaktif_alasan` (03 §A.2). Guard: petugas nonaktif tidak bisa login/aksi (cek di `get_my_role()` / middleware).
**Perubahan kode:** `proxy.ts` + `AdminGuard` menolak petugas `aktif=false` (I-22).
**Kriteria penerimaan:** petugas nonaktif ditolak login (I-22, bagian SK-27).
**Tes:** unit test guard; SK-27 (bagian).
**Cara mengembalikan:** kolom aditif bisa diabaikan.
**Verifikasi pasca-tayang:** nonaktifkan akun uji, coba login.

### WP-07 — Pembekuan jadwal harian
```
Memenuhi keputusan : SCH-05 (fondasi SCH-10, NOT-07, I-08)
Fase               : 0
Ukuran             : M
Bergantung pada    : WP-01; tabel jadwal (WP-13)
Menyentuh data live: Ya (tabel baru jadwal_harian_beku)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_jadwal_harian_beku.sql` — tabel `jadwal_harian_beku` (03 §B.7) + fungsi pembeku `bekukan_jadwal(tanggal)` + pg_cron malam.
**Perubahan kode:** tidak ada UI (fondasi data kepatuhan; data tidak bisa dibuat surut).
**Kriteria penerimaan:** setiap malam terisi snapshot esok; baris tidak berubah setelah dibuat (I-08).
**Tes:** unit test fungsi pembeku; uji I-08 (coba UPDATE → ditolak).
**Cara mengembalikan:** matikan cron; tabel aditif diabaikan.
**Verifikasi pasca-tayang:** cek baris beku esok hari terisi.

### WP-08 — Catat response rate SKM
```
Memenuhi keputusan : SRV-03, SEC-15 (sebagian)
Fase               : 0
Ukuran             : XS
Bergantung pada    : —
Menyentuh data live: Ya (kolom penghitung)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** `2026MMDDNNNN_skm_response_rate.sql` — kolom penghitung `layanan_hari`/agregat atau tabel kecil `skm_response_rate(tanggal, layanan_id, dilayani, mengisi)` (murah; data tak bisa dibuat surut).
**Perubahan kode:** catat `dilayani` saat tiket selesai & `mengisi` saat submit SKM.
**Kriteria penerimaan:** response rate mulai tercatat sejak tayang.
**Tes:** unit test pencatatan.
**Cara mengembalikan:** aditif, diabaikan.
**Verifikasi pasca-tayang:** cek baris response rate hari berjalan.

### WP-09 — Tes RLS berbasis perilaku
```
Memenuhi keputusan : SEC-04 (fondasi semua kerja RBAC & CMP-06)
Fase               : 0
Ukuran             : M
Bergantung pada    : —
Menyentuh data live: Tidak (tes)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** tidak ada.
**Perubahan kode:** `tests/rls/` — harness tes perilaku dengan token nyata per peran (admin/fo/petugas/pengunjung/anon) terhadap kebijakan kritis yang ada & yang akan datang.
**Kriteria penerimaan:** tes RLS perilaku berjalan di CI; mendeteksi kebijakan yang tidak bekerja.
**Tes:** kasus per-peran untuk tabel inti (visit, petugas, chat, faq, listing).
**Cara mengembalikan:** hapus folder tes.
**Verifikasi pasca-tayang:** CI hijau; laporan cakupan RLS.

### WP-10 — Tegakkan CSP
```
Memenuhi keputusan : SEC-01
Fase               : 0
Ukuran             : XS
Bergantung pada    : bersihkan pelanggaran dari laporan Report-Only
Menyentuh data live: Tidak
Jendela penerapan  : kapan saja
```
**Perubahan kode:** `next.config.ts:54` — ganti `Content-Security-Policy-Report-Only` → `Content-Security-Policy` setelah pelanggaran dibersihkan.
**Kriteria penerimaan:** header CSP menegakkan; tidak ada pelanggaran fungsional.
**Tes:** uji header + smoke halaman utama.
**Cara mengembalikan:** kembalikan ke Report-Only.
**Verifikasi pasca-tayang:** cek header respons & konsol browser.

### WP-11 — Prosedur cadangan manual FO
```
Memenuhi keputusan : OPS-05 (prasyarat Fase 3)
Fase               : 0
Ukuran             : XS
Bergantung pada    : —
Menyentuh data live: Tidak
Jendela penerapan  : kapan saja
```
**Perubahan kode:** `docs/CADANGAN_MANUAL_FO.md` (BARU) — nomor antrean cetak/tulis, formulir buku tamu kertas, cara input data kemudian saat sistem pulih.
**Kriteria penerimaan:** dokumen disetujui FO & tersedia di meja depan.
**Tes:** tidak ada (dokumen).
**Cara mengembalikan:** — (dokumen).
**Verifikasi pasca-tayang:** simulasi FO bekerja manual 15 menit.

---

## FASE 1 — Kewajiban hukum (UU 25/2009)

### WP-12 — Kanal pengaduan lengkap (dua jalur)
```
Memenuhi keputusan : CMP-01..08, OQ-05 (hari libur), OQ-07 (format tiket)
Fase               : 1
Ukuran             : L
Bergantung pada    : WP-09 (tes RLS untuk jalur integritas), WP-06 (FO), WP-13 (hari libur)
Menyentuh data live: Ya (tabel baru pengaduan + bucket)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_pengaduan.sql` — tabel `pengaduan`, `pengaduan_riwayat`, `hari_libur` (03 §B.10/B.18) + bucket privat `pengaduan-bukti` + fungsi SLA hari kerja + **generator nomor tiket `P` + kode acak** (OQ-07, misal `P7K2N9X` — BUKAN berurutan, sesuai keputusan pemilik setelah diingatkan risiko penebakan jalur integritas).
**Catatan kanal lama (OQ-10):** kanal pengaduan/survei/review DPMPTSP saat ini berjalan TERPISAH di luar LMH dan ke depan akan disatukan. WP ini membangun kanal baru di LMH; **migrasi data dari kanal lama di luar cakupan WP ini** (keputusan penyatuan terpisah nanti).
**Perubahan kode:**
- Publik: `/pengaduan` (buat), `/pengaduan/lacak` (tiket+kontak, rate limit) — CMP-05.
- Admin/FO: `/admin/pengaduan` (jalur layanan) & `/admin/pengaduan/integritas` (**hanya Admin**) — CMP-02/CMP-06.
- Tombol "jadikan pengaduan" dari chat (CMP-08).
**Kriteria penerimaan:** SK-23, SK-24, SK-25; I-15 (integritas tak terbaca petugas/FO).
**Tes:** SK-23 (RLS perilaku integritas), SK-24 (eskalasi SLA), SK-25 (lacak tanpa login + rate limit).
**Cara mengembalikan:** tabel aditif diabaikan; nonaktifkan rute.
**Verifikasi pasca-tayang:** buat pengaduan uji kedua jalur; cek visibilitas per peran.

### WP-13 — Standar Pelayanan & Maklumat + hari libur
```
Memenuhi keputusan : CMP-09, OQ-05; fondasi SCH-04/CMP-03
Fase               : 1
Ukuran             : M
Bergantung pada    : WP-26 (CMS) untuk pengelolaan konten
Menyentuh data live: Ya (tabel baru)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** `2026MMDDNNNN_standar_pelayanan.sql` — tabel `standar_pelayanan` (03 §B.11) + `hari_libur` (03 §B.18).
**Perubahan kode:** halaman publik `/standar-pelayanan` per layanan + Maklumat; isi jadi bahan bot (fase 4).
**Kriteria penerimaan:** halaman publik tampil per layanan; memuat 6 elemen wajib + maklumat.
**Tes:** render halaman; validasi konten wajib.
**Cara mengembalikan:** aditif, nonaktifkan rute.
**Verifikasi pasca-tayang:** cek halaman per layanan.

### WP-14 — Klausul penafian matchmaking + ungkap pencatatan perilaku
```
Memenuhi keputusan : MMK-09, INV-06, SEC-14 (sebagian: PII audit_log)
Fase               : 1
Ukuran             : XS
Bergantung pada    : —
Menyentuh data live: Tidak
Jendela penerapan  : kapan saja
```
**Perubahan kode:** teks penafian di `/umkm`; ungkap pencatatan perilaku di `/kebijakan-privasi` + catat `consent_log`; sanitasi `audit_log.detail` agar tidak membawa PII.
**Kriteria penerimaan:** penafian tampil; kebijakan privasi menyebut pencatatan perilaku; PII tak masuk audit_log.
**Tes:** render; unit test sanitasi audit detail.
**Cara mengembalikan:** revert teks.
**Verifikasi pasca-tayang:** cek halaman & sampel audit_log.

---

## FASE 2 — Fondasi kepatuhan petugas

### WP-15 — Peran `front_office` (prasyarat banyak wewenang FO)
```
Memenuhi keputusan : RBA-02, RBA-01 (fondasi SCH-06/08, CHT-08, GST-04, CMP-02, RBA-08/10)
Fase               : 2
Ukuran             : M
Bergantung pada    : WP-06, WP-09
Menyentuh data live: Ya (CHECK role + RLS)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_role_front_office.sql` — perluas CHECK `petugas.role` (03 §A.2); perbarui RLS terkait lintas-layanan FO.
**Perubahan kode:** `constants.ts:87`, `admin-nav.ts:5,17-36`, `AdminGuard.tsx`, `set_user_role_claim()`, `get_my_role()`; OPS-08: cari semua pemetaan `role` di TS (badge, filter, nav).
**Kriteria penerimaan:** akun FO mengakses wewenang lintas-layanan; petugas tetap terbatas layanannya.
**Tes:** SK-27 (bagian), tes perilaku RLS FO vs petugas.
**Cara mengembalikan:** CHECK diperluas (aditif nilai) — aman; revert kode.
**Verifikasi pasca-tayang:** login sebagai FO uji, akses antrean/absensi/chat lintas layanan.

### WP-16 — Struktur jadwal standby + pemblokir pendaftaran
```
Memenuhi keputusan : SCH-01, SCH-04, SCH-11, OQ-04 (jam layanan)
Fase               : 2
Ukuran             : L
Bergantung pada    : WP-01, WP-15
Menyentuh data live: Ya (tabel baru + migrasi dari layanan_jadwal)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_jadwal_standby.sql` — tabel `jadwal_standby`, `jadwal_pengecualian` (03 §B.6) + fungsi `jadwal_berikutnya(layanan_id, dari_tanggal)` + backfill dari `layanan_jadwal`/`layanan_libur` + **isi jadwal P4 nyata** (misal BPJS hanya Senin). **Jam layanan resmi: 08:00–15:30** (keputusan pemilik, mengoreksi data live 08:00–16:00).
**Perubahan kode:** validasi reservasi & check-in memakai `jadwal_berikutnya()`; pesan penolakan menyebut jadwal terdekat + alternatif (P3, SK-05).
**Kriteria penerimaan:** SK-05 (reservasi di luar hari ditolak + jadwal terdekat + tawaran chat); I-06.
**Tes:** SK-05, unit test `jadwal_berikutnya`.
**Cara mengembalikan:** tabel aditif; kembali ke `layanan_jadwal`.
**Verifikasi pasca-tayang:** coba reservasi di luar hari jadwal → pesan benar.

### WP-17 — Absensi sebagai gerbang antrean (jam server + alpa)
```
Memenuhi keputusan : SCH-02, SCH-08, SCH-09, SCH-10, QUE-08 (tidak_terlayani), OQ-03 (batas alpa)
Fase               : 2
Ukuran             : L
Bergantung pada    : WP-01, WP-07, WP-15, WP-16
Menyentuh data live: Ya (kolom absensi + status + layanan_hari)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_absensi_gerbang.sql` — kolom `absensi_petugas.sumber/dicatat_oleh`, status `alpa`, tabel `layanan_hari` (03 §A.4/B.8); fungsi `catat_absensi()` (jam dari **server**, I-09); pg_cron alpa pada batas (**default 10:00 WIB**, dapat diatur Admin via `site_settings` kunci `batas_jam_alpa`, OQ-12) + absen keluar otomatis; enum visit `tidak_terlayani` (03 §A.3) — OPS-08.
**Perubahan kode:** perbaiki `admin/absensi/page.tsx` agar jam dari server; gerbang antrean (tiket tidak terbit bila belum absen, I-05); tombol FO "petugas sudah pulang" → tutup loket + tiket menunggu → `tidak_terlayani`; email dini ke warga saat alpa (dengan `layanan_kontak`).
**Kriteria penerimaan:** SK-04 (alpa → email dini + `tidak_terlayani` + eskalasi); SK-09 (pulang lebih awal); I-05, I-09.
**Tes:** SK-04, SK-09; unit test jam server; tes enum mapping `tidak_terlayani`.
**Cara mengembalikan:** matikan cron; kolom/status aditif diabaikan.
**Verifikasi pasca-tayang:** simulasi petugas tidak absen pada hari berjadwal.

### WP-18 — Notifikasi petugas bersyarat + eskalasi berjenjang + kontak instansi
```
Memenuhi keputusan : NOT-01..07, SVC-06
Fase               : 2
Ukuran             : L
Bergantung pada    : WP-17, WP-07
Menyentuh data live: Ya (tabel layanan_kontak + notifikasi)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_layanan_kontak.sql` — tabel `layanan_kontak` (03 §B.5); pg_cron H-1/pagi/eskalasi menulis ke `notifikasi` dengan `idempotency_key=layanan_id+tanggal+jenis` (NOT-05); fungsi hitung metrik kepatuhan (NOT-07).
**Perubahan kode:** template email H-1/pagi/eskalasi; dua varian laporan (internal vs P4, NOT-06) menyebut **nama layanan, bukan orang**.
**Kriteria penerimaan:** pengingat hanya jika 3 syarat (NOT-02); eskalasi ke atasan+FO setelah batas (NOT-04); laporan memuat warga terdampak (NOT-07).
**Tes:** SK-04 (bagian email/eskalasi); unit test idempotency & syarat NOT-02.
**Cara mengembalikan:** matikan cron; tabel aditif diabaikan.
**Verifikasi pasca-tayang:** pantau email H-1/pagi pada layanan berjadwal.

### WP-19 — FO menonaktifkan akun satu arah + pergantian PIC (reset password Admin)
```
Memenuhi keputusan : RBA-08, RBA-07, RBA-09
Fase               : 2
Ukuran             : M
Bergantung pada    : WP-06, WP-15, WP-18
Menyentuh data live: Ya (status petugas + audit)
Jendela penerapan  : kapan saja
```
**Perubahan kode:** aksi Admin "ganti pemegang akun" (reset password + kirim undangan ke pemegang baru + **akhiri sesi pemegang lama**, I-23); aksi FO "nonaktifkan" (satu arah, wajib alasan, Admin diberi tahu, RBA-08); audit log = garis waktu pemegang. `AGENTS.md` diselaraskan (BT-06).
**Kriteria penerimaan:** SK-26 (pemegang lama tidak bisa login), SK-27 (FO nonaktifkan, tidak bisa aktifkan kembali); I-22, I-23.
**Tes:** SK-26, SK-27.
**Cara mengembalikan:** Admin mengaktifkan kembali secara manual.
**Verifikasi pasca-tayang:** uji pergantian PIC pada akun uji.

---

## FASE 3 — Pemecahan model kunjungan (PALING BERISIKO — ikuti OPS-01/OPS-02 penuh)

> **Prasyarat keras:** WP-02 (observability) & WP-11 (cadangan manual) selesai.

### WP-20 — Buat struktur `kunjungan` + `tiket_antrean` (Langkah 1 TAMBAH)
```
Memenuhi keputusan : QUE-01 (fondasi), GST-01 (fondasi), SVC-03, QUE-16
Fase               : 3
Ukuran             : L
Bergantung pada    : WP-02, WP-11, WP-05
Menyentuh data live: Ya (tabel baru, kosong)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_kunjungan_tiket.sql` — tabel `kunjungan`, `tiket_antrean` (03 §B.1/B.2) + RLS + kolom `layanan.penyerta/status_tampilan/bendera/kuota_harian` (03 §A.1, SVC-02/03, QUE-16).
**Perubahan kode:** tidak ada perubahan perilaku (struktur kosong).
**Kriteria penerimaan:** tabel terbuat dengan constraint & RLS benar (I-01, I-10).
**Tes:** tes RLS perilaku kunjungan/tiket.
**Cara mengembalikan:** tabel aditif diabaikan.

### WP-21 — Backfill + dual write (Langkah 2 ISI)
```
Memenuhi keputusan : QUE-01, QUE-04, GST-01, GST-03, OPS-02
Fase               : 3
Ukuran             : L
Bergantung pada    : WP-20
Menyentuh data live: Ya (backfill baris visit)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data (dua migrasi terpisah):**

- `202607300014_buku_tamu.sql` (M15) — tabel `buku_tamu` + RLS (FO & Admin); FK `legacy_visit_id` ke `visit`.
- `202607300015_backfill_kunjungan_dual_write.sql` (M16):
  - Kolom `legacy_visit_id` pada `kunjungan` dan `tiket_antrean` (UNIQUE, opsional).
  - Tabel `wp21_backfill_ledger` (satu baris per visit sumber; RLS admin-read saja).
  - Backfill: setiap `visit.tujuan='loket'` → satu `kunjungan`; visit eligible (status≠`terjadwal` **dan** origin cocok M16) → satu `tiket_antrean`; setiap `visit.tujuan='bertemu_seseorang'` **dengan `waktu_scan IS NOT NULL`** → satu `buku_tamu` (QUE-04/GST-03: **hanya kedatangan fisik**).
  - Repair counter: `antrean_counter` di-upsert ke `MAX(nomor)` per layanan/tanggal.
  - Trigger atomik `trg_visit_dual_write` + fungsi `sync_visit_dual_write()` (SECURITY DEFINER): setiap perubahan `visit` menulis sinkron ke `kunjungan`/`tiket_antrean`/`buku_tamu`. **Tiket reservasi diterbitkan saat scan** (`terjadwal→menunggu` dengan `waktu_scan IS NOT NULL`, QUE-04) — **bukan saat reservasi dibuat**. Buku tamu hanya saat kedatangan fisik (scan pertama meeting visit, GST-03).
  - `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.

**Perubahan kode:** tidak ada perubahan alur kode (semua penulisan ganda di trigger DB).
**Kriteria penerimaan:** `wp21_backfill_ledger` terisi lengkap tanpa orphan; dual write konsisten (I-03); tiket/buku_tamu tidak terbit sebelum scan.
**Tes:** `supabase/migrations/kunjungan_dual_write.test.ts` (kontrak statis M15/M16); `scripts/selftest-wp21.mjs` (verifier operasional).
**Cara mengembalikan:** `TRUNCATE kunjungan, tiket_antrean, buku_tamu, wp21_backfill_ledger` (data sumber `visit` tidak disentuh; `wp21_backfill_ledger` membuktikan setiap baris bisa dilacak kembali); matikan trigger `trg_visit_dual_write`.

### WP-22 — Pindahkan pembacaan per halaman (Langkah 3 PINDAH)
```
Memenuhi keputusan : QUE-01..05, QUE-13, QUE-15, OPS-02
Fase               : 3
Ukuran             : XL (dipecah per halaman)
Bergantung pada    : WP-21
Menyentuh data live: Ya (baca pindah)
Jendela penerapan  : di luar jam layanan, bertahap
```
**Perubahan kode:** pindahkan pembacaan ke `kunjungan`/`tiket_antrean` **per halaman mulai dari yang paling jarang dipakai** → `/checkin` & dashboard antrean **terakhir**. Terapkan QUE-02/03 (multi-tiket, tambah tanpa isi ulang), QUE-04 (nomor saat check-in), QUE-13 (estimasi saat beri nomor), QUE-15 (`no_show` otomatis via cron).
**Kriteria penerimaan:** SK-01, SK-02, SK-03, SK-08, SK-10, SK-31; I-03, I-04, I-07.
**Tes:** SK-01/02/03/06/08/10/31.
**Cara mengembalikan:** kembalikan pembacaan ke `visit` per halaman (dual write masih mengisi keduanya).
**Verifikasi pasca-tayang:** pantau check-in nyata 1 hari penuh sebelum lanjut halaman berikutnya.

### WP-23 — Aturan akhir hari + batas ambil nomor + panggil ulang
```
Memenuhi keputusan : QUE-09, QUE-10, QUE-11, QUE-12, QUE-14, QUE-17, DSP-08 (hook peristiwa)
Fase               : 3
Ukuran             : L
Bergantung pada    : WP-22, WP-17
Menyentuh data live: Ya
Jendela penerapan  : di luar jam layanan
```
**Perubahan kode:** batas ambil nomor per layanan dari **jam tutup efektif** (`layanan_hari`); penolakan dengan jalan lain (QUE-12); catat `jam_selesai_aktual`; **panggil ulang** (QUE-17) yang **menerbitkan peristiwa `nomor_dipanggil`** (untuk DSP-08 nanti).
**Kriteria penerimaan:** SK-08, SK-09, SK-10; QUE-17 berfungsi; tidak ada tiket `menunggu` hangus (QUE-09/I-04).
**Tes:** SK-08, SK-09, SK-10; uji peristiwa `nomor_dipanggil` terpublikasi.
**Cara mengembalikan:** nonaktifkan batas/panggil ulang; tiket tetap bisa dilayani.

### WP-24 — Hentikan penulisan ke `visit` (Langkah 4 HENTIKAN)
```
Memenuhi keputusan : QUE-01, OPS-01 (setelah ≥2 minggu stabil + persetujuan)
Fase               : 3
Ukuran             : M
Bergantung pada    : WP-22 stabil ≥2 minggu + persetujuan manusia
Menyentuh data live: Ya
Jendela penerapan  : di luar jam layanan
```
**Perubahan kode:** hentikan dual write ke `visit`. **JANGAN hapus kolom/tabel** `visit` (OPS-01/aturan 0.2 #4).
**Kriteria penerimaan:** sistem berjalan penuh di `kunjungan`+`tiket_antrean`; `visit` jadi arsip baca-saja.
**Tes:** regresi penuh SK antrean.
**Cara mengembalikan:** aktifkan kembali dual write.

---

## FASE 4 — Chat & bot bersumber dokumen

### WP-25 — Chat persisten + dashboard lama-menunggu + takeover FO + notifikasi cerdas
```
Memenuhi keputusan : CHT-01..09, CHT-11
Fase               : 4
Ukuran             : L
Bergantung pada    : WP-15, WP-16
Menyentuh data live: Ya (makna status chat_sesi)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_chat_persisten.sql` — ubah makna `chat_sesi.status` (utas berkelanjutan); kolom `jenis_jawaban` pada pesan bot (BOT-06); indeks lama-menunggu.
**Perubahan kode:** utas berlanjut di `/chat` & `/me` (CHT-01/02); dashboard `/admin/chat` urut **lama menunggu** + penanda warna (CHT-07); takeover FO (CHT-08); tekan notifikasi saat warga aktif (CHT-09); FAQ publik tanpa login + preferensi kontak + magic-link cadangan (CHT-11); bot juru bicara jadwal (CHT-04, pakai `jadwal_berikutnya`).
**Kriteria penerimaan:** SK-11, SK-12; CHT-07 urutan benar.
**Tes:** SK-11, SK-12; unit test urutan dashboard.
**Cara mengembalikan:** kembalikan makna status lama.

### WP-26 — CMS registry + riwayat versi + kunci CMS-04
```
Memenuhi keputusan : CMS-01, CMS-02, CMS-03, CMS-04, CMS-05 (prasyarat BOT-05, DSP-05, CMP-09)
Fase               : 4
Ukuran             : M
Bergantung pada    : —
Menyentuh data live: Ya (kolom site_settings + konten_versi)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** `2026MMDDNNNN_cms_registry.sql` — kolom `site_settings` (03 §A.6) + tabel `konten_versi` (03 §B.12); tandai kunci terlarang (CMS-04) `boleh_diubah_dashboard=false`.
**Perubahan kode:** registry pengaturan bertipe; riwayat versi + tombol kembalikan; **tolak perubahan kunci terlarang lewat dashboard bahkan oleh Admin** (I-19, SK-28); pengelolaan running text (DSP-05).
**Kriteria penerimaan:** SK-28, SK-29; I-19.
**Tes:** SK-28, SK-29.
**Cara mengembalikan:** kolom aditif diabaikan.

### WP-27 — Bot RAG bersumber dokumen
```
Memenuhi keputusan : BOT-01..10, BOT-12, CMS-04 (penjaga bot)
Fase               : 4
Ukuran             : XL
Bergantung pada    : WP-04, WP-13 (bahan CMP-09), WP-26 (kunci penjaga)
Menyentuh data live: Ya (tabel dokumen + potongan + embed)
Jendela penerapan  : di luar jam layanan (embed)
```
**Perubahan basis data:** `2026MMDDNNNN_dokumen_rag.sql` — tabel `dokumen_peraturan`, `dokumen_potongan` (03 §B.9) + fungsi `match_dokumen()` (filter `status='berlaku'`, I-16) + index embedding.
**Perubahan kode:** unggah dokumen petugas (tempel teks utama; PDF+pratinjau; tautan JDIH rujukan saja, BOT-07); potong per pasal/ayat (BOT-03); embed sekali saat unggah (BOT-02); jawaban mengutip + penanda jenis (BOT-05/06); tidak kutip yang dicabut (I-16, SK-15); usulan FAQ dari pertanyaan tanpa jawaban (BOT-12).
**Kriteria penerimaan:** SK-13, SK-14, SK-15, SK-16; I-16, I-17.
**Tes:** SK-13..16.
**Cara mengembalikan:** tabel aditif; bot kembali ke FAQ saja.

### WP-28 — Kualitas RAG terukur + upgrade model (terpisah)
```
Memenuhi keputusan : BOT-13, BOT-14, SEC-09, SEC-10
Fase               : 4
Ukuran             : M
Bergantung pada    : WP-04, WP-27
Menyentuh data live: Ya (re-embed total bila ganti model)
Jendela penerapan  : di luar jam layanan
```
**Perubahan kode:** golden dataset + tombol umpan balik; **WP tersendiri** untuk ganti model embedding (embed ulang total + verifikasi, BOT-14).
**Kriteria penerimaan:** metrik mutu bot tampil; ambang `match_*` teruji.
**Tes:** evaluasi golden dataset.
**Cara mengembalikan:** kembali ke model lama (embed lama dipertahankan).

---

## FASE 5 — Layar TV & rekap

### WP-29 — Layar antrean TV bertoken + tahan lama
```
Memenuhi keputusan : DSP-01..07
Fase               : 5
Ukuran             : M
Bergantung pada    : WP-22 (nomor antrean), WP-26 (running text)
Menyentuh data live: Ya (layar_token)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** `2026MMDDNNNN_layar.sql` — tabel `layar_token` (03 §B.15) + **view khusus layar tanpa kolom nama** (DSP-06/I-14).
**Perubahan kode:** grid semua loket (nomor SANGAT BESAR, sisa kecil, running text); loket tutup jelas + jadwal (DSP-04); penyambungan ulang + polling cadangan + penanda "diperbarui" (DSP-02); ketahanan berhari-hari (DSP-03); URL bertoken (DSP-07).
**Kriteria penerimaan:** SK-22; I-14 (tidak ada nama di payload).
**Tes:** SK-22; uji payload tidak memuat nama.
**Cara mengembalikan:** kembalikan `/layar-antrian` publik lama.

### WP-30 — Satu lapisan metrik + 4 penyajian + snapshot + rollup + log ekspor
```
Memenuhi keputusan : RPT-01..06, RPT-08, RBA-10
Fase               : 5
Ukuran             : L
Bergantung pada    : WP-01, WP-22
Menyentuh data live: Ya (rekap_harian_layanan, laporan_snapshot)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_rekap.sql` — tabel `rekap_harian_layanan`, `laporan_snapshot` (03 §B.13/B.14) + fungsi rollup + pg_cron.
**Perubahan kode:** lapisan metrik tunggal; penyaji PDF berkop bernomor (RPT-04), Excel/CSV, dashboard, email bulanan; **setiap ekspor ber-PII → 1 baris `audit_log`** (I-20); pandangan lintas-layanan FO (RBA-10); dokumen definisi metrik (RPT-03).
**Kriteria penerimaan:** SK-30 (angka identik di 3 penyaji); I-20, I-24.
**Tes:** SK-30; unit test konsistensi metrik.
**Cara mengembalikan:** tabel aditif; kembali ke dashboard lama.

---

## FASE 6 — Matchmaking & investasi

### WP-31 — Verifikasi UMKM tiga lapis + perlu_perbaikan + bucket privat + masa berlaku + jejak
```
Memenuhi keputusan : MMK-01..08
Fase               : 6
Ukuran             : L
Bergantung pada    : WP-01, WP-26
Menyentuh data live: Ya (kolom listing + bucket baru + cron expired)
Jendela penerapan  : di luar jam layanan
```
**Perubahan basis data:** `2026MMDDNNNN_umkm_verifikasi.sql` — kolom `listing_umkm` (03 §A.5) + tabel `umkm_verifikasi_jejak` (03 §B.16) + bucket privat `umkm-legalitas` + pg_cron expired (MMK-07).
**Perubahan kode:** status `perlu_perbaikan` + catatan (OPS-08); verifikasi 3 lapis + jejak (MMK-02/05); legalitas di bucket privat + lencana tanpa NIB/NPWP (MMK-04/I-11); verifikasi kontak menghalangi tayang (MMK-06/I-12); review ulang field kritikal pakai `snapshot_approved` (MMK-08).
**Kriteria penerimaan:** SK-17, SK-18, SK-19; I-11, I-12, I-13.
**Tes:** SK-17, SK-18, SK-19.
**Cara mengembalikan:** kolom aditif; nonaktifkan cron expired.

### WP-32 — Peta potensi + jejak minat investasi
```
Memenuhi keputusan : INV-01, INV-02, INV-03, RBA-11
Fase               : 6
Ukuran             : M
Bergantung pada    : WP-14 (INV-06)
Menyentuh data live: Ya (jejak_minat_investasi)
Jendela penerapan  : kapan saja
```
**Perubahan basis data:** `2026MMDDNNNN_jejak_investasi.sql` — tabel `jejak_minat_investasi` (03 §B.17).
**Perubahan kode:** halaman `/peta-potensi` **wajib login** (RBA-11/I-14 tidak berlaku di sini, tetapi SK-21); gerbang profil ringan (INV-03); catat penayangan/sektor/dokumen → sambung ke `investasi_lead` (INV-02).
**Kriteria penerimaan:** SK-21 (anonim ditolak; UMKM & galeri tetap terbuka).
**Tes:** SK-21.
**Cara mengembalikan:** nonaktifkan rute peta.

---

## FASE 7 — Ditunda sampai diminta (JANGAN dikerjakan)

| Keputusan | Status |
|---|---|
| SRV-01, SRV-02, SRV-04 | mesin survei generik, migrasi SKM, ulasan Google Maps |
| QUE-16 | kuota harian (kolom sudah disiapkan di WP-20) |
| QUE-18 | penanda alasan prioritas kelompok rentan (OPEN-QUESTION OQ-02) |
| DSP-08 | suara panggilan antrean (hook peristiwa sudah disiapkan di WP-23) |
| SEC-13 | kanal WhatsApp |
| SEC-16, SEC-17, SEC-18 | E2E, hash-chain audit log, pemecahan PRD |

---

## RINGKASAN DEPENDENSI WP
```
Fase 0: WP-01 → (WP-05, WP-07, WP-16, WP-17, WP-31)
        WP-02 ──> prasyarat Fase 3
        WP-11 ──> prasyarat Fase 3
Fase 1: WP-12 ← (WP-06, WP-09, WP-13)
Fase 2: WP-15 ← (WP-06, WP-09) ──> WP-16, WP-17, WP-18, WP-19
Fase 3: WP-20 → WP-21 → WP-22 → WP-23 → WP-24 (≥2 minggu stabil + persetujuan)
Fase 4: WP-25 ← (WP-15, WP-16); WP-27 ← (WP-04, WP-13, WP-26)
Fase 5: WP-29 ← (WP-22, WP-26); WP-30 ← (WP-01, WP-22)
Fase 6: WP-31 ← (WP-01, WP-26); WP-32 ← WP-14
```

**BERHENTI DI SINI.** Menunggu persetujuan manusia sebelum melanjutkan ke **Fase E (Eksekusi)**.
