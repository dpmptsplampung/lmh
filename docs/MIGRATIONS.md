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

## Migrasi forward (status penerapan produksi)

> **Status per 2026-10-14 malam:** semua migrasi di tabel ini sudah DITERAPKAN ke produksi (0002-0009, 0011, 0012, 0013 pada ±17:52-17:57 WIB, tanpa 0010 karena tidak ada berkasnya). Terapan atomik (`apply-migration --atomic`, dry-run lalu COMMIT) dan diverifikasi read-only. Ledger `supabase_migrations.schema_migrations` sudah diisi (12 baris, `scripts/fill-migration-ledger.mjs --apply --yes`; verifikasi `docs/analysis/LEDGER-VERIFIKASI-2026-10-14.md`). Perintah "Cara menerapkan" di bawah dipertahankan sebagai catatan prosedur, bukan langkah yang masih tertunda. Yang BELUM TERBUKTI: tampilan di browser, konkurensi sejati, kueri rekap FO pada PostgREST sungguhan, `session_id` JWT stabil setelah refresh; flag `sesi_tunggal_aktif` masih `false`.

| Versi | Isi | Status | Rollback |
|---|---|---|---|
| `202610130001_faq_umum.sql` | FAQ umum (tanpa layanan): `faq_knowledge_base.layanan_id` boleh NULL (NULL = FAQ umum); policy baru `faq_fo_umum` (Front Office hanya baris umum); `match_faq_teks` dan `match_faq` ikut mencari baris umum (FAQ layanan diutamakan atas FAQ umum pada skor/jarak setara). Spec: `docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md` §3.3. | **DITERAPKAN ke produksi** (tercatat ledger; terverifikasi `terpasang` pada `docs/analysis/LEDGER-VERIFIKASI-2026-10-14.md`). | `docs/rollback-faq-umum-202610130001.sql` (menolak `SET NOT NULL` bila masih ada FAQ umum) |
| `202610130002_faq_petugas_hanya_petugas.sql` | Menutup celah RLS FAQ: `faq_petugas_all` dibuat ulang (nama, `FOR ALL`, `TO authenticated` sama) dengan `USING`/`WITH CHECK` `layanan_id = get_my_layanan_id() AND get_my_role() = 'petugas'`. Sebelumnya policy tidak memeriksa peran, sehingga Front Office yang baris `petugas`-nya punya `layanan_id` masih bisa menulis FAQ layanannya dan (bersama `faq_fo_umum`) memindahkan baris antara FAQ umum dan FAQ layanan. Hanya menyentuh policy itu. **Diterapkan SETELAH `202610130001`.** | **DITERAPKAN ke produksi 2026-10-13** (lihat `docs/analysis/DB-CHANGES.md`; dicatat manual ke ledger). | `docs/rollback-faq-petugas-hanya-petugas-202610130002.sql` (memulihkan definisi `202607280003`) |
| `202610140001_sesi_staf.sql` | Sesi tunggal staf (satu akun, tidak boleh login ganda): tabel `sesi_staf` (RLS tanpa policy, klien tanpa akses langsung), pengaturan `sesi_idle_menit` (120) dan `sesi_tunggal_aktif` (**false** sampai cutover), fungsi `sesi_status()`/`sesi_valid()`, RPC `daftarkan_sesi()`/`ping_sesi(boolean)`/`akhiri_sesi()`. Tidak mengubah fungsi/policy/tabel lain; `sesi_valid()` baru dipakai RPC mutasi pada migrasi A3. | **DITERAPKAN ke produksi 2026-10-13** (atas izin CEO; flag `sesi_tunggal_aktif` = false). | `docs/rollback-sesi-staf-202610140001.sql` |
| `202610140002_tiket_kepemilikan.sql` | Kepemilikan tiket layanan (A3, audit T1; aturan CEO "hanya yang memulai boleh menyelesaikan"): RPC `layanan_mulai(uuid)` (guard atomik, `dilayani_oleh` = pemanggil; Admin semua layanan, petugas layanannya, FO ditolak), `layanan_selesai(uuid, text, jsonb)` (hanya pemilik; upsert pendataan dari `finalize_pelayanan` apa adanya), `admin_ambil_alih(uuid, text)` (jalur darurat, alasan wajib, `audit_log`); `finalize_pelayanan` jadi pembungkus; trigger penjaga `trg_guard_visit_transisi_layanan` (UPDATE langsung `visit` ke/dari `dilayani`/`selesai` ditolak `TRANSISI_LEWAT_RPC`); `DROP POLICY tiket_staff_update`; policy draf `pelayanan_*` hanya pemilik (`pemilik_tiket()`); backfill `dilayani_oleh` tiket `dilayani` dari `audit_log`. Semua RPC memanggil `sesi_valid()`. **Diterapkan SETELAH `202610140001` dan klien A2, bersamaan dengan deploy klien A3, di luar jam layanan dan saat tidak ada tiket `dilayani`.** | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Verifikasi read-only: fungsi layanan/FO ada. Uji perilaku (ROLLBACK) `test-tiket-kepemilikan` = 84 lolos. | `docs/rollback-tiket-kepemilikan-202610140002.sql` (memulihkan `finalize_pelayanan` 202610010001, `tiket_staff_update` 202607290013, policy draf 202610090001) |
| `202610140003_fo_model_data.sql` | Tahap B model data: `layanan.prefiks_antrean` 2 huruf unik (NOT NULL, CHECK `^[A-Z]{2}$`, backfill OS/NO/BM/BL/BP/IG/JI/MU/SH/SM, auto-generate via trigger); `terbit_tiket` -> tanggal WIB hari ini + format `OS-014`; `kunjungan` (asal `online`, `chat_sesi_id`, `selesai_at` jam server, data pengunjung walk-in, data reservasi, `client_request_id`, `dibuat_oleh`; `kunjungan_staff_update` dicabut); tabel `topik_penanganan` (+ seed FO dan 10 layanan) dan `penanganan` (RLS SELECT saja); `tiket_antrean` (`penanganan_asal_id`, `dialihkan_ke`, status `dikembalikan`/`dialihkan`). **Diterapkan pada jendela cutover Tahap B, SETELAH 202610140002, sebelum 0004/0005.** | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Verifikasi read-only: prefiks layanan 2 huruf terpasang. Uji perilaku (ROLLBACK) gabungan 0003-0005 = 150 lolos. | `docs/rollback-fo-model-data-202610140003.sql` (paling akhir; menghapus tabel/kolom baru; ditolak bila ada data penanganan kecuali `lmh.rollback_paksa`) |
| `202610140004_fo_rpc.sql` | Tahap B RPC: `fo_mulai_kunjungan`, `fo_checkin_reservasi`, `fo_tolak_reservasi`, `fo_selesai`, `fo_eskalasi` (tiket baru + notifikasi petugas), `fo_ambil_dari_kotak_masuk` (atomik), `layanan_kembalikan`, `admin_alihkan` (audit_log), `reservasi_buat`, `reservasi_batalkan`; semua `sesi_valid()`, waktu server. Kontrak UI: `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md`. | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Verifikasi read-only: fungsi FO ada. Uji perilaku (ROLLBACK) gabungan 0003-0005 = 150 lolos. | `docs/rollback-fo-rpc-202610140004.sql` (setelah rollback 0005) |
| `202610140005_fo_selaras_antrean.sql` | Tahap B penyelarasan: `layanan_mulai`/`layanan_selesai` (signature baru `(uuid, text, jsonb, uuid, text)`; topik + catatan wajib untuk tiket hasil eskalasi)/`admin_ambil_alih` menggerakkan tahap `penanganan`; `get_queue_position`, `tandai_tidak_terlayani_akhir_hari`, `tandai_reservasi_no_show`, `rollup_rekap_harian` memahami tiket/reservasi tanpa `visit` dan status baru. Sinkron `visit` A3 dipertahankan (WP-24). | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Uji perilaku (ROLLBACK) gabungan 0003-0005 = 150 lolos. | `docs/rollback-fo-selaras-antrean-202610140005.sql` (pertama; memulihkan 7 fungsi persis) |
| `202610140006_pernyataan_kebenaran.sql` | Kunci Nama Lengkap pengunjung (C2/K12, keputusan CEO G.3 Opsi A): `pengunjung_profil_lengkap(...)` (definisi "profil lengkap" tanpa NIK), trigger `trg_jaga_nama_pengunjung` (nama tidak bisa diubah pemilik setelah profil lengkap; profil lengkap tidak bisa dikosongkan; dikecualikan service_role/pg_cron dan flag `lmh.ubah_nama`), RPC `ubah_nama_pengunjung(uuid, text, text)` (admin/FO aktif, `sesi_valid()`, alasan wajib, `audit_log`). Tanpa kolom/tabel baru; `consent_log` tidak diubah. Syarat: `202610140001`, `202610080001`, `202610090004`, `202607240001`. **Terapkan SEBELUM deploy klien C2; profil yang sudah lengkap langsung terkunci.** | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Tanpa uji perilaku khusus: hanya tercakup sebagai prasyarat (`--pre`) uji lain dan test statis. | `docs/rollback-pernyataan-kebenaran-202610140006.sql` |
| `202610140007_wp24_akhiri_dual_write.sql` | WP-24 (Gerbang G.1 Opsi A): `visit` menjadi arsip (8 trigger efek DISABLE, `trg_visit_arsip`, policy/hak tulis dicabut, penjaga A3 dihapus); reservasi lama dilengkapi/dibuatkan `kunjungan`; RPC FO/layanan + job akhir hari/no-show tanpa `visit` (`fo_sinkron_visit` dihapus); SKM, notifikasi, response rate, audit, `mv_estimasi_layanan`/`v_antrian_loket`, `jumlah_terdaftar`, `metrik_kepatuhan` pindah ke `kunjungan`/`tiket_antrean`; `skm_respons.kunjungan_id`. Penjaga: prasyarat 0003..0006 + antrean kosong (`CUTOVER_DITOLAK`). | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Verifikasi read-only: `visit` menjadi arsip (`trg_visit_arsip` aktif, trigger tulis lama nonaktif). Uji perilaku (ROLLBACK) `test-wp24` gabungan 0007/0008 = 101 lolos. | `docs/rollback-wp24-akhiri-dual-write-202610140007.sql` (setelah rollback 0008) |
| `202610140008_wp24_tutup_otomatis_retensi.sql` | `batal_karena` += `tidak_ditutup`; `tutup_penanganan_tertinggal()` + job `penanganan_tutup_otomatis` (23:00 WIB); anonimisasi 730 hari mencakup `kunjungan`, `penanganan.catatan`, arsip `visit`. Syarat: 0007. | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Verifikasi read-only: job `penanganan_tutup_otomatis` terjadwal. Uji perilaku (ROLLBACK) gabungan 0007/0008 = 101 lolos. | `docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql` (pertama) |
| `202610140009_chat_online.sql` | Tahap C live chat = layanan online tercatat (K8/K10): `chat_sesi.kunjungan_id`; eskalasi membuat `kunjungan` asal `online` + tahap `penanganan` FO chat `menunggu` (trigger); RPC `chat_ambil` (atomik; petugas layanan boleh ambil langsung sebelum FO; Admin ambil alih + alasan + audit), `chat_teruskan` (handoff tanpa tiket + notifikasi petugas), `chat_selesai` (topik + catatan wajib, pesan penutup `penutup_survei`); penjaga `CHAT_HARUS_RPC` atas kolom staf `chat_sesi`; `boleh_penanganan`/`boleh_kunjungan` + cabang chat petugas; backfill sesi `eskalasi`/`aktif`. Syarat: 0003-0005. **Terapkan bersamaan dengan klien Tahap C; route lama `/api/chat/sesi` ditolak setelahnya.** | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Verifikasi read-only: fungsi chat ada. Uji perilaku (ROLLBACK) `test-chat-online` = 106 lolos. | `docs/rollback-chat-online-202610140009.sql` (sebelum rollback 0005) |
| `202610140011_pendataan_wajib.sql` | Tahap C3 (G.5): Pendataan semua field wajib. `pendataan_validasi_payload` (`INVALID_PAYLOAD`) dipanggil `layanan_selesai` (salinan persis 0007 + validasi); CHECK `tipe_pelaku_usaha`/`skala_usaha` dilonggarkan (+ opsi "tidak berlaku"). Penjaga: 0007 harus sudah diterapkan. Data lama tidak disentuh. | **DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; atomik: dry-run lalu COMMIT).** Tanpa uji perilaku khusus: hanya tercakup sebagai prasyarat (`--pre`) dan test statis. | `docs/rollback-pendataan-wajib-202610140011.sql` |

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

Cara menerapkan Tahap B (menyentuh DB produksi; hanya setelah konfirmasi CEO; jendela cutover di luar jam layanan dengan antrean kosong). Ketiganya membuat fungsi/policy, jadi WAJIB `--atomic`, berurutan:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic
```

> **PERINGATAN Tahap B.** (1) Dry-run 0004 dan 0005 hanya bermakna bila 0003 (dan 0004) sudah ada; dry-run berurutan terpisah akan gagal di penjaga prasyarat. Untuk pratinjau gabungan pakai `scripts/test-fo-eskalasi.mjs` (ketiganya di satu transaksi yang di-ROLLBACK). (2) Deploy klien Tahap B bersamaan: Kelola Layanan (prefiks 2 huruf), halaman FO (kotak masuk, penanganan, eskalasi), scan QR (`fo_checkin_reservasi`), `me/reservasi` (`reservasi_buat`), antrean petugas (`layanan_selesai` + topik/catatan, `layanan_kembalikan`), Admin (`admin_alihkan`). (3) WP-24 (mematikan dual-write `visit`) ditulis sebagai 0007/0008 (lihat di bawah); selama 0007 belum diterapkan, SKM/notifikasi/estimasi untuk kunjungan baru tanpa `visit` belum berjalan. (4) Rollback urutan terbalik: 0005 -> 0004 -> 0003.

Cara menerapkan 0007, 0008, 0009, dan 0011 (menyentuh DB produksi; hanya setelah konfirmasi CEO; di luar jam layanan dengan antrean kosong). Semuanya WAJIB `--atomic`, selalu `--dry-run` dulu. Dry-run tunggal hanya bermakna bila prasyaratnya sudah terpasang (penjaga `PRASYARAT` menolak di produksi saat ini, ROLLBACK, tidak mengubah apa pun):

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic
```

Pratinjau gabungan sebelum 0003-0005 diterapkan (satu transaksi, selalu ROLLBACK; skrip menolak jam layanan Senin-Jumat 07:00-16:59 WIB): `node scripts/test-chat-online.mjs --pre 0002 --pre 0003 --pre 0004 --pre 0005 --apply 202610140009_chat_online.sql` (path lengkap per berkas) dan `scripts/test-wp24.mjs` (lihat `docs/RUNBOOK_FO_ESKALASI.md`).

### URUTAN TERAPAN (satu jendela cutover) dan larangan

Status per 2026-10-14 malam: `0001`-`0009`, `0011`, `0012`, dan `0013` SEMUA DITERAPKAN ke produksi (0002-0013 pada ±17:52-17:57 WIB, atomik: dry-run lalu COMMIT; urutan di bawah dijalankan persis; verifikasi read-only lolos). Nomor `0010` tidak dipakai (tidak ada berkasnya). Klien yang menyesuaikan di-deploy lewat merge PR #10 (merge commit `cbff52a`) segera sesudah migrasi; status deploy produksi Vercel sukses menurut status GitHub, pemeriksaan kesehatan dari luar BELUM TERBUKTI (lihat `docs/DECISION_LOG.md`). Bagian di bawah ditulis sebelum penerapan; dipertahankan sebagai catatan urutan, larangan, dan rollback.

```
0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0008 -> 0009 -> 0011 -> 0012 -> 0013
```

- Rollback = urutan terbalik: 0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> 0006 -> 0005 -> 0004 -> 0003 -> 0002 (0009 sebelum 0005; 0008 sebelum 0007; 0007 setelah 0008 dan sebelum 0006/0005/0004/0003/0002).
- **DILARANG menerapkan ulang 0004 atau 0005 SETELAH 0007 diterapkan.** Keduanya `CREATE OR REPLACE` fungsi yang oleh 0007 sudah diganti dengan versi tanpa `visit`; menjalankannya lagi menimpa versi 0007 dengan versi lama yang masih menulis/mengunci `visit` (kini arsip, ditolak `VISIT_ARSIP`), sehingga RPC FO/layanan dan job akhir hari/no-show rusak. Hal yang sama untuk 0003 dan 0002 (penjaga/DROP/policy yang sudah ditimpa). Berkas 0002-0006 hanya dijalankan ulang bila rollback 0007 dilakukan lebih dulu. Skrip uji (`scripts/test-fo-eskalasi.mjs`, `test-chat-online.mjs`, `test-wp24.mjs`) hanya memakai transaksi ROLLBACK, sehingga aman.
- 0011 hanya SETELAH 0007 (penjaga membaca `visit_arsip_jaga()`; bila dijalankan sebelum 0007, `layanan_selesai` ditimpa lagi oleh 0007 dan validasi hilang).
- 0007 menolak (`CUTOVER_DITOLAK`) bila ada tiket `menunggu`/`dipanggil` hari ini: terapkan setelah antrean kosong (Jumat setelah 16:00 WIB atau akhir pekan, Gerbang G.6), bersamaan dengan deploy klien. Muat ulang skema PostgREST setelah setiap migrasi.
- Setelah migrasi diterapkan lewat `scripts/apply-migration.mjs`, ledger `supabase_migrations.schema_migrations` TIDAK ikut tercatat; catat kemudian lewat `scripts/fill-migration-ledger.mjs` (izin CEO). Sudah dilakukan 2026-10-14 malam untuk 0001-0013 (12 baris, tanpa 0010).
- Urutan lengkap, rollback, dan verifikasi pasca: `docs/RUNBOOK_FO_ESKALASI.md`.

> **PERINGATAN URUTAN DEPLOY.** Menu "Kelola FAQ" untuk Front Office sudah dibuka di `src/lib/admin-nav.ts`. Urutan yang benar: `202610130001` -> `202610130002` -> **baru** deploy kode UI FO. Bila kode di-deploy SEBELUM kedua migrasi diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`, karena `202610130001` belum melonggarkannya); bila hanya `202610130002` yang belum, FO ber-layanan masih dapat menulis FAQ layanannya dan memindahkan baris. Migrasi idempoten dan tidak mengubah baris data.

## Perbaikan temuan review (0012) dan perubahan in-place 0009

### Baris tabel urutan terapan

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140012 | `202610140012_perbaikan_review.sql` | 0011 (+0009, 0007, pg_cron, tabel `hari_libur`) — penjaga `PRASYARAT` | `docs/rollback-perbaikan-review-202610140012.sql` (setelah rollback 0013; menolak selama penanda 0013 ada) | **DITERAPKAN ke produksi 2026-10-14 (±17:52-17:57 WIB; atomik, dry-run lalu COMMIT).** Verifikasi read-only: job `chat_tutup_otomatis` terjadwal. Uji perilaku (ROLLBACK) `test-perbaikan-review` = 61 lolos (dengan `--akhir-hari`). |

Urutan cutover menjadi `0002 -> ... -> 0008 -> 0009 -> 0011 -> 0012 -> 0013`. Urutan rollback: `0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> ...` (0013: lihat bagian "Keterbukaan data antar Front Office (0013)").

### Catatan perubahan in-place 202610140012 (dibuat sebelum penerapan; kini sudah diterapkan; keputusan CEO 2026-10-14)

`202610140012_perbaikan_review.sql` DIUBAH in-place (diizinkan karena saat itu belum diterapkan di produksi; sejak 2026-10-14 malam berkasnya immutable: entri manifest dihapus lalu diregenerasi dengan `node scripts/gen-migration-manifest.mjs`):
- #1 `layanan_selesai`: pengecualian "Admin pengambil alih menutup tanpa form" dan audit `layanan_selesai_tanpa_pendataan` DIHAPUS; kewajiban form berlaku untuk semua peran. Tiket macet tanpa data hanya ditutup jalur otomatis `tutup_penanganan_tertinggal` (0008, 23:00 WIB).
- #13 baru (hari tanpa pelayanan = Sabtu/Minggu/`hari_libur`): fungsi `hari_tanpa_layanan(date)`; `chat_ambil`/`chat_teruskan` menolak `HARI_TANPA_LAYANAN`; trigger eskalasi chat (`chat_sesi_eskalasi_kunjungan`, `chat_pesan_eskalasi_kunjungan`) tidak mencatat kunjungan pada hari itu. Fungsi 0009 itu di-`CREATE OR REPLACE` penuh di 0012 (berkas 0009 TIDAK diubah); rollback 0012 memulihkannya persis dari 0009 lalu `DROP FUNCTION hari_tanpa_layanan(date)`.
- Uji perilaku: `scripts/test-perbaikan-review.mjs` seksi 2 (Admin pengambil alih wajib form, jalur otomatis) dan seksi 9 (#13; menandai hari ini sebagai `hari_libur` di dalam savepoint) — **dijalankan 2026-10-14 malam terhadap produksi (ROLLBACK): 61 lolos dengan `--akhir-hari`.** `scripts/test-chat-online.mjs` kini berhenti pada Sabtu/Minggu/hari libur bila 0012 sudah terpasang (jalankan pada hari kerja setelah 17:00 WIB).
- Klien: `/chat`, `/admin/chat`, `/api/chat/ai` menilai hari sendiri dari tabel `hari_libur` (tidak memanggil `hari_tanpa_layanan`), jadi aman di-deploy sebelum/sesudah 0012; tanpa 0012 hanya penegakan DB yang belum ada.

### Catatan perubahan in-place 202610140009 (dibuat sebelum penerapan; kini sudah diterapkan)

`202610140009_chat_online.sql` DIUBAH in-place (diizinkan karena saat itu belum diterapkan; hanya trigger dan backfill; sejak 2026-10-14 malam berkasnya immutable):
- trigger `trg_chat_sesi_eskalasi_kunjungan` kini mensyaratkan minimal satu pesan pengunjung;
- trigger baru `trg_chat_pesan_eskalasi_kunjungan` (AFTER INSERT `chat_pesan`, pengirim `pengunjung`) + fungsi `chat_pesan_eskalasi_kunjungan()`;
- backfill hanya sesi `eskalasi`/`aktif` yang punya pesan pengunjung dan aktivitas terakhir <= 24 jam.
Entri manifest 0009 dihapus lalu diregenerasi (`node scripts/gen-migration-manifest.mjs`); hash baru `ac5602d8...b932ff`. Rollback 0009 ikut diperbarui (drop trigger/fungsi baru + penjaga 0012). Uji perilaku `scripts/test-chat-online.mjs` (lolos 99/99 pada versi lama 2026-10-14 06:14 WIB) **wajib diulang**; skrip sudah disesuaikan. Diulang 2026-10-14 malam terhadap produksi (ROLLBACK): 106 lolos.

### Larangan (tambahkan ke bagian larangan)

- JANGAN menerapkan ulang 202610140004 atau 202610140005 setelah 0007: menimpa fungsi versi 0007/0011/0012 tanpa galat. Bila terlanjur, terapkan ulang 0007 -> 0008 -> 0009 -> 0011 -> 0012 (idempoten). 0004/0005 tidak diberi penjaga (biaya: hash manifest berubah); ditegakkan lewat runbook.
- Penjaga urutan rollback (DO di awal berkas): rollback 0011, 0009, 0007 menolak bila 0012 masih ada; rollback 0007 juga menolak bila 0011 masih ada; rollback 0012 menolak bila 0011/0009 sudah tidak ada.

### Perintah

```
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (siang, read-only, di-ROLLBACK), saat prasyarat belum terpasang: berhenti di penjaga `PRASYARAT: 202610140011_pendataan_wajib belum diterapkan` (benar). Dry-run 0009 (setelah diubah): berhenti di `PRASYARAT: tabel penanganan/topik_penanganan belum ada` (benar). Malam harinya seluruh rantai diterapkan berurutan (dry-run lalu COMMIT) dan lolos.

## Keterbukaan data antar Front Office (0013)

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140013 | `202610140013_fo_keterbukaan_data.sql` | 0012 (`hari_tanpa_layanan`) + 0009 (`chat_buat_kunjungan`) + 0003 (`penanganan`, `boleh_penanganan`) — penjaga `PRASYARAT` | `docs/rollback-fo-keterbukaan-data-202610140013.sql` (PERTAMA dalam urutan rollback; memulihkan `boleh_penanganan` persis versi 0009) | **DITERAPKAN ke produksi 2026-10-14 (±17:52-17:57 WIB; atomik, dry-run lalu COMMIT).** Uji perilaku (ROLLBACK) `test-fo-keterbukaan` = 26 lolos. |

Keputusan CEO 2026-10-14 (keterbukaan data antar FO): semua FO membaca semua `penanganan` (tahap `fo` dan `layanan`, semua tanggal). Hanya `boleh_penanganan` (cabang `front_office` = `RETURN true`) yang diganti; cabang lain identik 0009; tanpa policy/GRANT/DML baru; tabel `penanganan` tetap baca-saja bagi klien (tulis hanya RPC pemilik tahap). Tabel lain (`kunjungan`, `tiket_antrean`, `pelayanan_*`, `petugas`) sudah terbuka untuk FO sebelum ini dan tidak diubah. Penanda: komentar fungsi `boleh_penanganan` memuat `202610140013` (dipakai penjaga rollback 0012). Rincian akses sebelum/sesudah: `docs/analysis/04-RBAC-MATRIX.md` §6.4. Pilihan berkas baru (bukan in-place 0012): satu keputusan akses yang berdiri sendiri, bisa di-rollback terpisah dari perbaikan review; 0012 tidak diubah (hanya rollback 0012 mendapat penjaga baru).

```
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (siang, read-only, di-ROLLBACK, saat 0003 belum terpasang): berhenti di `PRASYARAT: tabel penanganan / boleh_penanganan belum ada (202610140003_fo_model_data)` (benar); malam harinya diterapkan (dry-run lalu COMMIT). Dry-run kedua rollback (0013 dan 0012 yang diberi penjaga baru) juga berhenti di penjaganya masing-masing tanpa perubahan. Klien (rekap tanpa batas "milik sendiri", kolom Front Office) aman di-deploy sebelum/sesudah 0013: tanpa 0013 RLS lama hanya membuat data FO tidak lengkap, tidak bocor. Uji perilaku: `scripts/test-fo-keterbukaan.mjs` (dijalankan 2026-10-14 malam terhadap produksi, ROLLBACK: 26 lolos; skrip menolak Senin-Jumat 07:00-16:59 WIB). Belum terbukti: kueri rekap FO pada PostgREST sungguhan.

```markdown
## Data walk-in lengkap (0014)

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140014 | `202610140014_walkin_data_lengkap.sql` | 0013 (penanda komentar `boleh_penanganan`) + 0012 (`hari_tanpa_layanan`) + `fo_mulai_kunjungan` (0004) — penjaga `PRASYARAT` | `docs/rollback-walkin-data-lengkap-202610140014.sql` (PERTAMA dalam urutan rollback; memulihkan `fo_mulai_kunjungan` persis versi 0012 dan menghapus komentar) | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO** |

Permintaan CEO 2026-10-14: pendaftaran walk-in FO memuat SEMUA field wajib dan tervalidasi (HP dan email diperiksa).
Hanya `fo_mulai_kunjungan` yang diganti (CREATE OR REPLACE penuh dari versi 0012); yang berubah HANYA normalisasi input
dan blok validasi. Signature, atribut, hak EXECUTE (tanpa GRANT/REVOKE; ACL 0004 dipertahankan), penjaga sesi,
idempotensi `client_request_id` (diperiksa sebelum validasi), aturan `p_pengunjung_id`, jam tutup, INSERT, dan balasan
tidak berubah. Tanpa DML: data kunjungan lama tidak disentuh. Aturan:

- nama: spasi dirapatkan + trim; 3–100; `^[[:alpha:]][[:alpha:] .,'’-]*# Database Migrations

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
| `202610140003_fo_model_data.sql` | Tahap B model data: `layanan.prefiks_antrean` 2 huruf unik (NOT NULL, CHECK `^[A-Z]{2}$`, backfill OS/NO/BM/BL/BP/IG/JI/MU/SH/SM, auto-generate via trigger); `terbit_tiket` -> tanggal WIB hari ini + format `OS-014`; `kunjungan` (asal `online`, `chat_sesi_id`, `selesai_at` jam server, data pengunjung walk-in, data reservasi, `client_request_id`, `dibuat_oleh`; `kunjungan_staff_update` dicabut); tabel `topik_penanganan` (+ seed FO dan 10 layanan) dan `penanganan` (RLS SELECT saja); `tiket_antrean` (`penanganan_asal_id`, `dialihkan_ke`, status `dikembalikan`/`dialihkan`). **Diterapkan pada jendela cutover Tahap B, SETELAH 202610140002, sebelum 0004/0005.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-model-data-202610140003.sql` (paling akhir; menghapus tabel/kolom baru; ditolak bila ada data penanganan kecuali `lmh.rollback_paksa`) |
| `202610140004_fo_rpc.sql` | Tahap B RPC: `fo_mulai_kunjungan`, `fo_checkin_reservasi`, `fo_tolak_reservasi`, `fo_selesai`, `fo_eskalasi` (tiket baru + notifikasi petugas), `fo_ambil_dari_kotak_masuk` (atomik), `layanan_kembalikan`, `admin_alihkan` (audit_log), `reservasi_buat`, `reservasi_batalkan`; semua `sesi_valid()`, waktu server. Kontrak UI: `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md`. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-rpc-202610140004.sql` (setelah rollback 0005) |
| `202610140005_fo_selaras_antrean.sql` | Tahap B penyelarasan: `layanan_mulai`/`layanan_selesai` (signature baru `(uuid, text, jsonb, uuid, text)`; topik + catatan wajib untuk tiket hasil eskalasi)/`admin_ambil_alih` menggerakkan tahap `penanganan`; `get_queue_position`, `tandai_tidak_terlayani_akhir_hari`, `tandai_reservasi_no_show`, `rollup_rekap_harian` memahami tiket/reservasi tanpa `visit` dan status baru. Sinkron `visit` A3 dipertahankan (WP-24). | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-selaras-antrean-202610140005.sql` (pertama; memulihkan 7 fungsi persis) |
| `202610140006_pernyataan_kebenaran.sql` | Kunci Nama Lengkap pengunjung (C2/K12, keputusan CEO G.3 Opsi A): `pengunjung_profil_lengkap(...)` (definisi "profil lengkap" tanpa NIK), trigger `trg_jaga_nama_pengunjung` (nama tidak bisa diubah pemilik setelah profil lengkap; profil lengkap tidak bisa dikosongkan; dikecualikan service_role/pg_cron dan flag `lmh.ubah_nama`), RPC `ubah_nama_pengunjung(uuid, text, text)` (admin/FO aktif, `sesi_valid()`, alasan wajib, `audit_log`). Tanpa kolom/tabel baru; `consent_log` tidak diubah. Syarat: `202610140001`, `202610080001`, `202610090004`, `202607240001`. **Terapkan SEBELUM deploy klien C2; profil yang sudah lengkap langsung terkunci.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-pernyataan-kebenaran-202610140006.sql` |
| `202610140007_wp24_akhiri_dual_write.sql` | WP-24 (Gerbang G.1 Opsi A): `visit` menjadi arsip (8 trigger efek DISABLE, `trg_visit_arsip`, policy/hak tulis dicabut, penjaga A3 dihapus); reservasi lama dilengkapi/dibuatkan `kunjungan`; RPC FO/layanan + job akhir hari/no-show tanpa `visit` (`fo_sinkron_visit` dihapus); SKM, notifikasi, response rate, audit, `mv_estimasi_layanan`/`v_antrian_loket`, `jumlah_terdaftar`, `metrik_kepatuhan` pindah ke `kunjungan`/`tiket_antrean`; `skm_respons.kunjungan_id`. Penjaga: prasyarat 0003..0006 + antrean kosong (`CUTOVER_DITOLAK`). | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-wp24-akhiri-dual-write-202610140007.sql` (setelah rollback 0008) |
| `202610140008_wp24_tutup_otomatis_retensi.sql` | `batal_karena` += `tidak_ditutup`; `tutup_penanganan_tertinggal()` + job `penanganan_tutup_otomatis` (23:00 WIB); anonimisasi 730 hari mencakup `kunjungan`, `penanganan.catatan`, arsip `visit`. Syarat: 0007. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql` (pertama) |
| `202610140009_chat_online.sql` | Tahap C live chat = layanan online tercatat (K8/K10): `chat_sesi.kunjungan_id`; eskalasi membuat `kunjungan` asal `online` + tahap `penanganan` FO chat `menunggu` (trigger); RPC `chat_ambil` (atomik; petugas layanan boleh ambil langsung sebelum FO; Admin ambil alih + alasan + audit), `chat_teruskan` (handoff tanpa tiket + notifikasi petugas), `chat_selesai` (topik + catatan wajib, pesan penutup `penutup_survei`); penjaga `CHAT_HARUS_RPC` atas kolom staf `chat_sesi`; `boleh_penanganan`/`boleh_kunjungan` + cabang chat petugas; backfill sesi `eskalasi`/`aktif`. Syarat: 0003-0005. **Terapkan bersamaan dengan klien Tahap C; route lama `/api/chat/sesi` ditolak setelahnya.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-chat-online-202610140009.sql` (sebelum rollback 0005) |
| `202610140011_pendataan_wajib.sql` | Tahap C3 (G.5): Pendataan semua field wajib. `pendataan_validasi_payload` (`INVALID_PAYLOAD`) dipanggil `layanan_selesai` (salinan persis 0007 + validasi); CHECK `tipe_pelaku_usaha`/`skala_usaha` dilonggarkan (+ opsi "tidak berlaku"). Penjaga: 0007 harus sudah diterapkan. Data lama tidak disentuh. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-pendataan-wajib-202610140011.sql` |

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

Cara menerapkan Tahap B (menyentuh DB produksi; hanya setelah konfirmasi CEO; jendela cutover di luar jam layanan dengan antrean kosong). Ketiganya membuat fungsi/policy, jadi WAJIB `--atomic`, berurutan:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic
```

> **PERINGATAN Tahap B.** (1) Dry-run 0004 dan 0005 hanya bermakna bila 0003 (dan 0004) sudah ada; dry-run berurutan terpisah akan gagal di penjaga prasyarat. Untuk pratinjau gabungan pakai `scripts/test-fo-eskalasi.mjs` (ketiganya di satu transaksi yang di-ROLLBACK). (2) Deploy klien Tahap B bersamaan: Kelola Layanan (prefiks 2 huruf), halaman FO (kotak masuk, penanganan, eskalasi), scan QR (`fo_checkin_reservasi`), `me/reservasi` (`reservasi_buat`), antrean petugas (`layanan_selesai` + topik/catatan, `layanan_kembalikan`), Admin (`admin_alihkan`). (3) WP-24 (mematikan dual-write `visit`) ditulis sebagai 0007/0008 (lihat di bawah); selama 0007 belum diterapkan, SKM/notifikasi/estimasi untuk kunjungan baru tanpa `visit` belum berjalan. (4) Rollback urutan terbalik: 0005 -> 0004 -> 0003.

Cara menerapkan 0007, 0008, 0009, dan 0011 (menyentuh DB produksi; hanya setelah konfirmasi CEO; di luar jam layanan dengan antrean kosong). Semuanya WAJIB `--atomic`, selalu `--dry-run` dulu. Dry-run tunggal hanya bermakna bila prasyaratnya sudah terpasang (penjaga `PRASYARAT` menolak di produksi saat ini, ROLLBACK, tidak mengubah apa pun):

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic
```

Pratinjau gabungan sebelum 0003-0005 diterapkan (satu transaksi, selalu ROLLBACK; skrip menolak jam layanan Senin-Jumat 07:00-16:59 WIB): `node scripts/test-chat-online.mjs --pre 0002 --pre 0003 --pre 0004 --pre 0005 --apply 202610140009_chat_online.sql` (path lengkap per berkas) dan `scripts/test-wp24.mjs` (lihat `docs/RUNBOOK_FO_ESKALASI.md`).

### URUTAN TERAPAN (satu jendela cutover) dan larangan

Status per 2026-10-14: hanya `202610140001` yang DITERAPKAN; `0002`-`0009`, `0011`, `0012`, dan `0013` DITULIS, BELUM DITERAPKAN. Nomor `0010` tidak dipakai (tidak ada berkasnya).

```
0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0008 -> 0009 -> 0011 -> 0012 -> 0013
```

- Rollback = urutan terbalik: 0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> 0006 -> 0005 -> 0004 -> 0003 -> 0002 (0009 sebelum 0005; 0008 sebelum 0007; 0007 setelah 0008 dan sebelum 0006/0005/0004/0003/0002).
- **DILARANG menerapkan ulang 0004 atau 0005 SETELAH 0007 diterapkan.** Keduanya `CREATE OR REPLACE` fungsi yang oleh 0007 sudah diganti dengan versi tanpa `visit`; menjalankannya lagi menimpa versi 0007 dengan versi lama yang masih menulis/mengunci `visit` (kini arsip, ditolak `VISIT_ARSIP`), sehingga RPC FO/layanan dan job akhir hari/no-show rusak. Hal yang sama untuk 0003 dan 0002 (penjaga/DROP/policy yang sudah ditimpa). Berkas 0002-0006 hanya dijalankan ulang bila rollback 0007 dilakukan lebih dulu. Skrip uji (`scripts/test-fo-eskalasi.mjs`, `test-chat-online.mjs`, `test-wp24.mjs`) hanya memakai transaksi ROLLBACK, sehingga aman.
- 0011 hanya SETELAH 0007 (penjaga membaca `visit_arsip_jaga()`; bila dijalankan sebelum 0007, `layanan_selesai` ditimpa lagi oleh 0007 dan validasi hilang).
- 0007 menolak (`CUTOVER_DITOLAK`) bila ada tiket `menunggu`/`dipanggil` hari ini: terapkan setelah antrean kosong (Jumat setelah 16:00 WIB atau akhir pekan, Gerbang G.6), bersamaan dengan deploy klien. Muat ulang skema PostgREST setelah setiap migrasi.
- Setelah migrasi diterapkan lewat `scripts/apply-migration.mjs`, ledger `supabase_migrations.schema_migrations` TIDAK ikut tercatat; catat kemudian lewat `scripts/fill-migration-ledger.mjs` (izin CEO).
- Urutan lengkap, rollback, dan verifikasi pasca: `docs/RUNBOOK_FO_ESKALASI.md`.

> **PERINGATAN URUTAN DEPLOY.** Menu "Kelola FAQ" untuk Front Office sudah dibuka di `src/lib/admin-nav.ts`. Urutan yang benar: `202610130001` -> `202610130002` -> **baru** deploy kode UI FO. Bila kode di-deploy SEBELUM kedua migrasi diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`, karena `202610130001` belum melonggarkannya); bila hanya `202610130002` yang belum, FO ber-layanan masih dapat menulis FAQ layanannya dan memindahkan baris. Migrasi idempoten dan tidak mengubah baris data.

## Perbaikan temuan review (0012) dan perubahan in-place 0009

### Baris tabel urutan terapan

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140012 | `202610140012_perbaikan_review.sql` | 0011 (+0009, 0007, pg_cron, tabel `hari_libur`) — penjaga `PRASYARAT` | `docs/rollback-perbaikan-review-202610140012.sql` (setelah rollback 0013; menolak selama penanda 0013 ada) | ditulis, belum diterapkan |

Urutan cutover menjadi `0002 -> ... -> 0008 -> 0009 -> 0011 -> 0012 -> 0013`. Urutan rollback: `0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> ...` (0013: lihat bagian "Keterbukaan data antar Front Office (0013)").

### Catatan perubahan in-place 202610140012 (belum diterapkan; keputusan CEO 2026-10-14)

`202610140012_perbaikan_review.sql` DIUBAH in-place (diizinkan karena belum diterapkan di produksi; entri manifest dihapus lalu diregenerasi dengan `node scripts/gen-migration-manifest.mjs`):
- #1 `layanan_selesai`: pengecualian "Admin pengambil alih menutup tanpa form" dan audit `layanan_selesai_tanpa_pendataan` DIHAPUS; kewajiban form berlaku untuk semua peran. Tiket macet tanpa data hanya ditutup jalur otomatis `tutup_penanganan_tertinggal` (0008, 23:00 WIB).
- #13 baru (hari tanpa pelayanan = Sabtu/Minggu/`hari_libur`): fungsi `hari_tanpa_layanan(date)`; `chat_ambil`/`chat_teruskan` menolak `HARI_TANPA_LAYANAN`; trigger eskalasi chat (`chat_sesi_eskalasi_kunjungan`, `chat_pesan_eskalasi_kunjungan`) tidak mencatat kunjungan pada hari itu. Fungsi 0009 itu di-`CREATE OR REPLACE` penuh di 0012 (berkas 0009 TIDAK diubah); rollback 0012 memulihkannya persis dari 0009 lalu `DROP FUNCTION hari_tanpa_layanan(date)`.
- Uji perilaku: `scripts/test-perbaikan-review.mjs` seksi 2 (Admin pengambil alih wajib form, jalur otomatis) dan seksi 9 (#13; menandai hari ini sebagai `hari_libur` di dalam savepoint) — **belum dijalankan** (hanya di luar jam layanan). `scripts/test-chat-online.mjs` kini berhenti pada Sabtu/Minggu/hari libur bila 0012 sudah terpasang (jalankan pada hari kerja setelah 17:00 WIB).
- Klien: `/chat`, `/admin/chat`, `/api/chat/ai` menilai hari sendiri dari tabel `hari_libur` (tidak memanggil `hari_tanpa_layanan`), jadi aman di-deploy sebelum/sesudah 0012; tanpa 0012 hanya penegakan DB yang belum ada.

### Catatan perubahan in-place 202610140009 (belum diterapkan)

`202610140009_chat_online.sql` DIUBAH in-place (diizinkan karena belum diterapkan; hanya trigger dan backfill):
- trigger `trg_chat_sesi_eskalasi_kunjungan` kini mensyaratkan minimal satu pesan pengunjung;
- trigger baru `trg_chat_pesan_eskalasi_kunjungan` (AFTER INSERT `chat_pesan`, pengirim `pengunjung`) + fungsi `chat_pesan_eskalasi_kunjungan()`;
- backfill hanya sesi `eskalasi`/`aktif` yang punya pesan pengunjung dan aktivitas terakhir <= 24 jam.
Entri manifest 0009 dihapus lalu diregenerasi (`node scripts/gen-migration-manifest.mjs`); hash baru `ac5602d8...b932ff`. Rollback 0009 ikut diperbarui (drop trigger/fungsi baru + penjaga 0012). Uji perilaku `scripts/test-chat-online.mjs` (lolos 99/99 pada versi lama 2026-10-14 06:14 WIB) **wajib diulang**; skrip sudah disesuaikan.

### Larangan (tambahkan ke bagian larangan)

- JANGAN menerapkan ulang 202610140004 atau 202610140005 setelah 0007: menimpa fungsi versi 0007/0011/0012 tanpa galat. Bila terlanjur, terapkan ulang 0007 -> 0008 -> 0009 -> 0011 -> 0012 (idempoten). 0004/0005 tidak diberi penjaga (biaya: hash manifest berubah); ditegakkan lewat runbook.
- Penjaga urutan rollback (DO di awal berkas): rollback 0011, 0009, 0007 menolak bila 0012 masih ada; rollback 0007 juga menolak bila 0011 masih ada; rollback 0012 menolak bila 0011/0009 sudah tidak ada.

### Perintah

```
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (siang, read-only, di-ROLLBACK): berhenti di penjaga `PRASYARAT: 202610140011_pendataan_wajib belum diterapkan` (benar). Dry-run 0009 (setelah diubah): berhenti di `PRASYARAT: tabel penanganan/topik_penanganan belum ada` (benar).

## Keterbukaan data antar Front Office (0013)

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140013 | `202610140013_fo_keterbukaan_data.sql` | 0012 (`hari_tanpa_layanan`) + 0009 (`chat_buat_kunjungan`) + 0003 (`penanganan`, `boleh_penanganan`) — penjaga `PRASYARAT` | `docs/rollback-fo-keterbukaan-data-202610140013.sql` (PERTAMA dalam urutan rollback; memulihkan `boleh_penanganan` persis versi 0009) | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO** |

Keputusan CEO 2026-10-14 (keterbukaan data antar FO): semua FO membaca semua `penanganan` (tahap `fo` dan `layanan`, semua tanggal). Hanya `boleh_penanganan` (cabang `front_office` = `RETURN true`) yang diganti; cabang lain identik 0009; tanpa policy/GRANT/DML baru; tabel `penanganan` tetap baca-saja bagi klien (tulis hanya RPC pemilik tahap). Tabel lain (`kunjungan`, `tiket_antrean`, `pelayanan_*`, `petugas`) sudah terbuka untuk FO sebelum ini dan tidak diubah. Penanda: komentar fungsi `boleh_penanganan` memuat `202610140013` (dipakai penjaga rollback 0012). Rincian akses sebelum/sesudah: `docs/analysis/04-RBAC-MATRIX.md` §6.4. Pilihan berkas baru (bukan in-place 0012): satu keputusan akses yang berdiri sendiri, bisa di-rollback terpisah dari perbaikan review; 0012 tidak diubah (hanya rollback 0012 mendapat penjaga baru).

```
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (read-only, di-ROLLBACK): berhenti di `PRASYARAT: tabel penanganan / boleh_penanganan belum ada (202610140003_fo_model_data)` (benar). Dry-run kedua rollback (0013 dan 0012 yang diberi penjaga baru) juga berhenti di penjaganya masing-masing tanpa perubahan. Klien (rekap tanpa batas "milik sendiri", kolom Front Office) aman di-deploy sebelum/sesudah 0013: tanpa 0013 RLS lama hanya membuat data FO tidak lengkap, tidak bocor. Uji perilaku: `scripts/test-fo-keterbukaan.mjs` (**belum dijalankan**; hanya di luar jam layanan; skrip menolak Senin-Jumat 07:00-16:59 WIB).

; minimal 3 huruf (DETAIL `nama`).
- asal/instansi: trim; 3–120; minimal 3 karakter selain spasi (DETAIL `asal_instansi`).
- HP WAJIB: non-digit dibuang, awalan 62/+62 → 0, valid `^08[1-9][0-9]{7,10}# Database Migrations

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
| `202610140003_fo_model_data.sql` | Tahap B model data: `layanan.prefiks_antrean` 2 huruf unik (NOT NULL, CHECK `^[A-Z]{2}$`, backfill OS/NO/BM/BL/BP/IG/JI/MU/SH/SM, auto-generate via trigger); `terbit_tiket` -> tanggal WIB hari ini + format `OS-014`; `kunjungan` (asal `online`, `chat_sesi_id`, `selesai_at` jam server, data pengunjung walk-in, data reservasi, `client_request_id`, `dibuat_oleh`; `kunjungan_staff_update` dicabut); tabel `topik_penanganan` (+ seed FO dan 10 layanan) dan `penanganan` (RLS SELECT saja); `tiket_antrean` (`penanganan_asal_id`, `dialihkan_ke`, status `dikembalikan`/`dialihkan`). **Diterapkan pada jendela cutover Tahap B, SETELAH 202610140002, sebelum 0004/0005.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-model-data-202610140003.sql` (paling akhir; menghapus tabel/kolom baru; ditolak bila ada data penanganan kecuali `lmh.rollback_paksa`) |
| `202610140004_fo_rpc.sql` | Tahap B RPC: `fo_mulai_kunjungan`, `fo_checkin_reservasi`, `fo_tolak_reservasi`, `fo_selesai`, `fo_eskalasi` (tiket baru + notifikasi petugas), `fo_ambil_dari_kotak_masuk` (atomik), `layanan_kembalikan`, `admin_alihkan` (audit_log), `reservasi_buat`, `reservasi_batalkan`; semua `sesi_valid()`, waktu server. Kontrak UI: `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md`. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-rpc-202610140004.sql` (setelah rollback 0005) |
| `202610140005_fo_selaras_antrean.sql` | Tahap B penyelarasan: `layanan_mulai`/`layanan_selesai` (signature baru `(uuid, text, jsonb, uuid, text)`; topik + catatan wajib untuk tiket hasil eskalasi)/`admin_ambil_alih` menggerakkan tahap `penanganan`; `get_queue_position`, `tandai_tidak_terlayani_akhir_hari`, `tandai_reservasi_no_show`, `rollup_rekap_harian` memahami tiket/reservasi tanpa `visit` dan status baru. Sinkron `visit` A3 dipertahankan (WP-24). | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-selaras-antrean-202610140005.sql` (pertama; memulihkan 7 fungsi persis) |
| `202610140006_pernyataan_kebenaran.sql` | Kunci Nama Lengkap pengunjung (C2/K12, keputusan CEO G.3 Opsi A): `pengunjung_profil_lengkap(...)` (definisi "profil lengkap" tanpa NIK), trigger `trg_jaga_nama_pengunjung` (nama tidak bisa diubah pemilik setelah profil lengkap; profil lengkap tidak bisa dikosongkan; dikecualikan service_role/pg_cron dan flag `lmh.ubah_nama`), RPC `ubah_nama_pengunjung(uuid, text, text)` (admin/FO aktif, `sesi_valid()`, alasan wajib, `audit_log`). Tanpa kolom/tabel baru; `consent_log` tidak diubah. Syarat: `202610140001`, `202610080001`, `202610090004`, `202607240001`. **Terapkan SEBELUM deploy klien C2; profil yang sudah lengkap langsung terkunci.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-pernyataan-kebenaran-202610140006.sql` |
| `202610140007_wp24_akhiri_dual_write.sql` | WP-24 (Gerbang G.1 Opsi A): `visit` menjadi arsip (8 trigger efek DISABLE, `trg_visit_arsip`, policy/hak tulis dicabut, penjaga A3 dihapus); reservasi lama dilengkapi/dibuatkan `kunjungan`; RPC FO/layanan + job akhir hari/no-show tanpa `visit` (`fo_sinkron_visit` dihapus); SKM, notifikasi, response rate, audit, `mv_estimasi_layanan`/`v_antrian_loket`, `jumlah_terdaftar`, `metrik_kepatuhan` pindah ke `kunjungan`/`tiket_antrean`; `skm_respons.kunjungan_id`. Penjaga: prasyarat 0003..0006 + antrean kosong (`CUTOVER_DITOLAK`). | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-wp24-akhiri-dual-write-202610140007.sql` (setelah rollback 0008) |
| `202610140008_wp24_tutup_otomatis_retensi.sql` | `batal_karena` += `tidak_ditutup`; `tutup_penanganan_tertinggal()` + job `penanganan_tutup_otomatis` (23:00 WIB); anonimisasi 730 hari mencakup `kunjungan`, `penanganan.catatan`, arsip `visit`. Syarat: 0007. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql` (pertama) |
| `202610140009_chat_online.sql` | Tahap C live chat = layanan online tercatat (K8/K10): `chat_sesi.kunjungan_id`; eskalasi membuat `kunjungan` asal `online` + tahap `penanganan` FO chat `menunggu` (trigger); RPC `chat_ambil` (atomik; petugas layanan boleh ambil langsung sebelum FO; Admin ambil alih + alasan + audit), `chat_teruskan` (handoff tanpa tiket + notifikasi petugas), `chat_selesai` (topik + catatan wajib, pesan penutup `penutup_survei`); penjaga `CHAT_HARUS_RPC` atas kolom staf `chat_sesi`; `boleh_penanganan`/`boleh_kunjungan` + cabang chat petugas; backfill sesi `eskalasi`/`aktif`. Syarat: 0003-0005. **Terapkan bersamaan dengan klien Tahap C; route lama `/api/chat/sesi` ditolak setelahnya.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-chat-online-202610140009.sql` (sebelum rollback 0005) |
| `202610140011_pendataan_wajib.sql` | Tahap C3 (G.5): Pendataan semua field wajib. `pendataan_validasi_payload` (`INVALID_PAYLOAD`) dipanggil `layanan_selesai` (salinan persis 0007 + validasi); CHECK `tipe_pelaku_usaha`/`skala_usaha` dilonggarkan (+ opsi "tidak berlaku"). Penjaga: 0007 harus sudah diterapkan. Data lama tidak disentuh. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-pendataan-wajib-202610140011.sql` |

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

Cara menerapkan Tahap B (menyentuh DB produksi; hanya setelah konfirmasi CEO; jendela cutover di luar jam layanan dengan antrean kosong). Ketiganya membuat fungsi/policy, jadi WAJIB `--atomic`, berurutan:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic
```

> **PERINGATAN Tahap B.** (1) Dry-run 0004 dan 0005 hanya bermakna bila 0003 (dan 0004) sudah ada; dry-run berurutan terpisah akan gagal di penjaga prasyarat. Untuk pratinjau gabungan pakai `scripts/test-fo-eskalasi.mjs` (ketiganya di satu transaksi yang di-ROLLBACK). (2) Deploy klien Tahap B bersamaan: Kelola Layanan (prefiks 2 huruf), halaman FO (kotak masuk, penanganan, eskalasi), scan QR (`fo_checkin_reservasi`), `me/reservasi` (`reservasi_buat`), antrean petugas (`layanan_selesai` + topik/catatan, `layanan_kembalikan`), Admin (`admin_alihkan`). (3) WP-24 (mematikan dual-write `visit`) ditulis sebagai 0007/0008 (lihat di bawah); selama 0007 belum diterapkan, SKM/notifikasi/estimasi untuk kunjungan baru tanpa `visit` belum berjalan. (4) Rollback urutan terbalik: 0005 -> 0004 -> 0003.

Cara menerapkan 0007, 0008, 0009, dan 0011 (menyentuh DB produksi; hanya setelah konfirmasi CEO; di luar jam layanan dengan antrean kosong). Semuanya WAJIB `--atomic`, selalu `--dry-run` dulu. Dry-run tunggal hanya bermakna bila prasyaratnya sudah terpasang (penjaga `PRASYARAT` menolak di produksi saat ini, ROLLBACK, tidak mengubah apa pun):

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic
```

Pratinjau gabungan sebelum 0003-0005 diterapkan (satu transaksi, selalu ROLLBACK; skrip menolak jam layanan Senin-Jumat 07:00-16:59 WIB): `node scripts/test-chat-online.mjs --pre 0002 --pre 0003 --pre 0004 --pre 0005 --apply 202610140009_chat_online.sql` (path lengkap per berkas) dan `scripts/test-wp24.mjs` (lihat `docs/RUNBOOK_FO_ESKALASI.md`).

### URUTAN TERAPAN (satu jendela cutover) dan larangan

Status per 2026-10-14: hanya `202610140001` yang DITERAPKAN; `0002`-`0009`, `0011`, `0012`, dan `0013` DITULIS, BELUM DITERAPKAN. Nomor `0010` tidak dipakai (tidak ada berkasnya).

```
0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0008 -> 0009 -> 0011 -> 0012 -> 0013
```

- Rollback = urutan terbalik: 0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> 0006 -> 0005 -> 0004 -> 0003 -> 0002 (0009 sebelum 0005; 0008 sebelum 0007; 0007 setelah 0008 dan sebelum 0006/0005/0004/0003/0002).
- **DILARANG menerapkan ulang 0004 atau 0005 SETELAH 0007 diterapkan.** Keduanya `CREATE OR REPLACE` fungsi yang oleh 0007 sudah diganti dengan versi tanpa `visit`; menjalankannya lagi menimpa versi 0007 dengan versi lama yang masih menulis/mengunci `visit` (kini arsip, ditolak `VISIT_ARSIP`), sehingga RPC FO/layanan dan job akhir hari/no-show rusak. Hal yang sama untuk 0003 dan 0002 (penjaga/DROP/policy yang sudah ditimpa). Berkas 0002-0006 hanya dijalankan ulang bila rollback 0007 dilakukan lebih dulu. Skrip uji (`scripts/test-fo-eskalasi.mjs`, `test-chat-online.mjs`, `test-wp24.mjs`) hanya memakai transaksi ROLLBACK, sehingga aman.
- 0011 hanya SETELAH 0007 (penjaga membaca `visit_arsip_jaga()`; bila dijalankan sebelum 0007, `layanan_selesai` ditimpa lagi oleh 0007 dan validasi hilang).
- 0007 menolak (`CUTOVER_DITOLAK`) bila ada tiket `menunggu`/`dipanggil` hari ini: terapkan setelah antrean kosong (Jumat setelah 16:00 WIB atau akhir pekan, Gerbang G.6), bersamaan dengan deploy klien. Muat ulang skema PostgREST setelah setiap migrasi.
- Setelah migrasi diterapkan lewat `scripts/apply-migration.mjs`, ledger `supabase_migrations.schema_migrations` TIDAK ikut tercatat; catat kemudian lewat `scripts/fill-migration-ledger.mjs` (izin CEO).
- Urutan lengkap, rollback, dan verifikasi pasca: `docs/RUNBOOK_FO_ESKALASI.md`.

> **PERINGATAN URUTAN DEPLOY.** Menu "Kelola FAQ" untuk Front Office sudah dibuka di `src/lib/admin-nav.ts`. Urutan yang benar: `202610130001` -> `202610130002` -> **baru** deploy kode UI FO. Bila kode di-deploy SEBELUM kedua migrasi diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`, karena `202610130001` belum melonggarkannya); bila hanya `202610130002` yang belum, FO ber-layanan masih dapat menulis FAQ layanannya dan memindahkan baris. Migrasi idempoten dan tidak mengubah baris data.

## Perbaikan temuan review (0012) dan perubahan in-place 0009

### Baris tabel urutan terapan

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140012 | `202610140012_perbaikan_review.sql` | 0011 (+0009, 0007, pg_cron, tabel `hari_libur`) — penjaga `PRASYARAT` | `docs/rollback-perbaikan-review-202610140012.sql` (setelah rollback 0013; menolak selama penanda 0013 ada) | ditulis, belum diterapkan |

Urutan cutover menjadi `0002 -> ... -> 0008 -> 0009 -> 0011 -> 0012 -> 0013`. Urutan rollback: `0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> ...` (0013: lihat bagian "Keterbukaan data antar Front Office (0013)").

### Catatan perubahan in-place 202610140012 (belum diterapkan; keputusan CEO 2026-10-14)

`202610140012_perbaikan_review.sql` DIUBAH in-place (diizinkan karena belum diterapkan di produksi; entri manifest dihapus lalu diregenerasi dengan `node scripts/gen-migration-manifest.mjs`):
- #1 `layanan_selesai`: pengecualian "Admin pengambil alih menutup tanpa form" dan audit `layanan_selesai_tanpa_pendataan` DIHAPUS; kewajiban form berlaku untuk semua peran. Tiket macet tanpa data hanya ditutup jalur otomatis `tutup_penanganan_tertinggal` (0008, 23:00 WIB).
- #13 baru (hari tanpa pelayanan = Sabtu/Minggu/`hari_libur`): fungsi `hari_tanpa_layanan(date)`; `chat_ambil`/`chat_teruskan` menolak `HARI_TANPA_LAYANAN`; trigger eskalasi chat (`chat_sesi_eskalasi_kunjungan`, `chat_pesan_eskalasi_kunjungan`) tidak mencatat kunjungan pada hari itu. Fungsi 0009 itu di-`CREATE OR REPLACE` penuh di 0012 (berkas 0009 TIDAK diubah); rollback 0012 memulihkannya persis dari 0009 lalu `DROP FUNCTION hari_tanpa_layanan(date)`.
- Uji perilaku: `scripts/test-perbaikan-review.mjs` seksi 2 (Admin pengambil alih wajib form, jalur otomatis) dan seksi 9 (#13; menandai hari ini sebagai `hari_libur` di dalam savepoint) — **belum dijalankan** (hanya di luar jam layanan). `scripts/test-chat-online.mjs` kini berhenti pada Sabtu/Minggu/hari libur bila 0012 sudah terpasang (jalankan pada hari kerja setelah 17:00 WIB).
- Klien: `/chat`, `/admin/chat`, `/api/chat/ai` menilai hari sendiri dari tabel `hari_libur` (tidak memanggil `hari_tanpa_layanan`), jadi aman di-deploy sebelum/sesudah 0012; tanpa 0012 hanya penegakan DB yang belum ada.

### Catatan perubahan in-place 202610140009 (belum diterapkan)

`202610140009_chat_online.sql` DIUBAH in-place (diizinkan karena belum diterapkan; hanya trigger dan backfill):
- trigger `trg_chat_sesi_eskalasi_kunjungan` kini mensyaratkan minimal satu pesan pengunjung;
- trigger baru `trg_chat_pesan_eskalasi_kunjungan` (AFTER INSERT `chat_pesan`, pengirim `pengunjung`) + fungsi `chat_pesan_eskalasi_kunjungan()`;
- backfill hanya sesi `eskalasi`/`aktif` yang punya pesan pengunjung dan aktivitas terakhir <= 24 jam.
Entri manifest 0009 dihapus lalu diregenerasi (`node scripts/gen-migration-manifest.mjs`); hash baru `ac5602d8...b932ff`. Rollback 0009 ikut diperbarui (drop trigger/fungsi baru + penjaga 0012). Uji perilaku `scripts/test-chat-online.mjs` (lolos 99/99 pada versi lama 2026-10-14 06:14 WIB) **wajib diulang**; skrip sudah disesuaikan.

### Larangan (tambahkan ke bagian larangan)

- JANGAN menerapkan ulang 202610140004 atau 202610140005 setelah 0007: menimpa fungsi versi 0007/0011/0012 tanpa galat. Bila terlanjur, terapkan ulang 0007 -> 0008 -> 0009 -> 0011 -> 0012 (idempoten). 0004/0005 tidak diberi penjaga (biaya: hash manifest berubah); ditegakkan lewat runbook.
- Penjaga urutan rollback (DO di awal berkas): rollback 0011, 0009, 0007 menolak bila 0012 masih ada; rollback 0007 juga menolak bila 0011 masih ada; rollback 0012 menolak bila 0011/0009 sudah tidak ada.

### Perintah

```
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (siang, read-only, di-ROLLBACK): berhenti di penjaga `PRASYARAT: 202610140011_pendataan_wajib belum diterapkan` (benar). Dry-run 0009 (setelah diubah): berhenti di `PRASYARAT: tabel penanganan/topik_penanganan belum ada` (benar).

## Keterbukaan data antar Front Office (0013)

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140013 | `202610140013_fo_keterbukaan_data.sql` | 0012 (`hari_tanpa_layanan`) + 0009 (`chat_buat_kunjungan`) + 0003 (`penanganan`, `boleh_penanganan`) — penjaga `PRASYARAT` | `docs/rollback-fo-keterbukaan-data-202610140013.sql` (PERTAMA dalam urutan rollback; memulihkan `boleh_penanganan` persis versi 0009) | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO** |

Keputusan CEO 2026-10-14 (keterbukaan data antar FO): semua FO membaca semua `penanganan` (tahap `fo` dan `layanan`, semua tanggal). Hanya `boleh_penanganan` (cabang `front_office` = `RETURN true`) yang diganti; cabang lain identik 0009; tanpa policy/GRANT/DML baru; tabel `penanganan` tetap baca-saja bagi klien (tulis hanya RPC pemilik tahap). Tabel lain (`kunjungan`, `tiket_antrean`, `pelayanan_*`, `petugas`) sudah terbuka untuk FO sebelum ini dan tidak diubah. Penanda: komentar fungsi `boleh_penanganan` memuat `202610140013` (dipakai penjaga rollback 0012). Rincian akses sebelum/sesudah: `docs/analysis/04-RBAC-MATRIX.md` §6.4. Pilihan berkas baru (bukan in-place 0012): satu keputusan akses yang berdiri sendiri, bisa di-rollback terpisah dari perbaikan review; 0012 tidak diubah (hanya rollback 0012 mendapat penjaga baru).

```
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (read-only, di-ROLLBACK): berhenti di `PRASYARAT: tabel penanganan / boleh_penanganan belum ada (202610140003_fo_model_data)` (benar). Dry-run kedua rollback (0013 dan 0012 yang diberi penjaga baru) juga berhenti di penjaganya masing-masing tanpa perubahan. Klien (rekap tanpa batas "milik sendiri", kolom Front Office) aman di-deploy sebelum/sesudah 0013: tanpa 0013 RLS lama hanya membuat data FO tidak lengkap, tidak bocor. Uji perilaku: `scripts/test-fo-keterbukaan.mjs` (**belum dijalankan**; hanya di luar jam layanan; skrip menolak Senin-Jumat 07:00-16:59 WIB).

, disimpan kanonik (DETAIL `kontak_hp`).
- kategori WAJIB: `Umum` | `UMKM` | `Investor` | `Instansi` (DETAIL `kategori`).
- email WAJIB: trim + huruf kecil; ≤ 254; `^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}# Database Migrations

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
| `202610140003_fo_model_data.sql` | Tahap B model data: `layanan.prefiks_antrean` 2 huruf unik (NOT NULL, CHECK `^[A-Z]{2}$`, backfill OS/NO/BM/BL/BP/IG/JI/MU/SH/SM, auto-generate via trigger); `terbit_tiket` -> tanggal WIB hari ini + format `OS-014`; `kunjungan` (asal `online`, `chat_sesi_id`, `selesai_at` jam server, data pengunjung walk-in, data reservasi, `client_request_id`, `dibuat_oleh`; `kunjungan_staff_update` dicabut); tabel `topik_penanganan` (+ seed FO dan 10 layanan) dan `penanganan` (RLS SELECT saja); `tiket_antrean` (`penanganan_asal_id`, `dialihkan_ke`, status `dikembalikan`/`dialihkan`). **Diterapkan pada jendela cutover Tahap B, SETELAH 202610140002, sebelum 0004/0005.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-model-data-202610140003.sql` (paling akhir; menghapus tabel/kolom baru; ditolak bila ada data penanganan kecuali `lmh.rollback_paksa`) |
| `202610140004_fo_rpc.sql` | Tahap B RPC: `fo_mulai_kunjungan`, `fo_checkin_reservasi`, `fo_tolak_reservasi`, `fo_selesai`, `fo_eskalasi` (tiket baru + notifikasi petugas), `fo_ambil_dari_kotak_masuk` (atomik), `layanan_kembalikan`, `admin_alihkan` (audit_log), `reservasi_buat`, `reservasi_batalkan`; semua `sesi_valid()`, waktu server. Kontrak UI: `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md`. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-rpc-202610140004.sql` (setelah rollback 0005) |
| `202610140005_fo_selaras_antrean.sql` | Tahap B penyelarasan: `layanan_mulai`/`layanan_selesai` (signature baru `(uuid, text, jsonb, uuid, text)`; topik + catatan wajib untuk tiket hasil eskalasi)/`admin_ambil_alih` menggerakkan tahap `penanganan`; `get_queue_position`, `tandai_tidak_terlayani_akhir_hari`, `tandai_reservasi_no_show`, `rollup_rekap_harian` memahami tiket/reservasi tanpa `visit` dan status baru. Sinkron `visit` A3 dipertahankan (WP-24). | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-fo-selaras-antrean-202610140005.sql` (pertama; memulihkan 7 fungsi persis) |
| `202610140006_pernyataan_kebenaran.sql` | Kunci Nama Lengkap pengunjung (C2/K12, keputusan CEO G.3 Opsi A): `pengunjung_profil_lengkap(...)` (definisi "profil lengkap" tanpa NIK), trigger `trg_jaga_nama_pengunjung` (nama tidak bisa diubah pemilik setelah profil lengkap; profil lengkap tidak bisa dikosongkan; dikecualikan service_role/pg_cron dan flag `lmh.ubah_nama`), RPC `ubah_nama_pengunjung(uuid, text, text)` (admin/FO aktif, `sesi_valid()`, alasan wajib, `audit_log`). Tanpa kolom/tabel baru; `consent_log` tidak diubah. Syarat: `202610140001`, `202610080001`, `202610090004`, `202607240001`. **Terapkan SEBELUM deploy klien C2; profil yang sudah lengkap langsung terkunci.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-pernyataan-kebenaran-202610140006.sql` |
| `202610140007_wp24_akhiri_dual_write.sql` | WP-24 (Gerbang G.1 Opsi A): `visit` menjadi arsip (8 trigger efek DISABLE, `trg_visit_arsip`, policy/hak tulis dicabut, penjaga A3 dihapus); reservasi lama dilengkapi/dibuatkan `kunjungan`; RPC FO/layanan + job akhir hari/no-show tanpa `visit` (`fo_sinkron_visit` dihapus); SKM, notifikasi, response rate, audit, `mv_estimasi_layanan`/`v_antrian_loket`, `jumlah_terdaftar`, `metrik_kepatuhan` pindah ke `kunjungan`/`tiket_antrean`; `skm_respons.kunjungan_id`. Penjaga: prasyarat 0003..0006 + antrean kosong (`CUTOVER_DITOLAK`). | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-wp24-akhiri-dual-write-202610140007.sql` (setelah rollback 0008) |
| `202610140008_wp24_tutup_otomatis_retensi.sql` | `batal_karena` += `tidak_ditutup`; `tutup_penanganan_tertinggal()` + job `penanganan_tutup_otomatis` (23:00 WIB); anonimisasi 730 hari mencakup `kunjungan`, `penanganan.catatan`, arsip `visit`. Syarat: 0007. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql` (pertama) |
| `202610140009_chat_online.sql` | Tahap C live chat = layanan online tercatat (K8/K10): `chat_sesi.kunjungan_id`; eskalasi membuat `kunjungan` asal `online` + tahap `penanganan` FO chat `menunggu` (trigger); RPC `chat_ambil` (atomik; petugas layanan boleh ambil langsung sebelum FO; Admin ambil alih + alasan + audit), `chat_teruskan` (handoff tanpa tiket + notifikasi petugas), `chat_selesai` (topik + catatan wajib, pesan penutup `penutup_survei`); penjaga `CHAT_HARUS_RPC` atas kolom staf `chat_sesi`; `boleh_penanganan`/`boleh_kunjungan` + cabang chat petugas; backfill sesi `eskalasi`/`aktif`. Syarat: 0003-0005. **Terapkan bersamaan dengan klien Tahap C; route lama `/api/chat/sesi` ditolak setelahnya.** | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-chat-online-202610140009.sql` (sebelum rollback 0005) |
| `202610140011_pendataan_wajib.sql` | Tahap C3 (G.5): Pendataan semua field wajib. `pendataan_validasi_payload` (`INVALID_PAYLOAD`) dipanggil `layanan_selesai` (salinan persis 0007 + validasi); CHECK `tipe_pelaku_usaha`/`skala_usaha` dilonggarkan (+ opsi "tidak berlaku"). Penjaga: 0007 harus sudah diterapkan. Data lama tidak disentuh. | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO.** | `docs/rollback-pendataan-wajib-202610140011.sql` |

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

Cara menerapkan Tahap B (menyentuh DB produksi; hanya setelah konfirmasi CEO; jendela cutover di luar jam layanan dengan antrean kosong). Ketiganya membuat fungsi/policy, jadi WAJIB `--atomic`, berurutan:

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic
```

> **PERINGATAN Tahap B.** (1) Dry-run 0004 dan 0005 hanya bermakna bila 0003 (dan 0004) sudah ada; dry-run berurutan terpisah akan gagal di penjaga prasyarat. Untuk pratinjau gabungan pakai `scripts/test-fo-eskalasi.mjs` (ketiganya di satu transaksi yang di-ROLLBACK). (2) Deploy klien Tahap B bersamaan: Kelola Layanan (prefiks 2 huruf), halaman FO (kotak masuk, penanganan, eskalasi), scan QR (`fo_checkin_reservasi`), `me/reservasi` (`reservasi_buat`), antrean petugas (`layanan_selesai` + topik/catatan, `layanan_kembalikan`), Admin (`admin_alihkan`). (3) WP-24 (mematikan dual-write `visit`) ditulis sebagai 0007/0008 (lihat di bawah); selama 0007 belum diterapkan, SKM/notifikasi/estimasi untuk kunjungan baru tanpa `visit` belum berjalan. (4) Rollback urutan terbalik: 0005 -> 0004 -> 0003.

Cara menerapkan 0007, 0008, 0009, dan 0011 (menyentuh DB produksi; hanya setelah konfirmasi CEO; di luar jam layanan dengan antrean kosong). Semuanya WAJIB `--atomic`, selalu `--dry-run` dulu. Dry-run tunggal hanya bermakna bila prasyaratnya sudah terpasang (penjaga `PRASYARAT` menolak di produksi saat ini, ROLLBACK, tidak mengubah apa pun):

```bash
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic
```

Pratinjau gabungan sebelum 0003-0005 diterapkan (satu transaksi, selalu ROLLBACK; skrip menolak jam layanan Senin-Jumat 07:00-16:59 WIB): `node scripts/test-chat-online.mjs --pre 0002 --pre 0003 --pre 0004 --pre 0005 --apply 202610140009_chat_online.sql` (path lengkap per berkas) dan `scripts/test-wp24.mjs` (lihat `docs/RUNBOOK_FO_ESKALASI.md`).

### URUTAN TERAPAN (satu jendela cutover) dan larangan

Status per 2026-10-14: hanya `202610140001` yang DITERAPKAN; `0002`-`0009`, `0011`, `0012`, dan `0013` DITULIS, BELUM DITERAPKAN. Nomor `0010` tidak dipakai (tidak ada berkasnya).

```
0002 -> 0003 -> 0004 -> 0005 -> 0006 -> 0007 -> 0008 -> 0009 -> 0011 -> 0012 -> 0013
```

- Rollback = urutan terbalik: 0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> 0006 -> 0005 -> 0004 -> 0003 -> 0002 (0009 sebelum 0005; 0008 sebelum 0007; 0007 setelah 0008 dan sebelum 0006/0005/0004/0003/0002).
- **DILARANG menerapkan ulang 0004 atau 0005 SETELAH 0007 diterapkan.** Keduanya `CREATE OR REPLACE` fungsi yang oleh 0007 sudah diganti dengan versi tanpa `visit`; menjalankannya lagi menimpa versi 0007 dengan versi lama yang masih menulis/mengunci `visit` (kini arsip, ditolak `VISIT_ARSIP`), sehingga RPC FO/layanan dan job akhir hari/no-show rusak. Hal yang sama untuk 0003 dan 0002 (penjaga/DROP/policy yang sudah ditimpa). Berkas 0002-0006 hanya dijalankan ulang bila rollback 0007 dilakukan lebih dulu. Skrip uji (`scripts/test-fo-eskalasi.mjs`, `test-chat-online.mjs`, `test-wp24.mjs`) hanya memakai transaksi ROLLBACK, sehingga aman.
- 0011 hanya SETELAH 0007 (penjaga membaca `visit_arsip_jaga()`; bila dijalankan sebelum 0007, `layanan_selesai` ditimpa lagi oleh 0007 dan validasi hilang).
- 0007 menolak (`CUTOVER_DITOLAK`) bila ada tiket `menunggu`/`dipanggil` hari ini: terapkan setelah antrean kosong (Jumat setelah 16:00 WIB atau akhir pekan, Gerbang G.6), bersamaan dengan deploy klien. Muat ulang skema PostgREST setelah setiap migrasi.
- Setelah migrasi diterapkan lewat `scripts/apply-migration.mjs`, ledger `supabase_migrations.schema_migrations` TIDAK ikut tercatat; catat kemudian lewat `scripts/fill-migration-ledger.mjs` (izin CEO).
- Urutan lengkap, rollback, dan verifikasi pasca: `docs/RUNBOOK_FO_ESKALASI.md`.

> **PERINGATAN URUTAN DEPLOY.** Menu "Kelola FAQ" untuk Front Office sudah dibuka di `src/lib/admin-nav.ts`. Urutan yang benar: `202610130001` -> `202610130002` -> **baru** deploy kode UI FO. Bila kode di-deploy SEBELUM kedua migrasi diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`, karena `202610130001` belum melonggarkannya); bila hanya `202610130002` yang belum, FO ber-layanan masih dapat menulis FAQ layanannya dan memindahkan baris. Migrasi idempoten dan tidak mengubah baris data.

## Perbaikan temuan review (0012) dan perubahan in-place 0009

### Baris tabel urutan terapan

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140012 | `202610140012_perbaikan_review.sql` | 0011 (+0009, 0007, pg_cron, tabel `hari_libur`) — penjaga `PRASYARAT` | `docs/rollback-perbaikan-review-202610140012.sql` (setelah rollback 0013; menolak selama penanda 0013 ada) | ditulis, belum diterapkan |

Urutan cutover menjadi `0002 -> ... -> 0008 -> 0009 -> 0011 -> 0012 -> 0013`. Urutan rollback: `0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> ...` (0013: lihat bagian "Keterbukaan data antar Front Office (0013)").

### Catatan perubahan in-place 202610140012 (belum diterapkan; keputusan CEO 2026-10-14)

`202610140012_perbaikan_review.sql` DIUBAH in-place (diizinkan karena belum diterapkan di produksi; entri manifest dihapus lalu diregenerasi dengan `node scripts/gen-migration-manifest.mjs`):
- #1 `layanan_selesai`: pengecualian "Admin pengambil alih menutup tanpa form" dan audit `layanan_selesai_tanpa_pendataan` DIHAPUS; kewajiban form berlaku untuk semua peran. Tiket macet tanpa data hanya ditutup jalur otomatis `tutup_penanganan_tertinggal` (0008, 23:00 WIB).
- #13 baru (hari tanpa pelayanan = Sabtu/Minggu/`hari_libur`): fungsi `hari_tanpa_layanan(date)`; `chat_ambil`/`chat_teruskan` menolak `HARI_TANPA_LAYANAN`; trigger eskalasi chat (`chat_sesi_eskalasi_kunjungan`, `chat_pesan_eskalasi_kunjungan`) tidak mencatat kunjungan pada hari itu. Fungsi 0009 itu di-`CREATE OR REPLACE` penuh di 0012 (berkas 0009 TIDAK diubah); rollback 0012 memulihkannya persis dari 0009 lalu `DROP FUNCTION hari_tanpa_layanan(date)`.
- Uji perilaku: `scripts/test-perbaikan-review.mjs` seksi 2 (Admin pengambil alih wajib form, jalur otomatis) dan seksi 9 (#13; menandai hari ini sebagai `hari_libur` di dalam savepoint) — **belum dijalankan** (hanya di luar jam layanan). `scripts/test-chat-online.mjs` kini berhenti pada Sabtu/Minggu/hari libur bila 0012 sudah terpasang (jalankan pada hari kerja setelah 17:00 WIB).
- Klien: `/chat`, `/admin/chat`, `/api/chat/ai` menilai hari sendiri dari tabel `hari_libur` (tidak memanggil `hari_tanpa_layanan`), jadi aman di-deploy sebelum/sesudah 0012; tanpa 0012 hanya penegakan DB yang belum ada.

### Catatan perubahan in-place 202610140009 (belum diterapkan)

`202610140009_chat_online.sql` DIUBAH in-place (diizinkan karena belum diterapkan; hanya trigger dan backfill):
- trigger `trg_chat_sesi_eskalasi_kunjungan` kini mensyaratkan minimal satu pesan pengunjung;
- trigger baru `trg_chat_pesan_eskalasi_kunjungan` (AFTER INSERT `chat_pesan`, pengirim `pengunjung`) + fungsi `chat_pesan_eskalasi_kunjungan()`;
- backfill hanya sesi `eskalasi`/`aktif` yang punya pesan pengunjung dan aktivitas terakhir <= 24 jam.
Entri manifest 0009 dihapus lalu diregenerasi (`node scripts/gen-migration-manifest.mjs`); hash baru `ac5602d8...b932ff`. Rollback 0009 ikut diperbarui (drop trigger/fungsi baru + penjaga 0012). Uji perilaku `scripts/test-chat-online.mjs` (lolos 99/99 pada versi lama 2026-10-14 06:14 WIB) **wajib diulang**; skrip sudah disesuaikan.

### Larangan (tambahkan ke bagian larangan)

- JANGAN menerapkan ulang 202610140004 atau 202610140005 setelah 0007: menimpa fungsi versi 0007/0011/0012 tanpa galat. Bila terlanjur, terapkan ulang 0007 -> 0008 -> 0009 -> 0011 -> 0012 (idempoten). 0004/0005 tidak diberi penjaga (biaya: hash manifest berubah); ditegakkan lewat runbook.
- Penjaga urutan rollback (DO di awal berkas): rollback 0011, 0009, 0007 menolak bila 0012 masih ada; rollback 0007 juga menolak bila 0011 masih ada; rollback 0012 menolak bila 0011/0009 sudah tidak ada.

### Perintah

```
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140012_perbaikan_review.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (siang, read-only, di-ROLLBACK): berhenti di penjaga `PRASYARAT: 202610140011_pendataan_wajib belum diterapkan` (benar). Dry-run 0009 (setelah diubah): berhenti di `PRASYARAT: tabel penanganan/topik_penanganan belum ada` (benar).

## Keterbukaan data antar Front Office (0013)

| Versi | Berkas | Prasyarat | Rollback | Status |
|---|---|---|---|---|
| 202610140013 | `202610140013_fo_keterbukaan_data.sql` | 0012 (`hari_tanpa_layanan`) + 0009 (`chat_buat_kunjungan`) + 0003 (`penanganan`, `boleh_penanganan`) — penjaga `PRASYARAT` | `docs/rollback-fo-keterbukaan-data-202610140013.sql` (PERTAMA dalam urutan rollback; memulihkan `boleh_penanganan` persis versi 0009) | **DITULIS, BELUM DITERAPKAN ke produksi; menunggu konfirmasi CEO** |

Keputusan CEO 2026-10-14 (keterbukaan data antar FO): semua FO membaca semua `penanganan` (tahap `fo` dan `layanan`, semua tanggal). Hanya `boleh_penanganan` (cabang `front_office` = `RETURN true`) yang diganti; cabang lain identik 0009; tanpa policy/GRANT/DML baru; tabel `penanganan` tetap baca-saja bagi klien (tulis hanya RPC pemilik tahap). Tabel lain (`kunjungan`, `tiket_antrean`, `pelayanan_*`, `petugas`) sudah terbuka untuk FO sebelum ini dan tidak diubah. Penanda: komentar fungsi `boleh_penanganan` memuat `202610140013` (dipakai penjaga rollback 0012). Rincian akses sebelum/sesudah: `docs/analysis/04-RBAC-MATRIX.md` §6.4. Pilihan berkas baru (bukan in-place 0012): satu keputusan akses yang berdiri sendiri, bisa di-rollback terpisah dari perbaikan review; 0012 tidak diubah (hanya rollback 0012 mendapat penjaga baru).

```
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic
```

Dry-run terhadap produksi 2026-10-14 (read-only, di-ROLLBACK): berhenti di `PRASYARAT: tabel penanganan / boleh_penanganan belum ada (202610140003_fo_model_data)` (benar). Dry-run kedua rollback (0013 dan 0012 yang diberi penjaga baru) juga berhenti di penjaganya masing-masing tanpa perubahan. Klien (rekap tanpa batas "milik sendiri", kolom Front Office) aman di-deploy sebelum/sesudah 0013: tanpa 0013 RLS lama hanya membuat data FO tidak lengkap, tidak bocor. Uji perilaku: `scripts/test-fo-keterbukaan.mjs` (**belum dijalankan**; hanya di luar jam layanan; skrip menolak Senin-Jumat 07:00-16:59 WIB).

 (DETAIL `email`).
- keperluan WAJIB: trim; 10–500; minimal 10 karakter selain spasi (DETAIL `keperluan`).
- layanan saran: tetap opsional (`NULL` = "Belum tahu"); bila diisi wajib aktif (`LAYANAN_TIDAK_VALID`).

Semua penolakan field: `DATA_TIDAK_VALID` (22023) dengan DETAIL = nama field. Kontrak klien:
`docs/analysis/FO-ESKALASI-KONTRAK-RPC.md` §2.1. Penanda: komentar fungsi `fo_mulai_kunjungan` memuat `202610140014`.
KLIEN: halaman `/admin/fo/daftar` (semua field wajib) di-deploy sebelum atau bersamaan dengan migrasi; klien lama yang
mengosongkan HP/email/kategori/keperluan akan ditolak. Antrean offline: item lama tak sah ditolak permanen dan dibuang
(`galatFoMulaiPermanen` sudah memasukkan `DATA_TIDAK_VALID`); item yang sudah tercatat tetap `sudah_ada`.

    node scripts/apply-migration.mjs supabase/migrations/202610140014_walkin_data_lengkap.sql --atomic --dry-run
    node scripts/apply-migration.mjs supabase/migrations/202610140014_walkin_data_lengkap.sql --atomic

Dry-run terhadap produksi 2026-10-14 ±21:29 WIB (DB memuat 0013; di-ROLLBACK): seluruh berkas berhasil dieksekusi
(penjaga PRASYARAT lolos); dry-run rollback juga berhasil. Uji perilaku: `node scripts/test-walkin-data.mjs --apply
supabase/migrations/202610140014_walkin_data_lengkap.sql` (di luar jam layanan; ROLLBACK) 2026-10-14 ±21:29 WIB:
**96 lolos, 0 gagal**; snapshot katalog setelah rollback identik; baris SEBELUM == SESUDAH.
```

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
