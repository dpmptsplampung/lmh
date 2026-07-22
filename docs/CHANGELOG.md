# Changelog

Semua perubahan penting pada project LMH didokumentasikan di sini.
Format: [Keep a Changelog](https://keepachangelog.com/). Pemversian
mengikuti [Semantic Versioning](https://semver.org/).

## [Unreleased / 2.1.0] — 2026-07-20

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
- UMKM owner-linking + consent PDP (`umkm_contact`) saat admin submit listing.
- QR/token SKM untuk pengunjung walk-in.
- Dashboard admin: angka/metrik kini akurat vs sumber data.
- Auto-embedding FAQ (trigger embed otomatis).
- Chat offline jujur — status offline ditampilkan apa adanya.
- Notifikasi balasan chat petugas, status inquiry UMKM, dan konfirmasi
  reservasi + dead-letter untuk notifikasi gagal retried ≥ 5x.
- Retensi `chat_ai_log` 90 hari (cron harian `prune_chat_ai_log()`).
- Fungsi publik `get_queue_position(qr_token)` untuk posisi antrean.

### UX Publik
- Navigasi mobile diperbaiki, posisi antrean tampil, modal aksesibel
  (a11y), migrasi ke `next/font`.

### Dokumentasi
- PRD.md, ARCHITECTURE.md, AUDIT_RESULTS.md diarsipkan ke `docs/archive/`
  dengan banner historis; sumber kebenaran: `docs/AUDIT_DAN_ROADMAP_INOVASI.md`.

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
