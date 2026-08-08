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
- [x] Final whole-branch review (opus): "Ready to merge WITH fixes" — 0 Critical, 2 Important DIPERBAIKI (c3f1d5f): (1) getEmbeddingModel kini menerima model eksplisit, default aman 768, caller FAQ pass gemini-embedding-001/3072 → jalur embed dokumen tak lagi regresi; (2) greeting classifier diperketat (murni sapaan, pendek, tanpa '?') → pertanyaan substantif-sopan tetap eskalasi. + T6 fake-timers {toFake:['Date']}. Docs env direkonsiliasi.
  CATATAN: text-embedding-004 (default jalur dokumen) 404 di API key ini → jalur embed DOKUMEN sudah rusak pra-branch (fitur RAG dokumen terpisah, match_dokumen tak dipakai di src/). Di luar scope live-chat. Perlu keputusan terpisah bila fitur dokumen diaktifkan.
  SEMUA TEST: 211/211 (chat+lib+migrations) green; build PASS; realtime & retrieval DIUJI LIVE OK.
- [x] E2E BROWSER VERIFIED (localhost, pengunjung 'argya', Helpdesk OSS): (1) kirim "halo" -> bot balas ramah spesifik layanan, status TETAP "Mode Chatbot" (tidak eskalasi); (2) tanya "syarat NIB" -> bot jawab dari FAQ dgn kutipan [1]; (3) pesan petugas (insert+broadcast via helper) MUNCUL di browser pengunjung TANPA reload ("PETUGAS LOKET"). Artefak uji ber-token dihapus. Dev server distop.
