# LMH — Status Proyek (2026-07-30)

Lampung Maju Hub — Sistem Pelayanan Digital DPMPTSP Provinsi Lampung.

> **Catatan 2026-10-13: dokumen ini tertinggal dari 30 Juli 2026.** Tabel WP dan daftar "Migrations applied: 24 file" di bawah belum mencakup migrasi Agustus–Oktober 2026 (`202608…` s.d. `202610…`, termasuk RBAC Tahap 0/1). Fakta yang sudah diverifikasi read-only pada 2026-10-13: ledger migrasi produksi (`supabase_migrations.schema_migrations`) berisi 13 entri dan berhenti di `202607280005`, sedangkan repo memuat 57 file; dari 44 file yang tidak tercatat, 39 terbukti terpasang di produksi, 1 (`202609020001`) tidak terpasang, dan 4 tidak dapat ditentukan. Sumber terbaru: `docs/analysis/DB-CHANGES.md` (bagian "Inventaris ledger 2026-10-13"), `docs/analysis/LEDGER-VERIFIKASI-2026-10-13.md`, `docs/MIGRATIONS.md`, `docs/DECISION_LOG.md`, `docs/RUNBOOK_RBAC_TAHAP0.md`, `docs/audit/AUDIT-2026-10-12-TRACKER.md`, `docs/superpowers/{specs,plans}`, dan `.superpowers/sdd/progress.md`.


## Progres Survei terpadu "Pesan Perilaku" Fase A (diperbarui 2026-10-27)

Branch `feat/survei-terpadu-a` (belum di-merge, belum di-push): survei SPAK (5 pernyataan) dan SKM (9-11 unsur) dalam satu wizard publik `/survei/<token>` tanpa login, token undangan dibuat otomatis saat kunjungan selesai dan dikirim lewat email/push/QR staf; response rate per unit; Dashboard SKM memuat IKM lewat satu RPC `ringkasan_ikm`, tab SPAK (`ringkasan_spak`) dan unduhan Excel hanya untuk Admin dan FO. **4 migrasi survei DITULIS, BELUM DITERAPKAN** (`survei_undangan`, `survei_jawaban`, `survei_rpc`, `survei_notifikasi`; nomor `202611020001-0004` harus **dinomori ulang** karena bentrok dengan Fase 1 layanan dinamis sebelum digabung). Diuji lewat test statis dan harness PGlite lokal; belum dijalankan di Postgres sungguhan dan belum dicoba di browser. Per-task review dilewati atas permintaan pemilik; review menyeluruh dan gate penuh tersisa. Rincian, sisa pekerjaan, dan keputusan terbuka: `docs/SERAH-TERIMA-SURVEI.md`, `docs/superpowers/plans/2026-10-26-survei-terpadu-fase-a-ledger.md`.

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