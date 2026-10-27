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

### [2026-10-15] — Pendataan tanpa topik/catatan dari petugas, email walk-in opsional (M-202610140015_pendataan_tanpa_topik_email_opsional) — DITERAPKAN 2026-10-15 (atomik, dry-run lalu COMMIT; ledger terisi)
- Permintaan CEO: (1) petugas layanan tidak lagi diminta topik + catatan penanganan pada tiket eskalasi FO; topik tahap layanan NULL, catatan diturunkan di server dari payload Pendataan (tindak_lanjut + uraian_solusi/catatan_petugas, ≤1000, '-' bila kosong). Layanan tanpa Pendataan (mis. BPJS/Bank) tetap wajib topik+catatan lewat SelesaiEskalasiModal. (2) Email walk-in FO opsional (NULL bila kosong; bila diisi tetap divalidasi); email wajib dilengkapi petugas layanan di Pendataan ('Tidak berlaku' bila tidak ada). Rekap FO/layanan: kolom Email dari Pendataan tiket, lalu Pendataan terbaru pada kunjungan sama, lalu email kunjungan.
- Rollback: `docs/rollback-pendataan-tanpa-topik-email-opsional-202610140015.sql`. Belum diuji perilaku terhadap DB (hanya dry-run + test statis); `scripts/test-walkin-data.mjs` perlu diperbarui (email kini opsional).

### [2026-10-26] — Survei terpadu Fase A: undangan survei per kunjungan selesai (M-202610270001_survei_undangan) — DITULIS, BELUM DITERAPKAN
- WP/Migrasi   : spesifikasi `docs/superpowers/specs/2026-10-26-survei-terpadu-design.md` §4.1 (survei terpadu Fase A, langkah 1 dari 4: 202610270001-202610270004) / `supabase/migrations/202610270001_survei_undangan.sql` + test kontrak `supabase/migrations/survei_undangan.test.ts` + rollback `docs/rollback-survei-undangan-202610270001.sql`
- Jenis        : tabel baru + 3 fungsi + 1 trigger + 1 view; ADITIF; tanpa DML; tanpa mengubah tabel, kolom, policy, atau fungsi lama
- Objek        : `public.survei_undangan` (kunjungan_id unik FK ON DELETE CASCADE, token unik CHECK 64 heksadesimal huruf kecil, layanan_id FK ON DELETE SET NULL, unit layanan|fo, dibuat_pada, kedaluwarsa_pada, diisi_pada, saran_dikirim, pengaduan_dikirim; RLS aktif TANPA policy; REVOKE ALL dari PUBLIC/anon/authenticated); `ensure_undangan(uuid) -> uuid` (SECURITY DEFINER, idempoten, EXECUTE hanya service_role); `kunjungan_selesai_undangan()` (fungsi trigger, tanpa GRANT); trigger `trg_kunjungan_selesai_undangan` (AFTER UPDATE OF status ON kunjungan, WHEN status menjadi selesai); `ambil_qr_survei(uuid) -> jsonb` (SECURITY DEFINER, STABLE, EXECUTE authenticated, FORBIDDEN 42501 tanpa `boleh_kunjungan`); view `v_survei_status` (tanpa token; tanpa security_invoker; security_barrier; GRANT SELECT authenticated). Semua fungsi `SET search_path = pg_catalog, public`.
- Menyentuh data pengunjung? : Tidak mengubah data yang ada dan TIDAK mem-backfill kunjungan lama. Data baru: token acak per kunjungan selesai berikutnya (tanpa PII; hanya merujuk kunjungan_id). Token tidak pernah ada di view maupun di respons selain `ambil_qr_survei` untuk undangan belum diisi dan belum kedaluwarsa.
- Prasyarat    : kolom `kunjungan.selesai_at` (202610140003), `kunjungan_layanan_skm(uuid)` (202610140007), `boleh_kunjungan(uuid)` (202610140009); dijaga blok PRASYARAT. Urutan seri: 0001 -> 0002 -> 0003 -> 0004.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610270001_survei_undangan.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten (IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-survei-undangan-202610270001.sql --atomic` (`--dry-run` dulu). PALING AKHIR dalam seri (setelah rollback 0004, 0003, 0002). MENGHAPUS semua data undangan (tidak bisa dipulihkan; kunjungan selesai tidak mendapat undangan lagi bila diterapkan ulang). Diawali penjaga (blok DO) `PRASYARAT ROLLBACK`: menolak seluruh rollback bila ada fungsi di schema public, selain tiga yang di-DROP, yang badannya menyebut `ensure_undangan` atau `survei_undangan` (Postgres tidak mencatat ketergantungan dari badan plpgsql/sql ke fungsi atau tabel, jadi DROP saja tidak menolak, dan pemakai itu baru gagal saat dipanggil; mis. `notify_kunjungan_status` di 0004 akan membuat setiap UPDATE kunjungan ke selesai gagal). Tanpa CASCADE (ketergantungan yang dicatat Postgres, mis. view dan FK, tetap menggagalkan DROP).
- Klien        : belum ada (dialog QR staf dan lencana status memakai `ambil_qr_survei` dan `v_survei_status` di task berikutnya).
- Dry-run      : belum dijalankan (hanya PGlite lokal; DB nyata tidak disentuh).
- Uji perilaku : `scripts/lokal/skenario-survei-undangan.mjs` di PGlite lokal (stub skema `scripts/lokal/pglite-stub.sql`, bukan DB nyata): 94 lolos, 0 gagal. Mencakup: kunjungan -> selesai membuat tepat satu undangan (token 64 heksadesimal, kedaluwarsa_pada = selesai_at + 32 jam); ensure_undangan dipanggil berulang dan UPDATE status berulang tidak menambah baris dan tidak menggeser kedaluwarsa_pada (bukti kuat: kunjungan dibuka lalu diselesaikan ulang setelah selesai_at maju 10 jam; id, token, dan kedaluwarsa_pada tetap); unit fo (tanpa tiket selesai, termasuk hanya tiket batal) dan layanan (layanan_id terisi); tanpa undangan untuk menunggu/dilayani/batal/no_show dan INSERT langsung selesai (tanpa backfill); anon dan authenticated ditolak (42501) untuk SELECT/INSERT/UPDATE/DELETE langsung, ensure_undangan, dan fungsi trigger; constraint (kunjungan_id unik, token unik, unit, format token, CASCADE, SET NULL); ambil_qr_survei oleh FO/admin/petugas pemilik tiket (token hanya belum_diisi; tanpa token untuk sudah_diisi dan kedaluwarsa, termasuk tepat di batas kedaluwarsa_pada = now(); sudah_diisi menang atas kedaluwarsa), FORBIDDEN untuk petugas layanan lain, non-staf, dan anon, tidak_ada bila belum ada undangan; v_survei_status menyaring per boleh_kunjungan (admin/FO semua, petugas hanya layanannya, non-staf 0 baris, anon ditolak, tanpa kolom token); penerapan ulang migrasi tanpa mengubah data; rollback (penjaga menolak dengan PRASYARAT ROLLBACK bila fungsi plpgsql atau sql lain memakai ensure_undangan atau survei_undangan dan tidak ada yang terhapus; setelah pemakai itu dihapus rollback berhasil; semua objek hilang, idempoten, migrasi dapat diterapkan lagi; premis bahwa DROP saja tidak menolak pemakai plpgsql dibuktikan dulu di PGlite). Pemeriksaan mutasi manual pada salinan migrasi (batas >= menjadi >, DO NOTHING menjadi DO UPDATE, token selalu dikembalikan, tanpa REVOKE tabel, tanpa penjaga boleh_kunjungan, view tanpa filter, tanpa trigger, tanpa cek status selesai, unit selalu layanan, 24 jam, urutan sudah_diisi/kedaluwarsa): semuanya tertangkap skenario, kecuali penghapusan klausa WHEN trigger yang secara perilaku setara (ensure_undangan sudah idempoten dan memeriksa status sendiri) sehingga dijaga test statis. Batasan: stub `boleh_kunjungan` disederhanakan (tanpa cabang kunjungan online); tabel stub lain lebih ketat dari produksi.
- Status       : DITULIS, BELUM DITERAPKAN

### [2026-10-27] — Survei terpadu Fase A: jawaban survei 11 unsur, spak_respons, ringkasan IKM/SPAK/response rate (M-202610270002_survei_jawaban) — DITULIS, BELUM DITERAPKAN
- WP/Migrasi   : spesifikasi `docs/superpowers/specs/2026-10-26-survei-terpadu-design.md` §4.2, §4.3, §6 (survei terpadu Fase A, langkah 2 dari 4) / `supabase/migrations/202610270002_survei_jawaban.sql` + test kontrak `supabase/migrations/survei_jawaban.test.ts` + rollback `docs/rollback-survei-jawaban-202610270002.sql`
- Jenis        : 7 kolom baru + 1 constraint pada tabel lama (`skm_respons`) + 1 UPDATE data + tabel baru + 3 fungsi baru + 1 fungsi diganti + 1 view diganti + 1 policy; ADITIF (tanpa DROP/DELETE/TRUNCATE pada objek atau data lama)
- Objek        : `public.skm_respons` + `u10_transparansi`, `u11_integritas` (smallint, CHECK 1-4, boleh kosong), `versi` (smallint NOT NULL default 1), `sumber` (NOT NULL default `form_lama`, CHECK `form_lama|wizard|impor`), `unit` (NOT NULL default `tidak_diketahui`, CHECK `layanan|fo|tidak_diketahui`), `jenis_kelamin`, `pendidikan` (teks, boleh kosong); constraint `skm_respons_wizard_kunjungan_versi_check` (`sumber <> 'wizard'` ATAU `kunjungan_id` terisi DAN `versi = 2`); komentar "tidak dipakai alur baru" pada `visit_id` dan `saran`; `public.spak_respons` (kunjungan_id UNIK boleh kosong FK ON DELETE SET NULL, layanan_id FK ON DELETE SET NULL, unit, sumber `wizard|impor`, p1_tanpa_diskriminasi .. p5_tanpa_percaloan smallint NOT NULL CHECK 1-6, jenis_kelamin, pendidikan, created_at; RLS aktif; REVOKE ALL dari PUBLIC/anon/authenticated lalu GRANT SELECT authenticated; policy `spak_select_staff` FOR SELECT TO authenticated hanya `peran_saya()` admin/front_office; tanpa policy tulis); `hitung_ikm(uuid, date, date)` DIGANTI (rata-rata per baris (u1..u9 + COALESCE(u10,0) + COALESCE(u11,0)) / (9.0 + u10 terisi + u11 terisi) x 25; signature, FROM/WHERE, dan EXECUTE anon+authenticated identik); `ringkasan_ikm(date, date)` (admin/front_office/petugas), `ringkasan_spak(date, date)` dan `ringkasan_response_rate(date, date)` (hanya admin/front_office; selain itu hasil kosong; EXECUTE hanya authenticated); view `v_skm_petugas` DIGANTI (kolom lama + `u10_transparansi`, `u11_integritas` di akhir; hak dan klausa WHERE identik). Semua fungsi SECURITY DEFINER dengan `SET search_path = pg_catalog, public`.
- Menyentuh data pengunjung? : MENGUBAH data lama dengan SATU UPDATE: baris `skm_respons` ber-`layanan_id` (sumber `form_lama`, unit masih default) ditandai `unit = layanan`; nilai jawaban tidak berubah. Kolom baru berisi default (versi 1, sumber `form_lama`, unit `tidak_diketahui`) untuk baris lain. `spak_respons` tanpa identitas (hanya kunjungan_id opsional). Petugas layanan dan non-staf tidak membaca SPAK (tabel maupun ringkasan_spak/ringkasan_response_rate).
- Prasyarat    : tabel `survei_undangan` (migrasi 0001 seri ini), kolom `skm_respons.kunjungan_id` (202610140007), `hitung_ikm` (202607140004), `v_skm_petugas` dan `peran_saya()` (202610090001), `boleh_layanan(uuid)` (202610080001); dijaga blok PRASYARAT. Urutan seri: 0001 -> 0002 -> 0003 -> 0004.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610270002_survei_jawaban.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten (ADD COLUMN IF NOT EXISTS, DROP lalu ADD untuk constraint sendiri, CREATE OR REPLACE, DROP POLICY IF EXISTS); penerapan ulang hanya menandai `unit = layanan` pada baris `form_lama` ber-layanan_id yang masih berunit default (mis. ditulis `submit_skm_response` lama sesudah migrasi).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-survei-jawaban-202610270002.sql --atomic` (`--dry-run` dulu). SETELAH rollback 0004 dan 0003, SEBELUM rollback 0001. Memulihkan `hitung_ikm` dan `v_skm_petugas` PERSIS ke versi asli (202607140004, 202610090001; view lewat DROP lalu CREATE karena CREATE OR REPLACE tidak bisa membuang kolom), menghapus tiga fungsi ringkasan, tabel `spak_respons`, constraint wizard, dan tujuh kolom baru. MENGHAPUS isi kolom u10/u11 dan seluruh data `spak_respons` (tidak bisa dipulihkan); baris `skm_respons` tidak dihapus (jawaban wizard menjadi baris 9 unsur). Diawali penjaga (blok DO) `PRASYARAT ROLLBACK`: menolak seluruh rollback bila ada fungsi di schema public, selain empat yang di-DROP atau dipulihkan, yang badannya menyebut `spak_respons`, `u10_transparansi`, `u11_integritas`, atau fungsi ringkasan (Postgres tidak mencatat ketergantungan dari badan plpgsql/sql, jadi DROP saja tidak menolak; mis. fungsi kirim jawaban di 0003 akan gagal saat dipanggil). Tanpa CASCADE.
- Perilaku yang perlu diketahui : (1) menghapus kunjungan yang punya jawaban SKM wizard DITOLAK (23514) karena FK `ON DELETE SET NULL` akan melanggar constraint wizard; aplikasi tidak pernah menghapus kunjungan (retensi hanya menganonimkan), jawaban `form_lama` tetap menjadi kunjungan_id NULL; (2) `submit_skm_response` lama masih menulis baris tanpa kolom baru sehingga unit jatuh ke default `tidak_diketahui` walau layanan_id terisi: `ringkasan_ikm` mengelompokkan menurut `unit = fo` lalu layanan_id, jadi tetap masuk baris layanannya; (3) `hitung_ikm` tetap memakai `created_at::date` (zona sesi, seperti versi lama) sedangkan tiga fungsi ringkasan memakai tanggal WIB; (4) kelompok tanpa data (mis. Front Office pada periode tanpa jawaban FO) tidak dimunculkan; (5) `ringkasan_ikm` boleh dipanggil petugas dan mengembalikan agregat SEMUA layanan, Front Office, dan tidak terklasifikasi (agregat tanpa identitas, sejenis `hitung_ikm` publik); jika ingin dibatasi ke layanan petugas sendiri, tambahkan `boleh_layanan()` pada cabang petugas.
- Klien        : belum ada (halaman admin SKM/SPAK, kirim_survei, dan export memakai objek ini di task berikutnya; kode lama `src/app/admin/skm/page.tsx` dan `src/app/transparansi/page.tsx` tetap kompatibel: signature `hitung_ikm` dan kolom lama `v_skm_petugas` tidak berubah).
- Dry-run      : belum dijalankan (hanya PGlite lokal; DB nyata tidak disentuh).
- Uji perilaku : `scripts/lokal/skenario-survei-jawaban.mjs` di PGlite lokal (stub skema `scripts/lokal/pglite-stub.sql` ditambah `hitung_ikm` dan `v_skm_petugas` ASLI yang diekstrak dari migrasi 202607140004 dan 202610090001, lalu migrasi 0001 seri ini; bukan DB nyata): 127 lolos, 0 gagal. Mencakup: baris lama 9 unsur (termasuk 28/9 yang tidak habis dibagi dan baris dengan u3 kosong) memberi nilai teks identik dengan rumus lama sebelum/sesudah migrasi; baris 11 unsur, campuran 9/10/11 unsur, dan penyebut per baris dirata-ratakan per baris; hitung_ikm tetap bisa dipanggil anon; unit baris lama ditandai layanan/tidak_diketahui; constraint kolom baru (u10/u11 0 dan 5 ditolak, batas 1 dan 4 diterima, sumber/unit tak sah, wizard tanpa kunjungan_id atau versi bukan 2 ditolak, impor tanpa kunjungan_id diterima); ringkasan_ikm memisahkan layanan, Front Office, dan tidak terklasifikasi (NULL lama tidak bercampur ke FO), cocok dengan hitung_ikm per layanan, kosong untuk non-staf, ditolak untuk anon, batas hari WIB (31 Okt 18:00 UTC masuk 1 November); spak_respons (CHECK 1-6, satu per kunjungan, banyak impor tanpa kunjungan_id, anon ditolak 42501, petugas dan non-staf 0 baris, admin/FO membaca, INSERT/UPDATE/DELETE langsung ditolak); ringkasan_spak dan ringkasan_response_rate kosong untuk petugas dan non-staf, ditolak untuk anon, response rate per layanan dan satu baris FO (diundang/mengisi) dengan undangan layanan terhapus tetap terhitung, batas WIB; v_skm_petugas (urutan kolom lama + u10/u11 di akhir, tanpa identitas, batas layanan petugas, anon ditolak); interaksi FK/constraint wizard; penerapan ulang migrasi (hanya baris form_lama ber-layanan_id berunit default yang ditandai; impor berunit tidak_diketahui ber-layanan_id tidak disentuh); rollback (penjaga menolak untuk fungsi lain yang menyebut spak_respons, kolom u10, atau ringkasan_response_rate dan tidak ada yang berubah; setelah itu berhasil, hitung_ikm/v_skm_petugas/kolom/constraint/komentar/policy PERSIS sama dengan sebelum migrasi, data tidak hilang, idempoten, migrasi dapat diterapkan lagi). Zona waktu sesi skenario dikunci UTC (PGlite mengikuti zona mesin; tanpa itu konversi WIB yang hilang lolos di mesin ber-WIB). Pemeriksaan mutasi manual pada salinan migrasi/rollback: penyebut bulat 9, tanpa COALESCE u10, FO tanpa cabang unit, ringkasan_spak dan policy terbuka untuk petugas, tanpa REVOKE tabel, konversi WIB hilang (tiga fungsi), wizard tanpa versi = 2, view tanpa u10/u11, UPDATE tanpa syarat sumber, mengisi = semua undangan, response rate tanpa penjaga peran, GRANT hitung_ikm tanpa anon, rollback tanpa pemulihan view/urutan salah/penjaga tanpa u10/penyebut bulat: semuanya tertangkap skenario dan/atau test statis. Batasan: stub `boleh_kunjungan` disederhanakan; tabel stub lain lebih ketat dari produksi; skm_response_rate dan triggernya tidak dimuat (tidak disentuh migrasi ini).
- Status       : DITULIS, BELUM DITERAPKAN

### [2026-10-27] — Survei terpadu Fase A: RPC publik get_survei_context dan kirim_survei (M-202610270003_survei_rpc) — DITULIS, BELUM DITERAPKAN
- WP/Migrasi   : spesifikasi `docs/superpowers/specs/2026-10-26-survei-terpadu-design.md` §5, §6, §12 (survei terpadu Fase A, langkah 3 dari 4) / `supabase/migrations/202610270003_survei_rpc.sql` + test kontrak `supabase/migrations/survei_rpc.test.ts` + rollback `docs/rollback-survei-rpc-202610270003.sql`
- Jenis        : 2 fungsi baru SECURITY DEFINER yang BOLEH DIPANGGIL ANON; ADITIF (tanpa tabel/kolom/policy/trigger baru, tanpa DROP/DELETE/TRUNCATE, tanpa DML pada data yang ada)
- Objek        : `public.get_survei_context(p_token text) RETURNS jsonb` (hanya membaca; `{status, unit, layanan_nama, kedaluwarsa_pada}`; status `tidak_valid` bila tidak ada undangan dengan token itu (termasuk NULL/kosong/pendek, semua kolom lain null), `sudah_diisi` bila `diisi_pada` terisi, `kedaluwarsa` bila `now() >= kedaluwarsa_pada`, selain itu `ok`; tanpa id kunjungan/undangan/layanan, token, atau nama/HP/email) dan `public.kirim_survei(p_token text, p_spak jsonb, p_skm jsonb) RETURNS text` (`submitted`/`invalid`/`expired`/`duplicate`/`not_found`, tanpa RAISE untuk kegagalan yang wajar). Urutan kirim_survei: (1) validasi payload -> `invalid` (token tidak NULL dan >= 16 karakter; kedua payload objek JSON; kunci PERSIS `p1..p5` dan `u1..u11`; tiap nilai `jsonb_typeof = number`, bilangan bulat, SPAK 1-6, SKM 1-4); (2) `SELECT ... FROM survei_undangan WHERE token = p_token FOR UPDATE` -> `not_found`; (3) `diisi_pada` terisi -> `duplicate`; (4) `now() >= kedaluwarsa_pada` -> `expired`; (5) `kunjungan.status <> 'selesai'` -> `invalid`; (6) `INSERT spak_respons`, `INSERT skm_respons` (`sumber = 'wizard'`, SKM `versi = 2`, `unit`/`layanan_id`/`kunjungan_id` dari undangan) dan `UPDATE survei_undangan SET diisi_pada = now()` dalam SATU blok `BEGIN ... EXCEPTION WHEN unique_violation THEN RETURN 'duplicate'`, lalu `submitted`. Kedua fungsi `LANGUAGE plpgsql`, `VOLATILE` (disengaja: PostgREST hanya mengekspos fungsi STABLE/IMMUTABLE lewat GET, dan token tidak boleh masuk URL/log), `SECURITY DEFINER`, `SET search_path = pg_catalog, public`, fungsi bawaan dikualifikasi `pg_catalog`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated` lalu `GRANT EXECUTE ... TO anon, authenticated` (service_role mempertahankan hak bawaan Supabase).
- Menyentuh data pengunjung? : MENULIS jawaban (`spak_respons`, `skm_respons`) dan `survei_undangan.diisi_pada` HANYA lewat kirim_survei, saat pengunjung mengirim survei; tidak mengubah baris yang sudah ada selain `diisi_pada` undangan yang dikirim. Tidak ada tulis langsung klien ke tabel (tidak berubah: tabel tetap tertutup untuk anon/authenticated). `get_survei_context` tidak membaca `kunjungan` atau data pribadi.
- Prasyarat    : `survei_undangan` (migrasi 0001 seri ini); `spak_respons`, kolom `skm_respons` 11 unsur/`versi`/`sumber`/`unit`, dan constraint `skm_respons_wizard_kunjungan_versi_check` (migrasi 0002 seri ini); `layanan` dan `kunjungan`; dijaga blok PRASYARAT (tabel, kolom satu per satu, constraint). Urutan seri: 0001 -> 0002 -> 0003 -> 0004.
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610270003_survei_rpc.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten (CREATE OR REPLACE, REVOKE/GRANT ulang); menerapkan ulang tidak mengubah data.
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-survei-rpc-202610270003.sql --atomic` (`--dry-run` dulu). SETELAH rollback 0004 (bila ada fungsi di sana yang memakai kedua RPC), SEBELUM rollback 0002 dan 0001 (keduanya menolak selama kedua fungsi ini masih ada: badan fungsinya menyebut `spak_respons`/`u10`/`u11` dan `survei_undangan`). Hanya DROP kedua fungsi; jawaban yang sudah tersimpan dan undangan TIDAK dihapus; sesudahnya halaman survei tidak bisa memuat konteks atau mengirim jawaban. Diawali penjaga (blok DO) `PRASYARAT ROLLBACK`: menolak seluruh rollback bila ada fungsi di schema public, selain kedua yang di-DROP, yang badannya menyebut `kirim_survei` atau `get_survei_context` (Postgres tidak mencatat ketergantungan dari badan plpgsql/sql, jadi DROP saja tidak menolak). Tanpa CASCADE.
- Perilaku yang perlu diketahui : (1) Batas kedaluwarsa `now() >= kedaluwarsa_pada`: TEPAT di batas sudah kedaluwarsa (keputusan R8), sama dengan `ambil_qr_survei` dan `v_survei_status` (0001); jam hanya dari database (waktu mulai transaksi). (2) Bentuk angka: bilangan bulat apa pun tulisannya (`3.0`, `1e0`, `6.00`, `0.5e1`) DITERIMA dan disimpan sebagai bilangan bulat (konversi lewat numeric setelah tipe, bilangan bulat, dan rentang terbukti); `3.5`, `2.9999999999999999999`, `"3"`, `true`, `null`, `[3]`, `{"a":3}`, kunci hilang, `0`, `7` (SPAK) dan `5` (SKM), dan `1e1000` -> `invalid`. Angka yang tidak bisa diurai parser jsonb (eksponen di luar batas numeric) ditolak PostgreSQL sebelum fungsi berjalan. (3) Penyerialan kiriman bersamaan lewat `FOR UPDATE` (READ COMMITTED): kiriman kedua menunggu lalu melihat `diisi_pada` terbaru -> `duplicate`; pertahanan berlapis: indeks unik `kunjungan_id` pada kedua tabel -> `duplicate` lewat `unique_violation` (SPAK ikut di-rollback bila SKM yang menabrak). Dua koneksi yang saling menunggu tidak bisa diuji di PGlite (satu sesi): urutan `FOR UPDATE` dijaga test statis. (4) Kasus tepi: bila kunjungan itu SUDAH punya jawaban dari jalur lain (form SKM lama atau impor) sementara undangan belum diisi, `kirim_survei` mengembalikan `duplicate` tanpa menandai `diisi_pada`, dan `get_survei_context` tetap `ok`; antarmuka cukup memperlakukan `duplicate` sebagai "sudah terisi". (5) Kunjungan yang dibuka lagi setelah undangan terbit: `kirim_survei` -> `invalid`, `get_survei_context` tetap `ok` (konteks tidak mengecek status kunjungan, sesuai kontrak). (6) Tidak ada pembatasan laju untuk anon di Fase A: mengandalkan token 244 bit dan satu kiriman per undangan (spec §5); pembatasan laju berbasis IP menyusul di Fase B. (7) Kegagalan tak terduga (bukan `unique_violation`) tidak ditangkap: seluruh pernyataan dibatalkan dan galat sampai ke pemanggil, tanpa baris setengah jadi.
- Klien        : belum ada (route `/api/survei/kirim` memakai `kirim_survei` di Task 8, wizard `/survei/<token>` memakai `get_survei_context` di Task 9).
- Dry-run      : belum dijalankan (hanya PGlite lokal; DB nyata tidak disentuh).
- Uji perilaku : `scripts/lokal/skenario-survei-rpc.mjs` di PGlite lokal (stub skema `scripts/lokal/pglite-stub.sql` ditambah `hitung_ikm`, `v_skm_petugas`, dan `skm_response_rate` beserta trigger `trg_skm_insert_rr` ASLI yang diekstrak dari migrasi lama, lalu migrasi 0001 dan 0002 seri ini; bukan DB nyata): 196 lolos, 0 gagal. Mencakup: kiriman sah -> `submitted`, tepat satu baris di `spak_respons` dan `skm_respons`, pemetaan kolom (nilai berbeda tiap butir/unsur, JSON urutan terbalik), `diisi_pada` = `created_at` kedua baris (satu transaksi), konteks menjadi `sudah_diisi`, response rate lama ikut +1; konteks: kunci persis empat, tanpa id/token/nama/HP/email, `tidak_valid` untuk token acak/pendek/kosong/NULL/teks tautan, unit `fo` tanpa nama layanan; batas kedaluwarsa dalam satu transaksi dengan `now()` yang sama (TEPAT di batas dan 1 detik sesudahnya `expired`/`kedaluwarsa`, 1 mikrodetik sebelumnya `submitted`/`ok`, `sudah_diisi`/`duplicate` mengalahkan kedaluwarsa); urutan hasil (payload nakal mengalahkan token tak dikenal dan kedaluwarsa, `not_found`, `duplicate`, `expired` mendahului status kunjungan, kunjungan dibuka lagi -> `invalid` lalu pulih); matriks payload nakal (41 kasus bernama + 155 kombinasi nilai x kunci: kunci asing/kurang, SKM 9 unsur lama, 0, 7, 3.5, "3", null, boolean, array, objek, 1e1000, 2.9999999999999999999, SPAK skala 7, SKM skala 5/6, bukan objek, SQL NULL, payload tertukar, token NULL/pendek) -> `invalid` dengan NOL baris dan jejak sekuens menunjukkan tidak ada INSERT yang dicoba; bentuk angka 3.0/1e0/6.00/0.5e1 diterima dan batas 1 dan 6/4; kiriman ganda (anon lalu authenticated, dua panggilan dalam satu pernyataan, 8 beruntun, simulasi TOCTOU dengan `diisi_pada` dikosongkan -> `duplicate` lewat indeks unik); atomik: kegagalan paksa pada INSERT kedua dan pada UPDATE `diisi_pada` (jejak sekuens membuktikan INSERT pertama berjalan, lalu NOL baris di kedua tabel, response rate tidak berubah, kiriman ulang berhasil) dan pelanggaran unik oleh jawaban SKM lama atau SPAK impor -> `duplicate` tanpa baris tertinggal; unit Front Office (`layanan_id` NULL, `unit = fo`); hak: kedua fungsi `SECURITY DEFINER`, `search_path` tetap, `VOLATILE`, EXECUTE hanya anon/authenticated/pemilik/service_role (role tanpa hak dan PUBLIC ditolak), anon dan authenticated non-staf tidak membaca atau menulis `survei_undangan`, `spak_respons`, `skm_respons` (sidik keadaan tidak berubah), petugas tidak membaca SPAK; integrasi dengan `ringkasan_ikm`/`ringkasan_spak`/`ringkasan_response_rate`/`hitung_ikm`; rollback (rollback 0002 dan 0001 menolak selama kedua fungsi ada, penjaga rollback 0003 menolak untuk fungsi lain yang memanggil `kirim_survei` atau `get_survei_context`, data tidak hilang, idempoten, migrasi dapat diterapkan lagi, seluruh seri dapat dibalik berurutan 0003 -> 0002 -> 0001). Pemeriksaan mutasi manual pada salinan migrasi (36 mutasi: `>=` menjadi `>` di kirim dan di konteks, batas dihapus, rentang SPAK/SKM/min, tanpa cek bilangan bulat, tanpa cek jumlah kunci, tanpa cek tipe number, tanpa cek objek, panjang token 8 dan 17, kolom p1/p2 dan u10/u11 tertukar, handler `unique_violation` dilepas atau diganti `WHEN OTHERS`, urutan INSERT dibalik, duplicate dan expired ditukar, tanpa cek status kunjungan, REVOKE tanpa PUBLIC, GRANT tanpa anon, bukan SECURITY DEFINER, konteks STABLE, tanpa UPDATE `diisi_pada`, konteks membocorkan kunjungan_id, kedaluwarsa mengalahkan sudah_diisi, unit selalu layanan, versi 1, layanan_id dibuang, `clock_timestamp()`, validasi sesudah kunci undangan, hasil sukses salah): semuanya tertangkap skenario; penghapusan `FOR UPDATE` tidak bisa tertangkap PGlite (satu sesi) sehingga dijaga test statis. Batasan: stub `boleh_kunjungan` disederhanakan; tabel stub lain lebih ketat dari produksi; PGlite tidak punya dua koneksi yang saling menunggu kunci baris.
- Status       : DITULIS, BELUM DITERAPKAN

### [2026-10-27] — Survei terpadu Fase A: email/push survei memakai tautan undangan (M-202610270004_survei_notifikasi) — DITULIS, BELUM DITERAPKAN
- WP/Migrasi   : spesifikasi `docs/superpowers/specs/2026-10-26-survei-terpadu-design.md` §8, §13 (survei terpadu Fase A, langkah 4 dari 4) / `supabase/migrations/202610270004_survei_notifikasi.sql` + test kontrak `supabase/migrations/survei_notifikasi.test.ts` + rollback `docs/rollback-survei-notifikasi-202610270004.sql`
- Jenis        : SATU fungsi diganti (`CREATE OR REPLACE` penuh dari versi 202610140007); tanpa tabel/kolom/policy/trigger/view baru; tanpa DML
- Objek        : `public.notify_kunjungan_status()` (fungsi trigger, SECURITY DEFINER, `search_path = pg_catalog, public`; signature, atribut, dan `REVOKE ALL ... FROM PUBLIC, anon, authenticated` identik dengan 0007, tanpa GRANT). HANYA cabang `status = selesai` berubah: cek lama "tanpa qr_token tidak ada notifikasi" diganti `v_undangan := ensure_undangan(NEW.id)` + baca `survei_undangan.token` + cek token (tanpa token: `RETURN NULL`, tanpa notifikasi); tautan di isi email dan isi push (`v_skm`) menjadi `<public_url>/survei/<token>`; `payload.url` push menjadi `/survei/<token>` (relatif). Dua variabel baru di akhir DECLARE (`v_undangan uuid`, `v_token text`). Cabang reservasi dikonfirmasi, judul/isi/jenis notifikasi (`skm_survey`, `skm_survey_push`), email walk-in FO tanpa akun, dan trigger `trg_notify_kunjungan_status` (TIDAK dibuat ulang) tidak berubah.
- Menyentuh data pengunjung? : Tidak mengubah data. Mengantrekan email/push survei seperti sebelumnya (kunci idempotensi `queue_notifikasi` per kunjungan + jenis tetap), kini dengan token undangan (acak, tanpa PII) di tautan. Memanggil `ensure_undangan` bisa membuat satu baris `survei_undangan` bila belum ada (idempoten; trigger 0001 juga membuatnya).
- Prasyarat    : `notify_kunjungan_status()` (202610140007) dan `ensure_undangan(uuid)` (202610270001, migrasi 0001 seri ini); dijaga blok PRASYARAT (`to_regprocedure`). Urutan seri: 0001 -> 0002 -> 0003 -> 0004 (0004 hanya butuh 0001, tetapi diterapkan terakhir karena tautan baru baru berguna setelah halaman survei ada).
- Cara menerapkan : `node scripts/apply-migration.mjs supabase/migrations/202610270004_survei_notifikasi.sql --atomic --dry-run`, lalu tanpa `--dry-run` setelah konfirmasi CEO. Idempoten (CREATE OR REPLACE, REVOKE ulang).
- Cara mengembalikan : `node scripts/apply-migration.mjs docs/rollback-survei-notifikasi-202610270004.sql --atomic` (`--dry-run` dulu). PERTAMA dalam urutan rollback seri (SEBELUM rollback 0003, 0002, 0001; rollback 0001 menolak selama fungsi ini memanggil `ensure_undangan`). Memulihkan fungsi 0007 PERSIS (salinan karakter demi karakter, dijaga test) lalu mengulang REVOKE yang sama; fungsi tidak di-DROP (trigger menunjuknya). Diawali penjaga (blok DO) `PRASYARAT ROLLBACK`: menolak bila fungsinya tidak ada atau isinya BUKAN versi 0004 (memanggil `ensure_undangan`, memakai `/survei/`, tanpa tautan lama) dan BUKAN versi 0007 yang sudah pulih (memuat tautan lama, tanpa `ensure_undangan`), supaya migrasi lanjutan yang mengganti fungsi tidak tertimpa diam-diam. Keterbatasan: migrasi lanjutan yang menyalin versi 0004 lalu mengubah bagian lain lolos penjaga. Setelah rollback, email/push survei kembali memuat tautan lama berbasis `qr_token`.
- Perilaku yang perlu diketahui : (1) Selesai ulang (dibuka lalu diselesaikan lagi): `ensure_undangan` memakai undangan yang ada apa adanya (token dan batas 32 jam tidak bergeser), jadi tautan di email bisa sudah kedaluwarsa atau sudah diisi; halaman survei menampilkannya demikian. (2) Judul/teks notifikasi tidak diubah (masih "Survei Kepuasan Masyarakat ..." dan "Isi Survei SKM"): hanya tautan yang diganti; penamaan "Pesan Perilaku" pada teks email/push adalah keputusan terpisah. (3) Cek lama "tanpa qr_token" dibuang karena tautan baru tidak memakai qr_token; semua alur pembuat kunjungan yang ada mengisi qr_token, jadi tidak ada perubahan nyata. (4) Tautan lama `/skm?token=` tetap berfungsi untuk email yang sudah terkirim (halaman lama tidak disentuh). (5) Kegagalan `ensure_undangan` (mis. tabel tidak ada) menggagalkan UPDATE status ke selesai, seperti kegagalan notifikasi lain di trigger AFTER; penjaga PRASYARAT mencegahnya saat migrasi diterapkan, dan rollback 0001 menolak selama fungsi ini masih memanggilnya.
- Klien        : tidak ada perubahan kode klien (halaman `/survei/<token>` dibuat di task berikutnya; tautan memakai route itu).
- Dry-run      : belum dijalankan (DB nyata tidak disentuh). Pemilik menjalankan dry-run sebelum penerapan; itulah verifikasi terhadap skema nyata (fungsi `queue_notifikasi`, `site_settings`, kolom `pengunjung`).
- Uji perilaku : Tidak ada skenario PGlite terkomit untuk migrasi ini: fungsi ini tidak bisa dijalankan di stub PGlite repositori (`scripts/lokal/pglite-stub.sql` tidak memuat `queue_notifikasi`, `site_settings`, kolom `pengunjung` yang dibaca, maupun trigger-nya). Verifikasi STATIS: `supabase/migrations/survei_notifikasi.test.ts` (27 tes): urutan tiga pernyataan (DO penjaga, fungsi, REVOKE), penjaga PRASYARAT, signature/atribut/REVOKE identik dengan 0007, DECLARE hanya bertambah dua variabel, bagian sebelum dan sesudah cabang selesai identik dengan 0007 setelah spasi dinormalkan, cabang selesai = cabang 0007 dengan TEPAT tiga perubahan, tanpa `/skm` dan `qr_token` di fungsi baru, trigger tidak disentuh, rollback = salinan 0007 persis dan penjaganya membedakan kedua versi pada teks nyata. Sebagai pemeriksaan tambahan SEKALI PAKAI (skrip di luar repositori, TIDAK dikomit, stub tambahan `queue_notifikasi`/`site_settings`/kolom `pengunjung` di atas stub dan migrasi 0001): 30 lolos, 0 gagal. Mencakup: penjaga maju (tanpa fungsi 0007; tanpa ensure_undangan); fungsi 0007 mengirim tautan lama; setelah 0004 email dan push memuat `<host>/survei/<token>` (host bawaan dan `public_url` dari site_settings), `payload.url` relatif hanya pada push, token = token undangan 64 heksadesimal, judul/jenis tidak berubah, tidak ada `qr_token` di notifikasi; walk-in FO tanpa akun hanya email FO; tanpa kontak tidak ada notifikasi tetapi undangan terbit; status batal tanpa notifikasi dan tanpa undangan; selesai ulang tidak menggeser token/batas; cabang reservasi tidak berubah; penerapan ulang idempoten; trigger tetap satu; anon/authenticated tanpa EXECUTE; rollback 0001 ditolak selama fungsi baru terpasang; rollback 0004 memulihkan isi identik dengan 0007 (md5 sama), idempoten, tautan lama kembali, ditolak untuk isi asing dan untuk fungsi yang tidak ada; urutan rollback 0004 lalu 0001 berhasil. Pemeriksaan itu BUKAN pengganti dry-run pemilik di DB nyata (stub tidak memuat `queue_notifikasi` produksi, idempotensi per kunjungan+jenis, atau Resend/web-push).
- Status       : DITULIS, BELUM DITERAPKAN
