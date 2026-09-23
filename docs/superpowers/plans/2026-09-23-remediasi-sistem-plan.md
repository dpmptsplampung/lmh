# Rencana Teknis Remediasi Sistem LMH (Lampung Maju Hub)

> Tanggal: 2026-09-23 · Status: **DRAFT — menunggu persetujuan owner** · Basis: audit read-only terhadap commit `aa09f37`
>
> Dokumen ini adalah rencana kerja untuk menghilangkan akar masalah yang membuat sistem terasa "statis" (harus refresh), pesan chat dobel, rekapitulasi tidak lengkap, dan sejumlah fitur yang tidak berjalan sesuai spesifikasi. Setiap tugas mencantumkan berkas yang terdampak, bukti temuan, langkah, test yang wajib ada, dan kriteria selesai.

---

## 0. Ringkasan eksekutif

**Akar masalah (5 kelas):**

| # | Kelas masalah | Dampak yang dirasakan pengguna | Bukti utama |
|---|---|---|---|
| A | Jalur realtime hanya ada untuk chat, dan itupun rapuh (siaran per-request dari serverless, timeout 3 dtk, tanpa fallback di sisi pengunjung) | Chat harus refresh; pesan dobel; status "diambil alih" tidak terlihat | `src/app/api/chat/messages/route.ts:18-45`, `src/app/chat/page.tsx:325-360, 530, 563-571` |
| B | Halaman lain memuat data sekali saat dibuka; tabel antrean tidak dipublikasikan ke realtime; estimasi mendengarkan tabel yang salah | Antrean, layar TV, dashboard, estimasi terasa "mati" | `src/components/EstimasiAntrean.tsx:106-110`, `src/app/admin/antrian/page.tsx:91-93`, migrasi `202608080001` hanya untuk chat |
| C | Rekap: typo nama field, join yang belum terverifikasi, batas 1.000 baris PostgREST, rollup yang tidak bisa dipanggil dari UI, CSV tanpa escaping | Unduhan rekap kosong/terpotong/rusak | `src/lib/rekap/query.ts:28-29` vs `excel.ts:73`; `202607300020_wp30_rekap_harian.sql:101-102` vs `admin/rekap/page.tsx:166`; `admin/rekap/page.tsx:131-148` |
| D | Aturan akses (RLS) tidak sinkron dengan kode: FO tidak bisa melihat chat; petugas non-admin gagal menulis pesan sistem tanpa error | Fitur terlihat ada tetapi diam-diam gagal | `202607140004_security_and_automation.sql:664-679`, `src/app/admin/chat/page.tsx:414-419, 442-446` |
| E | Proses: 41/78 file test memalsukan Supabase; tidak ada test integrasi/E2E; migrasi tidak idempoten; ledger DB produksi berhenti 30 Jul; STATUS.md mengklaim semua selesai | Test hijau, fitur rusak; tidak diketahui migrasi mana yang terpasang | `npm test` 620/620 lolos; `docs/analysis/DB-CHANGES.md`; `docs/STATUS.md` |

**Strategi:** perbaiki fondasi dulu (verifikasi produksi + staging), lalu chat, lalu rekap, lalu realtime antrean, dengan jalur kualitas (test integrasi, E2E, CI) berjalan paralel sejak Fase 0. Semua perubahan **aditif**, bermigrasi, diuji terhadap database nyata di staging sebelum produksi.

**Prinsip yang mengikat semua tugas:**
1. Satu sumber kebenaran untuk data yang tampil: setiap pesan/tiket masuk ke state UI lewat **satu fungsi `upsert`** yang berkunci pada `id` server — bukan lewat 3 jalur berbeda.
2. Tidak ada `catch {}` kosong. Semua kegagalan dilaporkan ke logger (`src/lib/observability/logger.ts`) dan, bila relevan, ke pengguna (toast).
3. Tidak ada query daftar tanpa `.range()`/paginasi eksplisit; ekspor selalu dilakukan di server dan mengiterasi seluruh halaman.
4. Setiap migrasi idempoten (aman dijalankan dua kali) dan tercatat di ledger DB.
5. Fitur dianggap selesai hanya jika lolos test integrasi terhadap Supabase nyata **dan** skenario UAT di §9.

---

## 1. Tata kelola, urutan, dan estimasi

| Fase | Isi | Prasyarat | Estimasi (2 dev + 1 QA) |
|---|---|---|---|
| 0 | Stabilisasi & verifikasi produksi, staging, freeze | Akses DB produksi (read-only) & Supabase Dashboard | 2–3 hari |
| 1 | Live chat realtime yang benar | Fase 0 | 6–8 hari |
| 2 | Rekapitulasi & ekspor lengkap | Fase 0 | 5–7 hari (paralel dgn Fase 1 jika 2 dev) |
| 3 | Realtime antrean/layar/estimasi/dashboard + idempotensi | Fase 0, pola dari Fase 1 | 6–9 hari |
| 4 | Kualitas & proses (integrasi, E2E, CI, migrasi, dokumentasi) | Dimulai Fase 0, selesai bersama Fase 3 | 6–8 hari (paralel) |
| 5 | Hardening lanjutan (backlog) | Fase 1–4 | Sesuai prioritas |
| 1b | Bot auto-balas tanpa ketergantungan satu vendor (lihat §13) | Fase 0 | 4–6 hari (paralel dgn Fase 1) |
| 2b | Dashboard FO yang bisa bertindak + CMS konten yang layak (lihat §14) | Fase 0; pola API dari Fase 1 | 10–14 hari |

Total realistis **8–10 minggu kalender** (5–7 minggu untuk Fase 0–4, +3 minggu untuk Fase 1b & 2b). Angka ini estimasi, bukan komitmen; direvisi setelah Fase 0 karena hasil inventaris produksi bisa menambah pekerjaan. Peta "seberapa dinamis" setiap fitur sebelum/sesudah ada di §15.

**Aturan kerja selama remediasi**
- Freeze fitur baru sampai Fase 3 selesai (kecuali disetujui owner).
- Semua perubahan lewat Pull Request ke `development`, wajib 1 reviewer, CI hijau (lint, typecheck, unit, **integrasi**, build). Deploy ke staging otomatis dari `development`; ke produksi dari `main` dengan tag rilis.
- Setiap PR mencantumkan ID temuan (mis. `A-1`) dari matriks §8.

---

## 2. Fase 0 — Stabilisasi & verifikasi produksi

### 0.1 Inventaris database produksi (read-only)
Jalankan di SQL editor produksi dan simpan hasilnya ke `docs/analysis/DB-CHANGES.md` sebagai entri baru "Inventaris 2026-09":

```sql
-- Tabel yang dipublikasikan ke realtime
SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1;
-- Cron aktif (rollup rekap, no-show, dll.)
SELECT jobname, schedule, active FROM cron.job ORDER BY 1;
SELECT jobname, status, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 50;
-- Kolom/objek penanda migrasi pasca 30 Jul
SELECT column_name FROM information_schema.columns WHERE table_name='chat_pesan' AND column_name='client_uuid';
SELECT proname FROM pg_proc WHERE proname IN ('finalize_pelayanan','rollup_rekap_harian','catat_pulang');
SELECT relname, relreplident FROM pg_class WHERE relname IN ('chat_sesi','chat_pesan','tiket_antrean');
-- Kebijakan RLS aktual
SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' ORDER BY 1,2;
-- Batas baris PostgREST (Dashboard → API Settings → Max rows) dicatat manual
```

Cocokkan dengan 45 berkas di `supabase/migrations/`. Keluaran: tabel "terpasang / belum" per migrasi. **Semua yang belum terpasang menjadi tugas Fase 1–3, bukan langsung dieksekusi.**

### 0.2 Lingkungan staging
- Buat project Supabase kedua (`lmh-staging`) atau gunakan Supabase Branching. Terapkan **seluruh** migrasi dari nol + `seed.sql` + `seed-demo.sql`. Kegagalan di sini = bukti migrasi tidak idempoten/urutan salah → catat sebagai tugas Fase 4.
- Deploy Vercel preview yang mengarah ke staging (env terpisah via Doppler config `stg`).
- Muat ulang schema cache PostgREST setelah migrasi (`NOTIFY pgrst, 'reload schema'`).

### 0.3 Verifikasi hipotesis yang masih "dugaan"
Di staging, jalankan dan catat hasilnya:
1. `GET /rest/v1/tiket_antrean?select=id,pelayanan_oss:tiket_id(*),pelayanan_perizinan:tiket_id(*)&limit=1` — apakah PostgREST menerima sintaks join `alias:kolom_fk(*)` untuk relasi one-to-one dari sisi induk? Jika error PGRST200, tab "Rekap Per Layanan" saat ini gagal total di produksi.
2. Kirim 5 pesan chat cepat berturut-turut dari pengunjung → hitung baris di layar vs baris di `chat_pesan`.
3. Login sebagai `front_office` → buka `/admin/chat` → daftar sesi kosong? (dugaan: ya).
4. Klik "Rollup Hari Ini" di `/admin/rekap` → error 42501 permission denied? (dugaan: ya).

### 0.4 Backup & rollback
- Snapshot produksi sebelum migrasi apa pun (`docs/BACKUP_RESTORE.md`), tetapkan RPO/RTO yang saat ini masih "TBD".

**Kriteria selesai Fase 0:** ledger inventaris tersimpan; staging identik dengan produksi + migrasi tertinggal; keempat hipotesis §0.3 terjawab; keputusan owner §11 didapat.

---

## 3. Fase 1 — Live Chat realtime yang benar

### Arsitektur target

```
Browser pengunjung ─┐                           ┌─ Browser petugas/admin/FO
                    │  POST /api/chat/messages   │
                    └──────────► Next.js API ◄───┘  (validasi, otorisasi, tulis DB)
                                     │ INSERT chat_pesan / UPDATE chat_sesi
                                     ▼
                              Postgres trigger ──► realtime.broadcast_changes('chat:sesi:<id>')
                                                          │
                     ◄────── Supabase Realtime (private channel, RLS realtime.messages) ──────►
                     kedua browser menerima event yang sama, di-upsert berdasarkan id server
                     + polling cadangan 5 dtk (GET /api/chat/messages?since=<cursor>)
```

Keuntungan: siaran dilakukan **oleh database**, bukan oleh fungsi serverless yang harus membuka websocket per permintaan (sumber timeout 3 dtk dan pesan hilang). Semua peristiwa (pesan baru, ganti status, ambil alih, tutup) lewat satu kanal.

> Alternatif minimal (jika `realtime.broadcast_changes` tidak tersedia di plan Supabase yang dipakai): gunakan `postgres_changes` pada `chat_pesan` (filter `sesi_id=eq.<id>`) dan `chat_sesi` — publikasi sudah disiapkan di migrasi `202608080001`. RLS `chat_pesan_owner_select` sudah memfilter per pemilik. Tetap hapus siaran dari API route.

### Tugas

**A-1. Migrasi `2026MMDDHHMM_chat_broadcast_trigger.sql`**
- Fungsi trigger `public.chat_broadcast()` (SECURITY DEFINER) yang memanggil `realtime.broadcast_changes(topic := 'chat:sesi:' || COALESCE(NEW.sesi_id, NEW.id)::text, event := TG_OP, operation := TG_OP, table_name := TG_TABLE_NAME, schema_name := TG_TABLE_SCHEMA, new := NEW, old := OLD)`.
- Trigger `AFTER INSERT ON chat_pesan` dan `AFTER UPDATE OF status, ditangani_oleh ON chat_sesi`.
- Policy pada `realtime.messages` (SELECT, `TO authenticated`): topik `chat:sesi:<id>` boleh dibaca jika pemanggil pemilik sesi (`pengunjung.auth_user_id = auth.uid()`), atau `get_my_role() IN ('admin','front_office')`, atau `layanan_id = get_my_layanan_id()`.
- Semua `CREATE` dibungkus `DROP ... IF EXISTS` / `CREATE OR REPLACE`; publikasi tetap dipertahankan untuk kompatibilitas.

**A-2. Idempotensi pesan di database**
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_pesan_client_uuid ON chat_pesan(sesi_id, client_uuid) WHERE client_uuid IS NOT NULL;` (indeks non-unik yang ada di `202607280004` diganti).
- POST `/api/chat/messages`: gunakan `insert ... onConflict('sesi_id,client_uuid') ignoreDuplicates` lalu `select` baris yang ada → kirim ulang oleh klien (retry jaringan, klik ganda) tidak pernah menghasilkan baris kedua. Kembalikan `201` untuk baru, `200` untuk duplikat.

**A-3. Hapus siaran dari API route**
- Hapus `broadcastNewMessage` dan pemanggilnya di `src/app/api/chat/messages/route.ts` dan `src/app/api/chat/ai/route.ts`. Perbarui `messages.test.ts` (test urutan subscribe→send dihapus, diganti test idempotensi).

**A-4. Hook bersama `useChatThread(sesiId)` di `src/lib/chat/useChatThread.ts`**
- State: `Map<id, Message>` + daftar optimistic `Map<client_uuid, Message>`.
- Satu fungsi `upsert(msg)`: jika `msg.client_uuid` cocok dengan optimistic → ganti; jika `msg.id` sudah ada → abaikan; selain itu tambah. Urutkan berdasarkan `created_at`, lalu `id`.
- Sumber yang memanggil `upsert`: (1) fetch awal, (2) event realtime, (3) polling 5 dtk dengan kursor `since=<created_at terakhir>` (GET perlu parameter `since` baru), (4) respons POST.
- Status sesi disimpan di hook yang sama; event `chat_sesi UPDATE` memicu pesan sistem **hanya sekali** per transisi (simpan `lastStatus`).
- Digunakan oleh `src/app/chat/page.tsx` dan `src/app/admin/chat/page.tsx`; menghapus tiga logika dedup yang berbeda di dua halaman itu.
- Test unit (tanpa mock Supabase, murni reducer): urutan siaran-dulu-HTTP-kemudian, HTTP-dulu-siaran-kemudian, polling tumpang tindih siaran, pesan bot via siaran + HTTP → **selalu 1 baris**.

**A-5. Halaman pengunjung `src/app/chat/page.tsx`**
- Hapus penambahan langsung ke `messages` dari respons POST (`:530`) dan respons `/api/chat/ai` (`:563-571`, `:590-600`); ganti dengan `upsert` dari respons server (yang membawa `id` server).
- Tambah polling cadangan (tidak ada sama sekali saat ini).
- Hapus fallback `LAYANAN_LIST` dengan `id: fallback-*` (menghasilkan sesi dengan `layanan_id` tidak valid); tampilkan pesan error + tombol coba lagi.
- Restorasi sesi dari `localStorage` memakai `GET /api/chat/messages` (bukan query langsung) agar satu jalur.

**A-6. Halaman petugas `src/app/admin/chat/page.tsx`**
- Pesan sistem "diambil alih" / "dikembalikan ke bot" / "sesi ditutup" dan perubahan status dipindahkan ke endpoint baru `POST /api/chat/sesi/[id]/{takeover|return|close}` (service role; cek peran; tulis `chat_pesan` dengan `pengirim='sistem'` + `audit_log`). Menghapus tulisan langsung dari browser yang ditolak RLS untuk petugas non-admin tanpa pemeriksaan error.
- Ganti polling daftar sesi 3 dtk dengan event `chat_sesi`/`chat_pesan` + polling 15 dtk sebagai cadangan; hitung `unread` di server (view `v_chat_sesi_ringkas` dengan `last_message`, `unread_count`) agar tidak mengambil seluruh `chat_pesan` setiap 3 detik.

**A-7. Migrasi `..._chat_rls_front_office.sql`**
- Perluas `chat_sesi_owner_select`, `chat_sesi_petugas_update`, `chat_pesan_owner_select` dengan `OR public.get_my_role() = 'front_office'` (sesuai `202607290009_role_front_office.sql` baris 4 yang menjanjikan takeover FO).
- Tambah nilai `'sistem'` pada constraint `pengirim` bila ada CHECK.

**A-8. Sidebar badge `src/components/layout/Sidebar.tsx`**
- Berlangganan kanal yang sama; hitung eskalasi via view ringkas.

**Test wajib Fase 1**
- Unit: reducer `useChatThread` (≥ 8 skenario urutan).
- Integrasi (staging/lokal, lihat Fase 4): insert `chat_pesan` → event diterima klien `authenticated` pemilik sesi dalam < 2 dtk; klien lain (bukan pemilik) **tidak** menerima; FO menerima.
- E2E Playwright (`e2e/chat.spec.ts`): dua konteks browser (pengunjung Google-mock / petugas), 10 pesan bolak-balik, tanpa reload: jumlah elemen pesan di kedua sisi = 10 + pesan sistem; latensi p95 < 3 dtk; simulasi `page.route` gagal untuk websocket → polling tetap menampilkan pesan ≤ 6 dtk.

**Kriteria selesai Fase 1:** skenario UAT §9.1 lolos di staging oleh QA + owner; tidak ada `broadcastNewMessage` di kode; 0 `catch {}` kosong di berkas chat.

---

## 4. Fase 2 — Rekapitulasi & ekspor lengkap

**C-1. Perbaiki typo `pelayanan_perizinAN` → `pelayanan_perizinan`**
- Berkas: `src/lib/rekap/excel.ts`, `src/app/api/admin/rekap/export/route.ts`, `src/app/api/admin/rekap/tickets/route.ts`, `src/components/admin/RekapTiketDetailPanel.tsx`, `src/components/admin/RekapLayananTable.tsx`, semua `*.test.ts(x)` terkait, `docs/superpowers/specs/2026-09-01-rekap-layanan-design.md`, `docs/superpowers/plans/2026-09-01-rekap-layanan-plan.md`.
- Tambah test kontrak: kunci pada respons PostgREST nyata (fixture dari §0.3) harus sama dengan kunci yang dibaca kode (`Object.keys(fixture[0])` ⊇ kunci yang dipakai).

**C-2. Sintaks join yang pasti**
- Ganti `pelayanan_oss:tiket_id(*)` → `pelayanan_oss(*)` dan `pelayanan_perizinan:tiket_id(*)` → `pelayanan_perizinan(*)`: hanya ada satu FK (`tiket_id UNIQUE`), jadi tanpa ambiguitas dan PostgREST mengembalikan **objek** (to-one). Normalisasi defensif: jika array, ambil elemen pertama.
- Verifikasi di staging dengan `curl` dan simpan responsnya sebagai fixture `src/test/fixtures/rekap-tickets.postgrest.json`.

**C-3. Ekspor tanpa batas diam-diam**
- `buildTicketsQuery` menerima `from/to`; endpoint ekspor mengiterasi `range(i*1000, i*1000+999)` sampai halaman < 1000 atau mencapai `MAX_ROWS` (naikkan ke 100.000, gunakan `ExcelJS.stream.xlsx.WorkbookWriter` untuk memori rendah).
- Alternatif lebih cepat: fungsi SQL `rekap_tiket_export(p_layanan uuid, p_dari date, p_sampai date, p_q text)` `RETURNS TABLE` (flatten kolom OSS+Perizinan) dipanggil via `.rpc()` dengan iterasi `range` yang sama.
- Header `X-Rekap-Truncated` tetap; UI (`RekapLayananTable.tsx:120`) sudah menampilkannya — pastikan pesan juga muncul sebagai toast.
- Nama berkas menyertakan jumlah baris.

**C-4. Cakupan data ekspor (keputusan owner, lihat §11)**
- Tambah parameter `status=selesai|semua` (default `selesai` untuk kompatibilitas). Tambah kolom "Status Tiket" di Excel supaya pembaca tahu apa yang tercakup.
- Zona waktu: semua kolom waktu diformat `Asia/Jakarta` (`src/lib/rekap/format.ts` sudah; tambah test untuk 00:00–06:59 WIB).

**C-5. Tab Umum: rollup yang bisa dijalankan admin**
- Endpoint `POST /api/admin/rekap/rollup` body `{dari, sampai}` (admin/FO; service role; loop per tanggal memanggil `rollup_rekap_harian`; catat `audit_log`). UI memanggil endpoint ini, bukan `rpc` dari browser (yang selalu 42501).
- Health check cron: endpoint `GET /api/health/ready` menambahkan `rekap_last_rollup_at` (dari `MAX(updated_at)`), alarm jika > 26 jam.
- Tambah `total_batal` ke CSV dan UI; tambah tombol "Isi ulang rentang" untuk hari yang terlewat cron.

**C-6. Tab OSS & Perizinan**
- Paginasi server (`range` + `count:'exact'`, 50/halaman) di UI; ekspor dipindah ke server (`GET /api/admin/rekap/export?format=csv&tab=oss|perizinan`) dengan iterasi penuh, `Content-Type: text/csv; charset=utf-8` + BOM.
- Util bersama `src/lib/csv.ts` (`toCsv(rows, columns)`, escaping RFC 4180: kutip ganda, koma, baris baru) dipakai juga oleh `admin/antrian` daftar hadir.
- Hapus `actor_role: 'admin'` hardcoded pada `audit_log` (`admin/rekap/page.tsx:220`) — gunakan peran nyata dari server.

**C-7. Rekap absensi (`src/app/admin/antrian/page.tsx:285-330`)**
- Query dari `petugas` LEFT JOIN `absensi_petugas` agar petugas tanpa absensi tetap tampil sebagai "Alpa/Belum absen".

**Test wajib Fase 2**
- Unit: `toCsv` (nilai dengan koma, kutip, baris baru, `null`), `rowToCells` dengan fixture nyata OSS & Perizinan → kolom `[Perizinan]` terisi.
- Integrasi: seed 1.250 tiket selesai di staging → ekspor Excel berisi 1.250 baris (bukan 1.000); rollup rentang 3 hari mengisi 3 baris per layanan.
- E2E: unduh Excel dari UI, parse dengan `exceljs`, assert jumlah baris dan kolom Perizinan tidak kosong.

**Kriteria selesai Fase 2:** UAT §9.2 lolos; tidak ada query daftar tanpa `range` di `src/app/admin/rekap/**` dan `src/app/api/admin/rekap/**`.

---

## 5. Fase 3 — Realtime antrean, layar, estimasi, dashboard + idempotensi

**B-1. Migrasi `..._antrean_realtime.sql`**
- Trigger `AFTER INSERT OR UPDATE ON tiket_antrean` → `realtime.broadcast_changes('antrean:layanan:' || NEW.layanan_id, ...)` dengan payload **tanpa PII** (`id, nomor_display, status, waktu_*`, tanpa nama pengunjung) untuk kanal **publik** (layar TV & estimasi tidak login), plus topik `antrean:admin:<layanan_id>` privat untuk halaman petugas (RLS `realtime.messages`: staff layanan/admin/FO).
- Idempoten: `DO $$ ... IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='tiket_antrean') THEN ALTER PUBLICATION ... END IF; END $$;` bila publikasi juga diperlukan.

**B-2. Klien**
- `src/components/EstimasiAntrean.tsx`: berhenti mendengarkan `visit`; berlangganan `antrean:layanan:*` (atau satu topik `antrean:publik`) + polling 60 dtk.
- `src/app/layar/[token]/page.tsx`, `src/app/layar-antrian/page.tsx`: kanal publik; polling turun ke 15 dtk sebagai cadangan; `catch(() => {})` pada `getSiteSettings` diganti log + teks default.
- `src/app/admin/antrian/page.tsx`, `src/app/admin/page.tsx`, `src/app/admin/kunjungan/page.tsx`: hook bersama `useRealtimeRefetch(topic, refetch, {pollMs})` dengan debounce 500 ms dan `AbortController` untuk membatalkan fetch lama saat filter berubah.

**B-3. Konkurensi "panggil berikutnya"**
- RPC `panggil_tiket_berikutnya(p_layanan_id uuid, p_petugas_id uuid)`: `SELECT ... WHERE status='menunggu' ORDER BY nomor FOR UPDATE SKIP LOCKED LIMIT 1` → update status + `dilayani_oleh` → kembalikan tiket. Aksi "Mulai layani tiket X" memakai `UPDATE ... WHERE id = X AND status = 'menunggu'` dan menampilkan "Tiket sudah dilayani petugas lain" jika 0 baris.

**B-4. Idempotensi check-in**
- Kolom `client_request_id uuid` + `UNIQUE` pada `kunjungan` (dan `visit` selama dual-write). `POST /api/checkin` menerima header `Idempotency-Key`; antrean offline (`src/lib/offline/queue.ts`) menyimpan kunci yang sama sehingga replay tidak menggandakan tiket.

**B-5. Service worker `public/sw.js`**
- Kecualikan `/api/**` dan semua permintaan non-navigasi dinamis dari cache (`no-store` sudah dihormati untuk route `force-dynamic`, tetapi halaman admin yang di-fetch klien belum semua). Naikkan `CACHE_VERSION` agar cache lama terhapus.

**B-6. Pengaduan**
- `src/app/api/admin/pengaduan/route.ts:45`: ganti `.limit(100)` dengan `range` + `count`; UI paginasi.

**Test wajib Fase 3**
- Integrasi: insert tiket → event diterima klien anon pada topik publik dalam < 2 dtk, payload tidak mengandung `nama`.
- Integrasi konkurensi: 20 pemanggilan paralel `panggil_tiket_berikutnya` → 20 tiket berbeda, tidak ada duplikat.
- E2E: dua tab petugas; tab A "Mulai layani" → tab B berubah tanpa reload ≤ 3 dtk; klik ganda check-in → 1 tiket.

**Kriteria selesai Fase 3:** UAT §9.3 lolos; tidak ada `postgres_changes` yang mengarah ke tabel di luar publikasi (test statis: parse `table:` di `src/**` vs daftar publikasi di migrasi).

---

## 6. Fase 4 — Kualitas & proses (paralel)

**E-1. Harness integrasi terhadap Supabase nyata**
- `supabase start` (Docker) di CI job `integration`: terapkan semua migrasi + seed demo, jalankan `vitest --project integration` (berkas `*.int.test.ts`) yang memakai `@supabase/supabase-js` ke `http://127.0.0.1:54321` dengan JWT peran nyata. Termasuk `scripts/run-rls-tests.mjs` (saat ini tidak pernah dijalankan CI).
- Fixture PostgREST ditangkap otomatis (`scripts/capture-fixtures.mjs`) dan dipakai unit test — menutup celah "mock tidak sama dengan kenyataan".

**E-2. E2E Playwright**
- `e2e/` dengan 4 alur: chat dua sisi, ekspor rekap, antrean dua tab, check-in ganda. Berjalan di CI terhadap staging pada PR ke `main`.

**E-3. Kebersihan migrasi**
- Audit 45 berkas: semua `CREATE POLICY` didahului `DROP POLICY IF EXISTS`; `ALTER PUBLICATION ADD TABLE` dibungkus pemeriksaan `pg_publication_tables`; `cron.schedule` dijaga `WHERE NOT EXISTS`. Test statis `supabase/migrations/migration-idempotency.test.ts` menolak pola tanpa guard.
- Ledger: `docs/analysis/DB-CHANGES.md` wajib entri per migrasi yang diterapkan (tanggal, siapa, hasil verifikasi). Tambah `supabase migration list` ke runbook.

**E-4. Standar penanganan error**
- ESLint `no-empty` (`allowEmptyCatch: false`) + aturan kustom melarang `catch {}` tanpa `reportError`. Helper `src/lib/observability/reportError.ts` (logger + toast opsional). Migrasi bertahap: chat & rekap di Fase 1–2, sisanya Fase 4.

**E-5. CI/CD**
- `ci.yml`: tambah job `integration` (Docker) dan `e2e` (staging). `supabase db push` ke staging otomatis dari `development` setelah CI hijau; ke produksi manual dengan persetujuan (GitHub Environments) — tetap memakai akun DPMPTSP sesuai `AGENTS.md`.
- Smoke pasca-deploy: `/api/health/ready` mencakup realtime (uji kirim/terima 1 event) dan rollup terakhir.

**E-6. Dokumentasi jujur**
- `docs/STATUS.md`: ganti klaim "semua selesai" dengan tabel status per fitur (Berfungsi / Terbatas / Rusak) + tautan temuan. `docs/PRODUCTION_READINESS.md` dan `docs/TESTING.md` disinkronkan dengan harness baru. `README.md` memperbarui daftar migrasi (bukan "5 baseline").

---

## 7. Fase 5 — Backlog hardening (setelah Fase 1–4)
- Hapus dual-write `visit` (WP-24) setelah 2 minggu stabil dengan realtime baru.
- Rate-limit realtime & ukuran payload; observabilitas kanal (jumlah subscriber, drop).
- Verifikasi rencana audit pendataan 31 Agustus (`docs/superpowers/plans/2026-08-31-pendataan-audit-fix-plan.md` — semua checkbox masih kosong).
- Uji beban: 50 pengunjung chat simultan; 200 check-in/jam.
- Tinjau ketergantungan berat di serverless (`canvas`, `sharp`, `pdfjs-dist`) — ukur cold start & memori.

---

## 8. Matriks temuan → tugas

| ID | Temuan (bukti) | Tugas | Fase |
|---|---|---|---|
| A-1 | Siaran per-request dari serverless, timeout 3 dtk → pesan hilang (`messages/route.ts:18-45`) | A-1, A-3 | 1 |
| A-2 | Pesan pengunjung & bot dobel: siaran tiba sebelum respons HTTP (`chat/page.tsx:325-360, 530, 563`) | A-2, A-4, A-5 | 1 |
| A-3 | Tidak ada polling cadangan di sisi pengunjung | A-4, A-5 | 1 |
| A-4 | Pesan sistem ditulis browser, melewati siaran, ditolak RLS untuk petugas (`admin/chat/page.tsx:414-446`) | A-6 | 1 |
| A-5 | Publikasi realtime chat belum terbukti terpasang (`DB-CHANGES.md` berhenti 30 Jul) | 0.1, A-1 | 0–1 |
| D-1 | FO tidak bisa melihat chat (RLS `chat_sesi_owner_select`) | A-7 | 1 |
| C-1 | Typo `perizinAN` → kolom Perizinan kosong | C-1 | 2 |
| C-2 | Join `alias:tiket_id(*)` belum terverifikasi | 0.3, C-2 | 0–2 |
| C-3 | Batas 1.000 baris PostgREST pada semua tab | C-3, C-6 | 2 |
| C-4 | Hanya status `selesai` diekspor | C-4 | 2 |
| C-5 | Rollup hanya `service_role`, UI memanggil dari browser | C-5 | 2 |
| C-6 | CSV tanpa escaping; `actor_role` hardcoded | C-6 | 2 |
| C-7 | Rekap absensi tidak menampilkan petugas tanpa absensi | C-7 | 2 |
| B-1 | `tiket_antrean`/`visit` tidak dipublikasikan; Estimasi mendengarkan `visit` | B-1, B-2 | 3 |
| B-2 | Antrean/dashboard/kunjungan muat sekali | B-2 | 3 |
| B-3 | Dua petugas bisa memanggil tiket yang sama | B-3 | 3 |
| B-4 | Check-in tidak idempoten (klik ganda/offline replay) | B-4 | 3 |
| B-5 | Service worker SWR untuk GET dinamis | B-5 | 3 |
| B-6 | Pengaduan `limit(100)` tanpa paginasi | B-6 | 3 |
| E-1 | 41/78 test mock Supabase; tidak ada integrasi/E2E | E-1, E-2 | 4 |
| E-2 | Migrasi tidak idempoten; ledger berhenti | E-3 | 4 |
| E-3 | `catch {}` kosong tersebar | E-4 | 1–4 |
| E-4 | STATUS.md tidak akurat | E-6 | 4 |
| G-1 | Gemini habis kuota → semua pertanyaan dieskalasi; tidak ada pencocok FAQ tanpa LLM (`api/chat/ai/route.ts:136-155`) | G-1..G-6 | 1b |
| G-2 | 2 panggilan LLM per pesan (embedding + generasi) bahkan untuk FAQ yang cocok persis | G-2, G-4 | 1b |
| G-3 | Embedding 3072-dim tidak bisa diindeks pgvector; terkunci pada satu model vendor | G-3 | 1b |
| F-1 | FO klik "Mulai layani/Selesai" → RLS `visit_update_staff` tanpa FO → 0 baris, toast sukses palsu (`202607140004:657`, `admin/antrian/page.tsx:199-206`) | F-1, F-2 | 2b |
| F-2 | FO "Setujui/Tolak" absensi → RLS `absensi_update_own` tanpa FO → sukses palsu (`202607140004:646`, `admin/absensi/page.tsx:159-190`) | F-1, F-2 | 2b |
| F-3 | FO tidak punya dashboard; `/admin` mengalihkan ke daftar kunjungan baca-saja (`admin/page.tsx:71`) | F-3 | 2b |
| F-4 | Tidak ada aksi edit data operasional (kunjungan, tiket, reservasi) untuk FO/admin | F-4 | 2b |
| F-5 | CMS hanya teks kunci tetap; tidak bisa tambah/hapus kartu layanan, gambar, menu; tanpa draft/preview/versi (`konten_versi` tak dipakai UI) | F-5 | 2b |
| F-6 | Nonaktifkan petugas diizinkan API untuk FO tetapi menu admin-only; `actor_role:'admin'` hardcoded (`api/admin/petugas/status/route.ts:123`) | F-6 | 2b |
| F-7 | Pola sistemik: UPDATE dari browser tanpa cek baris terpengaruh → semua penolakan RLS tampak sukses | F-2, F-7 | 2b |

---

## 9. Skenario UAT untuk owner (non-teknis)

**9.1 Live chat**
1. Buka `/chat` di HP (pengunjung) dan `/admin/chat` di laptop (petugas). Kirim 10 pesan bergantian tanpa menekan refresh. **Lolos jika:** setiap pesan muncul di kedua layar ≤ 3 detik dan **tepat satu kali**.
2. Petugas klik "Ambil alih". **Lolos jika:** HP langsung menampilkan pesan sistem tanpa refresh.
3. Matikan Wi-Fi laptop 10 detik lalu nyalakan. **Lolos jika:** pesan yang dikirim HP selama itu muncul ≤ 6 detik setelah tersambung, tanpa dobel.
4. Login sebagai FO. **Lolos jika:** daftar sesi terlihat dan bisa mengambil alih.

**9.2 Rekapitulasi**
1. Pilih rentang yang diketahui berisi > 1.000 tiket. Unduh Excel. **Lolos jika:** jumlah baris = jumlah di layar (`total`) dan kolom `[Perizinan]` terisi untuk tiket perizinan.
2. Klik "Rollup Hari Ini". **Lolos jika:** tab Umum menampilkan angka hari ini tanpa error.
3. Buat pendataan dengan nama usaha berisi koma dan tanda kutip; unduh CSV; buka di Excel. **Lolos jika:** kolom tidak bergeser.

**9.3 Antrean**
1. Dua tab petugas layanan yang sama. Tab A "Mulai layani". **Lolos jika:** tab B berubah ≤ 3 detik tanpa refresh; tombol di tab B untuk tiket yang sama nonaktif.
2. Layar TV `/layar/<token>` dan beranda (estimasi): terbitkan tiket baru. **Lolos jika:** keduanya berubah ≤ 3 detik.
3. Klik ganda cepat tombol check-in. **Lolos jika:** hanya 1 nomor antrean terbit.

**9.4 Bot auto-balas**
1. Cabut/kosongkan semua kunci LLM di staging. Tanya "syarat NIB apa?" di `/chat`. **Lolos jika:** bot menjawab dari FAQ resmi ≤ 2 detik, **tidak** dieskalasi.
2. Tanya dengan salah ketik ("sarat nib apa ya"). **Lolos jika:** tetap dapat jawaban FAQ yang benar.
3. Tanya di luar FAQ ("berapa biaya parkir?"). **Lolos jika:** bot menjawab jujur tidak tahu + menawarkan petugas (bukan diam/error).
4. Buka `/admin/chat/ai-log`. **Lolos jika:** terlihat penyedia mana yang menjawab tiap pesan dan sisa kuota harian.

**9.5 Dashboard FO & CMS**
1. Login FO → otomatis ke dashboard FO dengan angka hari ini, antrean per loket, absensi menunggu persetujuan, chat eskalasi, pengaduan baru — semuanya berubah tanpa refresh saat ada kejadian.
2. FO klik "Setujui" absensi lalu **refresh halaman**. **Lolos jika:** status tetap "Disetujui" (bukan kembali "Menunggu").
3. FO klik "Mulai layani" di antrean lalu refresh. **Lolos jika:** status tetap "Dilayani".
4. FO membetulkan nama pengunjung yang salah ketik di Kunjungan. **Lolos jika:** tersimpan, tampil di layar TV, dan tercatat di audit (siapa/kapan/nilai lama→baru).
5. Editor konten menambah kartu layanan baru dengan ikon+gambar+tautan sebagai draft → pratinjau → terbitkan. **Lolos jika:** beranda berubah ≤ 5 detik tanpa deploy; klik "Kembalikan versi sebelumnya" mengembalikannya.
6. Editor mengubah running text layar. **Lolos jika:** TV di lobi berubah ≤ 5 detik tanpa disentuh.

---

## 10. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Migrasi produksi ternyata jauh tertinggal (Fase 0) | Terapkan bertahap di staging dulu; jadwal ulang setelah inventaris |
| `realtime.broadcast_changes` tidak tersedia/berperilaku beda | Jalur alternatif `postgres_changes` sudah disiapkan (§3) |
| Regresi saat refactor dua halaman chat | Hook bersama dengan test reducer; E2E dua sisi sebelum merge |
| Ekspor besar melampaui memori serverless | Streaming writer + `MAX_ROWS` + peringatan UI |
| Tim kecil, pekerjaan paralel bentrok pada berkas yang sama | Pembagian jelas: dev-1 Fase 1/3, dev-2 Fase 2/4; PR kecil per tugas |
| Perubahan RLS membuka akses berlebih | Test RLS perilaku (E-1) untuk setiap peran sebelum/ sesudah |

---

## 11. Keputusan yang dibutuhkan dari owner

1. Menyetujui **freeze fitur baru** sampai Fase 3 selesai.
2. Menyetujui pembuatan **project Supabase staging** (biaya langganan tambahan) atau Supabase Branching.
3. Menunjuk siapa yang memegang akses **read-only DB produksi** untuk Fase 0 dan siapa yang menyetujui deploy produksi.
4. Menentukan cakupan rekap: hanya tiket `selesai` (perilaku sekarang) atau semua status dengan kolom status.
5. Target layanan: pesan chat & perubahan antrean tampil ≤ 3 detik (usulan). Angka ini menjadi kriteria lolos E2E.
6. Apakah FO memang berwenang mengambil alih chat lintas layanan (dokumen desain menyebut ya; RLS saat ini menolak).
7. **Bot:** (a) Mode yang diinginkan saat LLM tidak tersedia: "jawab dari FAQ saja" (usulan) atau "langsung eskalasi"; (b) apakah data percakapan warga boleh dikirim ke penyedia **gratis** yang menyatakan memakai data untuk melatih model (mis. Gemini tier gratis) — usulan: **tidak**; pakai tier berbayar murah atau penyedia dengan klausul tanpa-pelatihan; (c) anggaran bulanan LLM (perkiraan kasar orde beberapa dolar/bulan untuk volume saat ini — diverifikasi di halaman harga saat implementasi).
8. **FO:** kewenangan mana yang benar-benar diinginkan (usulan §14.1): mulai/selesaikan layanan, setujui absensi, edit data kunjungan, batalkan/terbitkan ulang tiket, nonaktifkan petugas, **kelola konten** (hero, kartu layanan, pengumuman, running text, jam & kontak). Apakah kelola konten diberikan ke FO langsung atau lewat kemampuan terpisah `editor_konten` yang bisa dipasang ke akun mana pun (usulan: terpisah).
9. Halaman/konten publik mana yang harus bisa disunting tanpa developer (daftar §14.5) — dan mana yang sengaja dikunci (mis. teks Kebijakan Privasi memerlukan persetujuan hukum).

---

## 13. Fase 1b — Bot auto-balas yang tidak bergantung pada satu vendor

### 13.1 Keadaan saat ini (terkonfirmasi)
- Satu pesan pengunjung = **dua** panggilan Gemini: `embedContent` (`api/chat/ai/route.ts:139-140`) lalu `generateContent` (`:216-219`). Draft balasan petugas (`api/chat/ai/draft`) dan embedding FAQ (`api/admin/faq/embed`) memakai kunci yang sama. Kuota habis → `catch` → `{jawaban:null, eskalasi:true, reason:'ai_error'}` (`:149-154`) → **setiap** pertanyaan dieskalasi ke petugas, termasuk yang jawabannya ada persis di FAQ.
- Tidak ada pencocok FAQ tanpa LLM: tabel `faq_knowledge_base` tidak punya kolom `tsvector`, tidak ada `pg_trgm`, tidak ada kamus sinonim. Padahal FAQ hanya ±80 baris (commit `93f2447`) — skala yang sangat cocok untuk pencocokan deterministik.
- Embedding `vector(3072)` melampaui batas indeks pgvector (2000) sehingga tanpa indeks (`202608080002:24-25`); mengganti vendor embedding = migrasi kolom + re-embed.
- Bot **memparafrasekan** jawaban FAQ resmi lewat LLM bahkan saat kecocokan ≥ 0,7 — biaya dan risiko halusinasi tanpa manfaat.

### 13.2 Arsitektur target: tangga 3 tingkat + pemutus arus

```
Pertanyaan ─► Normalisasi (lowercase, hapus tanda baca, kamus sinonim/singkatan: "nib"→"nomor induk berusaha")
   │
   ├─ Tingkat 0 (selalu ada, 0 biaya, <50 ms): Postgres FTS bahasa Indonesia + pg_trgm pada pertanyaan & jawaban FAQ
   │      skor ≥ T0 → kirim `jawaban` FAQ apa adanya + dasar hukum (tanpa LLM)
   │
   ├─ Tingkat 1 (opsional): embedding semantik lewat antarmuka penyedia (bukan Gemini saja)
   │      skor ≥ T1 → jawaban FAQ apa adanya
   │
   ├─ Tingkat 2 (opsional, dibatasi anggaran): LLM generatif lewat antarmuka OpenAI-compatible
   │      hanya untuk: sapaan, parafrase ringkas ≤3 FAQ terdekat, pertanyaan di luar FAQ
   │      rantai penyedia: utama → cadangan; pemutus arus per penyedia (gagal 3× → istirahat 10 menit)
   │
   └─ Tidak ada yang cocok / semua tingkat gagal → jawaban jujur templat + tawaran ke petugas (eskalasi hanya pada jam kerja)
```

Prinsip: **tidak ada satu pun kegagalan vendor yang membuat bot bisu**. Tingkat 0 berjalan di dalam Postgres yang sudah dibayar.

### 13.3 Tugas

**G-1. Migrasi `..._faq_fts.sql` — pencocok deterministik**
- `CREATE EXTENSION IF NOT EXISTS pg_trgm; CREATE EXTENSION IF NOT EXISTS unaccent;`
- Kolom `faq_knowledge_base.fts tsvector GENERATED ALWAYS AS (setweight(to_tsvector('indonesian', unaccent(pertanyaan)),'A') || setweight(to_tsvector('indonesian', unaccent(jawaban)),'B')) STORED` + indeks GIN; indeks GIN trigram pada `pertanyaan`.
- Tabel `faq_sinonim(kata text, sinonim text[])` (dikelola dari `/admin/chat/faq`) dan tabel `faq_variasi(faq_id, pertanyaan_alternatif)` untuk menampung cara tanya warga yang berbeda-beda (setiap eskalasi yang akhirnya dijawab petugas dapat "dipromosikan" menjadi variasi/FAQ baru dari panel admin).
- RPC `match_faq_teks(p_layanan uuid, p_q text, p_limit int)` mengembalikan `id, pertanyaan, jawaban, dasar_hukum, skor` = gabungan `ts_rank_cd` + `similarity()` trigram (bobot 0,6/0,4). Ambang `T0` disimpan di `site_settings` (`bot_ambang_fts`, default 0,45) agar bisa disetel tanpa deploy.

**G-2. Antarmuka penyedia `src/lib/llm/`**
- `types.ts`: `ChatProvider { generate(messages, opts): Promise<{text, usage}> }`, `EmbeddingProvider { embed(texts): Promise<number[][]>; dims: number; model: string }`.
- `openaiCompatible.ts` (satu implementasi untuk Groq, OpenRouter, Mistral, Cerebras, Cloudflare Workers AI, OpenAI, Ollama lokal — semua memakai protokol yang sama; hanya `baseURL`, `apiKey`, `model` yang berbeda), `gemini.ts` (adaptor untuk kode lama), `none.ts` (mode FAQ saja).
- `registry.ts`: membaca `LLM_CHAT_PROVIDERS="groq:openai/gpt-oss-120b,gemini:gemini-flash-latest"` (urutan = prioritas) dan `LLM_EMBED_PROVIDER`. Pemutus arus per penyedia di tabel `llm_provider_state(provider, gagal_berturut, istirahat_sampai, pakai_hari_ini, kuota_harian)`; penghitung harian di-reset cron WIB.
- Semua pemanggilan lewat `withBudget(provider, fn)`: tolak bila `pakai_hari_ini ≥ kuota_harian` → lanjut ke penyedia berikutnya → akhirnya Tingkat 0.
- `api/chat/ai/route.ts`, `api/chat/ai/draft/route.ts`, `api/admin/faq/embed/route.ts` dipindah ke antarmuka ini; `src/lib/gemini.ts` menjadi adaptor.

**G-3. Embedding portabel (opsional, keputusan §11.7)**
- Kolom baru `embedding_v2 vector(1024)` (dapat diindeks HNSW) + kolom `embedding_model text`; `match_faq_v2` menolak bila model kueri ≠ model baris (cegah pencampuran ruang vektor). Pilihan penyedia: Mistral Embed / Cohere embed-multilingual (tier gratis tersedia) / OpenAI text-embedding-3-small (dims 1024 via parameter) / model lokal multilingual-e5 lewat `@huggingface/transformers` di Supabase Edge Function (tanpa vendor). Re-embed 80 FAQ = satu klik di `/admin/chat/faq`.
- Bila owner memilih "FAQ saja" (§11.7a), G-3 ditunda; Tingkat 0 sudah mencukupi untuk 80 FAQ.

**G-4. Kurangi pemanggilan LLM**
- Kecocokan Tingkat 0/1 di atas ambang → kirim `jawaban` FAQ **verbatim** (teks resmi) + `sumber`. LLM hanya untuk sapaan, parafrase multi-FAQ, dan di luar FAQ.
- Tabel `chat_jawaban_cache(pertanyaan_norm, layanan_id, jawaban, penyedia, hits, expires_at)`: pertanyaan yang sama (setelah normalisasi) dijawab dari cache selama 24 jam; admin bisa menghapus entri.
- Perkiraan: dengan 80 FAQ dan pola pertanyaan warga yang berulang, ≥ 70 % pesan selesai di Tingkat 0/cache (angka ini **diukur** lewat `chat_ai_log.reason` setelah rilis, bukan asumsi).

**G-5. Observabilitas & kendali admin**
- `chat_ai_log` + kolom `penyedia`, `tingkat` (0/1/2), `latensi_ms`, `token`. Halaman `/admin/chat/ai-log` menampilkan: distribusi tingkat, sisa kuota per penyedia, pertanyaan tak terjawab teratas (bahan FAQ baru), tombol "jadikan FAQ".
- Toggle di `/admin/settings`: `bot_mode` = `faq_saja | faq_lalu_llm`, `bot_ambang_fts`, `bot_penyedia_aktif`. Perubahan berlaku seketika (dibaca per permintaan, cache 60 dtk).
- Health: `/api/health/ready` melaporkan status pemutus arus; alarm bila semua penyedia Tingkat 2 mati > 1 jam (bot tetap hidup di Tingkat 0, tetapi admin tahu).

**G-6. Perilaku saat tidak tahu**
- Templat jujur: "Pertanyaan ini belum ada di informasi resmi kami. [Jam kerja] Saya sambungkan ke petugas sekarang? / [Luar jam kerja] Petugas akan membantu Senin–Jumat 08.00–16.00 WIB; Anda juga bisa mengirim pengaduan di /pengaduan." Eskalasi menjadi **pilihan** pengunjung (tombol), bukan otomatis — mengurangi antrean eskalasi palsu.

### 13.4 Pilihan penyedia Tingkat 2 (status Agustus 2026 — wajib diverifikasi ulang saat implementasi karena tier gratis sering berubah)

| Penyedia | Tier gratis | Catatan untuk instansi pemerintah |
|---|---|---|
| Google AI Studio (Gemini Flash/Flash-Lite) | Ada, tetapi tabel harga Google menandai konten tier gratis **dipakai untuk meningkatkan produk**; tier berbayar tidak | Yang dipakai sekarang; kuota gratis sudah habis. Tier berbayar Flash-Lite sangat murah dan tanpa pelatihan — kandidat **utama berbayar** |
| Groq (gpt-oss-120b, qwen) | ±30 req/menit, ±1.000 req/hari, 200K token/hari | Cepat; bagus sebagai **cadangan gratis**; kualitas Bahasa Indonesia layak untuk parafrase FAQ |
| Mistral (mode Experiment) | Ada | Server Uni Eropa; ada embedding; kandidat cadangan |
| OpenRouter (`:free`) | 20 req/menit, 50 req/hari (1.000/hari setelah pernah isi saldo) | Katalog berubah-ubah; cocok hanya sebagai cadangan terakhir |
| Cloudflare Workers AI | 10.000 "neuron"/hari | Edge; opsi bila sudah memakai Cloudflare |
| Ollama / model lokal di server DPMPTSP | Tanpa batas, tanpa kirim data keluar | Butuh perangkat keras; opsi jangka panjang untuk kedaulatan data |

Rekomendasi: **utama** = tier berbayar murah dengan klausul tanpa-pelatihan (Gemini Flash-Lite berbayar atau Mistral), **cadangan** = Groq gratis, **dasar** = Tingkat 0 di Postgres. Tidak membangun apa pun yang *load-bearing* di tier gratis (rujukan: perbandingan tier gratis Agustus 2026, continuumcode.ai/guides/free-llm-api; dataiku.com/blog/best-llm-apis-for-developers).

### 13.5 Test wajib
- Unit: normalisasi + sinonim; pemilihan tingkat; pemutus arus (3 gagal → istirahat; pulih setelah waktu); penghitung kuota harian reset 00:00 WIB.
- Integrasi (DB nyata): `match_faq_teks` untuk 20 pasangan (pertanyaan warga bervariasi → FAQ yang diharapkan) dengan salah ketik & singkatan; presisi ≥ 90 % pada set uji yang disimpan di `src/test/fixtures/faq-eval.json` (set ini juga menjadi **regresi**: setiap perubahan ambang/sinonim harus tetap lolos).
- E2E: tanpa kunci LLM sama sekali, alur §9.4 lolos.

**Kriteria selesai Fase 1b:** UAT §9.4 lolos di staging **dengan semua kunci LLM dicabut**; `chat_ai_log` menunjukkan `tingkat` & `penyedia`; tidak ada rujukan langsung ke `@google/generative-ai` di luar `src/lib/llm/gemini.ts`.

---

## 14. Fase 2b — Dashboard FO yang bisa bertindak + CMS konten yang layak

### 14.1 Temuan audit peran FO (terkonfirmasi dari kode & RLS)

Dokumen desain (`docs/analysis/04-RBAC-MATRIX.md` §1) menjanjikan FO dapat: melayani antrean, mencatat/menyetujui absensi semua petugas, takeover chat, nonaktifkan akun, kelola jadwal, buku tamu, pengaduan jalur layanan, rekap lintas layanan. Kenyataan:

| Kemampuan FO (janji desain) | Menu tampil? | RLS/API mengizinkan? | Yang dialami FO |
|---|:-:|:-:|---|
| Mulai/selesaikan layanan antrean | ✓ | ✗ `visit_update_staff` hanya layanan-sendiri/admin (`202607140004:657`) | Klik → toast "Layanan dimulai" → **tidak terjadi apa-apa** (UPDATE 0 baris tanpa error) |
| Setujui/tolak absensi | ✓ | ✗ `absensi_update_own` hanya diri-sendiri/admin (`:646`) | Toast "Absensi disetujui" → status tetap "Menunggu" |
| Takeover/balas chat | ✓ | ✗ `chat_sesi_owner_select` tanpa FO (`:664`) | Daftar sesi kosong |
| Kelola jadwal & libur layanan | ✓ | ✓ (`202607290009`) | Berfungsi |
| Pengaduan jalur layanan | ✓ | ✓ | Berfungsi |
| Rekap lintas layanan | ✓ | ✓ (baca) | Berfungsi (dengan cacat Fase 2) |
| Nonaktifkan petugas | ✗ menu admin-only | ✓ API (`petugas/status:56`) | Tidak terjangkau |
| Dashboard | ✗ (`/admin` mengalihkan FO ke `/admin/kunjungan`) | – | Daftar baca-saja + tombol refresh |
| Edit data kunjungan/tiket/reservasi | ✗ tidak ada di UI siapa pun | ✓ RLS `kunjungan_*_staff` mengizinkan | Salah ketik nama/asal tidak bisa dibetulkan |
| Kelola konten publik | ✗ admin-only | ✗ admin-only | Hanya admin; dan CMS-nya sendiri sangat terbatas (§14.4) |

**Pola akar sistemik (F-7):** semua aksi staf ditulis langsung dari browser ke tabel (`supabase.from(...).update(...)`). Bila RLS menolak, PostgREST **tidak mengembalikan error**, hanya 0 baris; kode tidak memeriksa jumlah baris → toast sukses palsu. Inilah mengapa "fitur ada tetapi tidak berfungsi".

### 14.2 Arsitektur target kewenangan

```
src/lib/authz/matrix.ts  ← SATU sumber kebenaran: aksi × peran (admin, front_office, petugas[S], editor_konten)
        │  dibangkitkan menjadi:
        ├─ ADMIN_NAV (menu & route guard)             — sudah ada, disinkronkan
        ├─ Route handler `requireCan(action)`           — semua aksi tulis lewat /api/admin/**
        └─ Test kontrak RLS: untuk setiap aksi×peran, test integrasi memastikan DB setuju dengan matriks
```

Semua aksi tulis staf pindah ke route handler (service role + `requireCan`), mengembalikan `403` dengan pesan yang jelas dan `409` bila status sudah berubah. RLS tetap sebagai lapisan pertahanan kedua dan **disamakan** dengan matriks. Sementara migrasi berlangsung, util `assertAffected(result)` dipasang pada semua `update()` dari browser agar 0 baris menjadi error nyata.

### 14.3 Tugas — dashboard & aksi FO

**F-1. Migrasi `..._fo_rls_parity.sql`**: tambahkan `front_office` ke `visit_update_staff`, `absensi_petugas` (policy baru `absensi_fo_approve` hanya kolom `status/approved_by` via trigger penjaga kolom), `chat_*` (gabung dengan A-7), `kunjungan` UPDATE (`nama, asal, keperluan, no_hp`) dengan trigger audit `kunjungan_audit` (nilai lama→baru, `actor`, `waktu`).

**F-2. Endpoint aksi staf** (`src/app/api/admin/**`, semua dengan `requireCan`, audit_log, idempoten):
`antrean/[tiketId]/{panggil|mulai|selesai|batal|tidak-terlayani|pindah-layanan|terbitkan-ulang}`, `absensi/[id]/{setujui|tolak}` (+alasan), `kunjungan/[id]` PATCH (data identitas), `reservasi/[id]/{jadwal-ulang|batal}`, `petugas/[id]/{nonaktifkan}` (sudah ada; perbaiki `actor_role` hardcoded). Klien memakai endpoint ini; hapus `update()` langsung dari `admin/antrian`, `admin/absensi`, `admin/chat`.

**F-3. Dashboard FO `/admin/fo`** (FO diarahkan ke sini; admin juga bisa membukanya):
- Kartu KPI hari ini: hadir, menunggu, dilayani, selesai, tidak terlayani, rata-rata tunggu & layan (dari `tiket_antrean` hari ini, WIB).
- Panel antrean per loket (nomor dipanggil, menunggu berikutnya, petugas hadir/absen) — realtime kanal `antrean:admin:*` (Fase 3).
- Kotak tindakan: absensi menunggu persetujuan (setujui/tolak inline), chat eskalasi, pengaduan baru, reservasi hari ini yang belum hadir.
- Aksi cepat: daftarkan walk-in, scan QR, panggil ulang, tutup/buka layanan hari ini, kirim pengumuman ke layar.
- Semua panel memakai `useRealtimeRefetch` (Fase 3) dengan polling cadangan 30 dtk.

**F-4. Edit data operasional**: modal edit pada baris Kunjungan (validasi zod; alasan wajib; riwayat perubahan tampil di panel detail); tindakan tiket di Antrian (batal/tidak terlayani/pindah layanan/terbitkan ulang) dengan konfirmasi; reservasi (jadwal ulang/batal) di Scan & Kunjungan. Semua tercatat `audit_log` dan tampil di `/admin/data-governance`.

**F-6. Kelola petugas untuk FO**: menu `/admin/petugas` mode terbatas (lihat daftar, nonaktifkan dengan alasan; tidak bisa ubah peran/aktifkan kembali) sesuai RBA-08.

**F-7. Penjaga sistemik**: `assertAffected()` + aturan lint yang melarang `.update(`/`.delete(` langsung dari komponen klien pada tabel staf (daftar tabel di konfigurasi lint) — memaksa jalur API.

### 14.4 Temuan CMS saat ini
- `landing_content` = pasangan `section/item_key/item_value` teks dengan kunci tetap (hero, section_header, service, cta, footer). Tidak bisa: menambah/menghapus kartu layanan (hanya mengubah teks yang sudah ada), mengunggah gambar/ikon, mengubah menu navigasi (hardcoded `page.tsx:318-321`), mengatur pengumuman/banner, mengedit Standar Pelayanan/Maklumat (hanya lewat unggah dokumen), mengedit jam/hari layanan publik di beranda selain `site_settings` teks.
- Tidak ada draft → pratinjau → terbitkan; simpan = langsung tayang. Tidak ada versi/rollback: tabel `konten_versi` (WP-26) **ada di DB tetapi tidak pernah dipakai UI** (`rg konten_versi src` kosong). Tidak ada audit siapa mengubah apa.
- Beranda memuat konten di klien setelah render (`page.tsx:236-247`) → kilatan konten fallback hardcoded sebelum konten CMS tampil; SEO membaca fallback.
- Running text layar (`site_settings.running_text_layar`) admin-only, tanpa jadwal tayang.

### 14.5 Tugas — CMS konten yang layak (F-5)

**Model data (migrasi `..._cms_blok.sql`, aditif):**
- `konten_blok(id, halaman, slot, tipe, data jsonb, urutan, aktif)` — tipe blok terdefinisi skema zod: `hero`, `kartu_layanan` (judul, deskripsi, ikon, gambar, tautan, layanan_id), `pengumuman` (teks, tingkat, tayang_dari, tayang_sampai), `jam_layanan`, `kontak`, `tautan_footer`, `running_text` (teks, tayang_dari/sampai, layar_token[]), `standar_pelayanan`, `maklumat`, `faq_publik`, `galeri_gambar`.
- `konten_versi` (yang sudah ada) dipakai: setiap "terbitkan" menyimpan snapshot JSON seluruh halaman; `konten_terbit(halaman, versi_id, diterbitkan_oleh, at)` menunjuk versi aktif; rollback = menunjuk versi lama.
- Storage bucket `konten-media` (gambar/ikon) dengan batas ukuran & tipe; URL publik.
- Kemampuan `editor_konten` = kolom `petugas.kemampuan text[]` (bukan peran baru) → dapat dipasang ke FO/admin/petugas mana pun (keputusan §11.8). RLS: tulis draft & terbitkan bila `'editor_konten' = ANY(kemampuan)` atau admin; audit trigger.

**Editor `/admin/konten`:**
- Daftar halaman (Beranda, Standar Pelayanan, Layar TV, Footer/Kontak, FAQ publik) → editor blok: tambah/hapus/urutkan (drag), form per tipe blok, unggah gambar, **pratinjau** (render halaman nyata dengan `?draft=1` untuk editor), **Terbitkan**, **Riwayat versi** (bandingkan & kembalikan), penjadwalan tayang untuk pengumuman/running text.
- Validasi tautan internal (harus rute yang ada), panjang teks, alt gambar (aksesibilitas).

**Penyajian dinamis tanpa deploy:**
- Beranda, Standar Pelayanan, dan layar TV dirender di **server** dari versi terbit (`fetch` dengan `next: { tags: ['konten:<halaman>'] }`); endpoint terbitkan memanggil `revalidateTag('konten:<halaman>')` → perubahan tampil ≤ 5 detik tanpa deploy, tanpa kilatan fallback, ramah SEO. Fallback hardcoded di `page.tsx` diganti seed awal di DB (dimuat sekali lewat migrasi/seed).
- Layar TV berlangganan kanal `konten:layar` (trigger pada `konten_terbit`) untuk running text & pengumuman.
- Menu navigasi publik menjadi blok `tautan_nav` (dibatasi ke rute yang ada).

**Test wajib Fase 2b**
- Integrasi RLS: untuk setiap baris §14.1, uji sebagai FO → aksi berhasil **dan** baris berubah; sebagai petugas layanan lain → 403; sebagai pengunjung → 403.
- Integrasi CMS: terbitkan → `konten_versi` bertambah; rollback → halaman kembali; editor tanpa kemampuan → 403.
- E2E: alur §9.5 (1–6).

**Kriteria selesai Fase 2b:** UAT §9.5 lolos; tidak ada `.update(`/`.delete(` langsung dari komponen klien pada tabel staf (lint); `konten_versi` terpakai; `FALLBACK_*` di `page.tsx` dihapus.

---

## 15. Peta "seberapa dinamis" per fitur — sekarang vs target

| Fitur / halaman | Sekarang | Target setelah remediasi | Fase |
|---|---|---|---|
| Chat pengunjung `/chat` | Siaran rapuh dari serverless; tanpa polling; pesan dobel | Event dari trigger DB ≤ 3 dtk + polling cadangan 5 dtk; satu jalur upsert; nol dobel | 1 |
| Chat petugas `/admin/chat` | Polling 3–4 dtk + siaran; FO tidak melihat apa pun | Event ≤ 3 dtk; daftar sesi via view ringkas; FO/admin/petugas sesuai matriks | 1, 2b |
| Bot auto-balas | Mati total saat kuota Gemini habis | Selalu menjawab dari FAQ (Tingkat 0); LLM berlapis dengan pemutus arus | 1b |
| Estimasi antrean (beranda) | Mendengarkan tabel `visit` yang tidak dipublikasikan → beku | Kanal publik `antrean:*` ≤ 3 dtk + polling 60 dtk | 3 |
| Layar TV `/layar/[token]`, `/layar-antrian` | Polling 30 dtk (realtime tidak pernah aktif) | Kanal publik ≤ 3 dtk; running text/pengumuman dari CMS ≤ 5 dtk | 3, 2b |
| Antrean petugas `/admin/antrian` | Muat sekali; aksi FO gagal diam-diam | Event ≤ 3 dtk; aksi via API dengan hasil nyata; kunci anti-rebutan tiket | 3, 2b |
| Dashboard admin `/admin` | Muat sekali | Event + polling 30 dtk | 3 |
| Dashboard FO | Tidak ada | `/admin/fo` realtime dengan aksi | 2b |
| Kunjungan `/admin/kunjungan` | Muat sekali; baca-saja | Event; edit data + audit | 3, 2b |
| Absensi | Approve FO gagal diam-diam | Aksi via API; daftar realtime | 2b, 3 |
| Rekap & ekspor | Terpotong 1.000; kolom kosong; rollup gagal | Lengkap, paginasi server, rollup admin, streaming Excel | 2 |
| Pengaduan admin | 100 baris pertama saja | Paginasi + event pengaduan baru | 3 |
| Beranda & konten publik | Teks CMS terbatas, kilatan fallback, deploy untuk perubahan struktur | Blok CMS, draft/pratinjau/terbitkan, versi, tayang ≤ 5 dtk tanpa deploy | 2b |
| Sidebar badge eskalasi | Bergantung publikasi yang belum terbukti | Kanal yang sama dengan chat | 1 |
| Check-in | Klik ganda/replay → tiket ganda | Idempotency-Key | 3 |

---

## 12. Definisi selesai keseluruhan

- Semua ID pada §8 berstatus selesai dengan tautan PR, test integrasi, dan hasil UAT §9 yang ditandatangani QA + owner.
- CI hijau pada: lint, typecheck, unit, integrasi (Supabase lokal), build, E2E (staging).
- `docs/STATUS.md` dan `docs/analysis/DB-CHANGES.md` mencerminkan keadaan produksi yang diverifikasi dengan query §0.1 setelah deploy terakhir.
- Tidak ada `catch {}` kosong di `src/**` (dijaga lint).
- Tidak ada `setInterval` < 10 dtk sebagai jalur utama data; realtime adalah jalur utama, polling hanya cadangan.
