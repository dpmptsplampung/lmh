# Subagent-Driven Development Progress Ledger

Plan: `docs/superpowers/plans/2026-07-23-live-chat-gemini-plan.md`

## Tasks
- [x] Task 1: Strict Legal Grounding & Gemini Prompt Configuration (commits & tests clean)
- [x] Task 2: Anti-Prompt Injection & Output PII Sanitization (commits & tests clean)
- [x] Task 3: Officer Copilot Draft API (`/api/chat/ai/draft`) (commits & tests clean)
- [x] Task 4: Interactive UX Public Chat (`src/app/chat/page.tsx`) (commits & tests clean)
- [x] Task 5: Admin Panel Copilot Integration & Legal Grounding in FAQ (commits & tests clean)

---

Plan: `docs/superpowers/plans/2026-07-30-wp21-dual-write-implementation.md`

## WP-21 Tasks
- [x] Task 1: Private `buku_tamu` foundation and static contract test (focused 10 tests, independent review clean; no commit requested)
- [x] Task 2: Traceable backfill and atomic dual-write trigger (focused 16 tests, independent review clean; no commit requested)
- [x] Task 3: Guarded production verifier (selftest-wp21.mjs — remediated Phase 3 + Phase 4 PASS; commits & tests clean)
- [x] Task 4: Transition records and controlled production cutover (M15+M16 DITERAPKAN 2026-07-30 13:17 WIB; selftest PASS; 11/11 tests; DB-CHANGES updated)
- [x] Task 5: WP-22 handoff evidence (cutover facts + rollback window recorded; selftest PASS 13:47 WIB; WP-22 boundary set in DB-CHANGES)

## WP-22 + WP-23 Tasks (2026-07-30)
- [x] WP-22: admin/kunjungan/page.tsx → kunjungan + tiket_antrean
- [x] WP-22: admin/page.tsx → kunjungan + tiket_antrean
- [x] WP-22: admin/antrian/page.tsx → tiket_antrean (write masih ke visit)
- [x] WP-22: M16 views migration — v_antrian_loket + get_queue_position → tiket_antrean (applied ✓)
- [x] WP-22: layar-antrian/page.tsx — Realtime subscribe → tiket_antrean
- [x] WP-23: tandai_tidak_terlayani_akhir_hari() + cron 15:35 WIB (applied ✓)
- [x] WP-23: panggil_tiket() + tombol Panggil di antrian page (applied ✓)
- [ ] WP-24: Hentikan penulisan ke visit — DIBLOKIR: butuh ≥2 minggu WP-22 stabil + persetujuan manusia

## WP-25..32 Tasks (2026-07-30)
- [x] WP-25: chat_pesan.jenis_jawaban + 2 index (applied ✓)
- [x] WP-26: site_settings kolom + konten_versi table (applied ✓)
- [x] WP-27: dokumen_peraturan + dokumen_potongan + match_dokumen() (applied ✓)
- [x] WP-28: (depends on WP-27; migration deferred — schema ready for WP-28 code)
- [x] WP-29: layar_token + v_layar_antrian + validate_layar_token() + kode TV + admin layar (applied ✓)
- [x] WP-30: rekap_harian_layanan + laporan_snapshot + rollup_rekap_harian() + cron (applied ✓)
- [x] WP-31: listing_umkm kolom verifikasi + umkm_verifikasi_jejak + expired cron (applied ✓)
- [x] WP-32: jejak_minat_investasi (applied ✓) + /peta-potensi page (wajib login, log jejak)

## Kode Halaman WP-27/30/31/32 (2026-07-30)
- [x] WP-27: admin/dokumen/page.tsx + /api/admin/dokumen/embed (chunking + Gemini embed) ✓
- [x] WP-30: admin/rekap/page.tsx (tabel rekap + manual rollup + CSV export) ✓
- [x] WP-31: umkm_verifikasi_jejak schema siap; UI verifikasi ada di admin/umkm (status update + catatan)
- [x] WP-32: peta-potensi/page.tsx (6 sektor, login gate, jejak logging) ✓
- [x] admin-nav.ts: Rekap Harian + Dokumen Peraturan + Kelola Layar ditambahkan ✓

---

Plan: `docs/superpowers/plans/2026-08-08-live-chat-fix-plan.md` (branch: fix/live-chat-realtime-bot)

## Live Chat Fix Tasks (2026-08-08)
- [x] Task 1: Realtime publication chat_sesi+chat_pesan (commit 238de1e, review clean, APPLIED ke DB live — publication + REPLICA IDENTITY FULL terverifikasi via pg)
- [x] Task 2: broadcastNewMessage subscribe-before-send di messages route (commits 62cdb32 + 4373e96 timeout-hardening, review Approved; 11/11 tests)
- [x] Task 3: AI route pakai broadcastNewMessage (commit 0890925, review Approved; 22/24 ai.test — 2 known-fail utk Task 6)
  Minor utk final review: (T2) weak async-order assert; (T3) brittle source-regex; (T3) no runtime helper-arg assertion
- [x] Task 4: polling fallback 4s di thread admin (commits 41c0e1f + comment-fix, review Approved; tsc clean, admin/chat 7/7, chat 11/11)
- [x] Task 5: embedding 3072 migration + re-embed pipeline (commits 3f5478e + 52e1112 ordering/match_faq fix + no-index fix; review Approved; APPLIED ke DB live via pg; FAQ re-embedded 3072-dim; match_faq verified end-to-end sim 0.6999)
  CATATAN OPS: .env.local GEMINI_EMBEDDING_MODEL=gemini-embedding-001 (sudah di-set). Deploy env (Vercel) HARUS juga set gemini-embedding-001. match_dokumen tetap 768 (tabel dokumen_potongan terpisah) — tidak disentuh.
- [x] Task 6: system prompt ramah + route-level greeting classifier (commits 41bdbd4 + 4ad4856; review Approved; ai.test.ts 27/27 GREEN — 2 date-flaky test diperbaiki dgn clock-pinning; greeting tak lagi eskalasi di weekday)
  Follow-up dicatat utk final review: (T6) fake-timers bisa lebih sempit {toFake:['Date']}
- [x] Task 7: verifikasi — build PASS (55/55), tsc clean, full suite 536/537 (1 flake pre-existing checkin.rls, pass 19/19 terisolasi), REALTIME DIUJI LIVE: broadcast 179ms diterima + postgres_changes UPDATE chat_sesi diterima. 2 error lint any di messages.test.ts diperbaiki (e53e1f1). 3 lint issues pre-existing di file tak-tersentuh (investasi-leads, pengaduan, antrian) — BUKAN scope branch ini.
- [x] FAQ regulation top-up: 51 FAQ baru disisipkan; FAQ NIB salah klasifikasi dipindah BALMON → OSS dan diperbarui berdasarkan PP 28/2025; DB live kini 80 FAQ aktif = 10 per 8 layanan; 52/52 embedding gemini-embedding-001 (3072-dim) selesai; pending embed 0; match_faq 8/8 layanan lolos threshold 0.7 (similarity 0.8143–0.9119); rerun seed idempoten. Review paralel menemukan 2 redaksi BALMON yang menyempit norma Permenkominfo (7/2021 'milik' vs 'pemegang izin lain'; 17/2018 KRAP 'dapat menimbulkan') — dikoreksi di DB+script, re-embed, retrieval tetap 8/8 lolos. Committed 93f2447, pushed. Catatan di luar scope top-up: vercel.json belum berisi cron embed; label 'Urutan Pencocokan' di admin FAQ tidak memengaruhi match_faq (bug UX terpisah).
- [x] Final whole-branch review (opus): "Ready to merge WITH fixes" — 0 Critical, 2 Important DIPERBAIKI (c3f1d5f): (1) getEmbeddingModel kini menerima model eksplisit, default aman 768, caller FAQ pass gemini-embedding-001/3072 → jalur embed dokumen tak lagi regresi; (2) greeting classifier diperketat (murni sapaan, pendek, tanpa '?') → pertanyaan substantif-sopan tetap eskalasi. + T6 fake-timers {toFake:['Date']}. Docs env direkonsiliasi.
  CATATAN: text-embedding-004 (default jalur dokumen) 404 di API key ini → jalur embed DOKUMEN sudah rusak pra-branch (fitur RAG dokumen terpisah, match_dokumen tak dipakai di src/). Di luar scope live-chat. Perlu keputusan terpisah bila fitur dokumen diaktifkan.
  SEMUA TEST: 211/211 (chat+lib+migrations) green; build PASS; realtime & retrieval DIUJI LIVE OK.
- [x] E2E BROWSER VERIFIED (localhost, pengunjung 'argya', Helpdesk OSS): (1) kirim "halo" -> bot balas ramah spesifik layanan, status TETAP "Mode Chatbot" (tidak eskalasi); (2) tanya "syarat NIB" -> bot jawab dari FAQ dgn kutipan [1]; (3) pesan petugas (insert+broadcast via helper) MUNCUL di browser pengunjung TANPA reload ("PETUGAS LOKET"). Artefak uji ber-token dihapus. Dev server distop.
- [x] PERKAYA FAQ: 28 FAQ baru lintas 8 layanan (total 29). Insert dgn perlu_embed_ulang=true, pipeline embed 3072-dim -> 29/29 ter-embed. match_faq terverifikasi sim 0.83-0.89 (semua >= 0.7 threshold). Skrip reusable: scripts/seed-faq.mjs.
- [x] Task 13: integration test (commit b0be15f, review Approved) — minor: 4-tab assertions are independent (not order-enforcing); global.fetch leak across tests (low impact, single test in file); pre-existing antrian.test.tsx + checkin.rls.test.tsx failures NOT caused by this branch (confirmed on base bb57804)

---

## Final whole-branch review (post-Task 13)

**Reviewer verdict:** Ready with minor follow-ups. No critical findings.

**Important finding #1 (query.ts:50 — PostgREST or= on relation alias):** Reviewer flagged possible 400 risk. Verified against actual code: `select` uses alias `pelayanan_oss` / `pelayanan_perizinan` (lowercase), and the `or=` filter references the same alias — PostgREST accepts the alias, not the raw table name. Persistent typo convention (`pelayanan_perizinAN`/`'perizinAN'`) applies only to the raw table and form_type literal, not the FK relation alias. Existing `tickets.test.ts` exercises the chain via permissive mock. **False positive — no change.**

**Important finding #2 (page.tsx + RekapLayananTable.tsx — duplicate fetch):** Confirmed. Page fetched `/layanan-options` on mount, table re-fetched same endpoint on mount. **Fix dispatched.**

### Final fix — `c453e36`

- `fix(rekap): hindari duplikasi fetch /layanan-options`
- Lifted fetch fully into page; added `layananOptions` state; passed as new prop to `<RekapLayananTable />`. Table now receives `options: LayananOption[]` prop, dropped local fetch + state.
- Tests: 7/7 rekap tests pass; typecheck/lint/build all clean.
- `npm test` shows 149 pre-existing failures in unrelated suites (proxy, AI/chat, UMKM, antrian, skm, EstimasiAntrean, migration-files, etc.) — not caused by this branch; tracked separately.

### Final commit list (14 commits since pre-feature base `bb57804`)

1. `bb57804` docs(superpowers): implementation plan rekap per layanan
2. `678bdbf` chore(deps): exceljs
3. `77b525b` feat(rekap): izinkan petugas akses menu Rekap Harian
4. `43df5a9` feat(rekap): zod schemas
5. `573bcbd` feat(rekap): format helpers
6. `5e7c807` feat(rekap): query builder
7. `6e68d6e` feat(rekap): Excel workbook builder
8. `4c9bdbc` feat(rekap): endpoint layanan-options
9. `63e7b21` feat(rekap): endpoint tickets
10. `fc1c475` feat(rekap): endpoint export + audit log
11. `8f97b5c` feat(rekap): side panel detail tiket
12. `d938770` feat(rekap): tabel rekap dengan filter/search/pagination
13. `447e8af` feat(rekap): tab Rekap Per Layanan
14. `b0be15f` test(rekap): integration test tab Rekap Per Layanan
15. `c453e36` fix(rekap): hindari duplikasi fetch /layanan-options  ← post-review fix

## 2026-09-02 — Item 1: EstimasiAntrean hari_libur
- Task complete (commit 8a7f14e, review via test 617/617 + lint + typecheck + build)
- Migration `202609020001_estimasi_hari_libur.sql` (tabel libur nasional + RLS).
- `is_layanan_buka_jadwal` ternyata SUDAH ada sejak `202607290010_jadwal_standby` — tidak perlu migration.
- CSS `.holidayBanner` + `.badge_tutup`; 3 test baru; mock hari_libur + rpc.

## 2026-09-02 — Issue #3 + #4
- #3 migration-docs flaky: FIXED (commit aa09f37) — mock execFileSync, tidak spawn CLI nyata. Issue ditutup.
- #4 backlog minor rekap (8 findings): FIXED (commit aa09f37) — formatTanggalId, TicketsQueryParams export, slugify helper, RFC 6266, todayWIB(), denominator rata-rata, prefix kolom Excel, komentar searchParams. Issue ditutup.
- Gates: lint/typecheck/build hijau, full suite 620/620.

---

Plan: `docs/superpowers/plans/2026-10-13-implementasi-fo-mutasi-fondasi-plan.md` (branch `feat/audit-fondasi-fo-eskalasi`)

## Fase 0 — Fondasi (2026-10-13)
- [x] 0.1 Upgrade next 16.3.8 + sharp 0.35.5 (diverifikasi ulang: lint/typecheck/1008 test/build)
- [x] 0.2 Gerbang lokal audit:check + deps:check + hook pre-push (verify:baseline exit 0, 153 file/1169 test)
- [x] 0.3 MANIFEST.json + test penjaga migrasi (30 test; bukti deteksi edit in-place)
- [x] 0.4 Verifikasi ledger read-only (39 terpasang/1 tidak ditemukan/4 tak dapat ditentukan); pengisian ledger MENUNGGU konfirmasi CEO
- [ ] 0.5 V5 (nilai Max rows & rate limit login dari Dashboard) — menunggu CEO

## Fase 1 — Mutasi tercek
- [x] 1.1 Helper `src/lib/supabase/mutate.ts` (37 test)
- [x] 1.2 Inventaris mutasi (115 mutasi)
- [x] 1.3 Konversi T2a/T2b/T2c
- [x] 1.4 Konversi sisa mutasi (T2d) — 3 agent + review Opus + paket perbaikan FixA/B/C
- [x] 1.5 Migrasi FAQ umum (0001) + penutup celah FO (0002) — DITULIS, BELUM DITERAPKAN ke produksi (konfirmasi CEO)
- [x] 1.6 Aturan lint `lmh/mutasi-tercek` memblokir (61 test)

## Fase 2 — Error publik & consent
- [x] 2.1 ErrorRetry · [x] 2.2 chat (T7/S14/FAQ umum/S1) · [x] 2.3 UMKM (T6) + reservasi (S1)
- Gerbang: verify:baseline exit 0 (177 file / 1589 test) 2026-10-13

## Menunggu keputusan CEO
- Gerbang G (WP-24, idle sesi, kolom identitas, topik, field wajib, cutover) sebelum Fase 3
- Konfirmasi terapan migrasi 202610130001/0002 ke produksi; pengisian ledger; V5


## Pembaruan 2026-10-14 — Tahap A-D (branch `feat/audit-fondasi-fo-eskalasi`, lokal, belum di-push)

Catatan: sebagian besar BELUM diterapkan ke produksi dan BELUM di-deploy. Hanya migrasi 202610140001 yang di produksi. Sumber: `docs/MIGRATIONS.md`, `docs/analysis/DB-CHANGES.md`, `docs/RUNBOOK_FO_ESKALASI.md`, pelacak lokal `docs/audit/AUDIT-2026-10-12-TRACKER.md`.

- [x] Fase 0-2 fondasi/mutasi tercek/error publik/FAQ umum: di-commit lokal (894f170, 3161882, 901739f, 423e02e); FAQ umum (202610130001/2) DITERAPKAN 2026-10-13
- [x] A1/A2 sesi tunggal: migrasi 0001 DITERAPKAN 2026-10-13 (flag `sesi_tunggal_aktif`=false); klien di-commit lokal (ef9bfab), belum di-deploy
- [x] A3 kepemilikan tiket: kode di-commit lokal (e3d9208); migrasi 0002 DITULIS, BELUM DITERAPKAN
- [x] B-DB1 model data + RPC FO + penyelarasan (0003-0005) dan C2 kunci nama (0006): SQL di-commit lokal (2e77296), BELUM DITERAPKAN
- [x] Klien Tahap B/D (halaman `admin/fo/*`, `admin/topik`, `rekap-fo`, `performa`, dialog, scan, reservasi): working tree, belum di-commit
- [x] WP-24 (0007, 0008) ditulis + `wp24.test.ts`: BELUM DITERAPKAN; `scripts/test-wp24.mjs` belum dijalankan
- [x] C1 chat online (0009): ditulis; uji perilaku ROLLBACK 99 lolos (2026-10-14); BELUM DITERAPKAN
- [x] C3 pendataan wajib (0011): ditulis; BELUM DITERAPKAN
- [x] Dokumentasi: fragmen DB2/C1/C3 digabung ke MIGRATIONS.md + DB-CHANGES.md; STATUS, DECISION_LOG, RBAC-MATRIX §6, ENVIRONMENT_VARIABLES, RUNBOOK_FO_ESKALASI, KEBIJAKAN_PDP/PRD (rujukan `/api/checkin`) diperbarui
- [ ] 0012 (agent lain) dan `_fragmen-R12.md`: belum digabung
- [ ] Gerbang penuh `verify:baseline` untuk working tree + commit klien Tahap B-D; cutover malam (CEO); pengisian ledger; nyalakan flag sesi tunggal
- [ ] Tahap E survei terpadu (B7): belum dimulai
