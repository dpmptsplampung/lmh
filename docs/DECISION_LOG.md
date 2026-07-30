# Decision Log

Log keputusan teknis di setiap decision gate LMH 2.0. Setiap entri
mencatat konteks, opsi yang dipertimbangkan, keputusan final, dan dampak.

---

## Gate 0 — Pra Fase 1 (Pengamanan Darurat)

**Tanggal**: 11 Juli 2026
**Konteks**: 5 temuan keamanan kritis (K1-K5) harus ditutup sebelum sistem
dibuka publik.
**Keputusan**:
- K1: Pipeline PDF→PNG + watermark (bukan signed URL ke PDF mentah)
- K2: RLS `pengunjung_id = auth.uid()` + anon sign-in (bukan filter client-side)
- K3: Rate limit via `check_anon_rate()` RLS function (bukan Edge Function)
- K4: Hapus password hardcode + flow undangan magic-link (bukan rotasi manual)
- K5: Magic-link Supabase Auth (bukan edit-token mentah)
**Dampak**: 5 migration (020-024), 5 endpoint baru, anon sign-in wajib
diaktifkan di Dashboard.
**Status**: Code-complete. Dashboard config (anon sign-in, Auth Hook)
ditangani human.

---

## Gate 1 — Pra Fase 2 (Fondasi Data & Tata Kelola)

**Tanggal**: 11 Juli 2026
**Konteks**: Fondasi data (Visit Spine) + tata kelola PDP + perbaikan
integritas (B2/B4/B5) + arsitektur (A1).
**Keputusan**:
- I1: Visit Spine via dual-write (zero downtime) — bukan big-bang rename
- A1: Role di JWT claims via Auth Hook (bukan query DB per request)
- I8: pg_cron untuk anonymisasi (bukan external scheduler)
- B5: Model akun mitra individual (bukan shared per instansi)
**Dampak**: 10 migration (025-034), Auth Hook wajib dikonfigurasi di
Dashboard, tabel `visit` menjadi source of truth.
**Status**: Code-complete. Tabel `kunjungan`/`reservasi` sudah di-retire
di baseline (item I1.c selesai; lihat entri Gate 5).

---

## Gate 2 — Pra Fase 3 (Dampak Warga Cepat)

**Tanggal**: 11 Juli 2026
**Konteks**: Fitur yang langsung dirasakan warga + kepatuhan regulasi.
**Keputusan**:
- I3: SKM digital 9 unsur PermenPANRB 14/2017 (bukan SKM manual)
- I2: Materialized view + pg_cron refresh (bukan computed per request)
- I5: Resend untuk email + web-push VAPID (WhatsApp ditangguhkan ke Fase 2.5)
**Dampak**: 3 migration (030-034), 3 service integration (Resend, VAPID,
Vercel Cron), service-role key wajib untuk SKM INSERT fallback.
**Status**: Code-complete.

---

## Gate 3 — Pra Fase 4 (Diferensiasi)

**Tanggal**: 11 Juli 2026
**Konteks**: Fitur diferensiasi — AI RAG, funnel investor, marketplace
UMKM dua sisi.
**Keputusan**:
- I4: Gemini 1.5 Flash + text-embedding-004 + pgvector (bukan OpenAI)
- I4: Eskalasi jika similarity < 0.7 SEBELUM panggil Gemini (hemat biaya)
- I6: Lead funnel sederhana (bukan CRM penuh)
- I7: Marketplace dua sisi dengan inquiry termoderasi (bukan kontak
  langsung) — kontak pemilik tidak terekspos publik
**Dampak**: 4 migration (035-038), Gemini API key wajib, pgvector wajib
di-enable.
**Status**: Code-complete. Review approved (0 must-fix blockers).

---

## Gate 4 — RILIS LMH 2.0

**Tanggal**: 11 Juli 2026
**Konteks**: PWA offline-first + WCAG 2.1 AA.
**Keputusan**:
- I9: Manual service worker (bukan next-pwa) — lebih kontrol
- I9: Unified SW (cache + push) di `sw.js` (bukan terpisah)
- I9: Background sync untuk checkin queue (bukan polling)
- I9: Mode bantuan petugas via service-role INSERT (pengunjung_id=NULL)
**Dampak**: No new migration. PWA manifest + SW + IndexedDB + a11y fixes.
**Status**: Code-complete. Deploy pending human Dashboard config.

---

## Gate 5 — Gelombang Perbaikan Audit 2026-07-20

**Tanggal**: 20 Juli 2026
**Konteks**: Audit pasca-rilis menemukan celah keamanan/governance P0 (RLS
visit, column guard chat, publish guard listing, eskalasi role petugas,
absensi backdate, notifikasi gagal berulang, retensi chat_ai_log) plus
kebutuhan posisi antrean dan notifikasi balasan.
**Keputusan**:
- Terapkan migration `202607200001_p0_security_governance.sql`:
  - RLS `visit` ownership (pengunjung hanya melihat kunjungannya sendiri)
  - Column guard `chat_sesi` (batasi kolom yang dapat diubah pengunjung)
  - Publish guard `listing_umkm` (petugas terbatas `draft`/`pending_review`;
    hanya admin yang publish)
  - Trigger audit `trg_audit_petugas_role` untuk UPDATE `role` petugas
  - Absensi anti-backdate (`trg_guard_absensi_tanggal`)
  - Dead-letter notifikasi (`claim_notifikasi` berhenti claim baris gagal
    retried ≥ 5x)
  - Retensi `chat_ai_log` 90 hari (`prune_chat_ai_log()` + cron harian)
  - Fungsi `get_queue_position(qr_token)` untuk posisi antrean publik
  - Trigger notifikasi balasan: chat petugas → pengunjung, status
    `umkm_inquiry`, konfirmasi reservasi
- Reafirmasi K5: edit UMKM via **magic-link Supabase Auth**
  (`/api/umkm/request-edit-link`) — MENIMPA skema edit-token mentah /
  Edge Function yang tercantum di dokumen arsip.
**Dampak**: 1 migration baru, workflow migrasi resmi = 5 baseline
`20260714*` via Supabase CLI + migration incremental (lihat
`docs/MIGRATIONS.md`).
**Status**: Code-complete.

---

## Keputusan Teknis Lain

### Bisnis logic server: Next.js Route Handler
- **Konteks**: Edge Function vs Route Handler
- **Keputusan**: Route Handler (familiar, konsisten, deploy Vercel)
- **Pengecualian**: Tidak ada — semua logic di Route Handler

### Migration: Supabase CLI (5 baseline)
- **Konteks**: Supabase CLI vs manual
- **Keputusan**: Supabase CLI (`supabase db push --include-all --include-seed`)
  dengan `supabase/config.toml` dan 5 file baseline `202607140001`–`005`
- **Catatan**: MENIMPA keputusan lama "Manual via SQL Editor" (2026-07-20)

### WhatsApp Cloud API: Ditangguhkan
- **Konteks**: Email + web-push vs tambah WhatsApp
- **Keputusan**: Email + web-push dulu, WhatsApp di Fase 2.5 setelah
  approval Meta Business
- **Alasan**: Realistis untuk solo dev, WhatsApp butuh verifikasi nomor

---

## Gate 2026-07-29 — Klarifikasi Bagian 11.2 LMH-AGENT-SPEC (pra Fase E)

**Tanggal**: 29 Juli 2026
**Konteks**: Sebelum eksekusi Fase E (`docs/analysis/05-IMPLEMENTATION-PLAN.md`),
pertanyaan terbuka Bagian 11.2 + OQ dijawab pemilik keputusan.

**Keputusan**:
- **11.2 #1 Keluhan lapangan**: tidak ada keluhan harian berulang; masalah utama
  tetap petugas P4 tidak datang (tamu P4 sepi). → Urutan Bagian 9 dipertahankan,
  tidak ada item yang naik ke Fase 0.
- **11.2 #2 Tim & anggaran**: A — tim kecil, anggaran minim. → SEC-03 pakai solusi
  gratis (Sentry free tier / self-host); SEC-13 WhatsApp tetap TUNDA; BOT-14
  hanya dalam kuota gratis Gemini.
- **11.2 #3 Penilaian eksternal**: tidak ada tenggat mendesak. Kanal
  pengaduan/survei/review DPMPTSP saat ini berjalan TERPISAH di luar LMH; LMH
  sistem baru yang ke depan menyatukan semuanya. → Fase 1 (CMP) tidak dipercepat;
  migrasi dari kanal lama adalah keputusan penyatuan terpisah nanti.
- **11.2 #4 Pengguna dominan**: Seimbang (fisik ≈ digital). → Urutan fase tidak berubah.
- **OQ-03 Batas jam alpa**: default **10:00 WIB**, **dapat diatur Admin** lewat
  `site_settings` kunci `batas_jam_alpa` (CMS-05, `boleh_diubah_dashboard=true`).
- **OQ-04 Jam layanan resmi**: **08:00–15:30** (mengoreksi data live 08:00–16:00;
  disesuaikan saat seed jadwal di WP-16).
- **OQ-05 Hari libur**: tabel `hari_libur` + **input manual** oleh Admin.
- **OQ-07 Format tiket pengaduan**: `P` + **kode acak** (misal `P7K2N9X`).
  Awalnya diusulkan `P112001230` (berurutan); pemilik memilih acak setelah
  diingatkan risiko penebakan pada jalur integritas (CMP-05).
- **RBA-07 Akun PIC**: satu layanan satu akun; saat PIC berganti, akun TIDAK
  diganti — cukup **reset password oleh Admin** (putus Google lama + kirim
  undangan + akhiri sesi pemegang lama). Menyelesaikan pertentangan dengan
  `AGENTS.md` (BT-06); `AGENTS.md` perlu diselaraskan.

**Dampak**: `docs/analysis/01-GAP-ANALYSIS.md` (OQ terjawab) dan
`docs/analysis/05-IMPLEMENTATION-PLAN.md` (WP-12, WP-16, WP-17) diperbarui.
**Status**: Terkunci. Dasar untuk eksekusi Fase E.

---

## WP-01 — Perbaikan bug zona waktu Asia/Jakarta (RPT-07)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: RPT-07 (prasyarat QUE-15, SCH-05, SCH-10, RPT-05, SVC-05)

**Konteks**: "Hari ini" dihitung dengan `new Date().toISOString().split('T')[0]`
(UTC) di banyak lokasi klien, sementara view DB `v_antrian_loket` sudah
`Asia/Jakarta`. Pada pukul 00:00–06:59 WIB, klien dan DB menampilkan hari
berbeda (bug produksi aktif, I-21).

**Keputusan**:
- Buat `src/lib/time.ts`: `todayWIB()`, `toWIBDateString()`, `addDaysWIB()`
  memakai `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' })`.
- Ganti pola UTC → helper WIB di 8 file: `admin/antrian`, `admin/page` (termasuk
  agregasi mingguan `addDaysWIB(-i)`), `admin/kunjungan`, `me/page`,
  `admin/absensi` (3 lokasi termasuk `tanggal` yang ditulis ke DB),
  `me/reservasi` (`minDate`/`maxDate`), `admin/skm` (rentang tanggal).
- **Tidak ada perubahan DB** (WP tanpa migrasi).

**Perbaikan sampingan (mock test pra-ada, bukan logika produksi)**:
- `admin/antrian/antrian.test.tsx`: tambah mock tabel `layanan` & `visit.insert`
  agar `WalkinWizard` tidak melempar unhandled rejection (bug mock pra-ada).
- `supabase/migrations/migration-test-utils.ts`: daftarkan
  `202607280005_antrian_hari_ini.sql` ke `FORWARD_MIGRATION_FILES` (terlewat).

**Verifikasi**: `tsc --noEmit` bersih; `vitest` 82/82 passed; `next build` sukses;
unit test `time.test.ts` (8 tes, termasuk SK-31: 23:50 & 00:10 WIB, reset tengah
malam WIB bukan 07:00).
**Catatan**: warning ESLint pra-ada di file lain (SEC-06) tidak disentuh — di luar
cakupan WP-01.
**Status**: Code-complete. Menunggu deploy untuk efek produksi.

---

## WP-02 — Observability: error tracking + alerting (SEC-03, OPS-06)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: SEC-03, OPS-06

**Konteks**: Tidak ada error tracking/alerting — kegagalan hanya diketahui dari
keluhan warga. Ini prasyarat keras sebelum pekerjaan antrean (OPS-06).
Keputusan 11.2 #2: tim kecil, anggaran minim → solusi harus tanpa biaya berulang.

**Keputusan**:
- **Tanpa dependensi baru** (hindari `@sentry/nextjs`, aturan 0.2 #10). Bangun
  error tracking **self-contained**: tabel `public.error_log` + fungsi
  `log_error_event()` (SECURITY DEFINER) + fungsi `check_error_alert()` +
  cron `observability_error_alert */5`.
- `logServerEvent` (level error/warn) kini **juga menulis ke `error_log`**
  (best-effort, tidak pernah melempar; PII tetap disanitasi 2 lapis).
- Alerting: bila ≥10 error/5 menit → enqueue **1 email** ke tabel `notifikasi`
  (infra Resend yang sudah ada, tanpa biaya baru), idempoten per jendela.
  Penerima via `app.error_alert_email` atau argumen.
- Endpoint **`/api/health/error`** (hanya Admin) untuk melihat error terbaru +
  ringkasan 24 jam.
- Jembatan migrasi `exec_sql`/`exec_query` (SECURITY DEFINER, hanya service_role)
  dibuat sekali atas persetujuan pemilik untuk menerapkan migrasi terprogram.

**Dampak DB (dicatat di `docs/analysis/DB-CHANGES.md`)**: migrasi
`202607290001_observability_error_log.sql` — tabel `error_log` + 2 index + 2
fungsi + 1 policy + 1 cron. Semua **aditif**; self-test dibersihkan (error_log
kembali 0 baris).

**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 519/519 tests passed**
(termasuk 4 tes baru `logger-errorlog.test.ts` untuk sanitasi PII); `next build`
sukses (`/api/health/error` terdaftar); **uji nyata di produksi**: insert error +
alert bekerja, lalu dibersihkan.
**Status**: Code-complete + diterapkan di produksi. Menunggu set
`app.error_alert_email` untuk mengaktifkan alert email.

---

## WP-03 — Perbaikan watermark dokumen IPRO (SEC-05, INV-04)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: SEC-05, INV-04

**Konteks**: Watermark dokumen IPRO sudah dibakar di server (sharp), tetapi isinya
`DPMPTSP-LAMPUNG | <ipHash> | <timestamp>` — hanya bisa melacak ke IP, bukan ke
orang. INV-04 mewajibkan identitas peminta.

**Keputusan**:
- `page-image/route.ts`: identitas watermark via `resolveWatermarkIdentity()` —
  **login → `nama <email>`** (dari `pengunjung`); **anonim → `SES-<hash sesi>`**
  (dari seed IP+cookie, tanpa nama/email). Watermark tetap dibakar di server,
  bukan overlay CSS (INV-04).
- Cache watermark kini diberi kunci per **subjek** (bukan per IP) agar identitas
  tidak tertukar antar pengguna di IP yang sama.
- Rate limit in-memory dipertahankan sebagai pertahanan dini CPU; penegakan
  lintas-instance untuk pengguna bersesi mengandalkan `check_anon_rate` (SEC-02).

**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 521/521 tests passed**
(2 tes baru: login memuat nama+email, anon memakai SES- tanpa @); tidak ada
perubahan DB.
**Status**: Code-complete. Menunggu deploy untuk efek produksi.

---

## WP-04 — Perbaikan pipeline embedding FAQ (BOT-11, SEC-08, TB-01)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: BOT-11, SEC-08, TB-01

**Konteks**: Endpoint embed hanya memproses `embedding IS NULL`, sehingga FAQ yang
diedit tetap dicari memakai embedding lama — bot menjawab dari versi yang sudah
diperbaiki (gagal senyap). Kolom `embedding_updated_at` tidak ada.

**Keputusan**:
- Migrasi `202607290002_faq_reembed.sql`: kolom `perlu_embed_ulang`,
  `embedding_updated_at`, `diubah_oleh`; fungsi `faq_mark_reembed()` +
  trigger `trg_faq_reembed` (set `perlu_embed_ulang=true` saat pertanyaan/jawaban
  berubah); fungsi `faq_embedding_selesai()`; backfill baris `embedding IS NULL`.
- Endpoint `embed/route.ts`: proses `embedding IS NULL OR perlu_embed_ulang`;
  set `perlu_embed_ulang=false` + `embedding_updated_at` setelah sukses; dukung
  mode cron via `CRON_SECRET` (`request` opsional agar tes internal tetap valid).
- `vercel.json`: tambah cron `/api/admin/faq/embed` tiap jam (pembuatan embedding
  butuh Gemini, tidak bisa dari pg_cron).
- **TB-01**: `.env.local` sudah `gemini-embedding-004` (768-dim, cocok dengan
  kolom) — mismatch yang diduga ternyata sudah diperbaiki di commit sebelumnya.
  Upgrade model ke 3072-dim ditunda sebagai WP BOT-14 terpisah (butuh embed ulang
  total).

**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md` (aditif; self-test trigger
bekerja dan dikembalikan).
**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 522/522 tests passed**
(10 tes embed termasuk tes BOT-11 filter OR); `next build` sukses; uji trigger di
produksi berhasil dan dikembalikan.
**Status**: Code-complete + diterapkan di produksi. Re-embed terjadwal aktif setelah
deploy Vercel cron.

---

## WP-05 — Penomoran antrean atomik (QUE-06, SVC-04, SVC-05)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: QUE-06, SVC-04, SVC-05 (fondasi; tampilan nomor penuh di Fase 3)

**Konteks**: Tidak ada kolom nomor antrean; posisi dihitung ad-hoc dari `waktu_masuk`.
Fitur nomor berprefiks belum ada. Penomoran harus atomik di PostgreSQL (bukan
"SELECT MAX+1" di aplikasi) + `UNIQUE(layanan,tanggal,nomor)` sebagai jaring pengaman.

**Keputusan**:
- Migrasi `202607290003_antrean_counter.sql`: kolom `layanan.nomor_loket` (SVC-04),
  `layanan.prefiks_antrean` (SVC-05); tabel `antrean_counter(layanan_id,tanggal,
  nomor_terakhir)`; fungsi `terbit_nomor_antrean()` memakai **UPSERT + RETURNING**
  (baris dikunci saat UPSERT → aman untuk permintaan bersamaan).
- Belum mengubah alur `visit` (itu Fase 3) — ini fondasi penomoran + atribut loket.

**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md` (aditif).
**Verifikasi**: **SK-06/I-01 diuji nyata di produksi** — 8 panggilan bersamaan →
8 nomor unik tanpa duplikat, counter akhir tepat; baris uji dibersihkan.
**Status**: Code-complete + diterapkan di produksi (fondasi).

---

## WP-06 — Kolom aktif/nonaktif petugas (RBA-06, fondasi RBA-08, I-22)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: RBA-06 (fondasi RBA-08, I-22)

**Konteks**: `petugas` tidak punya status nonaktif; satu-satunya cara menghentikan
akses adalah MENGHAPUS baris — menghancurkan riwayat siapa melayani/membalas/menulis
apa.

**Keputusan**:
- Migrasi `202607290004_petugas_aktif.sql`: kolom `aktif`, `nonaktif_sejak`,
  `nonaktif_oleh`, `nonaktif_alasan`. `get_my_role()` kini mengecualikan petugas
  nonaktif (I-22) sehingga RLS gagal tertutup untuk mereka.
- Fungsi `petugas_set_nonaktif(id, alasan, actor)` — **alasan wajib** (RBA-08);
  `petugas_set_aktif(id)` — **hanya Admin** (satu arah untuk FO).
- Guard sisi kode: `proxy.ts` dan `AdminGuard.tsx` menolak petugas nonaktif
  (membaca `aktif` selain `role`).

**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md` (aditif; 2 petugas nyata
tetap aktif; tidak ada sisa dummy).
**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 522/522 tests passed**;
`next build` sukses; di produksi: kolom & fungsi ada, `set_nonaktif` tanpa alasan
ditolak, data pengunjung tidak tersentuh.
**Status**: Code-complete + diterapkan di produksi.

---

## WP-13 — Standar Pelayanan & Maklumat Pelayanan (CMP-09)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: CMP-09, OQ-05 (hari_libur dibuat di WP-12)

**Konteks**: Kewajiban hukum UU 25/2009 kedua yang belum ada — sekaligus bahan
pengetahuan bot (fase 4).

**Keputusan**:
- Migrasi `202607290008_standar_pelayanan.sql`: tabel `standar_pelayanan` (per
  layanan: persyaratan, prosedur, jangka waktu, biaya, produk layanan, penanganan
  pengaduan, maklumat) + RLS (publik baca aktif; admin tulis).
- Halaman publik `/standar-pelayanan` menampilkan 6 elemen wajib + maklumat per layanan.

**Verifikasi**: `tsc` bersih; `vitest` 83/83 files, 522/522 tests passed; `next build`
sukses (`/standar-pelayanan` terdaftar).
**Status**: Code-complete + diterapkan di produksi. Konten diisi Admin (bisa juga jadi
bahan bot di fase 4).

---

## WP-14 — Klausul penafian matchmaking + ungkap pencatatan perilaku (MMK-09, INV-06)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: MMK-09, INV-06, TB-05

**Keputusan**:
- `umkm/page.tsx`: klausul penafian publik — DPMPTSP memfasilitasi pertemuan, tidak
  menjamin kualitas/harga/keberhasilan, dan bukan pihak dalam perjanjian (MMK-09).
- `kebijakan-privasi/page.tsx`: bagian baru mengungkap **pencatatan perilaku** pada
  Investment Gallery & Peta Potensi (INV-06) + merujuk `consent_log`.
- Perbaiki error `POLICY_VERSION` (TB-05): ubah dari `export` ke konstanta lokal agar
  tidak melanggar aturan entry export Next.js.

**Verifikasi**: `tsc` bersih; `vitest` 83/83 files, 522/522 tests passed; `next build`
sukses. Tidak ada perubahan DB.
**Status**: Code-complete.

---

## WP-15 — Peran `front_office` (RBA-02, RBA-01)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: RBA-02, RBA-01 (fondasi SCH-06/08, CHT-08, GST-04, CMP-02, RBA-08/10)

**Konteks**: FO punya wewenang lintas-layanan (absensi semua P4, jadwal, takeover chat,
buku tamu, pengaduan jalur layanan) yang tidak bisa diwakili `petugas`.

**Keputusan**:
- Migrasi `202607290009_role_front_office.sql`: CHECK `petugas.role` diperluas ke
  `('petugas','admin','front_office')`; fungsi `is_cross_service_staff()`; RLS
  lintas-layanan untuk absensi & jadwal.
- **OPS-08** (cari semua pemetaan role ekshaustif di TS): perbarui `constants.ts`
  (`FRONT_OFFICE`), `admin-nav.ts` (`AdminRole` + matriks), `proxy.ts`, `login`,
  `page.tsx`, `api/chat/messages/route.ts` (FO = staff lintas-layanan, CHT-08),
  `admin/absensi` (FO bisa approve + kolom aksi), `admin/antrian` (FO melihat kolom
  Layanan, `fixedLayananId=null`).
- **Area yang SENGAJA tetap admin-only** (benar): invite petugas, embed FAQ,
  pengaduan integritas, health/error, investment-docs, data-governance, kelola petugas,
  pengaturan, galeri, UMKM review.

**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 524/524 tests passed** (2 tes
baru wewenang FO di `admin-nav.test.ts`); `next build` sukses.
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md`.
**Status**: Code-complete + diterapkan di produksi.

---

## WP-16 — Struktur jadwal standby + pemblokir pendaftaran (SCH-01/04/11, QUE-05)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: SCH-01, SCH-04, SCH-11, QUE-05, OQ-04

**Konteks**: Jadwal standby harus memblokir pendaftaran dengan pesan jadwal terdekat
(P3). Jam layanan resmi kantor: **08:00–15:30** (keputusan pemilik, mengoreksi data
live 08:00–16:00).

**Keputusan**:
- Migrasi `202607290010_jadwal_standby.sql`: tabel `jadwal_standby` (pola mingguan)
  + `jadwal_pengecualian` (per tanggal); fungsi `is_layanan_buka_jadwal()` &
  `jadwal_berikutnya()`; trigger `guard_visit_layanan_buka` diperbarui (fungsi baru +
  tanggal Asia/Jakarta, memperbaiki RPT-07 di trigger lama); backfill 50 baris dari
  `layanan_jadwal` dengan koreksi jam 16:00→15:30.
- `me/reservasi/page.tsx`: validasi memakai `is_layanan_buka_jadwal` + pesan penolakan
  menyebut **jadwal terdekat** + tawaran live chat (SCH-11/P3); `MAX_BOOKING_DAYS`
  30→**7** (QUE-05).

**Verifikasi**: di produksi — 50 baris `jadwal_standby`, `jam_selesai` seragam 15:30,
`jadwal_berikutnya` (Minggu→Senin) dan `is_layanan_buka_jadwal` (Senin=true, Minggu=
false, jam 16:00=false) benar; `tsc` bersih; `vitest` **83/83 files, 525/525 tests
passed** (5 tes reservasi termasuk QUE-05 horizon H+7); `next build` sukses.
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md`.
**Status**: Code-complete + diterapkan di produksi.

---

## WP-17 — Absensi sebagai gerbang antrean (SCH-02/08/09/10, QUE-08)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: SCH-02, SCH-08, SCH-09, SCH-10, QUE-08, OQ-03/OQ-12

**Konteks**: Absensi adalah TOMBOL PEMBUKA antrean (P1). Jam harus dari SERVER dan tidak
bisa diatur mundur (I-09) untuk mencegah "absen titipan". Alpa otomatis pada batas
(default 10:00 WIB, dapat diatur Admin, OQ-12).

**Keputusan**:
- Migrasi `202607290011_absensi_gerbang.sql`: kolom `absensi_petugas.sumber/dicatat_oleh`,
  status `alpa`; tabel `layanan_hari`; fungsi `catat_absensi()` (jam `now()` server,
  bukan klien), `antrean_dibuka()` (gerbang SCH-02), `tandai_alpa_otomatis()` + cron;
  `site_settings.batas_jam_alpa=10:00`; enum visit + `tidak_terlayani` (QUE-08).
- `admin/absensi/page.tsx`: absen hadir kini memakai `catat_absensi()` (jam server);
  label `alpa` & `tidak_terlayani` ditambahkan di UI (OPS-08).

**Verifikasi**: di produksi — fungsi/kolom/cron/settings ada; `catat_absensi` menolak
sumber tidak valid; `antrean_dibuka` mengembalikan boolean; `tsc` bersih; `vitest`
**83/83 files, 525/525 tests passed**; `next build` sukses.
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md`.
**Status**: Code-complete + diterapkan di produksi.

---

## WP-18 — Notifikasi petugas bersyarat + eskalasi + kontak instansi (NOT-01..07, SVC-06)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: NOT-01..07, SVC-06

**Konteks**: Email layanan bersifat INSTITUSIONAL, tidak berganti meski PIC berubah
(menjawab kebutuhan di balik RBA-07). Pengingat hanya jika KETIGANYA (NOT-02): jadwal
ADA ∧ petugas belum absen ∧ sudah ada pendaftar — **JANGAN** kirim setiap ada pendaftar.

**Keputusan**:
- Migrasi `202607290012_layanan_kontak_notifikasi.sql`: tabel `layanan_kontak` (email
  per peran pic/atasan/cc + kontak instansi); fungsi `kirim_pengingat_petugas()` dengan
  tiga jenis — `h1` (H-1 sore→PIC), `pagi` (H-0 pagi→PIC bila belum absen), `eskalasi`
  (lewat batas→atasan+FO, bukan petugas); idempoten per layanan/tanggal/jenis (NOT-05);
  fungsi `metrik_kepatuhan()` (NOT-07: % hadir, hari alpa, warga terdampak, rata-rata
  telat) yang menyebut **nama layanan, bukan nama orang**.
- 3 cron: H-1 sore, H-0 pagi, eskalasi berkala.

**Verifikasi**: di produksi — **NOT-02 syarat ke-3 terbukti** (tanpa pendaftar → 0
email); `metrik_kepatuhan` mengembalikan struktur benar; kontak uji dibersihkan; `tsc`
bersih; `vitest` **83/83 files, 525/525 tests passed**.
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md`.
**Status**: Code-complete + diterapkan di produksi. Email mulai terkirim setelah kontak
PIC/atasan diisi Admin.

---

## WP-19 — FO menonaktifkan akun satu arah + pergantian PIC (RBA-08, RBA-07, RBA-09)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: RBA-08, RBA-07, RBA-09

**Konteks**: Wewenang satu arah aman — FO menonaktifkan (tidak bisa mengaktifkan
kembali), Admin mengaktifkan. Pergantian PIC memakai keputusan pemilik: satu layanan
satu akun, reset password oleh Admin + akhiri sesi lama.

**Keputusan**:
- API `POST /api/admin/petugas/status`: aksi `nonaktifkan` (FO/Admin, wajib alasan,
  Admin diberi tahu via `notifikasi`), `aktifkan` (hanya Admin), `ganti_pic` (hanya
  Admin: `auth.admin.signOut(global)` untuk mengakhiri sesi lama I-23 +
  `inviteUserByEmail` ke pemegang baru + catat `audit_log` garis waktu).
- UI `admin/petugas/page.tsx`: kolom Status + tombol Nonaktifkan/Aktifkan/Ganti PIC;
  opsi role `front_office` di select; baris nonaktif tampil pudar.
- Memakai fungsi `petugas_set_nonaktif`/`petugas_set_aktif` (WP-06) — tanpa migrasi baru.

**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 525/525 tests passed**; `next build`
sukses (`/api/admin/petugas/status` terdaftar).
**Status**: Code-complete. **Fase 2 (fondasi kepatuhan petugas) selesai** — WP-15 s.d WP-19.

---

## WP-20 — Struktur `kunjungan` + `tiket_antrean` (QUE-01, GST-01) — OPS-01 Langkah 1 TAMBAH

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: QUE-01 (fondasi), GST-01 (fondasi), SVC-02/03, QUE-16, OPS-01/OPS-02

**Konteks**: Pemecahan `visit` adalah operasi paling berisiko di dokumen. Mengikuti
OPS-01/02 secara penuh: Langkah 1 hanya MEMBUAT struktur KOSONG, tidak mengubah
perilaku `visit` yang live. Prasyarat terpenuhi: WP-02 (observability) & WP-11
(cadangan manual FO).

**Keputusan**:
- Migrasi `202607290013_kunjungan_tiket.sql`: kolom `layanan` (penyerta, status_tampilan,
  bendera, `batas_ambil_nomor_menit`, `kuota_harian`); tabel `kunjungan` (satu kedatangan/
  orang/hari) + `tiket_antrean` (satu nomor/layanan, FK kunjungan) dengan
  `UNIQUE(layanan_id,tanggal,nomor)` (I-01); fungsi `terbit_tiket()` (memakai
  `terbit_nomor_antrean` WP-05, atomik); RLS ketat sesuai matriks.
- `visit` **tidak diubah/dihapus** — tetap sumber kebenaran sampai Langkah 4.

**Verifikasi**: di produksi — struktur **kosong** (visit tidak tersentuh); `terbit_tiket`
menghasilkan **2 tiket unik** (`B-001`, `B-002`) untuk 1 kunjungan dengan prefiks dari
nama layanan; UNIQUE constraint ada; dummy dibersihkan; `tsc` bersih; `vitest`
**83/83 files, 525/525 tests passed**.
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md`.
**Status**: Code-complete + diterapkan (struktur kosong). Menunggu persetujuan untuk
Langkah 2 (backfill + dual-write, WP-21).

---

## WP-09 — Tes RLS berbasis perilaku (SEC-04)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: SEC-04

**Konteks**: Kebijakan RLS selama ini hanya diuji dengan static parsing, bukan
perilaku per-peran. Kebijakan yang ada belum tentu bekerja seperti yang diyakini
(terbukti di WP-07: RLS saja tidak menahan service_role).

**Keputusan**:
- Buat harness `scripts/run-rls-tests.mjs` yang memverifikasi **perilaku** RLS di DB
  nyata (mensimulasikan peran via `request.jwt.claims` + verifikasi policy/trigger).
- 5 skenario awal (fondasi, akan diperluas untuk CMP-06/I-15): I-22 petugas nonaktif
  → role NULL; `error_log` admin_read; I-08 trigger `jhb_no_update`; `antrean_counter`
  deny_all; `skm_response_rate` tanpa policy tulis langsung.
- Tambah npm script `test:rls`.

**Verifikasi**: 5/5 skenario RLS perilaku **lolos** di produksi.
**Catatan**: harness ini dirancang agar tidak meninggalkan data uji (pakai fungsi
temporer yang di-DROP). Akan diperluas untuk uji jalur integritas pengaduan (I-15).
**Status**: Selesai (fondasi); tidak ada perubahan DB.

---

## WP-10 — Tegakkan Content-Security-Policy (SEC-01)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: SEC-01

**Konteks**: CSP masih `Content-Security-Policy-Report-Only` — hanya melapor, tidak
memblokir apa pun.

**Keputusan**:
- `next.config.ts`: ganti header ke `Content-Security-Policy` (ditegakkan).
  Kebijakan yang sama dipertahankan (`'unsafe-inline'` untuk script/style) sehingga
  transisi tidak memutus fungsi yang ada.
- Pelanggaran inline-script yang nyata akan dibersihkan bertahap di WP lain saat
  halaman disentuh (OPS-07); untuk sekarang kebijakan ditegakkan dengan mode aman.

**Verifikasi**: `next build` sukses; `eslint next.config.ts` bersih; header kini
menegakkan (bukan report-only).
**Status**: Code-complete. Efek penuh setelah deploy + pemantauan laporan pelanggaran.

---

## WP-11 — Prosedur cadangan manual FO (OPS-05)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: OPS-05 (prasyarat Fase 3)

**Konteks**: Sebelum menyentuh alur antrean, harus ada cara FO tetap bekerja bila
sistem gagal — pelayanan publik tidak boleh berhenti karena satu penerapan gagal.

**Keputusan**:
- Buat `docs/CADANGAN_MANUAL_FO.md`: prosedur cadangan untuk antrean loket, buku
  tamu, absensi petugas, dan pengaduan (termasuk pemisahan jalur integritas yang
  tetap tertutup), plus checklist pemulihan setelah sistem pulih.

**Verifikasi**: dokumen siap dipakai; akan diuji simulasi 15 menit sebelum WP Fase 3.
**Status**: Selesai (dokumen). **Prasyarat Fase 3 kini terpenuhi** (bersama WP-02
observability).

---

## WP-12 — Kanal pengaduan dua jalur (CMP-01..08, UU 25/2009)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: CMP-01..08, OQ-05, OQ-07

**Konteks**: Kewajiban hukum UU 25/2009 — hal pertama yang dicari penilai eksternal.
Kanal pengaduan DPMPTSP saat ini berjalan terpisah di luar LMH (11.2 #3); LMH membangun
kanal baru yang ke depan menyatukan. Format tiket diputuskan `P`+acak (bukan berurutan)
setelah pemilik diingatkan risiko penebakan jalur integritas.

**Keputusan**:
- Migrasi `202607290007_pengaduan.sql`: tabel `pengaduan` (nomor tiket acak, jalur
  layanan/integritas, SLA), `pengaduan_riwayat`, `hari_libur`; fungsi
  `tambah_hari_kerja()` (Sabtu/Minggu/libur), `buat_pengaduan()`, `lacak_pengaduan()`,
  `eskalasi_pengaduan_lewat_batas()` + cron; bucket privat `pengaduan-bukti`.
- **Dua jalur RLS (CMP-06/I-15)**: jalur layanan → admin/FO/petugas-layanan; jalur
  **integritas → HANYA admin** (bukan petugas, bukan FO).
- Halaman publik `/pengaduan` (buat, tanpa login wajib) + `/pengaduan/lacak`
  (tiket+kontak, rate limit); dashboard `/admin/pengaduan` dengan badge SLA
  (penanda warna mendekati batas, CMP-03) + aksi ubah status.
- Eskalasi otomatis ke status `eskalasi` saat batas penanganan terlampaui (CMP-04).

**Temuan proses penting**: `exec_sql`/`exec_query` (SECURITY DEFINER, service_role)
**melewati RLS** — sehingga tidak bisa membuktikan penolakan RLS. Uji perilaku penuh
I-15 (petugas & FO tidak bisa membaca integritas) membutuhkan JWT per-peran nyata,
yang akan dilakukan saat akun petugas/FO ada (Fase 2). Struktur policy sudah diverifikasi
benar (7/7 skenario RLS lolos).
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md` (self-test dibersihkan).
**Verifikasi**: `tsc` bersih; `vitest` **83/83 files, 522/522 tests passed**; `next build`
sukses (6 rute pengaduan terdaftar); uji fungsi di produksi (buat, lacak, SLA hari kerja)
berhasil dan dibersihkan.
**Status**: Code-complete + diterapkan di produksi.

---

## WP-08 — Catat response rate SKM (SRV-03, SEC-15)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: SRV-03, SEC-15 (sebagian)

**Konteks**: Penilai eksternal selalu menanyakan response rate SKM (berapa dilayani
vs berapa mengisi), dan datanya tidak bisa dibuat surut.

**Keputusan**:
- Migrasi `202607290006_skm_response_rate.sql`: tabel `skm_response_rate`
  (per layanan/tanggal, Asia/Jakarta), fungsi `skm_rr_tambah()`, trigger
  `trg_visit_selesai_rr` (visit→selesai = +dilayani) dan `trg_skm_insert_rr`
  (respons SKM = +mengisi).

**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md` (aditif; trigger hanya
membaca `visit`/`skm_respons`, tidak mengubahnya).
**Verifikasi**: uji nyata di produksi — fungsi & kedua trigger bekerja; hitungan
dilayani/mengisi bertambah; uji dibersihkan.
**Status**: Code-complete + diterapkan di produksi.

---

## WP-21 — Backfill + dual write (QUE-01, QUE-04, GST-01, GST-03, OPS-02)

**Tanggal**: 30 Juli 2026
**Memenuhi keputusan**: QUE-01, QUE-04, GST-01, GST-03, OPS-02

**Konteks**: Langkah 2 OPS-01/02 — mengisi tabel `kunjungan`/`tiket_antrean`/`buku_tamu` (dibuat kosong di WP-20) dari data `visit` yang sudah ada, lalu mengaktifkan trigger dual write agar setiap perubahan `visit` ke depannya langsung tercermin di tabel target secara atomik.

**Keputusan utama — QUE-04: tiket diterbitkan saat scan, bukan saat reservasi dibuat:**
- Reservasi loket yang belum check-in (`status='terjadwal'`) mendapat `kunjungan` tetapi **tidak mendapat tiket** saat INSERT.
- Tiket diterbitkan oleh trigger saat transisi `terjadwal→menunggu` dengan `waktu_scan IS NOT NULL` (yaitu saat warga scan QR fisik di kantor). Ini memastikan nomor antrean hanya terbit untuk warga yang benar-benar hadir, bukan sekadar memesan.
- Walk-in (`asal='walk_in'`) tetap mendapat tiket langsung saat pertama kali INSERT (tidak melalui `terjadwal`).

**Keputusan — GST-03: buku tamu hanya untuk kedatangan fisik:**
- Meeting visit (`tujuan='bertemu_seseorang'`) yang hanya reservasi (belum scan) **tidak masuk buku_tamu**.
- Entri buku tamu dibuat oleh trigger saat transisi ke `menunggu` + `waktu_scan IS NOT NULL` — yaitu saat tamu scan QR di meja FO. Backfill historis hanya memetakan meeting visit yang sudah terscan.

**Keputusan — keterlacakan berbasis `wp21_backfill_ledger`:**
- Setiap baris `visit` sumber dicatat di `wp21_backfill_ledger` dengan FK ke `kunjungan`/`tiket_antrean`/`buku_tamu` yang dihasilkan. Ini memungkinkan verifikasi asal data dan rollback yang bisa dilacak.
- Rollback aman: `TRUNCATE kunjungan, tiket_antrean, buku_tamu, wp21_backfill_ledger CASCADE` — data `visit` asli tidak disentuh.

**Dua migrasi terpisah:**
- `202607300014_buku_tamu.sql` (M15): tabel `buku_tamu` + RLS. Aditif, bisa di-rollback dengan mengabaikan.
- `202607300015_backfill_kunjungan_dual_write.sql` (M16): linkage, ledger, backfill, repair counter, trigger atomik, `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. Dikunci `SHARE ROW EXCLUSIVE` selama eksekusi untuk mencegah write bersamaan.

**Verifier operasional:** `scripts/selftest-wp21.mjs` — memverifikasi kesiapan M15/M16, cakupan historis, dan siklus hidup penuh (reservasi→scan→lifecycle→cleanup) termasuk perlindungan SKM aggregate.

**Dampak DB**: akan dicatat di `docs/analysis/DB-CHANGES.md` saat diterapkan ke produksi (Phase 4).
**Verifikasi**: `node --check scripts/selftest-wp21.mjs` → OK; `npm test -- supabase/migrations/kunjungan_dual_write.test.ts` → 2/2 passed; statik M15/M16 clean.
**Status**: Code-complete (M15+M16 siap). Belum diterapkan ke produksi — menunggu jendela di luar jam layanan.

---

## WP-07 — Pembekuan jadwal harian (SCH-05, I-08)

**Tanggal**: 29 Juli 2026
**Memenuhi keputusan**: SCH-05 (fondasi SCH-10, NOT-07, I-08)

**Konteks**: Tanpa pembekuan, laporan kepatuhan bisa dianulir cukup dengan mengedit
satu baris jadwal secara surut. Datanya tidak bisa dibuat surut.

**Keputusan**:
- Migrasi `202607290005_jadwal_harian_beku.sql`: tabel `jadwal_harian_beku`
  (snapshot per layanan/tanggal), fungsi `bekukan_jadwal()` (sumber sementara dari
  `layanan_jadwal` + `layanan_libur`), cron `bekukan_jadwal_harian` tiap malam.
- **I-08 ditegakkan lewat TRIGGER `jhb_tolak_ubah()`**, bukan hanya RLS — karena
  service_role melewati RLS. UPDATE/DELETE ditolak untuk SEMUA peran; maintenance
  memakai `SET app.jhb_allow='on'` dalam satu sesi.

**Temuan proses penting**: awalnya I-08 hanya mengandalkan RLS; uji nyata membuktikan
service_role tetap bisa mengubah nilai. Diperbaiki dengan trigger. Ini menegaskan
nilai uji perilaku (SEC-04) dibanding static check.
**Dampak DB**: dicatat di `docs/analysis/DB-CHANGES.md`.
**Verifikasi**: uji nyata di produksi — pembeku mengisi 10 baris (Senin, semua
standby), UPDATE & DELETE ditolak trigger, nilai utuh; baris uji dibersihkan.
**Status**: Code-complete + diterapkan di produksi.
