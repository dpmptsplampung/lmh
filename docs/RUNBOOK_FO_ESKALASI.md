# Runbook rollout alur Front Office → Eskalasi (Tahap A-D, WP-24, chat online, pendataan wajib)

> Status: DRAF LENGKAP, **belum pernah dijalankan** (tidak ada staging; semua migrasi di bawah, kecuali `202610140001`, BELUM diterapkan ke produksi). Bagian yang belum terbukti ditandai **[BELUM TERBUKTI]** dan dirangkum di §10.
> Rujukan: `docs/ATURAN_MIGRASI.md`, `docs/MIGRATIONS.md` (urutan terapan + larangan), `docs/analysis/DB-CHANGES.md`, `docs/analysis/ANTREAN-ARAH-TULIS.md` §6.2, `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md` (§7, §10), `docs/analysis/FO-CHAT-KONTRAK-RPC.md` (§5, §6.1), `docs/DECISION_LOG.md` (Gerbang G.1-G.6), rencana `docs/superpowers/plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md`.
> Semua langkah yang menyentuh DB produksi (apply migrasi, uji perilaku, ledger, flag) butuh **konfirmasi tertulis CEO** per tindakan. Tidak ada langkah di sini yang boleh dijalankan otomatis.

## 1. Ruang lingkup dan urutan migrasi

`0001` (sesi staf) sudah di produksi. Satu jendela cutover menerapkan, berurutan, masing-masing `--atomic --dry-run` dulu lalu sungguhan:

```
0002 tiket_kepemilikan -> 0003 fo_model_data -> 0004 fo_rpc -> 0005 fo_selaras_antrean -> 0006 pernyataan_kebenaran
 -> 0007 wp24_akhiri_dual_write -> 0008 wp24_tutup_otomatis_retensi -> 0009 chat_online -> 0011 pendataan_wajib
 -> 0012 perbaikan_review
```

(`202610140010` tidak dipakai. `0012` = perbaikan temuan review atas 0002..0011, wajib SETELAH 0011 dan 0009; rincian `docs/analysis/_fragmen-R12.md` sampai digabung ke `docs/MIGRATIONS.md`/`DB-CHANGES.md`. Klien rilis ini membaca `layanan.form_pendataan` (0012), jadi klien tetap dideploy SETELAH seluruh rantai termasuk 0012.) Nama berkas lengkap `202610140NNN_<nama>.sql` ada di `docs/MIGRATIONS.md`.

**Larangan:** JANGAN menerapkan ulang 202610140004 atau 202610140005 (juga 0003/0002) setelah 0007 diterapkan: berkas itu menimpa fungsi versi 0007/0011/0012 (layanan_mulai, layanan_selesai, admin_alihkan, fo_mulai_kunjungan, reservasi_buat, get_queue_position, rollup_rekap_harian, job no-show/akhir hari) dengan versi lama yang menulis `visit` dan membuang perbaikan 0012 tanpa galat. Berkas itu tidak punya penjaga sendiri (menambahkannya mengubah hash manifest); larangan ini ditegakkan prosedur. Bila terlanjur, terapkan ulang 0007 -> 0008 -> 0009 -> 0011 -> 0012 berurutan (semuanya idempoten). 0011 hanya setelah 0007. Dry-run tunggal 0004..0011 sebelum prasyaratnya terpasang berhenti di penjaga `PRASYARAT` (benar, bukan galat); pratinjau gabungan memakai skrip uji (§5).

## 2. Prasyarat sebelum hari H (T-minus)

1. Seluruh kode (klien Tahap A-D, hapus `/api/checkin`, pembaca `visit` WP-24) ter-commit di branch dan **`npm run verify:baseline` hijau** pada commit yang akan di-deploy (gerbang lokal; CI GitHub tidak dipakai). Angka uji di dokumen lain per-paket, bukan bukti gerbang penuh. **[BELUM TERBUKTI untuk working tree saat ini]**
2. Build produksi dari commit tersebut siap (Vercel); env produksi lengkap (`docs/ENVIRONMENT_VARIABLES.md`); fase ini tidak menambah env baru.
3. Cadangan: pastikan prosedur `docs/BACKUP_RESTORE.md` terpenuhi (cadangan terbaru ada) sebelum jendela. **[BELUM TERBUKTI: tidak dicek]**
4. Uji perilaku hijau (§5) di jendela uji terpisah (di luar jam layanan); simpan keluarannya sebagai bukti.
5. Komunikasi ke staf sudah dikirim (§9). `docs/CADANGAN_MANUAL_FO.md` siap dipakai bila sistem terganggu.
6. Konfirmasi CEO tertulis: jendela (Jumat setelah 16:00 WIB atau akhir pekan; G.6), daftar migrasi yang diterapkan, dan izin pengisian ledger (§7) bila diinginkan.
7. Pertanyaan terbuka CEO yang berdampak pada perilaku sudah dijawab atau diterima apa adanya: Admin bertindak sebagai FO, eskalasi setelah 16:00 ditolak, chat dicatat saat eskalasi, "kembali ke bot" dihapus, dasar/consent walk-in oleh FO (`FO-ESKALASI-KONTRAK-RPC.md` §9, `FO-CHAT-KONTRAK-RPC.md` §7, `DB-CHANGES.md` entri 0007).

## 3. Urutan cutover malam hari H

Dasar: kontrak FO §7.1 (cutover bersama) dan FO-CHAT §6.1 (setelah 0009 dan sebelum route chat diganti, "Ambil alih"/"Selesaikan" gagal `CHAT_HARUS_RPC`; sesudah 0007 klien lama gagal menulis `visit`). DB dan klien tidak dapat diubah atomik bersamaan, jadi jendela layanan-tutup dimanfaatkan: **migrasi dulu, klien segera sesudahnya**, tanpa jeda panjang. **[BELUM TERBUKTI: tidak ada staging; urutan ini belum pernah dilatih. Klien baru tidak kompatibel dengan DB lama dan sebaliknya.]**

1. **Gerbang masuk (read-only):** `SELECT now(), now() AT TIME ZONE 'Asia/Jakarta';` (setelah 16:00 WIB Jumat, atau akhir pekan). Antrean kosong: tidak ada tiket `menunggu`/`dipanggil` hari ini (0007 menolak sendiri dengan `CUTOVER_DITOLAK`). Catat jumlah tiket `dilayani`, reservasi terjadwal, dan sesi chat (`SELECT status, count(*) FROM chat_sesi WHERE status IN ('aktif','eskalasi') GROUP BY 1;`); kueri antrean/reservasi di §A.2 butir 3. Tiket `dilayani` yang tersisa diselesaikan/diambil alih dulu, atau terima bahwa job 23:00 WIB menutupnya.
2. **Siapkan build baru** sebagai kandidat (Vercel, dari commit terverifikasi; belum dipromosikan bila memungkinkan). **[BELUM TERBUKTI: mekanisme promosi tertunda belum dicek]**
3. **Terapkan migrasi** berurutan sesuai §1, tiap pasang `--dry-run` lalu sungguhan: `node scripts/apply-migration.mjs supabase/migrations/<berkas>.sql --atomic`. Berhenti pada galat pertama (transaksi di-ROLLBACK), periksa, lalu putuskan lanjut atau batal bersama CEO. Catat tiap penerapan di `docs/analysis/DB-CHANGES.md` (ubah status entri menjadi DITERAPKAN + waktu + hasil verifikasi) dan `docs/MIGRATIONS.md`.
4. **Muat ulang skema PostgREST** bila RPC "not found": `NOTIFY pgrst, 'reload schema';`.
5. **Deploy/promosikan klien** segera (satu rilis memuat Tahap A-D + C2 + C3): Kelola Layanan (prefiks 2 huruf), halaman FO, scan QR (`fo_checkin_reservasi`), `me/reservasi` (`reservasi_buat`), antrean petugas (`layanan_selesai` + topik/catatan, `layanan_kembalikan`), Admin (`admin_alihkan`), chat admin/publik (`chat_ambil`/`chat_teruskan`/`chat_selesai`), pendataan wajib, profil (nama terkunci + pernyataan), penghapusan `/api/checkin`. 0006 harus sudah terapan sebelum klien C2.
6. **Verifikasi pasca** (§4). Bila gagal sesuai pemicu §6, rollback.
7. **Catat hasil** (jam, hasil tiap langkah, keluaran verifikasi) di `docs/analysis/DB-CHANGES.md` dan perbarui `docs/STATUS.md`.

Setelah cutover: halaman lama yang masih terbuka harus dimuat ulang (galat `TRANSISI_LEWAT_RPC`, `CHAT_HARUS_RPC`, 42501 pada `visit`); service worker lama dapat menyajikan aset lama sampai diperbarui **[BELUM TERBUKTI: perilaku pembaruan SW pada rilis ini tidak diuji]**.

## 4. Verifikasi pasca (read-only)

1. SQL di §A.5 (trigger `visit`, fungsi penulis `visit`, job cron, `mv_estimasi_layanan`, `v_antrian_loket`, reservasi lama).
2. Objek ada: `SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('fo_mulai_kunjungan','fo_checkin_reservasi','fo_tolak_reservasi','fo_selesai','fo_eskalasi','fo_ambil_dari_kotak_masuk','layanan_mulai','layanan_selesai','layanan_kembalikan','admin_ambil_alih','admin_alihkan','reservasi_buat','reservasi_batalkan','chat_ambil','chat_teruskan','chat_selesai','ubah_nama_pengunjung','tutup_penanganan_tertinggal','pendataan_validasi_payload','tutup_chat_tertinggal','form_pendataan_dari_nama');` (21 nama; `layanan_selesai` hanya satu signature, 5 argumen); `fo_sinkron_visit` tidak ada.
3. Hak: `anon` tanpa EXECUTE pada RPC staf; `authenticated` tanpa EXECUTE pada fungsi internal (lihat entri `DB-CHANGES.md` masing-masing).
4. Prefiks antrean: semua `layanan.prefiks_antrean` terisi 2 huruf unik.
5. Chat: backfill 0009 hanya membuat kunjungan `online` + tahap `penanganan` untuk sesi `eskalasi`/`aktif` yang punya pesan pengunjung dan aktif <= 24 jam; sesi yang lebih tua ditutup otomatis oleh `tutup_chat_tertinggal()` saat 0012 diterapkan (NOTICE jumlahnya). Bandingkan dengan hitungan langkah 3.1: `SELECT status, count(*) FROM chat_sesi WHERE status IN ('aktif','eskalasi') GROUP BY 1;` (hanya sesi muda yang tersisa).
5a. Pendataan wajib per layanan: `SELECT nama, form_pendataan FROM layanan ORDER BY nama;` harus sama dengan jenis form yang selama ini dipakai (Helpdesk OSS = oss, Non OSS/Perizinan = perizinan, lainnya NULL). Walk-in lama: `SELECT count(*) FROM kunjungan WHERE asal='walk_in' AND status='terjadwal';` = 0 (ditutup 0012, audit `tutup_walkin_terjadwal`).
6. Uji asap aplikasi dengan akun uji dan pengunjung sintetis (paragraf akhir §A.5), ditambah: FO daftar walk-in -> selesai di FO -> tautan SKM terisi; FO eskalasi -> petugas mulai -> selesai dengan topik/catatan + Pendataan lengkap -> SKM terantre; petugas kembalikan -> muncul di kotak masuk FO; Admin alihkan; chat eskalasi -> FO ambil -> teruskan -> petugas selesai; scan QR reservasi; rekap FO (`/admin/rekap-fo`) dan performa (`/admin/performa`) terisi; layar TV dan estimasi tampil; `/checkin` hanya informasi.
7. Cron: `SELECT jobid, jobname, schedule, active FROM cron.job;` job `penanganan_tutup_otomatis` dan `chat_tutup_otomatis` (23:30 WIB) aktif; pantau `cron.job_run_details` malam itu (23:00 WIB) dan esok paginya.
8. Log error: `error_log`/log Vercel 30 menit pertama pagi layanan Senin; siapkan petugas/CEO untuk melapor.

## 5. Uji perilaku skrip (di luar jam layanan; selalu ROLLBACK)

Semua menyentuh DB produksi lewat `DIRECT_URL` dan mengunci tabel antrean ±1-2 menit; butuh konfirmasi CEO; skrip chat menolak Senin-Jumat 07:00-16:59 WIB (kecuali `--paksa`).

| Skrip | Cakupan | Status |
|---|---|---|
| `scripts/test-tiket-kepemilikan.mjs --apply ...0001 --apply ...0002` | 0002 (A3) | **BELUM DIJALANKAN** (seksi 8 tidak berlaku bila DB sudah memuat 0005) |
| `scripts/test-fo-eskalasi.mjs --pre 0002 --apply 0003 --apply 0004 --apply 0005 [--akhir-hari]` | 0003-0005 | **BELUM DIJALANKAN** (seksi 5/8 yang menegaskan `visit` tidak berlaku untuk DB yang memuat 0007) |
| `scripts/test-wp24.mjs --pre 0002..0006 --apply 0007 --apply 0008 --akhir-hari` | 0007, 0008 | **BELUM DIJALANKAN** (jam DB 2026-10-14 06:04 WIB terlarang) |
| `scripts/test-chat-online.mjs --pre 0002..0005 --apply 0009` dan `--pre 0002..0008 --apply 0009` | 0009 | DIJALANKAN 2026-10-14 06:14/06:15 WIB pada versi 0009 SEBELUM perbaikan review (batas spam + backfill 24 jam); 0009 diubah sesudahnya, skrip disesuaikan: **WAJIB diulang** |
| `scripts/test-perbaikan-review.mjs --pre 0002..0009 --pre 0011 --apply 0012` | 0012 (+ trigger/backfill 0009 yang diubah) | **BELUM DIJALANKAN** (ditulis 2026-10-14 pada jam layanan) |
| uji perilaku 0006 dan 0011 | 0006, 0011 | tidak ada skrip perilaku khusus; hanya test kontrak statis (`supabase/migrations/*.test.ts`) **[BELUM TERBUKTI secara perilaku]** |

Skrip lama yang menulis `visit`/meng-UPDATE langsung akan gagal pada DB yang memuat 0002/0007 sampai disesuaikan: `scripts/selftest-wp21.mjs`, `scripts/test-rbac-tahap0.mjs`, `scripts/test-rbac-tahap1.mjs` (lihat `DB-CHANGES.md` entri 0002/0005/0007). Konkurensi sejati (dua koneksi) tidak diuji oleh skrip mana pun. Perintah dan flag lengkap: komentar kepala tiap skrip dan §A.2.

## 6. Rollback

- Urutan terbalik: 0012 -> 0011 -> 0009 -> 0008 -> 0007 -> 0006 -> 0005 -> 0004 -> 0003 -> 0002 (0009 sebelum 0005; 0008 sebelum 0007), masing-masing `node scripts/apply-migration.mjs docs/rollback-<nama>-<versi>.sql --atomic --dry-run` lalu sungguhan, **bersama pengembalian klien** ke rilis sebelumnya (Vercel: kembali ke deployment sebelumnya).
- Jendela utama: dari terap sampai sebelum layanan dibuka hari kerja berikutnya (Senin 08:00 WIB). Rincian WP-24 dan data yang tidak kembali: §A.6. Data kunjungan online/penanganan yang sudah dibuat dibiarkan; rollback 0003 menolak bila ada data `penanganan` atau kunjungan `online` kecuali flag sadar `lmh.rollback_paksa`; rollback 0008 menolak bila ada tahap `tidak_ditutup` kecuali flag yang sama.
- Setelah layanan berjalan dengan alur baru, lebih aman **perbaikan maju** (migrasi forward baru) daripada rollback (ATURAN_MIGRASI, T11).
- Pemicu: tulis klien gagal massal, SKM/notifikasi tidak terantre, job akhir hari/no-show gagal, FO/petugas tidak dapat bekerja dan tidak ada perbaikan cepat. Selama pemulihan pakai `docs/CADANGAN_MANUAL_FO.md`.
- Rollback sebagian (hanya 0012, atau 0012 lalu 0011/0009) dimungkinkan karena ketiganya di ujung rantai; klien terkait ikut dikembalikan. Penjaga urutan (DO di awal berkas rollback): rollback 0011, 0009, dan 0007 menolak bila 0012 masih terpasang (`docs/rollback-perbaikan-review-202610140012.sql` dulu); rollback 0007 juga menolak bila 0011 masih ada; rollback 0012 menolak bila 0011/0009 sudah tidak ada (keadaan tak terduga).

## 7. Ledger migrasi (izin CEO)

`scripts/apply-migration.mjs` tidak menulis `supabase_migrations.schema_migrations`; ledger produksi 54 entri (terakhir `202610130002`). Setelah migrasi cutover diterapkan:

1. `node scripts/verify-migration-ledger.mjs` (read-only), lalu `node scripts/fill-migration-ledger.mjs` (dry-run default; menampilkan baris yang akan di-INSERT). Skrip hanya mencatat migrasi berstatus `terpasang`.
2. Hanya dengan izin CEO: `node scripts/fill-migration-ledger.mjs --apply --yes`. Catat di `DB-CHANGES.md`.
3. **[BELUM TERBUKTI]** parser penanda (`scripts/lib/migration-markers.mjs`) belum diuji terhadap migrasi 0002-0011; bila dinilai `tidak_dapat_ditentukan`, catat manual atas keputusan CEO.
4. Lima migrasi lama yang tidak tercatat (`202608040001`, `202608080001`, `202608310001`, `202608310003`, `202609020001`) tetap harus diputuskan sebelum `supabase db push` dipakai; **jangan `db push` ke produksi**.

## 8. Sesi tunggal staf (`sesi_tunggal_aktif`)

Migrasi 0001 sudah terapan; flag `sesi_tunggal_aktif` = false (masa transisi: staf tanpa baris sesi tetap diterima; yang sudah punya baris ditegakkan). **Jangan ubah ke `true`** sebelum:

1. Klien sesi tunggal (A2) ter-deploy dan **semua** staf aktif sudah login ulang (tiap staf punya baris di `sesi_staf`). Bila flag `true` lebih awal, SEMUA staf ditolak RPC mutasi (`SESI_TIDAK_SAH`).
2. **Pembuktian `session_id` JWT stabil**: klaim `session_id` di token proyek ini baru dari dokumentasi Supabase, belum terbukti. Uji dengan akun uji: login, dekode payload JWT (jangan mencetak token utuh ke log), catat `session_id`; paksa penyegaran token dan bandingkan. Harus identik sepanjang sesi dan berbeda untuk login baru. Bila klaim tidak ada, klien menampilkan pesan `SESI_TANPA_KLAIM` dan sesi tidak terdaftar. **[BELUM TERBUKTI]**
3. Uji dua perangkat: login kedua menimpa yang pertama; yang pertama ditolak/logout; idle 2 jam dan logout setelah 16:00 WIB sesuai pengaturan layanan.
4. Cara mengubah flag: tidak ada UI di `src` (tidak ada referensi `sesi_tunggal_aktif` di kode klien); lakukan lewat perubahan `site_settings` yang dicatat di `DB-CHANGES.md` atas izin CEO. **[BELUM TERBUKTI: prosedur belum diuji]** Kembalikan ke `false` bila staf massal terkunci.

## 9. Komunikasi ke staf (kirim sebelum hari H, ingatkan Jumat/Senin pagi)

- [ ] Alur baru: Front Office melayani dulu; tiket hanya terbit saat FO mengeskalasi ke layanan; nomor tiket berformat dua huruf (mis. `OS-014`).
- [ ] FO/Admin: walk-in didaftarkan staf di `/admin/fo/daftar` (pengunjung tidak lagi mengisi sendiri di `/checkin`); scan QR reservasi di `/admin/scan`; topik + catatan (FO maks 200 karakter) wajib saat menyelesaikan/mengeskalasi.
- [ ] Petugas layanan: Mulai Layanan hanya satu orang (yang memulai yang menyelesaikan); selesai wajib topik + catatan (maks 1000) dan Pendataan Pelayanan **semua field wajib** (pilih "Belum ada"/"Tidak berlaku" bila memang tidak ada; catatan boleh "-"); dapat mengembalikan ke kotak masuk FO dengan catatan.
- [ ] Admin: jalur ambil alih (alasan wajib), alihkan ke layanan lain, kelola topik di `/admin/topik`.
- [ ] Chat: sesi yang ber-eskalasi masuk kotak masuk FO; ambil, teruskan ke layanan, selesaikan dengan topik + catatan; "kembali ke bot" dihapus.
- [ ] **Login ulang setelah rilis dan satu akun satu orang**: tidak boleh berbagi akun/login ganda; login baru memutus sesi lama; logout otomatis setelah jam tutup dan idle 2 jam.
- [ ] Nama Lengkap pengunjung terkunci; perubahan hanya oleh FO/Admin dengan alasan.
- [ ] Halaman lama yang terbuka harus dimuat ulang; galat "TRANSISI_LEWAT_RPC"/"CHAT_HARUS_RPC" berarti muat ulang.
- [ ] Siapa dihubungi saat masalah (Admin/pengembang) dan prosedur manual `docs/CADANGAN_MANUAL_FO.md`.

## 10. Ringkasan yang belum terbukti

- Gerbang penuh (`verify:baseline`) untuk working tree/commit akhir; cadangan DB terbaru.
- Urutan "migrasi lalu klien" pada jendela nyata; mekanisme promosi tertunda Vercel; perilaku service worker pada rilis.
- Uji perilaku `test-tiket-kepemilikan`, `test-fo-eskalasi`, `test-wp24` belum pernah dijalankan; 0006 dan 0011 hanya diuji statis; konkurensi sejati tidak diuji.
- Klaim `session_id` JWT stabil dan prosedur menyalakan flag `sesi_tunggal_aktif`.
- Parser ledger terhadap migrasi baru.
- Lama kunci tabel saat apply atomik di produksi (diperkirakan singkat; `lock_timeout` 5 detik, `statement_timeout` 120 detik).
- Jawaban CEO atas pertanyaan terbuka kontrak (§2 butir 7).

## 11. Perbaikan review (0012): operasional

- **Tiket lama 'dilayani' dengan dilayani_oleh kosong (NULL)** (tiket alur visit sebelum A3): hanya Admin yang dapat menanganinya. Di `/admin/antrian` (pilih tanggal tiket) baris itu menampilkan "Hanya petugas yang memulai ..." dan tombol **Ambil alih** (`admin_ambil_alih`, alasan >= 5 karakter, tercatat `audit_log`); setelah itu Admin menjadi pemilik dan menyelesaikan seperti biasa. Bila layanan wajib Pendataan, Admin yang mengambil alih BOLEH menutup tanpa form lewat RPC (`layanan_selesai` tanpa `p_form_type`, tercatat `layanan_selesai_tanpa_pendataan`); UI saat ini selalu membuka wizard Pendataan untuk layanan wajib form (tombol "selesai tanpa pendataan" belum ada). Bila tidak ditangani, job `penanganan_tutup_otomatis` (23:00 WIB) menutupnya (`selesai`, `waktu_selesai` NULL, tanpa pendataan). Cek sebelum cutover: `SELECT id, tanggal, layanan_id FROM tiket_antrean WHERE status='dilayani' AND dilayani_oleh IS NULL;`
- **Formulir Pendataan wajib per layanan**: sumber kebenaran kini `layanan.form_pendataan` (`oss`/`perizinan`/kosong), bukan nama. Admin mengubahnya di Kelola Layanan ("Formulir Pendataan"); perubahan tercatat di Riwayat Perubahan. Layanan baru tanpa pilihan diisi dari nama (kata "OSS"/"Non OSS"/"Perizinan"). Layanan wajib form menolak penyelesaian tanpa form yang cocok (`INVALID_PAYLOAD`).
- **Antrean bukan hari ini**: `layanan_mulai` menolak tiket bertanggal lain (`BUKAN_HARI_INI`). Tiket lama yang tertinggal ditutup job akhir hari; bila job gagal, jalankan `SELECT public.tandai_tidak_terlayani_akhir_hari();` atas izin CEO.
- **Admin alihkan** kini menolak layanan tujuan yang libur/di luar jadwal (`LAYANAN_TIDAK_BUKA`) atau setelah jam tutup (`LAYANAN_TUTUP`).
- **Walk-in lama 'terjadwal'** (alur visit pra WP-24) dibatalkan saat 0012 diterapkan dan oleh job no-show harian (audit `tutup_walkin_terjadwal`, alasan tercatat).
- **Chat tertinggal**: sesi `eskalasi`/`aktif` tanpa aktivitas > 24 jam ditutup job `chat_tutup_otomatis` (23:30 WIB): tahap berjalan -> `batal/tidak_ditutup`, menunggu -> `batal/tidak_terlayani`, kunjungan dilayani -> `selesai` (memicu SKM), menunggu -> `tidak_terlayani`, sesi `selesai` + pesan sistem. Sesi chat baru tanpa pesan pengunjung tidak lagi mencatat kunjungan (batas spam); kunjungan tercatat saat pesan pertama masuk.
- **Rekap harian** (`rollup_rekap_harian`): `total_hadir` = kunjungan berbeda per layanan; rata-rata durasi hanya dari tiket `selesai`. Angka hari yang dihitung ulang setelah 0012 dapat lebih kecil dari sebelumnya untuk hari yang memuat tiket dikembalikan/dialihkan.

---

# Lampiran A — WP-24: mengakhiri dual-write `visit` (rincian)

Migrasi: `202610140007_wp24_akhiri_dual_write.sql`, `202610140008_wp24_tutup_otomatis_retensi.sql`.
Rollback: `docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql`, lalu `docs/rollback-wp24-akhiri-dual-write-202610140007.sql`.
Uji kontrak: `supabase/migrations/wp24.test.ts`. Uji perilaku (selalu ROLLBACK): `scripts/test-wp24.mjs`.

### A.1. Syarat jendela cutover (Gerbang G.6)

- Hari **Jumat setelah 16:00 WIB atau akhir pekan**, sehingga ada waktu perbaikan sebelum Senin.
- **Antrean kosong**: job `antrean_tidak_terlayani_akhir_hari` (16:00 WIB) sudah berjalan dan tidak ada tiket `menunggu`/`dipanggil` hari ini. Migrasi 0007 **menolak sendiri** (`CUTOVER_DITOLAK`) bila syarat ini tidak terpenuhi. Tiket `dilayani` lama boleh tersisa; migrasi hanya melaporkannya (NOTICE).
- Klien Tahap B (RPC FO/reservasi, tanpa INSERT/UPDATE `visit`) **siap di-deploy pada jendela yang sama**. Setelah 0007, setiap tulis `visit` dari klien lama gagal `42501` (permission denied) atau `VISIT_ARSIP`.
- Petugas sudah diberi tahu perubahan cara kerja (FO melayani dulu, tiket terbit saat eskalasi).
- Konfirmasi CEO tertulis untuk setiap migrasi yang diterapkan.

### A.2. Pemeriksaan sebelum menerapkan (read-only)

1. `SELECT now(), now() AT TIME ZONE 'Asia/Jakarta';` → pastikan dalam jendela.
2. Uji perilaku penuh (transaksi selalu di-ROLLBACK; mengunci tabel antrean ±1–2 menit):
   ```
   node scripts/test-wp24.mjs \
     --pre supabase/migrations/202610140002_tiket_kepemilikan.sql \
     --pre supabase/migrations/202610140003_fo_model_data.sql \
     --pre supabase/migrations/202610140004_fo_rpc.sql \
     --pre supabase/migrations/202610140005_fo_selaras_antrean.sql \
     --pre supabase/migrations/202610140006_pernyataan_kebenaran.sql \
     --apply supabase/migrations/202610140007_wp24_akhiri_dual_write.sql \
     --apply supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --akhir-hari
   ```
   Hasil wajib `0 gagal`. Simpan keluarannya sebagai bukti.
3. Hitungan antrean dan reservasi lama (dicatat untuk verifikasi pasca):
   ```sql
   SELECT status, count(*) FROM tiket_antrean WHERE tanggal = (now() AT TIME ZONE 'Asia/Jakarta')::date GROUP BY 1;
   SELECT tujuan, count(*) FROM visit WHERE asal='reservasi' AND status='terjadwal'
     AND tanggal_rencana >= (now() AT TIME ZONE 'Asia/Jakarta')::date GROUP BY 1;
   SELECT count(*) FROM tiket_antrean WHERE status='dilayani';
   ```

### A.3. Urutan penerapan

Satu jendela, berurutan, masing-masing `--dry-run` dulu lalu sungguhan (setelah konfirmasi CEO). `202610140001` sudah di produksi.

```
node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140002_tiket_kepemilikan.sql --atomic
...                               202610140003_fo_model_data.sql
...                               202610140004_fo_rpc.sql
...                               202610140005_fo_selaras_antrean.sql
...                               202610140006_pernyataan_kebenaran.sql
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140007_wp24_akhiri_dual_write.sql --atomic
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic --dry-run
node scripts/apply-migration.mjs supabase/migrations/202610140008_wp24_tutup_otomatis_retensi.sql --atomic
```

Catatan: `--dry-run` 0007/0008 secara terpisah sebelum 0002..0006 diterapkan akan berhenti di penjaga `PRASYARAT` (itu benar). Untuk uji gabungan sebelum hari H gunakan `scripts/test-wp24.mjs` (§A.2 butir 2).

Dalam rollout penuh, 0009 dan 0011 menyusul setelah 0008 (urutan lengkap §1 dan `docs/MIGRATIONS.md`). Lalu: deploy klien Tahap B → muat ulang skema PostgREST bila RPC "not found" (`NOTIFY pgrst, 'reload schema'`).

### A.4. Reservasi dan tiket lama yang masih terbuka saat cutover

| Keadaan | Perilaku setelah 0007 |
|---|---|
| Reservasi `visit` tujuan `loket`, `terjadwal` | Sudah punya `kunjungan` (dual-write); kolom tujuan/layanan saran/keperluan/instansi/jam disalin dari `visit`. FO check-in lewat `fo_checkin_reservasi` (QR sama). `visit` tetap `terjadwal` (arsip). |
| Reservasi `visit` tujuan `bertemu_seseorang`, tanggal ≥ hari ini | Dibuatkan `kunjungan` `terjadwal` (QR sama) → FO bisa check-in. |
| Reservasi `bertemu_seseorang` yang tanggalnya sudah lewat | Tidak dibuatkan; tetap di arsip `visit`. |
| Reservasi lama tanggal lewat (`loket`) | Job no-show harian menandai `kunjungan` → `no_show`; `visit` tidak disentuh. |
| Tiket lama `dilayani` | Pemilik (`dilayani_oleh`) menyelesaikan lewat `layanan_selesai` (tanpa topik/catatan); `kunjungan` → `selesai`, SKM/notifikasi lewat trigger kunjungan. Bila tidak ditutup, job 23:00 WIB menutupnya (`selesai`, `waktu_selesai` NULL). Admin dapat `admin_ambil_alih`. |
| SKM kunjungan lama (token di email lama) | `get_skm_context`/`submit_skm_response` mencari `kunjungan.qr_token` (sama dengan `visit.qr_token`); respons yang sudah ada terdeteksi (`skm_respons.kunjungan_id` di-backfill). Token tanpa kunjungan dijawab dari arsip `visit`. |

### A.5. Verifikasi pasca (read-only, segera setelah terap)

```sql
-- trigger efek visit nonaktif; penjaga arsip aktif
SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='public.visit'::regclass AND NOT tgisinternal ORDER BY 1;
-- tidak ada fungsi yang menulis visit selain anonimisasi
SELECT proname FROM pg_proc WHERE pronamespace='public'::regnamespace
  AND prosrc ~* '(update|insert[[:space:]]+into|delete[[:space:]]+from)[[:space:]]+public\.visit\M';
-- job baru
SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('penanganan_tutup_otomatis','anonymize_inactive_pengunjung','refresh_estimasi');
-- estimasi terisi dari tiket
SELECT count(*) FROM mv_estimasi_layanan;  SELECT * FROM v_antrian_loket LIMIT 5;
-- reservasi lama bertemu_seseorang yang dibuatkan kunjungan
SELECT count(*) FROM kunjungan k JOIN visit v ON v.id=k.legacy_visit_id WHERE v.tujuan='bertemu_seseorang' AND k.status='terjadwal';
```

Uji asap aplikasi (akun uji, pengunjung sintetis): FO walk-in → selesai di FO → tautan SKM bisa diisi; FO → eskalasi → petugas mulai/selesai → notifikasi `skm_survey` terantre (`SELECT payload->>'type', count(*) FROM notifikasi WHERE created_at > now() - interval '1 hour' GROUP BY 1`); layar TV dan estimasi tampil.

### A.6. Jendela rollback

- **Jendela utama: dari terap sampai sebelum layanan dibuka hari kerja berikutnya (Senin 08:00 WIB).** Dalam jendela ini belum ada data operasional alur baru yang berarti, sehingga rollback bersih.
- Urutan: rollback **0008 → 0007** (lalu 0006..0002 bila seluruh Tahap B dibatalkan), masing-masing `--atomic --dry-run` dulu, bersama pengembalian klien yang menulis `visit`:
  ```
  node scripts/apply-migration.mjs docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql --atomic --dry-run
  node scripts/apply-migration.mjs docs/rollback-wp24-tutup-otomatis-retensi-202610140008.sql --atomic
  node scripts/apply-migration.mjs docs/rollback-wp24-akhiri-dual-write-202610140007.sql --atomic --dry-run
  node scripts/apply-migration.mjs docs/rollback-wp24-akhiri-dual-write-202610140007.sql --atomic
  ```
- **Setelah layanan berjalan dengan alur baru**, rollback 0007 masih bisa dijalankan (RPC 0004/0005 yang dipulihkan menangani kunjungan tanpa `visit`), tetapi: SKM/notifikasi/estimasi untuk kunjungan baru kembali mati (membaca `visit`), `visit` tidak disinkronkan mundur, dan nilai `skm_respons.kunjungan_id` hilang. Rollback 0008 ditolak bila sudah ada tahap `tidak_ditutup` kecuali `lmh.rollback_paksa` dinyalakan sadar (tahap itu menjadi `tidak_terlayani`). Lebih aman: perbaikan maju (migrasi forward baru).
- Data yang **tidak** dikembalikan: kunjungan reservasi `bertemu_seseorang` yang dibuat 0007, kolom kunjungan yang dilengkapi dari `visit`, notifikasi/audit yang sudah terbit, status yang ditutup job, nilai yang sudah dianonimkan.
- Pemicu rollback: tulis klien gagal massal yang tidak bisa diperbaiki dengan deploy klien, SKM/notifikasi tidak terantre untuk kunjungan selesai, atau job akhir hari gagal (cek `cron.job_run_details`).
