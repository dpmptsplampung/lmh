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
