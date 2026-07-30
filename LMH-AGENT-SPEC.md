# LMH — SPESIFIKASI KEPUTUSAN & INSTRUKSI KERJA UNTUK AI AGENT

> **Dokumen ini adalah sumber kebenaran (single source of truth) untuk penyempurnaan Lampung Maju Hub (LMH).**
>
> - **Versi dokumen:** 1.0
> - **Tanggal:** 29 Juli 2026
> - **Pemilik keputusan:** jazaqu (system analyst / pengembang LMH)
> - **Organisasi:** DPMPTSP Provinsi Lampung
> - **Status sistem:** **SUDAH LIVE, DIPAKAI DI KANTOR SETIAP HARI KERJA**
> - **Asal dokumen:** hasil sesi brainstorming cakupan produk, satu topik per giliran, seluruh keputusan dikonfirmasi langsung oleh pemilik keputusan.

---

# BAGIAN 0 — INSTRUKSI UNTUK AI AGENT (BACA INI LEBIH DULU, JANGAN DILEWATI)

## 0.1 Misi kamu

Kamu adalah AI engineering agent yang bekerja pada repositori LMH. Tugasmu **BUKAN** langsung menulis kode fitur. Tugasmu dijalankan dalam **lima fase berurutan** dan kamu **tidak boleh melompati fase**.

| Fase | Nama | Keluaran wajib | Boleh menyentuh kode? |
|---|---|---|---|
| **A** | Inventarisasi kode | `docs/analysis/00-CODE-INVENTORY.md` | Tidak (hanya baca) |
| **B** | Gap analysis | `docs/analysis/01-GAP-ANALYSIS.md` | Tidak (hanya baca) |
| **C** | Desain target | `docs/analysis/02-TARGET-DESIGN.md` + `03-DATA-MODEL.md` + `04-RBAC-MATRIX.md` | Tidak |
| **D** | Rencana implementasi | `docs/analysis/05-IMPLEMENTATION-PLAN.md` + `06-MIGRATION-PLAN.md` + `07-TEST-PLAN.md` | Tidak |
| **E** | Eksekusi | Kode + migrasi + tes, per work package | Ya, **hanya setelah fase D disetujui manusia** |

**Berhenti dan minta persetujuan manusia di akhir fase B dan di akhir fase D.** Jangan lanjut ke fase E tanpa persetujuan eksplisit.

## 0.2 Aturan mutlak (hard rules)

1. **JANGAN PERNAH menganggap dokumen ini menggambarkan kondisi kode saat ini.** Dokumen ini menggambarkan **keputusan dan kondisi target**. Sebagian sudah ada di kode, sebagian belum, sebagian ada tapi salah. Kamu **wajib memverifikasi setiap klaim** terhadap kode nyata di fase A.
2. **JANGAN mengarang isi kode.** Kalau kamu belum membaca sebuah file, jangan menyimpulkan isinya. Setiap pernyataan di gap analysis wajib menyertakan **path file + nomor baris** sebagai bukti.
3. **Sistem sudah live.** Setiap perubahan skema wajib mengikuti protokol migrasi di **Bagian 7**. Perubahan yang bisa membuat pelayanan berhenti di jam kerja adalah kegagalan, sekalipun kodenya benar.
4. **JANGAN menghapus kolom, tabel, enum value, atau endpoint apa pun** pada fase mana pun tanpa persetujuan manusia tertulis, meski tampak tidak dipakai.
5. **Setiap keputusan punya ID** (contoh: `QUE-04`). Setiap item di rencana implementasi wajib menyebut ID keputusan yang dipenuhinya. Item tanpa ID keputusan = di luar cakupan, harus ditolak atau diangkat ke manusia.
6. **Kalau ada pertentangan antara dokumen ini dan kode**, dokumen ini yang menang **sebagai target**, tapi kamu wajib melaporkan pertentangan itu di gap analysis — jangan diam-diam mengubah kode.
7. **Kalau ada pertentangan di dalam dokumen ini sendiri**, JANGAN memilih sendiri. Catat di daftar `OPEN-QUESTIONS` dan tanyakan ke manusia.
8. **Bahasa:** semua dokumentasi keluaran dalam **Bahasa Indonesia**. Nama tabel, kolom, dan enum dalam **Bahasa Indonesia** mengikuti konvensi skema yang sudah ada (`layanan`, `petugas`, `pengunjung`). Nama file, fungsi, dan variabel kode dalam **Bahasa Inggris** mengikuti konvensi kode yang sudah ada.
9. **Zona waktu:** SELURUH batas "hari", "hari ini", "awal/akhir hari", agregasi harian, dan cron **wajib memakai `Asia/Jakarta`**, bukan UTC. Ini bug kelas satu kalau salah. Lihat `RPT-07`.
10. **Jangan menambah dependensi baru** tanpa mencantumkannya sebagai keputusan terpisah di rencana implementasi beserta alasan, ukuran, dan alternatif tanpa dependensi.

## 0.3 Prinsip perancangan yang mengikat seluruh sistem

Empat prinsip ini adalah hasil temuan terpenting dari sesi brainstorming. Setiap keputusan teknis harus konsisten dengannya.

### P1 — Masalah utama proyek ini adalah kepatuhan petugas, bukan teknologi

Petugas mitra (P4) berasal dari instansi luar, **sering tidak login, sering mangkir, dan kurang peduli**. Ini pernyataan langsung dari pemilik keputusan, bukan dugaan.

**Konsekuensi desain:**
- Jangan pernah merancang alur yang **mengandalkan** petugas rajin login.
- Ketidakhadiran **wajib terekam sebagai data eksplisit**, bukan sebagai kekosongan data. Kekosongan tidak bisa dilaporkan; data bisa.
- Front Office (FO) adalah **jaring pengaman** untuk semua aksi kritikal lintas layanan. Kalau petugas tidak melakukan sesuatu, FO harus bisa melakukannya.

### P2 — Setiap angka harus bisa menuntut seseorang

Sistem ini dipakai untuk menekan instansi mitra agar hadir. Kalau status dicampur atau jejak bisa dihapus surut, angkanya tidak bisa dipakai. Karena itu: status dipisah tegas (`QUE-08`), jadwal dibekukan harian (`SCH-05`), dan waktu diambil dari server (`SCH-08`).

### P3 — Jangan pernah menolak tanpa menawarkan jalan lain

Setiap penolakan (di luar jadwal, lewat batas ambil nomor, kuota habis, petugas alpa) **wajib** menyertakan: alasan, jadwal/waktu terdekat yang tersedia, dan minimal satu alternatif (live chat, reservasi, kontak instansi langsung). Pesan "Layanan tidak tersedia" tanpa lanjutan dianggap **cacat**, bukan sekadar kurang ramah.

### P4 — Bot boleh mengutip, tidak boleh menafsirkan

Jawaban keliru tentang persyaratan izin di situs resmi pemerintah adalah risiko hukum dan reputasi. Lihat seluruh blok `BOT-*`. Aturan penjaga ini **tidak boleh** dijadikan pengaturan yang bisa dimatikan dari dashboard (`CMS-04`).

## 0.4 Kosakata baku (pakai istilah ini secara konsisten)

| Istilah | Arti pasti |
|---|---|
| **Layanan** | Satu unit pelayanan yang punya loket, antrean, dan petugas. Ada 11. |
| **P4** | Layanan yang diselenggarakan **instansi mitra di luar DPMPTSP**, standby tidak setiap hari kerja. |
| **Kunjungan** | **Satu kedatangan fisik satu orang** ke kantor pada satu hari. |
| **Tiket antrean** | **Satu nomor antrean untuk satu layanan.** Satu kunjungan bisa punya banyak tiket. |
| **Buku tamu** | Tamu yang datang menemui pegawai tertentu. **BUKAN kunjungan layanan, BUKAN antrean.** |
| **Reservasi** | Rencana kedatangan yang dibuat online, maksimal 7 hari ke depan, **tanpa slot jam**. |
| **Check-in** | Tindakan di kantor yang mengubah reservasi menjadi kunjungan dan **menerbitkan nomor antrean**. |
| **Walk-in** | Pengunjung datang tanpa reservasi, didata FO, langsung masuk antrean. |
| **Jadwal standby** | Pola hari kerja saat petugas suatu layanan seharusnya hadir di kantor DPMPTSP. |
| **Absensi** | Pencatatan kehadiran nyata petugas hari itu. **Berfungsi sebagai tombol pembuka antrean.** |
| **Alpa** | Status otomatis saat petugas tidak absen padahal jadwal ada. |
| **Tidak terlayani** | Status tiket saat **petugas** tidak hadir. Berbeda dari `no_show` dan `batal`. |
| **FO** | Front Office. Petugas meja depan DPMPTSP. |
| **PIC** | Orang yang saat ini bertugas mewakili suatu layanan. Bisa berganti. |

---

# BAGIAN 1 — KONTEKS PROYEK

## 1.1 Identitas

- **Nama:** Lampung Maju Hub (LMH)
- **Versi terakhir terdokumentasi:** 2.1.0
- **Pemilik:** DPMPTSP Provinsi Lampung
- **Fungsi:** portal terpadu untuk seluruh layanan yang difasilitasi DPMPTSP Provinsi Lampung, melayani **pengunjung digital** dan **pengunjung fisik** dalam satu sistem.

## 1.2 Tumpukan teknologi (verifikasi ulang di fase A)

```
Frontend/Backend : Next.js 16.2.10 (App Router), React 19.2.4, TypeScript strict
Runtime          : Node >= 22
Basis data       : Supabase (PostgreSQL + RLS + pgvector), @supabase/supabase-js ^2.110.0, @supabase/ssr ^0.12.0
AI               : @google/generative-ai ^0.24.1, Gemini (default gemini-1.5-flash), embedding text-embedding-004
Email            : resend ^6.17.2
Push             : web-push ^3.6.7 (VAPID)
PDF              : pdfjs-dist ^6.1.200, canvas, sharp
QR               : qrcode, html5-qrcode
Chart            : recharts ^3.9.2
Validasi         : zod ^4.4.3
Chat UI          : @chatscope/chat-ui-kit-react
Tes              : vitest ^4.1.10, @vitest/coverage-v8, @testing-library/react, jsdom, fake-indexeddb
Lint             : eslint dengan --max-warnings=0
Hosting          : Vercel (vercel.json memuat definisi cron)
```

## 1.3 Peta wilayah kode yang sudah diketahui (titik awal fase A, bukan daftar lengkap)

```
src/proxy.ts
src/lib/admin-nav.ts              -> ADMIN_NAV, canAccessAdminPath()
src/components/layout/AdminGuard.tsx
src/lib/constants.ts
src/lib/gemini.ts
src/lib/pii.ts                    -> redactPii(), detectPromptInjection()
src/lib/ikm.ts
src/lib/observability/logger.ts   -> logServerEvent()
src/lib/offline/queue.ts, replay.ts
src/lib/supabase/server.ts, client.ts
src/styles/globals.css            (~20KB)
next.config.ts, vercel.json
public/sw.js, public/sw-push.js, public/manifest.json
scripts/smoke.mjs
docs/                             (13 dokumen, termasuk KEBIJAKAN_PDP.md, DECISION_LOG.md, AUDIT_DAN_ROADMAP_INOVASI.md)
```

Halaman berukuran besar (kandidat kuat untuk dipecah, lihat `OPS-07`):

```
/chat        ~37.5 KB
/umkm        ~36 KB
/admin/chat  ~25.6 KB
/gallery     ~24 KB
/me          ~16.5 KB
/checkin     ~16 KB
/admin       ~16 KB
```

Komponen penting: `WalkinWizard.tsx` (~14 KB), `ProfileCompletenessGate.tsx` (~13.7 KB), `EstimasiAntrean.tsx`, `IkmPanel.tsx`, `Toast.tsx`, `OfflineBanner.tsx`, `Pagination.tsx`, `QRCode.tsx`, `Sidebar.tsx`, `PageHeader.tsx`, `ServiceWorkerRegister.tsx`.

## 1.4 Migrasi yang sudah ada (urutan penamaan wajib diikuti)

```
202607140001_extensions_and_preflight
202607140002_*
202607140003_*
202607140004_*
202607140005_views_and_jobs
202607200001_p0_security_governance
202607210001_walkin_kontak_dan_layanan_perizinan
202607240001_pengunjung_no_hp
202607280001_layanan_jadwal
202607280002_chat_pesan_owner_strict
202607280003_faq_petugas_scope
202607280004_chat_pesan_client_uuid
202607280005_antrian_hari_ini
```

## 1.5 Inventaris skema yang diketahui (WAJIB diverifikasi ulang di fase A)

### Tabel inti

| Tabel | Kolom yang diketahui | Catatan target |
|---|---|---|
| `layanan` | `nama`, `tipe` (`konsultatif\|mitra\|modul_publik`), `aktif`, `chatbot_aktif`, `is_ptsp` | `tipe` **harus diganti** dengan 2 dimensi → `SVC-03`. Butuh `nomor_loket` → `SVC-04`. |
| `petugas` | `auth_user_id`, `nama`, `layanan_id`, `role` (`petugas\|admin`) | Butuh status aktif/nonaktif → `RBA-06`. Butuh role `front_office` → `RBA-02`. |
| `pengunjung` | `kategori` (`UMKM\|Umum\|Instansi\|Investor`), `no_hp` | Fondasi preferensi kontak → `CHT-09`. |
| `visit` | `asal` (`walk_in\|reservasi`), `tujuan` (`loket\|bertemu_seseorang`), `qr_token`, `status` (`terjadwal\|menunggu\|dilayani\|selesai\|batal\|no_show`), `diarahkan_ke` | **Harus dipecah** jadi kunjungan + tiket → `QUE-01`. `tujuan=bertemu_seseorang` **harus dipindah** ke buku tamu → `GST-01`. Butuh status `tidak_terlayani` → `QUE-08`. |
| `absensi_petugas` | `jam_masuk`, `jam_pulang`, `status` (`pending\|approved`), `approved_by`, UNIQUE(petugas_id, tanggal) | Jadi gerbang antrean → `SCH-02`. Butuh status `alpa` → `SCH-09`. |
| `site_settings` | — | Fondasi registry pengaturan → `CMS-05`. |
| `landing_content` | — | Butuh riwayat versi → `CMS-06`. |

### Tabel fitur

| Tabel | Catatan target |
|---|---|
| `faq_knowledge_base` (`embedding vector(768)`) | Butuh pembaruan embedding saat FAQ diubah → `BOT-11`. |
| `chat_sesi` (`status` `aktif\|bot\|eskalasi\|selesai`, `ditangani_oleh`) | `selesai` harus jadi utas berkelanjutan → `CHT-01`. |
| `chat_pesan`, `chat_ai_log` | Sumber daftar usulan FAQ → `BOT-12`. |
| `listing_umkm` (`sisi` `kebutuhan\|penawaran`, `status` `draft\|pending_review\|published\|nonaktif\|expired`) | Butuh `perlu_perbaikan` → `MMK-03`; `expired` belum pernah terjadi → `MMK-07`. |
| `umkm_listing_owner`, `umkm_inquiry` | — |
| `investment_documents` | Watermark server-side → `INV-04`. |
| `investasi_lead` (`status` `baru\|dihubungi\|berlanjut\|ditolak\|selesai`) | Dilengkapi jejak minat peta → `INV-06`. |
| `anon_rate_limit`, `audit_log`, `consent_log` | Celah bypass rate limit → `SEC-02`. PII di `audit_log.detail` → `SEC-05`. |
| `skm_respons` (`u1_persyaratan` … `u9_pengaduan`) | **JANGAN tambah survei baru dengan pola ini** → `SRV-01`. |
| `notifikasi` (`kanal` `email\|web_push`, `status` `pending\|processing\|sent\|failed\|skipped`, `claim_token`, `retry_count`, `idempotency_key`, `available_at`) | Dipakai untuk seluruh notifikasi baru → `NOT-04`. |
| `push_subscriptions` | — |

### View, fungsi, bucket, cron

```
Views     : v_umkm_public, v_umkm_match, mv_estimasi_layanan, v_antrian_loket
Functions : get_my_role(), get_my_layanan_id(), set_user_role_claim(),
            check_anon_rate(action,max,window_sec), match_faq() (threshold 0.7),
            hitung_ikm(), get_skm_context(p_token), submit_skm_response(),
            get_public_umkm(), queue_notifikasi(), claim_notifikasi(),
            complete_notifikasi(), refresh_estimasi_layanan(),
            anonymize_inactive_pengunjung() (730 hari), prune_anon_rate_limit()
Buckets   : investment-docs (privat, _raw/, pages/), umkm-photos (PUBLIC READ)
Cron API  : /api/notif/send  */2 * * * *   |  /api/notif/retry  */5 * * * *
pg_cron   : refresh MV */5, anonymize 02:00, prune 03:00
```

### Rate limit yang terpasang

```
visit_insert_walk_in      5 / 60 s
chat_sesi_insert          3 / 60 s
chat_pesan_insert        20 / 60 s
chat_ai_call             10 / 60 s   (di route handler)
umkm_inquiry              5 / 3600 s
investasi_lead_insert     3 / 3600 s
```

### Variabel lingkungan

```
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
GEMINI_API_KEY, GEMINI_MODEL (default gemini-1.5-flash),
GEMINI_EMBEDDING_MODEL (default text-embedding-004),
RESEND_API_KEY, RESEND_FROM,
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, NEXT_PUBLIC_VAPID_PUBLIC_KEY,
CRON_SECRET, NEXT_PUBLIC_PUBLIC_URL, APP_ENV, APP_VERSION, LMH_DEV_RETURN_LINK
```

---

# BAGIAN 2 — DOMAIN BISNIS

## 2.1 Sebelas layanan (sumber kebenaran; seed lama di PRD SUDAH USANG)

<callout>
**PENTING:** daftar layanan di seed PRD lama (6 layanan, semua `tipe = konsultatif`) **TIDAK BENAR LAGI**. Pakai daftar di bawah ini.
</callout>

### Kelompok A — Layanan P4 (instansi mitra, standby tidak harian)

| # | Layanan | Sifat |
|---|---|---|
| 1 | Bank Lampung | Sebagian besar informasi |
| 2 | Balai Monitor SFR | Sebagian besar informasi |
| 3 | Sertifikasi Halal | Sebagian besar informasi |
| 4 | BPJS Kesehatan | Sebagian besar informasi |
| 5 | Sertifikasi Mutu Keamanan Hasil Perikanan | Sebagian besar informasi |
| 6 | Layanan Jasa Industri | Sebagian besar informasi |
| 7 | BPN | **Coming Soon** — belum melayani |

Ciri kelompok A: **cakupan layanan terbatas**, masing-masing punya **jadwal standby sendiri**, dan **tidak standby setiap hari kerja**.

### Kelompok B — Layanan DPMPTSP

| # | Layanan | Cakupan |
|---|---|---|
| 8 | Helpdesk OSS | Pendampingan OSS |
| 9 | Layanan Perizinan dan Non Perizinan DPMPTSP | Perizinan & non perizinan kewenangan Provinsi Lampung |
| 10 | Matchmaking UMKM | Menyalurkan kebutuhan industri/perusahaan besar ke UMKM dan sebaliknya (bahan baku, produk jadi, dll) |
| 11 | Investment Gallery | IPRO (Investment Project Ready to Offer), peta potensi, pengenalan portal investasi lain seperti FOILA |

**Catatan penting tentang #10 dan #11:** keduanya adalah **layanan internal DPMPTSP** yang dilayani **pegawai DPMPTSP sendiri**, punya **tempat fisik sendiri**, dan **bisa dilayani secara langsung**. Namun pegawainya **kurang aware** terhadap sistem, sehingga notifikasi email diperlukan (`NOT-03`).

## 2.2 Aturan besar: semua layanan seragam

**Ke-11 layanan punya loket fisik, antrean, dan live chat.** Tidak ada layanan yang hanya digital. Ini menyederhanakan model data secara signifikan: **tidak perlu percabangan khusus per layanan**.

## 2.3 Tiga jalur masuk pengunjung

```
1. RESERVASI ONLINE  -> pilih layanan + tanggal (maks H+7, tanpa slot jam)
                     -> datang ke kantor -> CHECK-IN (scan QR / lewat FO)
                     -> nomor antrean diterbitkan -> masuk antrean

2. WALK-IN           -> datang tanpa reservasi -> didata FO
                     -> nomor antrean diterbitkan -> masuk antrean -> diarahkan

3. DIGITAL SAJA      -> lihat layanan, FAQ, jadwal, UMKM, gallery
                     -> live chat (wajib login Google)
                     -> tidak pernah datang ke kantor
```

Jalur keempat yang **terpisah total** dari ketiganya:

```
4. BUKU TAMU         -> tamu datang menemui pegawai tertentu
                     -> dicatat FO di buku tamu + tanda tangan
                     -> TIDAK masuk antrean, TIDAK dihitung sebagai kunjungan layanan
```

---

# BAGIAN 3 — KATALOG KEPUTUSAN

**Cara membaca:** setiap keputusan punya ID, pernyataan keputusan, alasan (penting agar kamu tidak "memperbaiki" hal yang sengaja dibuat begitu), implikasi teknis, dan status dugaan terhadap kode. **Kolom "Status dugaan" WAJIB kamu verifikasi ulang** — nilainya adalah dugaan, bukan fakta.

Kode status:
- `ADA` — diyakini sudah ada di kode
- `SEBAGIAN` — fondasinya ada tapi belum memenuhi keputusan
- `BELUM` — diyakini belum ada
- `SALAH` — ada tapi bertentangan dengan keputusan
- `TUNDA` — keputusan sengaja ditunda

---

## 3.1 SVC — Struktur Layanan

### SVC-01 — Sebelas layanan, dua penyerta, model seragam
**Keputusan:** ada 11 layanan seperti Bagian 2.1. Semuanya punya loket fisik, antrean, dan live chat. BPN berstatus *Coming Soon*.
**Alasan:** Matchmaking dan Investment Gallery semula terlihat seperti modul digital, tetapi pemilik keputusan menegaskan keduanya punya tempat fisik dan dilayani langsung. Karena itu tidak perlu pengecualian model.
**Implikasi:** hapus asumsi "layanan modul publik tanpa antrean" dari kode dan seed.
**Status dugaan:** `SALAH` (seed lama hanya 6 layanan, ada `tipe = modul_publik`)

### SVC-02 — Coming Soon adalah status tampilan, bukan penghapusan
**Keputusan:** BPN tampil di situs sebagai *Coming Soon*, tidak bisa direservasi, tidak bisa diambil antreannya, tidak menerima chat.
**Implikasi:** butuh status layanan yang lebih kaya dari `aktif boolean`. Minimal: `aktif`, `coming_soon`, `nonaktif`.
**Status dugaan:** `BELUM`

### SVC-03 — Ganti `layanan.tipe` dengan dua dimensi terpisah
**Keputusan:** `tipe` (`konsultatif | mitra | modul_publik`) mencampur dua konsep berbeda dan harus digantikan oleh:
- **`penyerta`**: `dpmptsp` | `p4`
- **bendera kemampuan** terpisah: `punya_antrean`, `punya_chat`, `punya_jadwal_standby`, `punya_dokumen_peraturan`

**Alasan:** "mitra" adalah pernyataan tentang **siapa penyelenggaranya**, sementara "modul_publik" adalah pernyataan tentang **kemampuan apa yang dimiliki**. Mencampurnya membuat mustahil menyatakan "layanan DPMPTSP yang tidak punya jadwal standby".
**Implikasi:** migrasi aditif; pertahankan `tipe` selama transisi (`OPS-01`).
**Status dugaan:** `SALAH`

### SVC-04 — Satu layanan = satu loket tetap
**Keputusan:** tidak ada tabel loket. Cukup atribut `nomor_loket` pada `layanan`.
**Alasan:** dikonfirmasi langsung oleh pemilik keputusan. Tabel loket terpisah akan menjadi kerumitan tanpa manfaat.
**Implikasi:** JANGAN membuat tabel `loket`. Kalau suatu hari satu layanan butuh 2 loket, itu keputusan baru.
**Status dugaan:** `BELUM`

### SVC-05 — Nomor antrean berprefiks per layanan, reset harian
**Keputusan:** format `<PREFIKS>-<URUT>`, contoh `A-001`, `B-012`. Prefiks adalah atribut layanan. Urutan reset setiap hari (Asia/Jakarta).
**Alasan:** memungkinkan panggilan suara yang jelas: *"Nomor B-012, silakan ke loket 4."*
**Implikasi:** butuh kolom `prefiks_antrean` pada `layanan` + penomoran atomik (`QUE-06`).
**Status dugaan:** `BELUM`

### SVC-06 — Kontak resmi instansi mitra harus tersimpan
**Keputusan:** simpan nama PIC, telepon/WA, alamat kantor asli instansi, jam layanan instansi itu sendiri, dan tautan layanan online mereka.
**Alasan:** ketika petugas tidak hadir, warga harus bisa diarahkan ke kantor/layanan aslinya (P3). Sekarang data ini tidak ada di mana pun.
**Implikasi:** masuk ke tabel `layanan_kontak` (`NOT-01`).
**Status dugaan:** `BELUM`

---

## 3.2 QUE — Kunjungan & Antrean

### QUE-01 — Pisahkan `kunjungan` dari `tiket_antrean`
**Keputusan:** satu **kunjungan** (satu kedatangan orang) memiliki **banyak tiket antrean** (satu per layanan).
**Alasan:**
1. Mencegah penghitungan ganda pengunjung di rekap. Orang yang mengambil 3 layanan bukan 3 pengunjung.
2. Menghasilkan dua angka yang keduanya benar: *"120 pengunjung, 143 layanan diberikan."*
3. Bonus metrik: rata-rata layanan per kunjungan, dan pola layanan berurutan (layanan A sering dilanjut ke layanan B).

**Implikasi:** ini perubahan paling berisiko di seluruh dokumen karena `visit` adalah tabel inti sistem live. Wajib protokol `OPS-01`..`OPS-05`.
**Status dugaan:** `SALAH` (sekarang `visit` mencampur keduanya)

### QUE-02 — Boleh ambil beberapa layanan dalam satu kedatangan, tiket terpisah
**Keputusan:** satu kunjungan boleh mengambil antrean di beberapa layanan, masing-masing tiket terpisah dan berjalan sendiri.
**Implikasi:** UI check-in dan UI FO harus mendukung penambahan tiket ke kunjungan yang sudah ada.
**Status dugaan:** `BELUM`

### QUE-03 — Ambil tiket tambahan tanpa mengisi data ulang
**Keputusan:** pengunjung yang sudah punya kunjungan aktif hari itu bisa menambah tiket dengan **memindai QR** atau **lewat FO**, tanpa mengisi identitas lagi.
**Alasan:** mengisi ulang data adalah hambatan yang membuat orang memilih tidak mengambil layanan kedua.
**Status dugaan:** `BELUM`

### QUE-04 — Nomor antrean terbit saat check-in di kantor, urut kedatangan
**Keputusan:** nomor **tidak** diterbitkan saat reservasi dari rumah. Nomor terbit **saat check-in di kantor**, urut kedatangan.
**Alasan:** keadilan ruang tunggu. Kalau nomor terbit dari rumah, orang yang sudah menunggu 40 menit di ruang tunggu bisa dilewati oleh orang yang baru masuk pintu.
**Implikasi:** enum `visit.status` yang ada (`terjadwal → menunggu → dilayani → selesai`) sudah cocok dengan alur ini; pertahankan.
**Status dugaan:** `SEBAGIAN`

### QUE-05 — Reservasi maksimal H+7, tanpa slot jam
**Keputusan:** horizon reservasi **maksimal 7 hari ke depan**. **Tidak ada slot jam** — cukup pilih tanggal, datang kapan saja pada jam layanan.
**Alasan:** menghilangkan seluruh kelas masalah double-booking dan concurrency slot. Juga sesuai realitas: warga tidak bisa menepati jam.
**Implikasi:** JANGAN membangun sistem slot. Validasi: tanggal >= hari ini, <= hari ini + 7, hari kerja, dan ada jadwal standby (`SCH-01`).
**Status dugaan:** `SEBAGIAN`

### QUE-06 — Penomoran antrean WAJIB atomik di dalam basis data
**Keputusan:** nomor antrean dihasilkan di dalam PostgreSQL secara atomik (sequence per layanan-tanggal, atau `INSERT ... SELECT COALESCE(MAX)+1` di dalam fungsi dengan penguncian, atau tabel penghitung dengan `UPDATE ... RETURNING`). **JANGAN** "ambil nomor terakhir lalu +1" di kode aplikasi.
**Alasan:** dua orang check-in bersamaan di FO dan kios akan mendapat nomor sama. Ini bug yang pasti terjadi, dan akibatnya keributan di ruang tunggu.
**Wajib:** `UNIQUE (layanan_id, tanggal, nomor)` sebagai jaring pengaman terakhir.
**Status dugaan:** `SALAH` — **PERIKSA INI LEBIH DULU DI FASE A, ini kandidat bug produksi aktif.**

### QUE-07 — Tiket hanya boleh diklaim satu kali
**Keputusan:** penguncian di tingkat **baris tiket** (optimistic lock: `UPDATE ... WHERE status = 'menunggu'` lalu periksa jumlah baris terpengaruh). Catat `dilayani_oleh` per tiket.
**Keputusan turunan:** **TIDAK perlu penguncian loket/sesi.** Kasus dua petugas login bersamaan pada satu layanan sangat jarang, dan menambah penguncian sesi hanya menambah kerumitan.
**Status dugaan:** `BELUM`

### QUE-08 — Tiga status yang WAJIB terpisah
| Status | Arti | Pihak yang bertanggung jawab |
|---|---|---|
| `no_show` | warga tidak datang | warga |
| `tidak_terlayani` | **petugas tidak hadir** | petugas / instansi |
| `batal` | dibatalkan warga | warga |

**Alasan:** kalau dicampur, angkanya tidak bisa dipakai menuntut siapa pun (P2). `tidak_terlayani` adalah **bahan utama laporan kepatuhan mitra**.
**Implikasi:** tambah nilai enum `tidak_terlayani`. Penambahan nilai enum di PostgreSQL bersifat aditif dan aman, tapi periksa semua tempat yang melakukan `switch`/pemetaan status secara ekshaustif di TypeScript — kompilasi bisa gagal atau, lebih buruk, jatuh ke cabang default yang salah.
**Status dugaan:** `BELUM`

### QUE-09 — Antrean sisa saat jam layanan berakhir: TETAP DILAYANI SAMPAI HABIS
**Keputusan:** nomor yang sudah terbit **wajib dilayani**, meski melewati jam tutup.
**Alasan:** ini pemicu keluhan paling sering di kantor pelayanan. Menghanguskan nomor yang sudah dipegang orang yang sudah menunggu adalah sumber konflik.
**Implikasi:** harus dipasangkan dengan `QUE-10`, kalau tidak petugas bekerja tanpa ujung.
**Status dugaan:** `BELUM` (perlu diverifikasi apakah ada pekerjaan terjadwal yang menghanguskan tiket di akhir hari — kalau ada, itu bertentangan dan harus diubah)

### QUE-10 — Batas terakhir ambil nomor, diatur PER LAYANAN
**Keputusan:** ada batas waktu terakhir pengambilan nomor, nilai bawaan **30 menit sebelum tutup**, tetapi **wajib dapat diatur per layanan**.
**Alasan:** durasi layanan sangat berbeda. Konsultasi perizinan bisa 20 menit per orang; tanya info BPJS bisa 5 menit. Batas seragam akan membuat loket berdurasi panjang kelebihan beban.
**Implikasi:** kolom `batas_ambil_nomor_menit` pada `layanan`, bawaan 30.
**Status dugaan:** `BELUM`

### QUE-11 — Batas ambil nomor dihitung dari JAM TUTUP EFEKTIF hari itu
**Keputusan:** kalau petugas pulang lebih awal atau loket ditutup FO, batas pengambilan nomor **ikut bergeser**. Bukan dihitung dari jam tutup normal.
**Alasan:** kalau tidak, sistem tetap membagikan nomor untuk loket yang sudah kosong.
**Implikasi:** butuh konsep "jam tutup efektif per layanan per hari", diturunkan dari: jam layanan default → pengecualian jadwal → penutupan manual FO → absen keluar petugas.
**Status dugaan:** `BELUM`

### QUE-12 — Penolakan setelah batas wajib menawarkan jalan lain
**Keputusan:** pesan wajib memuat: (a) pengambilan nomor hari ini sudah ditutup, (b) tawaran reservasi untuk hari berikutnya yang tersedia, (c) tawaran live chat sekarang.
**Status dugaan:** `BELUM`

### QUE-13 — Tampilkan estimasi waktu dilayani saat memberi nomor
**Keputusan:** saat nomor diterbitkan (terutama menjelang batas), tampilkan perkiraan waktu dipanggil, misal *"perkiraan dilayani 15.10"*.
**Alasan:** warga bisa memilih pulang dan datang besok, jauh lebih baik daripada menunggu lalu marah.
**Implikasi:** `mv_estimasi_layanan` sudah ada dan bisa dipakai. Periksa apakah `EstimasiAntrean.tsx` sudah memakainya.
**Status dugaan:** `SEBAGIAN`

### QUE-14 — Simpan jam selesai layanan yang SEBENARNYA
**Keputusan:** catat jam tiket terakhir selesai dilayani per layanan per hari, terpisah dari jam layanan resmi.
**Alasan:** selisihnya adalah bukti berbasis angka bahwa kapasitas suatu loket kurang — argumen untuk meminta tambahan petugas, bukan sekadar keluhan.
**Status dugaan:** `BELUM`

### QUE-15 — Reservasi tanpa check-in otomatis menjadi `no_show`
**Keputusan:** pekerjaan terjadwal di akhir jam layanan mengubah reservasi yang tidak di-check-in menjadi `no_show`.
**Alasan:** tanpa ini, status `terjadwal` menumpuk selamanya dan rekap tidak pernah benar.
**Implikasi:** batas hari **wajib** Asia/Jakarta (`RPT-07`).
**Status dugaan:** `BELUM`

### QUE-16 — Kuota harian: DITUNDA, tapi kolomnya disiapkan sekarang
**Keputusan:** tidak ada pembatasan kuota harian untuk sekarang. Namun **siapkan kolom `kuota_harian` (nullable) sekarang**; `NULL` = tanpa batas.
**Alasan:** menambah kolom nullable ke tabel live nanti lebih mahal daripada sekarang.
**Implikasi:** JANGAN membangun logika kuota, JANGAN membangun antrean tunggu kuota.
**Status dugaan:** `TUNDA`

### QUE-17 — Tombol "panggil ulang" wajib ada
**Keputusan:** petugas bisa memanggil ulang nomor yang sedang dilayani. Nomor berkedip lagi di layar dan suara diulang.
**Alasan:** kebutuhan yang pasti muncul — warga tidak mendengar atau sedang ke toilet. Tanpa panggil ulang, petugas melewati orang itu dan timbul keributan.
**Status dugaan:** `BELUM`

### QUE-18 — Antrean prioritas kelompok rentan: MANUAL FO, TANPA FITUR
**Keputusan pemilik:** diatur manual oleh Front Office, tanpa fitur di sistem. FO yang menandai saat check-in.
**Usulan yang BELUM disetujui (jangan dikerjakan tanpa persetujuan):** satu penanda alasan (`lansia` / `disabilitas` / `ibu_hamil` / `lainnya`) + siapa yang menyelipkan, dengan tiga alasan: (a) bukti pelayanan kelompok rentan saat penilaian eksternal, (b) rekap waktu tunggu jadi tidak masuk akal tanpa keterangan, (c) mencegah "antrean titipan" yang tidak berjejak.
**Instruksi untuk agent:** catat sebagai `OPEN-QUESTION`, jangan implementasikan.
**Status dugaan:** `TUNDA`

---

## 3.3 SCH — Jadwal Standby & Absensi

### SCH-01 — Gerbang pertama: jadwal standby memblokir PENDAFTARAN
**Keputusan:** pendaftaran antrean/reservasi **ditolak** di luar hari jadwal standby layanan itu. Contoh: BPJS hanya Senin → pendaftaran hari lain diblokir.
**Pesan penolakan wajib** menyebut jadwal terdekat: *"Layanan BPJS Kesehatan di kantor DPMPTSP hanya tersedia setiap Senin. Jadwal terdekat: Senin, 3 Agustus. Mau reservasi untuk tanggal itu, atau tanya lewat live chat sekarang?"*
**Implikasi:** butuh fungsi **"kapan jadwal berikutnya"** yang dipakai bersama oleh: halaman reservasi, halaman check-in, bot, dan layar TV.
**Status dugaan:** `SEBAGIAN` (migrasi `202607280001_layanan_jadwal` ada — periksa apakah benar memblokir atau hanya menampilkan)

### SCH-02 — Gerbang kedua: absensi adalah TOMBOL PEMBUKA ANTREAN
**Keputusan:** untuk **hari ini**, antrean suatu layanan **tidak dibuka** sampai kehadiran petugas tercatat. Kalau jadwal ada tapi belum ada yang absen, antrean layanan itu tertutup.
**Aturan hierarki:** untuk hari ini, **kehadiran nyata mengalahkan jadwal**. Untuk hari depan, **jadwal dipakai** sebagai dasar penerimaan reservasi, tetapi tidak dijanjikan pasti.
**Alasan:** ini penerapan langsung P1. Percuma membuka antrean untuk loket yang tidak ada orangnya.
**Status dugaan:** `BELUM`

### SCH-03 — Jadwal itu stabil (KOREKSI PENTING)
**Fakta yang dikonfirmasi pemilik:** jadwal sudah pasti dan **jarang berubah** — mungkin **1–2 kali perubahan per bulan**, tidak terduga.
**Konsekuensi:** karena stabil, jadwal **layak dipakai sebagai pemblokir** (`SCH-01`). Kalau jadwal sering berubah, memblokir berdasarkan jadwal akan salah menolak warga.
**Catatan riwayat:** jawaban awal "sering berubah mendadak" **dibatalkan** oleh pemilik keputusan. Jangan merancang berdasarkan asumsi jadwal kacau.

### SCH-04 — Struktur jadwal: pola berulang + tabel pengecualian
**Keputusan:** dua tabel.
- `jadwal_standby` — pola berulang mingguan per layanan (hari + jam mulai + jam selesai)
- `jadwal_pengecualian` — penyimpangan pada tanggal tertentu (libur, penggantian hari, jam berbeda) + alasan

**Alasan:** perubahan 1–2 kali per bulan terlalu sering untuk mengedit pola induk (yang akan merusak riwayat), tapi terlalu jarang untuk membuang pola berulang.
**Status dugaan:** `SEBAGIAN`

### SCH-05 — PEMBEKUAN JADWAL HARIAN (wajib, jangan dilewatkan)
**Keputusan:** setiap malam, jadwal untuk hari berikutnya **dibekukan** menjadi catatan tersendiri (snapshot per layanan per tanggal). Catatan beku inilah **satu-satunya dasar** penilaian hadir/alpa.
**Alasan:** tanpa pembekuan, laporan kepatuhan bisa **dianulir cukup dengan mengedit satu baris jadwal secara surut**. Seseorang yang alpa cukup meminta jadwalnya diubah, dan alpa itu hilang dari sejarah.
**Implikasi:** pekerjaan terjadwal harian + tabel `jadwal_harian_beku` yang **tidak boleh diubah** setelah dibuat (kecuali oleh Admin dengan alasan dan tercatat).
**Status dugaan:** `BELUM` — **ini keputusan bernilai tinggi dan biaya rendah, prioritaskan.**

### SCH-06 — Tombol cepat FO: tutup/buka layanan hari ini
**Keputusan:** FO punya satu tombol untuk menutup atau membuka layanan **untuk hari ini** beserta alasan. Efeknya **langsung berlaku** ke: situs publik, halaman reservasi, layar TV, bot, dan notifikasi ke warga yang sudah reservasi hari itu.
**Alasan:** perubahan mendadak terjadi 1–2 kali sebulan dan tidak boleh menunggu Admin.
**Status dugaan:** `BELUM`

### SCH-07 — Jadwal dikelola FO DAN Admin, wajib berjejak
**Keputusan:** kedua peran boleh mengubah jadwal. Karena itu **wajib** tercatat siapa mengubah apa, kapan, dari nilai apa ke nilai apa.
**Status dugaan:** `BELUM`

### SCH-08 — Mekanisme absensi: FO klik hadir, petugas boleh mengajukan
**Keputusan:**
1. Alur utama: **petugas lapor ke meja FO, FO klik hadir.**
2. Alur pendukung: petugas bisa menekan **"saya sudah hadir"** dari dashboardnya → muncul sebagai **permintaan konfirmasi satu klik** di layar FO.

**Alasan (a):** tepat secara sosial — petugas P4 bukan pegawai DPMPTSP, dan kontak manusia membuat kehadiran terasa tercatat.
**Alasan (b):** FO tidak boleh menjadi penghambat kalau sedang ramai.
**Aturan mutlak:**
- Klik hadir adalah tindakan berdampak publik → **wajib berjejak**: siapa yang mengklik, jam berapa, untuk petugas siapa.
- **Jam diambil dari server dan TIDAK BISA diatur mundur.** Risiko nyata "absen titipan" — petugas menelepon FO minta diabsenkan padahal belum datang.
- Jam absen **ditampilkan di laporan bulanan** agar pola keterlambatan terlihat sendiri tanpa perlu menuduh.

**Status dugaan:** `SEBAGIAN` (`absensi_petugas` ada dengan `status pending|approved` dan `approved_by` — periksa apakah jam berasal dari server)

### SCH-09 — Absen keluar otomatis + tombol "petugas sudah pulang"
**Keputusan:** absen keluar otomatis di akhir jam layanan, **ditambah** tombol opsional di FO untuk menandai petugas sudah pulang lebih awal.
**Alasan:** absen keluar otomatis saja membuat durasi standby tidak akurat — petugas yang pulang jam 11 terhitung standby penuh.
**Aturan turunan:** kalau petugas pulang lebih awal sementara masih ada antrean, **loket wajib ditutup di sistem** agar warga tidak menunggu orang yang sudah tidak ada. Tiket yang belum dilayani menjadi `tidak_terlayani`.
**Status dugaan:** `SEBAGIAN`

### SCH-10 — Alpa otomatis + pemberitahuan dini ke warga
**Keputusan:** pada hari berjadwal, jika belum ada absensi sampai batas (misalnya 09.00):
1. Status hari itu otomatis menjadi **alpa**.
2. **Email ke warga yang sudah reservasi, sedini mungkin — sebelum warga berangkat.** Isi: loket untuk layanan itu belum tersedia hari ini, tawaran live chat, dan alternatif menghubungi instansi secara langsung (dari `layanan_kontak`, lihat `SVC-06`).
3. Tiket/reservasi **hangus** dan dicatat sebagai **`tidak_terlayani`**.

**Alasan:** "secara realnya akan sangat susah dijelaskan, karena petugas sering mangkir" — pemilik keputusan. Absen merah menjadi catatan bagi pimpinan DPMPTSP untuk disampaikan ke pimpinan instansi.
**Status dugaan:** `BELUM`

### SCH-11 — Reservasi di luar hari jadwal diblokir dengan penjelasan
**Keputusan:** contoh kasus resmi dari pemilik: *"ketika jadwal BPJS hanya di hari Senin, ada pengunjung yang mau mendaftar selain hari itu akan diblokir dan diberitahu bahwa jadwal BPJS di kantor DPMPTSP hanya hari Senin."*
**Berlaku untuk:** pendaftaran antrean di tempat maupun reservasi online.
**Status dugaan:** `SEBAGIAN`

---

## 3.4 NOT — Notifikasi Petugas & Laporan Kepatuhan

### NOT-01 — Tabel `layanan_kontak`, bukan satu kolom email
**Keputusan:** tabel dengan: `layanan_id`, `email`, `peran` (`pic` | `atasan` | `cc`), `aktif`, plus kontak resmi instansi (`SVC-06`).
**Alasan:** eskalasi berjenjang (`NOT-04`) mustahil dengan satu kolom email.
**Aturan penting:** **email layanan bersifat institusional dan tidak berganti** meski PIC-nya berubah. Ini yang membuat notifikasi stabil tanpa perlu menyentuh akun — dan ini yang menjawab kebutuhan asli di balik `RBA-07`.
**Status dugaan:** `BELUM`

### NOT-02 — Pemicu email pengingat petugas: tiga syarat sekaligus
**Keputusan:** email pengingat hanya dikirim jika **KETIGANYA** benar:
1. ada jadwal standby pada tanggal itu, **DAN**
2. petugas belum absen, **DAN**
3. sudah ada antrean/reservasi yang terdaftar sebelumnya.

**Aturan mutlak:** **JANGAN mengirim notifikasi setiap kali ada orang mendaftar antre.** Ini instruksi eksplisit pemilik keputusan.
**Alasan:** notifikasi yang terlalu sering akan diabaikan, dan begitu diabaikan, seluruh mekanisme ini mati.
**Status dugaan:** `BELUM`

### NOT-03 — Kasus khusus layanan internal DPMPTSP
**Konteks:** Matchmaking UMKM dan Investment Gallery dilayani pegawai DPMPTSP yang **kurang aware**. Karena itu email notifikasi tetap diperlukan meski mereka pegawai sendiri.
**Status dugaan:** `BELUM`

### NOT-04 — Jadwal pengiriman & eskalasi berjenjang
**Keputusan:**
| Waktu | Penerima | Isi |
|---|---|---|
| H-1 sore | PIC layanan | "Besok Anda standby, ada N reservasi" |
| Hari-H pagi, sebelum batas absen | PIC layanan | "Hari ini Anda standby, ada N reservasi, mohon absen di FO" |
| Setelah batas absen terlewat | **atasan + FO**, BUKAN petugas lagi | "Layanan X belum ada kehadiran, N warga terdampak" |

**Alasan:** mengirim email keempat, kelima, keenam ke orang yang mengabaikan email pertama tidak menghasilkan apa pun. Eskalasi ke atasan menghasilkan.
**Status dugaan:** `BELUM`

### NOT-05 — Ringkasan harian, bukan per pendaftar
**Keputusan:** 1 email per hari per layanan, memuat ringkasan. `idempotency_key = layanan_id + tanggal + jenis`.
**Implikasi:** pakai tabel `notifikasi` yang sudah ada; `idempotency_key` sudah tersedia.
**Status dugaan:** `SEBAGIAN`

### NOT-06 — Dua varian laporan kepatuhan yang berbeda sifat
| Varian | Layanan | Sifat | Jalur penyampaian |
|---|---|---|---|
| Internal | Matchmaking UMKM, Investment Gallery | Disiplin pegawai sendiri, DPMPTSP punya wewenang penuh | Langsung ke atasan, **bisa masuk penilaian kinerja** |
| Mitra P4 | 7 layanan P4 | Antar-instansi, DPMPTSP **tidak punya wewenang** atas mereka | **Hanya lewat surat pimpinan ke pimpinan instansi** |

**Implikasi:** dua template laporan berbeda, bukan satu laporan dengan filter.
**Status dugaan:** `BELUM`

### NOT-07 — Isi laporan kepatuhan
**Keputusan:** wajib memuat:
1. Persentase hari hadir dari hari yang dijadwalkan
2. Jumlah hari alpa
3. **Jumlah warga terdampak** — ini senjata paling menekan; angka manusia lebih kuat daripada persentase
4. Rata-rata keterlambatan absen

**Aturan:** sebut **nama layanan, bukan nama orang**. Laporan ini tentang instansi. Ini juga yang membuat `RBA-07` (pewarisan akun) tidak merusak validitas laporan.
**Status dugaan:** `BELUM`

---

## 3.5 CHT — Live Chat

### CHT-01 — Chat = percakapan persisten + real-time (seperti WhatsApp)
**Keputusan (kutipan pemilik):** *"fitur live chat ini harus sangat proper ya, karena harus bisa di tinggal dan di lanjut lagi, seperti sms, tapi dia harus bisa juga realtime seperti chat."*
**Implikasi:** `chat_sesi` dengan status `selesai` **harus berubah menjadi utas berkelanjutan** per warga per layanan. Warga bisa pergi, kembali besok, dan melanjutkan percakapan yang sama.
**Status dugaan:** `SALAH` (status `selesai` sekarang kemungkinan menutup sesi secara final)

### CHT-02 — Riwayat dibuka di `/me`, petugas melihat percakapan sebelumnya
**Keputusan:** warga bisa membuka seluruh riwayat chat-nya. Petugas melihat riwayat percakapan sebelumnya dengan warga yang sama, agar tidak bertanya hal yang sudah dijawab.
**Status dugaan:** `SEBAGIAN`

### CHT-03 — Bot menjawab lebih dulu
**Keputusan:** bot menjawab lebih dulu karena mayoritas pertanyaan bersifat teknis dan bisa dijawab dengan pengetahuan tertentu. Petugas masuk kemudian.
**Status dugaan:** `SEBAGIAN`

### CHT-04 — Bot menjadi juru bicara jadwal, bukan hanya FAQ
**Keputusan:** bot wajib bisa menjawab: kapan layanan X standby, apakah hari ini buka, kapan jadwal terdekat, bagaimana cara reservasi. Memakai fungsi yang sama dengan `SCH-01`.
**Alasan:** ini pertanyaan paling sering dan paling mudah diotomatiskan, dan menjawabnya langsung mengurangi beban FO.
**Status dugaan:** `BELUM`

### CHT-05 — Serah terima bot ↔ petugas mulus dua arah
**Keputusan:** bot berhenti otomatis saat petugas masuk; bot aktif lagi setelah petugas menutup. Label **"Bot"** dan **nama petugas** tidak boleh ambigu — warga harus selalu tahu sedang berbicara dengan siapa.
**Status dugaan:** `SEBAGIAN`

### CHT-06 — Live chat tetap berjalan meski loket fisik tutup
**Keputusan:** ini instruksi eksplisit pemilik. Loket libur ≠ chat mati. Bot mengakomodasi, dan ketika petugas siap membalas, dia login dan membalas.
**Status dugaan:** `SEBAGIAN`

### CHT-07 — Dashboard diurutkan berdasarkan LAMA MENUNGGU
**Keputusan:** urutan utama = lama menunggu balasan, **bukan** waktu pesan masuk. Tambahkan penanda warna saat melewati batas.
**Alasan:** orang yang sudah menunggu 3 jam harus muncul di atas, bukan tenggelam di bawah pesan-pesan baru.
**Status dugaan:** `BELUM`

### CHT-08 — FO punya pandangan lintas-layanan untuk takeover
**Keputusan:** FO bisa melihat chat semua layanan dan mengambil alih chat dari petugas layanan lain.
**Alasan:** penerapan P1 — FO adalah jaring pengaman.
**Status dugaan:** `BELUM`

### CHT-09 — Notifikasi hanya saat warga tidak sedang aktif di halaman
**Keputusan:** kalau warga sedang membuka halaman chat, jangan kirim email/push — dia sudah melihat pesannya.
**Alasan:** notifikasi untuk pesan yang sudah dibaca membuat orang mematikan notifikasi, dan setelah itu mekanisme "tinggal dan lanjut" rusak.
**Status dugaan:** `BELUM`

### CHT-10 — Chat wajib login Google
**Fakta:** sudah terpasang. Login memakai akun Google, sehingga email bisa dikirim ke akun Google itu bila ada keadaan tertentu.
**Efek samping positif:** ini **menutup celah bypass rate limit anonim** yang ditemukan di audit (`SEC-02`) untuk jalur chat.
**Status dugaan:** `ADA`

### CHT-11 — Tiga akibat dari wajib login yang harus ditangani
1. **Login sebelum bertanya adalah hambatan** → sediakan **FAQ publik dan jadwal standby tanpa login**. Sumbernya sama dengan bot, dan sekaligus menjadi aset penemuan lewat mesin pencari.
2. **Email Google belum tentu dipantau** → sediakan **preferensi kontak** (email lain / nomor WA). Fondasi sudah ada: `ProfileCompletenessGate`, `pengunjung.no_hp`.
3. **Google-only adalah titik kegagalan tunggal** → aktifkan **magic-link email** sebagai cadangan.

**Status dugaan:** `BELUM`

---

## 3.6 BOT — Chatbot Bersumber Dokumen

<callout>
**Keputusan arsitektur inti:** bot LMH adalah **RAG bersumber dokumen resmi**, bukan model yang menjawab dari pengetahuan umum. Ini keputusan yang mengikat, dan aturan penjaganya **tidak boleh** dijadikan sakelar di dashboard (`CMS-04`).
</callout>

### BOT-01 — Setiap layanan menyediakan 2–3 dokumen peraturan resmi
**Keputusan (usul pemilik, disetujui):** masing-masing petugas layanan memberikan maksimal 2–3 peraturan resmi. Bot mencari jawaban di dalam dokumen itu.
**Aturan:** batas 2–3 **jangan diperlonggar**. Semakin banyak dokumen, semakin melebar pencarian dan semakin sering bot mengambil potongan yang salah. Sedikit dokumen yang tepat mengalahkan banyak dokumen.
**Status dugaan:** `BELUM`

### BOT-02 — Pengolahan dokumen dilakukan SEKALI, bukan per pertanyaan
**Keputusan:** dokumen dipotong dan di-embed **satu kali saat diunggah**. Saat warga bertanya, sistem hanya mencari potongan yang relevan (murah) lalu mengirim potongan itu ke Gemini.
**Alasan biaya (ini menjawab kekhawatiran dana pemilik secara langsung):** kalau dokumen dikirim ulang ke model setiap ada pertanyaan, biayanya membengkak. Dengan pola sekali-olah, biaya per pertanyaan hampir tidak berbeda dari chatbot biasa dan realistis masuk dalam kuota gratis/murah Gemini.
**Status dugaan:** `BELUM`

### BOT-03 — Potong per pasal/ayat, BUKAN per jumlah karakter
**Keputusan:** pemotongan dokumen mengikuti struktur hukum (pasal, ayat, huruf), bukan panjang karakter tetap.
**Alasan:** memotong per karakter akan membelah satu pasal menjadi dua bagian tak bermakna, dan bot akan mengutip separuh syarat — lebih berbahaya daripada tidak menjawab.
**Status dugaan:** `BELUM`

### BOT-04 — Metadata kutipan wajib disimpan per potongan
**Keputusan:** setiap potongan menyimpan: nomor peraturan, tahun, judul, pasal, ayat, halaman.
**Alasan:** memungkinkan bot menjawab dengan rujukan tepat, misalnya *"Berdasarkan Permen X No. 5/2023 Pasal 12 ayat (2)…"*. Rujukan tepat adalah pembeda antara jawaban yang bisa dipertanggungjawabkan dan jawaban yang tidak.
**Status dugaan:** `BELUM`

### BOT-05 — Tiga aturan main bot yang tidak boleh dilanggar
1. **Hanya menjawab dari potongan dokumen yang ditemukan.** Kalau tidak ditemukan, katakan tidak tahu dan tawarkan bertanya ke petugas. Tidak menemukan lalu jujur adalah **keberhasilan**, bukan kegagalan.
2. **Mengutip, tidak menafsirkan.** Bot menyampaikan bunyi aturan. Bot **tidak** menyimpulkan "berarti izin Anda bisa keluar dalam 3 hari". Penafsiran hukum adalah wewenang petugas.
3. **Wajib menyebut status berlaku.** Setiap dokumen punya penanda `berlaku` / `dicabut` beserta tanggal, dan bot **tidak boleh** mengutip dokumen yang dicabut.

**Risiko yang dicegah oleh aturan 3 (yang terbesar dari ketiganya):** mengutip aturan yang sudah dicabut. Bot akan terlihat sangat meyakinkan justru saat sedang paling salah.
**Status dugaan:** `BELUM`

### BOT-06 — Bot menandai jenis jawaban ke warga
**Keputusan:** setiap jawaban diberi penanda salah satu dari:
- **"Informasi resmi"** — bersumber dokumen peraturan / FAQ petugas, sumber ditampilkan
- **"Informasi umum, mohon dikonfirmasi ke petugas"** — tidak ditemukan sumber

**Alasan:** kejujuran sumber adalah pelindung hukum sekaligus pembangun kepercayaan.
**Status dugaan:** `BELUM`

### BOT-07 — Tiga bentuk masukan pengetahuan, dengan urutan keandalan
| Bentuk | Perlakuan | Catatan |
|---|---|---|
| **Tempel/ketik teks langsung** | **Jalur paling andal — sarankan sebagai cara utama** | Tidak ada risiko ekstraksi. Petugas menempel pasal yang relevan saja. |
| **PDF digital (teks bisa disalin)** | Diekstraksi, **wajib ada pratinjau hasil ekstraksi untuk dikoreksi petugas sebelum aktif** | PDF peraturan sering punya kolom, kop, catatan kaki yang membuat teks tercampur |
| **Tautan JDIH / situs resmi** | **Hanya sebagai rujukan yang ditampilkan.** Bot **TIDAK** membaca situs luar saat menjawab | Kalau bot mengambil dari situs luar saat menjawab: lambat, gagal saat situs down, dan bisa berubah tanpa sepengetahuan siapa pun |

**Status dugaan:** `BELUM`

### BOT-08 — TIDAK PERLU OCR
**Keputusan:** karena pemilik memastikan tidak ada PDF hasil pindaian, **jangan bangun OCR**.
**Alasan:** ini penghematan besar dalam kerumitan dan biaya. Kalau suatu hari ada PDF pindaian, tolak dengan pesan yang jelas: *"Dokumen ini hasil pindaian. Mohon tempel teksnya secara manual."*
**Status dugaan:** `BELUM`

### BOT-09 — Petugas mengunggah dokumen, langsung aktif, dengan enam pengaman
**Keputusan:** petugas layanan mengunggah sendiri dan dokumen langsung aktif. Pengaman:
1. **Metadata wajib lengkap sebelum aktif** (nomor, tahun, judul, status berlaku) — satu langkah yang memaksa petugas memeriksa dokumennya
2. **Sumber selalu ditampilkan ke warga** — transparansi memungkinkan koreksi dari publik
3. **Petugas hanya boleh dokumen layanannya sendiri** — sudah cocok dengan `get_my_layanan_id()`
4. **Pengingat tinjau ulang 6–12 bulan** — peraturan berubah dan tidak ada yang ingat memperbarui
5. **Daftar dokumen terbaru untuk Admin** — pengawasan setelah tayang, bukan persetujuan sebelum tayang
6. **Batas jumlah dan ukuran dokumen** per layanan

**Status dugaan:** `BELUM`

### BOT-10 — FAQ petugas langsung aktif, dengan empat pengaman
**Keputusan pemilik:** FAQ yang dibuat petugas **langsung aktif**, petugas bertanggung jawab.
**Pengaman yang disetujui:**
1. Tampilkan **nama penulis dan tanggal** pada setiap FAQ
2. Daftar **"FAQ terbaru diubah"** untuk Admin
3. **Riwayat versi** agar bisa dikembalikan
4. **Pembaruan embedding saat FAQ diubah** — lihat `BOT-11`

**Status dugaan:** `SEBAGIAN`

### BOT-11 — CELAH AKTIF: embedding FAQ tidak diperbarui saat FAQ diubah
**Temuan:** `faq_knowledge_base` punya `embedding` dan `embedding_updated_at`, tetapi **pipeline pembaruan embedding tidak terdefinisi**. Akibatnya FAQ yang diedit tetap dicari memakai embedding lama — bot menjawab berdasarkan versi lama yang sudah diperbaiki petugas. Ini gagal secara tak terlihat: tidak ada error, hanya jawaban salah.
**Wajib:** tandai FAQ sebagai perlu-embed-ulang saat teksnya berubah, dan jalankan pembaruan lewat pekerjaan terjadwal. Terapkan pola yang sama untuk potongan dokumen.
**Status dugaan:** `SALAH` — **prioritas tinggi, biaya rendah.**

### BOT-12 — Pertanyaan tanpa jawaban menjadi usulan FAQ
**Keputusan:** pertanyaan yang tidak ditemukan jawabannya dikumpulkan menjadi daftar usulan FAQ untuk petugas layanan terkait.
**Alasan:** ini yang membuat bot makin pintar tanpa menambah biaya AI, dan memberi petugas alasan konkret untuk mengisi FAQ.
**Sumber data:** `chat_ai_log` sudah ada.
**Status dugaan:** `BELUM`

### BOT-13 — Kualitas RAG harus terukur
**Keputusan:** butuh **golden dataset** (kumpulan pertanyaan dengan jawaban yang benar) dan tombol umpan balik (jawaban ini membantu / tidak) untuk mengukur mutu. Ambang `match_faq()` = 0.7 sekarang adalah angka yang belum pernah diuji.
**Status dugaan:** `BELUM`

### BOT-14 — Model AI tertinggal versi
**Temuan:** `gemini-1.5-flash` dan `text-embedding-004` sudah tertinggal. Kandidat: Gemini 2.x dan `gemini-embedding-001`.
**PERINGATAN KERAS:** mengganti model embedding **mewajibkan embed ulang SELURUH data**. Embedding dari model berbeda tidak bisa dibandingkan satu sama lain. Kalau diganti tanpa embed ulang total, pencarian akan mengembalikan hasil acak yang tampak masuk akal. Rencanakan sebagai satu pekerjaan tersendiri dengan verifikasi.
**Status dugaan:** `SEBAGIAN`

---

## 3.7 CMP — Kanal Pengaduan (BARU, DAN INI KEWAJIBAN HUKUM)

### CMP-01 — Kanal pengaduan tersendiri, bernomor tiket, berbatas waktu
**Keputusan:** bukan sekadar formulir kontak. Setiap pengaduan mendapat **nomor tiket** dan **batas waktu penanganan**.
**Dasar hukum:** UU 25/2009 tentang Pelayanan Publik mewajibkan pengelolaan pengaduan. Ini **hal pertama yang dicari penilai eksternal** (Ombudsman, ZI/WBK).
**Status dugaan:** `BELUM` — **belum ada sama sekali. Salah satu dari dua celah kepatuhan hukum terbesar.**

### CMP-02 — FO menerima dan meneruskan
**Keputusan:** FO adalah penerima pengaduan dan yang meneruskan ke layanan terkait.
**Alasan:** konsisten dengan P1 — kalau pengaduan langsung masuk ke petugas layanan, pengaduan tentang petugas yang tidak pernah hadir akan masuk ke petugas yang tidak pernah hadir itu.
**Status dugaan:** `BELUM`

### CMP-03 — Batas waktu dihitung sistem, bukan dicatat manual
**Keputusan:**
- Verifikasi: **3 hari kerja**
- Penanganan: **14 hari kerja**
- Penghitung waktu berjalan otomatis + penanda warna saat mendekati batas

**Alasan:** batas waktu yang hanya tertulis di dokumen tidak pernah ditepati. Batas waktu yang menghitung sendiri dan berubah merah menghasilkan tindakan.
**Catatan teknis:** "hari kerja" wajib memperhitungkan Sabtu, Minggu, dan hari libur nasional. Butuh tabel hari libur — bisa berbagi dengan `jadwal_pengecualian`.
**Status dugaan:** `BELUM`

### CMP-04 — Eskalasi otomatis saat batas terlampaui
**Keputusan:** saat batas waktu terlampaui, pengaduan **naik ke Admin/pimpinan**, bukan mengingatkan pelaksana lagi.
**Alasan:** sama dengan `NOT-04`. Mengingatkan orang yang sama untuk kesepuluh kali tidak menghasilkan apa pun.
**Status dugaan:** `BELUM`

### CMP-05 — Warga melacak dengan nomor tiket + kontak, TANPA login
**Keputusan:** pelacakan tidak boleh mewajibkan login.
**Alasan:** orang yang paling perlu mengadu adalah orang yang paling tidak sabar membuat akun.
**Catatan keamanan:** karena tanpa login, jalur ini rentan penebakan nomor tiket dan pengumpulan data. Wajib: nomor tiket tidak berurutan (acak), kombinasi tiket + kontak, dan rate limit.
**Status dugaan:** `BELUM`

### CMP-06 — DUA JALUR TERPISAH (jangan digabung)
| Jalur | Isi | Siapa yang boleh melihat |
|---|---|---|
| **A. Pengaduan layanan** | Antrean lama, informasi tidak jelas, sistem error | Boleh diteruskan ke layanan terkait |
| **B. Pengaduan perilaku / integritas / pungli** | Petugas minta uang, perilaku tidak pantas | **HANYA Admin dan pimpinan. TIDAK PERNAH oleh petugas mana pun, termasuk FO.** Izinkan **anonim** dengan token pelacakan |

**Alasan:** kalau kedua jalur digabung, pengaduan pungli akan terbaca oleh orang yang diadukan, dan tidak akan ada yang mengadu lagi.
**Nilai tambah:** ini melengkapi Survei Persepsi Anti Korupsi. Survei mengukur **persepsi**; kanal ini menangkap **kejadian nyata**. Keduanya diperlukan.
**Implikasi teknis:** aturan RLS untuk jalur B harus **sangat ketat dan wajib diuji secara perilaku**, bukan hanya diperiksa secara statis.
**Status dugaan:** `BELUM`

### CMP-07 — Lampiran bukti masuk bucket privat
**Keputusan:** lampiran bukti (foto, dokumen) **wajib** di bucket privat. **JANGAN** memakai `umkm-photos` yang publik.
**Status dugaan:** `BELUM`

### CMP-08 — Tombol "jadikan pengaduan" dari dalam live chat
**Keputusan:** dari percakapan chat, warga atau petugas bisa mengubah percakapan menjadi pengaduan resmi tanpa mengulang cerita.
**Alasan:** keluhan nyata masuk lewat chat lebih dulu, lalu hilang. Ini menangkapnya.
**Status dugaan:** `BELUM`

### CMP-09 — Standar Pelayanan & Maklumat Pelayanan wajib ditayangkan
**Keputusan:** buat halaman publik yang memuat, per layanan: persyaratan, prosedur, jangka waktu, biaya, produk layanan, dan penanganan pengaduan. Ditambah Maklumat Pelayanan.
**Dasar hukum:** UU 25/2009. Ini **celah kepatuhan hukum kedua** yang belum ada.
**Nilai teknis:** isi halaman ini **juga menjadi bahan pengetahuan bot**. Satu pekerjaan, dua manfaat.
**Status dugaan:** `BELUM`

---

## 3.8 GST — Buku Tamu

### GST-01 — Buku tamu adalah entitas yang TERPISAH TOTAL dari antrean
**Keputusan (kutipan pemilik):** *"buku tamu dan antrian atau pengunjung Layanan itu berbeda ya, jadi buku tamu hanya di catat di buku tamu saja."*
**Implikasi:** `visit.tujuan = 'bertemu_seseorang'` **harus dipindahkan** ke tabel `buku_tamu` tersendiri. Tamu buku tamu **tidak** masuk antrean, **tidak** dapat nomor, **tidak** dihitung dalam rekap kunjungan layanan.
**Status dugaan:** `SALAH`

### GST-02 — Field buku tamu
**Keputusan:** nama, asal (instansi/daerah), nomor HP, hendak menemui siapa, keperluan, waktu masuk, dan **tanda tangan**.
**Status dugaan:** `SEBAGIAN`

### GST-03 — Tanda tangan disimpan sebagai SVG PATH, bukan PNG
**Keputusan:** tanda tangan digital di web disimpan sebagai **jalur (path) SVG** dalam kolom teks, **bukan** gambar PNG.
**Perbandingan ukuran:**
| Bentuk | Ukuran per tanda tangan | 20.000 tamu |
|---|---|---|
| PNG | 50–200 KB | 1–4 GB |
| SVG path | **1–5 KB** | **20–100 MB** |

**Alasan:** permintaan eksplisit pemilik adalah "disimpan dalam bentuk file yang sangat efisien". SVG path memenuhi itu 40–50 kali lebih baik, dan bonusnya bisa dirender ulang pada resolusi apa pun untuk dicetak.
**Aturan tambahan:** tanda tangan adalah data pribadi → **jangan di bucket publik**, ikut kebijakan retensi, hanya bisa dilihat FO dan Admin.
**Status dugaan:** `BELUM`

### GST-04 — Buku tamu adalah fitur FO, bukan fitur publik
**Keputusan:** diisi oleh FO di meja depan, praktis untuk dipakai di tablet.
**Implikasi:** rancang untuk sentuh dan cepat, bukan formulir panjang.
**Status dugaan:** `BELUM`

---

## 3.9 MMK — Matchmaking UMKM

### MMK-01 — Pengusul: pengunjung login DAN petugas, keduanya lewat review
**Keputusan:** kedua jalur ada, keduanya tetap melewati tinjauan petugas Matchmaking UMKM.
**Alasan:** petugas perlu bisa memasukkan UMKM yang ditemui di lapangan dan tidak akan pernah mendaftar sendiri. Tapi listing buatan petugas juga perlu ditinjau — petugas bisa salah ketik atau terlalu bersemangat.
**Status dugaan:** `SEBAGIAN`

### MMK-02 — Verifikasi tiga lapis
1. **Kelengkapan dan kepantasan isi**
2. **Legalitas usaha** — NIB / NPWP
3. **Kontak aktif**

**Status dugaan:** `BELUM`

### MMK-03 — Tambah status `perlu_perbaikan`
**Keputusan:** sekarang petugas hanya bisa menerima atau menolak. Tambahkan `perlu_perbaikan` beserta **catatan alasan**.
**Alasan:** mayoritas listing UMKM tidak salah, hanya kurang lengkap. Menolak akan membuat UMKM menyerah; meminta perbaikan membuat mereka melengkapi.
**Status dugaan:** `BELUM`

### MMK-04 — Field legalitas masuk BUCKET PRIVAT
**Keputusan:** tambah NIB, NPWP, nama badan usaha, dan berkas legalitas. Berkas **wajib** di bucket privat.
<callout>
**PERINGATAN:** `umkm-photos` bersifat **publik untuk dibaca**. Menaruh berkas legalitas di sana = **kebocoran data pribadi dan data usaha**. Buat bucket privat baru.
</callout>
**Yang tampil ke publik:** hanya lencana **"Legalitas terverifikasi"**. **JANGAN menampilkan nomor NIB/NPWP ke publik** — tidak ada manfaatnya bagi pencari mitra, dan bisa disalahgunakan.
**Status dugaan:** `BELUM`

### MMK-05 — Simpan JEJAK verifikasi, bukan hanya status akhir
**Keputusan:** catat siapa memeriksa apa, kapan, dan dengan cara apa (misal: "NIB dicocokkan di OSS pada 12 Agustus oleh Budi").
**Alasan:** kalau nanti ada masalah dengan satu UMKM, pertanyaan pertama pimpinan adalah "siapa yang memverifikasi?". Tanpa jejak, seluruh tim yang menanggung.
**Status dugaan:** `BELUM`

### MMK-06 — Verifikasi kontak: email otomatis, telepon manual tapi tercatat
**Keputusan:** email diverifikasi otomatis lewat magic-link (mekanisme K5 sudah ada). Telepon diverifikasi manual, **tetapi hasilnya wajib dicatat**.
**Aturan:** **jangan tayangkan listing yang kontaknya belum terverifikasi.** Listing dengan nomor mati merusak kepercayaan seluruh fitur — satu pengalaman buruk membuat orang berhenti memakai.
**Status dugaan:** `SEBAGIAN`

### MMK-07 — Masa berlaku listing 6 bulan + pengingat
**Temuan:** status `expired` sudah ada di enum, **tetapi tidak ada mekanisme apa pun yang mengubah status menjadi expired**. Artinya listing hidup selamanya.
**Keputusan:** masa berlaku **6 bulan**, dengan pengingat **2 minggu sebelum berakhir** agar pemilik bisa memperpanjang.
**Alasan:** kebutuhan bahan baku berubah, UMKM tutup. Direktori berisi data mati lebih buruk daripada direktori kecil yang segar.
**Status dugaan:** `SALAH`

### MMK-08 — Perubahan pasca-tayang pada field kritikal wajib ditinjau ulang
**Keputusan:**
| Jenis perubahan | Akibat |
|---|---|
| Nama usaha, kontak, kategori, legalitas | Kembali ke `pending_review` |
| Deskripsi minor, foto tambahan | Langsung berlaku |

**Alasan:** tanpa aturan ini, listing bisa lolos review sebagai "katering rumahan" lalu diubah menjadi hal lain sepenuhnya setelah tayang.
**Catatan implementasi:** `snapshot_approved` sudah ada dan **memang dirancang untuk ini** — bandingkan nilai sekarang dengan snapshot untuk menentukan apakah field kritikal berubah.
**Status dugaan:** `SEBAGIAN`

### MMK-09 — Klausul penafian publik wajib ada
**Keputusan:** tampilkan di halaman matchmaking: DPMPTSP **memfasilitasi pertemuan**, **tidak menjamin** kualitas, harga, atau keberhasilan transaksi, dan **bukan pihak dalam perjanjian** antara UMKM dan pembeli.
**Alasan:** ini fitur mempertemukan pihak yang akan bertransaksi. Kalau ada sengketa, pihak yang dirugikan akan datang ke DPMPTSP. Satu paragraf penafian yang ditempatkan sejak awal jauh lebih murah daripada mengurus sengketa.
**Status dugaan:** `BELUM`

---

## 3.10 INV — Investment Gallery & Peta Potensi

### INV-01 — Peta potensi: cukup login, tidak perlu persetujuan
**Keputusan pemilik:** cukup login. Saat login pertama, sistem sudah meminta melengkapi data lewat `ProfileCompletenessGate`, jadi data tersimpan otomatis.
**Status dugaan:** `ADA`

### INV-02 — Perlakukan gerbang login sebagai KONTROL ATRIBUSI, bukan keamanan
**Keputusan:** nilai sebenarnya dari gerbang login **bukan** menyembunyikan peta — tetapi mengetahui **siapa melihat potensi apa**.
**Alasan:** orang yang menghabiskan waktu di peta potensi tambang di Lampung Barat adalah calon investor yang jauh lebih berkualitas daripada orang yang mengisi formulir minat. Jejak perilaku ini adalah sumber prospek yang lebih kaya daripada `investasi_lead`.
**Implikasi:** catat penayangan peta, sektor yang dilihat, dokumen yang dibuka — lalu sambungkan ke `investasi_lead`.
**Status dugaan:** `BELUM`

### INV-03 — Gerbang profil dijaga RINGAN
**Keputusan:** minta hanya nama, instansi/perusahaan, dan bidang minat. **Jangan** tambah field.
**Alasan:** yang dicari adalah **volume** calon investor. Setiap field tambahan mengurangi jumlah orang yang lewat. `ProfileCompletenessGate.tsx` berukuran ~13.7 KB — periksa apakah sudah terlalu berat.
**Status dugaan:** `SEBAGIAN`

### INV-04 — Dokumen IPRO: watermark dibakar di server, per permintaan
**Keputusan:** **semua halaman** dokumen IPRO boleh dilihat publik, tetapi **wajib berwatermark**.
**Aturan teknis:**
- Watermark **dibakar ke dalam gambar di server saat permintaan** (bukan overlay CSS — overlay CSS bisa dihapus dengan klik kanan Inspect Element)
- Pengguna login → sisipkan nama dan email
- Anonim → sisipkan waktu dan penanda sesi

**CELAH KEAMANAN AKTIF yang harus ditutup:** `/api/investment-docs/page-image` dan `/public-view` — diyakini bisa dipakai mengambil halaman dokumen tanpa kontrol yang memadai. **Periksa ini di fase A dan tangani di fase paling awal.**
**Status dugaan:** `SALAH`

### INV-05 — Catatan jujur tentang batas perlindungan watermark
**Pernyataan yang harus dipahami dan jangan dilupakan:** kalau dokumen IPRO memuat angka finansial atau data sensitif, maka membukanya penuh ke publik berarti **menerima bahwa dokumen itu akan tersebar**. Watermark **melacak asal kebocoran**, tidak mencegah kebocoran.
**Instruksi:** jangan membangun lapisan kerumitan yang menciptakan **ilusi perlindungan**. Kalau ada dokumen yang benar-benar tidak boleh tersebar, dokumen itu tidak boleh berada di jalur publik sama sekali — dan itu keputusan isi dokumen, bukan keputusan teknis.

### INV-06 — Pencatatan perilaku wajib diungkapkan
**Keputusan:** karena `INV-02` mencatat perilaku pengguna, hal ini **wajib** disebut dalam kebijakan privasi dan tercatat di `consent_log`.
**Alasan:** mencatat perilaku tanpa memberi tahu adalah pelanggaran, dan pada situs pemerintah risikonya berganda.
**Status dugaan:** `SEBAGIAN`

---

## 3.11 DSP — Layar Antrean untuk TV

### DSP-01 — Tata letak grid semua loket
**Keputusan (kutipan pemilik):** *"semua loket tampil nama loketnya, dan antrian yang sedang di layani, sisa antrian lebih kecil, lalu nanti ada di bawah running teks yang informatif lainnya."*
**Susunan:**
```
┌────────────┐ ┌────────────┐ ┌────────────┐
│ LOKET 1     │ │ LOKET 2     │ │ LOKET 3     │
│ Helpdesk OSS│ │ Perizinan   │ │ BPJS        │
│   A-014     │ │   B-007     │ │  TUTUP      │  <- nomor: SANGAT BESAR
│ sisa 6      │ │ sisa 12     │ │ Jadwal:Senin│  <- sisa: kecil
└────────────┘ └────────────┘ └────────────┘
───────────────────────────────────────────
 running text …            diperbarui 14:32
```
**Catatan:** 11 loket dalam satu layar TV berarti setiap kotak kecil. Rancang agar **nomor tetap terbaca dari jarak 5 meter** — ini yang menentukan apakah fitur ini berguna atau tidak.
**Status dugaan:** `BELUM`

### DSP-02 — Ketahanan koneksi: penyambungan ulang + polling cadangan + penanda waktu
**Keputusan wajib:**
1. Penyambungan ulang otomatis saat koneksi real-time terputus
2. **Polling cadangan** kalau real-time gagal terus
3. **Penanda "diperbarui 14:32"** yang selalu terlihat

**Alasan (ini yang terpenting):** **layar yang diam dan menampilkan data lama jauh lebih berbahaya daripada layar kosong.** Layar kosong membuat orang bertanya ke FO. Layar yang salah membuat orang menunggu nomor yang sudah lewat. Penanda waktu membuat kegagalan terlihat sendiri tanpa perlu ada yang memeriksa.
**Status dugaan:** `BELUM`

### DSP-03 — Tahan menyala berhari-hari
**Keputusan:** halaman ini akan menyala berminggu-minggu tanpa disentuh. Wajib:
- Muat ulang halaman secara berkala (misalnya tiap beberapa jam) untuk mencegah kebocoran memori
- Sembunyikan kursor
- Mode layar penuh
- Cegah layar tidur

**Status dugaan:** `BELUM`

### DSP-04 — Loket tutup ditampilkan JELAS, bukan dikosongkan
**Keputusan:** loket yang tidak melayani menampilkan **"Tidak melayani hari ini"** dan **"Jadwal: Senin"**.
**Alasan:** kotak kosong membuat warga menunggu tanpa harapan. Kotak yang menyatakan tutup beserta jadwalnya mengurangi pertanyaan ke FO secara nyata — layar ini bisa menjawab pertanyaan yang paling sering diajukan tanpa ada orang yang perlu bicara.
**Status dugaan:** `BELUM`

### DSP-05 — Running text dikelola dari dashboard Admin
**Keputusan:** teks berjalan bisa diubah Admin tanpa menyentuh kode.
**Status dugaan:** `BELUM`

### DSP-06 — JANGAN tampilkan nama warga, hanya nomor
**Keputusan:** layar TV **hanya** menampilkan nomor antrean.
<callout>
**PERINGATAN PDP:** `visit` memuat nama pengunjung. Menampilkan nama di layar publik = **pengungkapan data pribadi**, dan ini kesalahan yang sangat mudah terjadi (cukup satu `SELECT *` yang tidak hati-hati).
</callout>
**Instruksi:** buat view/endpoint khusus layar yang **secara struktural tidak memuat kolom nama** — jangan mengandalkan komponen frontend yang tidak menampilkannya.
**Status dugaan:** `BELUM`

### DSP-07 — Alamat khusus layar dengan token, tanpa login
**Keputusan:** TV tidak bisa login. Sediakan URL bertoken yang hanya bisa membaca data antrean.
**Aturan:** token hanya memberi akses baca ke data antrean minimal (`DSP-06`), tidak ke apa pun yang lain.
**Status dugaan:** `BELUM`

### DSP-08 — Suara panggilan: BELUM DIPUTUSKAN
**Status:** pemilik keputusan menyatakan akan dibahas nanti.
**Opsi yang sudah dipetakan:**
| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| **Rekaman potongan audio** (angka + nama loket direkam, disusun saat memanggil) | **Direkomendasikan.** Kualitas terkendali, tidak perlu internet, tanpa biaya berulang | Perlu perekaman awal |
| Suara sintetis browser (Web Speech API) | Gratis, tanpa persiapan | Kualitas suara Indonesia tidak konsisten antar perangkat |
| Suara sintetis server | Kualitas bagus | Ada biaya berulang, perlu internet |

**Instruksi untuk agent:** JANGAN implementasikan. Catat sebagai `OPEN-QUESTION`. **Tetapi** rancang mekanisme pemanggilan (`QUE-17`) agar **menerbitkan peristiwa "nomor dipanggil"** sehingga suara bisa ditambahkan nanti tanpa mengubah apa pun.

---

## 3.12 RPT — Rekap, Laporan & Data

### RPT-01 — Satu lapisan metrik, empat penyajian
**Keputusan:** semua bentuk keluaran diminta: PDF berkop, Excel/CSV, dashboard grafik, dan laporan bulanan lewat email ke pimpinan.
**Aturan arsitektur:** **bangun SATU lapisan perhitungan metrik**, lalu empat penyaji yang memakai lapisan itu. **JANGAN** membuat empat perhitungan terpisah.
**Alasan:** kalau angkanya berbeda antara dashboard dan PDF, seluruh sistem kehilangan kredibilitas — dan itu tidak bisa dipulihkan dengan penjelasan.
**Status dugaan:** `BELUM`

### RPT-02 — Empat kelompok konsumen laporan, kebutuhan berbeda
| Konsumen | Butuh | Bentuk |
|---|---|---|
| FO harian | Operasional hari ini | Dashboard |
| Pimpinan | Ringkasan & tren | Email bulanan + PDF |
| Penilai eksternal (ZI/WBK, Ombudsman) | Bukti resmi | PDF berkop bernomor |
| Tiap layanan | Kinerja sendiri | Dashboard terbatas layanannya |

**Status dugaan:** `BELUM`

### RPT-03 — Definisi metrik tunggal dan terdokumentasi
**Keputusan:** buat satu dokumen definisi metrik. Contoh yang wajib jelas: apakah "pengunjung" berarti orang atau kunjungan atau tiket? (jawaban: lihat `QUE-01` — ada tiga angka berbeda dan semuanya sah, jadi nama tiap angka harus tegas).
**Alasan:** penilai eksternal akan bertanya bagaimana angka dihitung. Jawaban "tergantung halaman mana" adalah kegagalan.
**Status dugaan:** `BELUM`

### RPT-04 — Snapshot PDF resmi
**Keputusan:** setiap PDF resmi wajib memuat: **nomor laporan, periode, waktu cetak, dan siapa yang mencetak** — dan **isinya dibekukan**.
**Alasan:** laporan yang dicetak untuk penilai harus bisa ditelusuri kembali dan angkanya tidak boleh berubah kalau dicetak lagi bulan depan.
**Status dugaan:** `BELUM`

### RPT-05 — Rollup agregat harian per layanan
**Keputusan:** ringkas data harian per layanan ke tabel agregat, jangan menghitung dari data mentah untuk rentang panjang.
**Alasan:** kalau rekap kustom setahun dijalankan langsung di atas data mentah, dalam dua tahun laporan akan gagal *timeout* — dan biasanya tepat saat penilai sedang menunggu.
**Status dugaan:** `BELUM`

### RPT-06 — Ekspor berisi PII wajib dibatasi dan dicatat
**Keputusan:**
- Petugas layanan hanya bisa mengekspor data layanannya sendiri (`RBA-08`)
- **Setiap ekspor tercatat di `audit_log`**: siapa, kapan, rentang tanggal apa, berapa baris

**Alasan:** ekspor Excel berisi nama dan nomor HP warga adalah cara paling gampang data keluar dari sistem. Kalau suatu hari data warga tersebar, log ini adalah satu-satunya cara mengetahui sumbernya.
**Status dugaan:** `BELUM`

### RPT-07 — SELURUH batas "hari" memakai Asia/Jakarta
**Keputusan:** batas hari untuk penomoran antrean, reset harian, `no_show`, alpa, rollup, dan cron **wajib** Asia/Jakarta.
**Alasan:** kalau memakai UTC, "hari" berakhir pukul 07.00 WIB — tepat saat kantor mulai buka. Angka akan salah setiap hari, dengan cara yang sangat membingungkan untuk didiagnosis.
**Instruksi:** cari di seluruh kode pemakaian `new Date()`, `now()`, `current_date`, `CURRENT_DATE`, dan `date_trunc` yang berkaitan dengan batas hari. Laporkan setiap temuan.
**Status dugaan:** `SALAH` — **periksa lebih dulu, ini kandidat bug produksi aktif.**

### RPT-08 — Rekap kustom rentang tanggal
**Keputusan:** kunjungan, buku tamu, dan hasil survei wajib bisa direkap untuk rentang tanggal bebas.
**Status dugaan:** `SEBAGIAN`

---

## 3.13 SRV — Survei & Ulasan (DITUNDA, TAPI JANGAN DIRUSAK)

### SRV-01 — Fitur survei ditunda
**Keputusan pemilik:** *"untuk fitur survey ini akan di kembangkan nanti saja. keep in mind tapi nanti kita implementasikan."*
**Ruang lingkup yang nanti dibutuhkan:** Survei Kepuasan Masyarakat (SKM), Survei Persepsi Anti Korupsi (SPAK), ulasan Google Maps.
**Instruksi:** JANGAN bangun sekarang.

### SRV-02 — ATURAN LARANGAN: jangan tambah survei berpola `u1..u9`
**Keputusan:** `skm_respons` memakai kolom `u1_persyaratan` … `u9_pengaduan`, mengikuti PermenPANRB 14/2017. **JANGAN membuat tabel serupa untuk SPAK atau survei lain.**
**Alasan:** dua tabel berpola sama akan menjadi tiga, lalu empat. Setiap penambahan pertanyaan akan menjadi migrasi skema pada sistem live.
**Arah yang benar:** bangun **mesin survei generik** (definisi survei → pertanyaan → jawaban) **di samping** tabel SKM yang ada, lalu migrasikan SKM ke dalamnya. Jangan bongkar SKM lebih dulu.

### SRV-03 — Yang boleh dikerjakan sekarang karena murah
**Keputusan:** satu hal yang boleh dikerjakan sekarang adalah **mencatat response rate SKM** (berapa yang dilayani vs berapa yang mengisi).
**Alasan:** penilai eksternal selalu menanyakan ini, dan datanya **tidak bisa dibuat surut**. Kalau tidak dicatat sejak sekarang, angkanya hilang selamanya.
**Status dugaan:** `BELUM`

### SRV-04 — Google Maps: tautan + input manual, JANGAN pakai API berbayar
**Keputusan:** sediakan tombol "beri ulasan" yang mengarah ke Google Maps, dan input manual angka bulanan (jumlah ulasan + rata-rata bintang) untuk laporan.
**Alasan teknis:** Google Places API berbayar, dan **ketentuan layanan Google melarang menyimpan ulang isi ulasan individual**. Input manual bulanan memenuhi kebutuhan laporan tanpa biaya dan tanpa masalah lisensi.
**Status dugaan:** `BELUM`

---

## 3.14 RBA — Peran & Hak Akses

### RBA-01 — Lima peran
| # | Peran | Ringkasan |
|---|---|---|
| 1 | **Admin** | Kelola semua akun & hak akses, pengaturan fitur & tampilan situs, isi situs utama & menu layanan, pengaturan bot, kelola konten, live chat, kelola FAQ, seluruh pengaturan sistem |
| 2 | **Petugas Front Office** | Kelola antrean, registrasi walk-in, buku tamu, absensi seluruh petugas P4, kelola jadwal standby, lihat kunjungan, rekap kunjungan/buku tamu/survei, takeover live chat dari layanan lain |
| 3 | **Petugas Layanan (DPMPTSP & P4)** | Kelola antrean layanannya, balas live chat kapan saja & di mana saja, kelola FAQ khusus layanannya |
| 4 | **Pengunjung online (login)** | Akses semua layanan online, boleh mengusulkan matchmaking UMKM (tetap lewat review) |
| 5 | **Pengunjung tanpa login** | Lihat UMKM & investment gallery, **tidak bisa melihat peta potensi** |

### RBA-02 — `petugas.role` harus menampung `front_office`
**Temuan:** `role` sekarang hanya `petugas | admin`. Peran FO memiliki wewenang lintas-layanan yang sangat luas (absensi semua P4, jadwal, takeover chat, buku tamu, pengaduan) dan **tidak bisa diwakili** oleh `petugas`.
**Keputusan:** tambah nilai `front_office`.
**Implikasi:** memengaruhi `get_my_role()`, `set_user_role_claim()`, `canAccessAdminPath()`, `ADMIN_NAV`, `AdminGuard.tsx`, dan **seluruh kebijakan RLS**. Ini pekerjaan yang menyentuh banyak tempat — rencanakan sebagai satu work package tersendiri.
**Status dugaan:** `SALAH`

### RBA-03 — Satu petugas satu layanan, tetapi PIC bisa berbeda-beda orang
**Keputusan pemilik:** *"satu petugas satu layanan, tetapi di satu layanan, petugasnya bisa beda beda orang yang in charge."*
**Implikasi:** `petugas.layanan_id` tunggal **tetap valid**. **JANGAN** membangun relasi banyak-ke-banyak petugas–layanan.
**Status dugaan:** `ADA`

### RBA-04 — Loket bebas tanpa penguncian sesi
**Keputusan pemilik:** *"Bebas, tetapi kasus ini sangat jarang, bahkan mereka kebanyakan tidak bertanggung jawab dan tidak mau login iseng iseng."*
**Implikasi:** tidak perlu penguncian sesi loket. Cukup penguncian di tingkat baris tiket (`QUE-07`) + catat `dilayani_oleh`.
**Status dugaan:** `BELUM` (penguncian tiket)

### RBA-05 — Pembuatan akun HANYA oleh Admin
**Keputusan:** hanya Admin yang boleh membuat akun petugas.
**Status dugaan:** `SEBAGIAN`

### RBA-06 — Butuh kolom aktif/nonaktif pada `petugas`
**Temuan (masalah nyata):** `petugas` **tidak punya** kolom aktif/nonaktif. Artinya satu-satunya cara menghentikan akses adalah **menghapus baris** — dan itu **menghancurkan riwayat**: siapa melayani tiket apa, siapa membalas chat apa, siapa membuat FAQ apa, semuanya kehilangan rujukan.
**Keputusan:** tambah `aktif boolean` dan `nonaktif_sejak timestamptz`.
**Status dugaan:** `BELUM` — **prioritas tinggi, biaya rendah.**

### RBA-07 — Akun DIWARISKAN saat PIC berganti (KEPUTUSAN SADAR, RISIKO DITERIMA)
<callout>
**PERHATIAN AGENT:** keputusan ini pernah dibantah keras dan **pemilik keputusan tetap memilih pewarisan akun sambil menerima risikonya secara eksplisit.** JANGAN mengangkat perdebatan ini lagi. Implementasikan sesuai keputusan beserta pengaman di bawah.
</callout>

**Keputusan:** ketika PIC suatu layanan berganti, **akun yang sama diwariskan** — nama dan email diganti, bukan membuat akun baru.

**Argumen tandingan yang sudah disampaikan dan sudah diputuskan untuk diterima:**
- Login memakai Google, jadi identitas terikat ke akun Google. "Ganti email" secara teknis berarti **melepas tautan `auth_user_id` lama dan menautkan yang baru** — bukan sekadar mengubah teks.
- Kalau relink gagal atau tidak dilakukan, **pemegang lama masih bisa login**, dan bisa membaca chat warga serta memanggil antrean.
- Bertentangan dengan *Individual Account Policy* di PRD.
- Jejak audit dan laporan kepatuhan menjadi ambigu tentang siapa yang bertanggung jawab.

**Pengaman WAJIB yang harus diimplementasikan:**
1. **Pergantian pemegang harus satu tindakan resmi di dashboard Admin** — bukan mengedit field satu per satu. Tindakan itu: memutus tautan identitas Google lama, mengirim undangan ke email baru, dan **mengakhiri seluruh sesi login pemegang lama**.
2. **Audit log otomatis menjadi garis waktu pemegang akun** — tanpa perlu fitur tambahan, riwayat pergantian bisa dibaca dari log. Ini yang memulihkan sebagian besar nilai yang hilang.
3. **Laporan menyebut nama layanan, bukan nama orang** (`NOT-07`) — dan ini pembenaran yang menguatkan pilihan pemilik: laporan kepatuhan memang laporan **tentang instansi**, bukan tentang individu. Dengan begitu, sebagian besar risiko pewarisan akun hilang dengan sendirinya.
4. **Email notifikasi bersifat institusional** (`NOT-01`), sehingga notifikasi tidak bergantung pada pergantian PIC.

**Status dugaan:** `BELUM`

### RBA-08 — FO boleh MENONAKTIFKAN akun, satu arah
**Keputusan:** FO boleh menonaktifkan akun petugas, tetapi:
- **Hanya menonaktifkan. TIDAK bisa mengaktifkan kembali.**
- **Wajib mengisi alasan.**
- **Admin mendapat pemberitahuan.**

**Alasan:** wewenang satu arah adalah pola yang aman — kesalahan mudah diperbaiki oleh Admin, sementara penyalahgunaan (menonaktifkan lalu mengaktifkan lagi diam-diam untuk menutupi sesuatu) menjadi tidak mungkin.
**Status dugaan:** `BELUM`

### RBA-09 — TIDAK ADA peran pimpinan khusus
**Keputusan:** pimpinan memakai akun Admin.
**Syarat mutlak:** **akun Admin tersendiri atas nama pimpinan. JANGAN berbagi akun.**
**Alasan:** kalau pimpinan memakai akun Admin yang sama dengan operator, **seluruh audit log kehilangan nilainya** — tidak ada cara mengetahui siapa yang melakukan apa. Membuat akun Admin kedua tidak memerlukan kode tambahan sama sekali.
**Catatan masa depan:** peran "hanya lihat" bisa ditambahkan dengan biaya rendah nanti kalau penilaian ZI menuntut pemisahan wewenang.
**Status dugaan:** `SEBAGIAN`

### RBA-10 — Petugas layanan hanya melihat rekap layanannya sendiri
**Keputusan:** tidak ada perubahan — sudah sesuai dengan `get_my_layanan_id()`.
**Pengecualian:** FO **butuh** pandangan lintas-layanan (antrean, chat, absensi, rekap).
**Status dugaan:** `ADA` (untuk petugas), `BELUM` (untuk FO)

### RBA-11 — Pengunjung tanpa login TIDAK boleh melihat peta potensi
**Keputusan:** UMKM dan galeri investasi boleh dilihat tanpa login; **peta potensi wajib login.**
**Status dugaan:** `ADA`

---

## 3.15 CMS — Pengelolaan Konten & Pengaturan

### CMS-01 — Yang BOLEH diubah Admin dari dashboard
**Keputusan:** Admin boleh mengubah bebas:
1. Daftar layanan, jam layanan, jadwal standby, nomor loket
2. Teks & gambar halaman utama, pengumuman, running text
3. Menu & urutan tampilan layanan
4. Perilaku bot: sapaan, jam aktif
5. Postingan/berita & galeri kegiatan
6. Teks penolakan (`P3`)
7. Batas ambil nomor per layanan (`QUE-10`)
8. Isi email pemberitahuan
9. **Dan seluruh aturan sistem lainnya** yang tidak masuk `CMS-04`

**Status dugaan:** `SEBAGIAN`

### CMS-02 — Publikasi LANGSUNG TAYANG
**Keputusan:** perubahan konten langsung tayang tanpa alur persetujuan.
**Alasan:** alur persetujuan pada tim kecil menghasilkan satu akibat yang bisa diprediksi — **konten berhenti diperbarui**.
**Status dugaan:** `SEBAGIAN`

### CMS-03 — Riwayat versi + tombol kembalikan adalah SYARAT dari CMS-02
**Keputusan:** karena tidak ada persetujuan sebelum tayang, **wajib** ada riwayat versi dengan tombol kembalikan.
**Alasan:** ini jaring pengamannya. Kalau ada yang salah menempel teks di halaman utama, pemulihan harus satu klik, bukan mengingat-ingat teks lama.
**Status dugaan:** `BELUM`

### CMS-04 — EMPAT KELOMPOK YANG TIDAK BOLEH DIUBAH DARI DASHBOARD
<callout>
**ATURAN MENGIKAT.** Empat kelompok berikut **tidak boleh** dijadikan pengaturan yang bisa diubah dari dashboard, walaupun secara teknis mudah dilakukan.
</callout>

| # | Yang dilarang | Alasan |
|---|---|---|
| 1 | **Aturan penjaga jawaban bot** ("hanya menjawab dari dokumen resmi") | Suatu hari akan ada yang mematikannya "biar bot lebih pintar", dan setelah itu bot mulai mengarang syarat perizinan. Ini alasan paling penting dari keempatnya. |
| 2 | **Ambang rate limit** | Akan dinaikkan ketika seseorang mengeluh terkena batas, dan sistem terbuka untuk penyalahgunaan |
| 3 | **Masa simpan & penghapusan data pribadi** | Ini kewajiban hukum, bukan preferensi |
| 4 | **Definisi peran & hak akses** | Boleh **memberikan** peran ke orang; **jangan** bisa mendefinisikan ulang **arti** sebuah peran |

**Status dugaan:** `BELUM`

### CMS-05 — Pola implementasi: registry pengaturan bertipe
**Keputusan:** daftar pengaturan bertipe di basis data, masing-masing dengan:
- tipe nilai (teks/angka/boolean/JSON)
- **penanda boleh-diubah-dari-dashboard** (menegakkan `CMS-04` secara struktural)
- validasi nilai (rentang, enum)

**Alasan:** penanda boleh-diubah membuat `CMS-04` menjadi aturan yang **ditegakkan sistem**, bukan sekadar kesepakatan yang akan dilupakan setahun kemudian.
**Fondasi:** `site_settings` sudah ada — kembangkan, jangan ganti.
**Status dugaan:** `SEBAGIAN`

---

## 3.16 SEC — Temuan Keamanan & Kualitas dari Audit Teknis

Bagian ini bukan dari sesi keputusan produk, melainkan hasil audit teknis PRD. Tetap wajib masuk gap analysis.

### Prioritas 0
| ID | Temuan | Keterangan |
|---|---|---|
| `SEC-01` | **CSP masih `Content-Security-Policy-Report-Only`** | Kebijakan keamanan yang hanya melapor tidak memblokir apa pun. Perlu ditegakkan setelah pelanggaran dibersihkan. |
| `SEC-02` | **`check_anon_rate()` bisa dilewati** dengan merotasi anonymous session | Sudah termitigasi untuk chat oleh `CHT-10` (wajib login), **tetapi masih terbuka** untuk walk-in insert, `umkm_inquiry`, dan `investasi_lead`. |
| `SEC-03` | **Tidak ada error tracking / alerting / SLO** | Pada sistem yang sudah dipakai di kantor, ini berarti **kegagalan hanya diketahui dari keluhan warga**. |
| `SEC-04` | **RLS hanya diuji dengan static parsing, bukan perilaku per-peran** | Kebijakan RLS yang ada belum tentu bekerja seperti yang diyakini. Wajib tes perilaku nyata dengan token tiap peran. |
| `SEC-05` | **Kebocoran dokumen investasi** lewat `/api/investment-docs/page-image` + `/public-view` | Lihat `INV-04`. |

### Prioritas 1
| ID | Temuan |
|---|---|
| `SEC-06` | Halaman monolitik (`/chat` 37.5 KB, `/umkm` 36 KB) — sulit diuji dan dipelihara |
| `SEC-07` | Tidak ada lapisan pengambilan data (usul: TanStack Query atau SWR) |
| `SEC-08` | Pipeline re-embedding FAQ tidak terdefinisi — lihat `BOT-11` |
| `SEC-09` | RAG tanpa golden dataset dan tanpa umpan balik — lihat `BOT-13` |
| `SEC-10` | Model AI tertinggal versi — lihat `BOT-14` |
| `SEC-11` | Cron `*/2` menimbulkan latensi notifikasi hingga 2 menit |
| `SEC-12` | Refresh materialized view tanpa `CONCURRENTLY` → mengunci pembacaan |
| `SEC-13` | Kanal notifikasi WhatsApp belum ada (perlu pertimbangan biaya) |

### Prioritas 2
| ID | Temuan |
|---|---|
| `SEC-14` | Dokumen PDP ada, tetapi DSAR/DPIA/retensi belum lengkap; **PII bisa masuk ke `audit_log.detail`** |
| `SEC-15` | Pelaporan SKM sesuai PermenPANRB (mutu A–D, response rate) belum lengkap — lihat `SRV-03` |
| `SEC-16` | Belum ada E2E test (usul: Playwright) |
| `SEC-17` | `audit_log` tanpa hash-chain dan tanpa partisi |
| `SEC-18` | PRD sebaiknya dipecah: `PRD.md` + `ARCHITECTURE.md` |

### Regulasi yang belum diakomodir
| Regulasi | Status |
|---|---|
| **UU 25/2009** — Standar Pelayanan & Maklumat Pelayanan | `CMP-09` — belum ada |
| **UU 25/2009** — Pengelolaan pengaduan | `CMP-01` — belum ada |
| **Perpres 76/2013** — SP4N-LAPOR | Belum ada rencana penghubungan |
| **UU 14/2008** — PPID / keterbukaan informasi | Belum ada |
| **SPAK** — Survei Persepsi Anti Korupsi | `SRV-01` — ditunda |
| **PermenPANRB 90/2021** — ZI/WBK | Butuh bukti dari `CMP-*`, `RPT-04`, `NOT-07` |

### Skor mutu per domain (baseline audit — dipakai untuk mengukur kemajuan)
```
Arsitektur data & RLS   8/10
Keamanan                5/10
Observability           4/10
Testing                 4/10
AI / RAG                5/10
Frontend                4/10
PDP / privasi           6/10
Dokumentasi PRD         5/10
```

---

# BAGIAN 4 — MODEL DATA TARGET

<callout>
Ini **sketsa arah**, bukan DDL final. Agent wajib menyusun DDL final di `03-DATA-MODEL.md` setelah memverifikasi skema nyata di fase A, dan menyesuaikan dengan konvensi migrasi yang sudah ada.
</callout>

## 4.1 Perubahan pada tabel yang sudah ada (semuanya ADITIF)

```
layanan
  + nomor_loket           text            -- SVC-04
  + prefiks_antrean       text            -- SVC-05
  + penyerta              enum(dpmptsp|p4)-- SVC-03
  + status_tampilan       enum(aktif|coming_soon|nonaktif)  -- SVC-02
  + punya_antrean         boolean         -- SVC-03
  + punya_chat            boolean         -- SVC-03
  + punya_jadwal_standby  boolean         -- SVC-03
  + batas_ambil_nomor_menit int  DEFAULT 30  -- QUE-10
  + kuota_harian          int NULL        -- QUE-16 (disiapkan, tidak dipakai)
  ~ tipe                  DIPERTAHANKAN selama transisi, jangan dihapus

petugas
  + aktif                 boolean DEFAULT true  -- RBA-06
  + nonaktif_sejak        timestamptz NULL      -- RBA-06
  + nonaktif_oleh         uuid NULL             -- RBA-08
  + nonaktif_alasan       text NULL             -- RBA-08
  ~ role                  + nilai 'front_office' -- RBA-02

visit
  ~ status                + nilai 'tidak_terlayani'  -- QUE-08
  (tabel ini akan digantikan bertahap oleh kunjungan + tiket_antrean, JANGAN dihapus)

absensi_petugas
  ~ status                + nilai 'alpa'   -- SCH-10
  + sumber                enum(fo|petugas_ajukan|otomatis)  -- SCH-08
  + dicatat_oleh          uuid             -- SCH-08

listing_umkm
  ~ status                + nilai 'perlu_perbaikan'  -- MMK-03
  + nib, npwp, nama_badan_usaha              -- MMK-04
  + berlaku_sampai        date               -- MMK-07
  + catatan_review        text               -- MMK-03

site_settings
  + tipe_nilai, boleh_diubah_dashboard, aturan_validasi  -- CMS-05
```

## 4.2 Tabel baru

```
kunjungan              -- QUE-01  satu kedatangan satu orang satu hari
tiket_antrean          -- QUE-01  satu nomor untuk satu layanan (FK kunjungan)
buku_tamu              -- GST-01  terpisah total, + tanda_tangan_svg (text) GST-03
layanan_kontak         -- NOT-01  email + peran(pic|atasan|cc) + aktif + kontak instansi
jadwal_standby         -- SCH-04  pola berulang mingguan
jadwal_pengecualian    -- SCH-04  penyimpangan per tanggal + alasan
jadwal_harian_beku     -- SCH-05  snapshot malam, TIDAK BOLEH diubah surut
layanan_hari           -- QUE-11/QUE-14  jam buka/tutup efektif + jam selesai aktual
dokumen_peraturan      -- BOT-01/BOT-04  nomor, tahun, judul, status(berlaku|dicabut), tgl
dokumen_potongan       -- BOT-03  potongan per pasal/ayat + embedding + metadata kutipan
pengaduan              -- CMP-01  nomor tiket acak, jalur(layanan|integritas), SLA, anonim
pengaduan_riwayat      -- CMP-03/CMP-04  perubahan status + eskalasi
standar_pelayanan      -- CMP-09  per layanan: syarat, prosedur, waktu, biaya, produk
konten_versi           -- CMS-03  riwayat versi + kembalikan
rekap_harian_layanan   -- RPT-05  rollup agregat
laporan_snapshot       -- RPT-04  PDF resmi bernomor, isinya dibekukan
layar_token            -- DSP-07  token akses layar TV
umkm_verifikasi_jejak  -- MMK-05  siapa memeriksa apa, kapan, caranya
jejak_minat_investasi  -- INV-02  siapa melihat potensi/dokumen apa
```

## 4.3 Bucket penyimpanan

```
investment-docs      PRIVAT   (sudah ada)  _raw/, pages/
umkm-photos          PUBLIK   (sudah ada)  <- JANGAN taruh apa pun yang sensitif di sini
umkm-legalitas       PRIVAT   BARU  -- MMK-04
pengaduan-bukti      PRIVAT   BARU  -- CMP-07
```

---

# BAGIAN 5 — MATRIKS HAK AKSES TARGET

Agent wajib menyusun versi lengkap dan terverifikasi di `04-RBAC-MATRIX.md`, memetakan setiap baris ke kebijakan RLS nyata + `ADMIN_NAV` + `canAccessAdminPath()`.

Legenda: `✓` boleh · `✗` tidak · `S` hanya layanannya sendiri · `1→` wewenang satu arah

| Kemampuan | Admin | FO | Petugas Layanan | Pengunjung login | Anonim |
|---|---|---|---|---|---|
| Kelola akun & peran | ✓ | `1→` nonaktifkan saja | ✗ | ✗ | ✗ |
| Kelola jadwal standby | ✓ | ✓ | ✗ | ✗ | ✗ |
| Tutup/buka layanan hari ini | ✓ | ✓ | ✗ | ✗ | ✗ |
| Catat absensi petugas | ✓ | ✓ (semua) | ajukan sendiri | ✗ | ✗ |
| Registrasi walk-in | ✓ | ✓ | ✗ | ✗ | ✗ |
| Layani antrean (klik layani/selesai) | ✓ | ✓ | `S` | ✗ | ✗ |
| Panggil ulang nomor | ✓ | ✓ | `S` | ✗ | ✗ |
| Buku tamu | ✓ | ✓ | ✗ | ✗ | ✗ |
| Balas live chat | ✓ | ✓ (takeover semua) | `S` | ✗ | ✗ |
| Kelola FAQ | ✓ | ✗ | `S` | ✗ | ✗ |
| Unggah dokumen peraturan | ✓ | ✗ | `S` | ✗ | ✗ |
| Ubah aturan penjaga bot | **✗ (CMS-04)** | ✗ | ✗ | ✗ | ✗ |
| Review listing UMKM | ✓ | ✗ | `S` (Matchmaking) | ✗ | ✗ |
| Usul listing UMKM | ✓ | ✓ | ✓ | ✓ (lewat review) | ✗ |
| Pengaduan jalur layanan | ✓ | ✓ | `S` (diteruskan) | ✓ buat | ✓ buat |
| **Pengaduan jalur integritas** | ✓ | **✗** | **✗** | ✓ buat | ✓ buat (anonim) |
| Rekap lintas layanan | ✓ | ✓ | ✗ | ✗ | ✗ |
| Rekap layanan sendiri | ✓ | ✓ | `S` | ✗ | ✗ |
| Ekspor data ber-PII | ✓ (tercatat) | ✓ (tercatat) | `S` (tercatat) | ✗ | ✗ |
| CMS halaman & running text | ✓ | ✗ | ✗ | ✗ | ✗ |
| Lihat UMKM & galeri investasi | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Lihat peta potensi** | ✓ | ✓ | ✓ | ✓ | **✗ (RBA-11)** |
| Lihat dokumen IPRO | ✓ | ✓ | ✓ | ✓ (watermark nama) | ✓ (watermark sesi) |
| Layar TV (token) | – | – | – | – | ✓ baca antrean saja |

**Catatan penting:** baris **pengaduan jalur integritas** adalah baris paling kritikal di seluruh matriks. FO **tidak boleh** melihatnya meski FO adalah penerima pengaduan jalur layanan. Wajib diuji secara perilaku (`SEC-04`).

---

# BAGIAN 6 — INVARIAN SISTEM & SKENARIO UJI WAJIB

Bagian ini adalah **kriteria penerimaan yang dapat diuji**. Agent wajib mengubah setiap butir menjadi kasus uji nyata di `07-TEST-PLAN.md`. Kalau sebuah keputusan tidak bisa diubah menjadi uji, itu tanda keputusannya belum cukup jelas — angkat ke `OPEN-QUESTIONS`.

## 6.1 Invarian yang tidak boleh dilanggar (INV)

| ID | Invarian | Keputusan terkait |
|---|---|---|
| `I-01` | Tidak boleh ada dua tiket dengan `(layanan_id, tanggal, nomor)` yang sama | `QUE-06` |
| `I-02` | Satu tiket tidak boleh berpindah ke `dilayani` dua kali oleh dua petugas | `QUE-07` |
| `I-03` | Jumlah kunjungan ≤ jumlah tiket antrean untuk tanggal mana pun | `QUE-01` |
| `I-04` | Tidak ada tiket berstatus `menunggu` pada tanggal yang sudah lewat | `QUE-15`, `SCH-10` |
| `I-05` | Tidak boleh ada tiket terbit untuk layanan yang belum ada absensi hari itu | `SCH-02` |
| `I-06` | Tidak boleh ada tiket/reservasi pada tanggal tanpa jadwal standby (kecuali pengecualian yang membuka) | `SCH-01` |
| `I-07` | Reservasi tidak boleh dibuat untuk tanggal > hari ini + 7 | `QUE-05` |
| `I-08` | Baris `jadwal_harian_beku` tidak boleh berubah setelah dibuat | `SCH-05` |
| `I-09` | Jam absensi tidak boleh lebih awal dari waktu server saat pencatatan | `SCH-08` |
| `I-10` | Entri buku tamu tidak boleh punya tiket antrean | `GST-01` |
| `I-11` | Berkas legalitas UMKM tidak boleh berada di bucket publik | `MMK-04` |
| `I-12` | Listing `published` wajib punya kontak terverifikasi | `MMK-06` |
| `I-13` | Listing `published` wajib punya `berlaku_sampai` di masa depan | `MMK-07` |
| `I-14` | Endpoint layar TV tidak boleh mengembalikan kolom nama pengunjung | `DSP-06` |
| `I-15` | Pengaduan jalur integritas tidak boleh terbaca oleh peran `petugas` maupun `front_office` | `CMP-06` |
| `I-16` | Bot tidak boleh mengutip dokumen berstatus `dicabut` | `BOT-05` |
| `I-17` | Setiap jawaban bot wajib punya penanda jenis jawaban | `BOT-06` |
| `I-18` | FAQ/potongan yang teksnya berubah tidak boleh dicari dengan embedding lama | `BOT-11` |
| `I-19` | Pengaturan dengan `boleh_diubah_dashboard = false` tidak boleh berubah lewat jalur API dashboard | `CMS-04` |
| `I-20` | Setiap ekspor ber-PII wajib menghasilkan satu baris `audit_log` | `RPT-06` |
| `I-21` | Semua batas hari dihitung pada Asia/Jakarta | `RPT-07` |
| `I-22` | Petugas nonaktif tidak boleh bisa login atau memanggil antrean | `RBA-06`, `RBA-08` |
| `I-23` | Pemegang akun lama tidak boleh bisa login setelah pergantian PIC | `RBA-07` |
| `I-24` | Angka metrik yang sama wajib identik di dashboard, PDF, dan Excel | `RPT-01` |

## 6.2 Skenario uji ujung-ke-ujung wajib (SK)

### SK-01 — Reservasi normal sampai selesai
Warga reservasi H+3 untuk Helpdesk OSS → datang → check-in → dapat `A-005` → petugas klik layani → selesai. **Harapan:** 1 kunjungan, 1 tiket, status `selesai`, rekap menghitung 1 pengunjung dan 1 layanan.

### SK-02 — Satu kunjungan, tiga layanan
Walk-in → FO daftarkan 3 layanan. **Harapan:** 1 kunjungan, 3 tiket dengan prefiks berbeda, rekap menunjukkan **1 pengunjung dan 3 layanan** (`I-03`).

### SK-03 — Tiket tambahan tanpa isi data ulang
Warga sudah check-in → pindai QR → tambah layanan kedua. **Harapan:** tidak ada permintaan identitas ulang, tiket kedua terbit, terkait ke kunjungan yang sama (`QUE-03`).

### SK-04 — Petugas alpa padahal ada reservasi
BPJS berjadwal Senin, ada 4 reservasi, tidak ada absensi sampai 09.00. **Harapan:** status hari itu `alpa`; 4 warga menerima email sebelum jam berangkat; 4 tiket menjadi `tidak_terlayani` (**bukan** `no_show`); email eskalasi ke atasan + FO; laporan kepatuhan mencatat 4 warga terdampak (`SCH-10`, `NOT-04`, `NOT-07`, `QUE-08`).

### SK-05 — Reservasi di luar hari jadwal ditolak dengan jalan lain
Warga coba reservasi BPJS hari Rabu. **Harapan:** ditolak; pesan menyebut "hanya hari Senin"; menawarkan Senin terdekat; menawarkan live chat (`SCH-11`, `P3`).

### SK-06 — Dua orang check-in bersamaan
Dua permintaan check-in untuk layanan yang sama pada milidetik yang sama. **Harapan:** dua nomor berbeda, tanpa error, tanpa duplikat (`I-01`). Uji ini **wajib** dijalankan dengan konkurensi nyata, bukan berurutan.

### SK-07 — Dua petugas mengklaim tiket yang sama
**Harapan:** satu berhasil, satu mendapat pesan "tiket sudah diambil petugas lain" tanpa error mentah (`I-02`).

### SK-08 — Batas ambil nomor
Jam tutup 15.30, batas 30 menit. Warga datang 15.05 → dapat nomor + estimasi. Warga datang 15.15 → ditolak + tawaran reservasi besok + chat (`QUE-10`, `QUE-12`, `QUE-13`).

### SK-09 — Jam tutup efektif bergeser
Petugas pulang 14.00, FO tandai pulang. Warga datang 14.10. **Harapan:** ditolak dengan alasan loket sudah tutup; tiket yang masih menunggu menjadi `tidak_terlayani`; layar TV menampilkan loket tutup (`QUE-11`, `SCH-09`, `DSP-04`).

### SK-10 — Antrean sisa saat jam tutup
Pukul 15.30 masih ada 5 tiket `menunggu`. **Harapan:** kelimanya **tetap bisa dilayani**; jam selesai aktual tercatat; tidak ada pekerjaan terjadwal yang menghanguskannya (`QUE-09`, `QUE-14`).

### SK-11 — Chat ditinggal lalu dilanjut
Warga chat, bot menjawab, warga tutup browser. Besok petugas membalas. **Harapan:** warga menerima notifikasi; membuka `/me`; **utas yang sama** berlanjut dengan seluruh riwayat (`CHT-01`, `CHT-02`, `CHT-09`).

### SK-12 — Chat saat loket libur
Hari Rabu, BPJS tidak standby. Warga membuka chat BPJS. **Harapan:** chat tetap bisa dibuka; bot menjawab dan menyebutkan jadwal Senin; pesan tersimpan menunggu petugas (`CHT-06`, `CHT-04`).

### SK-13 — Bot tidak menemukan sumber
Warga bertanya hal di luar dokumen dan FAQ. **Harapan:** bot **tidak mengarang**; menyatakan tidak menemukan; menawarkan bertanya ke petugas; jawaban ditandai "informasi umum, mohon dikonfirmasi"; pertanyaan masuk daftar usulan FAQ (`BOT-05`, `BOT-06`, `BOT-12`).

### SK-14 — Bot mengutip dengan rujukan
Warga bertanya syarat yang ada di dokumen. **Harapan:** jawaban memuat nomor peraturan, tahun, pasal; ditandai "informasi resmi"; sumber ditampilkan; **tidak ada kesimpulan tambahan** di luar bunyi aturan (`BOT-04`, `BOT-05`).

### SK-15 — Dokumen dicabut
Dokumen ditandai `dicabut`. Warga bertanya hal yang ada di dokumen itu. **Harapan:** bot **tidak mengutipnya** (`I-16`).

### SK-16 — FAQ diedit lalu dicari
Petugas mengedit jawaban FAQ. **Harapan:** pencarian **tidak** mengembalikan jawaban versi lama; embedding diperbarui (`I-18`, `BOT-11`).

### SK-17 — Listing UMKM diubah setelah tayang
Ubah nama usaha → kembali `pending_review`. Ubah deskripsi kecil → tetap tayang (`MMK-08`).

### SK-18 — Listing kedaluwarsa
Listing melewati 6 bulan. **Harapan:** pengingat terkirim 2 minggu sebelumnya; setelah lewat, status `expired` dan tidak muncul di publik (`MMK-07`, `I-13`).

### SK-19 — Berkas legalitas tidak bocor
Coba akses URL berkas legalitas tanpa autentikasi. **Harapan:** ditolak. Cek juga bahwa NIB tidak muncul di `v_umkm_public` (`MMK-04`, `I-11`).

### SK-20 — Dokumen IPRO tanpa login
Akses halaman dokumen IPRO sebagai anonim, termasuk langsung ke `/api/investment-docs/page-image` dan `/public-view`. **Harapan:** gambar **selalu** berwatermark; watermark dibakar di gambar (buktikan dengan mengunduh gambar dan memeriksanya, bukan melihat tampilan); tidak ada jalur yang mengembalikan halaman tanpa watermark (`INV-04`, `SEC-05`).

### SK-21 — Peta potensi tanpa login
**Harapan:** ditolak/diminta login. UMKM dan galeri tetap terbuka (`RBA-11`, `I-14` tidak berlaku di sini).

### SK-22 — Layar TV
Buka URL layar dengan token. **Harapan:** semua loket tampil; loket tutup menampilkan jadwal; **tidak ada nama warga di respons API** (periksa payload jaringan, bukan tampilan); penanda waktu pembaruan terlihat; setelah koneksi diputus paksa, layar menyambung ulang atau beralih ke polling (`DSP-01`, `DSP-02`, `DSP-04`, `I-14`).

### SK-23 — Pengaduan integritas tidak terlihat petugas
Buat pengaduan jalur integritas. Login sebagai `petugas` lalu sebagai `front_office`, coba baca lewat API/RLS langsung. **Harapan:** keduanya **tidak bisa** membacanya. Admin bisa (`I-15`, `CMP-06`).

### SK-24 — SLA pengaduan terlampaui
**Harapan:** setelah 14 hari kerja, pengaduan naik ke Admin/pimpinan, bukan mengingatkan pelaksana (`CMP-04`).

### SK-25 — Pelacakan pengaduan tanpa login
**Harapan:** bisa dilacak dengan nomor tiket + kontak; nomor tiket tidak bisa ditebak berurutan; ada rate limit (`CMP-05`).

### SK-26 — Pergantian PIC
Jalankan tindakan pergantian pemegang akun. **Harapan:** pemegang lama **tidak bisa login lagi** (uji dengan sesi lama yang masih terbuka); pemegang baru menerima undangan; audit log memuat garis waktu pergantian; email di `layanan_kontak` tidak berubah (`RBA-07`, `I-23`, `NOT-01`).

### SK-27 — FO menonaktifkan akun
**Harapan:** FO berhasil menonaktifkan dengan alasan; FO **tidak bisa** mengaktifkan kembali; Admin mendapat pemberitahuan; riwayat pekerjaan petugas itu tetap utuh (`RBA-08`, `RBA-06`, `I-22`).

### SK-28 — Pengaturan terlarang
Coba ubah aturan penjaga bot lewat API dashboard sebagai Admin. **Harapan:** ditolak (`I-19`, `CMS-04`).

### SK-29 — Kembalikan versi konten
Ubah halaman utama, lalu kembalikan ke versi sebelumnya (`CMS-03`).

### SK-30 — Konsistensi angka rekap
Jalankan rekap rentang yang sama di dashboard, PDF, dan Excel. **Harapan:** angka identik (`I-24`, `RPT-01`).

### SK-31 — Batas hari Asia/Jakarta
Simulasikan check-in pukul 23.50 WIB dan 00.10 WIB. **Harapan:** masuk ke hari kalender yang benar; nomor antrean reset pada tengah malam WIB, **bukan** pukul 07.00 WIB (`I-21`, `RPT-07`).

### SK-32 — Buku tamu
Catat tamu yang menemui pegawai. **Harapan:** tidak dapat nomor antrean; tidak muncul di rekap kunjungan layanan; tanda tangan tersimpan sebagai SVG path berukuran beberapa KB; tidak bisa diakses tanpa autentikasi (`GST-01`, `GST-03`, `I-10`).

---

# BAGIAN 7 — PROTOKOL PERUBAHAN PADA SISTEM YANG SUDAH LIVE

<callout>
**SISTEM INI DIPAKAI DI KANTOR SETIAP HARI KERJA.** Ada warga sungguhan di ruang tunggu. Seluruh bagian ini bersifat mengikat.
</callout>

## 7.1 Aturan penerapan (OPS)

### OPS-01 — Migrasi wajib aditif, dalam empat langkah terpisah
```
Langkah 1  TAMBAH  : tambahkan tabel/kolom baru. Kode lama tetap berjalan tanpa perubahan.
Langkah 2  ISI     : tulis ke struktur lama DAN baru sekaligus (dual write). Backfill data lama.
Langkah 3  PINDAH  : pindahkan pembacaan ke struktur baru. Struktur lama masih terisi.
Langkah 4  HENTIKAN: setelah terbukti stabil (minimal 2 minggu) dan disetujui manusia,
                     hentikan penulisan ke struktur lama. JANGAN HAPUS kolomnya.
```
**Larangan mutlak:** jangan pernah menggabungkan langkah 1 dan 3 dalam satu penerapan.

### OPS-02 — Pemecahan `visit` adalah operasi paling berisiko di dokumen ini
`visit` adalah tabel inti yang dipakai check-in, walk-in, antrean, layar, dan rekap. Pemecahannya menjadi `kunjungan` + `tiket_antrean` **wajib** mengikuti `OPS-01` secara penuh dan **wajib** dipecah menjadi work package tersendiri, bukan digabung dengan fitur lain.

**Urutan yang diwajibkan:**
1. Buat `kunjungan` dan `tiket_antrean` (kosong)
2. Backfill dari `visit`: setiap baris `visit` dengan `tujuan='loket'` → 1 kunjungan + 1 tiket; baris dengan `tujuan='bertemu_seseorang'` → 1 entri `buku_tamu`
3. Verifikasi jumlah: `COUNT(visit)` harus sama dengan `COUNT(tiket_antrean) + COUNT(buku_tamu)` untuk seluruh rentang
4. Aktifkan dual write
5. Pindahkan pembacaan satu halaman pada satu waktu, dimulai dari **halaman yang paling jarang dipakai**, bukan dari `/checkin`
6. `/checkin` dan dashboard antrean dipindahkan **terakhir**

### OPS-03 — Jendela penerapan
**Aturan:** perubahan berisiko diterapkan **di luar jam pelayanan** (setelah jam tutup atau sebelum kantor buka), dan **jangan pada hari dengan banyak jadwal standby P4**.
**Alasan:** kalau check-in gagal pada pukul 10.00, FO harus mencatat antrean di kertas sementara warga menunggu.

### OPS-04 — Setiap work package wajib punya rencana pengembalian
**Aturan:** setiap penerapan wajib menyertakan langkah pengembalian yang **sudah diuji**, bukan sekadar niat "kalau gagal kita rollback". Untuk migrasi basis data, ini berarti: perubahan aditif (bisa diabaikan), bukan destruktif (tidak bisa dikembalikan).

### OPS-05 — Prosedur cadangan manual harus ada sejak awal
**Keputusan:** sebelum menyentuh alur antrean, siapkan cara FO tetap bekerja kalau sistem gagal: nomor antrean cetak/tulis, formulir buku tamu kertas, dan cara memasukkan datanya kemudian.
**Alasan:** ini bukan kemewahan. Pelayanan publik tidak boleh berhenti karena satu penerapan gagal.

### OPS-06 — Observability dipasang SEBELUM pekerjaan besar, bukan sesudah
**Keputusan:** `SEC-03` (error tracking + alerting) **wajib** selesai sebelum work package yang menyentuh antrean.
**Alasan:** kalau sekarang kegagalan hanya diketahui dari keluhan warga, maka mengerjakan pemecahan `visit` tanpa observability berarti bekerja dengan mata tertutup pada bagian paling kritikal sistem.

### OPS-07 — Pemecahan halaman monolitik dilakukan sambil jalan, bukan sebagai proyek sendiri
**Keputusan:** jangan membuat work package "refactor `/chat`". Pecah bagian yang disentuh saat mengerjakan fitur yang memang menyentuhnya.
**Alasan:** refactor besar tanpa perubahan perilaku pada sistem live adalah risiko tanpa imbalan yang terlihat, dan biasanya tidak pernah selesai.

### OPS-08 — Penambahan nilai enum: aman di basis data, berbahaya di TypeScript
**Aturan:** setiap kali menambah nilai enum (`tidak_terlayani`, `perlu_perbaikan`, `front_office`, `alpa`, `coming_soon`), **wajib** mencari seluruh tempat yang memetakan enum itu secara ekshaustif di TypeScript, termasuk label UI, warna badge, filter, dan agregasi rekap.
**Alasan:** nilai baru yang jatuh ke cabang default akan tampil sebagai kosong atau salah label, dan bug seperti ini biasanya baru ditemukan berminggu-minggu kemudian di laporan.

---

# BAGIAN 8 — INSTRUKSI PER FASE & FORMAT KELUARAN

## 8.1 FASE A — Inventarisasi kode

**Tujuan:** mengetahui **apa yang sebenarnya ada**, bukan apa yang diyakini ada.

**Langkah wajib:**
1. Petakan seluruh route: setiap halaman, setiap API route, siapa yang boleh mengaksesnya.
2. Ambil skema basis data **nyata**: seluruh tabel, kolom, tipe, constraint, index, enum, view, fungsi, trigger, kebijakan RLS. Bandingkan dengan Bagian 1.5 dan **laporkan setiap perbedaan**.
3. Baca seluruh file migrasi berurutan, catat apa yang sudah pernah dicoba dan apa yang ditinggalkan setengah jalan.
4. Petakan RBAC nyata: `get_my_role()`, `set_user_role_claim()`, `canAccessAdminPath()`, `ADMIN_NAV`, `AdminGuard.tsx`, dan seluruh kebijakan RLS per tabel.
5. Petakan pekerjaan terjadwal: `vercel.json` + pg_cron. Catat apa yang berjalan, kapan, dan **apakah masih relevan**.
6. Petakan seluruh titik integrasi eksternal: Gemini, Resend, web-push, Supabase Storage.
7. Petakan cakupan tes yang ada dan apa yang **tidak** diuji.
8. **Pemeriksaan prioritas — kerjakan empat ini lebih dulu karena diduga bug produksi aktif:**
   - `QUE-06`: apakah penomoran antrean atomik?
   - `RPT-07`: apakah batas hari memakai Asia/Jakarta?
   - `SEC-05` / `INV-04`: apakah dokumen IPRO bisa diambil tanpa watermark?
   - `BOT-11`: apakah embedding FAQ diperbarui saat FAQ diubah?

**Keluaran:** `docs/analysis/00-CODE-INVENTORY.md`

**Aturan bukti:** setiap pernyataan wajib menyertakan `path/file.ts:baris`. Pernyataan tanpa bukti file harus ditandai `[BELUM DIVERIFIKASI]`.

## 8.2 FASE B — Gap analysis

**Keluaran:** `docs/analysis/01-GAP-ANALYSIS.md`

**Wajib memuat satu baris untuk SETIAP ID keputusan di Bagian 3.** Tidak boleh ada ID yang dilewati. Format tabel:

| Kolom | Isi |
|---|---|
| `ID` | ID keputusan, contoh `QUE-06` |
| `Keputusan` | ringkasan satu baris |
| `Kondisi nyata` | apa yang benar-benar ada di kode |
| `Bukti` | `path/file.ts:baris` atau nama migrasi |
| `Status` | `SUDAH` / `SEBAGIAN` / `BELUM` / `BERTENTANGAN` |
| `Ukuran celah` | `XS` / `S` / `M` / `L` / `XL` |
| `Risiko jika dibiarkan` | dampak nyata, bukan istilah teknis |
| `Menyentuh data live?` | `Ya` / `Tidak` |
| `Bergantung pada` | ID keputusan lain |

**Ditambah tiga daftar terpisah:**
1. **`TEMUAN-BARU`** — masalah yang kamu temukan di kode dan **tidak** ada di dokumen ini. Ini bagian yang paling bernilai; jangan kosongkan tanpa berusaha.
2. **`BERTENTANGAN`** — tempat di mana kode bertentangan dengan keputusan. Sebutkan **apakah kode atau keputusan yang tampaknya lebih benar**, dan alasannya.
3. **`OPEN-QUESTIONS`** — hal yang tidak bisa kamu putuskan sendiri.

**BERHENTI DI SINI. Minta persetujuan manusia sebelum lanjut ke fase C.**

## 8.3 FASE C — Desain target

**Keluaran:**
- `02-TARGET-DESIGN.md` — desain per domain, memetakan setiap ID keputusan ke rancangan konkret
- `03-DATA-MODEL.md` — DDL final, seluruh constraint, index, kebijakan RLS per tabel baru, plus **rencana backfill**
- `04-RBAC-MATRIX.md` — matriks Bagian 5 diperluas menjadi pemetaan ke kebijakan RLS nyata + rute + item navigasi

**Aturan:** setiap tabel baru wajib menyertakan kebijakan RLS-nya **dalam dokumen desain yang sama**. Jangan pernah menunda RLS ke tahap berikutnya — tabel tanpa RLS pada Supabase adalah tabel terbuka.

## 8.4 FASE D — Rencana implementasi

**Keluaran:**
- `05-IMPLEMENTATION-PLAN.md`
- `06-MIGRATION-PLAN.md`
- `07-TEST-PLAN.md`

**Format wajib setiap work package (WP):**

```
## WP-XX — <nama>

Memenuhi keputusan : QUE-01, QUE-02, GST-01
Fase               : 0 / 1 / 2 / 3 / 4 / 5 / 6
Ukuran             : XS / S / M / L
Bergantung pada    : WP-YY (wajib selesai lebih dulu)
Menyentuh data live: Ya / Tidak
Jendela penerapan  : kapan saja / di luar jam layanan

### Perubahan basis data
<migrasi, dengan nama file mengikuti konvensi 2026MMDDNNNN_nama>

### Perubahan kode
<daftar file yang dibuat/diubah, dengan alasan singkat per file>

### Kriteria penerimaan
<daftar yang bisa dicentang, merujuk ID invarian dan skenario uji Bagian 6>

### Tes yang wajib ditulis
<daftar, merujuk SK-xx dan I-xx>

### Cara mengembalikan
<langkah nyata, sudah dipikirkan>

### Cara memverifikasi setelah tayang
<apa yang harus dilihat/diperiksa di produksi, oleh siapa>
```

**Aturan:** WP wajib berukuran maksimal setara satu penerapan. Kalau sebuah WP tidak bisa diterapkan sendirian, pecah.

**BERHENTI DI SINI. Minta persetujuan manusia sebelum lanjut ke fase E.**

## 8.5 FASE E — Eksekusi

**Aturan:**
1. Kerjakan **satu WP pada satu waktu**, sesuai urutan yang disetujui.
2. Setiap WP wajib: migrasi + kode + tes + pembaruan `docs/DECISION_LOG.md`, dalam satu commit yang koheren.
3. `eslint --max-warnings=0` dan seluruh tes wajib lolos sebelum WP dinyatakan selesai.
4. Jangan memulai WP berikutnya kalau WP sebelumnya belum diverifikasi di produksi.
5. Kalau saat mengerjakan kamu menemukan bahwa rencananya salah, **berhenti dan laporkan.** Jangan memperbaiki rencana secara diam-diam.

---

# BAGIAN 9 — URUTAN PENGERJAAN YANG DIWAJIBKAN

<callout>
Urutan ini sudah dipertimbangkan terhadap risiko sistem live. **Jangan mengubah urutan fase tanpa persetujuan manusia.** Tiga alasan penyusunan urutan ini dijelaskan di 9.8 — baca bagian itu sebelum mengusulkan perubahan.
</callout>

## 9.0 FASE 0 — Bisa dikerjakan sekarang, tanpa menyentuh antrean

Seluruh isi fase ini berdiri sendiri, berbiaya rendah, dan **tidak berisiko mengganggu pelayanan.**

| Prioritas | Keputusan | Alasan berada di sini |
|---|---|---|
| 1 | `SEC-05` + `INV-04` — tutup kebocoran dokumen IPRO | Celah keamanan yang sudah diketahui tetapi dibiarkan adalah beban yang bertambah setiap hari |
| 2 | `SEC-03` — error tracking + alerting | Syarat `OPS-06`. Wajib selesai sebelum pekerjaan antrean |
| 3 | `RPT-07` — perbaiki batas hari ke Asia/Jakarta | Kalau salah, seluruh angka salah setiap hari |
| 4 | `QUE-06` — penomoran antrean atomik + unique constraint | Bug yang pasti terjadi, akibatnya keributan nyata di ruang tunggu |
| 5 | `BOT-11` — pembaruan embedding saat FAQ diubah | Gagal secara tak terlihat: bot menjawab dari versi lama |
| 6 | `RBA-06` — kolom aktif/nonaktif pada `petugas` | Satu kolom, mencegah kehilangan riwayat |
| 7 | `SCH-05` — pembekuan jadwal harian | Nilai tinggi, biaya rendah, dan datanya **tidak bisa dibuat surut** |
| 8 | `SRV-03` — catat response rate SKM | Sama: data yang tidak dicatat sekarang hilang selamanya |
| 9 | `SEC-04` — tes RLS berbasis perilaku | Fondasi untuk semua pekerjaan RBAC berikutnya |
| 10 | `SEC-01` — tegakkan CSP | Setelah pelanggaran dibersihkan |
| 11 | `OPS-05` — siapkan prosedur cadangan manual FO | Prasyarat sebelum menyentuh antrean |

## 9.1 FASE 1 — Kewajiban hukum

| Keputusan | Catatan |
|---|---|
| `CMP-01` … `CMP-08` | Kanal pengaduan lengkap, termasuk **dua jalur terpisah** (`CMP-06`) |
| `CMP-09` | Standar Pelayanan & Maklumat Pelayanan |
| `MMK-09` | Klausul penafian matchmaking |
| `INV-06` | Pengungkapan pencatatan perilaku di kebijakan privasi |
| `SEC-14` | PII di `audit_log.detail` |

**Manfaat ganda:** isi `CMP-09` sekaligus menjadi bahan pengetahuan bot di fase 4.

## 9.2 FASE 2 — Fondasi kepatuhan petugas

| Keputusan | Catatan |
|---|---|
| `RBA-02` | Tambah peran `front_office` — **prasyarat** untuk hampir semua wewenang FO |
| `SCH-01`, `SCH-04`, `SCH-11` | Jadwal standby sebagai pemblokir pendaftaran |
| `SCH-06`, `SCH-07` | Tombol cepat FO + jejak perubahan jadwal |
| `SCH-02`, `SCH-08`, `SCH-09`, `SCH-10` | Absensi sebagai gerbang antrean + alpa otomatis |
| `QUE-08` | Status `tidak_terlayani` (perhatikan `OPS-08`) |
| `NOT-01` … `NOT-05` | `layanan_kontak` + notifikasi bersyarat + eskalasi |
| `RBA-08`, `RBA-09` | FO menonaktifkan satu arah + akun Admin pimpinan |
| `RBA-07` | Tindakan resmi pergantian pemegang akun |
| `SVC-06` | Kontak resmi instansi (dipakai `SCH-10`) |

**Kenapa di sini:** ini penerapan langsung P1 dan P2, dan menghasilkan data yang **tidak bisa dibuat surut**. Setiap hari tanpa fase ini adalah satu hari data kepatuhan yang hilang.

## 9.3 FASE 3 — Pemecahan model kunjungan (paling berisiko)

| Keputusan | Catatan |
|---|---|
| `QUE-01`, `QUE-02`, `QUE-03` | `kunjungan` + `tiket_antrean` — ikuti `OPS-01` dan `OPS-02` **secara penuh** |
| `GST-01` … `GST-04` | Buku tamu dipisahkan keluar dari `visit` |
| `SVC-03`, `SVC-04`, `SVC-05`, `SVC-02` | Struktur layanan, nomor loket, prefiks, Coming Soon |
| `QUE-04`, `QUE-05`, `QUE-15`, `QUE-16` | Reservasi H+7 tanpa slot, nomor saat check-in, `no_show` otomatis |
| `QUE-07` | Penguncian tiket tingkat baris |
| `QUE-09` … `QUE-14`, `QUE-17` | Aturan akhir hari, batas ambil nomor, estimasi, panggil ulang |

**Peringatan:** ini satu-satunya fase yang bisa menghentikan pelayanan kalau salah. Kerjakan **hanya** setelah fase 0 nomor 2 (observability) dan nomor 11 (prosedur cadangan) selesai.

## 9.4 FASE 4 — Chat & bot bersumber dokumen

| Keputusan | Catatan |
|---|---|
| `CHT-01` … `CHT-11` | Chat persisten, dashboard urut lama menunggu, takeover FO, notifikasi cerdas |
| `BOT-01` … `BOT-10` | RAG bersumber dokumen, potong per pasal, metadata kutipan, penanda jenis jawaban |
| `BOT-12`, `BOT-13` | Usulan FAQ otomatis + pengukuran mutu |
| `CMS-04` | Aturan penjaga bot dikunci dari dashboard — **kerjakan bersamaan dengan bot, jangan setelahnya** |

**Catatan tentang `BOT-14`** (ganti model): kerjakan sebagai WP tersendiri dengan embed ulang total dan verifikasi. Jangan digabung dengan pekerjaan lain.

## 9.5 FASE 5 — Layar TV & rekap

| Keputusan | Catatan |
|---|---|
| `DSP-01` … `DSP-07` | Layar antrean. `DSP-06` (tanpa nama warga) dan `DSP-02` (penanda waktu) tidak boleh dilewati |
| `RPT-01` … `RPT-06`, `RPT-08` | Satu lapisan metrik, empat penyajian, snapshot PDF, rollup, log ekspor |
| `RBA-10` | Pandangan lintas-layanan untuk FO |
| `CMS-01`, `CMS-02`, `CMS-03`, `CMS-05` | CMS + registry pengaturan + riwayat versi |

**Catatan:** `DSP-08` (suara) **tidak** dikerjakan, tetapi mekanisme pemanggilan wajib menerbitkan peristiwa "nomor dipanggil" agar suara bisa ditambahkan nanti tanpa perubahan struktural.

## 9.6 FASE 6 — Matchmaking & investasi

| Keputusan | Catatan |
|---|---|
| `MMK-01` … `MMK-08` | Verifikasi tiga lapis, `perlu_perbaikan`, bucket privat, masa berlaku, jejak verifikasi |
| `INV-01`, `INV-02`, `INV-03` | Peta potensi + jejak minat sebagai sumber prospek |

## 9.7 FASE 7 — Ditunda sampai diminta

| Keputusan | Status |
|---|---|
| `SRV-01`, `SRV-02`, `SRV-04` | Mesin survei generik, migrasi SKM, ulasan Google Maps |
| `QUE-16` | Kuota harian (kolom sudah disiapkan) |
| `QUE-18` | Penanda alasan prioritas kelompok rentan |
| `DSP-08` | Suara panggilan antrean |
| `SEC-13` | Kanal notifikasi WhatsApp |
| `SEC-16`, `SEC-17`, `SEC-18` | E2E test, hash-chain audit log, pemecahan PRD |

## 9.8 Tiga alasan urutan ini disusun begitu (jangan diubah tanpa memahaminya)

1. **Fase 0 sengaja tidak menyentuh antrean sama sekali.** Semuanya berdiri sendiri dan bisa dimulai segera tanpa risiko mengganggu pelayanan. Ini memberi kemenangan awal sekaligus memasang alat pengawasan yang dibutuhkan fase berikutnya.

2. **Kewajiban hukum diletakkan SEBELUM fondasi antrean**, meskipun antrean terasa lebih mendasar. Alasannya: kanal pengaduan dan Standar Pelayanan **tidak bergantung** pada perubahan struktur apa pun, jadi bisa selesai cepat. Sementara pemecahan `visit` adalah operasi jantung pada sistem berjalan — kalau dikerjakan lebih dulu dan bermasalah, seluruh perhatian tim akan tersita ke pemadaman kebakaran dan urusan hukum tertunda lagi, mungkin berbulan-bulan.

3. **Bot diletakkan di fase 4, bukan lebih awal**, meski itu bagian paling menarik dan paling terlihat. Alasannya: bot bersumber dokumen membutuhkan **pengetahuan yang diisi oleh petugas**. Sebelum masalah kepatuhan tertangani di fase 2 dan alur pelayanan benar di fase 3, petugas tidak punya alasan untuk mengisi apa pun. Bot yang dibangun sempurna di atas basis pengetahuan kosong adalah pekerjaan yang terbuang.

---

# BAGIAN 10 — LARANGAN & RISIKO YANG SUDAH DITERIMA

## 10.1 JANGAN dikerjakan (bukan lupa, tapi keputusan)

| # | Larangan | Keputusan |
|---|---|---|
| 1 | Jangan buat tabel `loket` | `SVC-04` |
| 2 | Jangan buat sistem slot jam reservasi | `QUE-05` |
| 3 | Jangan buat logika kuota harian (kolom saja) | `QUE-16` |
| 4 | Jangan buat fitur antrean prioritas | `QUE-18` |
| 5 | Jangan buat penguncian sesi loket | `RBA-04` |
| 6 | Jangan buat relasi banyak-ke-banyak petugas–layanan | `RBA-03` |
| 7 | Jangan buat peran pimpinan terpisah | `RBA-09` |
| 8 | Jangan bangun OCR | `BOT-08` |
| 9 | Jangan buat bot membaca situs luar saat menjawab | `BOT-07` |
| 10 | Jangan perlonggar batas 2–3 dokumen per layanan | `BOT-01` |
| 11 | Jangan kirim notifikasi setiap ada pendaftar antrean | `NOT-02` |
| 12 | Jangan buat tabel survei baru berpola `u1..u9` | `SRV-02` |
| 13 | Jangan pakai Google Places API | `SRV-04` |
| 14 | Jangan buat alur persetujuan sebelum tayang untuk konten | `CMS-02` |
| 15 | Jangan jadikan 4 kelompok di `CMS-04` sebagai pengaturan dashboard | `CMS-04` |
| 16 | Jangan simpan tanda tangan sebagai PNG | `GST-03` |
| 17 | Jangan tampilkan nama warga di layar TV | `DSP-06` |
| 18 | Jangan tampilkan nomor NIB/NPWP ke publik | `MMK-04` |
| 19 | Jangan taruh apa pun sensitif di `umkm-photos` | `MMK-04`, `CMP-07` |
| 20 | Jangan buat work package "refactor halaman besar" | `OPS-07` |
| 21 | Jangan hapus kolom, tabel, atau nilai enum apa pun | `OPS-01` |
| 22 | Jangan bangun suara panggilan antrean | `DSP-08` |
| 23 | Jangan pakai overlay CSS untuk watermark | `INV-04` |
| 24 | Jangan buat lapisan kerumitan yang hanya menciptakan ilusi perlindungan dokumen | `INV-05` |

## 10.2 Risiko yang sudah disadari dan diterima pemilik keputusan

Agent **tidak boleh** mengangkat ulang perdebatan ini. Implementasikan sesuai keputusan beserta pengamannya.

| Risiko | Keputusan | Pengaman yang wajib ada |
|---|---|---|
| **Akun PIC diwariskan** — jejak identitas menjadi ambigu, pemegang lama berpotensi masih bisa login | `RBA-07` | Tindakan pergantian resmi yang memutus tautan Google lama + mengakhiri sesi; audit log sebagai garis waktu pemegang; laporan menyebut nama layanan bukan nama orang; email institusional |
| **FAQ & dokumen langsung aktif tanpa tinjauan** | `BOT-09`, `BOT-10` | Metadata wajib, sumber ditampilkan ke warga, riwayat versi, daftar perubahan terbaru untuk Admin, pengingat tinjau ulang |
| **Konten langsung tayang tanpa persetujuan** | `CMS-02` | Riwayat versi + tombol kembalikan (`CMS-03`) |
| **Tidak ada fitur antrean prioritas** | `QUE-18` | Diatur manual FO. Konsekuensi yang diterima: waktu tunggu anomali tidak bisa dijelaskan di rekap, dan tidak ada bukti pelayanan kelompok rentan untuk penilaian ZI |
| **Dokumen IPRO terbuka penuh ke publik** | `INV-04`, `INV-05` | Watermark dibakar di server. Konsekuensi yang diterima: dokumen akan tersebar; watermark hanya melacak asal, tidak mencegah |

---

# BAGIAN 11 — PERTANYAAN TERBUKA

## 11.1 Keputusan yang masih menggantung (JANGAN diputuskan sendiri)

| ID | Pertanyaan | Konteks |
|---|---|---|
| `OQ-01` | Metode suara panggilan antrean | `DSP-08`. Rekomendasi: rekaman potongan audio. Rancang agar bisa ditambahkan tanpa perubahan struktural |
| `OQ-02` | Penanda alasan prioritas kelompok rentan | `QUE-18`. Pemilik memilih tanpa fitur; usulan satu kolom penanda **belum dijawab** |
| `OQ-03` | Nilai pasti batas jam absensi sebelum dinyatakan alpa | `SCH-10` memakai contoh 09.00 — perlu dipastikan |
| `OQ-04` | Jam layanan resmi kantor (buka & tutup) | Dibutuhkan `QUE-10`, `QUE-11`, `SCH-09` |
| `OQ-05` | Daftar hari libur nasional | Dibutuhkan `CMP-03` (hitungan hari kerja) |
| `OQ-06` | Apakah `layanan.tipe` boleh dihentikan pemakaiannya setelah `SVC-03`, dan kapan | `OPS-01` langkah 4 |
| `OQ-07` | Format nomor tiket pengaduan | `CMP-05` mensyaratkan tidak bisa ditebak berurutan |

## 11.2 Klarifikasi yang belum dijawab pemilik keputusan

Empat hal ini akan **memengaruhi prioritas**, dan agent sebaiknya menanyakannya di akhir fase B:

1. **Keluhan lapangan nyata yang paling sering muncul.** Kalau ada keluhan yang muncul setiap hari, itu mungkin harus naik ke fase 0 mendahului urutan yang ada.
2. **Besar tim dan anggaran.** Menentukan apakah WhatsApp (`SEC-13`), pemantauan berbayar (`SEC-03`), dan model AI yang lebih baik (`BOT-14`) realistis.
3. **Target penilaian eksternal dan tenggatnya** (ZI/WBK, Ombudsman). Kalau ada tenggat dekat, fase 1 harus dipercepat dan `RPT-04` naik prioritas.
4. **Pengguna dominan** — apakah beban terbesar dari pengunjung fisik atau pengunjung digital. Menentukan bobot antara fase 3 dan fase 4.

---

# LAMPIRAN A — DAFTAR PERIKSA CEPAT UNTUK FASE A

Empat pemeriksaan ini diduga menemukan **bug produksi aktif**. Kerjakan lebih dulu, sebelum inventarisasi menyeluruh.

```
[ ] 1. PENOMORAN ANTREAN  (QUE-06)
       Cari kode yang menghasilkan nomor antrean.
       Apakah polanya "SELECT MAX lalu +1" di TypeScript?
       Apakah ada UNIQUE (layanan_id, tanggal, nomor)?
       Uji dengan dua permintaan bersamaan.
       -> Kalau tidak atomik: BUG AKTIF, warga bisa dapat nomor sama.

[ ] 2. ZONA WAKTU  (RPT-07)
       Cari: new Date(), toISOString().slice(0,10), CURRENT_DATE,
             now(), date_trunc('day', ...)
       Periksa: reset nomor harian, no_show otomatis, rekap harian, cron.
       -> Kalau UTC: "hari" berakhir 07.00 WIB, angka salah setiap hari.

[ ] 3. KEBOCORAN DOKUMEN IPRO  (SEC-05, INV-04)
       Panggil /api/investment-docs/page-image tanpa autentikasi.
       Buka /public-view tanpa autentikasi.
       Unduh gambarnya, periksa apakah watermark benar ada DI DALAM gambar.
       -> Kalau bisa diambil tanpa watermark: kebocoran aktif.

[ ] 4. EMBEDDING FAQ  (BOT-11)
       Cari kode yang menulis faq_knowledge_base.
       Apakah embedding dihitung ulang saat pertanyaan/jawaban diubah?
       Apakah embedding_updated_at benar-benar dipakai untuk sesuatu?
       -> Kalau tidak: bot menjawab dari versi FAQ yang sudah diperbaiki.
```

# LAMPIRAN B — REKAPITULASI SELURUH ID KEPUTUSAN

Agent wajib memastikan **setiap ID di bawah ini muncul** di gap analysis. Total: 122 keputusan.

```
SVC  01 02 03 04 05 06                                    (6)
QUE  01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 (18)
SCH  01 02 03 04 05 06 07 08 09 10 11                     (11)
NOT  01 02 03 04 05 06 07                                 (7)
CHT  01 02 03 04 05 06 07 08 09 10 11                     (11)
BOT  01 02 03 04 05 06 07 08 09 10 11 12 13 14            (14)
CMP  01 02 03 04 05 06 07 08 09                           (9)
GST  01 02 03 04                                          (4)
MMK  01 02 03 04 05 06 07 08 09                           (9)
INV  01 02 03 04 05 06                                    (6)
DSP  01 02 03 04 05 06 07 08                              (8)
RPT  01 02 03 04 05 06 07 08                              (8)
SRV  01 02 03 04                                          (4)
RBA  01 02 03 04 05 06 07 08 09 10 11                     (11)
CMS  01 02 03 04 05                                       (5)
SEC  01 .. 18                                             (18)
OPS  01 02 03 04 05 06 07 08                              (8)
I    01 .. 24   (invarian)                                (24)
SK   01 .. 32   (skenario uji)                            (32)
OQ   01 .. 07   (pertanyaan terbuka)                      (7)
```

---

# CATATAN PENUTUP UNTUK AGENT

Tiga hal yang paling mudah salah dipahami dari dokumen ini:

1. **Dokumen ini bukan gambaran kode.** Ini gambaran **tujuan**. Kolom "status dugaan" adalah dugaan yang sengaja disertakan agar kamu punya titik awal — tetapi setiap dugaan harus kamu buktikan atau bantah dengan bukti file. Kalau kamu menyalin dugaan itu ke gap analysis tanpa memverifikasi, seluruh rencana implementasi akan dibangun di atas asumsi, dan itu tepat kegagalan yang dokumen ini dimaksudkan untuk mencegah.

2. **Masalah terbesar proyek ini bukan masalah teknis.** Petugas tidak login dan sering mangkir. Setiap keputusan di `SCH-*` dan `NOT-*` adalah upaya membuat ketidakhadiran menjadi **data yang bisa dilaporkan** alih-alih kekosongan yang tak bisa dituntut. Kalau kamu menyederhanakan salah satu keputusan itu karena tampak berlebihan secara teknis, kamu sedang membongkar satu-satunya mekanisme yang menangani masalah sesungguhnya.

3. **Sistem ini sudah dipakai.** Ada warga di ruang tunggu yang menunggu nomornya dipanggil hari ini. Perubahan yang benar secara kode tetapi memutus check-in pada pukul 10.00 adalah kegagalan. Kalau kamu ragu antara cepat dan aman, pilih aman — lalu jelaskan alasannya.

**Kalau ada satu hal yang harus kamu ingat: jangan pernah mengarang. Kalau tidak tahu, tanya. Kalau belum verifikasi, tandai. Kalau bertentangan, laporkan.**
