# Changelog

Semua perubahan penting pada project LMH didokumentasikan di sini.
Format: [Keep a Changelog](https://keepachangelog.com/). Pemversian
mengikuti [Semantic Versioning](https://semver.org/).

## [2.4.0] — 2026-09-02

Rekap per layanan + pendataan pelayanan + no-show reservasi.

### Fitur
- **Rekap per layanan** (`/admin/rekap` tab ke-4): petugas auto-scoped ke
  `layanan_id` sendiri (RLS + API enforcement), admin/FO bisa pilih layanan
  via dropdown. Filter status `selesai`, search server-side (debounced,
  ILIKE lintas relasi), pagination 25/halaman, side panel detail tiket
  read-only (a11y: Escape/click-outside/`aria-modal`).
- **Export Excel** (`.xlsx` via exceljs, server-side): 26 kolom lengkap,
  header beku, cap 50.000 baris dengan header `X-Rekap-Truncated` + toast;
  setiap export tercatat di `audit_log` (aktor, layanan, rentang, total,
  truncated).
- **Pendataan pelayanan**: wizard Helpdesk OSS + Perizinan DPMPTSP dengan
  tombol simpan/selesaikan terpisah, finalisasi atomik via RPC
  `finalize_pelayanan` (celah otorisasi petugas per-layanan ditutup).
- **Reservasi no-show + QR hangus**: penanda `no_show`, guard trigger
  `trg_visit_qr_hangus`, pg_cron harian; QR reservasi kedaluwarsa otomatis
  hangus.
- **Absensi foto front-office**: kolom `foto_url` + bucket `absensi-foto`
  (private, 5MB) + param `p_foto_url` opsional di `catat_absensi`.

### Teknis
- `exceljs` ditambahkan untuk export server-side.
- CI kini juga dijalankan pada push/PR ke `development` (sebelumnya hanya
  `main`).
- Perbaikan test: mock antrian mengikuti chain stats `tiket_antrean` dan
  jalur `visit.update`; timeout checkin dinaikkan untuk stabilitas di full
  suite; daftar migrasi approved mencakup `202608310003_absensi_foto_fo`.
- `migration-docs.test.ts` tidak lagi spawn CLI (`npx supabase`) di suite —
  output `--help` dimock, menghilangkan flake timeout 20s di full suite.
- Rekap per layanan (follow-up): label kolom Excel berprefix
  `[OSS]`/`[Perizinan]`, `Content-Disposition` RFC 6266 (`filename*=` UTF-8),
  `formatTanggalId` date-only tanpa shift WIB, `todayWIB()` untuk default
  rentang, rata-rata durasi denominator skip baris null, `slugify` +
  `TicketsQueryParams` diekspor untuk dipakai caller.

## [2.2.0] — 2026-07-28

Audit role & fitur (petugas layanan, live chat, Gemini bot) — 10 temuan
diperbaiki + fitur jadwal layanan. Empat migrasi baru:
`202607280001_layanan_jadwal.sql`, `202607280002_chat_pesan_owner_strict.sql`,
`202607280003_faq_petugas_scope.sql`, `202607280004_chat_pesan_client_uuid.sql`.

### Fitur
- **Jadwal layanan**: `layanan_jadwal` (hari kerja + jam operasional per
  layanan) dan `layanan_libur` (tanggal libur spesifik). Antrian
  (walk-in/reservasi) ditolak saat libur via trigger DB
  (`guard_visit_layanan_buka`) + validasi UI reservasi; live chat tetap buka.
  Pengelolaan lewat halaman baru `/admin/settings/jadwal` (admin + petugas
  PTSP, flag baru `layanan.is_ptsp`).
- **Mode weekend live chat**: Sabtu–Minggu bot Gemini hanya menjawab hal umum
  dan tidak menawarkan eskalasi ke petugas.
- **Walk-in untuk petugas**: wizard walk-in diekstrak ke komponen bersama
  `WalkinWizard`, kini tersedia di dashboard admin dan `/admin/antrian`.
  Petugas hanya dapat meregistrasi ke layanannya sendiri.
- **Kelola petugas**: halaman baru `/admin/petugas` (daftar, edit nama/role/
  layanan). Undangan admin boleh tanpa layanan.
- **Takeover chat lengkap**: ambil alih mengisi `ditangani_oleh`; tombol baru
  "Kembalikan ke Bot" (status→`bot`, `ditangani_oleh`=null).
- Badge eskalasi Sidebar kini live via subscription `postgres_changes`
  (sebelumnya dihitung sekali saat mount).

### Keamanan & Integritas
- **Pesan bot ditulis server-side** di `/api/chat/ai` (insert + broadcast +
  update status eskalasi). Sebelumnya browser pengunjung yang menulis — pesan
  bot tidak dibroadcast ke petugas dan pengunjung bisa memalsukan pesan `bot`.
- RLS `chat_pesan_owner_insert` diperketat: owner sesi hanya boleh insert
  `pengirim='pengunjung'` (`202607280002`).
- Eskalasi chat kini benar-benar tercatat di DB (sebelumnya update status oleh
  pengunjung diblokir trigger guard → gagal senyap; badge "Menunggu Petugas"
  nyaris tidak pernah muncul).
- **Fix invite petugas**: email yang sudah terdaftar kini di-resolve
  (`listUsers`) lalu baris petugas di-upsert — sebelumnya balas 201 sukses
  palsu tanpa membuat petugas. Error FK/unique dibedakan pesannya.
- **Route guard `/admin/*`** (`AdminGuard`): non-staff → `/login`, petugas di
  halaman admin-only → `/admin/antrian`. Daftar akses tunggal di
  `src/lib/admin-nav.ts`, dipakai Sidebar + guard (fail-closed untuk route
  tak terdaftar).
- Petugas dapat CRUD FAQ layanannya + toggle chatbot layanannya (RLS scoped,
  `202607280003`); sebelumnya menu terbuka tapi simpan selalu ditolak RLS.

### Perbaikan Lain
- Embedding model disatukan via `getEmbeddingModel()` default
  `text-embedding-004` (768-dim, cocok kolom `vector(768)`; default lama
  `gemini-embedding-001` 3072-dim akan gagal insert).
- Idempotency chat: kolom `chat_pesan.client_uuid` untuk dedup pesan
  optimistic vs broadcast (menggantikan heuristic isi+pengirim).
- Pesan rate-limit jujur di chat pengunjung (429 → "coba sebentar lagi",
  bukan eskalasi palsu).

## [2.1.0] — 2026-07-26

Gelombang perbaikan audit pasca-rilis LMH 2.0.

### Keamanan
- RLS `visit` ownership — pengunjung hanya melihat kunjungannya sendiri.
- Column guard `chat_sesi` — batasi kolom yang dapat diubah pengunjung.
- Publish guard `listing_umkm` — petugas terbatas `draft`/`pending_review`;
  hanya admin yang publish.
- Trigger audit UPDATE `role` petugas (anti eskalasi diam-diam).
- Absensi anti-backdate (`trg_guard_absensi_tanggal`).
- Penguatan auth callback.
- (Semua di migration `202607200001_p0_security_governance.sql`.)

### Fitur & Integritas Data
- Integrasi Layanan Perizinan DPMPTSP Provinsi Lampung (tipe `konsultatif`) di database (`202607210001_walkin_kontak_dan_layanan_perizinan.sql`).
- Tambah kolom `no_hp` pada data `pengunjung` (`202607240001_pengunjung_no_hp.sql`) untuk verifikasi profil.
- UMKM owner-linking + consent PDP (`umkm_contact`) saat admin submit listing.
- QR/token SKM untuk pengunjung walk-in.
- Dashboard admin: angka/metrik kini akurat vs sumber data.
- Auto-embedding FAQ (trigger embed otomatis).
- Chat offline jujur — status offline ditampilkan apa adanya.
- Notifikasi balasan chat petugas, status inquiry UMKM, dan konfirmasi
  reservasi + dead-letter untuk notifikasi gagal retried ≥ 5x.
- Retensi `chat_ai_log` 90 hari (cron harian `prune_chat_ai_log()`).
- Fungsi publik `get_queue_position(qr_token)` untuk posisi antrean.

### UX Publik & Admin
- Expose menu-menu admin orphan di Sidebar (Hasil SKM, Log AI Chat, Tata Kelola Data, Undang Petugas) dengan dynamic role check.
- Navigasi mobile diperbaiki, posisi antrean tampil, modal aksesibel
  (a11y), migrasi ke `next/font`.

### Dokumentasi
- PRD.md, ARCHITECTURE.md, AUDIT_RESULTS.md diarsipkan ke `docs/archive/`
  dengan banner historis; sumber kebenaran: `docs/AUDIT_DAN_ROADMAP_INOVASI.md`.
- `MIGRATIONS.md` diperbarui mencatat migrasi ke-7 dan ke-8.

## [2.0.0] — 2026-07-11

### Fase 0 — Pengamanan Darurat
- **K1**: Tutup bocoran PDF investasi. Pipeline PDF→PNG per halaman +
  watermark dinamis. Endpoint raw PDF dinonaktifkan (410 Gone).
- **K2**: Tutup IDOR chat. RLS berbasis `pengunjung_id = auth.uid()`.
  Anon sign-in diaktifkan.
- **K3**: Rate limit insert publik via `check_anon_rate()` + trigger.
- **K4**: Hapus 9 akun `password123` hardcode. Flow undangan magic-link
  untuk petugas baru. Seed demo dipisah ke `seed-demo.sql`.
- **K5**: Magic-link UMKM via Supabase Auth (ganti edit-token mentah).

### Fase 1 — Fondasi Data & Tata Kelola
- **B2**: Kolom `tipe` di tabel `layanan` (konsultatif/mitra/modul_publik).
- **B4**: Pisahkan seed demo dari migration aktif.
- **B5**: Kebijakan akun mitra individual (dokumentasi).
- **A1**: Role di JWT claims via Auth Hook `set_user_role_claim()`.
- **I8**: Audit log + consent log + anonymisasi pg_cron + dashboard DPO.
- **I1**: Visit Spine — tabel `visit` terpadu + dual-write trigger dari
  `kunjungan` & `reservasi` + UI switch.

### Fase 2 — Dampak Warga Cepat
- **I3**: SKM digital (9 unsur PermenPANRB 14/2017), hitung IKM,
  dashboard pimpinan, halaman transparansi publik.
- **I2**: Antrean pintar — materialized view estimasi + view antrian loket
  + Realtime subscription.
- **I5**: Notifikasi email (Resend) + web-push (VAPID) + queue + retry
  + Vercel Cron.

### Fase 3 — Diferensiasi
- **I4**: Asisten AI ber-RAG (Gemini 1.5 Flash + text-embedding-004 +
  pgvector + match_faq RPC). Strict system prompt, eskalasi jika
  similarity < 0.7, audit log.
- **I6**: Funnel investor — `investasi_lead` table + CTA "Ajukan Minat
  Investasi" di Gallery + admin CRM-lite.
- **I7**: Marketplace UMKM dua sisi — `listing_umkm.sisi` (kebutuhan/
  penawaran) + `umkm_inquiry` termoderasi + `v_umkm_match` + owner inbox.
  Kontak pemilik tidak terekspos publik.

### Fase 4 — Ketahanan & Inklusi
- **I9**: Offline-first PWA — manifest, unified service worker (precache
  + runtime cache + background sync + push), IndexedDB queue, offline
  checkin. WCAG 2.1 AA: skip-link, focus-visible, kontras, heading
  hierarchy, ARIA labels. Mode bantuan petugas (`/admin/checkin-asist`).

### Infrastruktur
- **Task 0**: Vitest + test scripts + 467 test suite.
- **Final review**: Rate limit chat AI + ownership check, pruning
  `anon_rate_limit`, push subscription upsert, deploy runbook.

### Migrasi database
- 19 migration baru: `020` → `038` (lihat `docs/DEPLOY_RUNBOOK.md`
  untuk urutan apply).
- ⚠️ **020–038 telah DIGANTIKAN oleh 5 baseline `20260714*` (lihat
  `docs/MIGRATIONS.md`) — jangan apply 020–038.**

## [1.0.0] — 2025

Versi awal LMH. Lihat `docs/AUDIT_DAN_ROADMAP_INOVASI.md` untuk audit
temuan dan roadmap yang melandasi LMH 2.0.
