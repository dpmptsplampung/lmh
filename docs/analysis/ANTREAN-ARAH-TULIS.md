# A0 — Arah Tulis Antrean: `visit` ↔ `tiket_antrean` ↔ `kunjungan`

> Tanggal: 2026-10-13 · Branch: `feat/audit-fondasi-fo-eskalasi` · Penyusun: investigasi A0 (read-only)
> Rujukan: rencana `docs/superpowers/plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md` (Tahap A, Gerbang G), spec `docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md` §4.6 dan §5.
> Keputusan CEO yang mengikat: (1) tiket hanya boleh **diselesaikan oleh orang yang memulainya**; (2) WP-24 = Opsi A (tulis `visit` dihentikan di **Tahap B**, `trg_visit_dual_write` dinonaktifkan, data lama jadi arsip). Tahap A harus berjalan di atas keadaan sekarang.

## 0. Metode dan tingkat bukti

- **Kode:** migrasi terbaru per objek dan berkas `src/` dibaca langsung (berkas:baris dikutip).
- **Produksi (read-only):** tiga skrip sementara di scratchpad (`a0-arah-tulis*.mjs`), `BEGIN READ ONLY` → hanya `SELECT` dari `pg_proc`, `pg_trigger`, `pg_policies`, `pg_constraint`, `information_schema`, `cron.job`, `pg_publication_tables`, agregat `audit_log`/`tiket_antrean`/`visit` → `ROLLBACK`. Tidak ada kredensial dan PII yang dicetak.
- Tanda: **[TERBUKTI]** = dibuktikan dari definisi produksi atau data; **[KODE]** = dibuktikan dari kode/migrasi di repo; **[DUGAAN]** = kesimpulan yang belum diuji perilaku.

**Kesesuaian repo dengan produksi [TERBUKTI]:** `prosrc` produksi untuk `sync_visit_dual_write`, `panggil_tiket`, `finalize_pelayanan`, `antrean_broadcast`, `terbit_tiket`, `tandai_tidak_terlayani_akhir_hari` dan `tandai_reservasi_no_show` sama dengan versi terakhirnya di migrasi (`202607300015`, `202610080001`, `202610010001`, `202609230003`, `202607290013`, `202607300017`, `202608310002`).

### Koreksi terhadap "fakta awal" di rencana
| Fakta awal | Keadaan nyata |
|---|---|
| `api/admin/pelayanan/[tiketId]` menulis `visit` | Route itu **tidak menulis** `visit`. Ia hanya **membaca** `visit` (`route.ts:92-102`). Tulisannya terjadi tidak langsung, lewat RPC `finalize_pelayanan` (`route.ts:403`), dan RPC itulah yang meng-`UPDATE visit`. |
| `src/app/me` menulis `visit` | `me/page.tsx:102-108` hanya **membaca** (`SELECT`). Penulis di bawah `me/` hanya `me/reservasi/page.tsx:240-244` (INSERT). |
| `panggil_tiket()` menulis `tiket_antrean` langsung | **Tidak menulis tabel apa pun.** Fungsi ini hanya `SELECT … WHERE status='menunggu'` lalu `pg_notify('nomor_dipanggil')` (`202610080001:458-498`). Status `dipanggil` **tidak pernah ditulis** (di produksi 0 baris). Tidak ada pendengar `nomor_dipanggil` di `src/`, dan Supabase Realtime tidak meneruskan NOTIFY. Jadi event ini praktis mati. |
| Baris `admin/antrian/page.tsx` ~214/246; tombol 627/651/672 | UPDATE ada di `:218-224` (fungsi `:214`) dan `:249-255` (fungsi `:242`). Tombol "Mulai Layanan" ada di `:652-659`, "Selesai" di `:673-680`, "Panggil" di `:628-636`. |
| Migrasi A1 = `202610130002_sesi_staf.sql` | Nomor **`202610130002` sudah terpakai** (`202610130002_faq_petugas_hanya_petugas.sql`). A1/A3 harus dinomori ulang, misalnya `202610130003_sesi_staf.sql` dan `202610130004_tiket_kepemilikan.sql`. |

---

## 1. Siapa menulis apa

### 1.1 Trigger pada tabel inti (produksi) [TERBUKTI]

| Tabel | Trigger (urutan BEFORE/AFTER) | Fungsi | Efek |
|---|---|---|---|
| `visit` | `trg_guard_visit_layanan_buka` BEFORE INSERT | `guard_visit_layanan_buka` | jam tutup / jadwal |
| `visit` | `trg_visit_qr_hangus` BEFORE UPDATE OF status | `cegah_checkin_reservasi_kedaluwarsa` | menolak check-in reservasi kedaluwarsa |
| `visit` | `trg_visit_updated` BEFORE UPDATE | `update_updated_at_column` | `updated_at = now()` |
| `visit` | **`trg_visit_dual_write` AFTER INSERT OR UPDATE** | **`sync_visit_dual_write`** | **visit → kunjungan / tiket_antrean / buku_tamu** |
| `visit` | `trg_audit_visit_status` AFTER UPDATE OF status | `audit_change('update_status')` | `audit_log`. Saat ini **satu-satunya catatan siapa memulai/menyelesaikan** |
| `visit` | `trg_notify_visit_selesai` AFTER UPDATE OF status | `notify_visit_selesai` | push/email: `menunggu`, `dilayani` ("Giliran Anda dimulai"), `selesai` (tautan SKM) |
| `visit` | `trg_notify_reservasi_confirmed` AFTER UPDATE OF status | `notify_reservasi_confirmed` | push/email saat reservasi `terjadwal→menunggu` |
| `visit` | `trg_visit_selesai_rr` AFTER UPDATE | `trg_visit_selesai_rr` | `skm_response_rate.dilayani +1` saat → `selesai` |
| `visit` | `trg_log_visit_insert` AFTER INSERT (walk_in) | `log_anon_action` | rate-limit anon |
| `tiket_antrean` | `trg_antrean_broadcast` AFTER INSERT OR UPDATE | `antrean_broadcast` | `realtime.send(…, 'antrean:publik')`: payload `tiket_id, layanan_id, nomor_display, status` |
| `kunjungan` | — (tidak ada) | | |

Tidak ada trigger pada `tiket_antrean` atau `kunjungan` yang menulis balik ke `visit`. Arah sinkron hanya **satu**, yaitu `visit → kunjungan/tiket_antrean`.

### 1.2 Transisi status: kode → tabel → trigger

| Transisi | Pemicu (berkas:baris) | Ditulis langsung | Propagasi trigger | Catatan |
|---|---|---|---|---|
| ∅ → `terjadwal` (reservasi) | `src/app/me/reservasi/page.tsx:240-244` INSERT | `visit` | `kunjungan` INSERT (status `terjadwal`); tiket **belum** terbit | RLS `visit_insert_reservasi` |
| ∅ → `menunggu` (walk-in) | `src/app/api/checkin/route.ts:87-105`, `src/app/checkin/page.tsx:185-196`, `src/components/WalkinWizard.tsx:125-136` INSERT | `visit` | `kunjungan` INSERT + `terbit_tiket()` → `tiket_antrean` INSERT `menunggu` + UPDATE `legacy_visit_id` (2 broadcast) | `202607300015:234-265` |
| `terjadwal` → `menunggu` (check-in reservasi) | `src/app/admin/scan/page.tsx:207-213` UPDATE (status, waktu_masuk, waktu_scan, diarahkan_ke) | `visit` | `kunjungan.status`; `terbit_tiket()` (syarat `waktu_scan` baru terisi) | `202607300015:282-305` |
| `terjadwal` → `batal` | `admin/scan/page.tsx:207-213` (Tolak) | `visit` | `kunjungan.status` | tidak ada tiket |
| `terjadwal` → `no_show` | cron `reservasi_no_show_harian` (`45 8 * * *` UTC) → `tandai_reservasi_no_show()` | `visit` | `kunjungan.status` | |
| `menunggu` → `dipanggil` | `admin/antrian/page.tsx:200` → `panggil_tiket` | **tidak ada** | — | hanya `pg_notify`; status tidak berubah |
| `menunggu` → `dilayani` | `src/app/admin/antrian/page.tsx:218-224` UPDATE `{status, waktu_mulai_layan: jam klien}` `.eq('id', legacyVisitId)` | `visit` | `kunjungan.status`; `tiket_antrean.status/waktu_mulai_layan/waktu_selesai/updated_at` (`202607300015:317-322`) | **`dilayani_oleh` tidak diisi siapa pun** |
| `dilayani` → `selesai` (layanan tanpa pendataan) | `src/app/admin/antrian/page.tsx:249-255` UPDATE `{status:'selesai', waktu_selesai: jam klien}` | `visit` | idem | tanpa cek status sebelumnya |
| `dilayani` → `selesai` (OSS / Non OSS) | `PelayananWizardModal.tsx:334` → `POST api/admin/pelayanan/[tiketId]` (`route.ts:403`) → `finalize_pelayanan` | `pelayanan_oss`/`pelayanan_perizinan`, lalu `visit` (bila `legacy_visit_id`) **atau** `tiket_antrean` (bila tidak) | via `visit`: idem | `202610010001:272-281` |
| `menunggu` → `tidak_terlayani` | cron `antrean_tidak_terlayani_akhir_hari` (`0 9 * * *` UTC = 16:00 WIB) | `visit` (`UPDATE … FROM tiket_antrean WHERE t.status='menunggu' AND v.status='menunggu'`) | tiket/kunjungan | `202607300017:12-31`, jadwal `202610090001:486-496` |
| `dilayani` tertinggal di akhir hari | — | — | — | **tidak ada job yang menutupnya** (lihat 2.5) |

Kesimpulan [TERBUKTI]: untuk semua transisi status antrean, **sumber tulis yang sebenarnya adalah `visit`**. `tiket_antrean` dan `kunjungan` adalah salinan yang diisi trigger. Satu-satunya jalur yang bisa menulis `tiket_antrean` tanpa lewat `visit` adalah cabang `ELSE` di `finalize_pelayanan`, dan cabang itu hanya terpakai untuk tiket tanpa `legacy_visit_id`. **Di produksi tiket seperti itu ada 0 dari 451.**

### 1.3 Konsistensi data saat ini [TERBUKTI]
- `tiket_antrean`: 451 baris, semuanya punya `legacy_visit_id`. Status: `selesai` 433, `tidak_terlayani` 16, `dilayani` 2.
- Divergensi status `visit` vs `tiket_antrean`: **0**. Divergensi `waktu_mulai_layan`/`waktu_selesai`: **0**. Divergensi `kunjungan` vs `visit`: **0**.
- `tiket_antrean.updated_at = visit.updated_at` pada **451/451** baris. Ini bukti bahwa setiap perubahan tiket berasal dari trigger, yang menyalin `updated_at` milik `visit`.

---

## 2. Rekursi, penimpaan kolom, dan pembaca `visit`

### 2.1 Bisakah `sync_visit_dual_write` berulang atau rekursif?
**Tidak, pada keadaan sekarang [TERBUKTI dari katalog].**
- Fungsi ini menulis `kunjungan` (tanpa trigger), `tiket_antrean` (hanya trigger `antrean_broadcast`, yang `RETURN NULL` dan tidak menulis tabel), dan `buku_tamu`. Tidak ada jalur yang kembali meng-`UPDATE visit`, jadi tidak ada siklus.
- `pg_trigger_depth()` **tidak dipakai di fungsi mana pun** (pencarian di `pg_proc` produksi: 0). Guard yang ada hanya filter kolom di `202607300015:218-227`: UPDATE `visit` yang tidak mengubah `status/waktu_masuk/waktu_scan/waktu_mulai_layan/waktu_selesai` langsung `RETURN NEW`.
- Bila sebuah RPC menulis `tiket_antrean` **lalu** `visit` dalam satu transaksi, urutannya: UPDATE tiket (broadcast #1) → UPDATE visit → BEFORE `trg_visit_updated` → AFTER `trg_visit_dual_write` → `SELECT … FOR UPDATE` kunjungan dan tiket (baris sudah dikunci transaksi yang sama, jadi tidak menunggu) → UPDATE tiket lagi (broadcast #2). **Hasil akhirnya deterministik dan tidak berulang.** Biayanya dua siaran realtime untuk satu aksi; ini idempoten karena layar hanya memuat ulang view.
- **Risiko masa depan [DUGAAN]:** bila suatu saat ditambahkan trigger balik `tiket_antrean → visit`, sementara `trg_visit_dual_write` masih aktif, siklus akan terjadi. **Jangan menambah trigger balik.** Bila memang perlu, wajib dijaga dengan `pg_trigger_depth() > 1` atau flag transaksi.

### 2.2 Apakah trigger menimpa `dilayani_oleh` / `waktu_mulai_layan`?
- **`dilayani_oleh`: TIDAK ditimpa.** Klausa `UPDATE tiket_antrean SET status, waktu_mulai_layan, waktu_selesai, updated_at` (`202607300015:317-322`) tidak menyebut kolom itu [TERBUKTI].
- **`waktu_mulai_layan`, `waktu_selesai`, `status`, `updated_at`: DITIMPA tanpa syarat** dengan nilai `visit`, setiap kali `visit` berubah pada salah satu kolom pemicu. Contoh: bila RPC menulis `tiket.waktu_mulai_layan = now()` tetapi `visit.waktu_mulai_layan` dibiarkan NULL, update `visit` berikutnya mengembalikan tiket ke NULL. **Implikasi desain: RPC harus menulis nilai identik ke kedua tabel.** Gunakan satu `v_now := now()`. Di dalam satu transaksi, `now()` juga menjadi nilai `updated_at` dari `trg_visit_updated`, jadi tetap konsisten.
- Trigger menolak `NEW.status = 'terjadwal'` bila tiket ada (`:313-315`). Selain itu **tidak ada mesin status**: transisi mundur (`selesai → menunggu`) tetap diteruskan apa adanya.

### 2.3 Bila hanya `tiket_antrean` yang diubah
Tidak ada trigger balik [TERBUKTI], sehingga `visit` dan `kunjungan` **basi**. Kalau RPC baru hanya menulis tiket, efek samping berikut **hilang diam-diam**: email/push SKM, push "Giliran Anda dimulai", penghitung response-rate SKM, `audit_log` siapa melayani, eligibilitas SKM, dan estimasi waktu.

### 2.4 Pembaca `visit` yang masih hidup (alasan `visit` tidak boleh basi sebelum WP-24)
| Pembaca | Membaca | Dampak bila `visit` basi |
|---|---|---|
| `get_skm_context` (`src/app/skm/page.tsx:64`) dan `submit_skm_response` (`src/app/api/skm/submit/route.ts:50`) | `visit.status = 'selesai'` via `qr_token` [TERBUKTI] | **SKM tidak bisa diisi** ("not_completed") |
| `notify_visit_selesai`, `notify_reservasi_confirmed` | transisi status `visit` | notifikasi SKM / "giliran dimulai" tidak terkirim |
| `trg_visit_selesai_rr` → `skm_rr_tambah` | `visit` → `selesai` | angka response-rate SKM salah |
| `trg_audit_visit_status` | status `visit` | jejak audit siapa memulai/menyelesaikan hilang |
| `mv_estimasi_layanan` (refresh tiap 5 menit, `refresh_estimasi`) → `v_antrian_loket` (estimasi publik, `EstimasiAntrean`) | `visit.waktu_mulai_layan/waktu_selesai/status` [TERBUKTI viewdef] | estimasi tunggu publik salah atau beku |
| `metrik_kepatuhan`, `jumlah_terdaftar` | `visit` | tidak dipanggil dari `src/` (risiko rendah) |
| `src/app/me/page.tsx:102-108` | reservasi aktif `terjadwal/menunggu/dilayani` | dashboard pengunjung menampilkan status salah |
| `src/app/admin/scan/page.tsx:69-79` | lookup reservasi via `qr_token` | (status check-in) |
| `src/app/api/admin/pelayanan/[tiketId]/route.ts:92-102` | `asal_instansi, keperluan` (statis) | rendah |
| `src/app/admin/page.tsx:243`, `src/app/admin/kunjungan/page.tsx:97` | `useRealtimeRefetch({ table: 'visit' })` | dasbor tidak segar real-time (ada polling cadangan 30 detik) |
| **Layar TV** `layar/[token]`, `layar-antrian` | **tidak membaca `visit`**. Membaca `v_layar_antrian` (dari `tiket_antrean`) + broadcast `antrean:publik` [TERBUKTI] | aman |
| **Rekap** `src/lib/rekap/query.ts:20-37`, `rollup_rekap_harian` | `tiket_antrean` | aman. Tetapi kolom petugas = `petugas:dilayani_oleh(nama)` (`query.ts:27`), dan karena kolom itu **selalu NULL**, nama petugas di rekap/ekspor **selalu kosong** [TERBUKTI 0/451] |

### 2.5 Temuan sampingan [TERBUKTI]
- Ada 2 tiket berstatus `dilayani` (tanggal 2026-10-05 dan 2026-10-13). Yang lama **tidak pernah ditutup** karena job akhir-hari hanya menangani `menunggu`.
- Data pendataan: tiket OSS/Non OSS `selesai` tanpa data = 32 (Juli) dan 149 dari 152 (Agustus), lalu **0** sejak September. Ini wajar karena pendataan baru terpasang akhir Agustus.
- Ada 8 draf `pelayanan_*` (tidak terkunci) menempel pada tiket `tidak_terlayani`. Artinya draf diisi sebelum "Mulai", lewat tombol "Lengkapi Data" saat `menunggu` (`antrian/page.tsx:641-651`).

---

## 3. Kolom kepemilikan

- **`tiket_antrean.dilayani_oleh`** (`uuid REFERENCES petugas(id) ON DELETE SET NULL`, `202607290013:56`): **tidak diisi oleh trigger maupun kode mana pun.** Ini terbukti dari tiga sumber: pencarian `dilayani_oleh` di `pg_proc` produksi = 0 fungsi, pencarian di `src/` hanya menemukan pembaca (`rekap/query.ts:27`), dan datanya **0/451** baris terisi.
- **`visit` tidak punya kolom setara.** Kolomnya hanya `catatan_petugas, diarahkan_ke` [TERBUKTI]. Jejak pelaku saat ini **hanya** ada di `audit_log` (`actor_id = auth.uid()`, `actor_role`) dari `trg_audit_visit_status`.
- `pelayanan_oss/perizinan.petugas_id` = **penyimpan draf pertama**, belum tentu orang yang memulai layanan (`route.ts:244-262`; `finalize_pelayanan` tidak mengubahnya pada UPDATE).
- **Jalur penyelesaian tanpa kepemilikan [TERBUKTI]:**
  1. `finalize_pelayanan` (`202610010001:152-159`): `admin` **dan `front_office` boleh menyelesaikan tiket layanan mana pun**, sedangkan petugas boleh untuk layanannya. Tidak ada cek pemula. Route juga mengizinkan FO/admin (`src/lib/pelayanan.ts:38-47`, `route.ts:358`).
  2. UPDATE langsung `visit` (`antrian/page.tsx:249-255`): RLS `visit_update_staff` hanya memeriksa `boleh_layanan(layanan_id)` (`202610090001:251-254`), yang benar untuk admin/FO di semua layanan dan petugas di layanannya. **Tidak ada syarat status asal maupun pemilik.** Lewat PostgREST, siapa pun yang memenuhi syarat itu bisa mengubah status ke apa saja, termasuk `selesai → menunggu`.
  3. UPDATE langsung `tiket_antrean`: policy `tiket_staff_update` **masih versi lama** (`202607290013:143-144`, roles `public`, tanpa `WITH CHECK`): `get_my_role() IN ('admin','front_office') OR layanan_id = get_my_layanan_id()`. Artinya staf bisa menulis `dilayani_oleh`/`status` apa pun langsung, **sehingga kepemilikan bisa dipalsukan** kalau policy ini tidak dicabut. `src/` tidak memakai jalur ini (tidak ada `.from('tiket_antrean').update`).
- Fakta operasional dari `audit_log` (90 hari) [TERBUKTI]: yang memulai layanan adalah **admin 219**, petugas 221, FO 1, system 3. Yang menyelesaikan: admin 229, petugas 213, FO 1, system 5. Tiket yang **diselesaikan oleh orang berbeda dari yang memulai** ada **8** (diselesaikan admin 5, petugas 3). Setiap layanan aktif punya tepat 1 petugas.

---

## 4. Race yang ada (audit T1)

Dasar: isolasi default `read committed` [TERBUKTI]; tidak ada `CHECK` transisi status (CHECK hanya membatasi himpunan nilai, lihat `visit_status_check` dan `tiket_antrean_status_check`); tidak ada `WHERE status = …` pada UPDATE klien; tidak ada `FOR UPDATE` di `finalize_pelayanan`.

**Skenario A: dua penekan "Mulai Layanan" (dua staf, atau klik ganda) [KODE + TERBUKTI sebagian]**
1. Klien A dan B sama-sama mengirim `UPDATE visit SET status='dilayani', waktu_mulai_layan=<jam klien> WHERE id=:v` (`antrian/page.tsx:218-224`).
2. RLS `visit_update_staff` lolos untuk keduanya karena hanya memeriksa `boleh_layanan`. B menunggu kunci baris; setelah A commit, Postgres mengevaluasi ulang `WHERE id=:v`, yang tetap benar, lalu **B juga menulis**.
3. Hasilnya: kedua UI menampilkan "Layanan dimulai" dan membuka wizard. `waktu_mulai_layan` milik B (jam klien, bukan server, terkait S9) menimpa A, lalu trigger menyalinnya ke tiket. `dilayani_oleh` tetap NULL. Notifikasi `dilayani` hanya terkirim sekali karena ada guard `OLD.status IS DISTINCT FROM`, tetapi audit tercatat 2×.
4. Bukti produksi: **11 tiket** punya lebih dari satu entri audit `dilayani`. Pemicu `AFTER UPDATE OF status` berjalan setiap kali kolom `status` ada di SET, sehingga ini bukti UPDATE ganda. Semuanya oleh **aktor yang sama** (maksimum aktor berbeda per tiket = 1), jadi yang terbukti adalah klik ganda/ulang. Race dua staf berbeda belum pernah tercatat, tetapi tidak ada yang mencegahnya.

**Skenario B: "Selesaikan" pada layanan tanpa pendataan [KODE]**
- `UPDATE visit SET status='selesai', waktu_selesai=<jam klien>` tanpa syarat status asal. Staf lain (admin/FO lintas layanan) dapat menyelesaikan tiket yang sedang dilayani orang lain, bahkan tiket `menunggu` lewat API (UI hanya menyembunyikan tombolnya). Penyelesaian ganda menimpa `waktu_selesai`. Notifikasi SKM dan response-rate aman dari dobel karena guard `OLD.status`.

**Skenario C: "Selesaikan" OSS/Non OSS lewat `finalize_pelayanan` [KODE]**
- Tiket dibaca **tanpa `FOR UPDATE`** (`202610010001:142-147`), lalu status `dilayani` dicek pada snapshot (`:161-164`). Dua pemanggil bersamaan sama-sama lolos.
- Yang kebetulan mencegah data ganda: bila draf sudah ada, pemanggil kedua tertahan kunci baris `pelayanan_*`, lalu `trg_enforce_pelayanan_lock` melihat `OLD.is_locked = true` dan melempar `LOCKED`. Bila draf belum ada, `UNIQUE (tiket_id)` melempar `23505`. Data tetap utuh, tetapi pengguna kedua menerima pesan yang membingungkan ("Gagal menyelesaikan pelayanan" atau "sudah terkunci").
- Tidak ada pemeriksaan pemilik. FO dan admin bisa menyelesaikan tiket petugas lain.
- Draf (`PATCH route.ts:173-321`, RLS `oss_update_staff`: `boleh_tiket`) dapat ditimpa staf mana pun yang berhak atas layanan itu, termasuk selagi orang lain sedang melayani.

**Skenario D: "Mulai" bersamaan dengan job akhir hari [DUGAAN, risiko rendah]**
- Job berjalan 16:00 WIB (setelah tutup). `UPDATE visit … WHERE v.status='menunggu'` mengevaluasi ulang baris `visit` yang terkunci, jadi tidak terjadi tulis ganda.

---

## 5. Rekomendasi desain Tahap A

### 5.1 Pilihan arah tulis
| Opsi | Inti | Penilaian |
|---|---|---|
| **1 (direkomendasikan)** | `tiket_antrean` = sumber kebenaran. Guard atomik ada di baris tiket, lalu RPC menyinkronkan `visit` lewat `legacy_visit_id` dalam **transaksi yang sama**, dengan nilai identik. Trigger dual-write dibiarkan apa adanya. | Guard dan kepemilikan sudah berada di tabel target WP-24. Saat Tahap B cukup **menghapus blok sinkron `visit`**. Semua pembaca `visit` (SKM, notifikasi, audit, estimasi) tetap benar. |
| 2 | RPC menulis `visit` (guard pada `visit.status`) lalu hanya mengisi `dilayani_oleh`. | Bisa jalan, tetapi guard ada di tabel yang akan dipensiunkan, dan tiket tanpa visit (Tahap B, `fo_eskalasi`) butuh jalur kedua. Tidak disarankan. |
| 3 | Majukan WP-24 ke Tahap A | **Tidak disarankan.** WP-24 bukan sekadar menghapus 7 titik tulis. Semua pembaca di 2.4 harus dipindah dulu (SKM, notifikasi, response-rate, audit, `mv_estimasi_layanan`, dua job cron yang menulis `visit`). Kalau tidak, SKM dan estimasi rusak dan job akhir-hari menjadi no-op terhadap tiket. Ini cakupan Tahap B. |

### 5.2 Aturan desain RPC (Opsi 1)
1. **Urutan kunci sama dengan jalur lama** (visit → kunjungan → tiket). `SELECT … FROM visit WHERE id = legacy FOR UPDATE` **sebelum** UPDATE tiket. Jalur lama (scan, cron, klien basi) selalu mengunci `visit` terlebih dahulu, sehingga kunci `visit` menserialkan keduanya dan mencegah deadlock. Tanpa ini, RPC (tiket → visit) melawan trigger (visit → tiket) bisa deadlock [DUGAAN, mekanisme standar Postgres].
2. **Guard atomik di WHERE** pada UPDATE tiket, ditambah `RETURNING`. 0 baris berarti ditolak (`SUDAH_DIAMBIL`). Di bawah read committed, pemanggil kedua mengevaluasi ulang WHERE pada versi baris terbaru, sehingga hanya satu yang menang.
3. **Nilai identik ke `visit`** (`v_now` yang sama), dengan `WHERE status = <status lama>` dan pengecekan `ROW_COUNT = 1`. Kalau tidak cocok, `RAISE 'DIVERGENSI'` dan seluruh transaksi di-rollback. Dengan begitu trigger yang menyalin `visit → tiket` hanya menulis ulang nilai yang sama, dan `dilayani_oleh` aman (2.2).
4. **Identitas dari sesi**, bukan parameter: `staf_saya()` dan `sesi_valid()` (A1).
5. **Tutup jalur pintas di DB.** Kalau tidak, T1 belum benar-benar tertutup:
   - `DROP POLICY tiket_staff_update ON tiket_antrean`. Tidak ada klien yang memakainya; RPC dan trigger berjalan sebagai pemilik `postgres`, tabel tidak `FORCE RLS` [TERBUKTI], sehingga RLS tidak berlaku bagi mereka.
   - Trigger penjaga baru `BEFORE UPDATE ON visit` yang menolak transisi masuk atau keluar dari `dilayani/selesai` serta perubahan `waktu_mulai_layan/waktu_selesai`, **kecuali** flag transaksi-lokal `lmh.antrean_rpc = 'on'` aktif. Polanya sama dengan `lmh.koreksi` di `202610090001:78-92,217-219`. Scan check-in (`terjadwal→menunggu/batal`) dan cron (`→tidak_terlayani/no_show`) tetap lolos.
6. **`sync_visit_dual_write` tidak diubah** di Tahap A (risiko kecil, rollback mudah). `pg_trigger_depth()` tidak diperlukan karena tidak ada siklus.
7. **`panggil_tiket` tidak diubah.** Ia kompatibel karena hanya membaca `status='menunggu'`; setelah `layanan_mulai` ia mengembalikan NULL, dan UI sudah menanganinya di `antrian/page.tsx:201-205`. **Jangan memperkenalkan status `dipanggil` di Tahap A**: `visit` CHECK tidak mengenalnya, `tandai_tidak_terlayani_akhir_hari` hanya menyaring `menunggu`, dan `v_layar_antrian`/`get_queue_position` hanya menghitung `menunggu/dilayani`. Klausa `status IN ('menunggu','dipanggil')` boleh dipertahankan karena kompatibel ke depan.
8. **`finalize_pelayanan` dibungkus**: signature dan grant sama, isinya didelegasikan ke `layanan_selesai`. Klien atau route lama yang masih memanggil `finalize_pelayanan` otomatis terkena aturan pemilik, dan FO tidak lagi bisa menyelesaikan.
9. **Idempotensi klik ganda:** bila `dilayani_oleh = saya` dan status sudah `dilayani`, `layanan_mulai` mengembalikan `ok` dengan `sudah_milik_anda: true` alih-alih error.

### 5.3 Pseudocode SQL (ringkas, bukan final)
```sql
-- migrasi 2026101300NN_tiket_kepemilikan.sql (nomor menyesuaikan; 202610130002 sudah terpakai)
CREATE OR REPLACE FUNCTION public.layanan_mulai(p_tiket_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me record; v_t record; v_now timestamptz := now(); v_n int;
BEGIN
  SELECT id, role, layanan_id INTO v_me FROM public.staf_saya();
  IF v_me.id IS NULL THEN RAISE EXCEPTION 'FORBIDDEN: hanya staf aktif' USING ERRCODE='42501'; END IF;
  IF NOT public.sesi_valid() THEN RAISE EXCEPTION 'SESI_TIDAK_SAH' USING ERRCODE='42501'; END IF;   -- A1
  SELECT id, layanan_id, legacy_visit_id, status, dilayani_oleh INTO v_t
    FROM public.tiket_antrean WHERE id = p_tiket_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  -- Peran: petugas layanan ini. Admin? -> KEPUTUSAN CEO (lihat 7.1). FO: ditolak (spec §4.6).
  IF NOT (v_me.role = 'petugas' AND v_me.layanan_id = v_t.layanan_id) THEN
    RAISE EXCEPTION 'FORBIDDEN: bukan petugas layanan ini' USING ERRCODE='42501';
  END IF;
  IF v_t.legacy_visit_id IS NOT NULL THEN            -- urutan kunci = jalur lama
    PERFORM 1 FROM public.visit WHERE id = v_t.legacy_visit_id FOR UPDATE;
  END IF;
  UPDATE public.tiket_antrean
     SET status = 'dilayani', dilayani_oleh = v_me.id, waktu_mulai_layan = v_now, updated_at = v_now
   WHERE id = p_tiket_id AND status IN ('menunggu','dipanggil') AND dilayani_oleh IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    IF EXISTS (SELECT 1 FROM public.tiket_antrean WHERE id = p_tiket_id
               AND status = 'dilayani' AND dilayani_oleh = v_me.id) THEN
      RETURN jsonb_build_object('ok', true, 'sudah_milik_anda', true);
    END IF;
    RAISE EXCEPTION 'SUDAH_DIAMBIL: tiket sudah ditangani petugas lain atau tidak menunggu' USING ERRCODE='P0001';
  END IF;
  IF v_t.legacy_visit_id IS NOT NULL THEN            -- sinkron WP-24: hapus blok ini di Tahap B
    PERFORM set_config('lmh.antrean_rpc', 'on', true);
    UPDATE public.visit SET status = 'dilayani', waktu_mulai_layan = v_now
     WHERE id = v_t.legacy_visit_id AND status = 'menunggu';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('lmh.antrean_rpc', 'off', true);
    IF v_n <> 1 THEN RAISE EXCEPTION 'DIVERGENSI: visit % tidak berstatus menunggu', v_t.legacy_visit_id; END IF;
  END IF;   -- trg_visit_dual_write menulis ulang tiket dengan nilai identik; dilayani_oleh tidak disentuh
  RETURN jsonb_build_object('ok', true, 'dilayani_oleh', v_me.id, 'waktu_mulai_layan', v_now);
END $$;

CREATE OR REPLACE FUNCTION public.layanan_selesai(p_tiket_id uuid, p_form_type text DEFAULT NULL, p_payload jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE v_me record; v_t record; v_now timestamptz := now(); v_n int;
BEGIN
  -- staf_saya + sesi_valid (sama seperti di atas)
  SELECT legacy_visit_id INTO v_t FROM public.tiket_antrean WHERE id = p_tiket_id;
  IF v_t.legacy_visit_id IS NOT NULL THEN PERFORM 1 FROM public.visit WHERE id = v_t.legacy_visit_id FOR UPDATE; END IF;
  SELECT t.*, l.nama AS layanan_nama INTO v_t FROM public.tiket_antrean t JOIN public.layanan l ON l.id = t.layanan_id
   WHERE t.id = p_tiket_id FOR UPDATE OF t;               -- pemanggil konkuren kedua menunggu di sini
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF v_t.status <> 'dilayani' THEN RAISE EXCEPTION 'INVALID_STATUS: status=%', v_t.status; END IF;
  IF v_t.dilayani_oleh IS DISTINCT FROM v_me.id THEN       -- KEPUTUSAN CEO: hanya pemula
    RAISE EXCEPTION 'BUKAN_PEMILIK: tiket dilayani petugas lain' USING ERRCODE='42501';
  END IF;
  -- Pendataan: bila layanan wajib pendataan (lihat 7.4) -> payload wajib; upsert pelayanan_* = logika
  -- finalize_pelayanan bagian (e) apa adanya (validasi lengkap K11 = Tahap C), petugas_id = v_me.id.
  UPDATE public.tiket_antrean SET status = 'selesai', waktu_selesai = v_now, updated_at = v_now
   WHERE id = p_tiket_id AND status = 'dilayani' AND dilayani_oleh = v_me.id;
  IF v_t.legacy_visit_id IS NOT NULL THEN
    PERFORM set_config('lmh.antrean_rpc', 'on', true);
    UPDATE public.visit SET status = 'selesai', waktu_selesai = v_now
     WHERE id = v_t.legacy_visit_id AND status = 'dilayani';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    PERFORM set_config('lmh.antrean_rpc', 'off', true);
    IF v_n <> 1 THEN RAISE EXCEPTION 'DIVERGENSI'; END IF;   -- SKM/notifikasi/audit/response-rate tetap via visit
  END IF;
  RETURN jsonb_build_object('ok', true, 'is_locked', p_form_type IS NOT NULL, 'waktu_selesai', v_now);
END $$;

-- finalize_pelayanan: signature + grant tetap, isi didelegasikan (menutup jalur FO/admin)
CREATE OR REPLACE FUNCTION public.finalize_pelayanan(p_tiket_id uuid, p_form_type text, p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN RETURN public.layanan_selesai(p_tiket_id, p_form_type, p_payload); END $$;

-- Penjaga transisi di visit (menutup UPDATE langsung via PostgREST)
CREATE OR REPLACE FUNCTION public.guard_visit_transisi_layanan() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF COALESCE(current_setting('lmh.antrean_rpc', true), '') = 'on' THEN RETURN NEW; END IF;
  IF (NEW.status IS DISTINCT FROM OLD.status
        AND (NEW.status IN ('dilayani','selesai') OR OLD.status IN ('dilayani','selesai')))
     OR NEW.waktu_mulai_layan IS DISTINCT FROM OLD.waktu_mulai_layan
     OR NEW.waktu_selesai     IS DISTINCT FROM OLD.waktu_selesai THEN
    RAISE EXCEPTION 'TRANSISI_LEWAT_RPC: gunakan layanan_mulai / layanan_selesai' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_guard_visit_transisi_layanan ON public.visit;
CREATE TRIGGER trg_guard_visit_transisi_layanan BEFORE UPDATE ON public.visit
  FOR EACH ROW EXECUTE FUNCTION public.guard_visit_transisi_layanan();

DROP POLICY IF EXISTS tiket_staff_update ON public.tiket_antrean;   -- tidak ada policy UPDATE pengganti
-- REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE layanan_mulai/layanan_selesai TO authenticated.
```

### 5.4 Dampak ke layar TV dan realtime
- Setiap aksi menghasilkan **2 siaran** `antrean:publik` dengan `status` yang sama: UPDATE dari RPC, lalu UPDATE ulang dari trigger. Layar (`layar/[token]/page.tsx:87-93`, `layar-antrian`, `EstimasiAntrean`) hanya memuat ulang view, jadi aman; bebannya cukup dua kali refetch. Tidak ada perubahan payload (`antrean_broadcast` tidak memuat `dilayani_oleh`, dan ini benar karena tanpa PII).
- `visit` tetap ditulis, sehingga `postgres_changes` di `admin/page.tsx:243` dan `admin/kunjungan/page.tsx:97` tetap menyala. `admin/antrian` mendengarkan `tiket_antrean` (`:107`).
- `v_layar_antrian.nomor_display_dilayani = max(nomor_display)` berbasis teks (lihat viewdef). Bila admin dan petugas melayani bersamaan di satu layanan, hanya satu nomor yang tampil. Ini sudah begitu sejak sebelumnya; perbaikannya di Tahap B (T4).

### 5.5 Tes perilaku yang wajib ada
**Kontrak statis** (`supabase/migrations/tiket_kepemilikan.test.ts`): SECURITY DEFINER + `search_path`; REVOKE PUBLIC/anon, GRANT authenticated; WHERE `status IN ('menunggu'…) AND dilayani_oleh IS NULL`; `dilayani_oleh = v_me.id` di `layanan_selesai`; `FOR UPDATE` pada `visit` muncul **sebelum** UPDATE tiket; `sesi_valid()` dipanggil; `finalize_pelayanan` tidak lagi memuat `'front_office'` dan mendelegasikan; trigger penjaga ada dengan nama flag yang sama di RPC (`set_config(…, true)` lokal); `DROP POLICY tiket_staff_update` tanpa policy UPDATE baru; migrasi **tidak** me-`CREATE OR REPLACE` `sync_visit_dual_write`; idempoten.

**Perilaku DB** (transaksi di-rollback, butuh konfirmasi CEO karena memakai produksi; klaim JWT disimulasikan):
1. Dua sesi `layanan_mulai` serentak pada tiket yang sama: tepat satu `ok`, yang lain `SUDAH_DIAMBIL`. `dilayani_oleh` = pemenang. `visit`/`kunjungan`/`tiket` `dilayani` dengan `waktu_mulai_layan` identik.
2. Klik ganda oleh orang yang sama: panggilan kedua menghasilkan `ok, sudah_milik_anda`. Audit tidak dobel? (catat perilakunya).
3. `layanan_selesai` oleh petugas lain, admin, atau FO: `BUKAN_PEMILIK`, dan tidak ada baris yang berubah.
4. `layanan_selesai` oleh pemilik: tiket/visit/kunjungan `selesai`; `notifikasi` antre (SKM) satu kali; `skm_response_rate.dilayani` +1 satu kali; `audit_log` tercatat; `get_skm_context` → `eligible = true`.
5. Dua `layanan_selesai` serentak oleh pemilik: satu `ok`, satu `INVALID_STATUS`; data `pelayanan_*` tunggal dan terkunci.
6. `finalize_pelayanan` oleh FO ditolak; oleh pemilik berhasil (pembungkus).
7. UPDATE langsung `visit` ke `dilayani`/`selesai` (PostgREST, petugas/admin) ditolak `TRANSISI_LEWAT_RPC`. Check-in scan `terjadwal→menunggu` tetap menerbitkan tiket; Tolak → `batal` tetap jalan.
8. UPDATE langsung `tiket_antrean` oleh admin atau petugas: 0 baris.
9. `tandai_tidak_terlayani_akhir_hari()` tetap mengubah `menunggu` → `tidak_terlayani` dengan penjaga aktif; tiket `dilayani` tidak tersentuh.
10. Tiket sintetis tanpa `legacy_visit_id`: RPC hanya menulis tiket, tanpa error.
11. Divergensi buatan (`visit.status ≠ tiket.status`): `DIVERGENSI` dan rollback total.
12. `sesi_valid()` palsu ditolak (setelah A1).
13. Konkurensi `layanan_mulai` dengan scan check-in (baris berbeda) dan dengan job akhir-hari (baris sama): tidak ada deadlock.

**Komponen** (`src/app/admin/antrian/antrian.test.tsx`; tes lama di `:219-311` saat ini menegaskan `from('visit').update`, jadi harus ditulis ulang): tombol memanggil RPC; tombol terkunci selama request; `SUDAH_DIAMBIL` memunculkan pesan "Tiket ini sudah ditangani petugas lain" dan memuat ulang; tombol "Selesai"/"Form Pendataan" tidak tampil bila `dilayani_oleh ≠ saya`. Route `api/admin/pelayanan/[tiketId]` memetakan `BUKAN_PEMILIK` ke 403 dan `SUDAH_DIAMBIL`/`INVALID_STATUS` ke 409.

---

## 6. Tempat yang berubah

### 6.1 Tahap A (berkas:baris)
| Berkas | Perubahan |
|---|---|
| `supabase/migrations/2026101300NN_tiket_kepemilikan.sql` (baru) + `tiket_kepemilikan.test.ts` + `docs/rollback-tiket-kepemilikan-<ts>.sql` | `layanan_mulai`, `layanan_selesai`, pembungkus `finalize_pelayanan`, `guard_visit_transisi_layanan` + trigger, `DROP POLICY tiket_staff_update`, (opsional) backfill `dilayani_oleh` untuk tiket `dilayani` yang masih terbuka (7.3). Rollback: drop fungsi/trigger baru, pulihkan `finalize_pelayanan` dari `202610010001:117-292`, buat ulang `tiket_staff_update` dari `202607290013:143-144`. |
| `src/app/admin/antrian/page.tsx:146-153` | select menambah `dilayani_oleh` (+ nama petugas) |
| `src/app/admin/antrian/page.tsx:213-240` (`handleMulaiLayanan`) | `rpc('layanan_mulai', { p_tiket_id })` menggantikan `from('visit').update`; tangani `SUDAH_DIAMBIL`/`sudah_milik_anda` |
| `src/app/admin/antrian/page.tsx:242-263` (`handleSelesaikan`) | `rpc('layanan_selesai', { p_tiket_id })` untuk layanan tanpa pendataan |
| `src/app/admin/antrian/page.tsx:652-659, 663-680` | kunci tombol selama request; "Selesai"/"Form Pendataan" hanya untuk pemilik; `aria-live` |
| `src/app/admin/antrian/page.tsx:641-651` | "Lengkapi Data" saat `menunggu`: keputusan 7.5 |
| `src/app/admin/antrian/antrian.test.tsx:116-143, 219-311` | mock dan asersi ditulis ulang ke RPC |
| `src/app/api/admin/pelayanan/[tiketId]/route.ts:401-428` | `rpc('layanan_selesai', …)` (atau tetap `finalize_pelayanan` yang kini pembungkus) + pemetaan error baru |
| `src/app/api/admin/pelayanan/[tiketId]/route.ts:173-321` (PATCH draf) | cek pemilik bila diputuskan (7.5) |
| `src/lib/pelayanan.ts:38-47` | helper baru `bolehSelesaikanTiket(staff, tiket)` (pemilik) di samping `canAccessPelayananStaff` |
| `src/lib/types/pelayanan.ts` | `PelayananInitialData` + `dilayani_oleh` |
| `src/components/admin/PelayananWizardModal.tsx:334-…` | tangani 403 `BUKAN_PEMILIK` / 409; mode baca saja untuk non-pemilik |
| `docs/analysis/04-RBAC-MATRIX*.md`, `docs/analysis/DB-CHANGES.md`, `docs/MIGRATIONS.md` | catat aturan pemilik dan pencabutan `tiket_staff_update` |

### 6.2 HARUS menunggu Tahap B / WP-24 (B9)
Bukan hanya 7 titik tulis. **Pembaca dan job yang bergantung pada `visit` juga harus dipindah sebelum trigger dimatikan**, kalau tidak sistem rusak diam-diam:
- **Titik tulis:** `src/app/api/checkin/route.ts:87-105` (+ lookup duplikat `:114-118`), `src/app/checkin/page.tsx:185-196`, `src/components/WalkinWizard.tsx:125-136`, `src/app/admin/scan/page.tsx:207-213` (+ lookup `:69-79`), `src/app/me/reservasi/page.tsx:240-244`; blok sinkron `visit` di `layanan_mulai`/`layanan_selesai` (Tahap A) dan cabang `visit` `finalize_pelayanan`.
- **Job cron yang menulis `visit`:** `tandai_tidak_terlayani_akhir_hari` (`202607300017:12-31`) dan `tandai_reservasi_no_show` (`202608310002:15-34`). Setelah trigger mati, keduanya **tidak lagi mengubah tiket/kunjungan**, sehingga tiket `menunggu` tidak pernah menjadi `tidak_terlayani` dan rekap salah.
- **Pembaca DB:** `get_skm_context`, `submit_skm_response` (SKM via `visit.qr_token` + `status='selesai'`), `notify_visit_selesai`, `notify_reservasi_confirmed`, `trg_visit_selesai_rr`, `trg_audit_visit_status` (dipindah ke `tiket_antrean`/`kunjungan`), `mv_estimasi_layanan` (viewdef membaca `visit`), `metrik_kepatuhan`, `jumlah_terdaftar`, `trg_guard_visit_layanan_buka`/`trg_visit_qr_hangus` (pindah ke jalur check-in baru).
- **Pembaca app:** `src/app/me/page.tsx:102-108`, `src/app/api/admin/pelayanan/[tiketId]/route.ts:92-102`, realtime `src/app/admin/page.tsx:243` dan `src/app/admin/kunjungan/page.tsx:97`.
- **Lainnya:** status `dipanggil`/`dikembalikan`/`dialihkan`, `admin_ambil_alih`/`admin_alihkan` (kecuali dimajukan, lihat 7.2), perbaikan layar TV (T4), dan pencabutan `kunjungan_staff_update` (status kunjungan masih bisa diubah langsung oleh staf, `202610090001:239-242`).

---

## 7. Keputusan yang direkomendasikan

1. **Arah tulis Tahap A = Opsi 1.** RPC `layanan_mulai`/`layanan_selesai` menulis `tiket_antrean` sebagai sumber kebenaran (guard atomik + `dilayani_oleh`), lalu baris `visit` terkait (`legacy_visit_id`) dalam satu transaksi dengan nilai identik. Kunci `visit` diambil lebih dulu. `trg_visit_dual_write` **tidak diubah**. WP-24 **tidak dimajukan**.
2. **Tutup jalur pintas di DB dalam migrasi yang sama:** cabut `tiket_staff_update`, tambahkan trigger penjaga transisi `visit` (flag `lmh.antrean_rpc`), dan jadikan `finalize_pelayanan` pembungkus `layanan_selesai`. Tanpa ini, aturan "hanya pemula yang boleh menyelesaikan" bisa dilewati lewat PostgREST.
3. **Tidak memperkenalkan status `dipanggil`** di Tahap A. `panggil_tiket` dibiarkan. Event `nomor_dipanggil` dicatat sebagai mati dan ditangani di Tahap B (T4).
4. **Penerapan:** di luar jam layanan dan saat tidak ada tiket `dilayani` hari itu (pola Gerbang G.6). Klien yang masih membuka halaman lama akan menerima error `TRANSISI_LEWAT_RPC` dan harus memuat ulang. Beri tahu petugas.
5. **Catat di Tahap B (WP-24):** daftar 6.2 menjadi checklist cutover, terutama dua job cron dan SKM. Keduanya akan rusak diam-diam bila hanya trigger yang dimatikan.

### 7.1–7.5 Butir yang butuh keputusan CEO sebelum A3
| # | Pertanyaan | Bukti | Usul |
|---|---|---|---|
| 7.1 | Bolehkah **admin** memulai (dan jadi pemilik) tiket layanan? Spec §4.6 hanya menyebut "layanan petugas". | Admin memulai **219 dari 444** layanan dalam 90 hari [TERBUKTI] | Izinkan admin memulai di Tahap A agar operasi tidak putus; FO ditolak. Tinjau ulang di Tahap B. |
| 7.2 | Jalur darurat untuk tiket yang pemiliknya pergi atau tidak aktif | 8 tiket diselesaikan oleh orang berbeda; 1 tiket `dilayani` macet sejak 2026-10-05 | Majukan versi minimal `admin_ambil_alih(tiket, alasan)` + `audit_log` ke Tahap A, **atau** terima risiko tiket macet sampai Tahap B. |
| 7.3 | Tiket `dilayani` lama dengan `dilayani_oleh` NULL (saat ini 2) | data produksi | Backfill dari `audit_log` (aktor transisi `dilayani` terakhir → `petugas.id`) dalam migrasi untuk tiket terbuka saja. Backfill historis untuk rekap (nama petugas kosong pada 451 tiket) sebagai keputusan terpisah karena menulis data produksi. |
| 7.4 | Bagaimana DB tahu layanan wajib pendataan? Kini by-name di TS (`src/lib/pelayanan.ts:13-18`), dan `finalize_pelayanan` mempercayai `p_form_type` dari klien | kode | Tambah kolom `layanan.form_pendataan` (`oss`/`perizinan`/NULL), backfill sesuai `determineFormType`, lalu `layanan_selesai` menolak `p_form_type` yang tidak cocok. Bisa juga ditunda ke Tahap C (K11). |
| 7.5 | Draf pendataan: boleh diisi sebelum "Mulai" (tombol "Lengkapi Data") dan oleh staf selain pemilik? | 8 draf pada tiket `tidak_terlayani` | Setelah `dilayani`, hanya pemilik yang boleh menulis draf. Sebelum mulai, nonaktifkan "Lengkapi Data" agar draf selalu milik orang yang melayani. |

## 8. Hal yang tidak pasti

- **[DUGAAN] Deadlock** antara RPC baru dan jalur lama bila urutan kunci tidak diikuti. Argumennya mekanisme standar dan belum diuji. Tes 13 harus membuktikannya.
- **[DUGAAN] Flag `lmh.antrean_rpc` tidak bisa diset klien lewat PostgREST.** Asumsi ini sama dengan `lmh.koreksi` yang sudah dipakai (`202610090001:75-77`), tetapi belum diuji khusus. Jangan pernah mengekspos fungsi pembungkus `set_config` di skema `public`.
- **[TIDAK DIUJI]** Klaim `session_id` di JWT dan `sesi_valid()` (A1) belum ada di produksi (fungsi dan tabel `sesi_staf` tidak ditemukan). `layanan_mulai`/`layanan_selesai` bergantung pada A1.
- **[TIDAK DIKETAHUI]** Aktor `system` (3 mulai, 5 selesai) di `audit_log` berarti `auth.uid()` NULL, kemungkinan skrip verifikasi atau koneksi langsung. Trigger penjaga akan menolak jalur seperti itu kecuali skrip menyalakan flag. Pastikan skrip `selftest-*`/`verify-*` tidak bergantung pada UPDATE langsung.
- **[DUGAAN]** Dua broadcast per aksi tidak mengganggu layar. Belum diamati langsung di TV; risikonya hanya beban refetch.
- **[TIDAK DIUJI]** Perilaku `useRealtimeRefetch` pada halaman lain yang mendengarkan `visit` setelah urutan tulis berubah (tiket dulu, lalu visit). Diperkirakan tidak berubah karena `visit` tetap ditulis.
- 11 transisi `dilayani` ganda terbukti berasal dari aktor yang sama. **Race oleh dua staf berbeda belum pernah teramati di data**; yang terbukti adalah bahwa tidak ada guard yang mencegahnya (4A).
- Data di bagian ini adalah potret 2026-10-13. Jumlah tiket, status, dan audit akan berubah, jadi ulangi kueri read-only sebelum migrasi diterapkan.
