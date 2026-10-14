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
| `/admin/fo/kotak-masuk` | ✓ | ✓ | ✗ | kotak masuk FO (tahap `fo` `menunggu`, termasuk chat); item yang dikembalikan menampilkan FO yang melayani sebelumnya (FO mana pun) |
| `/admin/fo/penanganan` | ✓ | ✓ | ✗ | penanganan yang sedang saya pegang (selesai/eskalasi; aksi hanya milik sendiri) + tahap FO yang sedang dipegang FO lain (baca saja) + riwayat hari ini semua FO dengan kolom Front Office (keterbukaan antar FO, §6.4) |
| `/admin/fo/daftar` | ✓ | ✓ | ✗ | pendaftaran walk-in (`fo_mulai_kunjungan`) |
| `/admin/topik` | ✓ | ✗ | ✗ | kelola topik penanganan (tulis langsung RLS `topik_penanganan_admin_tulis`) |
| `/admin/rekap-fo` | ✓ (semua FO, filter FO) | ✓ (semua FO, filter FO; sejak keputusan CEO 2026-10-14, §6.4; sebelumnya hanya miliknya) | ✗ | API `rekap/penanganan?peran=fo` |
| `/admin/performa` | ✓ | ✗ | ✗ | API `rekap/performa` (403 selain admin) |
| `/admin/rekap` tab Rekap Petugas Layanan | ✓ (semua, filter petugas/layanan) | ✓ (semua, filter petugas/layanan; sama dengan Admin) | `S` (layanannya) | Keputusan CEO 2026-10-14 tahap 1 membuka tab untuk FO terbatas "eskalasi asal dirinya"; keputusan CEO 2026-10-14 tahap 2 (keterbukaan antar FO, §6.4) menghapus batas itu. API `rekap/penanganan?peran=layanan` dan `.../penanganan/export` dibaca dengan klien pengguna (RLS `boleh_penanganan` versi `202610140013`). Kolom baru **Front Office** (tampilan + Excel) = FO tahap `fo` terakhir sebelum tahap layanan itu. Catatan keterbatasan lama dihapus. Ekspor tercatat di `audit_log` (filter `petugas_id`/`layanan_id`; `eskalasi_fo_id` tidak lagi ada). `/admin/performa` tidak berubah (Admin saja). |
| `/checkin` (publik) | – | – | – | kini halaman informasi statis; `POST /api/checkin` dihapus |

### 6.2 RPC baru (SECURITY DEFINER; identitas dari sesi, bukan parameter; semua memanggil `sesi_valid()`)

| RPC | Admin | FO | Petugas | Pengunjung | Syarat/catatan |
|---|:-:|:-:|:-:|:-:|---|
| `fo_mulai_kunjungan`, `fo_checkin_reservasi`, `fo_tolak_reservasi` | ✓ | ✓ | ✗ | ✗ | Admin sebagai pengganti FO (butuh konfirmasi CEO); walk-in ditolak setelah jam tutup |
| `fo_selesai`, `fo_eskalasi` | ✓ | ✓ | ✗ | ✗ | hanya pemilik tahap FO `berjalan`; topik + catatan <= 200 wajib |
| `fo_ambil_dari_kotak_masuk` | ✓ | ✓ | ✗ | ✗ | atomik (`SUDAH_DIAMBIL` bila kalah) |
| `layanan_mulai` | ✓ (semua layanan) | ✗ | `S` | ✗ | atomik; `dilayani_oleh` = pemanggil (A3) |
| `layanan_selesai` (5 argumen) | ✓ (pemilik) | ✗ | `S` (pemilik) | ✗ | hanya pemilik; tiket hasil eskalasi wajib topik + catatan <= 1000; pendataan semua field wajib (`INVALID_PAYLOAD`, 0011); layanan wajib form (`layanan.form_pendataan`, 0012) wajib form untuk SEMUA peran, termasuk Admin setelah ambil alih (keputusan CEO 2026-10-14); penutupan tanpa form hanya job 23:00 WIB |
| `layanan_kembalikan` | ✓ (pemilik) | ✗ | `S` (pemilik) | ✗ | tiket hasil eskalasi; catatan wajib; masuk kotak masuk FO |
| `admin_ambil_alih` | ✓ | ✗ | ✗ | ✗ | alasan >= 5; `audit_log` |
| `admin_alihkan` | ✓ | ✗ | ✗ | ✗ | alasan 5-500; `audit_log`; notifikasi petugas tujuan |
| `chat_ambil` | ✓ (ambil alih + alasan) | ✓ | `S` (layanan sesi; langsung selama belum diambil FO) | ✗ | atomik; **semua peran ditolak `HARI_TANPA_LAYANAN` pada Sabtu/Minggu/`hari_libur`** (0012 #13) |
| `chat_teruskan` | ✓ | ✓ | ✗ | ✗ | hanya pemilik tahap FO; tanpa tiket; layanan tujuan `aktif` + `punya_chat`; ditolak `HARI_TANPA_LAYANAN` pada hari tanpa pelayanan || `hari_tanpa_layanan` | ✓ | ✓ | ✓ | ✓ (anon juga) | baca saja; Sabtu/Minggu/`hari_libur` |
| `chat_selesai` | ✓ | ✓ | `S` | ✗ | hanya pemilik tahap berjalan; topik + catatan wajib |
| `reservasi_buat`, `reservasi_batalkan` | – | – | – | ✓ (miliknya) | tanggal 0..7 hari kerja |
| `ubah_nama_pengunjung` | ✓ | ✓ | ✗ | ✗ | alasan wajib; `audit_log`; satu-satunya jalur ubah Nama Lengkap profil lengkap |
| `daftarkan_sesi`, `ping_sesi`, `akhiri_sesi` | ✓ | ✓ | ✓ | ✗ | sesi tunggal staf; flag `sesi_tunggal_aktif` = false sampai cutover |
| `tutup_penanganan_tertinggal`, `pendataan_validasi_payload`, `chat_ubah_sesi`, `chat_pesan_sistem`, `chat_buat_kunjungan` | ✗ | ✗ | ✗ | ✗ | internal (service_role/pg_cron atau tanpa EXECUTE klien) |

### 6.3 Perubahan akses data (RLS/hak)

- `kunjungan`, `tiket_antrean`, `penanganan`: klien tidak punya INSERT/UPDATE/DELETE (UPDATE langsung mengembalikan 0 baris); `kunjungan_staff_update` dan `tiket_staff_update` dicabut. `penanganan`: SELECT lewat `boleh_penanganan(...)` (Admin semua; FO **semua** sejak `202610140013` (§6.4; sebelumnya tahap miliknya, kotak masuk FO (`fo` `menunggu`), dan tahap lain dari kunjungan yang sama (konteks)); petugas tahap layanannya dan tahap lain dari kunjungan yang punya tahap di layanannya (konteks); chat: petugas melihat sesi yang saat ini di layanannya).
- `topik_penanganan`: SELECT staf, tulis Admin.
- `visit` (setelah `0007`): arsip baca saja (INSERT/UPDATE/DELETE klien dicabut; `VISIT_ARSIP` bagi fungsi/service_role kecuali flag `lmh.visit_arsip`).
- `chat_sesi`: kolom staf (status, `ditangani_oleh`, `layanan_id`, `kunjungan_id`) hanya lewat RPC (`CHAT_HARUS_RPC`).
- Draf pendataan `pelayanan_oss`/`pelayanan_perizinan`: hanya pemilik tiket `dilayani` (`pemilik_tiket()`; keputusan CEO 7.5).
- `pengunjung.nama`: terkunci bagi pemilik setelah profil lengkap (trigger); pengecualian service_role/pg_cron dan flag `lmh.ubah_nama` (RPC).
- Uji perilaku wajib (SEC-04) per migrasi: `scripts/test-tiket-kepemilikan.mjs`, `test-fo-eskalasi.mjs`, `test-wp24.mjs`, `test-chat-online.mjs` (transaksi di-ROLLBACK; di luar jam layanan). Belum dijalankan semuanya terhadap DB yang memuat migrasi terkait, kecuali `test-chat-online.mjs` (99 lolos, 2026-10-14).

### 6.4 Keterbukaan data antar Front Office (keputusan CEO 2026-10-14, migrasi `202610140013`, BELUM DITERAPKAN)

Kata CEO: "role FO itu walaupun petugas FO ada banyak, tapi semua antrian, semua pengunjung, rekap, dll itu terbuka untuk semua FO, tapi nanti di setiap pengunjung ada nama petugas FO yang melayani itu siapa." Semua FO = satu unit layanan: data tidak dipersempit per FO. **Baca saja**: tidak ada hak tulis baru; penulisan tetap lewat RPC yang memeriksa pemilik tahap.

| Data (role `front_office`, akun aktif) | Sebelum | Sesudah | Mekanisme |
|---|---|---|---|
| `penanganan` tahap `fo` (semua FO, semua tanggal) | hanya miliknya + kotak masuk (`fo` `menunggu`) + tahap lain dari kunjungan yang pernah ia sentuh | **semua** | `boleh_penanganan` cabang `front_office` = `RETURN true` (0013) |
| `penanganan` tahap `layanan` | hanya pada kunjungan yang pernah ia sentuh / sedang menunggu FO | **semua** | idem |
| Tulis `penanganan` (selesai/eskalasi/tolak/ambil) | hanya RPC; pemilik tahap | **tidak berubah** (`BUKAN_PEMILIK`, `SUDAH_DIAMBIL`, `INVALID_STATUS`); tabel tetap GRANT SELECT saja tanpa policy tulis | 0003/0007/0009/0012 |
| `kunjungan` (semua pengunjung) | semua | semua (tidak berubah) | `boleh_kunjungan` (0009) |
| `tiket_antrean` (semua antrean, semua hari) | semua | semua (tidak berubah) | `tiket_staff_select` (202607290013) |
| `pelayanan_oss`/`pelayanan_perizinan` (isi Pendataan) | baca semua; tulis pemilik tiket | tidak berubah (dibutuhkan kolom Pendataan tab Rekap Petugas Layanan) | `boleh_tiket` -> `boleh_layanan` (202610090001); tulis `pemilik_tiket` (0002) |
| `petugas` (nama FO/petugas) | baca semua | tidak berubah | `petugas_fo_read` (202610090005) |
| `pengunjung` (profil akun pengunjung) | tidak | **tidak** (data yang dibutuhkan sudah disalin ke `kunjungan`) | `pengunjung_self_select` |
| `chat_sesi` | semua | tidak berubah | `chat_sesi_owner_select` |
| Rekap FO (`/admin/rekap-fo`, ekspor) | hanya miliknya (filter FO lain = 403) | semua FO, filter FO opsional | `tentukanCakupan` (`src/lib/rekap/penanganan.ts`) |
| Tab Rekap Petugas Layanan (+ ekspor) | hanya eskalasi asal dirinya | semua, filter petugas/layanan opsional, kolom Front Office | idem |
| `/admin/performa` | ✗ | ✗ (tidak diubah; pertanyaan terbuka ke CEO) | `api/admin/rekap/performa` |
| Petugas layanan / pengunjung / anon | – | **tidak berubah** (cabang lain `boleh_penanganan` identik 0009) | – |

Nama FO yang melayani tampil di: Penanganan Saya (riwayat + FO lain), Kotak Masuk FO (FO sebelumnya untuk item yang dikembalikan), Kelola Kunjungan (kolom Front Office), Rekap FO (kolom Front Office, sudah ada), tab Rekap Petugas Layanan (kolom baru + Excel), Antrian (catatan eskalasi "oleh <FO>", sudah ada; kini terbaca untuk FO lain juga). Layar TV antrean tidak menampilkan nama staf (tidak diubah).

Audit akses: tidak ada pencatatan per-baca (bukan fitur baru); ekspor Excel tetap tercatat `audit_log`; pembacaan hanya oleh staf aktif ber-sesi. Lihat `docs/KEBIJAKAN_PDP.md`. Uji perilaku: `scripts/test-fo-keterbukaan.mjs` (belum dijalankan; hanya di luar jam layanan).

**BERHENTI DI SINI.** Menunggu persetujuan manusia sebelum melanjutkan ke **Fase D (Rencana implementasi)**.
