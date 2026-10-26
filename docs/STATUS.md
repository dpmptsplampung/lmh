# LMH — Status Proyek (2026-07-30)

Lampung Maju Hub — Sistem Pelayanan Digital DPMPTSP Provinsi Lampung.

> **Catatan 2026-10-13: dokumen ini tertinggal dari 30 Juli 2026.** Tabel WP dan daftar "Migrations applied: 24 file" di bawah belum mencakup migrasi Agustus–Oktober 2026 (`202608…` s.d. `202610…`, termasuk RBAC Tahap 0/1). Fakta yang sudah diverifikasi read-only pada 2026-10-13: ledger migrasi produksi (`supabase_migrations.schema_migrations`) berisi 13 entri dan berhenti di `202607280005`, sedangkan repo memuat 57 file; dari 44 file yang tidak tercatat, 39 terbukti terpasang di produksi, 1 (`202609020001`) tidak terpasang, dan 4 tidak dapat ditentukan. Sumber terbaru: `docs/analysis/DB-CHANGES.md` (bagian "Inventaris ledger 2026-10-13"), `docs/analysis/LEDGER-VERIFIKASI-2026-10-13.md`, `docs/MIGRATIONS.md`, `docs/DECISION_LOG.md`, `docs/RUNBOOK_RBAC_TAHAP0.md`, `docs/audit/AUDIT-2026-10-12-TRACKER.md`, `docs/superpowers/{specs,plans}`, dan `.superpowers/sdd/progress.md`.


## Progres Fase 1 layanan dinamis (diperbarui 2026-10-26)

Branch `feat/fase-1-fondasi-layanan` (belum di-merge, belum di-push): admin dapat menambah/mengarsipkan layanan, mengelola Instansi, deskripsi, dan website terkait (`/admin/layanan`); jadwal tunggal per layanan (`jadwal_standby` + `hari_libur`, halaman Jadwal ditulis ulang); reservasi mengikuti jadwal dan hari libur; bot chat memakai profil layanan. **Migrasi `202610270001` dan `202610270002` DITULIS, BELUM DITERAPKAN ke produksi** (urutan: 0001 lalu 0002, hanya pemilik; terapkan sebelum/bersamaan deploy branch ini: tanpa 0001 halaman Kelola Layanan galat, API Instansi dan toggle bot di halaman itu tidak bisa dipakai; tanpa 0002 perilaku halaman Jadwal (hari libur menutup antrean, jam tutup per layanan) belum berlaku di DB). Catatan operasional: setelah 0002, batas tiket eskalasi/alih FO turun dari 16:00 ke `jam_selesai` tiap layanan (hasil backfill paling lambat 15:30), sedangkan pendaftaran walk-in FO tetap sampai 16:00; staf FO perlu diberi tahu. Daftar periksa sebelum terap (jumlah `layanan` `aktif = false`, `jadwal_pengecualian` bertanggal ke depan) ada di `docs/MIGRATIONS.md`). Sebelum verifikasi pasca-terap, fixture `scripts/test-fo-eskalasi.mjs` dan `scripts/test-perbaikan-review.mjs` harus diperbaiki: trigger jadwal default mengisi `jadwal_standby` hari 1-5, sehingga INSERT jadwal biasa hari 1-7 pada fixture berjadwal bentrok dengan `UNIQUE (layanan_id, hari)` (perlu upsert), dan fixture C (seharusnya tanpa jadwal) harus eksplisit dinonaktifkan/dihapus jadwal defaultnya. Bila branch `claude/busy-poitras-cb912c` (migrasi `202610260001`) juga di-merge, `MANIFEST.json` perlu digabung. Rincian: `docs/MIGRATIONS.md`, spesifikasi `docs/superpowers/specs/2026-10-26-layanan-dinamis-design.md`, `GLOSSARY.md`, `docs/adr/`.

## Progres Fase 2 layanan dinamis: homepage etalase (diperbarui 2026-10-28)

Branch `feat/fase-1-fondasi-layanan` (belum di-merge, belum di-push): homepage `/` kini etalase tersusun dari blok berjenis tetap (hero, jalur cepat, status hari ini, cari & daftar layanan, papan kinerja tercadang/mati, ajakan, footer) yang diatur admin di `/admin/settings/landing` (nyalakan/matikan, urutkan, ubah teks; blok mati tidak tampil). Kartu layanan terisi otomatis dari layanan publik (saklar baru "Tampil di homepage" di Kelola Layanan); klik kartu membuka popup (nama, Instansi, deskripsi, website terkait, jadwal, status buka/tutup hari ini, antrean, tautan live chat) dengan alamat `/?layanan=<slug>`; profil bot memuat alamat itu. `FALLBACK_SERVICES` dan baris `service` di `landing_content` tidak dipakai lagi. **Migrasi `202610280001` DITULIS, BELUM DITERAPKAN** (setelah 0001/0002 Fase 1, hanya pemilik; lihat `docs/MIGRATIONS.md`). Homepage tetap tampil dengan bawaan bila migrasi belum diterapkan. **Langkah admin setelah terap:** isi Deskripsi tiap layanan di `/admin/layanan` (deskripsi lama kartu di `landing_content` tidak disalin otomatis; SQL baca-saja untuk melihatnya ada di `docs/MIGRATIONS.md`). Rencana: `docs/superpowers/plans/2026-10-28-fase-2-homepage-etalase.md` (bagian "Keputusan pelaksana").

Branch `feat/fase-1-fondasi-layanan` (belum di-merge, belum di-push), **Fase 4 Pendataan**: Admin menyusun **Pendataan Khusus** per Layanan non-OSS di `/admin/layanan/[id]/pendataan` (7 jenis isian, wajib/opsional, tanpa unggah berkas; isian yang pernah diisi tidak bisa dihapus dan jenisnya terkunci oleh trigger DB, hanya bisa disembunyikan); petugas mengisinya bersama Pendataan Umum (topik + catatan) saat menyelesaikan tiket hasil eskalasi (`SelesaiEskalasiModal`) dan saat **menyelesaikan live chat** (`ChatSelesaiDialog`: identitas pengunjung dari profil Google bisa dilengkapi + Khusus Layanan); Helpdesk OSS/Non OSS tetap formulir tetap dengan tambahan **pilihan topik** di langkah 3; Rekap Data Pelayanan + Excel menambah kolom `[Khusus] ...` bila satu Layanan dipilih (kanal Live Chat sudah terhitung di rekap Fase 3). **Migrasi `202610300001`, `202610300002` DITULIS, BELUM DITERAPKAN** (setelah `202610290002`, hanya pemilik; daftar periksa di `docs/MIGRATIONS.md`). Rencana dan keputusan pelaksana: `docs/superpowers/plans/2026-10-30-fase-4-pendataan.md`. RLS/trigger baru hanya diuji statis. **Belum / tindak lanjut:** (a) koreksi jawaban Khusus setelah tersimpan (K4, tidak ada koreksi) ditandai untuk keputusan pemilik; jalur koreksi Admin dengan `audit_log` direncanakan; (b) jawaban Khusus teks bebas dan identitas hasil koreksi chat dapat memuat data pribadi dan **belum** masuk job anonimisasi PDP (retensi 730 hari menyentuh `kunjungan`/`penanganan.catatan`, bukan `pendataan_khusus_jawaban` atau `audit_log`): tindak lanjut; (c) draf Khusus dan Khusus untuk tiket lama tanpa tahap; (d) K2 dipertahankan: topik wajib di UI saja untuk OSS/Non OSS (DB opsional).

## Progres Fase 3 layanan dinamis: Koordinator dan rekap terpadu (diperbarui 2026-10-29)

Branch `feat/fase-1-fondasi-layanan` (belum di-merge, belum di-push): penanda **Koordinator** pada akun FO/Petugas Layanan (diatur di `/admin/petugas`; bukan role); akses data per orang membalik keterbukaan 202610140013 (ADR 0003): di luar jendela operasional (hanya pekerjaan terbuka) FO dan petugas biasa hanya membaca data yang ia tangani, Koordinator FO semua data, Koordinator Petugas semua data Layanannya; Koordinator dapat **mengambil alih** pendataan berjalan di unitnya (petugas semula tetap menyunting draf, mendapat pemberitahuan; tercatat `audit_log`); **Rekap terpadu** `/admin/rekap` (Rekap Harian, Data Pelayanan + Excel, Kinerja Petugas) dari RPC berlingkup dengan satu definisi "dilayani"; `/admin/rekap-fo` redirect ke Rekap; route rekap lama dihapus. **Migrasi `202610290001`, `202610290002` DITULIS, BELUM DITERAPKAN** (setelah `202610280001`, hanya pemilik; daftar periksa di `docs/MIGRATIONS.md`). Rencana dan keputusan pelaksana: `docs/superpowers/plans/2026-10-29-fase-3-koordinator-rekap.md` (termasuk revisi setelah review keamanan: jendela operasional hanya pekerjaan terbuka). RLS baru hanya diuji statis. **Celah yang diketahui (dirapatkan Fase 5/6):** `tiket_antrean` `tiket_staff_select` (tanpa `TO`; hitungan/durasi tiket rekan terbaca), `buku_tamu` (semua FO, semua tanggal), `chat_sesi`/`chat_pesan` (FO lintas Layanan). **Minor (tanpa perubahan):** tahap yang sudah ditutup dari kunjungan yang masih terbuka terlihat semua FO (konteks operasional); `/admin/kunjungan` dan dasbor parsial untuk FO biasa; saran pengunjung lama walk-in hanya kunjungan milik sendiri/terbuka sampai Fase 6.

## Progres Fase 3 (diperbarui 2026-10-14 malam)

Branch `feat/audit-fondasi-fo-eskalasi` sudah di-merge ke `main` lewat PR #10 (merge commit `cbff52a`); deploy produksi Vercel sukses menurut status GitHub. **Semua migrasi Fase 3 (`202610140001`-`0009`, `0011`, `0012`, `0013`; tanpa `0010`) sudah DITERAPKAN ke produksi** (0002-0013 pada 2026-10-14 ±17:52-17:57 WIB, atomik: dry-run lalu COMMIT) dan diverifikasi read-only; ledger produksi diisi (12 baris, verifikasi `docs/analysis/LEDGER-VERIFIKASI-2026-10-14.md`). **Belum terbukti:** pemeriksaan kesehatan dari luar (deployment dilindungi Vercel Authentication; domain `lmh.lampungprov.go.id` tidak ter-resolve dari mesin penguji), tampilan di browser, konkurensi sejati, kueri rekap FO pada PostgREST sungguhan, `session_id` JWT stabil setelah refresh. Flag `sesi_tunggal_aktif` masih `false`; staf belum login ulang. Rincian migrasi, urutan terapan, dan rollback: `docs/MIGRATIONS.md`, `docs/analysis/DB-CHANGES.md`; prosedur dan sisa langkah: `docs/RUNBOOK_FO_ESKALASI.md` (§12); keputusan: `docs/DECISION_LOG.md` (bagian Fase 3).

| Pekerjaan | Kode | Migrasi | Status |
|---|---|---|---|
| Audit fondasi: upgrade `next`/`sharp`, gerbang lokal `audit:check`/`deps:check`, manifest + penjaga migrasi, verifikasi dan pengisian ledger | Masuk `main` (PR #10) | - | Selesai (ledger terisi di produksi 2026-10-13; 0001-0013 dicatat 2026-10-14 malam) |
| Mutasi Supabase tercek (helper `mutate.ts`, aturan lint `lmh/mutasi-tercek`), error publik, consent memblokir | Masuk `main` (PR #10) | - | Kode selesai; deploy produksi sukses menurut status GitHub; uji di browser belum terbukti |
| FAQ umum untuk FO + `faq_petugas_all` hanya petugas | Masuk `main` | `202610130001`, `202610130002` | DITERAPKAN ke produksi 2026-10-13 |
| Sesi tunggal staf (daftar saat login, heartbeat, idle 2 jam, logout tutup) | Masuk `main` (klien A2) | `202610140001` | Migrasi DITERAPKAN (2026-10-13); klien ter-deploy; flag `sesi_tunggal_aktif` masih false; `session_id` JWT belum terbukti |
| Kepemilikan tiket atomik (`layanan_mulai`/`layanan_selesai`, ambil alih Admin) | Masuk `main` (klien A3) | `202610140002` | DITERAPKAN 2026-10-14 malam; uji perilaku ROLLBACK 84 lolos |
| Alur FO -> eskalasi (kotak masuk, penanganan, daftar walk-in, scan QR via RPC, topik, prefiks antrean 2 huruf) | Masuk `main` (klien Tahap B) | `202610140003`, `0004`, `0005` | DITERAPKAN 2026-10-14 malam; uji perilaku ROLLBACK gabungan 150 lolos |
| Nama pengunjung terkunci + pernyataan kebenaran (C2) | Masuk `main` | `202610140006` | DITERAPKAN 2026-10-14 malam; hanya prasyarat uji + test statis |
| WP-24: akhiri dual-write `visit`, tutup otomatis tahap tertinggal, retensi PII | Masuk `main`; pembaca `visit` di klien sudah dipindah | `202610140007`, `0008` | DITERAPKAN 2026-10-14 malam; `visit` jadi arsip (`trg_visit_arsip` aktif, trigger tulis lama nonaktif); uji perilaku ROLLBACK 101 lolos |
| Live chat sebagai layanan online tercatat (Tahap C) | Masuk `main` | `202610140009` | DITERAPKAN 2026-10-14 malam; uji perilaku ROLLBACK 106 lolos |
| Pendataan Pelayanan semua field wajib (C3) | Masuk `main` | `202610140011` | DITERAPKAN 2026-10-14 malam; hanya prasyarat uji + test statis |
| Perbaikan temuan review (form wajib per layanan, hari tanpa pelayanan, penjaga urutan rollback, job `chat_tutup_otomatis`) | Masuk `main` | `202610140012` | DITERAPKAN 2026-10-14 malam; uji perilaku ROLLBACK 61 lolos (`--akhir-hari`) |
| Keterbukaan data antar Front Office (semua FO membaca semua `penanganan`; nama FO di rekap) | Masuk `main` | `202610140013` | DITERAPKAN 2026-10-14 malam; uji perilaku ROLLBACK 26 lolos; kueri rekap FO pada PostgREST sungguhan belum terbukti |
| Rekap harian Front Office + performa pelayanan + tab Rekap Petugas Layanan (Tahap D) | Masuk `main` | tanpa migrasi | Kode ter-deploy; uji di browser belum terbukti |
| Layar TV tahan gangguan jaringan (T4) | Masuk `main` | - | Kode ter-deploy; uji di browser belum terbukti |
| Check-in mandiri dihapus (`/checkin` halaman informasi; `/api/checkin` dihapus) | Masuk `main` | - | Kode ter-deploy |
| Tahap E: survei terpadu (SKM + anti korupsi + rating petugas + pengaduan) | - | - | **BELUM DIMULAI** (spec terpisah diperlukan) |

Catatan: nomor `202610140010` tidak dipakai. Angka uji di dokumen lain bersifat per-paket pada tanggal masing-masing. Pelacak audit lokal: `docs/audit/AUDIT-2026-10-12-TRACKER.md` (gitignored).

---

## Status Implementasi

Work package WP-01 s.d. WP-32 selesai dan diterapkan ke produksi (WP-24 diterapkan 2026-10-14 malam sebagai migrasi `202610140007`/`0008`; lihat tabel).

| WP | Deskripsi | Status |
|---|---|---|
| WP-01 | Perbaikan zona waktu Asia/Jakarta | ✅ |
| WP-02 | Observability: error tracking + alerting | ✅ |
| WP-03 | Watermark dokumen IPRO identitas | ✅ |
| WP-04 | Pipeline embedding FAQ | ✅ |
| WP-05 | Penomoran antrean atomik | ✅ |
| WP-06 | Kolom aktif/nonaktif petugas | ✅ |
| WP-07 | Pembekuan jadwal harian | ✅ |
| WP-08 | Response rate SKM | ✅ |
| WP-09 | Tes RLS berbasis perilaku | ✅ |
| WP-10 | Tegakkan CSP | ✅ |
| WP-11 | Prosedur cadangan manual FO | ✅ |
| WP-12 | Kanal pengaduan dua jalur | ✅ |
| WP-13 | Standar Pelayanan & Maklumat | ✅ |
| WP-14 | Klausul penafian matchmaking | ✅ |
| WP-15 | Peran `front_office` | ✅ |
| WP-16 | Jadwal standby + pemblokir pendaftaran | ✅ |
| WP-17 | Absensi sebagai gerbang antrean | ✅ |
| WP-18 | Notifikasi petugas + eskalasi | ✅ |
| WP-19 | FO nonaktifkan akun + ganti PIC | ✅ |
| WP-20 | Struktur `kunjungan` + `tiket_antrean` | ✅ |
| WP-21 | Backfill + dual write trigger | ✅ diterapkan 13:17 WIB |
| WP-22 | Pindah pembacaan ke kunjungan/tiket | ✅ |
| WP-23 | Akhir hari + panggil ulang | ✅ |
| WP-24 | Hentikan penulisan ke `visit` | ✅ Diterapkan 2026-10-14 malam sebagai migrasi `202610140007`/`0008` (keputusan CEO G.1 Opsi A, 2026-10-13); uji perilaku ROLLBACK 101 lolos (lihat Progres Fase 3) |
| WP-25 | Chat persisten schema | ✅ |
| WP-26 | CMS registry + konten_versi | ✅ |
| WP-27 | Bot RAG: dokumen_peraturan + match_dokumen | ✅ |
| WP-28 | Kualitas RAG (schema siap, code ready) | ✅ |
| WP-29 | Layar antrean TV bertoken | ✅ |
| WP-30 | Rekap harian per layanan | ✅ |
| WP-31 | Verifikasi UMKM 3 lapis + expiry | ✅ |
| WP-32 | Peta potensi + jejak investasi | ✅ |

---

## Database Produksi

**URL:** `krxzbputwaqkvmjflram.supabase.co`

**Migrations applied:** 24 file (202607300014 s.d. 202607300024)

**Tabel WP-21+:**
- `kunjungan`, `tiket_antrean`, `buku_tamu`, `wp21_backfill_ledger`
- `dokumen_peraturan`, `dokumen_potongan`
- `rekap_harian_layanan`, `laporan_snapshot`
- `jejak_minat_investasi`, `layar_token`
- `konten_versi`, `umkm_verifikasi_jejak`

**Halaman utama:**
- `/admin` — Dashboard (WP-22 reads kunjungan/tiket)
- `/admin/antrian` — Antrian (reads tiket_antrean, writes visit)
- `/admin/kunjungan` — Log kunjungan
- `/admin/rekap` — Rekap harian + CSV export
- `/admin/dokumen` — Upload dokumen RAG
- `/admin/layar` — Kelola token layar TV
- `/layar/[token]` — TV display realtime
- `/peta-potensi` — Peta investasi (wajib login)

---

## Dokumen Referensi

| Dokumen | Isi |
|---|---|
| `docs/analysis/DB-CHANGES.md` | Log semua perubahan DB produksi |
| `docs/analysis/06-MIGRATION-PLAN.md` | Rencana migrasi + rollback |
| `docs/analysis/03-DATA-MODEL.md` | DDL referensi tabel |
| `docs/analysis/04-RBAC-MATRIX.md` | Matriks hak akses per peran |
| `docs/DECISION_LOG.md` | Log keputusan teknis |
| `docs/DEPLOY_RUNBOOK.md` | Prosedur deploy |
| `docs/BACKUP_RESTORE.md` | Prosedur backup/restore |
| `docs/CADANGAN_MANUAL_FO.md` | Prosedur cadangan manual FO |
| `docs/ENVIRONMENT_VARIABLES.md` | Daftar env vars |

---

## Test & CI

```
npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts
```
**Result:** 11/11 pass ✓

**Selftest produksi:**
```
node scripts/selftest-wp21.mjs
```
**Result:** PASS (terakhir 13:47 WIB, 30 Jul 2026)