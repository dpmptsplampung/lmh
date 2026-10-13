# LOG PERUBAHAN BASIS DATA PRODUKSI

> **Tujuan:** sesuai izin pemilik (29 Jul 2026): *"kamu boleh lakukan apapun di DB production, asalkan kamu tandai mana saja yang kamu rubah, dan nanti bisa dikembalikan ke kondisi awalnya."*
>
> **Database:** `krxzbputwaqkvmjflram.supabase.co` (PRODUKSI).
> **Data paling penting menurut pemilik:** data pengunjung yang sudah tercatat (`pengunjung`, `visit`, dst). Tabel lain masih kosong/hampir kosong.
>
> **Aturan pengisian log:** SETIAP perubahan pada DB produksi (migrasi, backfill, UPDATE data, perubahan konfigurasi) WAJIB dicatat di sini **SEBELUM atau SEGERA SETELAH** dieksekusi, lengkap dengan **cara mengembalikan** ke kondisi awal.

---

## Format entri

```
### [2026-10-13] — Pengisian ledger migrasi produksi (atas izin CEO)
- Tindakan     : `scripts/fill-migration-ledger.mjs --apply --yes` mencatat 40 migrasi berstatus `terpasang` (202607290001 s.d. 202610130001) ke `supabase_migrations.schema_migrations`; lalu `202610130002_faq_petugas_hanya_petugas` dicatat manual (policy `faq_petugas_all` terbukti memuat cek peran petugas).
- Hasil        : ledger 13 -> 54 entri (terakhir 202610130002).
- TIDAK dicatat (5, harus diputuskan manual sebelum `db push`): `202608040001` (catat_pulang_rpc), `202608080001` (chat_realtime_publication), `202608310001` (finalize_pelayanan_rpc) — tidak dapat ditentukan (objek bersama, fungsinya sudah versi lebih baru); `202608310003` (absensi_foto_fo, berkas no-op); `202609020001` (estimasi_hari_libur) — TIDAK ditemukan di produksi (indeks `idx_hari_libur_tanggal`, policy `hari_libur_staff_write`).
- Catatan      : `supabase db push` tetap JANGAN dipakai sebelum lima migrasi itu diputuskan (terutama `202609020001`, yang akan membuat ulang policy yang sengaja dihapus `202610080002`).

### [YYYY-MM-DD HH:mm WIB] — <judul perubahan>
- WP/Migrasi   : <WP-xx / nama file migrasi / "manual">
- Jenis        : DDL (struktur) / DATA (isi) / KONFIGURASI
- Objek        : <tabel/kolom/fungsi/bucket yang disentuh>
- Menyentuh data pengunjung? : Ya/Tidak
- Ringkasan    : <apa yang berubah>
- Cara mengembalikan : <langkah nyata untuk kembali ke kondisi sebelumnya>
- Status       : DITERAPKAN / DIKEMBALIKAN
```

---

## Riwayat (dari yang terbaru)

### [2026-10-13] — FAQ: `faq_petugas_all` hanya untuk peran petugas (M-202610130002) — DITERAPKAN 2026-10-13
- WP/Migrasi   : lanjutan 202610130001 (hasil review independen) / `supabase/migrations/202610130002_faq_petugas_hanya_petugas.sql` + test kontrak `supabase/migrations/faq_petugas_hanya_petugas.test.ts` + rollback `docs/rollback-faq-petugas-hanya-petugas-202610130002.sql`
- Jenis        : DDL (policy RLS); tidak ada perubahan data
- Objek        : policy `faq_petugas_all` pada `public.faq_knowledge_base` (`DROP POLICY IF EXISTS` + `CREATE POLICY`; nama, `FOR ALL`, `TO authenticated` tetap). `USING` dan `WITH CHECK` berubah dari `layanan_id = get_my_layanan_id()` menjadi `layanan_id = get_my_layanan_id() AND get_my_role() = 'petugas'`. Policy lain (`faq_admin_all`, `faq_public_read`, `faq_fo_umum`), fungsi, kolom, dan data TIDAK diubah.
- Menyentuh data pengunjung? : Tidak
- Ringkasan    : celah: definisi lama (`202607280003:5-7`) tidak memeriksa peran, dan `get_my_layanan_id()` (`202610080001`) mengembalikan `petugas.layanan_id` untuk petugas aktif berperan APA PUN. Front Office yang baris `petugas`-nya punya `layanan_id` tetap boleh menulis FAQ layanannya, dan bersama `faq_fo_umum` dapat memindahkan baris antara FAQ umum dan FAQ layanan (`UPDATE layanan_id = NULL`: baris lama lolos `faq_petugas_all`, baris baru lolos `faq_fo_umum`). Setelah migrasi: petugas layanan hanya FAQ layanannya, FO hanya FAQ umum (baris `layanan_id IS NULL`), admin semua; tidak ada jalur FO ke baris ber-layanan maupun memindahkan baris. Perilaku petugas biasa tidak berubah.
- Cara menerapkan : WAJIB `--atomic` (mengubah policy), SETELAH `202610130001_faq_umum.sql`: `node scripts/apply-migration.mjs supabase/migrations/202610130002_faq_petugas_hanya_petugas.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten. Urutan: `202610130001` -> `202610130002` -> baru deploy kode UI FO. **PERINGATAN:** menu "Kelola FAQ" untuk FO sudah dibuka di `src/lib/admin-nav.ts`; bila kode di-deploy SEBELUM kedua migrasi diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-faq-petugas-hanya-petugas-202610130002.sql --atomic` (`--dry-run` dulu); memulihkan definisi `202607280003` (celah FO ber-layanan terbuka kembali). Bila `202610130001` ikut dikembalikan, jalankan rollback ini lebih dulu.
- Status       : DITERAPKAN ke produksi 2026-10-13 (`apply-migration.mjs --atomic`, dry-run lalu COMMIT; atas izin CEO di sesi). Diverifikasi read-only: kolom nullable, policy sesuai, fungsi pencarian memuat FAQ umum, 80 baris FAQ utuh. Ledger `schema_migrations` BELUM dicatat (lihat pengisian ledger). Test kontrak statis (termasuk simulasi logis gabungan policy) lulus; perilaku RLS di DB belum diuji terhadap database.

### [2026-10-13] — FAQ umum: `layanan_id` boleh NULL + policy Front Office + pencarian FAQ umum (M-202610130001) — DITERAPKAN 2026-10-13
- WP/Migrasi   : tugas 1.5 (spec `docs/superpowers/specs/2026-10-12-mutasi-tercek-design.md` §3.3) / `supabase/migrations/202610130001_faq_umum.sql` + test kontrak `supabase/migrations/faq_umum.test.ts` + rollback `docs/rollback-faq-umum-202610130001.sql`
- Jenis        : DDL (kolom, policy, fungsi); tidak ada perubahan data
- Objek        :
  - `public.faq_knowledge_base.layanan_id`: `DROP NOT NULL` (NULL = FAQ umum) + `COMMENT ON COLUMN`
  - policy baru `faq_fo_umum` (`FOR ALL TO authenticated`; `USING` dan `WITH CHECK` = `layanan_id IS NULL AND get_my_role() = 'front_office'`). `faq_admin_all`, `faq_petugas_all` (`layanan_id = get_my_layanan_id()`, tidak menjangkau baris NULL), dan `faq_public_read` TIDAK diubah
  - `public.match_faq_teks(uuid, text, integer)`: `CREATE OR REPLACE`; kondisi `f.layanan_id = p_layanan` menjadi `(f.layanan_id = p_layanan OR f.layanan_id IS NULL)`; urutan `skor DESC, (f.layanan_id IS NULL)` (FAQ layanan didahulukan pada skor persis sama). Definisi lama: `202609230002_faq_fts.sql`. Kolom hasil, SECURITY DEFINER, `search_path`, REVOKE/GRANT identik
  - `public.match_faq(extensions.vector, uuid, integer)` (3072-dim): `CREATE OR REPLACE`; kondisi menjadi `(p_layanan_id IS NULL OR faq.layanan_id = p_layanan_id OR faq.layanan_id IS NULL)`; kunci urut sekunder `(faq.layanan_id IS NULL)`. Definisi lama: `202608080002_faq_embedding_3072.sql`. Kolom hasil, SECURITY DEFINER, `search_path`, REVOKE/GRANT identik
- Menyentuh data pengunjung? : Tidak (data FAQ tidak diubah; trigger audit `trg_audit_faq` dan `trg_faq_reembed` tidak bergantung pada NOT NULL)
- Ringkasan    : keputusan CEO: FAQ umum dikelola Front Office dan Admin; petugas layanan hanya FAQ layanannya; Admin semua. FAQ umum ikut dijawab bot di layanan mana pun. Alternatif "layanan semu Umum" ditolak (mencemari daftar layanan publik, antrean, jadwal, rekap).
- Cara menerapkan : migrasi mengubah policy dan fungsi, jadi WAJIB `--atomic` (lihat komentar `scripts/apply-migration.mjs`): `node scripts/apply-migration.mjs supabase/migrations/202610130001_faq_umum.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten. Tidak ditulis ke ledger `supabase_migrations.schema_migrations` (skrip tidak menulis ledger).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-faq-umum-202610130001.sql --atomic` (`--dry-run` dulu). Rollback memulihkan kedua fungsi ke definisi lama, menghapus `faq_fo_umum`, lalu `SET NOT NULL`; ia MENOLAK seluruhnya (galat sebelum perubahan apa pun) bila masih ada FAQ umum, agar data umum tidak hilang/berpindah diam-diam.
- Kode yang bergantung (di luar migrasi): `src/lib/admin-nav.ts` (Kelola FAQ terbuka untuk `front_office`), `src/lib/faq-scope.ts`; halaman publik `src/app/chat/page.tsx` (`fetchFAQs`) kini memakai `.or('layanan_id.eq.<uuid>,layanan_id.is.null')` (FAQ layanan + FAQ umum) dan `src/app/admin/chat/faq/page.tsx` menampilkan/menyaring FAQ umum. **PERINGATAN URUTAN:** menu "Kelola FAQ" untuk FO sudah dibuka di `src/lib/admin-nav.ts`; bila kode di-deploy SEBELUM `202610130001` dan `202610130002` diterapkan, FO yang menyimpan FAQ umum gagal (INSERT `layanan_id NULL` melanggar `NOT NULL`). Terapkan `202610130001` -> `202610130002` -> baru deploy kode UI FO.
- Status       : DITERAPKAN ke produksi 2026-10-13 (`apply-migration.mjs --atomic`, dry-run lalu COMMIT; atas izin CEO di sesi). Diverifikasi read-only: kolom nullable, policy sesuai, fungsi pencarian memuat FAQ umum, 80 baris FAQ utuh. Ledger `schema_migrations` BELUM dicatat (lihat pengisian ledger). Test kontrak statis lulus; perilaku RLS/RPC di DB belum diuji terhadap database.

### Inventaris ledger 2026-10-13 — migrasi tak tercatat di `supabase_migrations.schema_migrations` (READ-ONLY)
- WP/Migrasi   : tugas 0.4 / `scripts/verify-migration-ledger.mjs` + `scripts/lib/migration-markers.mjs` (pengisi ledger `scripts/fill-migration-ledger.mjs` sudah ditulis, **BELUM dijalankan dengan `--apply`**)
- Jenis        : TIDAK ADA PERUBAHAN (read-only: `BEGIN READ ONLY` + hanya SELECT, diakhiri ROLLBACK)
- Objek        : dibaca `supabase_migrations.schema_migrations` dan katalog `pg_class`, `pg_attribute`, `pg_proc` (termasuk `prosrc`), `pg_policies`, `pg_indexes`, `pg_trigger`, `pg_constraint`, `pg_publication_tables`, `pg_extension`, `cron.job`, `storage.buckets`
- Menyentuh data pengunjung? : Tidak
- Ringkasan    :
  - Ledger produksi berisi **13 entri** (`202607140001` s.d. `202607280005`, nama sama dengan file). Repo memuat **57** file; **44 tidak tercatat** (`202607290001` s.d. `202610090005`) karena `scripts/apply-migration.mjs` tidak menulis ledger.
  - Hasil per migrasi tak tercatat: **terpasang 39**, sebagian 0, **tidak ditemukan 1**, **tidak dapat ditentukan 4**. Dasar: keberadaan objek yang dibuat tiap migrasi (tabel, kolom, tipe kolom, fungsi + jumlah argumen, indeks, policy, view, trigger, constraint, cron job, publikasi realtime, bucket) dan kecocokan isi fungsi (`pg_proc.prosrc`) dengan badan di migrasi. Dari 85 penanda fungsi yang isinya dibandingkan: 77 identik dengan definisi migrasi itu saja, 1 identik tetapi ada definisi lain berbadan sama, 7 sudah ditimpa versi migrasi yang lebih baru; tidak ada yang berisi versi lebih lama atau tidak cocok dengan definisi mana pun (komentar di dalam badan fungsi diabaikan; mis. `antrean_broadcast` di produksi tidak memuat komentar di badan fungsi yang ada di berkas `202609230003` di repo; selebihnya isinya identik).
  - `terpasang` (39): `202607290001`–`202607290013`, `202607300014`–`202607300024`, `202608080002`, `202608290001`, `202608310002`, `202609230001`–`202609230003`, `202610010001`, `202610070001`, `202610080001`–`202610080002`, `202610090001`–`202610090005`.
  - Bukan `terpasang`:

    | Migrasi | Status | Alasan |
    |---|---|---|
    | `202608040001_catat_pulang_rpc` | tidak dapat ditentukan | satu-satunya objek (`catat_pulang`, 1 arg) ada, tetapi isinya sudah versi `202610080001` (menimpa); tidak membuktikan migrasi ini |
    | `202608080001_chat_realtime_publication` | tidak dapat ditentukan | `chat_sesi`/`chat_pesan` ada di publikasi `supabase_realtime`, tetapi `202609230001` menambahkan hal yang sama; tidak dapat dibedakan |
    | `202608310001_finalize_pelayanan_rpc` | tidak dapat ditentukan | `finalize_pelayanan` (3 arg) ada, tetapi isinya sudah versi `202610010001` (menimpa) |
    | `202608310003_absensi_foto_fo` | tidak dapat ditentukan | berkas no-op (hanya komentar, tanpa pernyataan SQL); tidak ada yang dapat diperiksa |
    | `202609020001_estimasi_hari_libur` | **tidak ditemukan** | indeks `idx_hari_libur_tanggal` TIDAK ada (di `hari_libur` hanya `hari_libur_pkey`); policy `hari_libur_staff_write` juga tidak ada (yang ada: `hari_libur_admin_write`, `hari_libur_public_read`), sesuai catatan drift di `docs/RUNBOOK_RBAC_TAHAP0.md`. Migrasi ini **tidak terpasang**. **Peringatan regresi:** bila dijalankan sekarang (mis. `db push`) ia membuat ulang policy `hari_libur_staff_write` yang sengaja di-DROP `202610080002` |

  - Kontrol: 13 migrasi yang sudah tercatat diperiksa dengan metode yang sama; 11 `terpasang` dan 2 `tidak dapat ditentukan` (`202607280002`, `202607280005`: hanya objek bersama), tidak ada yang `tidak ditemukan`. Artinya `tidak dapat ditentukan` tidak berarti belum terpasang, hanya belum terbukti lewat katalog.
  - Yang TIDAK terverifikasi oleh metode ini: ekspresi policy, definisi view/trigger, dan perubahan data (UPDATE/INSERT, mis. penggantian nama layanan di `202610010001`).
  - Laporan lengkap per migrasi dan per penanda: [`LEDGER-VERIFIKASI-2026-10-13.md`](LEDGER-VERIFIKASI-2026-10-13.md).
- Cara mengembalikan : tidak diperlukan (tidak ada perubahan).
- Status       : SELESAI (read-only). Pencatatan ledger retroaktif BELUM dilakukan; menunggu konfirmasi CEO (lihat `docs/MIGRATIONS.md`, bagian "Ledger migrasi produksi").

### [2026-07-29 20:11 WIB] — Introspeksi skema READ-ONLY (fase A)
- WP/Migrasi   : fase A / `scripts/introspect-schema.mjs`
- Jenis        : TIDAK ADA PERUBAHAN (read-only)
- Objek        : katalog PostgREST (OpenAPI root), `SELECT` sampel kecil dari `layanan`, `layanan_jadwal`, `layanan_libur`, `petugas`, `visit`, `faq_knowledge_base`, `absensi_petugas`, `listing_umkm`
- Menyentuh data pengunjung? : Tidak (hanya baca; tidak ada INSERT/UPDATE/DELETE)
- Ringkasan    : mengambil snapshot skema & sampel data untuk inventarisasi; hasil di `docs/analysis/schema-live-snapshot.json`
- Cara mengembalikan : tidak diperlukan (tidak ada perubahan)
- Status       : SELESAI (read-only)

---

> Entri berikutnya akan dicatat di sini untuk setiap migrasi/backfill/UPDATE pada fase E.

### [2026-07-29 21:50 WIB] — WP-01 Perbaikan zona waktu (TANPA perubahan DB)
- WP/Migrasi   : WP-01
- Jenis        : TIDAK ADA PERUBAHAN DB (hanya kode klien)
- Objek        : `src/lib/time.ts` (baru), 8 file klien (lihat di bawah)
- Menyentuh data pengunjung? : Tidak
- Ringkasan    : ganti perhitungan "hari ini" dari UTC ke Asia/Jakarta (RPT-07). File: `admin/antrian/page.tsx`, `admin/page.tsx`, `admin/kunjungan/page.tsx`, `me/page.tsx`, `admin/absensi/page.tsx` (3x), `me/reservasi/page.tsx`, `admin/skm/page.tsx`. Tidak ada migrasi SQL, tidak ada UPDATE data.
- Cara mengembalikan : `git revert` commit WP-01 (helper baru + perubahan klien; tidak ada perubahan DB untuk dikembalikan)
- Status       : SELESAI (kode), menunggu deploy untuk efek produksi

### [2026-07-29 22:05 WIB] — WP-02 Migrasi observability error_log (M-202607290001)
- WP/Migrasi   : WP-02 / `202607290001_observability_error_log.sql`
- Jenis        : DDL (struktur) + KONFIGURASI (cron)
- Objek        : tabel `public.error_log` (+2 index), fungsi `log_error_event()`, `check_error_alert()`, policy `error_log_admin_read`, cron `observability_error_alert */5`. Plus fungsi jembatan `exec_sql` & `exec_query` (dibantu pemilik via SQL Editor).
- Menyentuh data pengunjung? : Tidak (tabel baru, 0 baris; tidak menyentuh `pengunjung`/`visit`)
- Ringkasan    : infrastruktur error tracking self-contained (SEC-03, tanpa biaya berulang). Alert email memakai tabel `notifikasi` + Resend yang sudah ada. Ambang default 10 error/5 menit; penerima via `app.error_alert_email` atau argumen.
- Cara mengembalikan : `DROP FUNCTION check_error_alert(int,int,text); DROP FUNCTION log_error_event(...); SELECT cron.unschedule('observability_error_alert'); DROP TABLE error_log;` (tabel 0 baris → aman). Fungsi `exec_sql`/`exec_query` dipertahankan untuk migrasi berikutnya.
- Status       : DITERAPKAN di produksi (terverifikasi: tabel, fungsi, cron, policy ada)

### [2026-07-29 22:15 WIB] — WP-02 Self-test observability (DATA uji, sudah dikembalikan)
- WP/Migrasi   : WP-02 (verifikasi fungsi)
- Jenis        : DATA (uji, sementara)
- Objek        : 1 baris `error_log` (operation `selftest.wp02`) + 1 baris `notifikasi` (idempotency `error_alert:...`)
- Menyentuh data pengunjung? : Tidak
- Ringkasan    : uji end-to-end `log_error_event` + `check_error_alert` di produksi. Keduanya bekerja (baris tertulis, alert ter-enqueue idempoten).
- Cara mengembalikan : baris uji **sudah dihapus** (`error_log` kembali 0 baris, notifikasi uji dihapus).
- Status       : DIKEMBALIKAN (self-test dibersihkan; DB produksi bersih)

### [2026-07-29 22:25 WIB] — WP-03 Watermark IPRO identitas (TANPA perubahan DB)
- WP/Migrasi   : WP-03
- Jenis        : TIDAK ADA PERUBAHAN DB (hanya kode route)
- Objek        : `src/app/api/investment-docs/page-image/route.ts`
- Menyentuh data pengunjung? : Tidak (hanya baca `pengunjung.nama/email` untuk watermark)
- Ringkasan    : isi watermark kini `nama <email>` untuk login, `SES-<hash>` untuk anonim (INV-04), bukan lagi ipHash generik. Watermark tetap dibakar di server via sharp.
- Cara mengembalikan : `git revert` commit WP-03
- Status       : SELESAI (kode), menunggu deploy untuk efek produksi

### [2026-07-29 22:40 WIB] — WP-04 Migrasi pipeline re-embed FAQ (M-202607290002)
- WP/Migrasi   : WP-04 / `202607290002_faq_reembed.sql`
- Jenis        : DDL + DATA (backfill penanda)
- Objek        : `faq_knowledge_base` + kolom `perlu_embed_ulang`, `embedding_updated_at`, `diubah_oleh`; fungsi `faq_mark_reembed()`, `faq_embedding_selesai()`; trigger `trg_faq_reembed`.
- Menyentuh data pengunjung? : Tidak (tabel FAQ, bukan pengunjung)
- Ringkasan    : BOT-11 — FAQ yang diedit kini otomatis ditandai `perlu_embed_ulang=true` (trigger), dan endpoint embed memproses `embedding IS NULL OR perlu_embed_ulang`. Backfill menandai baris `embedding IS NULL`. Self-test: edit jawaban → penanda aktif → dikembalikan.
- Cara mengembalikan : `DROP TRIGGER trg_faq_reembed ON faq_knowledge_base; DROP FUNCTION faq_mark_reembed(), faq_embedding_selesai();` (kolom aditif bisa diabaikan tanpa drop).
- Status       : DITERAPKAN di produksi (terverifikasi: kolom, fungsi, trigger ada; trigger bekerja)

### [2026-07-29 22:55 WIB] — WP-05 Migrasi penomoran antrean atomik (M-202607290003)
- WP/Migrasi   : WP-05 / `202607290003_antrean_counter.sql`
- Jenis        : DDL
- Objek        : `layanan` + `nomor_loket`, `prefiks_antrean`; tabel `antrean_counter`; fungsi `terbit_nomor_antrean()`.
- Menyentuh data pengunjung? : Tidak (fondasi baru; belum dipakai alur visit)
- Ringkasan    : QUE-06 — penomoran atomik via UPSERT+RETURNING. SK-06/I-01 diuji nyata di produksi: 8 panggilan bersamaan → 8 nomor unik, tanpa duplikat. Baris uji dibersihkan.
- Cara mengembalikan : `DROP FUNCTION terbit_nomor_antrean(uuid,date); DROP TABLE antrean_counter; ALTER TABLE layanan DROP COLUMN nomor_loket, DROP COLUMN prefiks_antrean;` (aditif, bisa juga diabaikan).
- Status       : DITERAPKAN di produksi (terverifikasi: 8 nomor unik konkuren)

### [2026-07-29 23:10 WIB] — WP-06 Migrasi kolom aktif/nonaktif petugas (M-202607290004)
- WP/Migrasi   : WP-06 / `202607290004_petugas_aktif.sql`
- Jenis        : DDL
- Objek        : `petugas` + `aktif`, `nonaktif_sejak`, `nonaktif_oleh`, `nonaktif_alasan`; `get_my_role()` diperbarui (mengecualikan nonaktif); fungsi `petugas_set_nonaktif()`, `petugas_set_aktif()`.
- Menyentuh data pengunjung? : Tidak (kolom baru, default aktif=true; 2 petugas nyata tetap aktif)
- Ringkasan    : RBA-06 — petugas kini bisa dinonaktifkan tanpa menghapus riwayat. `set_nonaktif` tanpa alasan DITOLAK (terbukti). Guard login (proxy + AdminGuard) menolak petugas nonaktif (I-22).
- Cara mengembalikan : `DROP FUNCTION petugas_set_nonaktif(uuid,text,uuid), petugas_set_aktif(uuid);` + kembalikan `get_my_role()` lama; kolom aditif bisa diabaikan.
- Status       : DITERAPKAN di produksi (terverifikasi: kolom & fungsi ada, petugas nyata tetap aktif, tidak ada sisa dummy)

### [2026-07-29 23:25 WIB] — WP-07 Migrasi pembekuan jadwal harian (M-202607290005)
- WP/Migrasi   : WP-07 / `202607290005_jadwal_harian_beku.sql`
- Jenis        : DDL + KONFIGURASI (cron)
- Objek        : tabel `jadwal_harian_beku`, fungsi `bekukan_jadwal()`, `jhb_tolak_ubah()`, trigger `trg_jhb_no_update`, policy, cron `bekukan_jadwal_harian 0 16 * * *`.
- Menyentuh data pengunjung? : Tidak (tabel baru; sumber dari `layanan_jadwal` yang sudah ada)
- Ringkasan    : SCH-05 — snapshot jadwal esok tiap malam sebagai satu-satunya dasar penilaian hadir/alpa. **I-08 ditegakkan lewat TRIGGER** (bukan hanya RLS) sehingga UPDATE/DELETE ditolak untuk SEMUA peran termasuk service_role; maintenance memakai `app.jhb_allow='on'`. Uji nyata: UPDATE/DELETE ditolak, nilai utuh; baris uji dibersihkan.
- Cara mengembalikan : `SELECT cron.unschedule('bekukan_jadwal_harian'); DROP TRIGGER trg_jhb_no_update ON jadwal_harian_beku; DROP FUNCTION bekukan_jadwal(date), jhb_tolak_ubah(); DROP TABLE jadwal_harian_beku;`
- Status       : DITERAPKAN di produksi (terverifikasi: pembeku mengisi 10 baris, I-08 ditolak, cron terdaftar)

### [2026-07-29 23:35 WIB] — WP-08 Migrasi response rate SKM (M-202607290006)
- WP/Migrasi   : WP-08 / `202607290006_skm_response_rate.sql`
- Jenis        : DDL
- Objek        : tabel `skm_response_rate`, fungsi `skm_rr_tambah()`, trigger `trg_visit_selesai_rr` (visit selesai→dilayani), `trg_skm_insert_rr` (respons SKM→mengisi).
- Menyentuh data pengunjung? : Tidak (tabel agregat baru; trigger membaca `visit`/`skm_respons` tanpa mengubahnya)
- Ringkasan    : SRV-03 — mencatat response rate SKM (dilayani vs mengisi) per layanan/hari (Asia/Jakarta). Data ini tidak bisa dibuat surut; mulai tercatat sejak trigger aktif.
- Cara mengembalikan : `DROP TRIGGER trg_visit_selesai_rr ON visit; DROP TRIGGER trg_skm_insert_rr ON skm_respons; DROP FUNCTION skm_rr_tambah(uuid,text); DROP TABLE skm_response_rate;`
- Status       : DITERAPKAN di produksi (terverifikasi: fungsi & trigger bekerja; uji dibersihkan)

### [2026-07-30 00:05 WIB] — WP-12 Migrasi kanal pengaduan (M-202607290007)
- WP/Migrasi   : WP-12 / `202607290007_pengaduan.sql`
- Jenis        : DDL + KONFIGURASI (cron) + STORAGE (bucket)
- Objek        : tabel `hari_libur`, `pengaduan`, `pengaduan_riwayat`; fungsi `tambah_hari_kerja()`, `generate_nomor_tiket()`, `buat_pengaduan()`, `lacak_pengaduan()`, `eskalasi_pengaduan_lewat_batas()`; 6 policy RLS; cron `pengaduan_eskalasi`; bucket privat `pengaduan-bukti`.
- Menyentuh data pengunjung? : Tidak (tabel baru)
- Ringkasan    : CMP-01..08 — kanal pengaduan dua jalur (UU 25/2009). Tiket `P`+6 acak; SLA hari kerja (verifikasi 3, penanganan 14) memperhitungkan Sabtu/Minggu/libur; eskalasi otomatis; **jalur integritas RLS hanya Admin** (I-15). Self-test: buat+lacak+SLA benar, dibersihkan (pengaduan kembali 0 baris).
- Cara mengembalikan : `SELECT cron.unschedule('pengaduan_eskalasi'); DROP FUNCTION buat_pengaduan, lacak_pengaduan, eskalasi_pengaduan_lewat_batas, generate_nomor_tiket, tambah_hari_kerja; DROP TABLE pengaduan_riwayat, pengaduan, hari_libur; DELETE FROM storage.buckets WHERE id='pengaduan-bukti';`
- Status       : DITERAPKAN di produksi (terverifikasi: tabel/fungsi/cron/policy ada; SLA hari kerja benar; jalur integritas hanya admin)

### [2026-07-30 00:20 WIB] — WP-13 Migrasi Standar Pelayanan (M-202607290008)
- WP/Migrasi   : WP-13 / `202607290008_standar_pelayanan.sql`
- Jenis        : DDL
- Objek        : tabel `standar_pelayanan` + RLS (publik baca yang aktif; admin tulis).
- Menyentuh data pengunjung? : Tidak
- Ringkasan    : CMP-09 — Standar Pelayanan & Maklumat Pelayanan per layanan (UU 25/2009). Halaman publik `/standar-pelayanan` menampilkan 6 elemen wajib + maklumat; sekaligus bahan bot (fase 4).
- Cara mengembalikan : `DROP TABLE standar_pelayanan;`
- Status       : DITERAPKAN di produksi

### [2026-07-30 00:20 WIB] — WP-14 Klausul penafian + ungkap perilaku (TANPA perubahan DB)
- WP/Migrasi   : WP-14
- Jenis        : TIDAK ADA PERUBAHAN DB (hanya konten halaman)
- Objek        : `src/app/umkm/page.tsx` (penafian MMK-09), `src/app/kebijakan-privasi/page.tsx` (INV-06 + perbaikan TB-05)
- Menyentuh data pengunjung? : Tidak
- Ringkasan    : MMK-09 penafian difasilitasi-bukan-penjamin di halaman matchmaking; INV-06 ungkap pencatatan perilaku di kebijakan privasi; perbaiki error export `POLICY_VERSION` (TB-05).
- Cara mengembalikan : `git revert` commit WP-14
- Status       : SELESAI (kode)

### [2026-07-30 00:45 WIB] — WP-15 Migrasi peran front_office (M-202607290009)
- WP/Migrasi   : WP-15 / `202607290009_role_front_office.sql`
- Jenis        : DDL (CHECK diperluas) + RLS baru
- Objek        : `petugas_role_check` diperluas ke ('petugas','admin','front_office'); fungsi `is_cross_service_staff()`; policy `absensi_cross_service_read`, `layanan_jadwal_cross_service_write`, `layanan_libur_cross_service_write`.
- Menyentuh data pengunjung? : Tidak (CHECK diperluas = aditif; tidak ada petugas FO di data live)
- Ringkasan    : RBA-02 — peran `front_office` dengan wewenang lintas-layanan. OPS-08: kode TS diperbarui (constants, admin-nav, proxy, login, page, chat messages, absensi, antrian) agar mengenal FO; area admin-only (invite, integritas, pengaturan) tetap tertutup.
- Cara mengembalikan : pastikan tidak ada baris `role='front_office'`, lalu persempit CHECK kembali ke ('petugas','admin'); drop fungsi & policy baru.
- Status       : DITERAPKAN di produksi

### [2026-07-30 01:00 WIB] — WP-16 Migrasi struktur jadwal standby (M-202607290010)
- WP/Migrasi   : WP-16 / `202607290010_jadwal_standby.sql`
- Jenis        : DDL + DATA (backfill)
- Objek        : tabel `jadwal_standby`, `jadwal_pengecualian`; fungsi `is_layanan_buka_jadwal()`, `jadwal_berikutnya()`; trigger `guard_visit_layanan_buka` diperbarui (fungsi baru + tanggal WIB); backfill 50 baris dari `layanan_jadwal` (10 layanan × 5 hari).
- Menyentuh data pengunjung? : Tidak (jadwal, bukan pengunjung)
- Ringkasan    : SCH-01/04/11 — pola jadwal mingguan + pengecualian; pemblokir pendaftaran dengan pesan jadwal terdekat (P3). **Jam layanan resmi dikoreksi ke 08:00–15:30** (OQ-04). QUE-05 horizon reservasi 30→7 hari.
- Cara mengembalikan : kembalikan trigger `guard_visit_layanan_buka` ke `is_layanan_buka`; `DROP TABLE jadwal_pengecualian, jadwal_standby; DROP FUNCTION is_layanan_buka_jadwal, jadwal_berikutnya;` (`layanan_jadwal`/`layanan_libur` tidak dihapus).
- Status       : DITERAPKAN di produksi (terverifikasi: 50 baris, jam 15:30, jadwal_berikutnya & is_buka benar)

### [2026-07-30 01:20 WIB] — WP-17 Migrasi absensi gerbang antrean (M-202607290011)
- WP/Migrasi   : WP-17 / `202607290011_absensi_gerbang.sql`
- Jenis        : DDL + KONFIGURASI (cron) + SETTINGS
- Objek        : `absensi_petugas` + `sumber`, `dicatat_oleh`, status `alpa`; tabel `layanan_hari`; fungsi `catat_absensi()`, `antrean_dibuka()`, `tandai_alpa_otomatis()`; cron `absensi_alpa_otomatis */5`; `site_settings.batas_jam_alpa=10:00`; enum visit + `tidak_terlayani`.
- Menyentuh data pengunjung? : Tidak (kolom & tabel baru; enum diperluas aditif)
- Ringkasan    : SCH-02/08/09/10 + QUE-08 — absensi sebagai gerbang antrean; jam dari SERVER (I-09); alpa otomatis pada batas (default 10:00 WIB, bisa diatur Admin); label `alpa`/`tidak_terlayani` di UI (OPS-08).
- Cara mengembalikan : `SELECT cron.unschedule('absensi_alpa_otomatis'); DROP FUNCTION catat_absensi, antrean_dibuka, tandai_alpa_otomatis; DROP TABLE layanan_hari;` + persempit enum; kolom aditif bisa diabaikan.
- Status       : DITERAPKAN di produksi (terverifikasi: fungsi/kolom/cron/settings ada; catat_absensi menolak sumber salah; antrean_dibuka boolean)

### [2026-07-30 01:40 WIB] — WP-18 Migrasi kontak & notifikasi petugas (M-202607290012)
- WP/Migrasi   : WP-18 / `202607290012_layanan_kontak_notifikasi.sql`
- Jenis        : DDL + KONFIGURASI (3 cron)
- Objek        : tabel `layanan_kontak`; fungsi `email_layanan()`, `jumlah_terdaftar()`, `kirim_pengingat_petugas()`, `metrik_kepatuhan()`; cron `notif_h1_sore`, `notif_h0_pagi`, `notif_eskalasi`.
- Menyentuh data pengunjung? : Tidak (tabel kontak & notifikasi antrean)
- Ringkasan    : NOT-01..07 + SVC-06 — kontak institusional per peran; pengingat bersyarat (NOT-02: jadwal∧belum absen∧ada pendaftar); eskalasi berjenjang ke atasan+FO (NOT-04); metrik kepatuhan (NOT-07). Terbukti: tanpa pendaftar → 0 email (tidak spam).
- Cara mengembalikan : `SELECT cron.unschedule('notif_h1_sore'), cron.unschedule('notif_h0_pagi'), cron.unschedule('notif_eskalasi'); DROP FUNCTION kirim_pengingat_petugas, metrik_kepatuhan, email_layanan, jumlah_terdaftar; DROP TABLE layanan_kontak;`
- Status       : DITERAPKAN di produksi (terverifikasi: NOT-02 syarat ke-3 bekerja, metrik benar, kontak uji dibersihkan)

### [2026-07-30 02:00 WIB] — WP-19 FO nonaktifkan akun + pergantian PIC (TANPA migrasi DB baru)
- WP/Migrasi   : WP-19 (memakai fungsi `petugas_set_nonaktif`/`petugas_set_aktif` dari WP-06)
- Jenis        : TIDAK ADA PERUBAHAN DB (hanya kode route + UI)
- Objek        : `src/app/api/admin/petugas/status/route.ts` (baru), `src/app/admin/petugas/page.tsx`
- Menyentuh data pengunjung? : Tidak langsung; aksi mengubah `petugas.aktif` & mengakhiri sesi auth (I-23)
- Ringkasan    : RBA-08 — FO menonaktifkan satu arah (wajib alasan, Admin diberi tahu), Admin mengaktifkan kembali. RBA-07 — pergantian PIC: akhiri sesi pemegang lama + undangan ke pemegang baru + audit_log garis waktu (satu layanan satu akun).
- Cara mengembalikan : `git revert` commit WP-19; status aktif bisa dikembalikan Admin manual.
- Status       : SELESAI (kode)

### [2026-07-30 02:30 WIB] — WP-20 Migrasi struktur kunjungan + tiket (M-202607290013) — OPS-01 Langkah 1 TAMBAH
- WP/Migrasi   : WP-20 / `202607290013_kunjungan_tiket.sql`
- Jenis        : DDL (struktur KOSONG; `visit` TIDAK diubah)
- Objek        : kolom `layanan` (penyerta, status_tampilan, bendera, batas_ambil_nomor_menit, kuota_harian); tabel `kunjungan`, `tiket_antrean` (+UNIQUE layanan/tanggal/nomor); fungsi `terbit_tiket()`; RLS ketat.
- Menyentuh data pengunjung? : Belum — struktur masih kosong; `visit` sumber kebenaran tetap aktif
- Ringkasan    : QUE-01/GST-01 fondasi — satu kunjungan banyak tiket. Langkah 1 OPS-01/02: hanya membuat struktur kosong. `terbit_tiket` menghasilkan nomor unik berprefiks (diuji: 2 tiket B-001,B-002 untuk 1 kunjungan).
- Cara mengembalikan : `DROP FUNCTION terbit_tiket(uuid,uuid); DROP TABLE tiket_antrean, kunjungan;` + kolom layanan bisa diabaikan. Aman karena belum ada data & belum ada yang membaca.
- Status       : DITERAPKAN di produksi (struktur kosong terverifikasi; dummy dibersihkan)

---

> Entri WP-21 berikut dicatat sebelum penerapan ke produksi (Phase 4), sesuai aturan pengisian log.
> Status BELUM DITERAPKAN — akan diubah ke DITERAPKAN setelah eksekusi berhasil di luar jam layanan (08:00–15:30 WIB).

### [2026-07-30 13:17 WIB] — WP-21 M15: Tabel buku_tamu (202607300014_buku_tamu.sql) — OPS-01 Langkah 2a
- WP/Migrasi   : WP-21 / `202607300014_buku_tamu.sql`
- Jenis        : DDL (struktur KOSONG; `visit` TIDAK diubah)
- Objek        : tabel `public.buku_tamu` (id, legacy_visit_id UNIQUE FK→visit, nama, asal, no_hp, menemui_siapa, keperluan, waktu_masuk, tanda_tangan_svg, dicatat_oleh FK→petugas, created_at); 2 index (waktu_masuk DESC, legacy_visit_id WHERE NOT NULL); RLS + policy `buku_tamu_fo_admin_all` (FO & Admin).
- Menyentuh data pengunjung? : Tidak — tabel kosong; tidak ada trigger aktif di langkah ini
- Ringkasan    : GST-01..04 fondasi buku tamu digital. Aditif dan berdiri sendiri; trigger dual write baru aktif di M16. Diterapkan via `scripts/apply-migration.mjs` (7 statement).
- Cara mengembalikan : `DROP TABLE public.buku_tamu;` (tabel kosong, aman)
- Status       : DITERAPKAN di produksi (terverifikasi: selftest-wp21.mjs full PASS)

### [2026-07-30 13:17 WIB] — WP-21 M16: Backfill + linkage + dual write trigger (202607300015_backfill_kunjungan_dual_write.sql) — OPS-01 Langkah 2b
- WP/Migrasi   : WP-21 / `202607300015_backfill_kunjungan_dual_write.sql`
- Jenis        : DDL + DATA (backfill) + KONFIGURASI (trigger + REVOKE)
- Objek        :
  - Kolom `kunjungan.legacy_visit_id` (uuid UNIQUE FK→visit ON DELETE RESTRICT)
  - Kolom `tiket_antrean.legacy_visit_id` (uuid UNIQUE FK→visit ON DELETE RESTRICT)
  - Tabel `wp21_backfill_ledger` (visit_id PK FK→visit; kunjungan_id/tiket_id/buku_tamu_id FK opsional; CHECK kunjungan XOR buku_tamu); RLS admin-read
  - Backfill: setiap `visit.tujuan='loket'` → `kunjungan`; visit eligible (status≠terjadwal + origin) → `tiket_antrean`; `visit.tujuan='bertemu_seseorang' AND waktu_scan IS NOT NULL` → `buku_tamu`
  - Repair: `antrean_counter` di-upsert ke MAX(nomor) per layanan/tanggal
  - Fungsi `sync_visit_dual_write()` SECURITY DEFINER + trigger `trg_visit_dual_write` AFTER INSERT OR UPDATE ON visit
  - `REVOKE CREATE ON SCHEMA public FROM PUBLIC`
- Menyentuh data pengunjung? : Ya — membaca semua baris `visit` untuk backfill; TIDAK mengubah/menghapus baris `visit`
- Ringkasan    : OPS-02 — mengisi tabel target dari `visit` sumber dan mengaktifkan penulisan ganda atomik. Tiket reservasi diterbitkan saat scan (QUE-04), bukan saat reservasi dibuat. Buku tamu hanya untuk kedatangan fisik terscan (GST-03). Dikunci SHARE ROW EXCLUSIVE selama eksekusi.
- Cara mengembalikan :
  ```sql
  DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit;
  DROP FUNCTION IF EXISTS public.sync_visit_dual_write();
  TRUNCATE public.wp21_backfill_ledger, public.buku_tamu, public.tiket_antrean, public.kunjungan;
  ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS legacy_visit_id;
  ALTER TABLE public.tiket_antrean DROP COLUMN IF EXISTS legacy_visit_id;
  DROP TABLE IF EXISTS public.wp21_backfill_ledger;
  GRANT CREATE ON SCHEMA public TO PUBLIC;
  ```
  Data sumber di `visit` tidak disentuh — tetap utuh.
- Verifikasi pasca-tayang :
  ```
  node scripts/selftest-wp21.mjs --preflight
  node scripts/apply-migration.mjs supabase/migrations/202607300014_buku_tamu.sql
  node scripts/apply-migration.mjs supabase/migrations/202607300015_backfill_kunjungan_dual_write.sql
  node scripts/selftest-wp21.mjs
  npm test -- supabase/migrations/kunjungan_dual_write.test.ts supabase/migrations/migration-files.test.ts
  npm run typecheck
  ```
- Status       : DITERAPKAN di produksi
- Cutover facts (Task 5 WP-21 handoff criteria):
  - Distribusi `visit` sebelum cutover: 25 walk_in/selesai, 1 reservasi/selesai, 2 reservasi/terjadwal — total **28 visit loket**, 0 visit bertemu_seseorang
  - Setelah M16: **28 kunjungan** (satu per visit loket), **26 tiket** (25 walk_in selesai + 1 reservasi selesai; 2 reservasi terjadwal tidak mendapat tiket sesuai QUE-04), **28 baris ledger**, 0 buku_tamu (tidak ada meeting visit terscan)
  - Orphan kunjungan: **0** ✓ — counter lagging: **0** ✓ — ledger orphan: **0** ✓
  - `trg_visit_dual_write` aktif: **2026-07-30 13:17 WIB**
  - `visit` tetap readable/writable — sumber kebenaran sampai WP-24
- Rollback window (berlaku selama belum ada post-cutover visit baru yang signifikan):
  ```sql
  DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit;
  DROP FUNCTION IF EXISTS public.sync_visit_dual_write();
  -- Hapus hanya baris backfill; visit tidak disentuh
  TRUNCATE public.wp21_backfill_ledger, public.buku_tamu, public.tiket_antrean, public.kunjungan;
  ALTER TABLE public.kunjungan DROP COLUMN IF EXISTS legacy_visit_id;
  ALTER TABLE public.tiket_antrean DROP COLUMN IF EXISTS legacy_visit_id;
  DROP TABLE IF EXISTS public.wp21_backfill_ledger;
  GRANT CREATE ON SCHEMA public TO PUBLIC;
  ```
  Jika sudah ada post-cutover visit baru: pertahankan baris terkait, hentikan trigger saja (`DROP TRIGGER IF EXISTS trg_visit_dual_write ON public.visit`) dan rollback hanya perilaku.
- Validasi handoff WP-22: selftest-wp21.mjs PASS (13:47 WIB, 30 Jul 2026) — semua conditional invariants benar, nol self-test record tersisa. WP-22 boleh dimulai: migrasi pembacaan satu halaman sekaligus; jangan pindahkan `/checkin` atau dashboard antrean terlebih dahulu.

### [2026-07-30 14:13 WIB] — WP-22 Migrasi pembacaan halaman + views (M-202607300016)
- WP/Migrasi   : WP-22 / halaman + `202607300016_wp22_views_tiket_antrean.sql`
- Jenis        : DDL (view + fungsi) + kode halaman (read migration)
- Objek        :
  - `v_antrian_loket` — diperbarui membaca dari `tiket_antrean` (bukan `visit`)
  - `get_queue_position(uuid)` — diperbarui membaca dari `kunjungan` + `tiket_antrean`
  - `src/app/admin/kunjungan/page.tsx` — membaca dari `kunjungan` + `tiket_antrean`
  - `src/app/admin/page.tsx` — stats membaca dari `kunjungan` + `tiket_antrean`
  - `src/app/admin/antrian/page.tsx` — membaca dari `tiket_antrean`; tulis status masih ke `visit`
  - `src/app/layar-antrian/page.tsx` — Realtime subscribe berubah ke `tiket_antrean`
  - `src/app/me/page.tsx`, `admin/scan/page.tsx`, `checkin/page.tsx` — tidak perlu perubahan (dual write masih aktif; visit masih valid sebagai sumber baca)
- Menyentuh data pengunjung? : Tidak (hanya mengubah view/fungsi dan query halaman; visit tidak disentuh)
- Ringkasan    : Langkah 3 OPS-01/02 — pembacaan aktif dipindahkan ke `kunjungan`/`tiket_antrean`. `visit` tetap writable; `trg_visit_dual_write` menjaga sinkronisasi.
- Cara mengembalikan : kembalikan 3 halaman ke query `visit` + rollback view/fungsi ke versi sebelumnya (ada di `202607280005_antrian_hari_ini.sql` dan `202607200001_p0_security_governance.sql`). Dual write masih aktif sehingga rollback aman.
- Status       : DITERAPKAN (kode + migration 14:13 WIB; 11/11 tests pass)

### [2026-07-30 14:19 WIB] — WP-23 Akhir hari + panggil ulang (M-202607300017)
- WP/Migrasi   : WP-23 / `202607300017_wp23_akhir_hari_panggil.sql` + kode
- Jenis        : DDL (fungsi + cron) + kode
- Objek        :
  - `tandai_tidak_terlayani_akhir_hari()` — fungsi SECURITY DEFINER yang mengupdate `visit.status='tidak_terlayani'` untuk tiket menunggu di akhir hari (QUE-09)
  - cron `antrean_tidak_terlayani_akhir_hari` — 15:35 WIB setiap hari (08:35 UTC)
  - `panggil_tiket(p_tiket_id uuid)` — fungsi yang emit `pg_notify('nomor_dipanggil', ...)` sebagai hook event DSP-08 (QUE-17)
  - `src/app/admin/antrian/page.tsx` — tombol "Panggil" + `handlePanggil()` untuk memanggil tiket menunggu
- Menyentuh data pengunjung? : Ya (cron menulis `visit.status='tidak_terlayani'` untuk tiket menunggu yang tidak terlayani); visit data lama tidak dihapus
- Ringkasan    : QUE-09 + QUE-17 — akhir hari otomatis menutup tiket menunggu; petugas bisa memanggil ulang tiket via tombol Panggil.
- Cara mengembalikan : `SELECT cron.unschedule('antrean_tidak_terlayani_akhir_hari'); DROP FUNCTION tandai_tidak_terlayani_akhir_hari(), panggil_tiket(uuid);` + kembalikan antrian/page.tsx ke versi sebelumnya.
- Status       : DITERAPKAN (14:19 WIB; 11/11 tests pass)

### [2026-07-30 17:00 WIB] — WP-25/26/29/30/32 Migrations (202607300018..22)
- WP/Migrasi   : WP-25,26,29,30,32
- Jenis        : DDL (struktur baru)
- Objek        :
  - `202607300018_chat_persisten.sql` (WP-25): kolom `chat_pesan.jenis_jawaban`, 2 index (CHT-07/09)
  - `202607300019_wp26_cms_registry.sql` (WP-26): kolom `site_settings.keterangan` + `boleh_diubah_dashboard`, tabel `konten_versi`
  - `202607300020_wp30_rekap_harian.sql` (WP-30): tabel `rekap_harian_layanan` + `laporan_snapshot` + fungsi `rollup_rekap_harian()` + cron 00:05 WIB
  - `202607300021_wp32_jejak_investasi.sql` (WP-32): tabel `jejak_minat_investasi`
  - `202607300022_wp29_layar_token.sql` (WP-29): tabel `layar_token` + view `v_layar_antrian` (tanpa PII) + fungsi `validate_layar_token()`
- Menyentuh data pengunjung? : Tidak (semua tabel baru atau kolom aditif)
- Ringkasan    : Fase 4–5 schema foundation. WP-29 juga menambah kode: `/admin/layar`, `/layar/[token]`, `/api/admin/layar`.
- Cara mengembalikan : DROP TABLE/kolom masing-masing (semua aditif). Cron WP-30: `SELECT cron.unschedule('rollup_rekap_harian_malam')`.
- Status       : DITERAPKAN (17:00 WIB; 11/11 tests pass)
