# LMH — Status Proyek (2026-07-30)

Lampung Maju Hub — Sistem Pelayanan Digital DPMPTSP Provinsi Lampung.

---

## Status Implementasi

Semua work package WP-01 s.d. WP-32 **selesai** dan diterapkan ke produksi.

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
| WP-24 | Hentikan penulisan ke `visit` | ⏸ **DIBLOKIR** ≥2 minggu WP-22 stabil (~13 Ags 2026) |
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