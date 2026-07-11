# PROGRESS — Eksekusi LMH 2.0

> Tracker eksekusi `.opencode/plans/LMH_2_0_IMPLEMENTATION_PLAN.md`.
> Update real-time saat eksekusi. Satu baris = satu task yang dapat di-todo.
> Status: `pending` | `in-progress` | `blocked` | `done` | `skipped`

**Legend:**
- `[ ]` pending · `[~]` in-progress · `[!]` blocked · `[x]` done · `[-]` skipped
- `@Fase-N/Kode` = anchor ke section plan

**Decision gates** (jangan lanjut fase berikutnya sebelum gate disetujui):
- [x] Gate 0 (pra Fase 1) — K1-K5 selesai & terverifikasi (code-complete; Dashboard config pending human)
- [x] Gate 1 (pra Fase 2) — Fondasi data & tata kelola
- [x] Gate 2 (pra Fase 3) — Dampak warga cepat
- [x] Gate 3 (pra Fase 4) — Diferensiasi (I4 + I6 + I7)
- [x] Gate 4 — RILIS LMH 2.0 (code-complete; deploy pending human Dashboard config per `docs/DEPLOY_RUNBOOK.md`)

> **Note:** Individual task checkboxes below may be stale. The authoritative
> progress ledger with commit SHAs, review verdicts, and deferred items is
> `.superpowers/sdd/progress.md`. This file is retained for plan-reference.

---

## Fase 0 — Pengamanan Darurat (BLOCKER pra-publik)

### K1 — Hentikan bocoran PDF investasi @Fase-0/K1
- [ ] 0.K1.1 Nonaktifkan endpoint `src/app/api/investment-docs/public-view/route.ts` (return 410 Gone / hapus route)
- [ ] 0.K1.2 Audit isi bucket `investment-docs`: daftar file, identifikasi PDF demo vs produksi
- [ ] 0.K1.3 Pilih & install library PDF→PNG (kandidat: `pdf-lib`+`pdfjs-dist`, atau external via `sharp`+`mupdf`)
- [ ] 0.K1.4 Buat Route Handler `src/app/api/investment-docs/upload/route.ts` (admin-only): terima PDF, simpan raw di folder privat `_raw/`, konversi per halaman jadi PNG ke folder `pages/`, simpan path array ke `investment_documents.halaman_gambar`
- [ ] 0.K1.5 Buat Route Handler `src/app/api/investment-docs/page-image/route.ts` (publik): validasi `doc_id` + `page_num`, terbitkan signed URL ≤60 detik ke PNG, overlay watermark (session-id/IP/timestamp) via `sharp` composite
- [ ] 0.K1.6 Update UI `src/app/gallery/page.tsx`: render viewer per-halaman dari `halaman_gambar`, hapus link ke PDF mentah
- [ ] 0.K1.7 Backfill: konversi 9 dokumen demo eksisting ke format baru
- [ ] 0.K1.8 Hapus akses publik ke `_raw/` (RLS storage policy)
- [ ] 0.K1.9 Test: coba akses PDF mentah → 403/410; akses PNG publik → 200 w/ watermark; signed URL expired <60s
- **Status**: pending
- **Notes**:

### K2 — Tutup IDOR chat @Fase-0/K2
- [ ] 0.K2.1 Tulis migration baru `020_rls_chat_fix.sql`: DROP policy `USING (true)` pada `chat_sesi`, `chat_pesan`; ganti dengan policy berbasis `auth.uid()` (pengunjung) atau `petugas.layanan_id` (petugas)
- [ ] 0.K2.2 Aktifkan Anonymous Sign-In di Supabase Auth settings (dashboard)
- [ ] 0.K2.3 Update `src/app/chat/page.tsx`: pakai anon sign-in jika belum login, kirim `auth.uid()` ke policy
- [ ] 0.K2.4 Update `src/app/admin/chat/page.tsx`: pastikan filter `layanan_id = petugas.layanan_id`
- [ ] 0.K2.5 Test: user A tidak bisa SELECT sesi user B; anon bisa SELECT sesi sendiri; petugas hanya sesi layanannya
- **Status**: pending
- **Notes**:

### K3 — Insert publik + rate limit @Fase-0/K3
- [ ] 0.K3.1 Buat migration `021_anon_rate_limit.sql`: tabel `anon_session` (id, ip/fingerprint, last_insert_at, count); function `check_anon_rate(ip, action)` return boolean
- [ ] 0.K3.2 Update RLS `WITH CHECK` pada `kunjungan`, `chat_sesi`, `chat_pesan`: `WITH CHECK (check_anon_rate(inet_client_addr(), 'insert'))`
- [ ] 0.K3.3 Atau: buat Edge Function throttle `supabase/functions/rate-limit/` jika pendekatan RLS terlalu rigid
- [ ] 0.K3.4 Test: banjir 100 request POST /checkin dalam 1 menit dari IP sama → mayoritas ditolak setelah threshold
- **Status**: pending
- **Notes**:

### K4 — Hapus password hardcode @Fase-0/K4
- [ ] 0.K4.1 Buat migration `022_revoke_hardcoded_accounts.sql`: hapus/reset baris petugas dari migration 013/015 (UPDATE `petugas` SET password = NULL atau DELETE rows dengan password ter-commit)
- [ ] 0.K4.2 Pindahkan seed akun demo ke `supabase/seed-demo.sql` (tidak dijalankan di prod)
- [ ] 0.K4.3 Implementasi flow "undangan": admin create petugas → trigger kirim magic-link email → petugas set password sendiri saat login pertama
- [ ] 0.K4.4 Route Handler `src/app/api/admin/petugas/invite/route.ts`: kirim undangan via Supabase Auth admin API
- [ ] 0.K4.5 Rotasi semua password akun pemerintah eksisting (oss@, banklampung@, balmon@, dst.)
- [ ] 0.K4.6 Test: cek git history — tidak ada string `password123` di migration aktif; login lama ditolak; magic-link undangan berfungsi
- **Status**: pending
- **Notes**:

### K5 — Magic-link UMKM @Fase-0/K5
- [ ] 0.K5.1 Putuskan: gunakan **magic-link email** (bukan Edge Function edit-token). Alasan: lebih aman, tidak bisa ditebak, reuse Supabase Auth
- [ ] 0.K5.2 Buat tabel `umkm_edit_link` (id, listing_id, email, token_hash, expires_at, used_at) — migration `023_umkm_magic_link.sql`
- [ ] 0.K5.3 Route Handler `src/app/api/umkm/request-edit-link/route.ts` (publik): terima listing_id + email, verifikasi email cocok, kirim magic-link via Supabase Auth
- [ ] 0.K5.4 Route Handler `src/app/api/umkm/verify-edit-link/route.ts`: validasi token, beri session scoped ke listing itu
- [ ] 0.K5.5 Update UI `src/app/umkm/page.tsx`: ganti tombol edit-token lama → "Minta link edit via email"
- [ ] 0.K5.6 Hapus kolom `edit_token` lama (atau arsipkan) setelah migrasi
- [ ] 0.K5.7 Test: minta link → email masuk → klik link → bisa edit listing → link kedua pakai ditolak
- **Status**: pending
- **Notes**:

### Fase 0 — Final verification
- [ ] 0.V.1 Run `npm run lint` clean
- [ ] 0.V.2 Run `npm run build` clean
- [ ] 0.V.3 Manual smoke test: gallery, chat, checkin, umkm, admin login
- [ ] 0.V.4 Audit ulang: cek semua endpoint tidak serve file privat tanpa auth
- [ ] 0.V.5 Cek git: `git log --all -p | grep -i "password123"` → kosong
- [ ] 0.V.6 **Gate 0** — sign-off pimpinan sebelum lanjut Fase 1

---

## Fase 1 — Fondasi Data & Tata Kelola

### Inovasi #1 — Unified Visit Spine @Fase-1/INV1
- [ ] 1.I1.1 Migration `030_visit_spine.sql`: CREATE TABLE `visit` (lihat §7.1 audit), index pada (layanan_id, status, tanggal_rencana)
- [ ] 1.I1.2 RLS `visit`: anon INSERT rate-limited; pengunjung SELECT/UPDATE milik sendiri; petugas SELECT/UPDATE layanannya; admin ALL
- [ ] 1.I1.3 Trigger `trg_kunjungan_to_visit`: INSERT ke `kunjungan` → INSERT ke `visit` (asal='walk_in')
- [ ] 1.I1.4 Trigger `trg_reservasi_to_visit`: INSERT/update `reservasi` → sync ke `visit` (asal='reservasi')
- [ ] 1.I1.5 Backfill: INSERT semua `kunjungan` & `reservasi` eksisting ke `visit`
- [ ] 1.I1.6 Tulis ulang bacaan UI bertahap (dual-read dulu, lalu switch):
  - [ ] `src/app/admin/antrian/page.tsx` baca dari `visit`
  - [ ] `src/app/admin/kunjungan/page.tsx` baca dari `visit`
  - [ ] `src/app/admin/scan/page.tsx` scan QR dari `visit`
  - [ ] `src/app/me/reservasi/page.tsx` baca dari `visit`
- [ ] 1.I1.7 Tambah status `no_show`: job harian (pg_cron) mark `terjadwal` lewat H+1 → `no_show`
- [ ] 1.I1.8 Setelah 2 minggu stabil dual-write: drop trigger, baca murni dari `visit`, arsipkan `kunjungan` & `reservasi` (rename ke `_legacy_`)
- [ ] 1.I1.9 Test: create walk-in → muncul di visit; create reservasi → muncul di visit; scan QR → status berubah di visit; metrik tidak ganda
- **Status**: pending

### B2 — Tipe layanan @Fase-1/B2
- [ ] 1.B2.1 Migration `031_layanan_tipe.sql`: ALTER TABLE layanan ADD COLUMN tipe CHECK ('konsultatif','mitra','modul_publik')
- [ ] 1.B2.2 Backfill: UMKM & Investment Gallery → 'modul_publik'; Bank Lampung & BALMON → 'mitra'; sisanya 'konsultatif'
- [ ] 1.B2.3 Update komponen dropdown/selector (`src/app/checkin/page.tsx`, `src/app/me/reservasi/page.tsx`): filter `tipe != 'modul_publik'`
- [ ] 1.B2.4 Update admin UI: label badge tipe di `src/app/admin/page.tsx`
- **Status**: pending

### B4 — Pisahkan seed demo @Fase-1/B4
- [ ] 1.B4.1 Identifikasi data placeholder di migration (9 dokumen Unsplash, wa_number palsu)
- [ ] 1.B4.2 Pindahkan ke `supabase/seed-demo.sql` dengan header `-- HANYA UNTUK DEV/STAGING`
- [ ] 1.B4.3 Bersihkan migration produksi dari data demo
- [ ] 1.B4.4 Update `wa_number` di `site_settings` ke nomor resmi DPMPTSP
- **Status**: pending

### B5 — Model akun mitra @Fase-1/B5
- [ ] 1.B5.1 Putuskan: **individual account** (satu akun per orang mitra, bukan shared instansi)
- [ ] 1.B5.2 Dokumentasikan di plan + AGENTS.md
- [ ] 1.B5.3 Migrasi akun shared eksisting → individual (jika diperlukan)
- **Status**: pending

### A1 — Role di JWT claims @Fase-1/A1
- [ ] 1.A1.1 Setup Supabase Auth hook / trigger: on login, set custom claim `app_metadata.role = 'petugas'|'admin'` dari tabel `petugas`
- [ ] 1.A1.2 Update `src/proxy.ts`: baca role dari JWT (decode), hapus query DB `petugas.role` per request
- [ ] 1.A1.3 Test: login petugas → akses /admin OK; login pengunjung → redirect /me; request /admin tanpa login → /login
- **Status**: pending

### Inovasi #8 — Tata kelola PDP @Fase-1/INV8
- [ ] 1.I8.1 Migration `032_audit_consent.sql`: CREATE TABLE `audit_log` (§7.3), `consent_log`
- [ ] 1.I8.2 Trigger audit pada tabel sensitif: `visit` (status change), `investment_documents` (upload/delete), `listing_umkm` (approve), `petugas` (insert/delete) — INSERT row ke `audit_log` dengan before/after JSONB
- [ ] 1.I8.3 RLS `audit_log`: hanya admin SELECT; tidak ada INSERT dari client (hanya trigger/RLS as definer)
- [ ] 1.I8.4 pg_cron job: anonymisasi `pengunjung` setelah 730 hari tidak aktif (null-kan nama/email/foto)
- [ ] 1.I8.5 UI consent: checkbox "Saya setuju data saya diproses" di `/checkin` & `/chat`, log ke `consent_log`
- [ ] 1.I8.6 Dashboard DPO mini: `src/app/admin/data-governance/page.tsx` — tampilkan count audit_log, consent coverage, daftar PII aktif
- [ ] 1.I8.7 Tulis kebijakan retensi & consent ke `docs/KEBIJAKAN_PDP.md` (referensi untuk audit eksternal)
- **Status**: pending

### A2 — Audit log aktif (overlap Inovasi #8)
- [ ] 1.A2.1 Covered by 1.I8.2 di atas
- **Status**: pending

### Fase 1 — Final verification
- [ ] 1.V.1 Lint + build clean
- [ ] 1.V.2 Test: dual-write `visit` konsisten dgn `kunjungan` & `reservasi`
- [ ] 1.V.3 Test: audit_log mencatat aksi admin
- [ ] 1.V.4 Test: role JWT tidak query DB per request (cek log query count)
- [ ] 1.V.5 **Gate 1** — sign-off

---

## Fase 2 — Dampak Warga Cepat

### Inovasi #3 — SKM Built-in @Fase-2/INV3
- [ ] 2.I3.1 Migration `040_skm.sql`: CREATE TABLE `skm_respons` (§7.4)
- [ ] 2.I3.2 RLS: anon INSERT dengan token visit valid; petugas SELECT layanannya; admin ALL
- [ ] 2.I3.3 Buat `src/app/skm/page.tsx`: form 9 unsur (skala 1-4) + saran, akses via token dari QR
- [ ] 2.I3.4 Route Handler `src/app/api/skm/submit/route.ts`: validasi token visit, INSERT
- [ ] 2.I3.5 Trigger: `visit.status = 'selesai'` → kirim notifikasi (email/push) berisi link SKM
- [ ] 2.I3.6 Fungsi SQL `hitung_ikm(layanan_id, periode)`: agregasi 9 unsur → nilai IKM (1-100)
- [ ] 2.I3.7 Dashboard pimpinan: `src/app/admin/skm/page.tsx` — tabel IKM per layanan + tren
- [ ] 2.I3.8 Halaman transparansi publik: `src/app/transparansi/page.tsx` — IKM agregat per kuartal
- [ ] 2.I3.9 Test: submit SKM dengan token valid → tersimpan; token expired → ditolak; IKM terhitung benar
- **Status**: pending

### Inovasi #2 — Antrean pintar @Fase-2/INV2
- [ ] 2.I2.1 Materialized view `mv_estimasi_layanan`: rata-rata `durasi_menit` per layanan per slot jam (rolling 14 hari), refresh per 5 menit
- [ ] 2.I2.2 View `v_antrian_loket`: count `visit` status `menunggu` per layanan + estimasi tunggu (count × avg durasi)
- [ ] 2.I2.3 Komponen publik `src/components/EstimasiAntrean.tsx`: fetch `v_antrian_loket`, tampilkan "Loket OSS: ~15 menit, 3 antre"
- [ ] 2.I2.4 Pasang di landing (`src/app/page.tsx`) & halaman reservasi
- [ ] 2.I2.5 Supabase Realtime: subscribe `visit` changes → re-fetch estimasi otomatis
- [ ] 2.I2.6 (Opsional) Mode lobi: `src/app/lobby/page.tsx` read-only display besar
- [ ] 2.I2.7 Test: create visit → estimasi update; selesaikan visit → antran berkurang
- **Status**: pending

### Inovasi #5 — Notifikasi (email + web-push) @Fase-2/INV5
- [ ] 2.I5.1 Migration `041_notifikasi.sql`: CREATE TABLE `notifikasi` (id, tujuan, kanal, payload, status, retry_count, created_at, sent_at)
- [ ] 2.I5.2 Pilih provider email: Resend (rekomendasi, free tier 100/hari) — install `resend`
- [ ] 2.I5.3 Pilih web-push: `web-push` npm + generate VAPID keys, simpan di env
- [ ] 2.I5.4 Route Handler `src/app/api/notif/send/route.ts`: kirim email via Resend; kirim push via web-push; update `notifikasi.status`
- [ ] 2.I5.5 Worker retry: pg_cron setiap 5 menit SELECT `notifikasi.status='failed' AND retry_count<3` → re-kirim
- [ ] 2.I5.6 Trigger event → INSERT ke `notifikasi`:
  - [ ] visit `terjadwal` H-1 → pengingat reservasi
  - [ ] visit `dilayani` → "antrean Anda siap"
  - [ ] chat_pesan baru setelah 30 menit tidak dijawab → email pengunjung
  - [ ] listing_umkm approved → email pemilik
- [ ] 2.I5.7 UI pengunjung: `src/app/me/notifications/page.tsx` + opt-in web-push di `/me/settings`
- [ ] 2.I5.8 Test: trigger event → row notifikasi ter-insert; worker kirim email; web-push terima di browser
- [ ] 2.I5.9 (Future) Fase 2.5: WhatsApp Cloud API setelah approval Meta selesai
- **Status**: pending

### Fase 2 — Final verification
- [ ] 2.V.1 Lint + build clean
- [ ] 2.V.2 Test end-to-end: reservasi → pengingat → hadir → selesai → SKM → IKM tampil
- [ ] 2.V.3 Test notifikasi: 4 event trigger masing-masing menghasilkan email
- [ ] 2.V.4 **Gate 2** — sign-off

---

## Fase 3 — Diferensiasi

### Inovasi #4 — Asisten AI ber-RAG @Fase-3/INV4
- [ ] 3.I4.1 Enable extension `vector` di Supabase dashboard
- [ ] 3.I4.2 Migration `050_faq_embedding.sql`: ALTER `faq_knowledge_base` ADD COLUMN `embedding vector(768)`; index `ivfflat`
- [ ] 3.I4.3 Backfill embedding: Route Handler `src/app/api/admin/faq/embed/route.ts` — panggil Gemini `text-embedding-004` untuk tiap row FAQ
- [ ] 3.I4.4 Pilih model: Gemini 1.5 Flash (cepat, murah) via `@google/generative-ai`
- [ ] 3.I4.5 Route Handler `src/app/api/chat/ai/route.ts`:
  - [ ] Query: embed pertanyaan user → cosine similarity search top-5 FAQ
  - [ ] Context injection: gabungkan jawaban FAQ + dokumen OSS terkait
  - [ ] System prompt ketat: "Jawab HANYA dari konteks. Jika ragu/tidak relevan, jawab 'Saya belum yakin, saya hubungkan Anda ke petugas.' + eskalasi"
  - [ ] Threshold similarity < 0.7 → eskalasi ke manusia
  - [ ] Log: INSERT `chat_ai_log` (pertanyaan, konteks_pakai, jawaban, similarity, eskalasi)
- [ ] 3.I4.6 Update `src/app/chat/page.tsx`: coba jawab AI dulu, jika eskalasi → route ke petugas
- [ ] 3.I4.7 Admin UI: `src/app/admin/chat/ai-log/page.tsx` — audit jawaban AI, tandai salah → tambah ke FAQ
- [ ] 3.I4.8 Test: pertanyaan relevan → jawab dgn kutipan sumber; pertanyaan di luar konteks → eskalasi; similarity < 0.7 → eskalasi
- **Status**: pending

### Inovasi #6 — Funnel investor @Fase-3/INV6
- [ ] 3.I6.1 (Prasyarat K1 di Fase 0 selesai) — watermark dinamis sudah aktif
- [ ] 3.I6.2 Migration `051_investasi_lead.sql`: CREATE TABLE `investasi_lead` (id, doc_id, nama, email, instansi, minat, created_at)
- [ ] 3.I6.3 RLS: anon INSERT; petugas/admin SELECT
- [ ] 3.I6.4 UI: di `src/app/gallery/page.tsx`, tambah CTA "Ajukan Minat Investasi" per dokumen → form modal
- [ ] 3.I6.5 Route Handler `src/app/api/investasi/lead/route.ts`: INSERT lead
- [ ] 3.I6.6 Admin UI: `src/app/admin/investasi-leads/page.tsx` — tabel lead + filter by doc
- [ ] 3.I6.7 Test: submit lead → tersimpan → muncul di admin; cek watermark ber-session terlihat
- **Status**: pending

### Inovasi #7 — Marketplace UMKM dua sisi @Fase-3/INV7
- [ ] 3.I7.1 Migration `052_umkm_dua_sisi.sql`: ALTER `listing_umkm` ADD COLUMN `sisi` CHECK ('kebutuhan','penawaran'); ADD `umkm_inquiry` (id, listing_id, from_email, pesan, status, created_at)
- [ ] 3.I7.2 RLS `umkm_inquiry`: anon INSERT (with rate limit); pemilik listing SELECT (via magic-link session); admin ALL
- [ ] 3.I7.3 (Prasyarat K5 di Fase 0 selesai) — magic-link edit sudah aktif
- [ ] 3.I7.4 UI `src/app/umkm/page.tsx`: toggle "Kebutuhan" / "Penawaran", filter by kategori
- [ ] 3.I7.5 UI detail listing: form "Kirim pesan ke pemilik" → INSERT `umkm_inquiry` (tidak expose kontak mentah)
- [ ] 3.I7.6 Inbox pemilik: akses via magic-link, lihat inquiry, approve/reject (moderasi)
- [ ] 3.I7.7 Mesin pencocokan: SQL view `v_umkm_match` — pair kebutuhan + penawaran same kategori
- [ ] 3.I7.8 Test: buat kebutuhan + penawaran same kategori → muncul di match; inquiry termoderasi; kontak tidak terekspos
- **Status**: pending

### Fase 3 — Final verification
- [ ] 3.V.1 Lint + build clean
- [ ] 3.V.2 Test AI: 20 pertanyaan sampel, akurasi > 80% jawab benar, 100% eskalasi jika di luar konteks
- [ ] 3.V.3 Test lead investor: submit → CRM-lite terisi
- [ ] 3.V.4 Test UMKM: match bekerja, inquiry termoderasi
- [ ] 3.V.5 **Gate 3** — sign-off

---

## Fase 4 — Ketahanan & Inklusi

### Inovasi #9 — Offline-first PWA + WCAG @Fase-4/INV9
- [ ] 4.I9.1 PWA setup: `next-pwa` atau manual service worker di `public/sw.js`
- [ ] 4.I9.2 Manifest `public/manifest.json` (installable, icon, theme)
- [ ] 4.I9.3 IndexedDB wrapper `src/lib/offline/queue.ts`: antre aksi (checkin, chat) saat offline
- [ ] 4.I9.4 Background sync: saat online, replay antrean idempoten (cek `visit.id` duplikat sebelum INSERT)
- [ ] 4.I9.5 UI: indicator status offline di header, banner "Mode offline — perubahan disinkron saat online"
- [ ] 4.I9.6 Mode "dibantu petugas": form di `/admin/checkin-asist` dengan field nama manual, petugas input untuk warga
- [ ] 4.I9.7 Bahasa sederhana: audit copy di semua halaman publik, sederhanakan ke level B1
- [ ] 4.I9.8 Audit aksesibilitas: jalankan `axe-core` di CI atau manual
  - [ ] Kontras AA (4.5:1 teks normal)
  - [ ] Navigasi keyboard penuh (tab order, focus visible)
  - [ ] ARIA labels di form
  - [ ] Skip-to-content link
- [ ] 4.I9.9 Test offline: matikan internet → checkin → online → sinkron → muncul di admin
- **Status**: pending

### Fase 4 — Final verification
- [ ] 4.V.1 Lint + build clean
- [ ] 4.V.2 Lighthouse PWA score ≥ 90
- [ ] 4.V.3 Lighthouse Accessibility score ≥ 95 (target WCAG 2.1 AA)
- [ ] 4.V.4 Manual test: offline checkin, sync, mode bantuan petugas
- [ ] 4.V.5 **Gate 4 — RILIS LMH 2.0** — sign-off pimpinan

---

## Cross-cutting (berjalan sepanjang fase)

- [ ] X.1 Update `AGENTS.md` dengan konvensi baru (Route Handler utama, Edge Function untuk trigger DB)
- [ ] X.2 Buat `.env.example` dengan semua env var baru (GEMINI_API_KEY, RESEND_API_KEY, VAPID_PUBLIC/PRIVATE, dst.)
- [ ] X.3 Arsipkan `PRD.md` & `ARCHITECTURE.md` ke `docs/archive/`
- [ ] X.4 Update `README.md` (saat ini boilerplate create-next-app) — jadi README proper LMH 2.0
- [ ] X.5 Tambah script `npm run typecheck` & `npm run test` di package.json
- [ ] X.6 Setup CI: GitHub Actions lint + build + typecheck setiap PR
- [ ] X.7 Changelog: `docs/CHANGELOG.md` per fase

---

## Catatan Eksekusi

- **Pola migration**: numbered `NNN_deskripsi.sql` di `supabase/migrations/`, dijalankan manual via Supabase Dashboard SQL Editor (sesuai praktik saat ini). Backup sebelum apply.
- **Pola dual-write**: setiap migrasi data besar (visit spine, dll) gunakan dual-write → read-switch → retire, untuk zero downtime.
- **Decision-gate**: jangan mulai fase berikutnya sebelum gate disetujui pimpinan. Catat di `docs/DECISION_LOG.md`.
- **Rollback**: setiap migration punya section rollback di plan. Jika gagal, eksekusi rollback SQL + revert kode + deploy ulang.
- **Testing**: tidak ada test framework saat ini. Pertimbangkan tambah Vitest di cross-cutting X.5.
