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
**Status**: Code-complete. Tabel `kunjungan`/`reservasi` belum di-retire
(deferred ke I1.c setelah dual-write terverifikasi di produksi).

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

## Keputusan Teknis Lain

### Bisnis logic server: Next.js Route Handler
- **Konteks**: Edge Function vs Route Handler
- **Keputusan**: Route Handler (familiar, konsisten, deploy Vercel)
- **Pengecualian**: Tidak ada — semua logic di Route Handler

### Migration: Manual via SQL Editor
- **Konteks**: Supabase CLI vs manual
- **Keputusan**: Manual via Dashboard SQL Editor (lanjut praktik eksisting)
- **Alasan**: Tidak ada `config.toml`, tidak ada CLI workflow

### WhatsApp Cloud API: Ditangguhkan
- **Konteks**: Email + web-push vs tambah WhatsApp
- **Keputusan**: Email + web-push dulu, WhatsApp di Fase 2.5 setelah
  approval Meta Business
- **Alasan**: Realistis untuk solo dev, WhatsApp butuh verifikasi nomor
