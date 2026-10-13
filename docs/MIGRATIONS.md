# Database Migrations

## Baseline Fresh-Only

Direktori `supabase/migrations/` berisi lima migrasi final-state untuk proyek yang belum pernah dideploy:

1. `202607140001_extensions_and_preflight.sql`: ekstensi dan pemeriksaan prasyarat.
2. `202607140002_core_schema.sql`: layanan, akun individual, pengunjung, konten, absensi, dan visit spine.
3. `202607140003_feature_schema.sql`: chat, FAQ/AI, UMKM, investasi, rate limit, audit/consent, SKM, dan notifikasi.
4. `202607140004_security_and_automation.sql`: helper, RLS, storage, dan trigger.
5. `202607140005_views_and_jobs.sql`: public projections, estimasi antrean, dan jadwal `pg_cron`.

Baseline ini menggantikan histori pengembangan `001` sampai `038`. Baseline hanya boleh diterapkan ke database kosong. Git history adalah arsip histori SQL; jangan menyalin migrasi lama kembali ke direktori aktif.

## Apply Dengan CLI

Dengan Supabase CLI `2.107.0`, terapkan seluruh baseline dan production seed ke proyek fresh yang sudah ditautkan dengan satu perintah:

```bash
supabase db push --include-all --include-seed
```

Untuk reset database lokal dan menerapkan migrasi beserta `supabase/seed.sql`:

```bash
supabase db reset
```

Flag `--include-all` dan `--include-seed` diverifikasi melalui `supabase db push --help`. Jangan menempel SQL secara manual di Dashboard atau SQL Editor. CLI menjaga urutan, pencatatan versi, dan hasil yang dapat direproduksi.

> Bagian ini hanya untuk proyek KOSONG. Untuk database produksi yang sekarang berjalan JANGAN menjalankan `supabase db push`: ledger produksi belum lengkap, lihat bagian "Ledger migrasi produksi" di bawah.

## Seed Policy

`supabase/seed.sql` hanya berisi sembilan layanan final dan konfigurasi/konten awal yang aman untuk produksi. File ini tidak membuat akun Auth, kredensial, nomor WhatsApp palsu, maupun data demo.

`supabase/seed-demo.sql` bersifat eksplisit untuk development/staging. Jangan jalankan file tersebut di produksi dan jangan pindahkan isinya ke migrasi atau production seed.

## Setelah Deploy Pertama

Setelah baseline pertama kali diterapkan ke environment mana pun, kelima file baseline bersifat immutable. Semua perubahan schema berikutnya wajib dibuat sebagai forward migration baru dengan timestamp lebih besar. Jangan mengedit, mengganti nama, menghapus, atau squash baseline yang sudah diterapkan.

## Gate 1B (pre-deploy baseline hardening)

Sebelum deploy pertama, baseline diedit in-place (bukan forward migration ke-6) untuk:

- `consent_log_insert_own` ownership binding (`subjek_ref = auth.uid()` atau pengunjung milik user).
- `audit_change()` hanya menyimpan metadata allowlist (id/status/role/timestamps/actor), bukan full row JSON.
- `notifikasi`: kolom `claim_token`, `claimed_at`, `available_at`, `idempotency_key`, status `processing`, partial unique index, plus RPC `claim_notifikasi` / `complete_notifikasi` (EXECUTE hanya `service_role`).

## Forward Migrations

Setelah baseline, perubahan schema dicat sebagai forward migration:

6. `202607200001_p0_security_governance.sql`: hardening P0 — policy `visit_insert_walk_in` mengikat `pengunjung_id` ke pemilik akun, trigger guard kolom staf `chat_sesi`, policy insert `listing_umkm` dibatasi `draft`/`pending_review` untuk petugas, audit eskalasi role petugas, anti-backdate `absensi_petugas` via trigger (plus status `ditolak`), dead-letter notifikasi `retry_count >= 5`, retensi `chat_ai_log` 90 hari via pg_cron 03:30, RPC publik `get_queue_position(p_qr_token uuid)`, dan trigger notifikasi baru (balasan chat petugas, status inquiry UMKM, konfirmasi reservasi).
7. `202607210001_walkin_kontak_dan_layanan_perizinan.sql`: kolom `visit.kontak_hp` (opsional, diisi petugas saat registrasi walk-in) dan baris layanan baru `Layanan Perizinan DPMPTSP Provinsi Lampung` (tipe `konsultatif`, idempotent via `ON CONFLICT (nama) DO NOTHING`).
8. `202607240001_pengunjung_no_hp.sql`: kolom `pengunjung.no_hp` (opsional) untuk verifikasi kontak di profile gate.

## Menerapkan forward migration ke database yang SUDAH berjalan: mode ATOMIK

`scripts/apply-migration.mjs` punya dua mode:

| Mode | Perintah | Perilaku |
|---|---|---|
| **Atomik (wajib untuk perubahan RBAC/keamanan)** | `node scripts/apply-migration.mjs <file.sql> --atomic` | Satu koneksi `DIRECT_URL`, satu transaksi `BEGIN ... COMMIT`. Galat apa pun -> `ROLLBACK` + exit non-zero. `lock_timeout` 5s, `statement_timeout` 120s. Meminta konfirmasi `TERAPKAN`; tanpa terminal wajib `--yes` eksplisit. |
| Dry-run | `... --atomic --dry-run` | Menjalankan seluruh file lalu `ROLLBACK` (tidak mengubah apa pun, tanpa prompt). |
| Lama (per-statement) | `node scripts/apply-migration.mjs <file.sql>` | Memecah file dan menjalankan satu per satu lewat RPC `exec_sql`. **Tidak atomik**: galat di tengah meninggalkan setengah-terapan. Hindari untuk migrasi yang mengubah policy/fungsi. |

Aturan berkas migrasi untuk mode atomik: tidak boleh memuat `BEGIN`/`COMMIT`/`END`/`ROLLBACK`/`SAVEPOINT`/`RELEASE` tingkat atas
(skrip menolak; deteksi di `scripts/lib/sql-txn.mjs`, diuji di `supabase/migrations/rbac_tahap0_keamanan.test.ts`). Urutkan pernyataan
sehingga perubahan yang bisa memutus alur pengguna (mis. policy `visit`/`kunjungan`) berada PALING AKHIR.

Runbook lengkap RBAC Tahap 0: `docs/RUNBOOK_RBAC_TAHAP0.md`. Tes perilaku (transaksi + ROLLBACK): `npm run test:rls:tahap0`.
Skrip ini menyentuh DB produksi (terapan nyata butuh izin CEO).

## Migrasi forward yang sudah ditulis tetapi BELUM diterapkan

| Versi | Isi | Status | Rollback |
|---|---|---|---|
| `202610130001_faq_umum.sql` | FAQ umum (tanpa layanan): `faq_knowledge_base.layanan_id` boleh NULL (NULL = FAQ umum); policy baru `faq_fo_umum` (Front Office hanya baris umum); `match_faq_teks` dan `match_faq` ikut mencari baris umum (FAQ layanan diutamakan atas FAQ umum pada skor/jarak setara). Spec: `docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md` §3.3. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-faq-umum-202610130001.sql` (menolak `SET NOT NULL` bila masih ada FAQ umum) |
| `202610130002_faq_petugas_hanya_petugas.sql` | Menutup celah RLS FAQ: `faq_petugas_all` dibuat ulang (nama, `FOR ALL`, `TO authenticated` sama) dengan `USING`/`WITH CHECK` `layanan_id = get_my_layanan_id() AND get_my_role() = 'petugas'`. Sebelumnya policy tidak memeriksa peran, sehingga Front Office yang baris `petugas`-nya punya `layanan_id` masih bisa menulis FAQ layanannya dan (bersama `faq_fo_umum`) memindahkan baris antara FAQ umum dan FAQ layanan. Hanya menyentuh policy itu. **Diterapkan SETELAH `202610130001`.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-faq-petugas-hanya-petugas-202610130002.sql` (memulihkan definisi `202607280003`) |
| `202610140001_sesi_staf.sql` | Sesi tunggal staf (satu akun, tidak boleh login ganda): tabel `sesi_staf` (RLS tanpa policy, klien tanpa akses langsung), pengaturan `sesi_idle_menit` (120) dan `sesi_tunggal_aktif` (**false** sampai cutover), fungsi `sesi_status()`/`sesi_valid()`, RPC `daftarkan_sesi()`/`ping_sesi(boolean)`/`akhiri_sesi()`. Tidak mengubah fungsi/policy/tabel lain; `sesi_valid()` baru dipakai RPC mutasi pada migrasi A3. | **DITERAPKAN ke produksi 2026-10-13** (atas izin CEO; flag `sesi_tunggal_aktif` = false). | `docs/rollback-sesi-staf-202610140001.sql` |
| `202610140002_tiket_kepemilikan.sql` | Kepemilikan tiket layanan (A3, audit T1; aturan CEO "hanya yang memulai boleh menyelesaikan"): RPC `layanan_mulai(uuid)` (guard atomik, `dilayani_oleh` = pemanggil; Admin semua layanan, petugas layanannya, FO ditolak), `layanan_selesai(uuid, text, jsonb)` (hanya pemilik; upsert pendataan dari `finalize_pelayanan` apa adanya), `admin_ambil_alih(uuid, text)` (jalur darurat, alasan wajib, `audit_log`); `finalize_pelayanan` jadi pembungkus; trigger penjaga `trg_guard_visit_transisi_layanan` (UPDATE langsung `visit` ke/dari `dilayani`/`selesai` ditolak `TRANSISI_LEWAT_RPC`); `DROP POLICY tiket_staff_update`; policy draf `pelayanan_*` hanya pemilik (`pemilik_tiket()`); backfill `dilayani_oleh` tiket `dilayani` dari `audit_log`. Semua RPC memanggil `sesi_valid()`. **Diterapkan SETELAH `202610140001` dan klien A2, bersamaan dengan deploy klien A3, di luar jam layanan dan saat tidak ada tiket `dilayani`.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-tiket-kepemilikan-202610140002.sql` (memulihkan `finalize_pelayanan` 202610010001, `tiket_staff_update` 202607290013, policy draf 202610090001) |

Cara menerapkan `202610130001_faq_umum.sql` (menyentuh DB produksi via `.env.local`; hanya setelah konfirmasi CEO). Berkas ini **mengubah policy dan fungsi, jadi WAJIB `--atomic`**: tanpa `--atomic`, `scripts/apply-migration.mjs` menolaknya (lihat komentar skrip itu dan `scripts/lib/sql-txn.mjs`).

```bash
node scripts/apply-migration.mjs supabase/migrations/202610130001_faq_umum.sql --atomic --dry-run   # jalankan lalu ROLLBACK
node scripts/apply-migration.mjs supabase/migrations/202610130001_faq_umum.sql --atomic             # terapkan sungguhan
```

Migrasi ini idempoten dan tidak mengubah baris data. Sebelum fitur FAQ umum dipakai di UI, kode publik/admin yang menyaring `layanan_id` juga perlu disesuaikan (lihat `docs/analysis/DB-CHANGES.md`, entri `202610130001_faq_umum`).

Cara menerapkan `202610130002_faq_petugas_hanya_petugas.sql` (menyentuh DB produksi; hanya setelah konfirmasi CEO). Mengubah policy, jadi WAJIB `--atomic`. Terapkan **sesudah** `202610130001_faq_umum.sql`:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610130002_faq_petugas_hanya_petugas.sql --atomic --dry-run   # jalankan lalu ROLLBACK
node scripts/apply-migration.mjs supabase/migrations/202610130002_faq_petugas_hanya_petugas.sql --atomic             # terapkan sungguhan
```

Cara menerapkan `202610140001_sesi_staf.sql` (menyentuh DB produksi; hanya setelah konfirmasi CEO). Membuat fungsi, jadi WAJIB `--atomic`:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140001_sesi_staf.sql --atomic --dry-run   # jalankan lalu ROLLBACK
node scripts/apply-migration.mjs supabase/migrations/202610140001_sesi_staf.sql --atomic             # terapkan sungguhan
```

> **PERINGATAN FLAG `sesi_tunggal_aktif`.** Nilainya `false` (masa transisi) setelah migrasi diterapkan. Urutan benar: terapkan migrasi ini -> deploy klien sesi tunggal (A2) -> terapkan migrasi RPC mutasi (A3) -> beri waktu staf login ulang -> baru ubah flag ke `true` (oleh Admin, terjadwal). Bila flag `true` sebelum klien A2 ter-deploy, SEMUA staf ditolak RPC mutasi karena tak ada yang mendaftar sesi. Klaim `session_id` di JWT proyek ini belum dibuktikan langsung (hanya dari dokumentasi Supabase); buktikan saat uji A2 dengan membandingkan `session_id` sebelum dan sesudah penyegaran token.

Cara menerapkan `202610140002_tiket_kepemilikan.sql` (menyentuh DB produksi; hanya setelah konfirmasi CEO). Membuat fungsi, trigger, dan policy, jadi WAJIB `--atomic`:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic --dry-run   # jalankan lalu ROLLBACK
node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic             # terapkan sungguhan
```

> **PERINGATAN A3 (kepemilikan tiket).** Urutan: `202610140001_sesi_staf` -> deploy klien A2 -> migrasi ini **bersamaan** dengan deploy halaman antrean baru (A3). Terapkan di luar jam layanan dan saat tidak ada tiket `dilayani` hari itu. Halaman antrean versi lama yang masih terbuka akan menerima `TRANSISI_LEWAT_RPC` saat menekan Mulai/Selesai dan harus dimuat ulang. Trigger penjaga juga menolak UPDATE langsung `visit` dari koneksi pemilik DB: `scripts/selftest-wp21.mjs`, `scripts/test-rbac-tahap0.mjs`, dan `scripts/test-rbac-tahap1.mjs` (bagian lifecycle/finalize dan draf pendataan pada tiket `menunggu`) perlu disesuaikan sebelum dijalankan lagi terhadap DB yang sudah memuat migrasi ini. Uji perilaku khusus A3 (transaksi di-ROLLBACK): `scripts/test-tiket-kepemilikan.mjs`.

> **PERINGATAN URUTAN DEPLOY.** Menu "Kelola FAQ" untuk Front Office sudah dibuka di `src/lib/admin-nav.ts`. Urutan yang benar: `202610130001` -> `202610130002` -> **baru** deploy kode UI FO. Bila kode di-deploy SEBELUM kedua migrasi diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`, karena `202610130001` belum melonggarkannya); bila hanya `202610130002` yang belum, FO ber-layanan masih dapat menulis FAQ layanannya dan memindahkan baris. Migrasi idempoten dan tidak mengubah baris data.

## Ledger migrasi produksi (status 2026-10-13)

**Fakta (diperiksa read-only pada 2026-10-13):**

- `supabase_migrations.schema_migrations` di produksi berisi **13 entri** dan **berhenti di `202607280005`**. Repo memuat **57** file, jadi **44 file (`202607290001` s.d. `202610090005`) tidak tercatat**. Penyebabnya: `scripts/apply-migration.mjs` tidak menulis ke ledger.
- Pembuktian per migrasi (keberadaan objek yang dibuat tiap migrasi di katalog produksi, plus kecocokan isi fungsi): **39 terpasang**, 0 sebagian, **1 tidak ditemukan** (`202609020001_estimasi_hari_libur`: indeks `idx_hari_libur_tanggal` dan policy `hari_libur_staff_write` tidak ada di produksi), **4 tidak dapat ditentukan** (`202608040001`, `202608080001`, `202608310001`: hanya objek bersama yang sudah ditimpa/ditambah migrasi lain; `202608310003`: berkas no-op). Rincian: `docs/analysis/LEDGER-VERIFIKASI-2026-10-13.md` dan `docs/analysis/DB-CHANGES.md` (bagian "Inventaris ledger 2026-10-13").
- Pencatatan retroaktif ke ledger **belum dilakukan dan menunggu konfirmasi CEO**. Skrip `scripts/fill-migration-ledger.mjs` sudah ada: default `--dry-run` (read-only, hanya mencetak), hanya migrasi berstatus `terpasang`, dan baru menulis dengan `--apply --yes`.

**Aturan:**

1. **Jangan `supabase db push` ke produksi sebelum ledger diisi.** Selama 44 file itu tidak tercatat, `db push` menganggapnya pending dan mencoba menerapkannya ulang berurutan; banyak yang tidak idempoten (mis. `CREATE POLICY` tanpa `DROP`). Setelah ledger diisi, kelima migrasi yang bukan `terpasang` tetap pending dan harus diputuskan satu per satu SEBELUM `db push`; khususnya `202609020001`, yang bila dijalankan akan membuat ulang policy `hari_libur_staff_write` yang sengaja di-DROP `202610080002`.
2. **Aturan T11: dilarang mengedit migrasi yang sudah ada** (termasuk "fix diam-diam"). Perbaikan, termasuk insiden produksi, = **migrasi forward baru** + test kontrak + SQL rollback di `docs/`. Bukan skrip ad-hoc ke produksi. Setiap migrasi baru dicatat di `docs/MIGRATIONS.md` dan `docs/analysis/DB-CHANGES.md` di commit yang sama. Dasar: `docs/superpowers/specs/2026-10-13-fondasi-dependensi-migrasi-error-publik-design.md` §4.
3. Selama migrasi baru masih diterapkan lewat `scripts/apply-migration.mjs` (tidak menulis ledger), ledger akan tertinggal lagi; ulangi verifikasi di bawah dan catat hasilnya.

**Menjalankan verifikasi (read-only, aman terhadap produksi):**

```bash
node scripts/verify-migration-ledger.mjs                  # laporan ke stdout + docs/analysis/LEDGER-VERIFIKASI-<tanggal WIB>.md
node scripts/fill-migration-ledger.mjs                    # dry-run pengisi ledger (tidak menulis apa pun)
```

Keduanya membaca `DIRECT_URL` dari `.env.local` (nilainya tidak pernah dicetak), memakai `BEGIN READ ONLY` + SELECT saja, dan berakhir dengan ROLLBACK. Parser penanda ada di `scripts/lib/migration-markers.mjs`; ujinya `src/test/migration-markers.test.ts`. Ujinya ikut `npm test` (ditempatkan di `src/test/` karena `vitest.config.ts` hanya meng-include `src/**` dan `supabase/migrations/**`).
