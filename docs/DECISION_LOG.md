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

---

## RBAC Tahap 0 — keamanan darurat (migrasi 202610080001/2)

**Tanggal**: 8 Oktober 2026
**Konteks**: audit hak akses menemukan fungsi SECURITY DEFINER tanpa cek peran, policy INSERT
`WITH CHECK (true)` pada `kunjungan`/`tiket_antrean`, petugas dapat menyetujui absensinya
sendiri, dan akun nonaktif masih lolos policy berbasis layanan. Detail: `docs/RBAC_USULAN_DRAFT.md`
(S1-S6, N7), runbook: `docs/RUNBOOK_RBAC_TAHAP0.md`.
**Keputusan**:
- Dua migrasi forward: `202610080001` (semua kecuali S6) dan `202610080002` (hak tulis `layanan`
  petugas + jadwal/libur = Admin saja, diterapkan SETELAH UI diganti).
- **Absensi foto — opsi (ii)**: `202608310003_absensi_foto_fo.sql` (belum pernah diterapkan di
  produksi, bukan baseline) dinetralkan menjadi stub no-op "SUPERSEDED". `catat_absensi`
  tetap 3 argumen (CREATE OR REPLACE atomik, tanpa DROP/overload). Kolom `foto_url` dan bucket
  `absensi-foto` dikerjakan di migrasi Tahap 1 setelah desain cek akses selesai.
- Penerapan wajib **atomik** (`scripts/apply-migration.mjs --atomic --yes`), bukan per-statement.
- Bug produksi `guard_absensi_tanggal_today()` (`pg_catalog.CURRENT_DATE` tidak valid) diperbaiki;
  cron `absensi_alpa_otomatis` dijeda sampai absensi benar-benar dipakai (lihat runbook).
**Dampak**: UI absensi/FAQ/jadwal perlu penyesuaian (daftar handoff di laporan S0).
**Status**: kode siap ditinjau; belum diterapkan di produksi.


---

## Fase 3 — Audit fondasi, sesi tunggal, alur FO → eskalasi (2026-10-13 s.d. 2026-10-14)

**Tanggal**: 13-14 Oktober 2026 · Branch `feat/audit-fondasi-fo-eskalasi` (lokal; belum di-push) · Rencana: `docs/superpowers/plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md`, spec: `docs/superpowers/specs/2026-10-12-alur-fo-eskalasi-design.md`.
**Status keseluruhan**: kode ditulis dan diuji lokal; migrasi `202610140001` DITERAPKAN ke produksi (2026-10-13); `0002`-`0009`, `0011`, dan `0012` DITULIS, BELUM DITERAPKAN; klien Tahap A-D belum di-deploy. Tahap E (survei terpadu) belum dimulai.

### Keputusan CEO — Gerbang G (dijawab 2026-10-13)

| # | Pertanyaan | Keputusan |
|---|---|---|
| G.1 | WP-24 / tulis `visit` | **Opsi A**: hentikan tulis `visit` bersamaan Tahap B; `trg_visit_dual_write` dinonaktifkan; data lama menjadi arsip; ada rollback; cutover di luar jam layanan. |
| G.2 | Batas sesi | Logout otomatis setelah jam tutup layanan (16:00 WIB, dibaca dari pengaturan, bukan hardcode) dan idle 2 jam (`sesi_idle_menit` = 120, dapat diubah Admin). |
| G.3 | Kolom identitas terkunci | **Opsi A**: hanya **Nama Lengkap** (profil pengunjung tidak punya kolom NIK). HP, instansi, kategori, email tetap dapat diubah pengunjung. Perubahan nama lewat FO/Admin + `audit_log`. |
| G.4 | Topik penanganan per layanan | **Opsi A**: draf awal dari daftar layanan produksi (`docs/superpowers/specs/2026-10-13-topik-penanganan-draf.md`), disimpan di tabel `topik_penanganan` yang dapat diubah Admin tanpa deploy. |
| G.5 | Field Pendataan Pelayanan | **Opsi A**: SEMUA field wajib; field usaha yang memang tidak ada diisi eksplisit "Belum ada"/"Tidak berlaku"; catatan boleh "-". Divalidasi di DB (`INVALID_PAYLOAD`) dan UI. |
| G.6 | Jadwal cutover | Hanya setelah jam tutup (setelah 16:00 WIB) dan hanya bila antrean kosong; **Jumat sore atau akhir pekan**; didahului skrip uji perilaku (transaksi di-rollback) yang hijau; petugas diberi tahu sebelum hari H. |

### Keputusan CEO — butir 7.x kepemilikan tiket (migrasi `202610140002`)

- **7.1**: Admin BOLEH memulai dan menjadi pemilik tiket layanan mana pun; petugas hanya layanannya; Front Office ditolak.
- **7.2**: jalur darurat `admin_ambil_alih(tiket, alasan)` (Admin, alasan >= 5 karakter, `audit_log`) dimajukan ke Tahap A.
- **7.3**: backfill `dilayani_oleh` untuk tiket `dilayani` yang NULL dari `audit_log` (aktor transisi terakhir -> `petugas.id`; yang tak terpetakan dibiarkan NULL dan dapat diambil alih Admin).
- **7.5**: draf pendataan hanya boleh ditulis pemilik tiket `dilayani` (route PATCH + RLS).
- 7.4 (kolom `layanan.form_pendataan`) tidak dikerjakan di Tahap A: validasi pendataan tidak diubah; `petugas_id` = pemilik saat diselesaikan.

### Keputusan teknis

1. **Arah tulis antrean Tahap A = Opsi 1** (`docs/analysis/ANTREAN-ARAH-TULIS.md` §6): RPC `layanan_mulai`/`layanan_selesai` menulis `tiket_antrean` sebagai sumber kebenaran (guard atomik), lalu `visit` dalam transaksi yang sama; urutan kunci `visit` -> `kunjungan` -> `tiket`. `tiket_staff_update` dicabut, trigger penjaga `trg_guard_visit_transisi_layanan` menolak UPDATE langsung (`TRANSISI_LEWAT_RPC`), `finalize_pelayanan` menjadi pembungkus. WP-24 tidak dimajukan pada Tahap A.
2. **WP-24 = Opsi A (migrasi `0007`/`0008`)**: `visit` menjadi arsip baca saja (8 trigger efek dinonaktifkan, `trg_visit_arsip`, hak tulis dicabut); SKM, notifikasi, response rate, audit, estimasi, pengingat pindah ke `kunjungan`/`tiket_antrean`; reservasi lama dilengkapi/dibuatkan `kunjungan`. Tahap/tiket yang tertinggal ditutup otomatis pukul 23:00 WIB (`batal_karena='tidak_ditutup'`; kunjungan -> `selesai`; `waktu_selesai` tiket NULL agar durasi tidak tercemar). Retensi 730 hari diperluas ke `kunjungan`, `penanganan.catatan`, dan arsip `visit`.
3. **Sesi tunggal**: tabel `sesi_staf` + RPC `daftarkan_sesi`/`ping_sesi`/`akhiri_sesi`; semua RPC mutasi memanggil `sesi_valid()`. Flag `sesi_tunggal_aktif` = false selama transisi; baru `true` setelah klien ter-deploy, staf login ulang, dan klaim `session_id` JWT terbukti stabil (belum dibuktikan).
4. **Alur FO -> eskalasi**: FO melayani dulu tanpa tiket (`fo_mulai_kunjungan`, `fo_checkin_reservasi`); tiket baru terbit hanya saat eskalasi (`fo_eskalasi`, nomor `<KODE 2 huruf>-<nnn>`); tahap per kunjungan di tabel `penanganan` (topik + catatan wajib: FO <= 200, layanan <= 1000); petugas dapat mengembalikan ke kotak masuk FO (`layanan_kembalikan`); Admin mengalihkan antar layanan (`admin_alihkan`). Semua perubahan status lewat RPC; klien tanpa INSERT/UPDATE/DELETE pada `kunjungan`/`tiket_antrean`/`penanganan`. Deviasi sadar dari spec: `docs/analysis/FO-ESKALASI-KONTRAK-RPC.md` §8 (mis. Admin boleh bertindak sebagai FO; masih perlu konfirmasi CEO).
5. **Chat dicatat saat eskalasi** (`0009`): sesi chat menjadi kunjungan `online` saat berstatus `eskalasi` atau saat staf mengambil sesi `bot`; tanpa tiket; aksi staf hanya lewat `chat_ambil`/`chat_teruskan`/`chat_selesai` (`CHAT_HARUS_RPC` menolak ubah langsung). Sesi yang tuntas oleh bot tidak dicatat. Kapan dicatat (§7.1) dan penghapusan "kembali ke bot" (§7.2) **disetujui CEO 2026-10-14** (lihat bagian di bawah); pengembalian chat ke FO dan notifikasi FO masih pertanyaan terbuka (`FO-CHAT-KONTRAK-RPC.md` §7).
6. **Pendataan semua field wajib** (`0011`, G.5): `pendataan_validasi_payload` dipanggil `layanan_selesai` (OSS 14 field, Perizinan 11 field); pilihan "Belum ada"/"Tidak berlaku" ditambahkan (CHECK dilonggarkan, superset); draf (autosave) tetap longgar; data lama tidak divalidasi ulang.
7. **Kunci nama pengunjung** (`0006`, G.3): trigger `trg_jaga_nama_pengunjung` (`NAMA_TERKUNCI`/`PROFIL_WAJIB_LENGKAP`) + RPC `ubah_nama_pengunjung` (admin/FO, alasan wajib, `audit_log`); pernyataan kebenaran dicatat di `consent_log` (tujuan `pernyataan_kebenaran`) sebelum profil disimpan.
8. **Rekap**: rekap harian FO (`/admin/rekap-fo`) dan performa pelayanan (`/admin/performa`, Admin saja) dibaca dari `penanganan`; rekap layanan (tab Rekap Petugas Layanan) semula hanya Admin dan Petugas. **Digantikan keputusan CEO 2026-10-14 "Keterbukaan data antar Front Office" (lihat bagian di bawah)**: semua FO melihat rekap FO dan rekap layanan seluruhnya (semula: FO hanya miliknya / hanya eskalasi asal dirinya).
9. **Check-in mandiri dihapus**: `/checkin` menjadi halaman informasi statis; `POST /api/checkin` dihapus; walk-in dan scan QR hanya Front Office. Replay antrean offline memakai `fo_mulai_kunjungan` (entri kedaluwarsa hari lain dibuang). Dasar/consent walk-in oleh FO masih pertanyaan terbuka (`docs/KEBIJAKAN_PDP.md`).
10. **Proses**: migrasi baru hanya forward + test kontrak + rollback `docs/rollback-*.sql`; penerapan lewat `scripts/apply-migration.mjs --atomic` dengan konfirmasi CEO; urutan dan larangan terap ulang 0004/0005 setelah 0007 tercatat di `docs/MIGRATIONS.md`. Gerbang lokal (`verify:baseline`), bukan GitHub Actions.

### Keputusan CEO — setelah review independen (dijawab 2026-10-14)

Diterapkan dengan mengedit in-place `202610140012_perbaikan_review.sql` (belum diterapkan ke produksi; manifest diregenerasi) beserta rollback, test statis, dan skrip uji perilaku.

1. **Pendataan wajib tanpa pengecualian peran** (mengubah desain awal `0012` #1): Admin, termasuk Admin yang mengambil alih tiket (`admin_ambil_alih`), **wajib** mengisi Formulir Pendataan lengkap untuk layanan wajib-form (`layanan.form_pendataan`); `layanan_selesai` menolak `INVALID_PAYLOAD` untuk semua peran. Pengecualian "Admin pengambil alih menutup tanpa form" dan audit `layanan_selesai_tanpa_pendataan` dihapus. Satu-satunya jalur penutupan tanpa form adalah **jalur otomatis**: job `tutup_penanganan_tertinggal` (`0008`, 23:00 WIB) menutup tiket `dilayani` yang macet tanpa data (tiket `selesai` dengan `waktu_selesai` NULL, tahap `batal`/`tidak_ditutup`, `audit_log` `tutup_otomatis_penanganan`). UI `/admin/antrian` membuka wizard pendataan untuk pemilik tiket termasuk Admin (diuji).
2. **Live chat pada hari tanpa pelayanan** = Sabtu, Minggu, atau tanggal di tabel `hari_libur` (aturan sama dengan bot: `src/lib/llm/bot-waktu.ts` `hariTanpaLayanan` = DB `public.hari_tanpa_layanan(date)`; tidak memakai `jadwal_standby` per layanan karena chat bersifat lintas layanan):
   - `/chat`: pemberitahuan jelas (role=note) bahwa live chat dengan petugas tidak tersedia, hanya tanya-jawab dengan bot, hari kerja berikutnya, dan kanal kontak dari Pengaturan (`wa_number`, `contact_email`, hanya bila terisi); tombol "Hubungkan ke Petugas" disembunyikan; layanan tanpa bot tidak dapat dipilih; sesi `eskalasi` yang masih terbuka dijawab bot. Teks tetap di kode (`src/lib/chat/hari-tanpa-layanan.ts`); tidak ada UI pengaturan baru.
   - `/api/chat/ai`: tidak mengeskalasi pada hari itu, termasuk jalur gagal (injeksi prompt, konteks/LLM gagal) -> balasan menyarankan menghubungi kembali pada hari kerja/kanal pengaturan (`reason` = `hari_tanpa_layanan`). Setelah jam tutup pada HARI KERJA perilaku lama tidak berubah.
   - DB (`0012` #13): `chat_ambil` dan `chat_teruskan` menolak `HARI_TANPA_LAYANAN` (P0001) untuk semua peran (termasuk ambil alih Admin); trigger eskalasi (`chat_sesi_eskalasi_kunjungan`, `chat_pesan_eskalasi_kunjungan`) tidak membuat kunjungan/kotak masuk FO pada hari itu. `chat_selesai` tidak diubah (pemegang chat dari hari kerja tetap dapat menutup). `chat_teruskan` ikut ditolak (tambahan teknis: petugas tujuan tidak bertugas).
   - `/admin/chat`: tombol Ambil Chat / Ambil Alih / Teruskan dinonaktifkan dengan alasan (banner + `aria-describedby`).
   - Chat yang menunggu dari hari kerja terakhir dan tidak sempat diambil tetap ditutup `tutup_chat_tertinggal` (ambang 24 jam tidak diubah).
3. **Rekap layanan untuk Front Office** (*batasnya DIGANTIKAN oleh keputusan "Keterbukaan data antar Front Office" di bawah*): tab "Rekap Petugas Layanan" (`/api/admin/rekap/penanganan` + `/export`, peran `layanan`) kini boleh dilihat FO, **terbatas** pada tahap layanan dari kunjungan yang punya tahap FO dengan `penangan_id` = FO pemanggil (eskalasi asal dirinya). Cakupan ini sudah diizinkan RLS `boleh_penanganan` (`0009`), sehingga dibaca dengan klien pengguna: tanpa service-role, tanpa migrasi, RLS tidak dilonggarkan. Tab memuat catatan bahwa angkanya bukan rekap lengkap layanan. `/admin/performa` tidak berubah (Admin saja). Matriks: `04-RBAC-MATRIX.md` §6.1.
4. **Disetujui tanpa perubahan kode**:
   - chat dicatat sebagai kunjungan saat eskalasi (`FO-CHAT-KONTRAK-RPC.md` §7.1);
   - aksi "kembali ke bot" dihapus (§7.2);
   - batas tutup otomatis chat 24 jam tanpa aktivitas (`tutup_chat_tertinggal`);
   - walk-in lama berstatus `terjadwal` dibatalkan (`batal`, bukan `no_show`; `0012` #5);
   - `total_hadir` rekap harian = pengunjung (kunjungan) berbeda per layanan per hari (`0012` #10);
   - opsi "Tidak berlaku" pada `tipe_pelaku_usaha` & `skala_usaha` (CHECK dilonggarkan) dan identitas pemohon wajib (diisi "Tidak berlaku" bila kosong) (`0011`);
   - **pertanyaan terbuka**: tautan walk-in ke akun pengunjung tetap konservatif (`fo_mulai_kunjungan` hanya menerima `p_pengunjung_id` yang punya kunjungan bertanggal hari ini; `0012` #12) sampai ada keputusan lain.

**Dampak DB**: `docs/analysis/DB-CHANGES.md`. **Runbook**: `docs/RUNBOOK_FO_ESKALASI.md`. **Matriks akses**: `docs/analysis/04-RBAC-MATRIX.md` §6.

### Keputusan CEO — keterbukaan data antar Front Office (2026-10-14)

Kata CEO: "role FO itu walaupun petugas FO ada banyak, tapi semua antrian, semua pengunjung, rekap, dll itu terbuka untuk semua FO, tapi nanti di setiap pengunjung ada nama petugas FO yang melayani itu siapa."

1. **Semua FO adalah satu unit layanan**: data FO tidak dipersempit per FO. Menggantikan "FO hanya melihat rekap miliknya" (butir 8 di atas) dan "rekap layanan FO terbatas eskalasi asal dirinya" (butir 3 keputusan sebelumnya).
2. **Baca saja**: migrasi `202610140013_fo_keterbukaan_data.sql` (BELUM DITERAPKAN) mengganti `boleh_penanganan` sehingga FO aktif membaca semua `penanganan` (tahap `fo` dan `layanan`). Tidak ada hak tulis baru: tabel tetap tanpa policy tulis klien; RPC tetap menolak FO yang bukan pemilik tahap (`BUKAN_PEMILIK`), pengambilan kotak masuk tetap atomik (`SUDAH_DIAMBIL`). Petugas layanan, pengunjung, dan anon tidak berubah.
3. **Tabel lain tidak diubah**: `kunjungan`, `tiket_antrean`, `pelayanan_oss`/`pelayanan_perizinan` (isi Pendataan, dibutuhkan kolom Pendataan rekap layanan), `petugas` (nama), `chat_sesi` sudah terbuka untuk semua FO sebelumnya. `pengunjung` (profil akun) tetap tidak dibuka untuk FO.
4. **Nama FO yang melayani** tampil di: Penanganan Saya (riwayat hari ini semua FO + seksi "Sedang ditangani Front Office lain", baca saja), Kotak Masuk FO (FO sebelumnya untuk item dikembalikan), Kelola Kunjungan (kolom Front Office), Rekap FO (sudah ada) dengan filter FO untuk semua FO, tab Rekap Petugas Layanan (kolom Front Office baru, juga di Excel), Antrian (catatan eskalasi "oleh <FO>", sudah ada).
5. **Audit akses**: tidak menambah pencatatan per-baca (dicatat sebagai pertimbangan, bukan fitur): ekspor Excel tetap tercatat di `audit_log`; pembaca hanya staf aktif ber-sesi; setiap baris memuat nama FO yang melayani. Bila kelak dibutuhkan, opsi ringan: catat pembukaan rekap/riwayat lintas-FO di `audit_log` (keputusan CEO).
6. **Pertanyaan terbuka**: `/admin/performa` tetap Admin saja (tidak diubah); apakah FO juga perlu melihatnya?

Matriks: `docs/analysis/04-RBAC-MATRIX.md` §6.4. PDP: `docs/KEBIJAKAN_PDP.md`.

### Keputusan CEO — tindak lanjut keterbukaan data antar FO (2026-10-14)

1. **`/admin/performa` tetap Admin saja.** Menjawab pertanyaan terbuka butir 6 di atas: FO tidak diberi akses performa.
2. **Tanpa audit per-baca antar-FO.** Menjawab butir 5 di atas: tidak ada pencatatan pembukaan rekap/riwayat lintas-FO; ekspor Excel tetap tercatat di `audit_log` (kini juga mencatat `fo_id` bila filter FO dipakai).
3. **Filter "Front Office yang mengeskalasi"** ditambahkan pada tab Rekap Petugas Layanan (`/admin/rekap`) dan ekspornya, berlaku untuk semua role yang melihat tab (Admin, Front Office, Petugas dalam layanannya). Parameter `fo_id` (uuid, opsional) pada `api/admin/rekap/penanganan[/export]`; FO = FO tahap `fo` terakhir sebelum tahap layanan itu (sama dengan kolom Front Office). Disaring di memori setelah pemetaan (FO berasal dari embed kunjungan), jadi total, ringkasan, dan ekspor konsisten. Opsi filter berasal dari `opsi_fo` pada respons (FO yang muncul pada rentang, sebelum disaring), bukan dari tabel `petugas`, karena Petugas layanan tidak boleh membaca daftar petugas (RLS `petugas_self_read`).
4. **Nama FO di tab Pendataan Helpdesk OSS, Non OSS, Rekap Per Layanan, dan panel detail tiket** (plus kolom "Front Office" di ekspor Excelnya, tepat setelah "Petugas"). Sumber: tahap `fo` ber-penangan terakhir pada kunjungan tiket itu. Tiket lama tanpa tahap FO tampil em dash. Rekap Per Layanan memakai embed pada kueri tiket yang sama (satu kueri, paginasi dan hitungan tidak berubah); tab OSS/Non OSS dan ekspornya memuat nama FO lewat `src/lib/rekap/foTiket.ts` (kueri terpisah per 100 tiket karena view `v_rekap_pelayanan_*` tidak memuat penanganan; gagal memuat tidak menggagalkan rekap, kolom jadi em dash). `rekap_harian_layanan` dan view tidak diubah; tanpa migrasi. Nama FO mengikuti RLS `penanganan`: sebelum 0013 diterapkan FO hanya melihat tahap miliknya (nama FO lain bisa tampil em dash), tidak bocor.
5. **Label menu umum**: "Penanganan Saya" diganti "Penanganan" (menu, judul halaman, teks di Scan, matriks RBAC, runbook). Alasan: halaman dilihat Admin dan Front Office, dan memuat juga penanganan FO lain. Entri log lama di atas tetap memakai nama lama sebagai catatan sejarah.
