# LMH 2.0 — Panduan Production Readiness

> Dokumen ini adalah peta jalan lengkap untuk membawa LMH 2.0 ke production.
> Setiap section menjawab: **apa yang sudah ada**, **apa yang belum**, dan
> **langkah selanjutnya**.
>
> **Tanggal**: 11 Juli 2026
> **Versi code**: `fea31bc` (25 commit, 467 test, 38 migration)
> **Status**: Code-complete. Menunggu konfigurasi Dashboard + deploy.

---

## Daftar Isi

1. [Ringkasan Eksekutif](#1-ringkasan-eksekutif)
2. [Apa yang SUDAH Ada (code-complete)](#2-apa-yang-sudah-ada-code-complete)
3. [Apa yang BELUM Ada / Perlu Anda Lakukan](#3-apa-yang-belum-ada--perlu-anda-lakukan)
4. [Step-by-Step ke Production](#4-step-by-step-ke-production)
5. [Bagian yang Belum Diimplementasi (future)](#5-bagian-yang-belum-diimplementasi-future)
6. [Daftar File Dokumentasi](#6-daftar-file-dokumentasi)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Ringkasan Eksekutif

| Aspek | Status |
|---|---|
| **Kode** | 100% complete — 9 inisiatif + 5 security blocker + 5 integritas/arsitektur |
| **Test** | 467 test passing, lint clean, typecheck clean, build clean |
| **Migration** | 38 file (001-038), semua dengan ROLLBACK. 020-038 belum di-apply ke prod |
| **Dokumentasi** | DEPLOY_RUNBOOK, CHANGELOG, DECISION_LOG, KEBIJAKAN_PDP, README — semua ada |
| **CI** | `.github/workflows/ci.yml` ada (lint + typecheck + test + build) |
| **Blocker production** | **Hanya konfigurasi Dashboard + apply migration + set env vars** — semua dilakukan manusia, bukan kode |

**Intinya**: Kode siap production. Yang tersisa adalah pekerjaan konfigurasi
manual di Supabase Dashboard + Vercel yang **tidak bisa** dilakukan oleh agent.

---

## 2. Apa yang SUDAH Ada (code-complete)

### 2.1 Security (Fase 0 — K1-K5)
- ✅ K1: PDF exfiltration ditutup (pipeline PDF→PNG + watermark dinamis)
- ✅ K2: Chat IDOR ditutup (RLS berbasis `pengunjung_id`)
- ✅ K3: Rate limit insert publik (`check_anon_rate()`)
- ✅ K4: 9 akun `password123` dihapus + flow undangan magic-link
- ✅ K5: Magic-link UMKM via Supabase Auth (ganti edit-token)

### 2.2 Fondasi Data (Fase 1)
- ✅ B2: Kolom `tipe` di `layanan`
- ✅ B4: Seed demo dipisah dari migration aktif
- ✅ B5: Kebijakan akun mitra individual (dokumentasi)
- ✅ A1: Role di JWT claims (Auth Hook `set_user_role_claim()`)
- ✅ I8: Audit log + consent log + anonymisasi pg_cron + dashboard DPO
- ✅ I1: Visit Spine (tabel `visit` + dual-write + UI switch)

### 2.3 Dampak Warga (Fase 2)
- ✅ I3: SKM digital (9 unsur PermenPANRB 14/2017) + IKM + dashboard + transparansi
- ✅ I2: Antrean pintar (materialized view + Realtime)
- ✅ I5: Notifikasi email (Resend) + web-push (VAPID) + cron

### 2.4 Diferensiasi (Fase 3)
- ✅ I4: Asisten AI ber-RAG (Gemini + pgvector + match_faq + eskalasi)
- ✅ I6: Funnel investor (`investasi_lead` + gallery CTA + admin CRM)
- ✅ I7: Marketplace UMKM dua sisi (`sisi` + `umkm_inquiry` + `v_umkm_match` + inbox)
- ✅ Final review: 0 must-fix blockers (security verified)

### 2.5 Ketahanan & Inklusi (Fase 4)
- ✅ I9: PWA (manifest + unified SW + offline checkin + background sync)
- ✅ I9: WCAG 2.1 AA (skip-link, focus-visible, contrast, heading, ARIA)
- ✅ I9: Mode bantuan petugas (`/admin/checkin-asist`)

### 2.6 Infrastruktur
- ✅ Vitest + 467 test suite (41 file)
- ✅ `.env.example` lengkap (12 env var)
- ✅ `vercel.json` (cron config untuk notif send/retry)
- ✅ CI: `.github/workflows/ci.yml`
- ✅ `docs/DEPLOY_RUNBOOK.md` (checklist deploy lengkap)
- ✅ `docs/CHANGELOG.md`, `docs/DECISION_LOG.md`
- ✅ `docs/KEBIJAKAN_PDP.md`, `docs/KEBIJAKAN_AKUN_MITRA.md`
- ✅ `README.md` proper (bukan boilerplate create-next-app)
- ✅ `scripts/backfill-investment-pdf.ts` (untuk konversi PDF eksisting)

---

## 3. Apa yang BELUM Ada / Perlu Anda Lakukan

Ini adalah pekerjaan **manual** yang tidak bisa dilakukan oleh kode. Semua
langkah detail ada di `docs/DEPLOY_RUNBOOK.md` — ini adalah ringkasan.

### 3.1 Supabase Dashboard Configuration (WAJIB sebelum deploy)

| # | Aksi | Detail di file |
|---|---|---|
| 1 | **Backup database** | Dashboard → Database → Backup |
| 2 | **Enable `pgvector`** | Database → Extensions → `vector` (wajib sebelum migration 035) |
| 3 | **Enable `pg_cron`** | Database → Extensions → `cron` (wajib sebelum migration 036) |
| 4 | **Enable Anonymous Sign-In** | Authentication → Providers → Anonymous → On |
| 5 | **Configure Auth Hook (JWT)** | Authentication → Hooks → JWT Hook → `public.set_user_role_claim()` |
| 6 | **Set Site URL** | Authentication → URL Configuration → URL produksi Anda |
| 7 | **Verify Resend domain** | Resend Dashboard → Domains → confirm `lampungprov.go.id` |

> **File referensi**: `docs/DEPLOY_RUNBOOK.md` Section 2

### 3.2 Apply Migration (WAJIB, urutan krusial)

Apply migration `020` → `038` berurutan via Dashboard → SQL Editor.

**PERINGATAN KRITIS:**
- **Sebelum 023**: Anda HARUS provision admin pengganti via invite flow.
  Migration 023 menghapus 9 akun `password123`. Tanpa pengganti → lockout.
- **Sebelum 026**: Konfirmasi nomor WhatsApp DPMPTSP asli (026 pakai placeholder).
- **Sebelum 035**: `pgvector` HARUS sudah di-enable.
- **Sebelum 038**: Aman — hanya tambah kolom `sisi` dengan default.

> **File referensi**: `docs/DEPLOY_RUNBOOK.md` Section 3 + `supabase/migrations/020-038`

### 3.3 Environment Variables (WAJIB)

Set 12 env var di Vercel Project Settings → Environment Variables:

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
RESEND_FROM
CRON_SECRET
NEXT_PUBLIC_PUBLIC_URL
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
NEXT_PUBLIC_VAPID_PUBLIC_KEY
GEMINI_API_KEY
GEMINI_MODEL
GEMINI_EMBEDDING_MODEL
```

Generate VAPID keys: `npx web-push generate-vapid-keys`

> **File referensi**: `.env.example` + `docs/DEPLOY_RUNBOOK.md` Section 1

### 3.4 Vercel Deployment (WAJIB)

1. Push branch `main` ke GitHub (Vercel auto-deploy jika Git integration aktif)
2. Pastikan Vercel Cron Jobs mengirim `Authorization: Bearer <CRON_SECRET>`
3. `vercel.json` sudah ada (cron config untuk `/api/notif/send` & `/api/notif/retry`)

> **File referensi**: `docs/DEPLOY_RUNBOOK.md` Section 4 + `vercel.json`

### 3.5 Post-Deploy (WAJIB)

1. **FAQ embedding backfill**: POST ke `/api/admin/faq/embed` berulang sampai `{ remaining: 0 }`. Tanpa ini, AI chat selalu eskalasi.
2. **PDF backfill** (jika ada dokumen investasi eksisting): `npx tsx scripts/backfill-investment-pdf.ts`
3. **Smoke test** semua flow (lihat DEPLOY_RUNBOOK Section 5 untuk checklist lengkap)
4. **Verify pg_cron** pruning: `SELECT * FROM cron.job WHERE jobname = 'prune_anon_rate_limit';`

> **File referensi**: `docs/DEPLOY_RUNBOOK.md` Section 5

### 3.6 Smoke Test yang HARUS Anda Jalankan Manual

Setelah deploy, test ini wajib untuk verifikasi:

- [ ] Check-in anon visitor → muncul di admin antrian
- [ ] Chat anon → sesi terisolasi (user A tidak bisa lihat sesi B)
- [ ] SKM submission setelah layanan selesai → IKM tampil di dashboard
- [ ] UMKM magic-link → email masuk → edit page berfungsi
- [ ] Gallery page-image → watermark terlihat, tidak ada PDF mentah
- [ ] Notifikasi email + web-push terkirim
- [ ] AI chat eskalasi (pertanyaan di luar domain → handoff ke petugas)
- [ ] **I6**: Gallery → "Ajukan Minat Investasi" → lead muncul di `/admin/investasi-leads`
- [ ] **I7**: UMKM → "Kirim Pesan" → owner inbox → approve/reject. Kontak TIDAK terekspos publik
- [ ] **I9**: Offline checkin → online → sync. DevTools → Application → Service Workers aktif
- [ ] **I9**: Checkin Bantuan (`/admin/checkin-asist`) → visit dengan `pengunjung_id=NULL`
- [ ] **I9**: PWA install prompt (Chrome/Edge)

---

## 4. Step-by-Step ke Production

Ini adalah urutan lengkap. **Ikuti berurutan.**

### Step 1: Backup
```
Supabase Dashboard → Database → Backup → Create Backup
```

### Step 2: Enable Extensions
```
Supabase Dashboard → Database → Extensions
  → search "vector" → Enable
  → search "cron" (pg_cron) → Enable
```

### Step 3: Enable Anon Sign-In
```
Supabase Dashboard → Authentication → Sign In / Providers → Anonymous → Enable
```

### Step 4: Provision Admin Pengganti (SEBELUM migration 023!)
```
# Di local dev (dengan env vars set), jalankan sebagai admin eksisting:
curl -X POST http://localhost:3000/api/admin/petugas/invite \
  -H "Content-Type: application/json" \
  -d '{"email":"admin.baru@dpmptsp.lampungprov.go.id","nama":"Admin Baru","layanan_id":"<uuid>","role":"admin"}'
# Ulangi untuk setiap petugas yang dibutuhkan
# Pastikan setiap email undangan diklik + password diset
# VERIFIKASI: login dengan akun baru → bisa akses /admin
```

### Step 5: Apply Migration 020-038 Berurutan
```
# Untuk setiap file 020-038:
# 1. Buka file di supabase/migrations/
# 2. Copy seluruh isi
# 3. Paste di Supabase Dashboard → SQL Editor → Run
# 4. Verifikasi tidak ada error sebelum lanjut ke file berikutnya
```

**Setelah 026**: Update nomor WhatsApp asli:
```sql
UPDATE site_settings SET value = '<nomor asli>' WHERE key = 'wa_number';
```

### Step 6: Configure Auth Hook
```
Supabase Dashboard → Authentication → Hooks → JWT Hook
  → Select function: public.set_user_role_claim
  → Save
```

### Step 7: Set Site URL
```
Supabase Dashboard → Authentication → URL Configuration
  → Site URL: https://lmh.lampungprov.go.id (URL produksi Anda)
```

### Step 8: Setup Resend
```
1. Daftar di resend.com
2. Resend Dashboard → Domains → Add domain → verify lampungprov.go.id
3. Resend Dashboard → API Keys → Create key → copy
```

### Step 9: Generate VAPID Keys
```bash
npx web-push generate-vapid-keys
# Copy public key + private key
```

### Step 10: Get Gemini API Key
```
1. Buka https://aistudio.google.com/apikey
2. Create API key → copy
```

### Step 11: Set All Env Vars di Vercel
```
Vercel Dashboard → Project Settings → Environment Variables
Set semua 12 var dari .env.example (production environment)
```

### Step 12: Deploy
```bash
# Option A: Push ke main (auto-deploy jika Git integration aktif)
git push origin main

# Option B: Manual deploy
vercel --prod
```

### Step 13: Configure Vercel Cron
```
Vercel Dashboard → Cron Jobs
Pastikan /api/notif/send dan /api/notif/retry mengirim:
  Authorization: Bearer <CRON_SECRET>
```

### Step 14: Post-Deploy Backfill
```bash
# FAQ embedding (login sebagai admin, lalu):
curl -X POST https://your-domain.com/api/admin/faq/embed \
  -H "Cookie: <session cookie>"
# Ulangi sampai response: {"remaining": 0}

# PDF backfill (jika ada dokumen eksisting dengan halaman_gambar kosong):
SUPABASE_SERVICE_ROLE_KEY=... NEXT_PUBLIC_SUPABASE_URL=... npx tsx scripts/backfill-investment-pdf.ts
```

### Step 15: Smoke Test
Jalankan semua smoke test dari Section 3.6 di atas.

### Step 16: Verify pg_cron Jobs
```sql
SELECT jobname, schedule, active FROM cron.job;
-- Harus ada: prune_anon_rate_limit (daily 3am)
-- Harus ada: anonymize_inactive_pengunjung (daily 2am)
-- Harus ada: refresh_estimasi_layanan (every 5 min)
-- Harus ada: mark_no_show (hourly)
```

---

## 5. Bagian yang Belum Diimplementasi (future)

Ini adalah item yang **sengaja ditangguhkan** dan TIDAK menghalangi production.
Track sebagai P2/P3 follow-up setelah deploy stabil.

### 5.1 Ditangguhkan oleh plan (Fase 2.5+)

| Item | Deskripsi | Prioritas |
|---|---|---|
| **WhatsApp Cloud API** | Notifikasi via WA. Ditangguhkan sampai approval Meta Business. Email + web-push sudah aktif sebagai alternatif. | Medium |
| **I1.c: Retire tabel lama** | Rename `kunjungan`/`reservasi` → `_legacy_*` setelah dual-write terverifikasi 2 minggu di produksi. | Medium |
| **Lighthouse audit formal** | I9 target: PWA ≥ 90, A11y ≥ 95. Belum dijalankan Lighthouse formal. | Low |
| **Bahasa sederhana (B1)** | Audit copy semua halaman publik untuk level B1. | Low |

### 5.2 Deferred dari code review (P2/P3)

| # | Item | File | Prioritas | Risiko |
|---|---|---|---|---|
| 1 | Rate-limit bypass via service-role fallback | `src/app/api/investasi/lead/route.ts`, `src/app/api/umkm/inquiry/route.ts`, `src/app/api/skm/submit/route.ts` | P2 | Anon bisa spam jika tahu pattern error. Mitigasi: tambah rate check di route handler sebelum INSERT. |
| 2 | Offline queue user isolation | `src/lib/offline/queue.ts` | P2 | Di shared kiosk, queue user A bisa replay under session B. Mitigasi: simpan `auth_user_id` di queue, skip jika mismatch. |
| 3 | PII redaction di audit_change | `supabase/migrations/028_audit_consent.sql` | P2 | `audit_change()` logs full `to_jsonb(NEW)` yang bisa berisi PII. Mitigasi: redact kolom sensitif sebelum log. |
| 4 | Admin server-side role guard | `src/app/admin/layout.tsx` | P3 | Non-staff yang akses `/admin/*` langsung lihat page shell + error (bukan redirect). Mitigasi: role check di layout/middleware. |
| 5 | SW cache versioning | `public/sw.js` | P3 | Cache version static `lmh-v1` tidak auto-invalidate pada deploy. Mitigasi: inject commit SHA saat build. |
| 6 | umkm_inquiry PATCH response leak | `src/app/api/umkm/inquiry/[id]/route.ts` | P3 | Response mengembalikan `from_email` bahkan saat reject. Owner sudah lihat di inbox, jadi bukan public leak. Mitigasi: strip contact fields jika status != approved. |
| 7 | Polling fallback antrean | `src/components/EstimasiAntrean.tsx` | P3 | Realtime-only, no polling fallback. Jika Realtime putus, data stale. Mitigasi: tambah polling 30s. |
| 8 | Admin log pagination | `src/app/admin/data-governance/page.tsx`, `src/app/admin/chat/ai-log/page.tsx` | P3 | LIMIT 100 tanpa pagination. Mitigasi: tambah page size + cursor. |
| 9 | consent_log tidak transactional | `src/app/api/checkin/route.ts` | P3 | consent_log INSERT sebelum visit INSERT. Jika visit gagal, consent log yatim. Mitigasi: wrap dalam transaction. |
| 10 | FAQ embedding exposed to anon SELECT | `supabase/migrations/035_faq_embedding.sql` | P3 | `faq_knowledge_base.embedding` bisa di-SELECT oleh anon. Derived dari public text, low risk. Mitigasi: REVOKE SELECT on embedding column. |

### 5.3 Yang TIDAK perlu diimplementasi

- **Edge Function**: Tidak ada. Semua logic di Route Handler (keputusan teknis, lihat `docs/DECISION_LOG.md`)
- **Tailwind CSS**: Tidak ada. Project pakai CSS Modules + custom properties
- **Supabase CLI / config.toml**: Tidak ada. Migration manual via SQL Editor (keputusan teknis)

---

## 6. Daftar File Dokumentasi

| File | Status | Isi |
|---|---|---|
| `README.md` | ✅ Ada (baru ditulis) | Overview project, quick start, struktur folder |
| `.env.example` | ✅ Ada | 12 env var dengan komentar |
| `docs/DEPLOY_RUNBOOK.md` | ✅ Ada | Checklist deploy lengkap (5 section) |
| `docs/PRODUCTION_READINESS.md` | ✅ Ada (file ini) | Panduan production readiness |
| `docs/CHANGELOG.md` | ✅ Ada (baru ditulis) | Riwayat perubahan per versi |
| `docs/DECISION_LOG.md` | ✅ Ada (baru ditulis) | Log keputusan teknis per gate |
| `docs/KEBIJAKAN_PDP.md` | ✅ Ada | Kebijakan perlindungan data pribadi |
| `docs/KEBIJAKAN_AKUN_MITRA.md` | ✅ Ada | Model akun mitra individual |
| `docs/AUDIT_DAN_ROADMAP_INOVASI.md` | ⚠️ Untracked (perlu `git add`) | Audit LMH 1.0 + roadmap LMH 2.0 |
| `.github/workflows/ci.yml` | ✅ Ada (baru dibuat) | CI: lint + typecheck + test + build |
| `vercel.json` | ✅ Ada | Cron config untuk notif send/retry |

### File yang perlu Anda commit (jika belum)
```bash
git add docs/AUDIT_DAN_ROADMAP_INOVASI.md
git commit -m "docs: track audit & roadmap inovasi"
```

---

## 7. Troubleshooting

### Q: Setelah apply migration 023, saya tidak bisa login
**A**: Anda melewati Step 4 (provision admin pengganti). Restore backup,
ulangi dari Step 4, lalu apply 023 lagi.

### Q: Migration 035 gagal dengan error "vector type does not exist"
**A**: `pgvector` extension belum di-enable. Kembali ke Step 2.

### Q: AI chat selalu eskalasi (tidak pernah menjawab)
**A**: FAQ embedding belum di-backfill. Jalankan Step 14 (POST `/api/admin/faq/embed` berulang).

### Q: Web-push tidak terkirim
**A**: Cek 3 hal: (1) VAPID keys sudah diset di Vercel, (2) `NEXT_PUBLIC_VAPID_PUBLIC_KEY` sama dengan `VAPID_PUBLIC_KEY`, (3) browser sudah grant permission.

### Q: Notifikasi email tidak terkirim
**A**: Cek: (1) `RESEND_API_KEY` valid, (2) domain `RESEND_FROM` sudah verified di Resend Dashboard, (3) Vercel Cron mengirim `Authorization: Bearer <CRON_SECRET>`.

### Q: Anon check-in gagal dengan error RLS
**A**: Anonymous Sign-In belum di-enable (Step 3), atau Auth Hook belum dikonfigurasi (Step 6).

### Q: Petugas tidak bisa akses `/admin`
**A**: Auth Hook `set_user_role_claim()` belum dikonfigurasi (Step 6). Tanpa itu, JWT tidak punya role claim dan fallback DB query dipakai (bisa lambat).

### Q: Gallery menampilkan "Dokumen ini sedang diproses"
**A**: `halaman_gambar` kosong. Jalankan PDF backfill: `npx tsx scripts/backfill-investment-pdf.ts`.

### Q: PWA tidak bisa di-install
**A**: Pastikan `public/manifest.json` accessible (buka `https://your-domain/manifest.json` di browser). Service worker hanya registrasi di production (bukan dev).

### Q: Offline checkin tidak sync
**A**: Background Sync butuh browser support (Chrome/Edge). Jika tidak support, queue di-replay saat `online` event. Cek DevTools → Application → IndexedDB → `lmh-offline` → `queue` untuk lihat pending actions.

---

## Verifikasi Akhir

Sebelum Anda mengakhiri sesi ini, pastikan:

- [ ] `docs/AUDIT_DAN_ROADMAP_INOVASI.md` sudah di-`git add` dan commit
- [ ] Semua file dokumentasi di Section 6 sudah ada
- [ ] Anda sudah membaca `docs/DEPLOY_RUNBOOK.md` dari awal sampai akhir
- [ ] Anda punya akses ke: Supabase Dashboard, Vercel Dashboard, Resend Dashboard, Google AI Studio
- [ ] Anda sudah provision minimal 1 admin pengganti (Step 4)

Setelah itu, ikuti Step 1-16 di Section 4 berurutan.

**Selamat deploy LMH 2.0! 🚀**
