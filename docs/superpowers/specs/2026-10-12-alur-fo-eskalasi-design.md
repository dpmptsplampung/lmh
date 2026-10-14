# Rancangan: Alur Front Office → Eskalasi, Akun Tunggal, Layanan Online Tercatat

- Tanggal: 2026-10-12
- Status: **Rancangan hasil brainstorm dengan CEO** — belum ada implementasi
- Asal: audit [`docs/audit/AUDIT-2026-10-12-MENYELURUH.md`](../../audit/AUDIT-2026-10-12-MENYELURUH.md) temuan **T1** (race "Mulai layani"/"Selesaikan"), diperluas menjadi perubahan alur kerja.
- Bahasa: Indonesia (mengikuti proyek).

## 1. Tujuan

1. Menutup T1: satu tiket hanya boleh diselesaikan oleh orang yang memulainya, ditegakkan di database.
2. Mengubah alur pelayanan: **semua pengunjung (walk-in, QR/reservasi, live chat) dilayani Front Office (FO) dulu**; hal teknis dieskalasi ke petugas layanan.
3. Satu akun per orang, **tidak boleh login ganda** (sesi tunggal, ditegakkan di server).
4. Semua layanan (termasuk chat) menghasilkan **catatan penanganan** yang bisa direkap per orang, per hari, per tahap.
5. Menyiapkan (tanpa membangun) fondasi untuk survei terpadu tahap berikutnya.

## 2. Keputusan CEO (mengikat)

| # | Keputusan |
|---|---|
| K1 | Akun terpisah per individu (Admin, Front Office, Petugas Layanan seperti Helpdesk OSS, Balmon, dll.). Login ganda dilarang: login baru **menggantikan** sesi lama. Petugas biasanya login sekali pagi dan tidak logout sampai tutup — rancangan harus aman untuk pola ini. |
| K2 | Satu tiket hanya boleh **diselesaikan oleh orang yang memulainya**. |
| K3 | FO adalah satu-satunya yang menulis pendaftaran walk-in dan check-in QR. Pengunjung **langsung dilayani FO**; beberapa FO boleh melayani paralel. |
| K4 | **Tiket baru terbit hanya saat eskalasi.** Selama dilayani FO tidak ada tiket/nomor. |
| K5 | FO bisa menyelesaikan sendiri (informasi, pengaduan, dll.) atau mengeskalasi ke petugas layanan. Setelah eskalasi, yang menyelesaikan adalah petugas layanan itu. |
| K6 | Tiket hasil eskalasi = nomor baru masuk antrean petugas layanan. Format **2 huruf + nomor**, dibuat otomatis oleh sistem. |
| K7 | Petugas layanan boleh **mengembalikan** ke FO. Admin boleh **mengambil alih** tiket dan **melempar ke layanan/petugas mana pun**. |
| K8 | Live chat = **layanan online**, juga tercatat (topik/masalah) untuk rekap FO dan petugas. Chat melalui FO dulu; petugas boleh langsung mengambil alih chat yang **belum** diambil FO. |
| K9 | Rekap dicatat **per tahap**. Rekap harian FO memuat nama FO bertugas dan isi penanganan. Performa pelayanan (kecepatan, jumlah dilayani) dihitung dari data operasional, **bukan** dari survei. |
| K10 | Catatan penanganan FO **minimal**, dan **catatan singkat wajib selalu diisi**. |
| K11 | Form **Pendataan Pelayanan** (OSS/Perizinan) oleh petugas: **semua field wajib diisi**, tidak boleh ada yang kosong. |
| K12 | Pendaftaran pengunjung online: semua field wajib benar; saat simpan ada **pernyataan kebenaran data** (disclaimer). |
| K13 | **Survei terpadu** (tahap berikutnya): tiap pengunjung wajib mengisi — SKM + persepsi anti korupsi + survei lain digabung jadi satu (>20 pertanyaan, wizard sekali-klik tanpa tombol "Next", ada "Back"), rating petugas, dan opsi pengaduan di akhir atas nama pengunjung. Setelah layanan selesai muncul QR magic-link (kedaluwarsa 24 jam); status "sudah/belum mengisi" tampil di dashboard FO, petugas, admin. Untuk chat, tautan dikirim lewat chat. FO yang menyelesaikan sendiri **tetap** memicu survei yang sama. |

## 3. Alur

```
Pengunjung ── walk-in / scan QR / chat
        │
        ▼
  Front Office  (kunjungan dibuat; TANPA tiket)
  catat penanganan: topik · hasil · catatan singkat
        │
        ├─ hasil "selesai di FO" ─────────────► kunjungan selesai ─► (survei)
        │
        └─ hasil "dieskalasi ke <layanan>"
                 │  terbit tiket baru: mis. OS-014
                 ▼
          Antrean petugas layanan
          mulai layani (dilayani_oleh = petugas) ── hanya dia yang boleh selesaikan
                 │
                 ├─ selesai + Pendataan Pelayanan (semua field wajib) ─► (survei)
                 └─ "kembalikan ke FO" ─► tiket ditutup (dikembalikan),
                                           muncul di kotak masuk FO; FO mana pun boleh ambil
   Admin: ambil alih / alihkan tiket ke layanan atau petugas mana pun (dilog)
```

**Chat**: sesi chat → (bot) → eskalasi → kotak masuk FO. FO mengambil → melayani → selesai di FO atau diteruskan ke petugas layanan (handoff, **tanpa tiket**: chat bukan antrean fisik). Petugas layanan boleh mengambil chat langsung selama belum diambil FO.

**Reservasi/QR**: kunjungan `terjadwal` dibuat saat pengunjung reservasi online; saat tiba, FO memindai QR → kunjungan menjadi `dilayani` oleh FO. Layanan yang dipilih saat reservasi menjadi **saran tujuan eskalasi**, bukan tiket.

## 4. Model data

Semua perubahan berupa **migrasi forward baru** (`YYYYMMDDNNNN_nama.sql` + test statis di `supabase/migrations/*.test.ts`); baseline `202607140001–5` tidak disentuh. Setiap migrasi dicatat di `docs/MIGRATIONS.md` dan `docs/analysis/DB-CHANGES.md` (menutup T11).

### 4.1 `kunjungan` (ada) — perubahan
- `asal` CHECK diperluas: `walk_in | reservasi | online` (online = sesi chat).
- Tambah `chat_sesi_id uuid NULL` (untuk `online`), `selesai_at timestamptz NULL`.
- Status `dilayani` kini berarti sedang dalam penanganan (FO atau petugas); `selesai` bila tahap terakhir selesai tanpa eskalasi/pengembalian terbuka.

### 4.2 `penanganan` (BARU) — satu baris per tahap
| Kolom | Keterangan |
|---|---|
| `id`, `kunjungan_id` | FK ke kunjungan |
| `tahap_ke` | 1,2,3… urutan dalam kunjungan |
| `peran_tahap` | `fo` atau `layanan` |
| `layanan_id` | NULL untuk FO; terisi untuk petugas layanan |
| `saluran` | `walk_in | qr | chat` |
| `penangan_id` | `petugas.id` — **diisi saat mulai**; hanya orang ini yang boleh menyelesaikan |
| `tiket_id` | NULL untuk FO/chat; terisi bila tahap lahir dari tiket |
| `topik` | pilih dari daftar (lihat 4.5) |
| `hasil` | `selesai | dieskalasi | dikembalikan` |
| `catatan` | **NOT NULL saat selesai**; maks ± 200 karakter untuk FO |
| `status` | `menunggu | berjalan | selesai` (`menunggu` = kotak masuk FO setelah pengembalian atau chat belum diambil) |
| `mulai_at`, `selesai_at` | waktu **server** (menutup temuan jam PC loket) |
| `chat_sesi_id` | untuk saluran chat |

Rekap harian FO = `penanganan` dengan `peran_tahap='fo'` dikelompokkan per `penangan_id` per hari (WIB). Rekap petugas layanan = `peran_tahap='layanan'` + data Pendataan Pelayanan.

### 4.3 `tiket_antrean` (ada) — perubahan
- Terbit **hanya** dari RPC eskalasi (tidak ada lagi insert langsung dari klien: hapus `tiket_insert_public WITH CHECK (true)`).
- Tambah `penanganan_asal_id` (tahap FO yang melahirkannya), status `dikembalikan` dan `dialihkan` pada CHECK.
- `nomor_display` memakai **prefiks 2 huruf** dari `layanan` (lihat 4.4).
- `dilayani_oleh` diisi atomik saat mulai (4.6) dan menjadi dasar K2.

### 4.4 Prefiks 2 huruf
- `layanan.prefiks_antrean` menjadi **2 huruf unik** (CHECK `^[A-Z]{2}$`, UNIQUE). Dibuat otomatis dari nama layanan (mis. Helpdesk OSS → `OS`, Balmon → `BM`; bila bentrok ambil kombinasi huruf berikutnya), **boleh disunting admin** di halaman Kelola Layanan.
- Format `OS-014`; nomor tetap atomik per (layanan, tanggal WIB) lewat `terbit_nomor_antrean` yang ada. Backfill prefiks 1 huruf lama ke 2 huruf dilakukan dalam migrasi.

### 4.5 Daftar topik
**FO (draf, 3 isian: topik, hasil, catatan — semua wajib):**
informasi perizinan/syarat · status permohonan · pendaftaran/kendala akun OSS · konsultasi investasi · kendala teknis · pengaduan/saran · lainnya.
**Petugas layanan:** daftar topik per layanan (OSS, Balmon, …) — disusun bersama masing-masing layanan saat implementasi; disimpan di tabel referensi `topik_penanganan (layanan_id NULL = FO)` agar admin bisa mengelola tanpa deploy.

### 4.6 Aksi lewat RPC atomik (SECURITY DEFINER, cek role + `sesi_valid()`)
Semua perubahan status lewat RPC; klien tidak lagi `UPDATE` langsung (menutup T1 dan pola "toast sukses palsu" T2d). Setiap RPC mengembalikan hasil eksplisit; klien **wajib membaca** `error` dan baris terdampak.

| RPC | Aturan inti |
|---|---|
| `fo_mulai_kunjungan` (walk-in/QR) | role FO; membuat `kunjungan` + `penanganan` tahap 1 `berjalan` |
| `fo_selesai` | `penangan_id = pemanggil`, catatan & topik wajib → `selesai` |
| `fo_eskalasi(kunjungan, layanan, catatan)` | penangan = pemanggil; menutup tahap FO (`dieskalasi`), menerbitkan tiket (nomor 2 huruf), membuat `penanganan` tahap berikut `menunggu` |
| `layanan_mulai(tiket)` | `UPDATE … WHERE status IN ('menunggu','dipanggil') AND layanan = layanan petugas … RETURNING`; 0 baris = ditolak "sudah diambil" (atomik, tanpa race) |
| `layanan_selesai(tiket, payload)` | **`WHERE dilayani_oleh = pemanggil`**; payload Pendataan Pelayanan divalidasi lengkap (4.8) |
| `layanan_kembalikan(tiket, catatan)` | hanya penangan; tiket → `dikembalikan`; membuat `penanganan` FO `menunggu` (kotak masuk FO) |
| `fo_ambil_dari_kotak_masuk` | `UPDATE … WHERE status='menunggu' RETURNING` (atomik) |
| `admin_ambil_alih` / `admin_alihkan` | hanya admin; alasan wajib; tulis `audit_log` |
| `chat_ambil` / `chat_teruskan` | lihat 4.7 |

`finalize_pelayanan` yang ada diubah: **FO tidak lagi boleh** menyelesaikan tiket layanan; syaratnya `dilayani_oleh = pemanggil`, admin mengikuti jalur ambil alih.

### 4.7 Chat sebagai layanan online
- `chat_sesi` mendapat `kunjungan_id` (kunjungan bersaluran `online`, dibuat saat sesi ber-eskalasi atau saat pengunjung terdaftar memulai).
- Status sesi (`bot → eskalasi → aktif → selesai`) tetap; `eskalasi` tampil di kotak masuk FO. `chat_ambil` atomik (`WHERE penangan IS NULL`). Petugas layanan yang layanannya sesuai bisa `chat_ambil` selama belum diambil FO.
- `chat_selesai` **tidak bisa** dipanggil tanpa topik + catatan singkat (disimpan di `penanganan`).
- Tautan survei (K13) dikirim sebagai pesan penutup di chat.

### 4.8 Pendataan Pelayanan wajib (K11)
`pelayanan_oss` / `pelayanan_perizinan` (migrasi `202608290001`) saat ini punya skema *draft* (longgar) dan *final* (hanya sebagian field wajib). Perubahan:
- Skema **final** di `src/lib/types/pelayanan.ts` (zod) menuntut **seluruh field** terisi non-kosong.
- `layanan_selesai` memvalidasi di database juga (bukan hanya di UI): payload dengan field kosong ditolak `INVALID_PAYLOAD`. Draft tetap boleh parsial sebelum selesai.
- Field yang ditandai opsional hari ini (`catatan_internal`, `skala_usaha`, `sektor_usaha_kbli`, `lokasi_usaha` dll.) diaudit satu per satu saat implementasi; setiap pengecualian harus disetujui CEO secara eksplisit (default: wajib).

### 4.9 Pendaftaran online + pernyataan kebenaran (K12)
- Semua field profil pengunjung wajib (gerbang `ProfileCompletenessGate` yang ada diperkuat).
- Tombol Simpan aktif setelah **kotak centang** pernyataan: *"Saya menyatakan bahwa seluruh data yang saya isi adalah benar dan dapat dipertanggungjawabkan. Saya memahami bahwa data yang tidak benar dapat menghambat atau membatalkan layanan."*
- Dicatat di `consent_log`: jenis `pernyataan_kebenaran`, **versi teks**, waktu, `pengunjung_id`; hasil insert **wajib diperiksa** (menutup temuan Sedang "consent PDP tidak konsisten").
- Kolom identitas utama (nama, NIK/identitas — daftar final saat implementasi) **terkunci** setelah disimpan; perubahan hanya oleh FO/admin dengan `audit_log`.

## 5. Sesi tunggal (K1)

- Tabel `sesi_staf (user_id PK, session_id, last_seen, dibuat_at)`. Setelah login sukses, RPC `daftarkan_sesi()` mengisi `session_id` dari klaim JWT Supabase (`session_id`) dan **menimpa** baris lama → sesi lama otomatis tidak sah.
- Fungsi `sesi_valid()` (membandingkan klaim JWT dengan baris aktif) dipanggil di **semua RPC mutasi** dan di `src/proxy.ts` untuk `/admin*`. Sesi lama yang browsernya masih terbuka akan ditolak di server dan, begitu ketahuan (heartbeat/realtime), otomatis diarahkan ke login dengan pesan "Akun ini login di perangkat lain".
- **Pola "login pagi, tutup browser sore" aman**: menutup browser tanpa logout tidak mengunci akun, karena login berikutnya langsung menggantikan sesi. Risiko sebenarnya = komputer dibiarkan terbuka: **logout otomatis setelah jam tutup** (16:00 — nilai dari pengaturan layanan, bukan hardcode) dan sesi dianggap tidak aktif bila heartbeat berhenti melewati batas yang diatur admin.
- Sesi hanya diberlakukan pada peran staf (`admin`, `petugas`, `front_office`); pengunjung tidak terkena.
- Perlu diverifikasi saat implementasi: klaim `session_id` ada di JWT proyek ini, dan setting Auth "single session per user" Supabase (bergantung paket) — rancangan ini tidak bergantung padanya.

## 6. Rekap & performa (K9)

- **Rekap harian FO**: per FO (nama dari `petugas`) per hari WIB: daftar penanganan (saluran, topik, hasil, catatan, jam mulai/selesai). Diekspor lewat jalur rekap yang ada (`src/lib/rekap/`, ExcelJS) dan memakai penomoran paginasi penuh seperti tab `layanan` (menutup T5 untuk tab baru).
- **Rekap petugas layanan**: per tiket/tahap + data Pendataan Pelayanan (v_rekap_pelayanan_*).
- **Performa pelayanan** (halaman terpisah dari survei): jumlah pengunjung dilayani, durasi per tahap, tingkat eskalasi FO→layanan, tingkat pengembalian, per orang/per layanan/per hari. Dihitung dari `penanganan` + `tiket_antrean`.
- Keterbatasan yang diterima: **waktu tunggu sebelum disapa FO tidak terukur** (tidak ada tiket di tahap FO).
- Rekap mencatat **tahap** sehingga tiket yang dikerjakan dua orang (FO → petugas) terhitung untuk masing-masing.

## 7. Survei terpadu — fondasi saja (K13, di luar cakupan implementasi ini)

Tidak dibangun sekarang, tetapi desain di atas tidak boleh menghalanginya:
- Tiap `kunjungan` bisa menerbitkan **token survei** (magic-link, kedaluwarsa 24 jam; status `belum | sudah | kedaluwarsa`), dipicu saat kunjungan `selesai`.
- Yang diperlukan dari tahap ini: `kunjungan.selesai_at`, daftar `penanganan` per kunjungan (untuk rating tiap petugas yang melayani), dan saluran (QR di layar petugas untuk fisik; pesan di chat untuk online).
- Catatan desain untuk spec survei nanti: wizard sekali-klik (opsi memilih langsung maju, ada Back), >20 pertanyaan gabungan SKM + persepsi anti korupsi + lainnya; **jawaban disimpan terpisah dari identitas** (status "sudah mengisi" tetap terlacak per kunjungan, tetapi nilai tidak terhubung ke orangnya) supaya jawaban jujur dan selaras Permenpan RB 14/2017; pengaduan di akhir boleh atas nama pengunjung; "wajib" diwujudkan sebagai status yang terlihat + pengingat petugas (sistem tidak bisa menahan orang yang sudah selesai dilayani).

## 8. Dampak ke komponen yang ada

| Area | Perubahan |
|---|---|
| `src/lib/admin-nav.ts` | Halaman baru: **Kotak Masuk FO**, **Penanganan FO** (rekap), **Performa**; hak akses per peran. Antrean petugas layanan hanya menampilkan layanannya. |
| `admin/antrian`, `PelayananWizardModal` | Aksi lewat RPC baru; tombol dikunci selama request (menutup T1 sisi UI); label modal diperbaiki sekaligus (T8: `htmlFor`, Escape, focus trap). |
| `WalkinWizard`, `admin/scan`, `/checkin` | Pendaftaran & scan = FO saja; tidak menerbitkan tiket; scan memperbaiki cleanup kamera (T9). Antrean offline hanya untuk FO; replay wajib `client_request_id` + `ownerUserId` (T3b/c). |
| `layar/[token]`, `layar-antrian` | Hanya menampilkan tiket hasil eskalasi; satu kegagalan jaringan tidak lagi memberi "Token tidak valid" permanen, ukuran teks diperbesar (T4). |
| `chat`, `admin/chat` | Kotak masuk FO; pengambilan atomik; kolom topik/catatan wajib saat selesai; daftar layanan fallback palsu dihapus (T7). |
| `visit` (lama) | Alur baru **tidak menulis ke `visit`**. Ini kesempatan menyelesaikan **WP-24**: hapus 7 titik tulis langsung (`api/checkin`, `api/admin/pelayanan/[tiketId]`, `admin/antrian`, `admin/scan`, `checkin`, `me`, `me/reservasi`) dan trigger dual-write, dengan jalur rollback `docs/rollback-*.sql`. Keputusan cutover dibahas terpisah (lihat §10). |
| RLS | `tiket_insert_public`/`kunjungan_insert_public` `WITH CHECK (true)` diganti: insert hanya via RPC. Matriks `docs/analysis/04-RBAC-MATRIX*.md` diperbarui. |
| Notifikasi | Eskalasi memicu notifikasi ke petugas layanan terkait (jalur `queue_notifikasi` yang ada). |

## 9. Pemetaan temuan audit

| Temuan | Tertutup oleh |
|---|---|
| **T1** | §4.6 (`layanan_mulai`/`layanan_selesai` atomik + kepemilikan), §5 |
| T2d (±15 mutasi tanpa cek hasil) | Pola RPC + wajib baca `error`/baris terdampak pada semua mutasi baru |
| T3 | `client_request_id` + `ownerUserId` pada replay; check-in = FO |
| T4, T7, T8, T9 | Diperbaiki pada komponen yang disentuh (lihat §8) |
| T5 | Ekspor rekap baru memakai paginasi penuh; tab lama diperbaiki dalam paket rekap |
| T11 | Setiap migrasi baru tercatat di `docs/MIGRATIONS.md` + `DB-CHANGES.md`; tidak ada edit in-place |
| T6, T10, Sedang/Rendah lainnya | **Di luar cakupan** — dikerjakan paket terpisah |

Koreksi dokumen audit: ringkasan §1 menulis "9 temuan Tinggi" padahal tabel berisi **T1–T11**.

## 10. Tahapan implementasi (usul)

| Tahap | Isi | Catatan |
|---|---|---|
| **A** | Sesi tunggal + kepemilikan tiket (RPC atomik `layanan_mulai/selesai`, UI terkunci) | Berdiri sendiri; menutup T1 lebih awal |
| **B** | Model `penanganan`, alur FO, eskalasi/kembalikan/ambil alih, prefiks 2 huruf, kotak masuk FO, layar TV | Inti perubahan alur; sebaiknya dikerjakan bersama keputusan WP-24 |
| **C** | Chat sebagai layanan online + pendaftaran dengan pernyataan kebenaran + Pendataan Pelayanan wajib | |
| **D** | Rekap FO/petugas + halaman performa | |
| **E** | Survei terpadu | Spec terpisah |

Tiap tahap: skill `writing-plans` → TDD → `verification-before-completion` (lint, typecheck, test, build); migrasi diterapkan ke produksi hanya setelah konfirmasi CEO (`scripts/apply-migration.mjs`).

## 11. Yang perlu diputuskan / dikonfirmasi

1. **WP-24 / `visit`**: hentikan tulis `visit` sekarang (di Tahap B) atau tunggu? Rekomendasi: Tahap B, karena alur baru tidak cocok dengan dual-write.
2. **Batas heartbeat/idle** sesi dan jam logout otomatis (usul: ikut jam tutup 16:00; idle default 2 jam — dapat diubah admin).
3. **Kolom identitas yang dikunci** setelah pendaftaran online (usul: nama + NIK/identitas; kolom kontak tetap bisa diubah pengunjung).
4. **Topik petugas layanan** per layanan — perlu masukan tiap layanan.
5. **Field Pendataan Pelayanan** yang selama ini opsional — konfirmasi bahwa semuanya benar-benar wajib (mis. `catatan_internal`).
6. **Migrasi data berjalan**: tiket `menunggu`/`dilayani` yang ada saat cutover (usul: cutover di luar jam layanan setelah antrean kosong).
7. Rekap harian lama (`rekap_harian_layanan`) — dipertahankan sebagai sumber historis; rekap baru dibaca dari `penanganan` untuk data setelah cutover.
