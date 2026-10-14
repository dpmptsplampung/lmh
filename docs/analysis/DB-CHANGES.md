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

### [2026-10-14 malam] — Cutover Fase 3: 0002-0009, 0011, 0012, 0013 diterapkan ke produksi + ledger diisi (atas izin CEO)
- WP/Migrasi   : `202610140002` s.d. `0009`, `0011`, `0012`, `0013` (tanpa 0010: tidak ada berkasnya), entri per migrasi di bawah
- Jenis        : DDL + DATA (backfill di 0003/0007/0009) + KONFIGURASI (job pg_cron)
- Tindakan     : tiap berkas `scripts/apply-migration.mjs <file> --atomic --dry-run` lalu `--atomic` (COMMIT) berurutan, sekitar 17:52–17:57 WIB. Lalu `scripts/fill-migration-ledger.mjs --apply --yes`: 12 baris dicatat (0001–0013 tanpa 0010).
- Verifikasi read-only : fungsi FO/chat/layanan ada; `visit` menjadi arsip (`trg_visit_arsip` aktif, trigger tulis lama nonaktif); prefiks layanan 2 huruf; job `penanganan_tutup_otomatis` dan `chat_tutup_otomatis` terjadwal; flag `sesi_tunggal_aktif` tetap `false`. Ledger: 66 entri (terakhir 202610140013); 5 migrasi lama tetap tidak tercatat (lihat `docs/analysis/LEDGER-VERIFIKASI-2026-10-14.md`).
- Uji perilaku (ROLLBACK terhadap produksi, lolos): 0002 = 84; 0003-0005 = 150; 0007/0008 = 101; 0009 = 106; 0012 = 61 (`--akhir-hari`); 0013 = 26. 0006 dan 0011 hanya tercakup sebagai prasyarat (`--pre`) dan test statis.
- Klien        : branch di-merge ke `main` lewat PR #10 (merge commit `cbff52a`); deploy produksi Vercel sukses menurut status GitHub. Pemeriksaan kesehatan dari luar BELUM TERBUKTI (deployment dilindungi Vercel Authentication; domain `lmh.lampungprov.go.id` tidak ter-resolve dari mesin penguji).
- Belum terbukti : tampilan di browser, konkurensi sejati, kueri rekap FO pada PostgREST sungguhan, `session_id` JWT stabil setelah refresh. Flag `sesi_tunggal_aktif` masih `false`; staf belum login ulang.
- Cara mengembalikan : urutan rollback terbalik per entri (0013 -> 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> 0006 -> 0005 -> 0004 -> 0003 -> 0002); lihat `docs/RUNBOOK_FO_ESKALASI.md`.
- Status       : DITERAPKAN

### [2026-10-14] — Keterbukaan data antar Front Office: semua FO membaca semua `penanganan` (M-202610140013_fo_keterbukaan_data) — DITERAPKAN 2026-10-14
- WP/Migrasi   : keputusan CEO 2026-10-14 ("semua antrian, semua pengunjung, rekap, dll itu terbuka untuk semua FO ... di setiap pengunjung ada nama petugas FO yang melayani") / `supabase/migrations/202610140013_fo_keterbukaan_data.sql` + test kontrak `supabase/migrations/fo_keterbukaan.test.ts` + rollback `docs/rollback-fo-keterbukaan-data-202610140013.sql`
- Jenis        : DDL (fungsi helper RLS; tanpa tabel/kolom/policy baru)
- Objek        : `public.boleh_penanganan(uuid, text, uuid, uuid, text)` (dipakai policy `penanganan_staf_select`): cabang `front_office` = `RETURN true`; cabang admin/petugas/default identik versi 0009; hak EXECUTE sama; COMMENT penanda `202610140013`. Rollback 0012 mendapat penjaga baru (menolak selama penanda 0013 ada).
- Menyentuh data pengunjung? : Tidak mengubah data. Memperluas BACA: FO aktif kini membaca semua tahap penanganan (nama/instansi pengunjung lewat embed `kunjungan` sudah terbaca FO sebelumnya; topik/catatan tahap FO lain dan tahap layanan kini terbaca). Tulis tetap hanya lewat RPC pemilik tahap.
- Prasyarat    : 0012 (`hari_tanpa_layanan`), 0009, 0003 (penjaga `PRASYARAT`). Urutan: `... -> 0011 -> 0012 -> 0013`.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610140013_fo_keterbukaan_data.sql --atomic --dry-run` (dry-run siang 2026-10-14, saat 0003 belum terpasang: berhenti di `PRASYARAT: tabel penanganan / boleh_penanganan belum ada`, di-ROLLBACK; malam harinya dry-run lalu COMMIT lolos), lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-fo-keterbukaan-data-202610140013.sql --atomic` (`--dry-run` dulu); memulihkan `boleh_penanganan` PERSIS versi 0009 dan menghapus komentar. PERTAMA dalam urutan rollback (sebelum 0012).
- Klien        : `src/lib/rekap/penanganan.ts` (`tentukanCakupan`: FO = Admin untuk rekap FO & layanan; kolom `fo_nama`), `api/admin/rekap/penanganan(+/export)` (tanpa `terkunci_ke_saya`/`cakupan_eskalasi_fo`/`eskalasi_fo_id`), `RekapPenangananTable` (filter penangan untuk FO, kolom Front Office), Excel (kolom Front Office), `/admin/fo/penanganan` (FO lain + riwayat semua FO), `/admin/fo/kotak-masuk` (FO sebelumnya), `/admin/kunjungan` (kolom Front Office). Aman di-deploy sebelum/sesudah 0013 (tanpa 0013 data FO hanya tidak lengkap).
- Uji perilaku : `scripts/test-fo-keterbukaan.mjs`: dijalankan 2026-10-14 malam terhadap produksi (transaksi di-ROLLBACK), 26 lolos (skrip menolak Senin-Jumat 07:00-16:59 WIB).
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: fungsi `boleh_penanganan` terpasang. Uji perilaku `scripts/test-fo-keterbukaan.mjs` (ROLLBACK terhadap produksi) = 26 lolos. BELUM TERBUKTI: kueri rekap FO pada PostgREST sungguhan, tampilan di browser.

### [2026-10-14] — Tahap C3: Pendataan Pelayanan semua field wajib (M-202610140011_pendataan_wajib) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Tahap C3 (keputusan CEO Gerbang G.5) / `supabase/migrations/202610140011_pendataan_wajib.sql` + test kontrak `supabase/migrations/pendataan_wajib.test.ts` + rollback `docs/rollback-pendataan-wajib-202610140011.sql`
- Jenis        : DDL (CHECK dilonggarkan, fungsi baru) + perilaku RPC (validasi)
- Objek        :
  - `pelayanan_oss`: CHECK `tipe_pelaku_usaha` (+ `'tidak_berlaku'`) dan `skala_usaha` (+ `'Tidak berlaku'`) dilonggarkan (superset; data lama tetap valid). `status_penanaman_modal` tidak diubah (sudah punya `'tidak_ada'`).
  - `pendataan_validasi_payload(text, jsonb)` BARU (invoker, `REVOKE ALL FROM PUBLIC, anon, authenticated`): `INVALID_PAYLOAD` (22023) bila ada field wajib yang hilang / bukan teks / kosong, atau nilai pilihan di luar daftar. OSS 14 field, Perizinan 11 field (SEMUA kolom isian form).
  - `layanan_selesai(uuid, text, jsonb, uuid, text)`: salinan PERSIS versi 202610140007 (tanpa `visit`; signature, urutan kunci, kode galat, hasil jsonb, grant tidak berubah) + SATU pemanggilan `pendataan_validasi_payload` per cabang form, sesudah pemeriksaan `LOCKED`, sebelum menulis apa pun. `p_form_type` NULL tidak divalidasi.
- Menyentuh data pengunjung? : Tidak (tidak ada UPDATE/DELETE data). Hanya menolak penyelesaian baru yang tidak lengkap.
- Ringkasan    : keputusan CEO G.5 — semua field Pendataan wajib. Field usaha yang memang tidak ada diisi eksplisit "Belum ada"/"Tidak berlaku" (UI: tombol isian cepat + opsi "Tidak berlaku" pada pilihan); kolom catatan boleh "-". Draf (autosave/PATCH) tetap longgar; data lama tidak divalidasi ulang dan tidak dikunci; `koreksi_pelayanan` (data terkunci) tidak diubah.
- Urutan penerapan : SETELAH 202610140007 (penjaga `PRASYARAT` memeriksa `visit_arsip_jaga()`; jalan sebelum 0007 akan ditimpa 0007). Jendela yang sama dengan cutover 0002..0008 atau sesudahnya, bersama deploy klien (PelayananWizardModal + route POST).
- Dampak klien : klien lama yang mengirim isian bolong mendapat `INVALID_PAYLOAD` (HTTP 422). Rekap/Excel menampilkan nilai mentah `tidak_berlaku` untuk Tipe Pelaku Usaha (label ramah ada di UI admin/rekap dan wizard; `src/lib/rekap/excel.ts` tidak disentuh).
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610140011_pendataan_wajib.sql --atomic --dry-run` (saat siang 2026-10-14 berhenti di penjaga prasyarat karena 0002..0008 belum diterapkan; malam harinya setelah prasyarat terpasang dry-run lalu COMMIT lolos), lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-pendataan-wajib-202610140011.sql --atomic` (`--dry-run` dulu). Memulihkan `layanan_selesai` PERSIS versi 0007 dan menghapus helper. CHECK yang dilonggarkan SENGAJA tidak disempitkan (aman bagi kode lama dan baris yang sudah memakai nilai baru).
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Tanpa uji perilaku khusus: hanya tercakup sebagai prasyarat (`--pre`) uji lain dan test statis (`pendataan_wajib.test.ts`).

### [2026-10-14] — Tahap C: live chat sebagai layanan online tercatat (M-202610140009_chat_online) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Fase 3 Tahap C (C1-DB) / `supabase/migrations/202610140009_chat_online.sql` + test kontrak `supabase/migrations/chat_online.test.ts` + rollback `docs/rollback-chat-online-202610140009.sql` + uji perilaku (transaksi di-ROLLBACK) `scripts/test-chat-online.mjs` + kontrak UI `docs/analysis/FO-CHAT-KONTRAK-RPC.md`
- Jenis        : DDL (kolom, indeks, fungsi, trigger) + backfill data
- Objek        : `chat_sesi.kunjungan_id` (FK `kunjungan`, SET NULL) + indeks unik `uq_chat_sesi_kunjungan`, `uq_kunjungan_online_chat_sesi`, indeks `idx_penanganan_chat_sesi`, `idx_penanganan_kotak_masuk_chat`; RPC `chat_ambil(uuid, text)`, `chat_teruskan(uuid, uuid, uuid, text)`, `chat_selesai(uuid, uuid, text)` (authenticated); internal `chat_ubah_sesi`, `chat_pesan_sistem`, `chat_buat_kunjungan` (service_role saja); trigger `trg_chat_sesi_jaga_rpc` (BEFORE INSERT/UPDATE, galat `CHAT_HARUS_RPC`) dan `trg_chat_sesi_eskalasi_kunjungan` (AFTER INSERT/UPDATE OF status); diganti: `guard_chat_sesi_staff_columns` (+ flag `lmh.chat_rpc`), `boleh_penanganan`, `boleh_kunjungan` (+ cabang petugas untuk chat yang sesinya di layanannya). TIDAK mengubah policy RLS mana pun, RPC `fo_*`/`layanan_*`/`admin_*`, job akhir hari.
- Menyentuh data pengunjung? : Ya saat diterapkan: backfill membuat `kunjungan` (asal `online`, data disalin dari `pengunjung`) + `penanganan` untuk sesi `eskalasi`/`aktif` yang ada (uji 2026-10-14: 2 sesi nyata, 1 `aktif` + 1 `eskalasi`); sesi `aktif` tanpa penangan menjadi `eskalasi`. Saat berjalan: setiap eskalasi membuat kunjungan online.
- Ringkasan    : chat yang ber-eskalasi (atau diambil staf dari status bot) menjadi kunjungan `online` dengan tahap `penanganan` saluran `chat` (kotak masuk FO). FO/petugas layanan mengambil secara atomik (`chat_ambil`; petugas boleh mengambil langsung selama belum diambil FO; Admin ambil alih dengan alasan + audit), FO meneruskan ke layanan TANPA tiket (`chat_teruskan`, notifikasi petugas), penangan menutup dengan topik + catatan wajib (`chat_selesai`, FO <= 200, layanan <= 1000) dan pesan penutup bertanda `penutup_survei`. Perubahan kolom staf `chat_sesi` di luar RPC ditolak.
- Urutan penerapan : SETELAH 202610140003/0004/0005 (prasyarat dijaga). Tidak bergantung pada 0006-0008 tetapi lulus uji bersama keduanya. Diterapkan bersamaan dengan deploy klien Tahap C (route `/api/chat/sesi` dan `admin/chat`), di luar jam layanan.
- Dampak klien/skrip : aksi lama `/api/chat/sesi` (`takeover`, `kembali_ke_bot`, `selesaikan`) DITOLAK DB (`CHAT_HARUS_RPC`) sampai diganti RPC (kontrak §5). `/api/chat/ai` (bot -> eskalasi) dan INSERT sesi oleh pengunjung tidak berubah. Muat ulang skema PostgREST setelah terap.
- Cara menerapkan : WAJIB `--atomic`: `node scripts/apply-migration.mjs supabase/migrations/202610140009_chat_online.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten. Dry-run tunggal hanya bermakna setelah 0003-0005 diterapkan (2026-10-14 06:16 WIB: dry-run tunggal ke produksi gagal di penjaga prasyarat, seperti diharapkan, ROLLBACK).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-chat-online-202610140009.sql --atomic` (`--dry-run` dulu); menghapus objek baru, memulihkan `boleh_penanganan` (0003), `boleh_kunjungan` (202610090001), `guard_chat_sesi_staff_columns` (202610070001) persis (diuji `chat_online.test.ts` dan snapshot katalog di `test-chat-online.mjs`). Data kunjungan/penanganan online dibiarkan (blok hapus opsional dikomentari). Rollback ini sebelum rollback 0005/0004/0003.
- Bukti uji    : `scripts/test-chat-online.mjs` ke DB produksi, transaksi di-ROLLBACK, 2026-10-14 06:14 WIB (`--pre 0002..0005 --apply 0009`) dan 06:15 WIB (`--pre 0002..0008 --apply 0009`): 99 lolos, 0 gagal masing-masing; jumlah baris + hash status sesi chat sebelum = sesudah. `npx vitest run --pool=vmForks supabase/migrations`: 44 berkas / 621 test lolos.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: fungsi chat ada. Uji perilaku `scripts/test-chat-online.mjs` (ROLLBACK terhadap produksi) = 106 lolos. BELUM TERBUKTI: konkurensi sejati, tampilan di browser.

### [2026-10-14] — WP-24: penutupan otomatis tahap tertinggal + retensi PII (M-202610140008_wp24_tutup_otomatis_retensi) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Tahap B9 / `supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql` + test kontrak `supabase/migrations/wp24.test.ts` + rollback `docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql` + uji perilaku `scripts/test-wp24.mjs` (dijalankan lolos 2026-10-14 malam, ROLLBACK: 101)
- Jenis        : DDL (CHECK, fungsi, job pg_cron) + perilaku job anonimisasi
- Objek        : CHECK `penanganan_batal_karena_check` (+ `tidak_ditutup`); fungsi `tutup_penanganan_tertinggal()` (definer, hanya service_role) + job `penanganan_tutup_otomatis` `0 16 * * *` UTC (23:00 WIB); `anonymize_inactive_pengunjung()` diperluas (plpgsql).
- Menyentuh data pengunjung? : Tidak saat diterapkan. Saat berjalan: job menutup tahap/tiket/kunjungan tertinggal; anonimisasi mengosongkan PII kunjungan/penanganan.catatan/visit > 730 hari.
- Ringkasan    : keputusan pertanyaan CEO #3 — tahap `berjalan` yang tertinggal ditutup `batal`/`tidak_ditutup` (catatan sistem, audit `tutup_otomatis_penanganan`), tiket `dilayani` → `selesai` dengan `waktu_selesai` NULL (tidak mencemari estimasi/rekap durasi), kunjungan → `selesai` (pengunjung sudah dilayani; SKM terkirim; `tidak_terlayani` akan memalsukan statistik). Pertanyaan #6 — retensi 730 hari mencakup kolom PII baru `kunjungan`, `penanganan.catatan`, dan arsip `visit` (flag `lmh.visit_arsip`); `jaga_nama_pengunjung` membebaskan pg_cron (tanpa `auth.uid()`).
- Urutan penerapan : SETELAH 202610140007, jendela cutover yang sama.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql --atomic` (`--dry-run` dulu), SEBELUM rollback 0007. Ditolak bila ada tahap `tidak_ditutup` kecuali `lmh.rollback_paksa` (tahap itu menjadi `tidak_terlayani`). Anonimisasi tidak dapat dibalik.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: job `penanganan_tutup_otomatis` terjadwal. Uji perilaku `scripts/test-wp24.mjs` (ROLLBACK terhadap produksi, bersama 0007) = 101 lolos.

### [2026-10-14] — WP-24: akhiri dual-write `visit`, pindahkan pembaca (M-202610140007_wp24_akhiri_dual_write) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Tahap B9 (Gerbang G.1 Opsi A) / `supabase/migrations/202610140007_wp24_akhiri_dual_write.sql` + test kontrak `supabase/migrations/wp24.test.ts` + rollback `docs/rollback-wp24-akhiri-dual-write-202610140007.sql` + uji perilaku `scripts/test-wp24.mjs` + runbook `docs/RUNBOOK_FO_ESKALASI.md` (bagian WP-24)
- Jenis        : DDL (trigger dinonaktifkan/baru, policy, hak tabel, fungsi, kolom, MV/view) + DATA (backfill reservasi lama, `skm_respons.kunjungan_id`)
- Objek        :
  - `visit` (arsip): DISABLE `trg_visit_dual_write`, `trg_notify_visit_selesai`, `trg_notify_reservasi_confirmed`, `trg_visit_selesai_rr`, `trg_audit_visit_status`, `trg_log_visit_insert`, `trg_guard_visit_layanan_buka`, `trg_visit_qr_hangus`; DROP `trg_guard_visit_transisi_layanan` + `guard_visit_transisi_layanan()`; trigger baru `trg_visit_arsip` + `visit_arsip_jaga()` (VISIT_ARSIP kecuali flag `lmh.visit_arsip` atau FK pengunjung SET NULL); DROP policy `visit_insert_walk_in`, `visit_insert_reservasi`, `visit_update_staff`; REVOKE INSERT/UPDATE/DELETE anon+authenticated; COMMENT tabel.
  - Data: `kunjungan` reservasi lama `loket` `terjadwal` dilengkapi dari `visit`; reservasi lama `bertemu_seseorang` bertanggal >= hari ini dibuatkan `kunjungan` (`legacy_visit_id`, QR sama); `skm_respons.kunjungan_id` di-backfill dari `visit_id`.
  - RPC tanpa `visit` (signature/hak sama): `layanan_mulai`, `layanan_selesai`, `fo_checkin_reservasi`, `fo_tolak_reservasi`, `fo_selesai`, `fo_eskalasi`, `fo_ambil_dari_kotak_masuk`, `layanan_kembalikan`, `admin_alihkan`, `reservasi_batalkan`, `tandai_tidak_terlayani_akhir_hari`, `tandai_reservasi_no_show`; DROP `fo_sinkron_visit(uuid)`.
  - SKM: kolom `skm_respons.kunjungan_id` (FK, unik parsial `skm_respons_kunjungan_id_uniq`), `kunjungan_layanan_skm(uuid)`, `get_skm_context`, `submit_skm_response` (via `kunjungan.qr_token`, cadangan arsip `visit`).
  - Notifikasi: `queue_notifikasi` (+ kunci `kunjungan:`), `notify_kunjungan_status` + `trg_notify_kunjungan_status`, `notify_tiket_antrean` + `trg_notify_tiket_antrean`; response rate `kunjungan_selesai_rr` + `trg_kunjungan_selesai_rr`; audit `trg_audit_kunjungan_status`, `trg_audit_tiket_status`.
  - Estimasi: `mv_estimasi_layanan` dibuat ulang dari `tiket_antrean` (kolom + indeks sama), `v_antrian_loket` dibuat ulang persis 202607300016. `jumlah_terdaftar`, `metrik_kepatuhan` tanpa `visit`.
- Menyentuh data pengunjung? : Ya (salin kolom reservasi lama `visit` → `kunjungan`; buat `kunjungan` untuk reservasi lama `bertemu_seseorang`). Tidak menghapus apa pun.
- Ringkasan    : menuntaskan checklist `docs/analysis/ANTREAN-ARAH-TULIS.md` §6.2 (keputusan CEO: hentikan tulis `visit`, data lama jadi arsip). Penjaga migrasi menolak bila ada tiket `menunggu`/`dipanggil` hari ini (`CUTOVER_DITOLAK`).
- Urutan penerapan : SETELAH 0002..0006 (penjaga `PRASYARAT`), SEBELUM 0008, satu jendela cutover (Jumat setelah 16:00 / akhir pekan, antrean kosong) bersama deploy klien Tahap B.
- Dampak klien/skrip : semua penulis `visit` di `src/` harus sudah diganti RPC (per 2026-10-14 tidak ada lagi di working tree; tersisa pembaca arsip `api/admin/pelayanan/[tiketId]/route.ts:150`, `admin/scan/page.tsx:163` dan realtime `table: 'visit'` di `admin/page.tsx`, `admin/kunjungan/page.tsx` yang tidak akan menyala lagi). `scripts/test-fo-eskalasi.mjs` seksi 5/8 (asersi `visit` ikut berubah) tidak berlaku lagi untuk DB yang memuat 0007. Muat ulang skema PostgREST.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-wp24-akhiri-dual-write-202610140007.sql --atomic` (`--dry-run` dulu), SETELAH rollback 0008. Memulihkan 17 fungsi PERSIS dari sumbernya + `fo_sinkron_visit` + `guard_visit_transisi_layanan`, policy/hak `visit`, MV/view, ENABLE 8 trigger; menghapus objek baru dan kolom `skm_respons.kunjungan_id`. Data backfill dibiarkan. Jendela rollback: lihat runbook.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: `visit` menjadi arsip (`trg_visit_arsip` aktif; trigger tulis lama nonaktif). Uji perilaku `scripts/test-wp24.mjs` (ROLLBACK terhadap produksi, bersama 0008) = 101 lolos.
- Catatan pembaca `visit` : Sisa pembaca arsip `visit` di klien sudah dipindahkan: `api/admin/pelayanan/[tiketId]/route.ts` (GET membaca `asal_instansi`, `email`, `keperluan` dari `kunjungan`, lalu profil `pengunjung`), `admin/scan/page.tsx` (rincian reservasi lama dari `kunjungan`; 0007 bagian 2 sudah menyalin/membuat barisnya), realtime `admin/page.tsx` dan `admin/kunjungan/page.tsx` (`tables: ['tiket_antrean', 'penanganan']` lewat opsi baru `tables` di `useRealtimeRefetch`). `kunjungan` TIDAK ada di publikasi `supabase_realtime` (hanya `tiket_antrean`, `penanganan`, `visit`, chat); perubahan yang hanya menyentuh `kunjungan` (mis. job no-show) terjemput polling 30 detik. Penjaga statis `src/test/visit-arsip.test.ts` memastikan tak ada lagi `.from('visit')`/`table: 'visit'`/rpc `*visit*` di `src` (kecuali komentar).
- Bukti (2026-10-14) :
  - `npx vitest run --pool=vmForks supabase/migrations src/app/skm src/app/api/skm`: 44 berkas, 594 test lolos (termasuk `wp24.test.ts` 54 test dan `manifest.test.ts` setelah regenerasi).
  - `npx tsc --noEmit`: bersih. `npx eslint --max-warnings=0` untuk berkas baru: bersih.
  - `apply-migration --atomic --dry-run` terhadap produksi (2026-10-14 06:04 WIB): 0007 → `GAGAL, di-ROLLBACK: PRASYARAT: model/RPC FO belum ada`; 0008 → `PRASYARAT: 202610140007 ... belum diterapkan`. Sesuai rancangan saat itu (0002..0006 belum di produksi); tidak ada perubahan. Malam harinya (setelah 0002..0006 terpasang) 0007 dan 0008 diterapkan atomik: dry-run lalu COMMIT.
  - `scripts/test-wp24.mjs` (uji perilaku, selalu ROLLBACK): siang 2026-10-14 tidak dijalankan (jam DB 06:04 WIB, hari kerja sebelum 16:00; aturan CEO melarang). **Dijalankan malam 2026-10-14 terhadap produksi (ROLLBACK): 101 lolos** (0007 dan 0008). Dua bug skrip uji (cast tipe `"char"` di `test-wp24.mjs`; fixture chat di `test-perbaikan-review.mjs`) diperbaiki di commit `d7344e3` sebelum dijalankan ulang.
- Pertanyaan terbuka :
  1. Email SKM ke `kunjungan.email` yang dicatat FO untuk walk-in tanpa akun: setuju (PDP/consent lisan di FO)?
  2. SKM untuk kunjungan yang selesai di FO tersimpan dengan `layanan_id` NULL → tidak masuk IKM per layanan. Perlu kategori "Front Office" di IKM?
  3. Retensi belum mencakup `pelayanan_oss`/`pelayanan_perizinan`, `buku_tamu`, chat.
  4. Job penutupan otomatis menutup juga tiket lama `dilayani` yang macet (mis. sejak 2026-10-05) pada jalan pertama dan mengirim SKM untuknya.

### [2026-10-14] — Alur FO: penyelarasan RPC A3, job akhir hari/no-show, rekap, posisi antrean (M-202610140005_fo_selaras_antrean) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Fase 3 Tahap B (B-DB1 bagian 3/3) / `supabase/migrations/202610140005_fo_selaras_antrean.sql` + test kontrak `supabase/migrations/fo_eskalasi.test.ts` + rollback `docs/rollback-fo-selaras-antrean-202610140005.sql` + uji perilaku (transaksi di-ROLLBACK; dijalankan 2026-10-14 malam, gabungan 0003-0005 = 150 lolos) `scripts/test-fo-eskalasi.mjs`
- Jenis        : DDL (fungsi diganti; `layanan_selesai` berganti signature)
- Objek        : `layanan_mulai(uuid)` (A3 + tahap penanganan menunggu -> berjalan); `layanan_selesai` DROP `(uuid, text, jsonb)` -> CREATE `(uuid, text, jsonb, uuid, text)` ber-DEFAULT (topik_id, catatan wajib untuk tiket hasil eskalasi; tiket lama tidak berubah); `admin_ambil_alih(uuid, text)` (kunci kunjungan sebelum tiket; tahap lama `batal`/`diambil_alih` + tahap Admin); `get_queue_position(uuid)` (tiket menunggu terbaru); `tandai_tidak_terlayani_akhir_hari()` (+ tiket eskalasi tanpa visit dan kotak masuk FO); `rollup_rekap_harian(date)` (`total_hadir` tanpa `dialihkan`); `tandai_reservasi_no_show()` (+ reservasi `kunjungan` tanpa visit). TIDAK mengubah `sync_visit_dual_write`, `panggil_tiket`, `finalize_pelayanan`, `v_layar_antrian`, `v_antrian_loket`.
- Menyentuh data pengunjung? : Tidak saat diterapkan (hanya fungsi). Saat berjalan, job harian menulis status kunjungan/tiket/penanganan.
- Ringkasan    : menjaga perilaku A3 untuk tiket lama (sinkron `visit` TIDAK dihapus; itu tugas WP-24) sambil membuat tahap `penanganan` ikut bergerak untuk tiket hasil eskalasi. Tanpa bagian 5 dan 7, tiket eskalasi `menunggu` tak pernah `tidak_terlayani` dan reservasi baru tak pernah `no_show` (job lama hanya menulis `visit`).
- Urutan penerapan : SETELAH 202610140004. Ketiganya (0003 -> 0004 -> 0005) diterapkan dalam satu jendela cutover, bersamaan dengan deploy klien Tahap B.
- Dampak klien/skrip : `layanan_selesai` 3-argumen dihapus; panggilan dengan argumen bernama (`src/app/admin/antrian/page.tsx`, `api/admin/pelayanan/[tiketId]`) dan `finalize_pelayanan` tetap tersambung ke signature baru, tetapi tiket hasil eskalasi WAJIB mengirim `p_topik_id` + `p_catatan`. Muat ulang skema PostgREST setelah terap. `scripts/test-tiket-kepemilikan.mjs` seksi 8 (rollback A3 + snapshot) tidak berlaku lagi bila dijalankan terhadap DB yang memuat migrasi ini.
- Cara menerapkan : WAJIB `--atomic`: `node scripts/apply-migration.mjs supabase/migrations/202610140005_fo_selaras_antrean.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-fo-selaras-antrean-202610140005.sql --atomic` (`--dry-run` dulu); memulihkan 7 fungsi PERSIS dari 202610140002 / 202607300016 / 202607300017 / 202607300020 / 202608310002 (dirakit otomatis dari berkas sumber, diuji `fo_eskalasi.test.ts`). Rollback ini PERTAMA, sebelum 0004 dan 0003.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Uji perilaku `scripts/test-fo-eskalasi.mjs` (ROLLBACK terhadap produksi, gabungan 0003-0005) = 150 lolos.

### [2026-10-14] — Alur FO: RPC Front Office, eskalasi, kembalikan, alihkan, reservasi pengunjung (M-202610140004_fo_rpc) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Fase 3 Tahap B (B-DB1 bagian 2/3) / `supabase/migrations/202610140004_fo_rpc.sql` + test kontrak `supabase/migrations/fo_eskalasi.test.ts` + rollback `docs/rollback-fo-rpc-202610140004.sql` + uji perilaku `scripts/test-fo-eskalasi.mjs`
- Jenis        : DDL (fungsi baru); tidak mengubah objek yang ada
- Objek        : RPC klien (SECURITY DEFINER, `search_path` terkunci, REVOKE PUBLIC/anon, GRANT authenticated): `fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid)`, `fo_checkin_reservasi(text)`, `fo_tolak_reservasi(text, text)`, `fo_selesai(uuid, uuid, text)`, `fo_eskalasi(uuid, uuid, uuid, text)`, `fo_ambil_dari_kotak_masuk(uuid)`, `layanan_kembalikan(uuid, text, uuid)`, `admin_alihkan(uuid, uuid, text)`, `reservasi_buat(text, date, uuid, text, text, time)`, `reservasi_batalkan(uuid)`; internal (tanpa EXECUTE untuk anon/authenticated): `staf_wajib_sesi(text[])`, `fo_validasi_topik(uuid, uuid)`, `fo_validasi_catatan(text, integer)`, `fo_sinkron_visit(uuid)`, `fo_notifikasi_tiket(uuid, text)`.
- Menyentuh data pengunjung? : Ya saat berjalan (kunjungan berisi nama, HP, instansi, kategori, email, keperluan; penanganan berisi catatan). Tidak ada perubahan data saat diterapkan.
- Ringkasan    : alur spec §3: walk-in/QR dilayani FO tanpa tiket; FO selesai sendiri (topik + catatan <= 200 wajib) atau eskalasi (tiket `<KODE>-<nnn>` + tahap layanan `menunggu` + notifikasi web push petugas aktif lewat `queue_notifikasi`); petugas pemilik mengembalikan ke kotak masuk FO; FO mengambil atomik (`WHERE status='menunggu'`); Admin mengalihkan ke layanan lain (`audit_log`). Semua RPC staf: `staf_saya()` + `sesi_valid()`; waktu server; urutan kunci visit -> kunjungan -> tiket -> penanganan. Reservasi pengunjung pindah dari `INSERT visit` ke `reservasi_buat` (tanggal 0..7 hari kerja, jadwal layanan, kuota `kuota_harian` bila diisi, cek ganda). Alur baru tidak menulis `visit`, kecuali menyinkronkan reservasi lama (punya `legacy_visit_id`) dengan flag `lmh.antrean_rpc`.
- Urutan penerapan : SETELAH 202610140003, SEBELUM 202610140005 (jendela cutover yang sama).
- Peringatan    : untuk kunjungan baru (tanpa `visit`), SKM lama (`get_skm_context`/`submit_skm_response` via `visit.qr_token`), notifikasi `notify_visit_selesai`, `skm_response_rate`, `mv_estimasi_layanan`, pengingat H-1 (`jumlah_terdaftar`) tidak berjalan sampai WP-24/Tahap E. Admin diizinkan memakai RPC FO (perlu konfirmasi CEO).
- Cara menerapkan : WAJIB `--atomic`: `node scripts/apply-migration.mjs supabase/migrations/202610140004_fo_rpc.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-fo-rpc-202610140004.sql --atomic` (`--dry-run` dulu); menghapus 15 fungsi; menolak bila fungsi lain masih memanggilnya (rollback 0005 dulu). Data yang ditulis RPC dibiarkan.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: fungsi FO ada. Uji perilaku `scripts/test-fo-eskalasi.mjs` (ROLLBACK terhadap produksi, gabungan 0003-0005) = 150 lolos.

### [2026-10-14] — Alur FO: model data `penanganan`, `topik_penanganan`, prefiks 2 huruf, kolom kunjungan/tiket (M-202610140003_fo_model_data) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Fase 3 Tahap B (B-DB1 bagian 1/3) / `supabase/migrations/202610140003_fo_model_data.sql` + test kontrak `supabase/migrations/fo_eskalasi.test.ts` + rollback `docs/rollback-fo-model-data-202610140003.sql` + uji perilaku `scripts/test-fo-eskalasi.mjs`
- Jenis        : DDL (tabel baru, kolom, constraint, indeks, trigger, policy, fungsi) + DATA (backfill `layanan.prefiks_antrean`; seed `topik_penanganan`)
- Objek        :
  - `layanan.prefiks_antrean`: backfill (kode tidak valid dikosongkan; OS NO BM BL BP IG JI MU SH SM menurut pola nama; sisanya otomatis), trigger `trg_layanan_isi_prefiks` + fungsi `layanan_isi_prefiks()`, `prefiks_antrean_usul(text, uuid)` (internal), `SET NOT NULL`, CHECK `layanan_prefiks_antrean_format` (`^[A-Z]{2}$`), indeks unik penuh `uq_layanan_prefiks_antrean` (menggantikan parsial `uq_layanan_prefiks`).
  - `terbit_tiket(uuid, uuid)` diganti: tanggal tiket = hari ini WIB, `nomor_display` `<KODE>-<nnn>` (>= 1000 tidak dipotong). Hak tetap service_role.
  - `kunjungan`: CHECK `asal` += `online`; kolom `chat_sesi_id` (FK `chat_sesi`), `selesai_at`, `asal_instansi`, `kategori` (CHECK), `email`, `keperluan`, `tujuan` (CHECK), `layanan_saran_id` (FK), `nama_yang_ditemui`, `jam_rencana`, `client_request_id` (unik parsial), `dibuat_oleh` (FK petugas); CHECK `kunjungan_online_chat_check`; trigger `trg_kunjungan_selesai_at` + fungsi `kunjungan_isi_selesai_at()` (jam server); indeks status/tanggal dan chat; `DROP POLICY kunjungan_staff_update` (tanpa pengganti); `DROP POLICY IF EXISTS kunjungan_insert_public / tiket_insert_public` (sudah dicabut 202610080001) + penjaga yang MENGGAGALKAN migrasi bila masih ada policy tulis klien pada `kunjungan`/`tiket_antrean`.
  - tabel `topik_penanganan` (RLS: SELECT staf, tulis Admin) + seed 7 topik FO dan topik 10 layanan (draf `docs/superpowers/specs/2026-10-13-topik-penanganan-draf.md`; `WHERE NOT EXISTS`).
  - tabel `penanganan` (CHECK konsistensi status, `UNIQUE (kunjungan_id, tahap_ke)`, satu tahap terbuka per kunjungan dan per tiket, RLS hanya SELECT via `boleh_penanganan(uuid, text, uuid, uuid, text)`, REVOKE tulis klien, publikasi `supabase_realtime`, REPLICA IDENTITY FULL).
  - `tiket_antrean`: kolom `penanganan_asal_id` (FK penanganan), `dialihkan_ke` (FK tiket); CHECK status += `dikembalikan`, `dialihkan`.
- Menyentuh data pengunjung? : Tidak (backfill hanya kode layanan; seed hanya topik)
- Ringkasan    : fondasi spec §4.1–4.5 untuk alur FO -> eskalasi. Deviasi sadar: `penanganan.status` punya `batal` (+ `batal_karena`), topik disimpan `topik_id` + salinan teks; kunjungan menyimpan data walk-in karena FO tidak bisa membuat baris `pengunjung` (`auth_user_id NOT NULL`).
- Dampak klien/skrip : form/route Kelola Layanan (zod `^[A-Z]{1,3}$`) harus diubah ke tepat 2 huruf (1/3 huruf kini `23514`; kosong = otomatis). `scripts/test-rbac-tahap1.mjs:295` ("petugas UPDATE kunjungan layanannya berhasil") akan gagal karena `kunjungan_staff_update` dicabut (perilaku yang dimaksud). `src/` tidak menulis `kunjungan` (diperiksa).
- Urutan penerapan : SETELAH 202610140001 dan 202610140002 (penjaga prasyarat menolak bila `layanan_mulai` belum ada). Jendela cutover Tahap B (Gerbang G.6: setelah 16:00 WIB, antrean kosong, Jumat sore/akhir pekan): 0003 -> 0004 -> 0005 -> deploy klien Tahap B. ALTER TABLE mengunci `layanan`/`kunjungan`/`tiket_antrean` sebentar.
- Cara menerapkan : WAJIB `--atomic`: `node scripts/apply-migration.mjs supabase/migrations/202610140003_fo_model_data.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten. Uji perilaku (selalu ROLLBACK; menyentuh DB produksi, butuh konfirmasi CEO): `node scripts/test-fo-eskalasi.mjs --apply supabase/migrations/202610140003_fo_model_data.sql --apply supabase/migrations/202610140004_fo_rpc.sql --apply supabase/migrations/202610140005_fo_selaras_antrean.sql [--akhir-hari]` (tambah `--pre` 202610140002 bila A3 belum diterapkan).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-fo-model-data-202610140003.sql --atomic` (`--dry-run` dulu), PALING AKHIR. MENGHAPUS tabel `penanganan`/`topik_penanganan` dan kolom baru; menolak bila fungsi 0004 masih ada, bila `penanganan` berisi baris, ada kunjungan `online`, atau tiket `dikembalikan`/`dialihkan` (kecuali flag sadar `lmh.rollback_paksa`). Memulihkan `terbit_tiket` (202607290013), `kunjungan_staff_update` (202610090001), CHECK lama, indeks parsial lama. Nilai prefiks 2 huruf dibiarkan.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: prefiks layanan 2 huruf terpasang. Uji perilaku `scripts/test-fo-eskalasi.mjs` (ROLLBACK terhadap produksi, gabungan 0003-0005) = 150 lolos.

### [2026-10-13] — C2 Pernyataan kebenaran + kunci Nama Lengkap (M-202610140006) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Tahap C2 (K12; keputusan CEO Gerbang G.3 Opsi A) / `202610140006_pernyataan_kebenaran.sql` + kode
- Jenis        : DDL (fungsi + trigger, tanpa kolom/tabel baru) + kode
- Objek        :
  - `pengunjung_profil_lengkap(nama, email, no_hp, asal_instansi, kategori)` — definisi tunggal "profil lengkap" di SQL (tanpa NIK), IMMUTABLE
  - `jaga_nama_pengunjung()` + trigger `trg_jaga_nama_pengunjung` (BEFORE UPDATE `pengunjung`): bila profil LAMA lengkap, pemilik tidak boleh mengubah `nama` (`NAMA_TERKUNCI`, 42501) maupun membuat profil tidak lengkap (`PROFIL_WAJIB_LENGKAP`, 22023). Dikecualikan: pemanggil tanpa `auth.uid()` (service_role, pg_cron anonimisasi 730 hari) dan flag transaksi-lokal `lmh.ubah_nama = 'on'`
  - `ubah_nama_pengunjung(uuid, text, text)` — RPC SECURITY DEFINER, admin/front_office aktif (`staf_saya()`), `sesi_valid()`, alasan >= 5 karakter, nama 3..120; menulis `audit_log` (`ubah_nama_pengunjung`, `nilai_lama`/`nilai_baru` {nama}, alasan). GRANT hanya `authenticated`
  - Kode (tanpa migrasi): `src/lib/pernyataan-kebenaran.ts` (JENIS/VERSI/TEKS berversi), `src/lib/profil-pengunjung.ts` (zod semua field wajib + email), `ProfileCompletenessGate` (kotak centang, field email, nama terkunci read-only, `consent_log` tujuan `pernyataan_kebenaran` via `mutasiInsert` SEBELUM upsert profil; gagal = profil tidak disimpan)
- Menyentuh data pengunjung? : Tidak ada UPDATE/backfill. Namun profil yang SUDAH lengkap saat migrasi diterapkan langsung terkunci (nama hanya lewat RPC); pengunjung lama tanpa email dianggap belum lengkap dan diminta email + pernyataan pada kunjungan berikut. `consent_log` tidak diubah (kolom `tujuan`/`versi_kebijakan` dipakai apa adanya)
- Ringkasan    : K12 — pendaftaran online dengan pernyataan kebenaran data tercatat; Nama Lengkap terkunci di database; jalur resmi perubahan nama oleh FO/admin dengan audit.
- Cara mengembalikan : `docs/rollback-pernyataan-kebenaran-202610140006.sql` (DROP trigger + 3 fungsi; data tidak disentuh).
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Tanpa uji perilaku khusus: hanya tercakup sebagai prasyarat (`--pre`) uji lain dan test statis (`pernyataan_kebenaran.test.ts`). Profil pengunjung yang sudah lengkap kini terkunci namanya.

### [2026-10-14] — Kepemilikan tiket layanan: RPC `layanan_mulai`/`layanan_selesai` + `admin_ambil_alih` (M-202610140002_tiket_kepemilikan) — DITERAPKAN 2026-10-14
- WP/Migrasi   : Fase 3 Tahap A (T1, tugas A3) / `supabase/migrations/202610140002_tiket_kepemilikan.sql` + test kontrak `supabase/migrations/tiket_kepemilikan.test.ts` + rollback `docs/rollback-tiket-kepemilikan-202610140002.sql` + uji perilaku (transaksi di-ROLLBACK; dijalankan 2026-10-14 malam = 84 lolos) `scripts/test-tiket-kepemilikan.mjs`
- Jenis        : DDL (fungsi baru, fungsi diganti, trigger baru, policy) + DATA (backfill `tiket_antrean.dilayani_oleh` untuk tiket `dilayani` yang NULL)
- Objek        : fungsi baru `layanan_mulai(uuid)`, `layanan_selesai(uuid, text, jsonb)`, `admin_ambil_alih(uuid, text)`, `pemilik_tiket(uuid)` (helper RLS), `guard_visit_transisi_layanan()` + trigger `trg_guard_visit_transisi_layanan` (BEFORE UPDATE ON `visit`); `finalize_pelayanan` diganti menjadi pembungkus `layanan_selesai` (signature dan grant sama); `DROP POLICY tiket_staff_update` (tanpa pengganti); policy `oss_insert_staff`, `oss_update_staff`, `perizinan_insert_staff`, `perizinan_update_staff` ditambah syarat `pemilik_tiket(tiket_id)`. TIDAK mengubah `sync_visit_dual_write` dan `panggil_tiket`.
- Menyentuh data pengunjung? : Tidak (backfill hanya kolom `dilayani_oleh` tiket berstatus `dilayani`, berisi id petugas; per potret A0 2026-10-13 ada 2 tiket seperti itu)
- Ringkasan    : aturan CEO "tiket hanya boleh diselesaikan oleh orang yang memulainya" dan penutupan race T1 (dua penekan "Mulai Layanan"). Arah tulis A0 Opsi 1: `tiket_antrean` sumber kebenaran, guard atomik `WHERE status IN ('menunggu','dipanggil') AND dilayani_oleh IS NULL`, lalu `visit` disinkronkan di transaksi yang sama dengan `now()` identik (urutan kunci visit -> kunjungan -> tiket). Keputusan CEO 7.1: Admin boleh memulai/memiliki tiket layanan mana pun, petugas hanya layanannya, Front Office ditolak. 7.2: `admin_ambil_alih` (Admin, sesi sah, alasan >= 5 karakter, audit_log pemilik lama/baru/alasan, status tidak berubah). 7.3: backfill dari entri `audit_log` terakhir transisi visit ke `dilayani` (aktor -> `petugas.id`; tak terpetakan dibiarkan NULL, dapat diambil alih Admin). 7.4: validasi pendataan tidak diubah; `petugas_id` = pemilik saat diselesaikan. 7.5: draf pendataan hanya oleh pemilik tiket `dilayani` (route PATCH + RLS). Semua RPC memanggil `sesi_valid()` (`SESI_TIDAK_SAH`). Kode galat: SUDAH_DIAMBIL, BUKAN_PEMILIK, INVALID_STATUS, DIVERGENSI, SESI_TIDAK_SAH, NOT_FOUND, FORBIDDEN, ALASAN_WAJIB, TRANSISI_LEWAT_RPC.
- Urutan penerapan : (1) `202610140001_sesi_staf` diterapkan lebih dulu (penjaga prasyarat menolak bila `sesi_valid()` belum ada); (2) klien A2 (sesi tunggal) ter-deploy; (3) migrasi ini diterapkan BERSAMAAN dengan deploy klien A3 (halaman antrean memakai RPC). Terapkan DI LUAR JAM LAYANAN dan saat TIDAK ADA tiket `dilayani` hari itu (pola Gerbang G.6; ulangi kueri read-only A0 sebelum menerapkan). Klien lama yang masih terbuka akan menerima `TRANSISI_LEWAT_RPC` saat menekan Mulai/Selesai: beri tahu petugas untuk memuat ulang halaman.
- Dampak skrip : trigger penjaga juga berlaku untuk koneksi langsung (pemilik DB). Skrip yang meng-UPDATE `visit` langsung ke `dilayani`/`selesai` akan GAGAL `TRANSISI_LEWAT_RPC` sampai disesuaikan (nyalakan `set_config('lmh.antrean_rpc','on',true)` di transaksinya atau panggil RPC dengan klaim JWT): `scripts/selftest-wp21.mjs` (baris lifecycle `dilayani`/`selesai`), `scripts/test-rbac-tahap0.mjs` (alur walk-in -> dilayani -> selesai sebagai petugas), `scripts/test-rbac-tahap1.mjs` (persiapan tiket `dilayani` sebelum `finalize_pelayanan`; juga ekspektasi lama "FO bisa INSERT draf lintas layanan" dan "petugas A bisa INSERT draf" pada tiket `menunggu` kini ditolak RLS). Skrip `verify-*` tidak menulis `visit`. Aktor `system` di audit A0 (3 mulai, 5 selesai) kemungkinan berasal dari skrip seperti ini.
- Cara menerapkan : WAJIB `--atomic`: `node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten. Uji perilaku: `node scripts/test-tiket-kepemilikan.mjs --apply supabase/migrations/202610140001_sesi_staf.sql --apply supabase/migrations/202610140002_tiket_kepemilikan.sql` (selalu ROLLBACK; tetap menyentuh DB produksi, butuh konfirmasi CEO).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-tiket-kepemilikan-202610140002.sql --atomic` (`--dry-run` dulu). Memulihkan `finalize_pelayanan` dari 202610010001, `tiket_staff_update` dari 202607290013 dan keempat policy draf dari 202610090001; menghapus trigger dan fungsi baru. Nilai `dilayani_oleh` yang sudah terisi dan baris audit `admin_ambil_alih` dibiarkan (data). Kembalikan kode klien A3 bersamaan. Rollback `202610140001` hanya sesudah rollback ini.
- Status       : DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT, atas izin CEO). Verifikasi read-only: fungsi layanan ada. Uji perilaku `scripts/test-tiket-kepemilikan.mjs` (ROLLBACK terhadap produksi) = 84 lolos. [Dikoreksi 2026-10-14: baris status DITERAPKAN yang sebelumnya tercantum di entri ini adalah hasil verifikasi 202610140001 dan tertukar tempat.]

### [2026-10-14] — Sesi tunggal staf: tabel `sesi_staf` + RPC sesi (M-202610140001) — DITERAPKAN 2026-10-13
- WP/Migrasi   : Fase 3 Tahap A (K1, tugas A1) / `supabase/migrations/202610140001_sesi_staf.sql` + test kontrak `supabase/migrations/sesi_staf.test.ts` + rollback `docs/rollback-sesi-staf-202610140001.sql`
- Jenis        : DDL (tabel baru, fungsi baru, dua baris pengaturan); tidak mengubah objek yang ada
- Objek        : tabel `public.sesi_staf` (RLS aktif tanpa policy; REVOKE dari anon/authenticated); fungsi `sesi_klaim_id`, `sesi_idle_menit`, `sesi_tunggal_aktif` (internal), `sesi_status`, `sesi_valid`, `daftarkan_sesi`, `ping_sesi(boolean)`, `akhiri_sesi`; baris `site_settings` `sesi_idle_menit`=120 dan `sesi_tunggal_aktif`=false (`ON CONFLICT DO NOTHING`)
- Menyentuh data pengunjung? : Tidak (hanya `user_id` staf dan `session_id`)
- Ringkasan    : keputusan CEO: satu akun per orang, login baru menimpa sesi lama dan sesi lama tak sah di server; logout otomatis idle 2 jam dan setelah jam tutup. Flag `sesi_tunggal_aktif` = false selama transisi: staf tanpa baris sesi tetap diterima ('transisi'); staf yang sudah punya baris ditegakkan penuh (digantikan/idle). Cutover (flag true) hanya setelah klien A2 ter-deploy dan staf login ulang; bila lebih awal, semua staf ditolak RPC mutasi. Klaim `session_id` JWT belum dibuktikan pada token proyek ini.
- Cara menerapkan : WAJIB `--atomic`: `node scripts/apply-migration.mjs supabase/migrations/202610140001_sesi_staf.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-sesi-staf-202610140001.sql --atomic` (`--dry-run` dulu); menolak bila fungsi/policy lain (mis. RPC mutasi A3) masih memanggil `sesi_valid()`.
- Status       : DITERAPKAN ke produksi 2026-10-13 (migrasi 202610140001) (`apply-migration.mjs --atomic`; dry-run lalu COMMIT; atas izin CEO). Diverifikasi read-only: 8 fungsi ada (anon tanpa EXECUTE; fungsi internal tanpa EXECUTE untuk authenticated), tabel `sesi_staf` RLS aktif tanpa policy dan tanpa SELECT untuk authenticated (0 baris), `sesi_idle_menit`=120, `sesi_tunggal_aktif`=false. Ledger `schema_migrations` BELUM dicatat (skrip penerapan tidak menulis ledger).

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
- WP/Migrasi   : tugas 0.4 / `scripts/verify-migration-ledger.mjs` + `scripts/lib/migration-markers.mjs` (pengisi ledger `scripts/fill-migration-ledger.mjs`; dijalankan `--apply --yes` 2026-10-13 untuk migrasi lama dan 2026-10-14 malam untuk 0001-0013, lihat entri 2026-10-14 di atas)
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
- Status       : SELESAI (read-only). Pencatatan ledger retroaktif kemudian dilakukan (2026-10-13 migrasi lama; 2026-10-14 malam 0001-0013): lihat entri 2026-10-14 di atas dan `LEDGER-VERIFIKASI-2026-10-14.md`.

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
> Catatan historis: entri WP-21 berikut semula berstatus BELUM DITERAPKAN; status tiap entri di bawah sudah diubah ke DITERAPKAN setelah eksekusi.

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

**Status:** DITERAPKAN ke produksi 2026-10-14 (±17:52–17:57 WIB; `apply-migration --atomic`, dry-run lalu COMMIT). Verifikasi read-only: job `chat_tutup_otomatis` terjadwal. **Rollback:** `docs/rollback-perbaikan-review-202610140012.sql` (salinan PERSIS fungsi sebelumnya, diuji `supabase/migrations/perbaikan_review.test.ts`). **Uji perilaku:** `scripts/test-perbaikan-review.mjs`: dijalankan 2026-10-14 malam terhadap produksi (ROLLBACK, `--akhir-hari`), 61 lolos (skrip menolak Senin-Jumat 07:00-16:59 WIB).

| # | Temuan | Perubahan | Kode galat |
|---|---|---|---|
| 1 | Pendataan wajib hanya ditentukan klien | Kolom `layanan.form_pendataan` (`oss`/`perizinan`/NULL, CHECK), nilai awal dari nama via `form_pendataan_dari_nama(text)` (= `determineFormType`), trigger `trg_layanan_isi_form_pendataan` (BEFORE INSERT, isi dari nama bila NULL). `layanan_selesai` = versi 0011 + tolak `p_form_type` NULL/tak cocok untuk layanan wajib form, **untuk semua peran** (keputusan CEO 2026-10-14: pengecualian Admin pengambil alih + audit `layanan_selesai_tanpa_pendataan` dihapus in-place). Satu-satunya penutupan tanpa form: job `tutup_penanganan_tertinggal` (0008, 23:00 WIB; tidak lewat `layanan_selesai`) untuk tiket macet. | `INVALID_PAYLOAD` 22023 (sudah ada) |
| 2 | `get_queue_position` tak pernah cocok | `k.qr_token IN (p_qr_token::text, replace(p_qr_token::text,'-',''))`; signature `uuid` dan GRANT anon/authenticated tetap | — |
| 3 | Urutan rollback tanpa penjaga | Penjaga DO di rollback 0007 (tolak bila 0011/0012 ada), 0011 & 0009 (tolak bila 0012 ada), 0012 (tolak bila 0011/0009 hilang); runbook: larangan terapkan ulang 0004/0005 setelah 0007 | `ROLLBACK DITOLAK` |
| 4 | Idempotensi `fo_mulai_kunjungan` tidak tahan balapan | `INSERT ... ON CONFLICT (client_request_id) WHERE client_request_id IS NOT NULL DO NOTHING RETURNING` lalu baca ulang -> `sudah_ada` / `IDEMPOTENSI_BENTROK`; jalur cepat lama tetap | `IDEMPOTENSI_BENTROK`, `DIVERGENSI` (tak terduga) |
| 5 | Walk-in lama `terjadwal` terlantar | Gerbang: semua kunjungan `walk_in`+`terjadwal` -> `batal` saat migrasi; job `tandai_reservasi_no_show` + klausa walk-in `terjadwal` bertanggal lewat -> `batal`. Audit `tutup_walkin_terjadwal` (aktor system, alasan, legacy_visit_id). Nilai balik job = no_show + walk-in dibatalkan | — |
| 6 | Tiket `dilayani` lama tanpa pemilik | Tidak ada perubahan DB: UI `/admin/antrian` sudah punya "Ambil alih" untuk Admin (`bolehAmbilAlihTiket`: `dilayani_oleh` NULL juga), pilih tanggal tiket. Didokumentasikan di runbook §11. Admin pengambil alih menyelesaikan lewat wizard pendataan (form wajib, keputusan CEO 2026-10-14); tiket yang tak bisa didata ditutup otomatis 23:00 WIB | — |
| 7 | `layanan_mulai` menerima tiket tanggal lain | Tolak bila `tiket.tanggal <> hari ini WIB` | `BUKAN_HARI_INI` P0001 (kode yang sudah dipakai `fo_checkin_reservasi`) |
| 8 | `admin_alihkan` tanpa cek jadwal/jam tutup | Sama dengan `fo_eskalasi`: `is_layanan_buka_jadwal` + `layanan_sudah_tutup()` sebelum terbit tiket | `LAYANAN_TIDAK_BUKA` P0001, `LAYANAN_TUTUP` P0001 |
| 9 | Kunci advisory `reservasi_buat` memakai `p_layanan_id` mentah | Kunci = `COALESCE(CASE WHEN tujuan='loket' THEN p_layanan_id END, tujuan)` | — |
| 10 | Rekap: dikembalikan + eskalasi ulang ganda | `rollup_rekap_harian`: `total_hadir = count(DISTINCT kunjungan_id)` (tanpa terjadwal/dialihkan); `rata_durasi_menit` hanya tiket `selesai`. Kolom lain identik. Batasan: kunjungan yang dikembalikan dari A lalu dieskalasi ke B tetap dihitung hadir di A dan B (memang dilayani di keduanya); `total_selesai` dihitung per tiket | — |
| 11 | Chat: backfill tanpa batas, sesi tertinggal, spam anon | (0009 in-place) batas spam + backfill 24 jam, lihat bagian A. (0012) `tutup_chat_tertinggal()` + job `chat_tutup_otomatis` `30 16 * * *` (23:30 WIB) + dijalankan sekali saat migrasi: sesi `eskalasi`/`aktif` tanpa aktivitas > 24 jam -> tahap berjalan `batal/tidak_ditutup`, menunggu `batal/tidak_terlayani` (audit `tutup_otomatis_penanganan`), kunjungan dilayani -> `selesai` (memicu SKM, keputusan 0008), menunggu -> `tidak_terlayani`, sesi `selesai` + pesan sistem | — |
| 12 | `p_pengunjung_id` sembarang | Diterima hanya bila pengunjung ada (NOT_FOUND) DAN punya kunjungan bertanggal hari ini WIB; selain itu tolak | `DATA_TIDAK_VALID` 22023 |
| 13 | (keputusan CEO 2026-10-14) Live chat pada hari tanpa pelayanan | Fungsi baru `hari_tanpa_layanan(date DEFAULT hari ini WIB)` = Sabtu/Minggu/ada di `hari_libur` (aturan sama dengan `tambah_hari_kerja` dan bot `bot-waktu.ts`). `chat_ambil`/`chat_teruskan` = versi 0009 + tolak di awal (semua peran, termasuk ambil alih Admin). Trigger `chat_sesi_eskalasi_kunjungan`/`chat_pesan_eskalasi_kunjungan` = versi 0009 + syarat `NOT hari_tanpa_layanan()` (tanpa kunjungan/kotak masuk FO pada hari itu; dicatat pada pesan berikutnya di hari kerja atau saat `chat_ambil`). `chat_selesai` dan `tutup_chat_tertinggal` (24 jam) tidak berubah. Prasyarat baru: tabel `hari_libur` (dibuat 202607290007) | `HARI_TANPA_LAYANAN` P0001 (baru) |

**Hak:** fungsi baru `form_pendataan_dari_nama`, `layanan_isi_form_pendataan` (REVOKE PUBLIC/anon/authenticated), `tutup_chat_tertinggal` (REVOKE, GRANT service_role), `hari_tanpa_layanan` (GRANT anon/authenticated/service_role; data publik). `chat_ambil`/`chat_teruskan` di-REVOKE/GRANT ulang sama dengan 0009 (authenticated). Hak RPC yang diganti tidak berubah (CREATE OR REPLACE; `get_queue_position` dan `rollup_rekap_harian` di-REVOKE/GRANT ulang sama persis).

**Klien (deploy SETELAH 0012):** `src/lib/pelayanan.ts` (`formPendataanLayanan`, kode `BUKAN_HARI_INI`/`LAYANAN_TIDAK_BUKA`/`LAYANAN_TUTUP` + pesan), `/api/admin/pelayanan/[tiketId]` (jenis form dari `layanan.form_pendataan`; HTTP 409 untuk kode baru), `/admin/antrian` (wizard/tombol pendataan dari kolom), Kelola Layanan (`GET/PATCH /api/admin/layanan`: field `form_pendataan`; pilihan "Formulir Pendataan" di form dan kolom tabel), `AlihkanTiketModal` (galat jadwal/tutup di isian tujuan). Guard rename `RENAME_UBAH_JENIS_FORM` (PATCH layanan) dibiarkan (kini tidak wajib lagi; boleh dilonggarkan kemudian).

**Untuk kontrak `FO-ESKALASI-KONTRAK-RPC.md`** (belum diubah oleh R12; agen dokumen/kontrak): `layanan_mulai` + `BUKAN_HARI_INI`; `admin_alihkan` + `LAYANAN_TIDAK_BUKA`/`LAYANAN_TUTUP`; `layanan_selesai` + `INVALID_PAYLOAD` bila layanan wajib form; `fo_mulai_kunjungan` + `DATA_TIDAK_VALID` untuk `p_pengunjung_id`. `FO-CHAT-KONTRAK-RPC.md`: kunjungan chat tercatat saat sesi eskalasi DAN ada pesan pengunjung; job `chat_tutup_otomatis`.

**Bukti (2026-10-14):** `npx vitest run --pool=vmForks supabase/migrations` hijau (termasuk manifest dan `perbaikan_review.test.ts`); unit/komponen terkait hijau; eslint berkas tersentuh dan `tsc --noEmit` bersih. Uji perilaku DB TIDAK dijalankan (jam layanan).

**Klien #13 (aman di-deploy sebelum/sesudah 0012; menilai hari dari tabel `hari_libur`, tidak memanggil fungsi baru):** `src/lib/chat/hari-tanpa-layanan.ts` (penilaian hari + teks), `src/lib/llm/bot-waktu.ts` (`hariTanpaLayanan`, `modeHariTanpaLayanan`), `/api/chat/ai` (tanpa eskalasi pada jalur gagal; `reason` `hari_tanpa_layanan`), `/chat` (pemberitahuan, tanpa "Hubungkan ke Petugas"), `/admin/chat` (tombol ambil/ambil alih/teruskan nonaktif + alasan), `src/lib/chat-staf.ts` (kode `HARI_TANPA_LAYANAN` -> HTTP 409).

### Pertanyaan CEO (dijawab 2026-10-14, lihat `docs/DECISION_LOG.md` Fase 3)

1. **#12** tautan walk-in ke akun pengunjung: tetap konservatif (hanya pengunjung yang punya kunjungan/reservasi hari ini) — **masih pertanyaan terbuka** bila perlu bukti lain (scan QR profil, OTP).
2. **#1** pengecualian Admin pengambil alih — **DITOLAK**: Admin juga wajib form; tiket macet ditutup otomatis 23:00 WIB. Diterapkan in-place.
3. **#11** ambang 24 jam — **disetujui** (tidak diubah, juga untuk chat yang menunggu dari hari kerja terakhir sebelum hari tanpa pelayanan).
4. **#5** walk-in lama `terjadwal` -> `batal` — **disetujui**.
5. **#10** `total_hadir` = pengunjung berbeda per layanan per hari — **disetujui**.

```markdown
### [2026-10-14] — Walk-in FO: semua field wajib + validasi HP/email (M-202610140014_walkin_data_lengkap) — DITERAPKAN 2026-10-14 malam (atomik, dry-run lalu COMMIT; ledger terisi; verifikasi read-only: validasi HP/email terpasang di fo_mulai_kunjungan, anon tanpa EXECUTE, authenticated EXECUTE)
- WP/Migrasi   : permintaan CEO 2026-10-14 (pendaftaran walk-in FO lengkap dan tervalidasi) / `supabase/migrations/202610140014_walkin_data_lengkap.sql` + test kontrak `supabase/migrations/walkin_data_lengkap.test.ts` + rollback `docs/rollback-walkin-data-lengkap-202610140014.sql`
- Jenis        : perilaku RPC (validasi); tanpa tabel/kolom/policy/hak baru; tanpa DML
- Objek        : `public.fo_mulai_kunjungan(text, text, text, text, text, text, uuid, uuid, uuid)`: normalisasi + validasi (nama 3–100 huruf/.,'’- min 3 huruf; asal 3–120; HP wajib kanonik `08…` `^08[1-9][0-9]{7,10}$`; kategori wajib; email wajib huruf kecil ≤ 254; keperluan wajib 10–500; layanan saran tetap opsional). Galat `DATA_TIDAK_VALID` (22023) + DETAIL nama field. COMMENT penanda `202610140014`. Bagian lain identik versi 0012.
- Menyentuh data pengunjung? : Tidak mengubah data lama. Kunjungan BARU: HP disimpan kanonik (`+62 812-…` → `0812…`), email huruf kecil, nama dengan spasi dirapatkan.
- Prasyarat    : 0013 (penanda komentar `boleh_penanganan`), 0012 (`hari_tanpa_layanan`). Urutan: `... -> 0012 -> 0013 -> 0014`.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610140014_walkin_data_lengkap.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-walkin-data-lengkap-202610140014.sql --atomic` (`--dry-run` dulu); memulihkan `fo_mulai_kunjungan` PERSIS versi 0012 dan menghapus komentar. PERTAMA dalam urutan rollback (sebelum 0013/0012). Kunjungan yang tercatat selama 0014 terpasang tidak diubah (bentuknya tetap sah menurut 0012).
- Klien        : `/admin/fo/daftar` + `src/lib/fo/walkin.ts` (aturan sama; agent UI). Replay offline (`src/lib/offline/replay.ts`) tidak perlu diubah: `DATA_TIDAK_VALID` sudah permanen.
- Dry-run      : 2026-10-14 ±21:29 WIB produksi (memuat 0013): migrasi dan rollback berhasil dieksekusi lalu di-ROLLBACK.
- Uji perilaku : `scripts/test-walkin-data.mjs --apply supabase/migrations/202610140014_walkin_data_lengkap.sql` — 2026-10-14 ±21:29 WIB, 96 lolos / 0 gagal (ROLLBACK; snapshot rollback identik; baris sebelum == sesudah).
- Status       : DITULIS, BELUM DITERAPKAN
```
