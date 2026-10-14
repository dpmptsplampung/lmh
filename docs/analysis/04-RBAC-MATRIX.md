# 04 — MATRIKS HAK AKSES TARGET (FASE C)

> Matriks Bagian 5 spec diperluas menjadi pemetaan ke **kebijakan RLS nyata**, **rute**, dan **item navigasi**.
> Dibuat untuk memenuhi **Bagian 8.3**. Dasar: RBAC nyata di `00-CODE-INVENTORY.md` §A.4 + desain di `02-TARGET-DESIGN.md` + RLS baru di `03-DATA-MODEL.md`.
>
> **Legenda:** `✓` boleh · `✗` tidak · `S` hanya layanannya sendiri · `1→` wewenang satu arah (hanya menonaktifkan).
> **Peran:** `admin` · `front_office` (FO, baru RBA-02) · `petugas` (layanan) · `pengunjung` (login) · `anonim`.
>
> ⚠️ **Baris paling kritikal:** **pengaduan jalur integritas** — FO **tidak boleh** membacanya meski FO penerima pengaduan jalur layanan. **Wajib diuji perilaku (SEC-04 / I-15)**, bukan hanya diperiksa statis.

---

## 1. MATRIKS KEMAMPUAN UTAMA (target)

| Kemampuan | Admin | FO | Petugas Layanan | Pengunjung login | Anonim |
|---|:-:|:-:|:-:|:-:|:-:|
| Kelola akun & peran | ✓ | `1→` nonaktifkan saja | ✗ | ✗ | ✗ |
| Kelola jadwal standby | ✓ | ✓ | ✗ | ✗ | ✗ |
| Tutup/buka layanan hari ini | ✓ | ✓ | ✗ | ✗ | ✗ |
| Catat absensi petugas | ✓ | ✓ (semua) | ajukan sendiri | ✗ | ✗ |
| Registrasi walk-in | ✓ | ✓ | ✗ | ✗ | ✗ |
| Layani antrean (klik layani/selesai) | ✓ | ✓ | `S` | ✗ | ✗ |
| Panggil ulang nomor | ✓ | ✓ | `S` | ✗ | ✗ |
| Buku tamu | ✓ | ✓ | ✗ | ✗ | ✗ |
| Balas live chat | ✓ | ✓ (takeover semua) | `S` | ✗ | ✗ |
| Kelola FAQ | ✓ (semua layanan + FAQ umum) | ✓ **hanya FAQ umum** (`layanan_id` NULL; M-202610130001, belum diterapkan) | `S` (FAQ layanannya; FAQ umum tidak terjangkau) | ✗ | ✗ |
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
| Lihat dokumen IPRO | ✓ | ✓ | ✓ | ✓ (watermark nama+email) | ✓ (watermark sesi) |
| Layar TV (token) | – | – | – | – | ✓ baca antrean saja |

---

## 2. PEMETAAN KEMAMPUAN → RLS → TABEL

| Kemampuan | Tabel | Kebijakan RLS (nama) | Logika inti |
|---|---|---|---|
| Kelola akun & peran | `petugas` | `petugas_admin_all` (baru) | `get_my_role()='admin'` untuk INSERT/UPDATE role; FO hanya UPDATE `aktif=false` (RBA-08) |
| Kelola jadwal standby | `jadwal_standby`, `jadwal_pengecualian` | `jadwal_*_staff_write` | `get_my_role() IN ('admin','front_office')` |
| Tutup/buka layanan hari ini | `layanan_hari` | `layanan_hari_staff_write` | `get_my_role() IN ('admin','front_office')` |
| Catat absensi | `absensi_petugas` | `absensi_staff_*` (perluas) | FO/Admin semua; petugas `INSERT` hanya `petugas_id = diri sendiri` + `sumber='petugas_ajukan'` |
| Registrasi walk-in | `kunjungan`, `tiket_antrean` | `kunjungan_insert_public`, `tiket_insert_public` | publik/FO dapat membuat |
| Layani antrean | `tiket_antrean` | `tiket_staff_update` | `admin/fo` ATAU `layanan_id = get_my_layanan_id()` |
| Buku tamu | `buku_tamu` | `buku_tamu_fo_admin_all` | `get_my_role() IN ('admin','front_office')` |
| Balas live chat | `chat_sesi`, `chat_pesan` | perluas `chat_*` | FO `IN ('admin','front_office')`; petugas `layanan_id = get_my_layanan_id()` |
| Kelola FAQ | `faq_knowledge_base` | `faq_petugas_all` (ada; dipersempit ke peran petugas, M-202610130002) + `faq_admin_all` (ada) + `faq_fo_umum` (baru, M-202610130001) | petugas `layanan_id = get_my_layanan_id() AND get_my_role() = 'petugas'` (hanya peran petugas; FO ber-`layanan_id` tidak lolos; baris umum `layanan_id` NULL tidak terjangkau: `NULL = x` bukan true); FO `layanan_id IS NULL AND get_my_role() = 'front_office'` (USING dan WITH CHECK); admin semua. Bot (`match_faq_teks`, `match_faq`) mencari FAQ layanan + FAQ umum |
| Unggah dokumen | `dokumen_peraturan`, `dokumen_potongan` | `dokumen_staff_write`, `potongan_staff_write` | admin ATAU `layanan_id = get_my_layanan_id()` |
| Review listing UMKM | `listing_umkm` | `listing_staff_*` (perluas) | admin ATAU petugas Matchmaking (`get_my_layanan_id() = id Matchmaking`) |
| Pengaduan layanan | `pengaduan` | `pengaduan_layanan_read`, `pengaduan_update` | `jalur='layanan'` AND (`admin`/`fo` ATAU `layanan_id=get_my_layanan_id()`) |
| **Pengaduan integritas** | `pengaduan` | `pengaduan_integritas_admin_only` | `jalur='integritas' AND get_my_role()='admin'` — **FO & petugas ditolak** |
| Rekap | `rekap_harian_layanan` | `rekap_staff_read` | `admin`/`fo` semua; petugas `layanan_id=get_my_layanan_id()` |
| Ekspor ber-PII | (via fungsi/route) | + tulis `audit_log` (I-20) | petugas `S`; semua ekspor tercatat |
| CMS | `site_settings`, `landing_content`, `konten_versi`, `standar_pelayanan` | `*_admin_write` | `get_my_role()='admin'`; kunci `boleh_diubah_dashboard=false` ditolak (CMS-04/I-19) |
| Layar TV | `layar_token` + view antrean khusus | fungsi validasi token (SECURITY DEFINER) | token valid + aktif + belum kedaluwarsa → baca antrean minimal (tanpa nama, DSP-06) |

---

## 3. PEMETAAN PERAN → RUTE

> Mekanisme 3-lapisan (proxy → AdminGuard → canAccessAdminPath) dipertahankan; `front_office` ditambahkan ke matriks.

| Rute | Admin | FO | Petugas | Pengunjung | Anonim |
|---|:-:|:-:|:-:|:-:|:-:|
| `/`, `/layar-antrian`(token), `/checkin`, `/chat`, `/gallery`, `/umkm`, `/skm`, `/transparansi`, `/kebijakan-privasi` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `/me`, `/me/reservasi`, `/me/notifications` | ✓ | ✓ | ✓ | ✓ | ✗ |
| `/peta-potensi` (baru) | ✓ | ✓ | ✓ | ✓ | **✗** |
| `/admin` (dashboard) | ✓ | ✗ | ✗ | ✗ | ✗ |
| `/admin/antrian` | ✓ | ✓ | `S` | ✗ | ✗ |
| `/admin/absensi` | ✓ | ✓ | `S` (ajukan) | ✗ | ✗ |
| `/admin/scan` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/kunjungan` | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/buku-tamu` (baru) | ✓ | ✓ | ✗ | ✗ | ✗ |
| `/admin/chat` | ✓ | ✓ (takeover) | `S` | ✗ | ✗ |
| `/admin/chat/faq` | ✓ | ✓ (hanya FAQ umum) | `S` | ✗ | ✗ |
| `/admin/chat/ai-log` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `/admin/dokumen` (baru) | ✓ | ✗ | `S` | ✗ | ✗ |
| `/admin/umkm` | ✓ | ✗ | `S` (Matchmaking) | ✗ | ✗ |
| `/admin/gallery`, `/admin/investasi-leads` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `/admin/pengaduan` (baru) | ✓ | ✓ (layanan saja) | `S` (diteruskan) | ✗ | ✗ |
| `/admin/pengaduan/integritas` (baru) | ✓ | **✗** | **✗** | ✗ | ✗ |
| `/admin/skm` | ✓ | ✓ | `S` | ✗ | ✗ |
| `/admin/laporan` (baru) | ✓ | ✓ | `S` | ✗ | ✗ |
| `/admin/petugas`, `/admin/petugas/invite` | ✓ | ✗ | ✗ | ✗ | ✗ |
| `/admin/settings`, `/admin/settings/landing`, `/admin/settings/jadwal` | ✓ | ✓ (jadwal) | ✓ (jadwal) | ✗ | ✗ |
| `/admin/data-governance` | ✓ | ✗ | ✗ | ✗ | ✗ |

**Perubahan pada `ADMIN_NAV` (`src/lib/admin-nav.ts`):** tambah `front_office` ke `AdminRole`; tambah entri `buku-tamu`, `dokumen`, `pengaduan`, `laporan` dengan roles yang sesuai; entri `pengaduan/integritas` **hanya `admin`**; `canAccessAdminPath` tetap *fail-closed* (`role==='admin'` untuk rute tak terdaftar).

---

## 4. PERAN & IDENTITAS

| Peran | Sumber kebenaran | Cara ditetapkan |
|---|---|---|
| `admin` | `petugas.role='admin'` + `app_metadata.role` (Auth Hook `set_user_role_claim`) | Admin membuat via `/admin/petugas/invite` (RBA-05) |
| `front_office` | `petugas.role='front_office'` (baru, RBA-02) | Admin menetapkan; FO **tidak bisa** mengubah peran |
| `petugas` | `petugas.role='petugas'` + `layanan_id` tunggal (RBA-03) | Admin |
| `pengunjung` | fallback `COALESCE(role,'pengunjung')` di Auth Hook | login Google / magic-link (CHT-11) |
| `anonim` | tanpa sesi / `signInAnonymously` untuk check-in | — |

**Nonaktivasi (RBA-06/RBA-08):** `petugas.aktif=false` menghalangi login & aksi (I-22). FO menonaktifkan (satu arah, wajib `nonaktif_alasan`, `nonaktif_oleh`); hanya Admin yang mengaktifkan kembali. **Pergantian PIC (RBA-07):** satu layanan satu akun — Admin mereset password/meneruskan akses ke pemegang baru + **mengakhiri sesi pemegang lama** (I-23); audit log menjadi garis waktu pemegang.

---

## 5. UJI PERILAKU WAJIB (SEC-04)

Setiap kebijakan RLS baru/perubahan **wajib** punya tes perilaku dengan token nyata per peran, terutama:
- **I-15:** `petugas` dan `front_office` **tidak bisa** membaca `pengaduan.jalur='integritas'` (uji langsung via API/RLS).
- **I-05/I-06:** penerbitan tiket ditolak bila layanan belum ada absensi / di luar jadwal.
- **I-19:** kunci `site_settings.boleh_diubah_dashboard=false` tidak bisa diubah lewat jalur dashboard bahkan oleh Admin.
- **I-22:** `petugas.aktif=false` tidak bisa login / memanggil antrean.
- **I-23:** pemegang akun lama tidak bisa login setelah pergantian PIC (sesi lama yang masih terbuka diuji).

## 6. PEMBARUAN 2026-10-14 — Alur Front Office → eskalasi, chat online, rekap FO/performa

> Status: kode ditulis; migrasi `0003`-`0009`, `0011` BELUM DITERAPKAN ke produksi (hanya `202610140001` sesi staf yang sudah). Sumber kebenaran akses halaman admin tetap **`src/lib/admin-nav.ts`** (bila berbeda dengan tabel §1/§3 di atas, yang berlaku `admin-nav.ts`: mis. `/admin` dashboard, `/admin/kunjungan`, `/admin/scan` kini dapat dibuka `admin` dan `front_office`). Kontrak RPC: `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md`, `docs/analysis/FO-CHAT-KONTRAK-RPC.md`.

### 6.1 Rute baru (`admin-nav.ts`)

| Rute | Admin | FO | Petugas | Catatan |
|---|:-:|:-:|:-:|---|
| `/admin/fo/kotak-masuk` | ✓ | ✓ | ✗ | kotak masuk FO (tahap `fo` `menunggu`, termasuk chat) |
| `/admin/fo/penanganan` | ✓ | ✓ | ✗ | penanganan yang sedang saya pegang (selesai/eskalasi) |
| `/admin/fo/daftar` | ✓ | ✓ | ✗ | pendaftaran walk-in (`fo_mulai_kunjungan`) |
| `/admin/topik` | ✓ | ✗ | ✗ | kelola topik penanganan (tulis langsung RLS `topik_penanganan_admin_tulis`) |
| `/admin/rekap-fo` | ✓ (semua FO, filter FO) | ✓ (hanya miliknya) | ✗ | API `rekap/penanganan?peran=fo` |
| `/admin/performa` | ✓ | ✗ | ✗ | API `rekap/performa` (403 selain admin) |
| `/admin/rekap` tab Rekap Petugas Layanan | ✓ | **✗ (tab disembunyikan; API 403)** | `S` (layanannya) | keputusan CEO: rekap layanan hanya Admin dan Petugas |
| `/checkin` (publik) | – | – | – | kini halaman informasi statis; `POST /api/checkin` dihapus |

### 6.2 RPC baru (SECURITY DEFINER; identitas dari sesi, bukan parameter; semua memanggil `sesi_valid()`)

| RPC | Admin | FO | Petugas | Pengunjung | Syarat/catatan |
|---|:-:|:-:|:-:|:-:|---|
| `fo_mulai_kunjungan`, `fo_checkin_reservasi`, `fo_tolak_reservasi` | ✓ | ✓ | ✗ | ✗ | Admin sebagai pengganti FO (butuh konfirmasi CEO); walk-in ditolak setelah jam tutup |
| `fo_selesai`, `fo_eskalasi` | ✓ | ✓ | ✗ | ✗ | hanya pemilik tahap FO `berjalan`; topik + catatan <= 200 wajib |
| `fo_ambil_dari_kotak_masuk` | ✓ | ✓ | ✗ | ✗ | atomik (`SUDAH_DIAMBIL` bila kalah) |
| `layanan_mulai` | ✓ (semua layanan) | ✗ | `S` | ✗ | atomik; `dilayani_oleh` = pemanggil (A3) |
| `layanan_selesai` (5 argumen) | ✓ (pemilik) | ✗ | `S` (pemilik) | ✗ | hanya pemilik; tiket hasil eskalasi wajib topik + catatan <= 1000; pendataan semua field wajib (`INVALID_PAYLOAD`, 0011) |
| `layanan_kembalikan` | ✓ (pemilik) | ✗ | `S` (pemilik) | ✗ | tiket hasil eskalasi; catatan wajib; masuk kotak masuk FO |
| `admin_ambil_alih` | ✓ | ✗ | ✗ | ✗ | alasan >= 5; `audit_log` |
| `admin_alihkan` | ✓ | ✗ | ✗ | ✗ | alasan 5-500; `audit_log`; notifikasi petugas tujuan |
| `chat_ambil` | ✓ (ambil alih + alasan) | ✓ | `S` (layanan sesi; langsung selama belum diambil FO) | ✗ | atomik |
| `chat_teruskan` | ✓ | ✓ | ✗ | ✗ | hanya pemilik tahap FO; tanpa tiket; layanan tujuan `aktif` + `punya_chat` |
| `chat_selesai` | ✓ | ✓ | `S` | ✗ | hanya pemilik tahap berjalan; topik + catatan wajib |
| `reservasi_buat`, `reservasi_batalkan` | – | – | – | ✓ (miliknya) | tanggal 0..7 hari kerja |
| `ubah_nama_pengunjung` | ✓ | ✓ | ✗ | ✗ | alasan wajib; `audit_log`; satu-satunya jalur ubah Nama Lengkap profil lengkap |
| `daftarkan_sesi`, `ping_sesi`, `akhiri_sesi` | ✓ | ✓ | ✓ | ✗ | sesi tunggal staf; flag `sesi_tunggal_aktif` = false sampai cutover |
| `tutup_penanganan_tertinggal`, `pendataan_validasi_payload`, `chat_ubah_sesi`, `chat_pesan_sistem`, `chat_buat_kunjungan` | ✗ | ✗ | ✗ | ✗ | internal (service_role/pg_cron atau tanpa EXECUTE klien) |

### 6.3 Perubahan akses data (RLS/hak)

- `kunjungan`, `tiket_antrean`, `penanganan`: klien tidak punya INSERT/UPDATE/DELETE (UPDATE langsung mengembalikan 0 baris); `kunjungan_staff_update` dan `tiket_staff_update` dicabut. `penanganan`: SELECT lewat `boleh_penanganan(...)` (Admin semua; FO tahap miliknya, kotak masuk FO (`fo` `menunggu`), dan tahap lain dari kunjungan yang sama (konteks); petugas tahap layanannya dan tahap lain dari kunjungan yang punya tahap di layanannya (konteks); chat: petugas melihat sesi yang saat ini di layanannya).
- `topik_penanganan`: SELECT staf, tulis Admin.
- `visit` (setelah `0007`): arsip baca saja (INSERT/UPDATE/DELETE klien dicabut; `VISIT_ARSIP` bagi fungsi/service_role kecuali flag `lmh.visit_arsip`).
- `chat_sesi`: kolom staf (status, `ditangani_oleh`, `layanan_id`, `kunjungan_id`) hanya lewat RPC (`CHAT_HARUS_RPC`).
- Draf pendataan `pelayanan_oss`/`pelayanan_perizinan`: hanya pemilik tiket `dilayani` (`pemilik_tiket()`; keputusan CEO 7.5).
- `pengunjung.nama`: terkunci bagi pemilik setelah profil lengkap (trigger); pengecualian service_role/pg_cron dan flag `lmh.ubah_nama` (RPC).
- Uji perilaku wajib (SEC-04) per migrasi: `scripts/test-tiket-kepemilikan.mjs`, `test-fo-eskalasi.mjs`, `test-wp24.mjs`, `test-chat-online.mjs` (transaksi di-ROLLBACK; di luar jam layanan). Belum dijalankan semuanya terhadap DB yang memuat migrasi terkait, kecuali `test-chat-online.mjs` (99 lolos, 2026-10-14).

**BERHENTI DI SINI.** Menunggu persetujuan manusia sebelum melanjutkan ke **Fase D (Rencana implementasi)**.
