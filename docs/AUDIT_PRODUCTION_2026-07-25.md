# Audit Produksi LMH — 25 Juli 2026

> Status: **belum go-live**. Code hardening P0 chat IDOR ditutup di sesi ini; go-live masih butuh staging + human/ops.

## 1. Ringkasan eksekutif

| Area | Status | Catatan |
|---|---|---|
| Fitur inti (visit, reservasi, chat, UMKM, gallery, SKM, notif) | **Ada & wired** | Bukan stub |
| Keamanan app-layer (API) | **1 P0 ditutup hari ini** | Chat messages sebelumnya open service-role |
| RLS baseline | **Solid** | `USING (true)` hanya master publik (`layanan`, `site_settings`) |
| Ops / staging | **Belum** | Env, Dashboard, Resend, VAPID, JWT hook |
| E2E | **Belum** | Hanya unit/contract tests |
| Legal PDP | **Draft** | Butuh sign-off DPO |

**Verdict:** application code mendekati production-ready setelah P0 chat; **bukan** “tinggal deploy”.

---

## 2. Inventaris fitur

| Domain | Halaman / API | Status |
|---|---|---|
| Landing + CMS | `/`, admin settings/landing | COMPLETE |
| Check-in walk-in | `/checkin`, `POST /api/checkin` | COMPLETE (+ bind `pengunjung_id` 2026-07-25) |
| Reservasi + QR | `/me/reservasi`, admin scan | COMPLETE |
| Antrean + estimasi | admin antrian, `EstimasiAntrean` | COMPLETE |
| Live chat + AI RAG | `/chat`, admin chat, `/api/chat/*` | COMPLETE (auth messages fixed) |
| UMKM marketplace | `/umkm`, edit magic-link, inbox | COMPLETE |
| Investment Gallery | `/gallery`, page-image watermark | COMPLETE (`public-view` = 410) |
| Lead investasi | gallery form, admin leads | COMPLETE |
| SKM | `/skm`, admin SKM, transparansi | COMPLETE |
| Notifikasi email/push | cron send/retry | COMPLETE (cron harian — SLA lemah) |
| Petugas invite | admin invite API | COMPLETE |
| Absensi | admin absensi | COMPLETE |
| Data governance | admin data-governance | COMPLETE |
| Health | `/api/health/live|ready` | COMPLETE |
| PWA offline | offline page + SW | PARTIAL (perlu Lighthouse formal) |
| E2E Playwright | — | MISSING (sengaja residual) |

---

## 3. Temuan (sebelum / sesudah sesi ini)

### P0 — CRITICAL

| ID | Temuan | Status |
|---|---|---|
| **SEC-01** | `GET/POST /api/chat/messages` pakai service-role **tanpa auth** → siapa pun dengan `sesi_id` bisa baca/tulis pesan & spoof `pengirim` | **FIXED 2026-07-25** — auth wajib, ownership check, `pengirim` dipaksa server-side |

### P1 — HIGH

| ID | Temuan | Status |
|---|---|---|
| **SEC-02** | `PATCH /api/umkm/inquiry/[id]` fallback service-role pada UPDATE (bypass RLS) | **FIXED 2026-07-25** — update hanya via user client |
| **BIZ-01** | Check-in authenticated tidak mengisi `visit.pengunjung_id` → putus rantai SKM/notif/history | **FIXED 2026-07-25** |
| **OPS-01** | Docs deploy hanya sebut 5 baseline; forward `20260720/21/24` terlewat di runbook | **FIXED 2026-07-25** |
| **OPS-02** | Seed landing masih “9 Layanan” padahal 10 | **FIXED 2026-07-25** |
| **OPS-03** | Vercel cron notif = harian (`0 2 * * *`) — antrean/chat notif terlambat | **FIXED 2026-07-25** — send `*/2`, retry `*/5` |
| **SEC-03** | CSP masih `Report-Only`; HSTS absen (OK di Vercel edge TLS) | OPEN (monitor reports; enforce after zero violations) |
| **SEC-04** | AI draft petugas bisa baca sesi layanan lain | **FIXED 2026-07-25** — scope layanan_id |
| **SEC-05** | API error bodies leak DB/storage internals | **FIXED 2026-07-25** — sanitized messages |

### P2 — MEDIUM / residual human

| ID | Item |
|---|---|
| H-01 | Staging deploy + apply migrasi |
| H-02 | Supabase Dashboard: anon auth, JWT role hook, site URL |
| H-03 | Resend domain verified |
| H-04 | VAPID + Gemini keys |
| H-05 | Invite admin pertama (tanpa password seed) |
| H-06 | DPO sign-off `KEBIJAKAN_PDP` |
| H-07 | Playwright E2E happy paths |
| H-08 | Lighthouse PWA/A11y formal |
| H-09 | RPO/RTO numbers |

---

## 4. Yang sudah solid (jangan dirombak tanpa alasan)

- Investment `public-view` deprecated (410); publik via `page-image` + watermark + rate limit.
- Chat AI (`/api/chat/ai`) auth + ownership + rate limit + PII redact + injection guard.
- Cron notif dilindungi `CRON_SECRET` (timing-safe).
- Proxy `/admin` + `/me` auth; role JWT claim + fallback DB.
- Seed produksi tanpa kredensial; invite individual (`KEBIJAKAN_AKUN_MITRA`).
- Baseline RLS ketat untuk chat/visit/consent/notifikasi.
- Security headers dasar (nosniff, frame DENY, referrer, permissions-policy).

---

## 5. Perubahan kode sesi ini

1. `src/app/api/chat/messages/route.ts` — auth + ownership + force pengirim
2. `src/app/api/chat/messages/messages.test.ts` — coverage 401/403/spoof
3. `src/app/api/checkin/route.ts` (+ test) — bind `pengunjung_id` dari session
4. `src/app/api/umkm/inquiry/[id]/route.ts` (+ test) — hilangkan service-role UPDATE fallback
5. `docs/MIGRATIONS.md`, `docs/DEPLOY_RUNBOOK.md`, `docs/PRODUCTION_READINESS.md`, `supabase/seed.sql`

---

## 6. Alur bisnis (cek integritas)

```
Reservasi → QR → Scan petugas → visit.hadir/menunggu → dilayani → selesai → notif SKM → submit SKM
Walk-in checkin → visit.menunggu → (sama)
Chat: login → sesi → pesan (API auth) → AI RAG → eskalasi → petugas takeover → selesai
UMKM: admin publish → publik inquiry (auth) → owner magic-link → approve/reject
Investasi: page-image → lead (auth) → admin status
```

Gap residual bisnis (bukan blocker kode): frekuensi cron notif; formal E2E; formal Lighthouse.

---

## 7. Go-live gate (minimal)

- [ ] `npm run verify:baseline` hijau di CI
- [ ] Migrasi 5 baseline + 3 forward + seed di staging
- [ ] Dashboard auth hook + anon + site URL
- [ ] Semua env non-placeholder di Vercel Production
- [ ] Smoke: checkin, chat 2-client, SKM token, gallery page, magic-link UMKM
- [ ] Invite admin nyata; rotasi secret
- [ ] DPO sign-off privasi
- [ ] Putuskan cron notif (rekomendasi: `*/2 * * * *` untuk send)

---

## 8. Anti-claim

- Jangan klaim “100% ready, sisa dashboard saja” tanpa staging smoke.
- Jangan deploy tanpa forward migrations `20260720+`.
- Jangan seed demo di produksi.
