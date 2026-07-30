# 06 — RENCANA MIGRASI (FASE D)

> Urutan migrasi basis data per work package, beserta backfill dan **rencana pengembalian (rollback) teruji**.
> Dibuat untuk memenuhi **Bagian 8.4**. Mengacu DDL di `03-DATA-MODEL.md` dan WP di `05-IMPLEMENTATION-PLAN.md`.
>
> **Aturan:** (1) semua migrasi **aditif** — tidak ada `DROP` kolom/tabel/enum; (2) penambahan nilai CHECK/enum memakai `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` dengan **himpunan nilai yang lebih luas** (aman, tidak destruktif); (3) penamaan `2026MMDDNNNN_nama` (lanjutan dari `202607280005`); (4) migrasi yang menyentuh data live diterapkan **di luar jam layanan** (OPS-03); (5) setiap migrasi menyertakan **cara mengembalikan**.

---

## Tabel ringkasan urutan migrasi

| # | File migrasi (placeholder tanggal) | WP | Menyentuh live | Aditif | Jendela |
|---|---|---|---|---|---|
| M1 | `2026MMDD0001_petugas_aktif.sql` | WP-06 | Ya | ✓ | kapan saja |
| M2 | `2026MMDD0002_antrean_counter.sql` | WP-05 | Ya | ✓ | luar jam |
| M3 | `2026MMDD0003_faq_reembed.sql` | WP-04 | Ya | ✓ | luar jam |
| M4 | `2026MMDD0004_jadwal_harian_beku.sql` | WP-07 | Ya | ✓ | luar jam |
| M5 | `2026MMDD0005_skm_response_rate.sql` | WP-08 | Ya | ✓ | kapan saja |
| M6 | `2026MMDD0006_hari_libur.sql` | WP-13 | Ya | ✓ | kapan saja |
| M7 | `2026MMDD0007_standar_pelayanan.sql` | WP-13 | Ya | ✓ | kapan saja |
| M8 | `2026MMDD0008_pengaduan.sql` | WP-12 | Ya | ✓ | luar jam |
| M9 | `2026MMDD0009_role_front_office.sql` | WP-15 | Ya | ✓ (nilai lebih luas) | luar jam |
| M10 | `2026MMDD0010_jadwal_standby.sql` | WP-16 | Ya | ✓ | luar jam |
| M11 | `2026MMDD0011_absensi_gerbang.sql` | WP-17 | Ya | ✓ (nilai lebih luas) | luar jam |
| M12 | `2026MMDD0012_layanan_kontak.sql` | WP-18 | Ya | ✓ | luar jam |
| M13 | `2026MMDD0013_layanan_struktur.sql` | WP-20 | Ya | ✓ | luar jam |
| M14 | `2026MMDD0014_kunjungan_tiket.sql` | WP-20 | Ya | ✓ | luar jam |
| M15 | `2026MMDD0015_buku_tamu.sql` | WP-21 | Ya | ✓ | luar jam |
| M16 | `2026MMDD0016_backfill_kunjungan.sql` | WP-21 | Ya (backfill) | ✓ | luar jam |
| M17 | `2026MMDD0017_chat_persisten.sql` | WP-25 | Ya | ✓ (nilai lebih luas) | luar jam |
| M18 | `2026MMDD0018_cms_registry.sql` | WP-26 | Ya | ✓ | kapan saja |
| M19 | `2026MMDD0019_dokumen_rag.sql` | WP-27 | Ya | ✓ | luar jam |
| M20 | `2026MMDD0020_layar.sql` | WP-29 | Ya | ✓ | kapan saja |
| M21 | `2026MMDD0021_rekap.sql` | WP-30 | Ya | ✓ | luar jam |
| M22 | `2026MMDD0022_umkm_verifikasi.sql` | WP-31 | Ya | ✓ (nilai lebih luas) | luar jam |
| M23 | `2026MMDD0023_jejak_investasi.sql` | WP-32 | Ya | ✓ | kapan saja |

---

## Detail per migrasi

### M1 — `petugas_aktif` (WP-06 / RBA-06)
**DDL:** 03 §A.2 — `petugas` + `aktif`, `nonaktif_sejak`, `nonaktif_oleh`, `nonaktif_alasan`.
**Backfill:** `UPDATE petugas SET aktif=true WHERE aktif IS NULL;` (default sudah true).
**Rollback:** kolom aditif → abaikan. (Tidak ada data yang rusak.)

### M2 — `antrean_counter` (WP-05 / QUE-06, SVC-04/05)
**DDL:** 03 §B.3 + §A.1 — tabel `antrean_counter`, fungsi `terbit_nomor_antrean()`, kolom `layanan.prefiks_antrean`, `layanan.nomor_loket`.
**Backfill:** isi `prefiks_antrean` (A..K) & `nomor_loket` untuk 11 layanan (bagian dari seed SVC-01 di M13).
**Rollback:** tabel/fungsi/kolom baru → abaikan.
**Uji wajib sebelum tayang:** SK-06 — dua panggilan `terbit_nomor_antrean` bersamaan → nomor berbeda (I-01).

### M3 — `faq_reembed` (WP-04 / BOT-11, TB-01)
**DDL:** 03 §A.7 — kolom `perlu_embed_ulang`, `embedding_updated_at`, `diubah_oleh`; trigger set `perlu_embed_ulang=true` saat `pertanyaan`/`jawaban` berubah.
**Backfill:** `UPDATE faq_knowledge_base SET perlu_embed_ulang=true WHERE embedding IS NULL;`
**Rollback:** kolom/trigger aditif → abaikan / drop trigger (aman).
**Catatan:** samakan dimensi model embedding dengan kolom (768) **sebelum** menjalankan re-embed (TB-01).

### M4 — `jadwal_harian_beku` (WP-07 / SCH-05)
**DDL:** 03 §B.7 — tabel `jadwal_harian_beku` + fungsi `bekukan_jadwal(tanggal)` + pg_cron malam.
**Backfill:** beku untuk N hari ke depan dari jadwal aktif.
**Rollback:** matikan cron; tabel aditif → abaikan. **Baris beku tidak dihapus** (I-08).
**Uji:** I-08 — `UPDATE`/`DELETE` baris beku → ditolak.

### M5 — `skm_response_rate` (WP-08 / SRV-03)
**DDL:** tabel/agregat pencatat `dilayani` vs `mengisi` per layanan/tanggal.
**Rollback:** aditif → abaikan.

### M6 — `hari_libur` (WP-13 / CMP-03, OQ-05)
**DDL:** 03 §B.18. **Backfill:** daftar hari libur nasional (input manual, OQ-05).
**Rollback:** aditif → abaikan.

### M7 — `standar_pelayanan` (WP-13 / CMP-09)
**DDL:** 03 §B.11. **Rollback:** aditif → abaikan.

### M8 — `pengaduan` (WP-12 / CMP-01..08)
**DDL:** 03 §B.10 — `pengaduan`, `pengaduan_riwayat` + fungsi SLA hari kerja (pakai `hari_libur`) + generator nomor tiket acak + bucket `pengaduan-bukti` (03 §C).
**Rollback:** tabel aditif → abaikan; nonaktifkan rute.
**Uji wajib:** SK-23 (RLS integritas: petugas & FO **tidak bisa** membaca), SK-24 (eskalasi SLA), SK-25 (lacak + rate limit).

### M9 — `role_front_office` (WP-15 / RBA-02)
**DDL:** 03 §A.2 — `DROP CONSTRAINT IF EXISTS petugas_role_check; ADD CONSTRAINT ... CHECK (role IN ('petugas','admin','front_office'))`. Perbarui RLS yang menyebut daftar role agar memasukkan `front_office`.
**Rollback:** nilai enum lebih luas = aditif & aman; untuk mengembalikan perilaku, cukup pastikan tidak ada baris `role='front_office'` lalu persempit kembali CHECK (jarang perlu).
**Uji:** OPS-08 — semua pemetaan `role` di TS (badge, nav, filter) menangani `front_office`.

### M10 — `jadwal_standby` (WP-16 / SCH-01/04/11)
**DDL:** 03 §B.6 — `jadwal_standby`, `jadwal_pengecualian` + fungsi `jadwal_berikutnya()`.
**Backfill:** dari `layanan_jadwal.hari_kerja[]` → baris per hari; `layanan_libur` → `jadwal_pengecualian`. **Isi jadwal P4 nyata** (OQ-04).
**Rollback:** tabel aditif; validasi kembali ke `layanan_jadwal`.
**Uji:** SK-05, unit test `jadwal_berikutnya`.

### M11 — `absensi_gerbang` (WP-17 / SCH-02/08/09/10, QUE-08)
**DDL:** 03 §A.4 — kolom `absensi_petugas.sumber/dicatat_oleh`, status + `alpa`; 03 §B.8 — tabel `layanan_hari`; 03 §A.3 — enum visit + `tidak_terlayani`; fungsi `catat_absensi()` (jam server); pg_cron alpa + absen keluar otomatis.
**Rollback:** kolom/status aditif → abaikan; matikan cron.
**Uji:** SK-04, SK-09; I-05, I-09; OPS-08 (pemetaan status `tidak_terlayani` di TS).

### M12 — `layanan_kontak` (WP-18 / NOT-01, SVC-06)
**DDL:** 03 §B.5. **Backfill:** isi email PIC/atasan per layanan + kontak instansi (input).
**Rollback:** aditif → abaikan.

### M13 — `layanan_struktur` (WP-20 / SVC-01/02/03, QUE-16)
**DDL:** 03 §A.1 — kolom `penyerta`, `status_tampilan`, bendera kemampuan, `batas_ambil_nomor_menit`, `kuota_harian`.
**Backfill (seed SVC-01):** 11 layanan sesuai Bagian 2.1 — tambah **BPN** (`coming_soon`), koreksi "BALMON"→"Balai Monitor SFR", set `penyerta`+bendera; Matchmaking & Investment Gallery → `penyerta='dpmptsp'`, `punya_antrean=true`.
**Rollback:** kolom aditif → abaikan; perubahan data seed dikembalikan manual bila perlu.

### M14 — `kunjungan_tiket` (WP-20 / QUE-01, GST-01)
**DDL:** 03 §B.1/B.2 — tabel `kunjungan`, `tiket_antrean` + RLS + `UNIQUE(layanan_id,tanggal,nomor)`.
**Rollback:** tabel aditif → abaikan.

### M15 — `buku_tamu` (WP-21 / GST-01..04)
**File:** `202607300014_buku_tamu.sql`
**DDL:** 03 §B.4 — tabel `buku_tamu` + RLS (FO & Admin); FK `legacy_visit_id UNIQUE REFERENCES visit(id) ON DELETE RESTRICT`.
**Rollback:** aditif → abaikan (tidak ada data yang ditulis di langkah ini; trigger belum aktif).

### M16 — `backfill_kunjungan_dual_write` (WP-21 / OPS-02, QUE-04, GST-03)
**File:** `202607300015_backfill_kunjungan_dual_write.sql`
**Isi:**
1. Kolom `legacy_visit_id` pada `kunjungan` dan `tiket_antrean` (UNIQUE, nullable).
2. Tabel `wp21_backfill_ledger` — satu baris per sumber `visit`; RLS admin-read saja.
3. Backfill:
   - Setiap `visit.tujuan='loket'` → satu `kunjungan`.
   - Visit eligible (`status <> 'terjadwal'` AND origin cocok: `asal='walk_in'` OR `asal='reservasi' AND status<>'terjadwal'`) → satu `tiket_antrean`.
   - **Reservasi terjadwal tidak mendapat tiket** — tiket diterbitkan saat scan (QUE-04).
   - Setiap `visit.tujuan='bertemu_seseorang' AND waktu_scan IS NOT NULL` → satu `buku_tamu` (GST-03: **hanya kedatangan fisik yang terscan**).
4. Repair counter: `antrean_counter` di-upsert ke `MAX(nomor)` per layanan/tanggal.
5. Isi ledger: setiap `visit` sumber dicatat dengan FK ke `kunjungan`/`tiket`/`buku_tamu`.
6. Trigger `trg_visit_dual_write` (`sync_visit_dual_write()`, SECURITY DEFINER): dual write atomik untuk setiap INSERT/UPDATE `visit`. **Tiket diterbitkan saat scan** (`terjadwal→menunggu` + `waktu_scan IS NOT NULL`), bukan saat reservasi dibuat (QUE-04). Buku tamu hanya saat scan pertama meeting visit (GST-03).
7. `REVOKE CREATE ON SCHEMA public FROM PUBLIC`.

**Verifikasi wajib sebelum lanjut ke WP-22:**
```sql
-- Semua loket terpetakan
SELECT count(*) FROM visit WHERE tujuan='loket'
  AND NOT EXISTS (SELECT 1 FROM kunjungan WHERE legacy_visit_id = visit.id);
-- Harus 0

-- Tidak ada kunjungan yatim
SELECT count(*) FROM kunjungan k
  LEFT JOIN visit v ON v.id = k.legacy_visit_id
  WHERE k.legacy_visit_id IS NOT NULL AND v.id IS NULL;
-- Harus 0

-- Tidak ada ledger yatim
SELECT count(*) FROM wp21_backfill_ledger;
-- Harus = (SELECT count(*) FROM visit WHERE tujuan IN ('loket','bertemu_seseorang'))
-- (semua visit loket + hanya meeting yang terscan)

-- Counter tidak tertinggal
SELECT count(*) FROM (
  SELECT t.layanan_id, t.tanggal, max(t.nomor) AS ticket_max, max(c.nomor_terakhir) AS counter_max
  FROM tiket_antrean t LEFT JOIN antrean_counter c USING (layanan_id, tanggal)
  GROUP BY t.layanan_id, t.tanggal
) x WHERE counter_max IS NULL OR counter_max < ticket_max;
-- Harus 0
```

**Rollback:** `TRUNCATE kunjungan, tiket_antrean, buku_tamu, wp21_backfill_ledger CASCADE` (data sumber di `visit` tidak disentuh; ledger membuktikan setiap baris bisa dilacak). Kemudian `DROP TRIGGER trg_visit_dual_write ON visit; DROP FUNCTION sync_visit_dual_write();`.

**Catatan:** migrasi dikunci dengan `LOCK TABLE visit, kunjungan, tiket_antrean, buku_tamu, wp21_backfill_ledger IN SHARE ROW EXCLUSIVE MODE` sehingga penulisan bersamaan tidak bisa terjadi antara snapshot backfill dan aktivasi trigger.

### M17 — `chat_persisten` (WP-25 / CHT-01, BOT-06)
**DDL:** ubah makna `chat_sesi.status` (nilai lebih luas / kolom penanda utas); kolom `chat_pesan.jenis_jawaban`.
**Rollback:** nilai lebih luas aman; kembalikan makna status lama di kode.
**Uji:** SK-11, SK-12.

### M18 — `cms_registry` (WP-26 / CMS-01..05)
**DDL:** 03 §A.6 — kolom `site_settings` + 03 §B.12 — `konten_versi`.
**Backfill:** tandai kunci terlarang (CMS-04) `boleh_diubah_dashboard=false`.
**Rollback:** aditif → abaikan.
**Uji:** SK-28, SK-29, I-19.

### M19 — `dokumen_rag` (WP-27 / BOT-01..05)
**DDL:** 03 §B.9 — `dokumen_peraturan`, `dokumen_potongan` + fungsi `match_dokumen()` (filter `status='berlaku'`, I-16) + index embedding.
**Rollback:** aditif → abaikan.
**Uji:** SK-13..16.

### M20 — `layar` (WP-29 / DSP-06/07)
**DDL:** 03 §B.15 — `layar_token` + **view khusus layar tanpa kolom nama** (I-14).
**Rollback:** aditif → abaikan; kembalikan layar publik lama.
**Uji:** SK-22; payload tidak memuat nama.

### M21 — `rekap` (WP-30 / RPT-01..06)
**DDL:** 03 §B.13/B.14 — `rekap_harian_layanan`, `laporan_snapshot` + fungsi rollup + pg_cron.
**Rollback:** aditif → abaikan.
**Uji:** SK-30, I-20, I-24.

### M22 — `umkm_verifikasi` (WP-31 / MMK-03/04/07)
**DDL:** 03 §A.5 — kolom `listing_umkm` (status + `perlu_perbaikan`, legalitas, `berlaku_sampai`, `kontak_terverifikasi`, `catatan_review`) + 03 §B.16 — `umkm_verifikasi_jejak` + bucket `umkm-legalitas` + pg_cron expired.
**Rollback:** kolom/nilai aditif → abaikan; matikan cron expired.
**Uji:** SK-17, SK-18, SK-19; I-11, I-12, I-13.

### M23 — `jejak_investasi` (WP-32 / INV-02)
**DDL:** 03 §B.17 — `jejak_minat_investasi`.
**Rollback:** aditif → abaikan.

---

## Protokol keselamatan migrasi (berlaku untuk semua)
1. **Sebelum migrasi yang menyentuh live:** pastikan WP-02 (observability) aktif & WP-11 (cadangan manual FO) tersedia (OPS-05/06).
2. **Terapkan di luar jam layanan**, hindari hari dengan banyak jadwal P4 (OPS-03).
3. **Backup/snapshot** basis data sebelum migrasi backfill (M16) — lihat `docs/BACKUP_RESTORE.md`.
4. **Jalankan uji terkait** (SK/I) segera setelah migrasi di staging sebelum produksi.
5. **Verifikasi pasca-tayang** sesuai kolom "Cara memverifikasi" di tiap WP (05).
6. **JANGAN pernah `DROP`** kolom/tabel/enum tanpa persetujuan tertulis (aturan 0.2 #4).
