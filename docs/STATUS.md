# LMH — Status Proyek (2026-07-30)

Lampung Maju Hub — Sistem Pelayanan Digital DPMPTSP Provinsi Lampung.

> **Catatan 2026-10-13: dokumen ini tertinggal dari 30 Juli 2026.** Tabel WP dan daftar "Migrations applied: 24 file" di bawah belum mencakup migrasi Agustus–Oktober 2026 (`202608…` s.d. `202610…`, termasuk RBAC Tahap 0/1). Fakta yang sudah diverifikasi read-only pada 2026-10-13: ledger migrasi produksi (`supabase_migrations.schema_migrations`) berisi 13 entri dan berhenti di `202607280005`, sedangkan repo memuat 57 file; dari 44 file yang tidak tercatat, 39 terbukti terpasang di produksi, 1 (`202609020001`) tidak terpasang, dan 4 tidak dapat ditentukan. Sumber terbaru: `docs/analysis/DB-CHANGES.md` (bagian "Inventaris ledger 2026-10-13"), `docs/analysis/LEDGER-VERIFIKASI-2026-10-13.md`, `docs/MIGRATIONS.md`, `docs/DECISION_LOG.md`, `docs/RUNBOOK_RBAC_TAHAP0.md`, `docs/audit/AUDIT-2026-10-12-TRACKER.md`, `docs/superpowers/{specs,plans}`, dan `.superpowers/sdd/progress.md`.


## Progres Fase 3 (diperbarui 2026-10-14)

Branch lokal `feat/audit-fondasi-fo-eskalasi` (belum di-push). **Penting: hampir semua pekerjaan di bawah BELUM diterapkan ke produksi dan BELUM di-deploy.** Hanya migrasi `202610140001` (sesi staf) yang sudah di produksi (2026-10-13, flag `sesi_tunggal_aktif` = false). Rincian migrasi, urutan terapan, dan rollback: `docs/MIGRATIONS.md`, `docs/analysis/DB-CHANGES.md`; prosedur cutover: `docs/RUNBOOK_FO_ESKALASI.md`; keputusan: `docs/DECISION_LOG.md` (bagian Fase 3).

| Pekerjaan | Kode | Migrasi | Status |
|---|---|---|---|
| Audit fondasi: upgrade `next`/`sharp`, gerbang lokal `audit:check`/`deps:check`, manifest + penjaga migrasi, verifikasi dan pengisian ledger (13 -> 54 entri) | Commit lokal | - | Selesai (ledger terisi di produksi 2026-10-13) |
| Mutasi Supabase tercek (helper `mutate.ts`, aturan lint `lmh/mutasi-tercek`), error publik, consent memblokir | Commit lokal | - | Kode selesai; belum di-deploy |
| FAQ umum untuk FO + `faq_petugas_all` hanya petugas | Commit lokal | `202610130001`, `202610130002` | DITERAPKAN ke produksi 2026-10-13; UI belum di-deploy |
| Sesi tunggal staf (daftar saat login, heartbeat, idle 2 jam, logout tutup) | Commit lokal (klien A2) | `202610140001` | Migrasi DITERAPKAN; klien belum di-deploy; flag `sesi_tunggal_aktif` masih false |
| Kepemilikan tiket atomik (`layanan_mulai`/`layanan_selesai`, ambil alih Admin) | Commit lokal (klien A3) | `202610140002` | DITULIS, BELUM DITERAPKAN |
| Alur FO -> eskalasi (kotak masuk, penanganan, daftar walk-in, scan QR via RPC, topik, prefiks antrean 2 huruf) | Sebagian commit; klien Tahap B di working tree (belum di-commit) | `202610140003`, `0004`, `0005` | DITULIS, BELUM DITERAPKAN |
| Nama pengunjung terkunci + pernyataan kebenaran (C2) | Commit lokal | `202610140006` | DITULIS, BELUM DITERAPKAN |
| WP-24: akhiri dual-write `visit`, tutup otomatis tahap tertinggal, retensi PII | SQL + test kontrak di working tree; pembaca `visit` di klien sudah dipindah | `202610140007`, `0008` | DITULIS, BELUM DITERAPKAN (uji perilaku `scripts/test-wp24.mjs` belum dijalankan) |
| Live chat sebagai layanan online tercatat (Tahap C) | Working tree (belum di-commit) | `202610140009` | DITULIS, BELUM DITERAPKAN (uji perilaku 99 lolos pada transaksi ROLLBACK, 2026-10-14) |
| Pendataan Pelayanan semua field wajib (C3) | Working tree | `202610140011` | DITULIS, BELUM DITERAPKAN |
| Rekap harian Front Office + performa pelayanan + tab Rekap Petugas Layanan (Tahap D) | Working tree (belum di-commit) | tanpa migrasi | Kode ditulis; belum di-deploy |
| Layar TV tahan gangguan jaringan (T4) | Commit lokal | - | Kode selesai; belum di-deploy |
| Check-in mandiri dihapus (`/checkin` halaman informasi; `/api/checkin` dihapus) | Working tree | - | Belum di-deploy |
| Tahap E: survei terpadu (SKM + anti korupsi + rating petugas + pengaduan) | - | - | **BELUM DIMULAI** (spec terpisah diperlukan) |

Catatan: nomor `202610140010` tidak dipakai; `202610140012` sedang disiapkan terpisah dan belum tercatat di sini. Gerbang penuh (`verify:baseline`) untuk seluruh working tree harus dijalankan ulang sebelum commit/cutover; angka uji di dokumen lain bersifat per-paket pada tanggal masing-masing. Pelacak audit lokal: `docs/audit/AUDIT-2026-10-12-TRACKER.md` (gitignored).

---

## Status Implementasi

Work package WP-01 s.d. WP-32 selesai dan diterapkan ke produksi, **kecuali WP-24** (ditulis, belum diterapkan; lihat tabel).

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
| WP-24 | Hentikan penulisan ke `visit` | ✍ Ditulis sebagai migrasi `202610140007`/`0008` (keputusan CEO G.1 Opsi A, 2026-10-13); **BELUM DITERAPKAN** (lihat Progres Fase 3) |
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